/**
 * Configuration module for TiDB Cloud MCP Server
 */

import type { DatabaseConfig } from "./db/types.js";

/**
 * Environment for TiDB Cloud API endpoints
 * - staging: Uses staging.tidbcloud.com and serverless.staging.tidbapi.com
 * - prod: Uses tidbcloud.com and serverless.tidbapi.com
 */
export type Environment = "staging" | "prod";

/**
 * Authentication mode for the TiDB Cloud API
 */
export type AuthMode = "digest";

/**
 * Digest (API Key) authentication configuration
 */
export interface DigestAuthConfig {
  publicKey: string;
  privateKey: string;
}

/**
 * Server configuration
 */
export interface Config {
  environment: Environment;
  authMode: AuthMode;
  digest: DigestAuthConfig;
  apiBaseUrl: string;
  database?: DatabaseConfig;
}

/**
 * API base URLs for TiDB Cloud Serverless API
 */
const API_BASE_URLS: Record<Environment, string> = {
  prod: "https://serverless.tidbapi.com",
  staging: "https://serverless.staging.tidbapi.com",
};

/**
 * Loads configuration from environment variables
 * Uses API Key (Digest) authentication.
 * @throws Error if no authentication is configured
 */
export function loadConfig(): Config {
  // Determine environment (staging or prod, defaults to prod)
  const envValue = process.env.TIDB_CLOUD_ENV?.toLowerCase();
  const environment: Environment =
    envValue === "staging" ? "staging" : "prod";

  // Check for API key credentials
  const publicKey = process.env.TIDB_CLOUD_PUBLIC_KEY;
  const privateKey = process.env.TIDB_CLOUD_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    throw new Error(
      "Authentication required. Configure:\n" +
        "  TIDB_CLOUD_PUBLIC_KEY and TIDB_CLOUD_PRIVATE_KEY\n" +
        "Get credentials from TiDB Cloud console: Organization Settings > API Keys.",
    );
  }

  // Optional database configuration
  const dbHost = process.env.TIDB_CLOUD_DB_HOST;
  const dbUser = process.env.TIDB_CLOUD_DB_USER;
  const dbPassword = process.env.TIDB_CLOUD_DB_PASSWORD;
  const dbName = process.env.TIDB_CLOUD_DB_NAME;

  const database: DatabaseConfig | undefined =
    dbHost && dbUser && dbPassword
      ? {
          host: dbHost,
          username: dbUser,
          password: dbPassword,
          database: dbName,
        }
      : undefined;

  // API base URL based on environment, can be overridden with TIDB_CLOUD_API_URL
  const apiBaseUrl =
    process.env.TIDB_CLOUD_API_URL || API_BASE_URLS[environment];

  return {
    environment,
    authMode: "digest",
    digest: {
      publicKey,
      privateKey,
    },
    apiBaseUrl,
    database,
  };
}

/**
 * Validates that the configuration is complete and valid
 */
export function validateConfig(config: Config): void {
  if (!config.digest.publicKey || config.digest.publicKey.trim() === "") {
    throw new Error("Public key cannot be empty");
  }
  if (!config.digest.privateKey || config.digest.privateKey.trim() === "") {
    throw new Error("Private key cannot be empty");
  }

  try {
    new URL(config.apiBaseUrl);
  } catch {
    throw new Error(`Invalid API base URL: ${config.apiBaseUrl}`);
  }
}
