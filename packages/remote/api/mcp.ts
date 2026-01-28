/**
 * MCP Serverless Function for Vercel
 * Uses @modelcontextprotocol/sdk with streamable HTTP transport
 */

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
async function handler(request: Request): Promise<Response> {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, mcp-session-id",
      },
    });
  }

  // Only handle POST for MCP requests (stateless mode)
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: "Method not allowed. Use POST for MCP requests.",
      }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }

  try {
    const server = createServer();

    // Create transport for this request (stateless - no session management)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
    });

    // Connect server to transport
    await server.connect(transport);

    // Handle the request
    const response = await transport.handleRequest(request);

    // Add CORS headers
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    console.error("MCP request error:", error);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message:
            error instanceof Error ? error.message : "Internal server error",
        },
        id: null,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }
}

// Export for Vercel serverless functions
export const GET = handler;
export const POST = handler;
export const DELETE = handler;
export const OPTIONS = handler;

// Default export for compatibility
export default handler;
