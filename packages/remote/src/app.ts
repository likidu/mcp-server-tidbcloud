/**
 * TiDB Cloud MCP Server - Remote/Hosted Version
 *
 * Hono app for non-MCP endpoints (landing page, health check, etc.)
 * MCP endpoint is handled separately by api/mcp/route.ts using mcp-handler
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { loadConfig, validateConfig } from "./config.js";
import { getLandingPageHtml } from "./landing.js";
import {
  httpsEnforcement,
  securityHeaders,
  requestId,
} from "./middleware/security.js";

// Load and validate configuration
const config = loadConfig();

// Validate config (will throw if invalid, warn for missing optional)
try {
  validateConfig(config);
} catch (error) {
  if (process.env.NODE_ENV === "production") {
    console.error(error);
    process.exit(1);
  } else {
    // In development, just warn
    console.warn("[config] Validation warning:", (error as Error).message);
  }
}

// Create Hono app
const app = new Hono();

// Security middleware (applied first)
app.use("*", requestId());
app.use("*", httpsEnforcement());
app.use("*", securityHeaders());

// Request logging
app.use("*", logger());

// CORS configuration
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "Accept", "Origin"],
    maxAge: 86400,
  }),
);

// Health check endpoint
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "0.1.0",
  });
});

// Root endpoint - Landing page
app.get("/", (c) => {
  const host = c.req.header("host") || config.server.serverHost;
  const scheme = c.req.header("x-forwarded-proto") || "http";
  const baseUrl = `${scheme}://${host}`;

  // Return HTML landing page
  return c.html(getLandingPageHtml(baseUrl));
});

// API info endpoint (JSON)
app.get("/api", (c) => {
  const host = c.req.header("host") || config.server.serverHost;
  const scheme = c.req.header("x-forwarded-proto") || "http";
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
// MCP OAuth 2.1 Endpoints (RFC 8414 compliant)
// ============================================================
// This server acts as an OAuth proxy to TiDB Cloud.
// MCP clients will use these endpoints to authenticate users.
// ============================================================

import type { Environment } from "./config.js";

// TiDB Cloud OAuth endpoints by environment
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

// In-memory storage for authorization state (maps state -> { redirectUri, codeChallenge, codeChallengeMethod })
// In production, you might want to use Redis or a database
const authorizationStates = new Map<
  string,
  {
    redirectUri: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    clientId: string;
    createdAt: number;
  }
>();

// Clean up expired states (older than 10 minutes)
function cleanupExpiredStates() {
  const now = Date.now();
  const expirationTime = 10 * 60 * 1000; // 10 minutes
  for (const [state, data] of authorizationStates.entries()) {
    if (now - data.createdAt > expirationTime) {
      authorizationStates.delete(state);
    }
  }
}

// Generate a random string for state/codes
function generateRandomString(length: number): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

// In-memory storage for authorization codes (maps code -> { accessToken, refreshToken, expiresAt })
const authorizationCodes = new Map<
  string,
  {
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    redirectUri: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    createdAt: number;
  }
>();

// ============================================================
// OAuth 2.0 Authorization Server Metadata (RFC 8414)
// ============================================================
app.get("/.well-known/oauth-authorization-server", (c) => {
  const host = c.req.header("host") || config.server.serverHost;
  const scheme = c.req.header("x-forwarded-proto") || "https";
  const baseUrl = `${scheme}://${host}`;

  return c.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
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
// For MCP, we allow any client to register - they'll authenticate via TiDB Cloud
app.post("/register", async (c) => {
  try {
    const body = await c.req.json();

    // Generate a client ID for this registration
    // In a real implementation, you might store this in a database
    const clientId = `mcp_${generateRandomString(16)}`;

    return c.json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      // No client_secret for public clients (MCP clients are typically public)
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
// MCP client redirects user here, we redirect to TiDB Cloud
app.get("/authorize", (c) => {
  const clientId = c.req.query("client_id");
  const redirectUri = c.req.query("redirect_uri");
  const responseType = c.req.query("response_type");
  const state = c.req.query("state");
  const codeChallenge = c.req.query("code_challenge");
  const codeChallengeMethod = c.req.query("code_challenge_method") || "plain";

  // Validate required parameters
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

  // Check if OAuth is configured on the server
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

  // Generate our own state to track this authorization
  const internalState = generateRandomString(32);

  // Store the client's redirect_uri and PKCE challenge so we can use them in callback
  authorizationStates.set(internalState, {
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    clientId: clientId || "unknown",
    createdAt: Date.now(),
  });

  // Clean up old states periodically
  cleanupExpiredStates();

  // Build TiDB Cloud authorization URL
  const host = c.req.header("host") || config.server.serverHost;
  const scheme = c.req.header("x-forwarded-proto") || "https";
  const ourCallbackUri = `${scheme}://${host}/callback`;

  const tidbAuthUrl = new URL(
    TIDB_OAUTH_ENDPOINTS[config.environment].authorize,
  );
  tidbAuthUrl.searchParams.set("client_id", serverClientId);
  tidbAuthUrl.searchParams.set("redirect_uri", ourCallbackUri);
  tidbAuthUrl.searchParams.set("scope", OAUTH_SCOPE);
  tidbAuthUrl.searchParams.set("response_type", "code");
  // Pass both our internal state and the client's original state
  tidbAuthUrl.searchParams.set(
    "state",
    state ? `${internalState}:${state}` : internalState,
  );

  return c.redirect(tidbAuthUrl.toString());
});

// ============================================================
// OAuth Callback (receives code from TiDB Cloud)
// ============================================================
app.get("/callback", async (c) => {
  const code = c.req.query("code");
  const stateParam = c.req.query("state");
  const error = c.req.query("error");
  const errorDescription = c.req.query("error_description");

  if (error) {
    // Find the original redirect_uri from state if possible
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

  // Parse state - format is "internalState" or "internalState:clientState"
  const [internalState, ...clientStateParts] = stateParam.split(":");
  const clientState = clientStateParts.join(":"); // Rejoin in case client state had colons

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
    // Exchange code with TiDB Cloud
    const tokenUrl = TIDB_OAUTH_ENDPOINTS[config.environment].token;
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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

    // Generate our own authorization code to give to the MCP client
    const ourAuthCode = generateRandomString(32);

    // Store the tokens associated with this code
    authorizationCodes.set(ourAuthCode, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      redirectUri: stateData.redirectUri,
      codeChallenge: stateData.codeChallenge,
      codeChallengeMethod: stateData.codeChallengeMethod,
      createdAt: Date.now(),
    });

    // Clean up the state
    authorizationStates.delete(internalState);

    // Redirect back to the MCP client with our authorization code
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
// MCP client exchanges authorization code for access token
app.post("/token", async (c) => {
  let body: Record<string, string>;

  const contentType = c.req.header("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await c.req.parseBody();
    body = formData as Record<string, string>;
  } else {
    body = await c.req.json();
  }

  const grantType = body.grant_type;

  if (grantType === "authorization_code") {
    const code = body.code;
    const redirectUri = body.redirect_uri;
    const codeVerifier = body.code_verifier;

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

    // Verify redirect_uri matches
    if (redirectUri && redirectUri !== codeData.redirectUri) {
      return c.json(
        { error: "invalid_grant", error_description: "redirect_uri mismatch" },
        400,
      );
    }

    // Verify PKCE if code_challenge was provided during authorization
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
        // SHA-256 hash, base64url encoded
        const encoder = new TextEncoder();
        const data = encoder.encode(codeVerifier);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = new Uint8Array(hashBuffer);
        computedChallenge = btoa(String.fromCharCode(...hashArray))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
      } else {
        // Plain
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

    // Code is valid - return the TiDB Cloud access token
    // Clean up the code (single use)
    authorizationCodes.delete(code);

    return c.json({
      access_token: codeData.accessToken,
      token_type: "Bearer",
      expires_in: codeData.expiresIn,
      refresh_token: codeData.refreshToken,
    });
  } else if (grantType === "refresh_token") {
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

    // Forward refresh request to TiDB Cloud
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: serverClientId,
          client_secret: serverClientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error("TiDB Cloud token refresh failed:", errorText);
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
  } else {
    return c.json(
      {
        error: "unsupported_grant_type",
        error_description: `Grant type '${grantType}' not supported`,
      },
      400,
    );
  }
});

// ============================================================
// Legacy OAuth endpoints (for backward compatibility)
// ============================================================
app.get("/oauth/login", (c) => {
  // Redirect to the new authorize endpoint
  const host = c.req.header("host") || config.server.serverHost;
  const scheme = c.req.header("x-forwarded-proto") || "https";
  return c.redirect(
    `${scheme}://${host}/authorize?client_id=legacy&redirect_uri=${encodeURIComponent(`${scheme}://${host}/oauth/callback`)}&response_type=code`,
  );
});

app.get("/oauth/callback", async (c) => {
  const code = c.req.query("code");
  const error = c.req.query("error");

  if (error) {
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>OAuth Error</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>Authorization Failed</h1>
          <p>Error: ${error}</p>
          <a href="/oauth/login">Try again</a>
        </body>
      </html>
    `);
  }

  if (!code) {
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>OAuth Error</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>Authorization Failed</h1>
          <p>No authorization code received</p>
          <a href="/oauth/login">Try again</a>
        </body>
      </html>
    `);
  }

  // Exchange the code for token using our own token endpoint
  const host = c.req.header("host") || config.server.serverHost;
  const scheme = c.req.header("x-forwarded-proto") || "https";
  const redirectUri = `${scheme}://${host}/oauth/callback`;

  try {
    const tokenResponse = await fetch(`${scheme}://${host}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = (await tokenResponse.json()) as {
        error: string;
        error_description?: string;
      };
      return c.html(`
        <!DOCTYPE html>
        <html>
          <head><title>OAuth Error</title></head>
          <body style="font-family: system-ui; padding: 40px; text-align: center;">
            <h1>Token Exchange Failed</h1>
            <p>${errorData.error_description || errorData.error}</p>
            <a href="/oauth/login">Try again</a>
          </body>
        </html>
      `);
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token?: string;
    };

    // Display success page with token info
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>OAuth Success</title>
          <style>
            body { font-family: system-ui; padding: 40px; max-width: 800px; margin: 0 auto; }
            h1 { color: #02807d; }
            .token-box { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; word-break: break-all; }
            .label { font-weight: bold; color: #333; }
            code { background: #e0e0e0; padding: 2px 6px; border-radius: 4px; }
          </style>
        </head>
        <body>
          <h1>Authorization Successful!</h1>
          <p>You have successfully authorized the TiDB Cloud MCP Server.</p>

          <div class="token-box">
            <p class="label">Access Token:</p>
            <code>${tokenData.access_token}</code>
            <p class="label" style="margin-top: 15px;">Token Type:</p>
            <code>${tokenData.token_type}</code>
            <p class="label" style="margin-top: 15px;">Expires In:</p>
            <code>${tokenData.expires_in} seconds (${Math.round(tokenData.expires_in / 3600)} hours)</code>
          </div>

          <p>You can close this window. The MCP client will use this token automatically.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("OAuth callback error:", err);
    return c.html(`
      <!DOCTYPE html>
      <html>
        <head><title>OAuth Error</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>Authorization Failed</h1>
          <p>${err instanceof Error ? err.message : "Unknown error"}</p>
          <a href="/oauth/login">Try again</a>
        </body>
      </html>
    `);
  }
});

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: "Not Found",
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
    404,
  );
});

// Error handler
app.onError((err, c) => {
  console.error("Server error:", err);
  return c.json(
    {
      error: "Internal Server Error",
      message: err.message,
    },
    500,
  );
});

export default app;
