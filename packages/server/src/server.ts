/**
 * MCP Server configuration and setup
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TiDBCloudClient } from "./api/client.js";
import { loadConfig, validateConfig, type Config } from "./config.js";
import {
    registerBranchTools,
    registerClusterTools,
    registerRegionTools,
    registerDatabaseTools,
} from "./tools/index.js";

/**
 * Server version - should match package.json
 */
const SERVER_VERSION = "0.5.2";

/**
 * Server name following MCP naming convention
 */
const SERVER_NAME = "tidbcloud-mcp-server";

/**
 * Creates and configures the MCP server instance
 */
export function createServer(config: Config): McpServer {
    // Validate configuration
    validateConfig(config);

    // Create MCP server
    const server = new McpServer({
        name: SERVER_NAME,
        version: SERVER_VERSION,
    });

    // Create API client
    const client = new TiDBCloudClient(config);

    // Register tools
    registerRegionTools(server, client);
    registerClusterTools(server, client);
    registerBranchTools(server, client);
    registerDatabaseTools(server, config.database);

    return server;
}

/**
 * Initializes the server with configuration from environment
 */
export function initializeServer(): McpServer {
    const config = loadConfig();
    return createServer(config);
}
