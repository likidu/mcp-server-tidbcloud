/**
 * MCP Serverless Function for Vercel
 * Uses mcp-handler package for proper serverless compatibility
 */

import { createMcpHandler } from "mcp-handler";
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

if (!publicKey || !privateKey) {
  console.error("TIDB_CLOUD_PUBLIC_KEY and TIDB_CLOUD_PRIVATE_KEY must be set");
}

// Create API client
const client =
  publicKey && privateKey
    ? new TiDBCloudClient({
        publicKey,
        privateKey,
        apiBaseUrl: "https://serverless.tidbapi.com",
      })
    : null;

// Database config (optional)
const databaseConfig = process.env.TIDB_CLOUD_DB_HOST
  ? {
      host: process.env.TIDB_CLOUD_DB_HOST,
      username: process.env.TIDB_CLOUD_DB_USER || "",
      password: process.env.TIDB_CLOUD_DB_PASSWORD || "",
      database: process.env.TIDB_CLOUD_DB_NAME,
    }
  : undefined;

const handler = createMcpHandler(
  (server) => {
    try {
      if (!client) {
        console.error("TiDB Cloud client not initialized - missing API keys");
        return;
      }

      // Register all tools
      console.log("Registering region tools...");
      registerRegionTools(server, client);
      console.log("Registering cluster tools...");
      registerClusterTools(server, client);
      console.log("Registering branch tools...");
      registerBranchTools(server, client);
      console.log("Registering database tools...");
      registerDatabaseTools(server, databaseConfig);
      console.log("All tools registered successfully");
    } catch (error) {
      console.error("Error registering tools:", error);
      throw error;
    }
  },
  {
    serverInfo: {
      name: "tidbcloud-mcp-server",
      version: "0.1.0",
    },
  },
  {
    basePath: "/mcp",
    verboseLogs: true,
  },
);

// Export for Vercel serverless functions
export const GET = handler;
export const POST = handler;
export const DELETE = handler;

// Default export for compatibility
export default handler;
