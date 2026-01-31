/**
 * TiDB Cloud MCP Server - Remote/Hosted Version
 *
 * This server implements OAuth 2.1 (RFC 8414) as an OAuth proxy to TiDB Cloud.
 * MCP clients authenticate users via the standard OAuth flow, and the server
 * forwards authentication to TiDB Cloud.
 *
 * OAuth Flow:
 * 1. MCP client calls /mcp -> receives 401
 * 2. Client discovers endpoints via /.well-known/oauth-authorization-server
 * 3. Client redirects user to /authorize
 * 4. Server redirects to TiDB Cloud OAuth
 * 5. User authorizes -> TiDB Cloud redirects to /callback
 * 6. Server exchanges code, redirects to client with new code
 * 7. Client calls /token to get access token
 * 8. Client includes token in Authorization header for /mcp requests
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { loadConfig, validateConfig, type Environment } from "./config.js";
import { getLandingPageHtml } from "./landing.js";
import {
  httpsEnforcement,
  securityHeaders,
  requestId,
} from "./middleware/security.js";

// ============================================================
// Configuration
// ============================================================

const config = loadConfig();

try {
  validateConfig(config);
} catch (error) {
  if (process.env.NODE_ENV === "production") {
    console.error(error);
    process.exit(1);
  } else {
    console.warn("[config] Validation warning:", (error as Error).message);
  }
}

// ============================================================
// OAuth Constants
// ============================================================

const TIDB_OAUTH_ENDPOINTS: Record<
  Environment,
  { authorize: string; token: string }
> = {
  dev: {
    authorize: "https://dev.tidbcloud.com/oauth/authorize",
    token: "https://oauth.dev.tidbcloud.com/v1/token",
  },
  prod: {
    authorize: "https://tidbcloud.com/oauth/authorize",
    token: "https://oauth.tidbcloud.com/v1/token",
  },
};

const OAUTH_SCOPE = "org:owner";

// ============================================================
// OAuth State Storage (in-memory, use Redis/DB in production)
// ============================================================

interface AuthorizationState {
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  clientId: string;
  createdAt: number;
}

interface AuthorizationCode {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  createdAt: number;
}

const authorizationStates = new Map<string, AuthorizationState>();
const authorizationCodes = new Map<string, AuthorizationCode>();

function cleanupExpiredStates(): void {
  const now = Date.now();
  const expirationTime = 10 * 60 * 1000; // 10 minutes

  for (const [state, data] of authorizationStates.entries()) {
    if (now - data.createdAt > expirationTime) {
      authorizationStates.delete(state);
    }
  }

  for (const [code, data] of authorizationCodes.entries()) {
    if (now - data.createdAt > expirationTime) {
      authorizationCodes.delete(code);
    }
  }
}

function generateRandomString(length: number): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  return Array.from(randomValues, (v) => chars[v % chars.length]).join("");
}

// ============================================================
// Hono App Setup
// ============================================================

const app = new Hono();

app.use("*", requestId());
app.use("*", httpsEnforcement());
app.use("*", securityHeaders());
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "Accept", "Origin"],
    maxAge: 86400,
  }),
);

// ============================================================
// General Endpoints
// ============================================================

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "0.1.0",
  });
});

app.get("/", (c) => {
  const host = c.req.header("host") || config.server.serverHost;
  const scheme = c.req.header("x-forwarded-proto") || "https";
  return c.html(getLandingPageHtml(`${scheme}://${host}`));
});

app.get("/api", (c) => {
  const host = c.req.header("host") || config.server.serverHost;
  const scheme = c.req.header("x-forwarded-proto") || "https";
  const baseUrl = `${scheme}://${host}`;

  return c.json({
    name: "TiDB Cloud MCP Server",
    version: "0.1.0",
    description: "MCP server for TiDB Cloud with OAuth 2.1 authentication",
    endpoints: {
      mcp: `${baseUrl}/mcp`,
      health: `${baseUrl}/health`,
      oauth: {
        metadata: `${baseUrl}/.well-known/oauth-authorization-server`,
        authorize: `${baseUrl}/authorize`,
        token: `${baseUrl}/token`,
        register: `${baseUrl}/register`,
      },
    },
    documentation: "https://github.com/likidu/mcp-server-tidbcloud",
  });
});

// ============================================================
// OAuth 2.0 Protected Resource Metadata
// ============================================================

app.get("/.well-known/oauth-protected-resource", (c) => {
  const host = c.req.header("host") || config.server.serverHost;
  const scheme = c.req.header("x-forwarded-proto") || "https";
  const baseUrl = `${scheme}://${host}`;

  return c.json({
    resource: baseUrl,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ["header"],
    resource_documentation: "https://github.com/likidu/mcp-server-tidbcloud",
  });
});

// ============================================================
// OAuth 2.0 Authorization Server Metadata (RFC 8414)
// ============================================================

app.get("/.well-known/oauth-authorization-server", (c) => {
  const host = c.req.header("host") || config.server.serverHost;
  const scheme = c.req.header("x-forwarded-proto") || "https";
  const baseUrl = `${scheme}://${host}`;

  return c.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/api/authorize`,
    token_endpoint: `${baseUrl}/api/token`,
    registration_endpoint: `${baseUrl}/api/register`,
    scopes_supported: [OAUTH_SCOPE],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    code_challenge_methods_supported: ["S256", "plain"],
    service_documentation: "https://github.com/likidu/mcp-server-tidbcloud",
  });
});

// ============================================================
// Dynamic Client Registration (RFC 7591)
// ============================================================

app.post("/api/register", async (c) => {
  try {
    const body = await c.req.json();
    const clientId = `mcp_${generateRandomString(16)}`;

    return c.json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      redirect_uris: body.redirect_uris || [],
      client_name: body.client_name || "MCP Client",
    });
  } catch (err) {
    return c.json(
      {
        error: "invalid_client_metadata",
        error_description:
          err instanceof Error ? err.message : "Invalid request",
      },
      400,
    );
  }
});

// ============================================================
// Authorization Endpoint
// ============================================================

app.get("/api/authorize", (c) => {
  const clientId = c.req.query("client_id");
  const redirectUri = c.req.query("redirect_uri");
  const responseType = c.req.query("response_type");
  const state = c.req.query("state");
  const codeChallenge = c.req.query("code_challenge");
  const codeChallengeMethod = c.req.query("code_challenge_method") || "plain";

  if (!redirectUri) {
    return c.json(
      {
        error: "invalid_request",
        error_description: "redirect_uri is required",
      },
      400,
    );
  }

  if (responseType !== "code") {
    return c.json(
      {
        error: "unsupported_response_type",
        error_description: "Only 'code' response type is supported",
      },
      400,
    );
  }

  const serverClientId = config.oauth?.clientId;
  if (!serverClientId) {
    return c.json(
      {
        error: "server_error",
        error_description: "OAuth not configured on server",
      },
      500,
    );
  }

  const internalState = generateRandomString(32);
  authorizationStates.set(internalState, {
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    clientId: clientId || "unknown",
    createdAt: Date.now(),
  });

  cleanupExpiredStates();

  const host = c.req.header("host") || config.server.serverHost;
  const scheme = c.req.header("x-forwarded-proto") || "https";
  // Use /oauth/callback to match the registered OAuth app redirect URI
  const ourCallbackUri = `${scheme}://${host}/oauth/callback`;

  const tidbAuthUrl = new URL(
    TIDB_OAUTH_ENDPOINTS[config.environment].authorize,
  );
  tidbAuthUrl.searchParams.set("client_id", serverClientId);
  tidbAuthUrl.searchParams.set("redirect_uri", ourCallbackUri);
  tidbAuthUrl.searchParams.set("scope", OAUTH_SCOPE);
  tidbAuthUrl.searchParams.set("response_type", "code");
  tidbAuthUrl.searchParams.set(
    "state",
    state ? `${internalState}:${state}` : internalState,
  );

  return c.redirect(tidbAuthUrl.toString());
});

// ============================================================
// OAuth Callback (receives code from TiDB Cloud)
// ============================================================

app.get("/api/callback", async (c) => {
  const code = c.req.query("code");
  const stateParam = c.req.query("state");
  const error = c.req.query("error");
  const errorDescription = c.req.query("error_description");

  if (error) {
    const internalState = stateParam?.split(":")[0];
    const stateData = internalState
      ? authorizationStates.get(internalState)
      : null;

    if (stateData) {
      const redirectUrl = new URL(stateData.redirectUri);
      redirectUrl.searchParams.set("error", error);
      if (errorDescription) {
        redirectUrl.searchParams.set("error_description", errorDescription);
      }
      authorizationStates.delete(internalState!);
      return c.redirect(redirectUrl.toString());
    }

    return c.json({ error, error_description: errorDescription }, 400);
  }

  if (!code || !stateParam) {
    return c.json(
      { error: "invalid_request", error_description: "Missing code or state" },
      400,
    );
  }

  const [internalState, ...clientStateParts] = stateParam.split(":");
  const clientState = clientStateParts.join(":");

  const stateData = authorizationStates.get(internalState);
  if (!stateData) {
    return c.json(
      {
        error: "invalid_request",
        error_description: "Invalid or expired state",
      },
      400,
    );
  }

  const serverClientId = config.oauth?.clientId;
  const serverClientSecret = config.oauth?.clientSecret;

  if (!serverClientId || !serverClientSecret) {
    return c.json(
      { error: "server_error", error_description: "OAuth not configured" },
      500,
    );
  }

  const host = c.req.header("host") || config.server.serverHost;
  const scheme = c.req.header("x-forwarded-proto") || "https";
  const ourCallbackUri = `${scheme}://${host}/callback`;

  try {
    const tokenUrl = TIDB_OAUTH_ENDPOINTS[config.environment].token;
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: serverClientId,
        client_secret: serverClientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: ourCallbackUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("TiDB Cloud token exchange failed:", errorText);

      const redirectUrl = new URL(stateData.redirectUri);
      redirectUrl.searchParams.set("error", "server_error");
      redirectUrl.searchParams.set(
        "error_description",
        "Failed to exchange token with TiDB Cloud",
      );
      authorizationStates.delete(internalState);
      return c.redirect(redirectUrl.toString());
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token?: string;
    };

    const ourAuthCode = generateRandomString(32);
    authorizationCodes.set(ourAuthCode, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      redirectUri: stateData.redirectUri,
      codeChallenge: stateData.codeChallenge,
      codeChallengeMethod: stateData.codeChallengeMethod,
      createdAt: Date.now(),
    });

    authorizationStates.delete(internalState);

    const redirectUrl = new URL(stateData.redirectUri);
    redirectUrl.searchParams.set("code", ourAuthCode);
    if (clientState) {
      redirectUrl.searchParams.set("state", clientState);
    }

    return c.redirect(redirectUrl.toString());
  } catch (err) {
    console.error("OAuth callback error:", err);

    const redirectUrl = new URL(stateData.redirectUri);
    redirectUrl.searchParams.set("error", "server_error");
    redirectUrl.searchParams.set(
      "error_description",
      err instanceof Error ? err.message : "Unknown error",
    );
    authorizationStates.delete(internalState);
    return c.redirect(redirectUrl.toString());
  }
});

// ============================================================
// Token Endpoint
// ============================================================

app.post("/api/token", async (c) => {
  const contentType = c.req.header("content-type") || "";
  const body = contentType.includes("application/x-www-form-urlencoded")
    ? ((await c.req.parseBody()) as Record<string, string>)
    : ((await c.req.json()) as Record<string, string>);

  const grantType = body.grant_type;

  // Handle authorization_code grant
  if (grantType === "authorization_code") {
    const {
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    } = body;

    if (!code) {
      return c.json(
        { error: "invalid_request", error_description: "Missing code" },
        400,
      );
    }

    const codeData = authorizationCodes.get(code);
    if (!codeData) {
      return c.json(
        {
          error: "invalid_grant",
          error_description: "Invalid or expired authorization code",
        },
        400,
      );
    }

    if (redirectUri && redirectUri !== codeData.redirectUri) {
      return c.json(
        { error: "invalid_grant", error_description: "redirect_uri mismatch" },
        400,
      );
    }

    // Verify PKCE
    if (codeData.codeChallenge) {
      if (!codeVerifier) {
        return c.json(
          {
            error: "invalid_request",
            error_description: "code_verifier required",
          },
          400,
        );
      }

      let computedChallenge: string;
      if (codeData.codeChallengeMethod === "S256") {
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest(
          "SHA-256",
          encoder.encode(codeVerifier),
        );
        computedChallenge = btoa(
          String.fromCharCode(...new Uint8Array(hashBuffer)),
        )
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
      } else {
        computedChallenge = codeVerifier;
      }

      if (computedChallenge !== codeData.codeChallenge) {
        return c.json(
          {
            error: "invalid_grant",
            error_description: "code_verifier mismatch",
          },
          400,
        );
      }
    }

    authorizationCodes.delete(code);

    return c.json({
      access_token: codeData.accessToken,
      token_type: "Bearer",
      expires_in: codeData.expiresIn,
      refresh_token: codeData.refreshToken,
    });
  }

  // Handle refresh_token grant
  if (grantType === "refresh_token") {
    const refreshToken = body.refresh_token;

    if (!refreshToken) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "Missing refresh_token",
        },
        400,
      );
    }

    const serverClientId = config.oauth?.clientId;
    const serverClientSecret = config.oauth?.clientSecret;

    if (!serverClientId || !serverClientSecret) {
      return c.json(
        { error: "server_error", error_description: "OAuth not configured" },
        500,
      );
    }

    try {
      const tokenUrl = TIDB_OAUTH_ENDPOINTS[config.environment].token;
      const tokenResponse = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: serverClientId,
          client_secret: serverClientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });

      if (!tokenResponse.ok) {
        console.error(
          "TiDB Cloud token refresh failed:",
          await tokenResponse.text(),
        );
        return c.json(
          {
            error: "invalid_grant",
            error_description: "Failed to refresh token",
          },
          400,
        );
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
        token_type: string;
        expires_in: number;
        refresh_token?: string;
      };

      return c.json({
        access_token: tokenData.access_token,
        token_type: "Bearer",
        expires_in: tokenData.expires_in,
        refresh_token: tokenData.refresh_token || refreshToken,
      });
    } catch (err) {
      console.error("Token refresh error:", err);
      return c.json(
        { error: "server_error", error_description: "Failed to refresh token" },
        500,
      );
    }
  }

  // Unsupported grant type
  return c.json(
    {
      error: "unsupported_grant_type",
      error_description: `Grant type '${grantType}' not supported`,
    },
    400,
  );
});

// ============================================================
// Alias: /oauth/callback (for backward compatibility with registered OAuth app)
// ============================================================

// Also handle /oauth/callback directly (registered with TiDB Cloud OAuth)
app.get("/oauth/callback", async (c) => {
  const code = c.req.query("code");
  const stateParam = c.req.query("state");
  const error = c.req.query("error");
  const errorDescription = c.req.query("error_description");

  if (error) {
    const internalState = stateParam?.split(":")[0];
    const stateData = internalState
      ? authorizationStates.get(internalState)
      : null;

    if (stateData) {
      const redirectUrl = new URL(stateData.redirectUri);
      redirectUrl.searchParams.set("error", error);
      if (errorDescription) {
        redirectUrl.searchParams.set("error_description", errorDescription);
      }
      authorizationStates.delete(internalState!);
      return c.redirect(redirectUrl.toString());
    }

    return c.json({ error, error_description: errorDescription }, 400);
  }

  if (!code || !stateParam) {
    return c.json(
      { error: "invalid_request", error_description: "Missing code or state" },
      400,
    );
  }

  const [internalState, ...clientStateParts] = stateParam.split(":");
  const clientState = clientStateParts.join(":");

  const stateData = authorizationStates.get(internalState);
  if (!stateData) {
    return c.json(
      {
        error: "invalid_request",
        error_description: "Invalid or expired state",
      },
      400,
    );
  }

  const serverClientId = config.oauth?.clientId;
  const serverClientSecret = config.oauth?.clientSecret;

  if (!serverClientId || !serverClientSecret) {
    return c.json(
      { error: "server_error", error_description: "OAuth not configured" },
      500,
    );
  }

  const host = c.req.header("host") || config.server.serverHost;
  const scheme = c.req.header("x-forwarded-proto") || "https";
  // Use /oauth/callback as the redirect_uri since that's what's registered
  const ourCallbackUri = `${scheme}://${host}/oauth/callback`;

  try {
    const tokenUrl = TIDB_OAUTH_ENDPOINTS[config.environment].token;
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: serverClientId,
        client_secret: serverClientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: ourCallbackUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("TiDB Cloud token exchange failed:", errorText);

      const redirectUrl = new URL(stateData.redirectUri);
      redirectUrl.searchParams.set("error", "server_error");
      redirectUrl.searchParams.set(
        "error_description",
        "Failed to exchange token with TiDB Cloud",
      );
      authorizationStates.delete(internalState);
      return c.redirect(redirectUrl.toString());
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token?: string;
    };

    const ourAuthCode = generateRandomString(32);
    authorizationCodes.set(ourAuthCode, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      redirectUri: stateData.redirectUri,
      codeChallenge: stateData.codeChallenge,
      codeChallengeMethod: stateData.codeChallengeMethod,
      createdAt: Date.now(),
    });

    authorizationStates.delete(internalState);

    const redirectUrl = new URL(stateData.redirectUri);
    redirectUrl.searchParams.set("code", ourAuthCode);
    if (clientState) {
      redirectUrl.searchParams.set("state", clientState);
    }

    return c.redirect(redirectUrl.toString());
  } catch (err) {
    console.error("OAuth callback error:", err);

    const redirectUrl = new URL(stateData.redirectUri);
    redirectUrl.searchParams.set("error", "server_error");
    redirectUrl.searchParams.set(
      "error_description",
      err instanceof Error ? err.message : "Unknown error",
    );
    authorizationStates.delete(internalState);
    return c.redirect(redirectUrl.toString());
  }
});

// ============================================================
// Error Handlers
// ============================================================

app.notFound((c) => {
  return c.json(
    {
      error: "Not Found",
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
    404,
  );
});

app.onError((err, c) => {
  console.error("Server error:", err);
  return c.json({ error: "Internal Server Error", message: err.message }, 500);
});

export default app;
