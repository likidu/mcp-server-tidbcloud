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
                process.env.TIDB_OAUTH_TOKEN_URL ||
                "https://tidbcloud.com/oauth/token",
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
