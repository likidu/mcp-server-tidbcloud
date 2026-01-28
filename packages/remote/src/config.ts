/**
 * Configuration module for the remote MCP server
 */

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes: string[];
}

export interface ServerConfig {
  host: string;
  port: number;
  serverHost: string; // Public hostname for callbacks
}

export interface DatabaseConfig {
  host: string;
  username: string;
  password: string;
  database?: string;
}

export interface Config {
  server: ServerConfig;
  oauth: OAuthConfig;
  // TiDB Cloud API credentials (for fallback/API key mode)
  tidbCloud?: {
    publicKey: string;
    privateKey: string;
  };
  // Database connection config
  database?: DatabaseConfig;
}

/**
 * Sensitive field names that should be redacted in logs
 */
const SENSITIVE_FIELDS = [
  "privateKey",
  "clientSecret",
  "password",
  "token",
  "secret",
  "apiKey",
  "authorization",
];

/**
 * Redacts sensitive values from an object for safe logging
 * @param obj - Object to redact
 * @param depth - Maximum recursion depth
 * @returns Object with sensitive values replaced with [REDACTED]
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

    // Check if this key contains sensitive data
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
 * Default OAuth scopes for TiDB Cloud
 */
const DEFAULT_SCOPES = [
  "cluster:read",
  "cluster:write",
  "branch:read",
  "branch:write",
  "sql:read",
  "sql:write",
];

/**
 * Loads configuration from environment variables
 */
export function loadConfig(): Config {
  const serverHost = process.env.SERVER_HOST || "localhost:3000";
  const port = parseInt(process.env.PORT || "3000", 10);

  return {
    server: {
      host: process.env.HOST || "0.0.0.0",
      port,
      serverHost,
    },
    oauth: {
      clientId: process.env.TIDB_OAUTH_CLIENT_ID || "",
      clientSecret: process.env.TIDB_OAUTH_CLIENT_SECRET || "",
      authorizeUrl:
        process.env.TIDB_OAUTH_AUTHORIZE_URL ||
        "https://tidbcloud.com/oauth/authorize",
      tokenUrl:
        process.env.TIDB_OAUTH_TOKEN_URL || "https://tidbcloud.com/oauth/token",
      redirectUri: `https://${serverHost}/oauth/callback`,
      scopes: DEFAULT_SCOPES,
    },
    tidbCloud: process.env.TIDB_CLOUD_PUBLIC_KEY
      ? {
          publicKey: process.env.TIDB_CLOUD_PUBLIC_KEY,
          privateKey: process.env.TIDB_CLOUD_PRIVATE_KEY || "",
        }
      : undefined,
    database: process.env.TIDB_CLOUD_DB_HOST
      ? {
          host: process.env.TIDB_CLOUD_DB_HOST,
          username: process.env.TIDB_CLOUD_DB_USER || "",
          password: process.env.TIDB_CLOUD_DB_PASSWORD || "",
          database: process.env.TIDB_CLOUD_DB_NAME,
        }
      : undefined,
  };
}

/**
 * Checks if OAuth is configured
 */
export function isOAuthConfigured(config: Config): boolean {
  return !!(config.oauth.clientId && config.oauth.clientSecret);
}

/**
 * Checks if API key authentication is configured
 */
export function isApiKeyConfigured(config: Config): boolean {
  return !!(config.tidbCloud?.publicKey && config.tidbCloud?.privateKey);
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
 * @param config - Configuration to validate
 * @throws ConfigValidationError if required configuration is missing
 */
export function validateConfig(config: Config): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for API key or OAuth configuration
  if (!isApiKeyConfigured(config) && !isOAuthConfigured(config)) {
    errors.push(
      "No authentication configured. Set either TIDB_CLOUD_PUBLIC_KEY/TIDB_CLOUD_PRIVATE_KEY " +
        "or TIDB_OAUTH_CLIENT_ID/TIDB_OAUTH_CLIENT_SECRET",
    );
  }

  // Warn if database is not configured
  if (!config.database) {
    warnings.push(
      "Database connection not configured. SQL execution tools will require connection parameters.",
    );
  }

  // Log warnings
  for (const warning of warnings) {
    console.warn(`[config] Warning: ${warning}`);
  }

  // Throw if there are errors
  if (errors.length > 0) {
    throw new ConfigValidationError(
      `Configuration validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  // Log safe version of config on startup
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
