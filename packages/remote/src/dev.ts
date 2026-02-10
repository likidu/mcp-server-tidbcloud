/**
 * Development server entry point
 *
 * Creates a raw HTTP server that:
 * - Routes POST /mcp to the MCP handler (same as Vercel's api/mcp.ts)
 * - Routes everything else to the Hono app
 */

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handle } from "@hono/node-server/vercel";
import app from "./app.js";
import { loadConfig } from "./config.js";
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
import type {
  Config as ServerConfig,
  Environment,
} from "@likidu/mcp-server-tidbcloud/config";

const config = loadConfig();
const honoHandler = handle(app);

// ============================================================
// MCP Handler (mirrors api/mcp.ts for local development)
// ============================================================

const API_BASE_URLS: Record<Environment, string> = {
  prod: "https://serverless.tidbapi.com",
  dev: "https://serverless.dev.tidbapi.com",
};

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const val = req.headers[name.toLowerCase()];
  return Array.isArray(val) ? val[0] : val;
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, mcp-session-id, X-TiDB-API-Public-Key, X-TiDB-API-Private-Key, X-TiDB-DB-Host, X-TiDB-DB-User, X-TiDB-DB-Password",
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Method not allowed. Use POST for MCP requests.",
      }),
    );
    return;
  }

  const publicKey = getHeader(req, "x-tidb-api-public-key");
  const privateKey = getHeader(req, "x-tidb-api-private-key");

  if (!publicKey || !privateKey) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "missing_api_keys",
        error_description:
          "TiDB Cloud API keys are required. " +
          "Provide X-TiDB-API-Public-Key and X-TiDB-API-Private-Key headers.",
      }),
    );
    return;
  }

  const environment = config.environment;
  const serverConfig: ServerConfig = {
    environment,
    authMode: "digest",
    digest: { publicKey, privateKey },
    apiBaseUrl: config.apiBaseUrl || API_BASE_URLS[environment],
  };

  const mcpServer = new McpServer({
    name: "tidbcloud-mcp-server",
    version: "0.5.2",
  });

  const client = new TiDBCloudClient(serverConfig);

  // Extract DB config from headers
  const dbHost = getHeader(req, "x-tidb-db-host");
  const dbUser = getHeader(req, "x-tidb-db-user");
  const dbPassword = getHeader(req, "x-tidb-db-password");
  const dbConfig =
    dbHost && dbUser && dbPassword
      ? { host: dbHost, username: dbUser, password: dbPassword }
      : undefined;

  registerRegionTools(mcpServer, client);
  registerClusterTools(mcpServer, client);
  registerBranchTools(mcpServer, client);
  registerDatabaseTools(mcpServer, dbConfig);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await mcpServer.connect(transport);
  await transport.handleRequest(req, res);
}

// ============================================================
// HTTP Server
// ============================================================

console.log("Starting TiDB Cloud MCP Server (Remote)...");
console.log(`Host: ${config.server.host}`);
console.log(`Port: ${config.server.port}`);
console.log(`Server Host: ${config.server.serverHost}`);
console.log("");
console.log("Authentication: API Key (via request headers)");
console.log(`API Base URL: ${config.apiBaseUrl}`);
console.log("");
console.log("Endpoints:");
console.log(`  Landing: http://${config.server.host}:${config.server.port}/`);
console.log(`  MCP: http://${config.server.host}:${config.server.port}/mcp`);
console.log(
  `  Health: http://${config.server.host}:${config.server.port}/health`,
);
console.log("");

const server = createServer(async (req, res) => {
  const url = req.url || "/";

  // Route /mcp requests to the MCP handler
  if (url === "/mcp" || url.startsWith("/mcp/") || url.startsWith("/mcp?")) {
    try {
      await handleMcp(req, res);
    } catch (error) {
      console.error("[mcp] Error:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message:
                error instanceof Error
                  ? error.message
                  : "Internal server error",
            },
            id: null,
          }),
        );
      }
    }
  } else {
    // Route everything else to Hono
    honoHandler(req, res);
  }
});

server.listen(config.server.port, config.server.host, () => {
  console.log(
    `Server running at http://${config.server.host}:${config.server.port}`,
  );
});

// Handle server errors
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nError: Port ${config.server.port} is already in use.`);
    console.error(`Try: lsof -ti:${config.server.port} | xargs kill -9`);
    console.error(`Or set a different port: PORT=3001 pnpm dev\n`);
  } else {
    console.error("Server error:", err);
  }
  process.exit(1);
});
