/**
 * TiDB Cloud MCP Server - Remote/Hosted Version
 *
 * This server uses API Key authentication.
 * Users provide their TiDB Cloud API keys (public + private) via custom headers:
 *   - X-TiDB-API-Public-Key
 *   - X-TiDB-API-Private-Key
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

// Version is injected at build time or read from environment
// This avoids runtime require() of package.json which fails in Vercel serverless
const VERSION = process.env.npm_package_version || "0.5.2";

// ============================================================
// Configuration
// ============================================================

const config = loadConfig();

try {
  validateConfig(config);
} catch (error) {
  if (process.env.NODE_ENV === "production") {
    console.error(error);
    process.exit(1);
  } else {
    console.warn("[config] Validation warning:", (error as Error).message);
  }
}

// ============================================================
// Hono App Setup
// ============================================================

const app = new Hono();

app.use("*", requestId());
app.use("*", httpsEnforcement());
app.use("*", securityHeaders());
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Accept",
      "Origin",
      "mcp-session-id",
      "X-TiDB-API-Public-Key",
      "X-TiDB-API-Private-Key",
      "X-TiDB-DB-Host",
      "X-TiDB-DB-User",
      "X-TiDB-DB-Password",
    ],
    maxAge: 86400,
  }),
);

// ============================================================
// General Endpoints
// ============================================================

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: VERSION,
  });
});

app.get("/", (c) => {
  const host = c.req.header("host") || config.server.serverHost;
  const scheme = c.req.header("x-forwarded-proto") || "https";
  return c.html(getLandingPageHtml(`${scheme}://${host}`, VERSION));
});

// ============================================================
// Skill Documentation (for OpenClaw and other AI agents)
// ============================================================

import { getSkillContent } from "./skill.js";

app.get("/skill.md", (c) => {
  c.header("Content-Type", "text/markdown; charset=utf-8");
  return c.body(getSkillContent());
});

app.get("/api", (c) => {
  const host = c.req.header("host") || config.server.serverHost;
  const scheme = c.req.header("x-forwarded-proto") || "https";
  const baseUrl = `${scheme}://${host}`;

  return c.json({
    name: "TiDB Cloud MCP Server",
    version: VERSION,
    description:
      "MCP server for TiDB Cloud with API Key authentication",
    endpoints: {
      mcp: `${baseUrl}/mcp`,
      health: `${baseUrl}/health`,
    },
    documentation: "https://github.com/likidu/mcp-server-tidbcloud",
  });
});

// ============================================================
// Error Handlers
// ============================================================

app.notFound((c) => {
  return c.json(
    {
      error: "Not Found",
      message: `Route ${c.req.method} ${c.req.path} not found`,
    },
    404,
  );
});

app.onError((err, c) => {
  console.error("Server error:", err);
  return c.json({ error: "Internal Server Error", message: err.message }, 500);
});

export default app;
