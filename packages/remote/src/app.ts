/**
 * TiDB Cloud MCP Server - Remote/Hosted Version
 *
 * A Hono-based MCP server supporting Streamable HTTP transport
 * and OAuth 2.1 authentication for TiDB Cloud.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { loadConfig, validateConfig } from "./config.js";
import { createMcpHandler } from "./mcp/handler.js";
import { createProtectedResourceMetadataHandler } from "./oauth/metadata.js";
import {
  createAuthorizeHandler,
  createCallbackHandler,
} from "./oauth/callback.js";
import { createAuthMiddleware } from "./oauth/middleware.js";
import { getLandingPageHtml } from "./landing.js";
import { rateLimiter } from "./middleware/rateLimit.js";
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

// Rate limiting for MCP endpoint (100 requests per minute per IP)
app.use(
  "/mcp",
  rateLimiter({
    windowMs: 60 * 1000,
    max: 100,
    message: "Too many requests to MCP endpoint, please try again later",
  }),
);

// CORS configuration for MCP clients
app.use(
  "*",
  cors({
    origin: "*", // MCP clients may come from anywhere
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "Accept",
      "mcp-session-id",
      "mcp-protocol-version",
      "Last-Event-ID",
      "Origin",
    ],
    exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
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

// OAuth Protected Resource Metadata (RFC 9728)
// This tells MCP clients how to authenticate
app.get(
  "/.well-known/oauth-protected-resource",
  createProtectedResourceMetadataHandler(config),
);

// Also support the path-based metadata endpoint
app.get(
  "/.well-known/oauth-protected-resource/mcp",
  createProtectedResourceMetadataHandler(config),
);

// OAuth endpoints
app.get("/oauth/authorize", createAuthorizeHandler(config));
app.get("/oauth/callback", createCallbackHandler(config));

// MCP endpoint (Streamable HTTP transport)
// For Phase 1 (local development), we skip auth to test with API keys
const mcpHandler = createMcpHandler(config);

// In production with OAuth, we'd use:
// app.all("/mcp", createAuthMiddleware(config), mcpHandler);

// For now, allow unauthenticated access for testing
// Use app.all to handle GET, POST, DELETE in one route
app.all("/mcp", mcpHandler);

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
    description: "MCP server for TiDB Cloud with OAuth 2.1 support",
    endpoints: {
      mcp: `${baseUrl}/mcp`,
      health: `${baseUrl}/health`,
      oauth: {
        authorize: `${baseUrl}/oauth/authorize`,
        callback: `${baseUrl}/oauth/callback`,
      },
      metadata: `${baseUrl}/.well-known/oauth-protected-resource`,
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
