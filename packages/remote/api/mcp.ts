/**
 * MCP Serverless Function for Vercel
 *
 * Authentication:
 * - Uses API Key authentication via custom headers
 * - Users provide TiDB Cloud API keys (public + private) via:
 *   - X-TiDB-API-Public-Key header
 *   - X-TiDB-API-Private-Key header
 * - Returns 401 if API keys are missing
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
// Vercel Configuration
// ============================================================

// Extend function timeout (default is 10s on Hobby, up to 60s on Pro)
export const config = {
  maxDuration: 60,
};

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

function createClient(publicKey: string, privateKey: string): TiDBCloudClient {
  const environment = getEnvironment();
  const config: Config = {
    environment,
    authMode: "digest",
    digest: {
      publicKey,
      privateKey,
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

function createServer(
  publicKey: string,
  privateKey: string,
  req: VercelRequest,
): McpServer {
  const server = new McpServer({
    name: "tidbcloud-mcp-server",
    version: "0.5.2",
  });

  const client = createClient(publicKey, privateKey);
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
    "Content-Type, mcp-session-id, X-TiDB-API-Public-Key, X-TiDB-API-Private-Key, X-TiDB-DB-Host, X-TiDB-DB-User, X-TiDB-DB-Password",
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

  // Extract API keys from custom headers
  const publicKeyHeader = req.headers["x-tidb-api-public-key"];
  const privateKeyHeader = req.headers["x-tidb-api-private-key"];

  const publicKey = Array.isArray(publicKeyHeader)
    ? publicKeyHeader[0]
    : publicKeyHeader;
  const privateKey = Array.isArray(privateKeyHeader)
    ? privateKeyHeader[0]
    : privateKeyHeader;

  // Return 401 if API keys are missing
  if (!publicKey || !privateKey) {
    res.status(401).json({
      error: "missing_api_keys",
      error_description:
        "TiDB Cloud API keys are required. " +
        "Provide X-TiDB-API-Public-Key and X-TiDB-API-Private-Key headers. " +
        "Get your API keys from TiDB Cloud console: Organization Settings > API Keys.",
    });
    return;
  }

  try {
    const environment = getEnvironment();
    console.log(
      `[mcp] Processing request, env=${environment}, publicKey=${publicKey.substring(0, 8)}...`,
    );

    const server = createServer(publicKey, privateKey, req);

    // Create transport for this request (stateless - no session management)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    // Connect server to transport
    await server.connect(transport);

    console.log("[mcp] Server connected, handling request...");

    // handleRequest writes directly to res
    // Cast req/res to Node.js types since Vercel extends them
    await transport.handleRequest(
      req as unknown as import("http").IncomingMessage,
      res as unknown as import("http").ServerResponse,
      req.body, // Pass pre-parsed body
    );

    console.log("[mcp] Request handled successfully");
  } catch (error) {
    console.error("[mcp] Request error:", error);
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
