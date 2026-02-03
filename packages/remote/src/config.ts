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

/**
 * Authentication mode for the TiDB Cloud API
 */
export type AuthMode = "oauth" | "digest";

/**
 * OAuth flow type for TiDB Cloud
 * - auth_code: Authorization Code flow (for web clients like Claude Desktop, Cursor)
 * - device_code: Device Code flow (for headless clients like OpenClaw)
 *
 * Note: TiDB Cloud OAuth currently only supports one flow type per client credentials.
 * Set this to match the flow type configured for your OAuth app in TiDB Cloud.
 */
export type OAuthFlowType = "auth_code" | "device_code";

export interface Config {
  server: ServerConfig;
  environment: Environment;
  authMode?: AuthMode;
  oauthFlowType?: OAuthFlowType;
  oauth?: {
    clientId: string;
    clientSecret: string;
  };
  digest?: {
    publicKey: string;
    privateKey: string;
  };
  apiBaseUrl?: string;
}

/**
 * Sensitive field names that should be redacted in logs
 */
const SENSITIVE_FIELDS = [
  "privateKey",
  "password",
  "token",
  "secret",
  "apiKey",
];

/**
 * Redacts sensitive values from an object for safe logging
 */
export function redactSensitiveData<T extends Record<string, unknown>>(
  obj: T,
  depth: number = 3,
): T {
  if (depth <= 0 || typeof obj !== "object" || obj === null) {
    return obj;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    if (
      SENSITIVE_FIELDS.some((field) => lowerKey.includes(field.toLowerCase()))
    ) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactSensitiveData(
        value as Record<string, unknown>,
        depth - 1,
      );
    } else {
      result[key] = value;
    }
  }

  return result as T;
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
 */
export function loadConfig(): Config {
  const serverHost = process.env.SERVER_HOST || "localhost:3000";
  const port = parseInt(process.env.PORT || "3000", 10);

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
  const authMode: AuthMode | undefined = hasOAuth
    ? "oauth"
    : hasDigest
      ? "digest"
      : undefined;

  // Determine OAuth flow type (defaults to auth_code for backwards compatibility)
  const oauthFlowValue = process.env.TIDB_CLOUD_OAUTH_FLOW?.toLowerCase();
  const oauthFlowType: OAuthFlowType | undefined = hasOAuth
    ? oauthFlowValue === "device_code"
      ? "device_code"
      : "auth_code"
    : undefined;

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
    authMode,
    oauthFlowType,
    oauth: hasOAuth
      ? {
          clientId: oauthClientId!,
          clientSecret: oauthClientSecret!,
        }
      : undefined,
    digest: hasDigest
      ? {
          publicKey: publicKey!,
          privateKey: privateKey!,
        }
      : undefined,
    apiBaseUrl,
  };
}

/**
 * Checks if any authentication is configured (OAuth or API key)
 */
export function isAuthConfigured(config: Config): boolean {
  return !!(
    (config.oauth?.clientId && config.oauth?.clientSecret) ||
    (config.digest?.publicKey && config.digest?.privateKey)
  );
}

/**
 * Checks if API key authentication is configured (legacy alias)
 */
export function isApiKeyConfigured(config: Config): boolean {
  return isAuthConfigured(config);
}

/**
 * Configuration validation errors
 */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

/**
 * Validates the configuration and logs warnings for missing optional values
 */
export function validateConfig(config: Config): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isAuthConfigured(config)) {
    errors.push(
      "No authentication configured. Set either:\n" +
        "    - OAuth: TIDB_CLOUD_OAUTH_CLIENT_ID and TIDB_CLOUD_OAUTH_CLIENT_SECRET\n" +
        "    - API Key: TIDB_CLOUD_PUBLIC_KEY and TIDB_CLOUD_PRIVATE_KEY",
    );
  }

  // Log environment and auth mode being used
  console.log(`[config] Environment: ${config.environment}`);
  if (config.authMode) {
    console.log(
      `[config] Authentication mode: ${config.authMode === "oauth" ? "OAuth" : "Digest (API Key)"}`,
    );
    if (config.authMode === "oauth" && config.oauthFlowType) {
      console.log(
        `[config] OAuth flow type: ${config.oauthFlowType === "auth_code" ? "Authorization Code" : "Device Code"}`,
      );
    }
    console.log(`[config] API base URL: ${config.apiBaseUrl}`);
  }

  for (const warning of warnings) {
    console.warn(`[config] Warning: ${warning}`);
  }

  if (errors.length > 0) {
    throw new ConfigValidationError(
      `Configuration validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  console.log(
    "[config] Configuration loaded:",
    JSON.stringify(
      redactSensitiveData(config as unknown as Record<string, unknown>),
      null,
      2,
    ),
  );
}

/**
 * Gets a safe (redacted) version of the config for logging
 */
export function getSafeConfig(config: Config): Record<string, unknown> {
  return redactSensitiveData(config as unknown as Record<string, unknown>);
}
