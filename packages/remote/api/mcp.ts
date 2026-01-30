/**
 * MCP Serverless Function for Vercel
 * Uses @modelcontextprotocol/sdk with streamable HTTP transport
 *
 * Authentication:
 * - Supports OAuth 2.1 per MCP specification
 * - Users authenticate via /authorize -> TiDB Cloud OAuth -> /callback -> /token
 * - Access token is passed in Authorization: Bearer <token> header
 * - Returns 401 if no valid token is provided
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  registerClusterTools,
  registerBranchTools,
  registerRegionTools,
  registerDatabaseTools,
} from "@likidu/mcp-server-tidbcloud/tools";
import { TiDBCloudClient } from "@likidu/mcp-server-tidbcloud/api";
import type {
  Config,
  AuthMode,
  Environment,
} from "@likidu/mcp-server-tidbcloud/config";

/**
 * API base URLs for TiDB Cloud Serverless API
 */
const API_BASE_URLS: Record<Environment, string> = {
  prod: "https://serverless.tidbapi.com",
  dev: "https://serverless.dev.tidbapi.com",
};

/**
 * Get environment from env var (defaults to prod)
 */
function getEnvironment(): Environment {
  const envValue = process.env.TIDB_CLOUD_ENV?.toLowerCase();
  return envValue === "dev" ? "dev" : "prod";
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

/**
 * Create API client with the user's access token
 */
function createClientWithToken(accessToken: string): TiDBCloudClient {
  const environment = getEnvironment();
  const apiBaseUrl =
    process.env.TIDB_CLOUD_API_URL || API_BASE_URLS[environment];

  const config: Config = {
    environment,
    authMode: "oauth",
    oauth: {
      clientId: process.env.TIDB_CLOUD_OAUTH_CLIENT_ID || "",
      clientSecret: process.env.TIDB_CLOUD_OAUTH_CLIENT_SECRET || "",
      accessToken,
    },
    apiBaseUrl,
  };

  return new TiDBCloudClient(config);
}

// Database config (optional)
function getDatabaseConfig() {
  if (!process.env.TIDB_CLOUD_DB_HOST) {
    return undefined;
  }
  return {
    host: process.env.TIDB_CLOUD_DB_HOST,
    username: process.env.TIDB_CLOUD_DB_USER || "",
    password: process.env.TIDB_CLOUD_DB_PASSWORD || "",
    database: process.env.TIDB_CLOUD_DB_NAME,
  };
}

/**
 * Create and configure MCP server with user's access token
 */
function createServer(accessToken: string): McpServer {
  const server = new McpServer({
    name: "tidbcloud-mcp-server",
    version: "0.1.0",
  });

  const client = createClientWithToken(accessToken);
  const databaseConfig = getDatabaseConfig();

  registerRegionTools(server, client);
  registerClusterTools(server, client);
  registerBranchTools(server, client);
  registerDatabaseTools(server, databaseConfig);

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
    res.status(401).json({
      error: "unauthorized",
      error_description:
        "Authorization required. Please authenticate via OAuth.",
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
