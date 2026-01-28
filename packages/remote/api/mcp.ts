/**
 * MCP Serverless Function for Vercel
 * Uses @modelcontextprotocol/sdk with streamable HTTP transport
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

// Get credentials from environment
const publicKey = process.env.TIDB_CLOUD_PUBLIC_KEY;
const privateKey = process.env.TIDB_CLOUD_PRIVATE_KEY;

// Create API client
function getClient() {
  if (!publicKey || !privateKey) {
    return null;
  }
  return new TiDBCloudClient({
    publicKey,
    privateKey,
    apiBaseUrl: "https://serverless.tidbapi.com",
  });
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

// Create and configure MCP server
function createServer(): McpServer {
  const server = new McpServer({
    name: "tidbcloud-mcp-server",
    version: "0.1.0",
  });

  const client = getClient();
  const databaseConfig = getDatabaseConfig();

  if (client) {
    registerRegionTools(server, client);
    registerClusterTools(server, client);
    registerBranchTools(server, client);
  }

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");

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

  try {
    const server = createServer();

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
