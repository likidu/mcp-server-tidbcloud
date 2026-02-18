/**
 * TiDB Cloud MCP Server - Remote/Hosted Version
 *
 * This server uses API Key authentication.
 * Users provide their TiDB Cloud API keys (public + private) via custom headers:
 *   - X-TiDB-API-Public-Key
 *   - X-TiDB-API-Private-Key
 *
 * Runs on both Cloudflare Workers and Node.js (local dev).
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import {
    McpServer,
    WebStandardStreamableHTTPServerTransport,
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
import { API_BASE_URLS, loadConfig } from "./config.js";
import { getLandingPageHtml } from "./landing.js";
import {
    httpsEnforcement,
    securityHeaders,
    requestId,
} from "./middleware/security.js";
import { getSkillContent } from "./skill.js";

// ============================================================
// Types
// ============================================================

type Bindings = {
    TIDB_CLOUD_ENV?: string;
    TIDB_CLOUD_API_URL?: string;
    NODE_ENV?: string;
    SERVER_HOST?: string;
};

const VERSION = "0.5.2";

// ============================================================
// Hono App Setup
// ============================================================

const app = new Hono<{ Bindings: Bindings }>();

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
    const config = loadConfig(c.env);
    const host = c.req.header("host") || config.server.serverHost;
    const scheme = c.req.header("x-forwarded-proto") || "https";
    return c.html(getLandingPageHtml(`${scheme}://${host}`, VERSION));
});

// ============================================================
// Skill Documentation (for OpenClaw and other AI agents)
// ============================================================

app.get("/skill.md", (c) => {
    c.header("Content-Type", "text/markdown; charset=utf-8");
    return c.body(getSkillContent());
});

app.get("/api", (c) => {
    const config = loadConfig(c.env);
    const host = c.req.header("host") || config.server.serverHost;
    const scheme = c.req.header("x-forwarded-proto") || "https";
    const baseUrl = `${scheme}://${host}`;

    return c.json({
        name: "TiDB Cloud MCP Server",
        version: VERSION,
        description: "MCP server for TiDB Cloud with API Key authentication",
        endpoints: {
            mcp: `${baseUrl}/mcp`,
            health: `${baseUrl}/health`,
        },
        documentation: "https://github.com/likidu/mcp-server-tidbcloud",
    });
});

// ============================================================
// MCP Endpoint
// ============================================================

app.all("/mcp", async (c) => {
    const publicKey = c.req.header("x-tidb-api-public-key");
    const privateKey = c.req.header("x-tidb-api-private-key");

    if (!publicKey || !privateKey) {
        return c.json(
            {
                error: "missing_api_keys",
                error_description:
                    "TiDB Cloud API keys are required. " +
                    "Provide X-TiDB-API-Public-Key and X-TiDB-API-Private-Key headers. " +
                    "Get your API keys from TiDB Cloud console: Organization Settings > API Keys.",
            },
            401,
        );
    }

    const envValue = (
        c.env?.TIDB_CLOUD_ENV ??
        process.env?.TIDB_CLOUD_ENV ??
        "prod"
    ).toLowerCase();
    const environment: Environment = envValue === "dev" ? "dev" : "prod";
    const apiBaseUrl =
        c.env?.TIDB_CLOUD_API_URL ??
        process.env?.TIDB_CLOUD_API_URL ??
        API_BASE_URLS[environment];

    console.log(
        `[mcp] Processing request, env=${environment}, publicKey=${publicKey.substring(0, 8)}...`,
    );

    const serverConfig: ServerConfig = {
        environment,
        authMode: "digest",
        digest: { publicKey, privateKey },
        apiBaseUrl,
    };

    const mcpServer = new McpServer({
        name: "tidbcloud-mcp-server",
        version: VERSION,
    });

    const client = new TiDBCloudClient(serverConfig);

    // Extract optional DB credentials from headers
    const dbHost = c.req.header("x-tidb-db-host");
    const dbUser = c.req.header("x-tidb-db-user");
    const dbPassword = c.req.header("x-tidb-db-password");
    const dbConfig =
        dbHost && dbUser && dbPassword
            ? { host: dbHost, username: dbUser, password: dbPassword }
            : undefined;

    registerRegionTools(mcpServer, client);
    registerClusterTools(mcpServer, client);
    registerBranchTools(mcpServer, client);
    registerDatabaseTools(mcpServer, dbConfig);

    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
    });

    await mcpServer.connect(transport);

    console.log("[mcp] Server connected, handling request...");

    const response = await transport.handleRequest(c.req.raw);

    console.log("[mcp] Request handled successfully");

    return response;
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
    return c.json(
        { error: "Internal Server Error", message: err.message },
        500,
    );
});

export default app;
