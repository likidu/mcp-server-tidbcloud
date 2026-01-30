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

// ============================================================
// Constants
// ============================================================

const API_BASE_URLS: Record<Environment, string> = {
  prod: "https://serverless.tidbapi.com",
  dev: "https://serverless.dev.tidbapi.com",
};

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

function getDatabaseConfig() {
  if (!process.env.TIDB_CLOUD_DB_HOST) return undefined;
  return {
    host: process.env.TIDB_CLOUD_DB_HOST,
    username: process.env.TIDB_CLOUD_DB_USER || "",
    password: process.env.TIDB_CLOUD_DB_PASSWORD || "",
    database: process.env.TIDB_CLOUD_DB_NAME,
  };
}

function createServer(accessToken: string): McpServer {
  const server = new McpServer({
    name: "tidbcloud-mcp-server",
    version: "0.1.0",
  });

  const client = createClient(accessToken);
  registerRegionTools(server, client);
  registerClusterTools(server, client);
  registerBranchTools(server, client);
  registerDatabaseTools(server, getDatabaseConfig());

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
    "Content-Type, Authorization, mcp-session-id",
  );

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
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
    const server = createServer(accessToken);

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
