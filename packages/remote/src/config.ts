/**
 * Configuration module for the remote MCP server
 *
 * Supports both Cloudflare Workers (env from Hono context) and
 * Node.js (process.env) environments.
 */

export interface ServerConfig {
    host: string;
    port: number;
    serverHost: string;
}

/**
 * Environment for TiDB Cloud API endpoints
 * - dev: Uses dev.tidbcloud.com and serverless.dev.tidbapi.com
 * - prod: Uses tidbcloud.com and serverless.tidbapi.com
 */
export type Environment = "dev" | "prod";

export interface Config {
    server: ServerConfig;
    environment: Environment;
    apiBaseUrl?: string;
}

/**
 * API base URLs for TiDB Cloud Serverless API
 */
export const API_BASE_URLS: Record<Environment, string> = {
    prod: "https://serverless.tidbapi.com",
    dev: "https://serverless.dev.tidbapi.com",
};

/**
 * Helper to read an env variable from either a provided env object
 * (Cloudflare Workers c.env) or process.env as fallback (Node.js).
 */
function getEnv(
    key: string,
    env?: Record<string, string | undefined>,
): string | undefined {
    return env?.[key] ?? process.env?.[key];
}

/**
 * Loads configuration from environment variables.
 * Pass `env` from Hono's `c.env` on Cloudflare Workers,
 * or omit for Node.js (falls back to process.env).
 */
export function loadConfig(env?: Record<string, string | undefined>): Config {
    const serverHost = getEnv("SERVER_HOST", env) || "localhost:3000";
    const port = parseInt(getEnv("PORT", env) || "3000", 10);

    const envValue = getEnv("TIDB_CLOUD_ENV", env)?.toLowerCase();
    const environment: Environment = envValue === "dev" ? "dev" : "prod";

    const apiBaseUrl =
        getEnv("TIDB_CLOUD_API_URL", env) || API_BASE_URLS[environment];

    return {
        server: {
            host: getEnv("HOST", env) || "0.0.0.0",
            port,
            serverHost,
        },
        environment,
        apiBaseUrl,
    };
}

/**
 * Validates the configuration
 */
export function validateConfig(config: Config): void {
    console.log(`[config] Environment: ${config.environment}`);
    console.log(`[config] API base URL: ${config.apiBaseUrl}`);
    console.log(
        "[config] Authentication: API Key (provided via request headers)",
    );
}
