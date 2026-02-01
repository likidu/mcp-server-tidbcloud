/**
 * MCP Serverless Function for Vercel
 *
 * Authentication:
 * - Supports OAuth 2.1 per MCP specification
 * - Users authenticate via /authorize -> TiDB Cloud OAuth -> /callback -> /token
 * - Access token is passed in Authorization: Bearer <token> header
 * - Returns 401 if no valid token is provided (triggers OAuth flow in MCP clients)
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  McpServer,
  StreamableHTTPServerTransport,
} from "@likidu/mcp-server-tidbcloud/mcp";
import {
  registerClusterTools,
  registerBranchTools,
  registerRegionTools,
  registerDatabaseTools,
} from "@likidu/mcp-server-tidbcloud/tools";
import { TiDBCloudClient } from "@likidu/mcp-server-tidbcloud/api";
import type { Config, Environment } from "@likidu/mcp-server-tidbcloud/config";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// ============================================================
// Constants
// ============================================================

const API_BASE_URLS: Record<Environment, string> = {
  prod: "https://serverless.tidbapi.com",
  dev: "https://serverless.dev.tidbapi.com",
};

// ============================================================
// Rate Limiting
// ============================================================

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
      limiter: Ratelimit.slidingWindow(100, "1 m"), // 100 requests per minute
      prefix: "ratelimit:mcp",
    });
    return ratelimit;
  } catch {
    return null;
  }
}

function getClientIdentifier(req: VercelRequest): string {
  // Use Bearer token if available
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    return `token:${token.substring(7, 23)}`;
  }

  // Fall back to IP
  const forwarded = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded?.split(",")[0]?.trim();
  return `ip:${ip || "anonymous"}`;
}

// ============================================================
// Helper Functions
// ============================================================

function getEnvironment(): Environment {
  return process.env.TIDB_CLOUD_ENV?.toLowerCase() === "dev" ? "dev" : "prod";
}

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function createClient(accessToken: string): TiDBCloudClient {
  const environment = getEnvironment();
  const config: Config = {
    environment,
    authMode: "oauth",
    oauth: {
      clientId: "",
      clientSecret: "",
      accessToken,
    },
    apiBaseUrl: process.env.TIDB_CLOUD_API_URL || API_BASE_URLS[environment],
  };
  return new TiDBCloudClient(config);
}

/**
 * Extract database configuration from request headers.
 * Users can pass credentials via mcp-remote --header flags:
 *   --header "X-TiDB-DB-Host:${TIDB_CLOUD_DB_HOST}"
 *   --header "X-TiDB-DB-User:${TIDB_CLOUD_DB_USER}"
 *   --header "X-TiDB-DB-Password:${TIDB_CLOUD_DB_PASSWORD}"
 */
function getDatabaseConfigFromHeaders(req: VercelRequest) {
  const host = req.headers["x-tidb-db-host"];
  const username = req.headers["x-tidb-db-user"];
  const password = req.headers["x-tidb-db-password"];

  // All three are required for a valid database config
  if (!host || !username || !password) return undefined;

  return {
    host: Array.isArray(host) ? host[0] : host,
    username: Array.isArray(username) ? username[0] : username,
    password: Array.isArray(password) ? password[0] : password,
  };
}

function createServer(accessToken: string, req: VercelRequest): McpServer {
  const server = new McpServer({
    name: "tidbcloud-mcp-server",
    version: "0.1.0",
  });

  const client = createClient(accessToken);
  const dbConfig = getDatabaseConfigFromHeaders(req);

  registerRegionTools(server, client);
  registerClusterTools(server, client);
  registerBranchTools(server, client);
  registerDatabaseTools(server, dbConfig);

  return server;
}

// Handler for incoming requests
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, mcp-session-id, X-TiDB-DB-Host, X-TiDB-DB-User, X-TiDB-DB-Password",
  );

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // Rate limiting
  const limiter = getRatelimit();
  if (limiter) {
    try {
      const identifier = getClientIdentifier(req);
      const { success, limit, remaining, reset } =
        await limiter.limit(identifier);

      res.setHeader("X-RateLimit-Limit", limit.toString());
      res.setHeader("X-RateLimit-Remaining", remaining.toString());
      res.setHeader("X-RateLimit-Reset", reset.toString());

      if (!success) {
        const retryAfter = Math.ceil((reset - Date.now()) / 1000);
        res.setHeader("Retry-After", retryAfter.toString());
        res.status(429).json({
          error: "too_many_requests",
          error_description: "Rate limit exceeded. Please try again later.",
          retry_after: retryAfter,
        });
        return;
      }
    } catch (error) {
      // Log but don't block on rate limit errors
      console.error("[ratelimit] Error:", error);
    }
  }

  // Only handle POST for MCP requests (stateless mode)
  if (req.method !== "POST") {
    res
      .status(405)
      .json({ error: "Method not allowed. Use POST for MCP requests." });
    return;
  }

  // Extract Bearer token from Authorization header
  const authHeader = req.headers.authorization;
  const accessToken = extractBearerToken(
    Array.isArray(authHeader) ? authHeader[0] : authHeader,
  );

  // Return 401 if no valid token - this triggers OAuth flow in MCP clients
  if (!accessToken) {
    // Get the base URL for resource metadata
    const host = req.headers.host || "mcp-server-tidbcloud-remote.vercel.app";
    const scheme = req.headers["x-forwarded-proto"] || "https";
    const baseUrl = `${scheme}://${host}`;

    // WWW-Authenticate header with resource_metadata triggers OAuth flow in mcp-remote
    res.setHeader(
      "WWW-Authenticate",
      `Bearer error="invalid_token", error_description="No authorization provided", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
    );
    res.status(401).json({
      error: "invalid_token",
      error_description: "No authorization provided",
    });
    return;
  }

  try {
    const server = createServer(accessToken, req);

    // Create transport for this request (stateless - no session management)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    // Connect server to transport
    await server.connect(transport);

    // handleRequest writes directly to res
    // Cast req/res to Node.js types since Vercel extends them
    await transport.handleRequest(
      req as unknown as import("http").IncomingMessage,
      res as unknown as import("http").ServerResponse,
      req.body, // Pass pre-parsed body
    );
  } catch (error) {
    console.error("MCP request error:", error);
    // Only send error if headers not already sent
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message:
            error instanceof Error ? error.message : "Internal server error",
        },
        id: null,
      });
    }
  }
}
