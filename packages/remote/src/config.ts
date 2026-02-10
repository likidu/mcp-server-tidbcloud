/**
 * Configuration module for the remote MCP server
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
const API_BASE_URLS: Record<Environment, string> = {
  prod: "https://serverless.tidbapi.com",
  dev: "https://serverless.dev.tidbapi.com",
};

/**
 * Loads configuration from environment variables
 */
export function loadConfig(): Config {
  const serverHost = process.env.SERVER_HOST || "localhost:3000";
  const port = parseInt(process.env.PORT || "3000", 10);

  // Determine environment (dev or prod, defaults to prod)
  const envValue = process.env.TIDB_CLOUD_ENV?.toLowerCase();
  const environment: Environment = envValue === "dev" ? "dev" : "prod";

  // API base URL based on environment, can be overridden with TIDB_CLOUD_API_URL
  const apiBaseUrl =
    process.env.TIDB_CLOUD_API_URL || API_BASE_URLS[environment];

  return {
    server: {
      host: process.env.HOST || "0.0.0.0",
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
