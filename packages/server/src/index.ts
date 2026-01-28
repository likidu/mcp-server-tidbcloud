#!/usr/bin/env node
/**
 * TiDB Cloud MCP Server
 *
 * An MCP server that provides tools for interacting with TiDB Cloud API,
 * enabling LLMs to manage TiDB Cloud resources like branches.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initializeServer } from "./server.js";

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    // Initialize the MCP server
    const server = initializeServer();

    // Create stdio transport for local execution
    const transport = new StdioServerTransport();

    // Connect and start serving
    await server.connect(transport);

    // Log to stderr (stdout is reserved for MCP protocol)
    console.error("TiDB Cloud MCP server running via stdio");
  } catch (error) {
    console.error(
      "Failed to start MCP server:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

// Run the server
main();
