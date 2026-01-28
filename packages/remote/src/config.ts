/**
 * Configuration module for the remote MCP server
 */

export interface ServerConfig {
  host: string;
  port: number;
  serverHost: string;
}

export interface DatabaseConfig {
  host: string;
  username: string;
  password: string;
  database?: string;
}

export interface Config {
  server: ServerConfig;
  tidbCloud?: {
    publicKey: string;
    privateKey: string;
  };
  database?: DatabaseConfig;
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
 */
export function validateConfig(config: Config): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isApiKeyConfigured(config)) {
    errors.push(
      "No authentication configured. Set TIDB_CLOUD_PUBLIC_KEY and TIDB_CLOUD_PRIVATE_KEY",
    );
  }

  if (!config.database) {
    warnings.push(
      "Database connection not configured. SQL execution tools will require connection parameters.",
    );
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
