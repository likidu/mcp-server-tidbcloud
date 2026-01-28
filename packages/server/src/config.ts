/**
 * Configuration module for TiDB Cloud MCP Server
 */

import type { DatabaseConfig } from "./db/types.js";

/**
 * Server configuration
 */
export interface Config {
    publicKey: string;
    privateKey: string;
    apiBaseUrl: string;
    database?: DatabaseConfig;
}

/**
 * Default API base URL for TiDB Cloud Serverless API
 */
const DEFAULT_API_BASE_URL = "https://serverless.tidbapi.com";

/**
 * Loads configuration from environment variables
 * @throws Error if required configuration is missing
 */
export function loadConfig(): Config {
    const publicKey = process.env.TIDB_CLOUD_PUBLIC_KEY;
    const privateKey = process.env.TIDB_CLOUD_PRIVATE_KEY;

    if (!publicKey || !privateKey) {
        throw new Error(
            "TIDB_CLOUD_PUBLIC_KEY and TIDB_CLOUD_PRIVATE_KEY environment variables are required. " +
                "Get your API keys from TiDB Cloud console: Organization Settings → API Keys.",
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

    return {
        publicKey,
        privateKey,
        apiBaseUrl: process.env.TIDB_CLOUD_API_URL || DEFAULT_API_BASE_URL,
        database,
    };
}

/**
 * Validates that the configuration is complete and valid
 */
export function validateConfig(config: Config): void {
    if (!config.publicKey || config.publicKey.trim() === "") {
        throw new Error("Public key cannot be empty");
    }

    if (!config.privateKey || config.privateKey.trim() === "") {
        throw new Error("Private key cannot be empty");
    }

    try {
        new URL(config.apiBaseUrl);
    } catch {
        throw new Error(`Invalid API base URL: ${config.apiBaseUrl}`);
    }
}
