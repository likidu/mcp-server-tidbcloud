/**
 * OAuth Token Endpoint
 * Directly handles POST /api/token without Hono to avoid body stream issues
 */

/// <reference lib="dom" />

import type { IncomingMessage, ServerResponse } from "node:http";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { getStore } from "../dist/store/index.js";
import { loadConfig, type Environment } from "../dist/config.js";

const config = loadConfig();

// Rate limiting for token endpoint (strict: 20 requests per minute)
let ratelimit: Ratelimit | null = null;

function getRatelimit(): Ratelimit | null {
  if (ratelimit) return ratelimit;

  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }

  try {
    ratelimit = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(20, "1 m"),
      prefix: "ratelimit:token",
      analytics: true,
    });
    return ratelimit;
  } catch (error) {
    console.error("Failed to initialize rate limiter:", error);
    return null;
  }
}

function getClientIdentifier(req: IncomingMessage): string {
  // Try to get client IP from various headers (Vercel/proxy scenarios)
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const ip = Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded.split(",")[0];
    return ip?.trim() || "unknown";
  }

  const realIp = req.headers["x-real-ip"];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  return "unknown";
}

const TIDB_OAUTH_ENDPOINTS: Record<Environment, { token: string }> = {
  dev: { token: "https://oauth.dev.tidbcloud.com/v1/token" },
  prod: { token: "https://oauth.tidbcloud.com/v1/token" },
};

/**
 * Device Code grant type (RFC 8628)
 */
const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days

function generateRandomString(length: number): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join("");
}

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

  // Apply rate limiting
  const limiter = getRatelimit();
  if (limiter) {
    const identifier = getClientIdentifier(req);
    try {
      const { success, limit, remaining, reset } =
        await limiter.limit(identifier);

      res.setHeader("X-RateLimit-Limit", limit.toString());
      res.setHeader("X-RateLimit-Remaining", remaining.toString());
      res.setHeader("X-RateLimit-Reset", reset.toString());

      if (!success) {
        const retryAfter = Math.ceil((reset - Date.now()) / 1000);
        res.setHeader("Retry-After", retryAfter.toString());
        res.statusCode = 429;
        res.end(
          JSON.stringify({
            error: "too_many_requests",
            error_description: "Rate limit exceeded. Please try again later.",
            retry_after: retryAfter,
          }),
        );
        return;
      }
    } catch (error) {
      // If rate limiting fails, allow the request through
      console.error("Rate limiting error:", error);
    }
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
      const {
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      } = body;

      if (!code) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            error: "invalid_request",
            error_description: "Missing code",
          }),
        );
        return;
      }

      // Retrieve and delete the authorization code from Redis (one-time use)
      const store = getStore();
      const codeData = await store.getAndDeleteCode(code);
      if (!codeData) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Invalid or expired authorization code",
          }),
        );
        return;
      }

      if (redirectUri && redirectUri !== codeData.redirectUri) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "redirect_uri mismatch",
          }),
        );
        return;
      }

      // Verify PKCE
      if (codeData.codeChallenge) {
        if (!codeVerifier) {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              error: "invalid_request",
              error_description: "code_verifier required",
            }),
          );
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
          res.end(
            JSON.stringify({
              error: "invalid_grant",
              error_description: "code_verifier mismatch",
            }),
          );
          return;
        }
      }

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          access_token: codeData.accessToken,
          token_type: "Bearer",
          expires_in: codeData.expiresIn,
          refresh_token: codeData.refreshToken,
        }),
      );
      return;
    }

    // Handle refresh_token grant with token rotation
    if (grantType === "refresh_token") {
      const refreshToken = body.refresh_token;

      if (!refreshToken) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            error: "invalid_request",
            error_description: "Missing refresh_token",
          }),
        );
        return;
      }

      const serverClientId = config.oauth?.clientId;
      const serverClientSecret = config.oauth?.clientSecret;

      if (!serverClientId || !serverClientSecret) {
        res.statusCode = 500;
        res.end(
          JSON.stringify({
            error: "server_error",
            error_description: "OAuth not configured",
          }),
        );
        return;
      }

      // Look up and delete the refresh token (one-time use for rotation)
      const store = getStore();
      const tokenData = await store.getAndDeleteRefreshToken(refreshToken);
      if (!tokenData) {
        // Token not found - either invalid, expired, or already used (potential theft)
        console.warn(
          "Refresh token not found or already used:",
          refreshToken.substring(0, 8) + "...",
        );
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            error: "invalid_grant",
            error_description:
              "Invalid or expired refresh token. Please re-authenticate.",
          }),
        );
        return;
      }

      try {
        // Exchange with TiDB Cloud using the stored upstream refresh token
        const tokenUrl = TIDB_OAUTH_ENDPOINTS[config.environment].token;
        const tokenResponse = await fetch(tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: serverClientId,
            client_secret: serverClientSecret,
            grant_type: "refresh_token",
            refresh_token: tokenData.upstreamRefreshToken,
          }),
        });

        if (!tokenResponse.ok) {
          console.error(
            "TiDB Cloud token refresh failed:",
            await tokenResponse.text(),
          );
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              error: "invalid_grant",
              error_description:
                "Failed to refresh token with upstream provider",
            }),
          );
          return;
        }

        const newTokens = (await tokenResponse.json()) as {
          access_token: string;
          token_type: string;
          expires_in: number;
          refresh_token?: string;
        };

        // Issue a new rotated refresh token
        let newRefreshToken: string | undefined;
        const upstreamRefreshToken =
          newTokens.refresh_token || tokenData.upstreamRefreshToken;

        if (upstreamRefreshToken) {
          newRefreshToken = generateRandomString(32);
          await store.setRefreshToken(
            newRefreshToken,
            {
              upstreamRefreshToken,
              clientId: tokenData.clientId,
              issuedAt: Date.now(),
            },
            REFRESH_TOKEN_TTL,
          );
        }

        res.statusCode = 200;
        res.end(
          JSON.stringify({
            access_token: newTokens.access_token,
            token_type: "Bearer",
            expires_in: newTokens.expires_in,
            refresh_token: newRefreshToken,
          }),
        );
        return;
      } catch (err) {
        console.error("Token refresh error:", err);
        res.statusCode = 500;
        res.end(
          JSON.stringify({
            error: "server_error",
            error_description: "Failed to refresh token",
          }),
        );
        return;
      }
    }

    // Handle device_code grant (RFC 8628)
    if (grantType === DEVICE_CODE_GRANT_TYPE) {
      const deviceCode = body.device_code;

      if (!deviceCode) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            error: "invalid_request",
            error_description: "Missing device_code",
          }),
        );
        return;
      }

      const serverClientId = config.oauth?.clientId;
      const serverClientSecret = config.oauth?.clientSecret;

      if (!serverClientId || !serverClientSecret) {
        res.statusCode = 500;
        res.end(
          JSON.stringify({
            error: "server_error",
            error_description: "OAuth not configured",
          }),
        );
        return;
      }

      try {
        // Forward to TiDB Cloud's token endpoint with device_code grant
        const tokenUrl = TIDB_OAUTH_ENDPOINTS[config.environment].token;
        const tokenResponse = await fetch(tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: serverClientId,
            client_secret: serverClientSecret,
            grant_type: DEVICE_CODE_GRANT_TYPE,
            device_code: deviceCode,
          }),
        });

        // Handle polling responses (authorization_pending, slow_down)
        if (!tokenResponse.ok) {
          const errorData = (await tokenResponse.json()) as {
            error: string;
            error_description?: string;
          };

          // Pass through authorization_pending and slow_down errors
          // These are expected during polling and client should retry
          if (
            errorData.error === "authorization_pending" ||
            errorData.error === "slow_down"
          ) {
            res.statusCode = 400;
            res.end(JSON.stringify(errorData));
            return;
          }

          // For other errors (expired_token, access_denied), pass through
          console.error(
            "[token] Device code token exchange failed:",
            errorData,
          );
          res.statusCode = tokenResponse.status;
          res.end(JSON.stringify(errorData));
          return;
        }

        // Success - user has authorized
        const tokenData = (await tokenResponse.json()) as {
          access_token: string;
          token_type: string;
          expires_in: number;
          refresh_token?: string;
        };

        // If TiDB Cloud returns a refresh token, store it with rotation support
        let ourRefreshToken: string | undefined;
        if (tokenData.refresh_token) {
          ourRefreshToken = generateRandomString(32);
          const store = getStore();
          await store.setRefreshToken(
            ourRefreshToken,
            {
              upstreamRefreshToken: tokenData.refresh_token,
              clientId: body.client_id || "device_code_client",
              issuedAt: Date.now(),
            },
            REFRESH_TOKEN_TTL,
          );
        }

        res.statusCode = 200;
        res.end(
          JSON.stringify({
            access_token: tokenData.access_token,
            token_type: "Bearer",
            expires_in: tokenData.expires_in,
            refresh_token: ourRefreshToken,
          }),
        );
        return;
      } catch (err) {
        console.error("[token] Device code error:", err);
        res.statusCode = 500;
        res.end(
          JSON.stringify({
            error: "server_error",
            error_description: "Failed to exchange device code",
          }),
        );
        return;
      }
    }

    // Unsupported grant type
    res.statusCode = 400;
    res.end(
      JSON.stringify({
        error: "unsupported_grant_type",
        error_description: `Grant type '${grantType}' not supported`,
      }),
    );
  } catch (err) {
    res.statusCode = 400;
    res.end(
      JSON.stringify({
        error: "invalid_request",
        error_description:
          err instanceof Error ? err.message : "Invalid request",
      }),
    );
  }
}
