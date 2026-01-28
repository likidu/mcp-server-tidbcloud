/**
 * Development server entry point
 *
 * Runs the Hono app with @hono/node-server for local development
 */

import { serve } from "@hono/node-server";
import app from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

console.log("Starting TiDB Cloud MCP Server (Remote)...");
console.log(`Host: ${config.server.host}`);
console.log(`Port: ${config.server.port}`);
console.log(`Server Host: ${config.server.serverHost}`);
console.log("");

if (config.tidbCloud?.publicKey) {
  console.log("API Key authentication: Configured");
} else {
  console.log("API Key authentication: Not configured");
}

if (config.database?.host) {
  console.log("Database connection: Configured");
} else {
  console.log("Database connection: Not configured");
}

console.log("");
console.log("Endpoints:");
console.log(`  Landing: http://${config.server.host}:${config.server.port}/`);
console.log(`  MCP: http://${config.server.host}:${config.server.port}/mcp`);
console.log(
  `  Health: http://${config.server.host}:${config.server.port}/health`,
);
console.log("");

const server = serve(
  {
    fetch: app.fetch,
    hostname: config.server.host,
    port: config.server.port,
  },
  (info) => {
    console.log(`Server running at http://${info.address}:${info.port}`);
  },
);

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
