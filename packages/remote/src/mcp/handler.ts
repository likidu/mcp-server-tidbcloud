/**
 * MCP Streamable HTTP Transport Handler
 *
 * Uses the MCP SDK's WebStandardStreamableHTTPServerTransport for proper
 * protocol handling.
 */

import type { Context } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  registerClusterTools,
  registerBranchTools,
  registerRegionTools,
  registerDatabaseTools,
} from "@likidu/mcp-server-tidbcloud/tools";
import { TiDBCloudClient } from "@likidu/mcp-server-tidbcloud/api";
import type { Config } from "../config.js";

/**
 * Creates an MCP server with tools registered based on credentials
 */
function createMcpServerWithTools(
  publicKey: string,
  privateKey: string,
  databaseConfig?: {
    host: string;
    username: string;
    password: string;
    database?: string;
  },
): McpServer {
  const server = new McpServer({
    name: "tidbcloud-mcp-server-remote",
    version: "0.1.0",
  });

  // Create API client with credentials
  const client = new TiDBCloudClient({
    publicKey,
    privateKey,
    apiBaseUrl: "https://serverless.tidbapi.com",
  });

  // Register all tools
  registerRegionTools(server, client);
  registerClusterTools(server, client);
  registerBranchTools(server, client);
  registerDatabaseTools(server, databaseConfig);

  return server;
}

/**
 * Creates the MCP handler for Hono
 */
export function createMcpHandler(config: Config) {
  // For API key mode, create a single shared server and transport
  let sharedServer: McpServer | null = null;
  let sharedTransport: WebStandardStreamableHTTPServerTransport | null = null;

  if (config.tidbCloud?.publicKey && config.tidbCloud?.privateKey) {
    // Create MCP server with tools
    sharedServer = createMcpServerWithTools(
      config.tidbCloud.publicKey,
      config.tidbCloud.privateKey,
      config.database,
    );

    // Create stateless transport (no session management needed for API key mode)
    sharedTransport = new WebStandardStreamableHTTPServerTransport({
      // Stateless mode - no sessionIdGenerator
      enableJsonResponse: true,
    });

    // Connect server to transport
    sharedServer.connect(sharedTransport).catch((err) => {
      console.error("Failed to connect MCP server to transport:", err);
    });
  }

  return async (c: Context) => {
    // If we have a shared transport (API key mode), use it directly
    if (sharedTransport) {
      return sharedTransport.handleRequest(c.req.raw);
    }

    // OAuth mode: need to handle per-session transports
    // For now, return an error since OAuth isn't fully implemented
    return c.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message:
            "OAuth mode not yet implemented. Please configure TIDB_PUBLIC_KEY and TIDB_PRIVATE_KEY.",
        },
        id: null,
      },
      500,
    );
  };
}
