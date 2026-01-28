/**
 * TiDB Cloud MCP Server - Remote/Hosted Version
 *
 * Hono app for non-MCP endpoints (landing page, health check, etc.)
 * MCP endpoint is handled separately by api/mcp/route.ts using mcp-handler
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { loadConfig, validateConfig } from "./config.js";
import { getLandingPageHtml } from "./landing.js";
import {
  httpsEnforcement,
  securityHeaders,
  requestId,
} from "./middleware/security.js";

// Load and validate configuration
const config = loadConfig();

// Validate config (will throw if invalid, warn for missing optional)
try {
  validateConfig(config);
} catch (error) {
  if (process.env.NODE_ENV === "production") {
    console.error(error);
    process.exit(1);
  } else {
    // In development, just warn
    console.warn("[config] Validation warning:", (error as Error).message);
  }
}

// Create Hono app
const app = new Hono();

// Security middleware (applied first)
app.use("*", requestId());
app.use("*", httpsEnforcement());
app.use("*", securityHeaders());

// Request logging
app.use("*", logger());

// CORS configuration
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "Accept", "Origin"],
    maxAge: 86400,
  }),
);

// Health check endpoint
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "0.1.0",
  });
});

// Root endpoint - Landing page
app.get("/", (c) => {
  const host = c.req.header("host") || config.server.serverHost;
  const scheme = c.req.header("x-forwarded-proto") || "http";
  const baseUrl = `${scheme}://${host}`;

  // Return HTML landing page
  return c.html(getLandingPageHtml(baseUrl));
});

// API info endpoint (JSON)
app.get("/api", (c) => {
  const host = c.req.header("host") || config.server.serverHost;
  const scheme = c.req.header("x-forwarded-proto") || "http";
  const baseUrl = `${scheme}://${host}`;

  return c.json({
    name: "TiDB Cloud MCP Server",
    version: "0.1.0",
    description: "MCP server for TiDB Cloud",
    endpoints: {
      mcp: `${baseUrl}/mcp`,
      health: `${baseUrl}/health`,
    },
    documentation: "https://github.com/likidu/mcp-server-tidbcloud",
  });
});

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: "Not Found",
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
    404,
  );
});

// Error handler
app.onError((err, c) => {
  console.error("Server error:", err);
  return c.json(
    {
      error: "Internal Server Error",
      message: err.message,
    },
    500,
  );
});

export default app;
