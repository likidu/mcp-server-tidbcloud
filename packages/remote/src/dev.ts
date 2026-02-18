/**
 * Development server entry point (Node.js)
 *
 * Uses @hono/node-server to serve the Hono app locally.
 * All routes including /mcp are handled by the Hono app.
 */

import { serve } from "@hono/node-server";
import app from "./app.js";
import { loadConfig, validateConfig } from "./config.js";

const config = loadConfig();
validateConfig(config);

console.log("Starting TiDB Cloud MCP Server (Remote - Dev)...");
console.log(`Host: ${config.server.host}`);
console.log(`Port: ${config.server.port}`);
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

serve(
    {
        fetch: app.fetch,
        hostname: config.server.host,
        port: config.server.port,
    },
    (info) => {
        console.log(`Server running at http://${info.address}:${info.port}`);
    },
);
