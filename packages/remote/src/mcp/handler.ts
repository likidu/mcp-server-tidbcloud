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

// Session storage for stateful connections
const sessions = new Map<
  string,
  { server: McpServer; transport: WebStandardStreamableHTTPServerTransport }
>();

/**
 * Creates the MCP handler for Hono
 */
export function createMcpHandler(config: Config) {
  return async (c: Context) => {
    // Check if API keys are configured
    if (!config.tidbCloud?.publicKey || !config.tidbCloud?.privateKey) {
      return c.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message:
              "Server not configured. Please set TIDB_CLOUD_PUBLIC_KEY and TIDB_CLOUD_PRIVATE_KEY.",
          },
          id: null,
        },
        500,
      );
    }

    // Get or create session based on mcp-session-id header
    const sessionId = c.req.header("mcp-session-id");

    let server: McpServer;
    let transport: WebStandardStreamableHTTPServerTransport;

    if (sessionId && sessions.has(sessionId)) {
      // Reuse existing session
      const session = sessions.get(sessionId)!;
      server = session.server;
      transport = session.transport;
    } else {
      // Create new server and transport for this session
      server = createMcpServerWithTools(
        config.tidbCloud.publicKey,
        config.tidbCloud.privateKey,
        config.database,
      );

      transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        enableJsonResponse: true,
      });

      // Connect server to transport
      await server.connect(transport);

      // Store session if we have a session ID
      if (sessionId) {
        sessions.set(sessionId, { server, transport });
      }
    }

    // Handle the request
    return transport.handleRequest(c.req.raw);
  };
}
