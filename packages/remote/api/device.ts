/**
 * OAuth Device Authorization Endpoint (RFC 8628)
 * Handles POST /api/device/code for initiating device code flow
 */

/// <reference lib="dom" />

import type { IncomingMessage, ServerResponse } from "node:http";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { loadConfig, type Environment } from "../dist/config.js";

const config = loadConfig();

// Rate limiting for device authorization endpoint (strict: 20 requests per minute)
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
      prefix: "ratelimit:device",
      analytics: true,
    });
    return ratelimit;
  } catch (error) {
    console.error("Failed to initialize rate limiter:", error);
    return null;
  }
}

function getClientIdentifier(req: IncomingMessage): string {
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

/**
 * TiDB Cloud OAuth endpoints for Device Code flow
 */
const TIDB_DEVICE_CODE_ENDPOINTS: Record<
  Environment,
  { deviceAuthorization: string }
> = {
  dev: {
    deviceAuthorization:
      "https://oauth.dev.tidbcloud.com/v1/device_authorization",
  },
  prod: {
    deviceAuthorization: "https://oauth.tidbcloud.com/v1/device_authorization",
  },
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

  // Check OAuth configuration
  const serverClientId = config.oauth?.clientId;
  const serverClientSecret = config.oauth?.clientSecret;

  if (!serverClientId || !serverClientSecret) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        error: "server_error",
        error_description: "OAuth not configured on server",
      }),
    );
    return;
  }

  try {
    // Parse request body (optional - client_id from MCP client is informational only)
    const bodyText = await readBody(req);
    const contentType = req.headers["content-type"] || "";

    let body: Record<string, string> = {};
    if (bodyText) {
      if (contentType.includes("application/x-www-form-urlencoded")) {
        body = parseFormData(bodyText);
      } else if (contentType.includes("application/json")) {
        body = JSON.parse(bodyText);
      }
    }

    // Log the requesting client (informational)
    const mcpClientId = body.client_id || "unknown";
    console.log(
      `[device-code] Device authorization requested by: ${mcpClientId}`,
    );

    // Forward request to TiDB Cloud's device authorization endpoint
    const deviceAuthUrl =
      TIDB_DEVICE_CODE_ENDPOINTS[config.environment].deviceAuthorization;

    const response = await fetch(deviceAuthUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: serverClientId,
        scope: "org:owner",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[device-code] TiDB Cloud device authorization failed (${response.status}): ${errorText}`,
      );

      // Try to parse and forward the error from TiDB Cloud
      try {
        const errorJson = JSON.parse(errorText);
        res.statusCode = response.status;
        res.end(JSON.stringify(errorJson));
      } catch {
        res.statusCode = response.status;
        res.end(
          JSON.stringify({
            error: "server_error",
            error_description: `TiDB Cloud error: ${errorText}`,
          }),
        );
      }
      return;
    }

    // Return the device code response from TiDB Cloud
    const deviceCodeResponse = await response.json();
    res.statusCode = 200;
    res.end(JSON.stringify(deviceCodeResponse));
  } catch (err) {
    console.error("[device-code] Error:", err);
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        error: "server_error",
        error_description:
          err instanceof Error ? err.message : "Internal server error",
      }),
    );
  }
}
