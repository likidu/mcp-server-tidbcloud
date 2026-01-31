/**
 * OAuth Token Endpoint
 * Directly handles POST /api/token without Hono to avoid body stream issues
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { authorizationCodes } from "../dist/oauth-state.js";
import { loadConfig, type Environment } from "../dist/config.js";

const config = loadConfig();

const TIDB_OAUTH_ENDPOINTS: Record<Environment, { token: string }> = {
  dev: { token: "https://oauth.dev.tidbcloud.com/v1/token" },
  prod: { token: "https://oauth.tidbcloud.com/v1/token" },
};

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseFormData(data: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of data.split("&")) {
    const [key, value] = pair.split("=");
    if (key) {
      result[decodeURIComponent(key)] = decodeURIComponent(value || "");
    }
  }
  return result;
}

async function computeS256Challenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(codeVerifier),
  );
  return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Content-Type", "application/json");

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  try {
    const bodyText = await readBody(req);
    const contentType = req.headers["content-type"] || "";

    let body: Record<string, string>;
    if (contentType.includes("application/x-www-form-urlencoded")) {
      body = parseFormData(bodyText);
    } else {
      body = bodyText ? JSON.parse(bodyText) : {};
    }

    const grantType = body.grant_type;

    // Handle authorization_code grant
    if (grantType === "authorization_code") {
      const { code, redirect_uri: redirectUri, code_verifier: codeVerifier } = body;

      if (!code) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "invalid_request", error_description: "Missing code" }));
        return;
      }

      const codeData = authorizationCodes.get(code);
      if (!codeData) {
        res.statusCode = 400;
        res.end(JSON.stringify({
          error: "invalid_grant",
          error_description: "Invalid or expired authorization code",
        }));
        return;
      }

      if (redirectUri && redirectUri !== codeData.redirectUri) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "invalid_grant", error_description: "redirect_uri mismatch" }));
        return;
      }

      // Verify PKCE
      if (codeData.codeChallenge) {
        if (!codeVerifier) {
          res.statusCode = 400;
          res.end(JSON.stringify({
            error: "invalid_request",
            error_description: "code_verifier required",
          }));
          return;
        }

        let computedChallenge: string;
        if (codeData.codeChallengeMethod === "S256") {
          computedChallenge = await computeS256Challenge(codeVerifier);
        } else {
          computedChallenge = codeVerifier;
        }

        if (computedChallenge !== codeData.codeChallenge) {
          res.statusCode = 400;
          res.end(JSON.stringify({
            error: "invalid_grant",
            error_description: "code_verifier mismatch",
          }));
          return;
        }
      }

      authorizationCodes.delete(code);

      res.statusCode = 200;
      res.end(JSON.stringify({
        access_token: codeData.accessToken,
        token_type: "Bearer",
        expires_in: codeData.expiresIn,
        refresh_token: codeData.refreshToken,
      }));
      return;
    }

    // Handle refresh_token grant
    if (grantType === "refresh_token") {
      const refreshToken = body.refresh_token;

      if (!refreshToken) {
        res.statusCode = 400;
        res.end(JSON.stringify({
          error: "invalid_request",
          error_description: "Missing refresh_token",
        }));
        return;
      }

      const serverClientId = config.oauth?.clientId;
      const serverClientSecret = config.oauth?.clientSecret;

      if (!serverClientId || !serverClientSecret) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "server_error", error_description: "OAuth not configured" }));
        return;
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
          console.error("TiDB Cloud token refresh failed:", await tokenResponse.text());
          res.statusCode = 400;
          res.end(JSON.stringify({
            error: "invalid_grant",
            error_description: "Failed to refresh token",
          }));
          return;
        }

        const tokenData = (await tokenResponse.json()) as {
          access_token: string;
          token_type: string;
          expires_in: number;
          refresh_token?: string;
        };

        res.statusCode = 200;
        res.end(JSON.stringify({
          access_token: tokenData.access_token,
          token_type: "Bearer",
          expires_in: tokenData.expires_in,
          refresh_token: tokenData.refresh_token || refreshToken,
        }));
        return;
      } catch (err) {
        console.error("Token refresh error:", err);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "server_error", error_description: "Failed to refresh token" }));
        return;
      }
    }

    // Unsupported grant type
    res.statusCode = 400;
    res.end(JSON.stringify({
      error: "unsupported_grant_type",
      error_description: `Grant type '${grantType}' not supported`,
    }));
  } catch (err) {
    res.statusCode = 400;
    res.end(JSON.stringify({
      error: "invalid_request",
      error_description: err instanceof Error ? err.message : "Invalid request",
    }));
  }
}
