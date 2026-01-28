/**
 * MCP Session Management
 *
 * Manages stateful MCP sessions for the Streamable HTTP transport.
 * Each session maintains its own MCP server instance.
 */

import { randomBytes } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
    registerClusterTools,
    registerBranchTools,
    registerRegionTools,
    registerDatabaseTools,
} from "@likidu/mcp-server-tidbcloud/tools";
import { TiDBCloudClient } from "@likidu/mcp-server-tidbcloud/api";
import type { TokenInfo } from "../oauth/types.js";

/**
 * MCP Session state
 */
interface McpSession {
    id: string;
    server: McpServer;
    createdAt: number;
    lastActivity: number;
    tokenInfo?: TokenInfo;
}

// In-memory session store
// In production with Vercel, sessions would need to be stateless or use KV
const sessions = new Map<string, McpSession>();

// Session timeout: 30 minutes of inactivity
const SESSION_TIMEOUT = 30 * 60 * 1000;

/**
 * Generates a cryptographically secure session ID
 */
export function generateSessionId(): string {
    return randomBytes(16).toString("hex");
}

/**
 * Creates a new MCP session
 */
export function createSession(tokenInfo?: TokenInfo): McpSession {
    const sessionId = generateSessionId();

    // Create MCP server instance
    const server = new McpServer({
        name: "tidbcloud-mcp-server-remote",
        version: "0.1.0",
    });

    // For now, we'll need to handle tool registration differently
    // since we don't have direct API credentials in OAuth mode
    // The tools will be registered when we have a way to get credentials from token

    const session: McpSession = {
        id: sessionId,
        server,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        tokenInfo,
    };

    sessions.set(sessionId, session);

    // Schedule cleanup of expired sessions
    cleanupExpiredSessions();

    return session;
}

/**
 * Retrieves an existing session
 */
export function getSession(sessionId: string): McpSession | null {
    const session = sessions.get(sessionId);

    if (!session) {
        return null;
    }

    // Check if session has expired
    if (Date.now() - session.lastActivity > SESSION_TIMEOUT) {
        sessions.delete(sessionId);
        return null;
    }

    // Update last activity
    session.lastActivity = Date.now();

    return session;
}

/**
 * Deletes a session
 */
export function deleteSession(sessionId: string): boolean {
    return sessions.delete(sessionId);
}

/**
 * Updates session's token info
 */
export function updateSessionToken(
    sessionId: string,
    tokenInfo: TokenInfo,
): boolean {
    const session = sessions.get(sessionId);
    if (!session) {
        return false;
    }

    session.tokenInfo = tokenInfo;
    session.lastActivity = Date.now();

    return true;
}

/**
 * Cleans up expired sessions
 */
function cleanupExpiredSessions(): void {
    const now = Date.now();

    for (const [sessionId, session] of sessions.entries()) {
        if (now - session.lastActivity > SESSION_TIMEOUT) {
            sessions.delete(sessionId);
        }
    }
}

/**
 * Gets session count (for monitoring)
 */
export function getSessionCount(): number {
    return sessions.size;
}

/**
 * Creates a session with API key credentials (for non-OAuth mode)
 */
export function createSessionWithApiKey(
    publicKey: string,
    privateKey: string,
    databaseConfig?: {
        host: string;
        username: string;
        password: string;
        database?: string;
    },
): McpSession {
    const sessionId = generateSessionId();

    // Create MCP server instance
    const server = new McpServer({
        name: "tidbcloud-mcp-server-remote",
        version: "0.1.0",
    });

    // Create API client with credentials
    const client = new TiDBCloudClient({
        publicKey,
        privateKey,
        apiBaseUrl: "https://serverless.tidbapi.com",
    });

    // Register tools
    registerRegionTools(server, client);
    registerClusterTools(server, client);
    registerBranchTools(server, client);
    registerDatabaseTools(server, databaseConfig);

    const session: McpSession = {
        id: sessionId,
        server,
        createdAt: Date.now(),
        lastActivity: Date.now(),
    };

    sessions.set(sessionId, session);

    return session;
}
