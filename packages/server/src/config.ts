/**
 * Configuration module for TiDB Cloud MCP Server
 */

import type { DatabaseConfig } from "./db/types.js";

/**
 * Environment for TiDB Cloud API endpoints
 * - dev: Uses dev.tidbcloud.com and serverless.dev.tidbapi.com
 * - prod: Uses tidbcloud.com and serverless.tidbapi.com
 */
export type Environment = "dev" | "prod";

/**
 * Authentication mode for the TiDB Cloud API
 */
export type AuthMode = "oauth" | "digest";

/**
 * OAuth authentication configuration
 */
export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  /** Pre-obtained access token (optional, for testing) */
  accessToken?: string;
  /** Redirect URI for Authorization Code flow */
  redirectUri?: string;
}

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
  oauth?: OAuthConfig;
  digest?: DigestAuthConfig;
  apiBaseUrl: string;
  database?: DatabaseConfig;
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
 * OAuth is the default authentication mode if credentials are provided.
 * Falls back to Digest (API Key) authentication if OAuth is not configured.
 * @throws Error if no authentication is configured
 */
export function loadConfig(): Config {
  // Determine environment (dev or prod, defaults to prod)
  const envValue = process.env.TIDB_CLOUD_ENV?.toLowerCase();
  const environment: Environment = envValue === "dev" ? "dev" : "prod";

  // Check for OAuth credentials first (default mode)
  const oauthClientId = process.env.TIDB_CLOUD_OAUTH_CLIENT_ID;
  const oauthClientSecret = process.env.TIDB_CLOUD_OAUTH_CLIENT_SECRET;

  // Check for Digest auth credentials (fallback)
  const publicKey = process.env.TIDB_CLOUD_PUBLIC_KEY;
  const privateKey = process.env.TIDB_CLOUD_PRIVATE_KEY;

  // Determine auth mode
  const hasOAuth = !!(oauthClientId && oauthClientSecret);
  const hasDigest = !!(publicKey && privateKey);

  if (!hasOAuth && !hasDigest) {
    throw new Error(
      "Authentication required. Configure either:\n" +
        "  - OAuth: TIDB_CLOUD_OAUTH_CLIENT_ID and TIDB_CLOUD_OAUTH_CLIENT_SECRET\n" +
        "  - API Key: TIDB_CLOUD_PUBLIC_KEY and TIDB_CLOUD_PRIVATE_KEY\n" +
        "Get credentials from TiDB Cloud console.",
    );
  }

  // OAuth is preferred when both are available
  const authMode: AuthMode = hasOAuth ? "oauth" : "digest";

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

  // Optional OAuth access token (for testing or pre-obtained tokens)
  const oauthAccessToken = process.env.TIDB_CLOUD_OAUTH_ACCESS_TOKEN;
  const oauthRedirectUri = process.env.TIDB_CLOUD_OAUTH_REDIRECT_URI;

  return {
    environment,
    authMode,
    oauth: hasOAuth
      ? {
          clientId: oauthClientId!,
          clientSecret: oauthClientSecret!,
          accessToken: oauthAccessToken,
          redirectUri: oauthRedirectUri,
        }
      : undefined,
    digest: hasDigest
      ? {
          publicKey: publicKey!,
          privateKey: privateKey!,
        }
      : undefined,
    apiBaseUrl,
    database,
  };
}

/**
 * Validates that the configuration is complete and valid
 */
export function validateConfig(config: Config): void {
  if (config.authMode === "oauth") {
    if (!config.oauth?.clientId || config.oauth.clientId.trim() === "") {
      throw new Error("OAuth client ID cannot be empty");
    }
    if (
      !config.oauth?.clientSecret ||
      config.oauth.clientSecret.trim() === ""
    ) {
      throw new Error("OAuth client secret cannot be empty");
    }
  } else if (config.authMode === "digest") {
    if (!config.digest?.publicKey || config.digest.publicKey.trim() === "") {
      throw new Error("Public key cannot be empty");
    }
    if (!config.digest?.privateKey || config.digest.privateKey.trim() === "") {
      throw new Error("Private key cannot be empty");
    }
  }

  try {
    new URL(config.apiBaseUrl);
  } catch {
    throw new Error(`Invalid API base URL: ${config.apiBaseUrl}`);
  }
}
