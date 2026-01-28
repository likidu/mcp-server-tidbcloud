/**
 * Token storage and management
 *
 * For local development, uses in-memory storage.
 * For production (Vercel), would use Vercel KV.
 */

import type { TokenInfo, AuthState } from "./types.js";

// In-memory storage for local development
// In production, this would be replaced with Vercel KV
const tokenStore = new Map<string, TokenInfo>();
const authStateStore = new Map<string, AuthState>();

/**
 * Stores token information for a session
 */
export async function storeToken(
    sessionId: string,
    tokenInfo: TokenInfo,
): Promise<void> {
    tokenStore.set(sessionId, tokenInfo);
}

/**
 * Retrieves token information for a session
 */
export async function getToken(sessionId: string): Promise<TokenInfo | null> {
    const token = tokenStore.get(sessionId);
    if (!token) return null;

    // Check if token is expired
    if (Date.now() >= token.expiresAt) {
        // Token expired - in production, would attempt refresh here
        tokenStore.delete(sessionId);
        return null;
    }

    return token;
}

/**
 * Deletes token information for a session
 */
export async function deleteToken(sessionId: string): Promise<void> {
    tokenStore.delete(sessionId);
}

/**
 * Verifies an access token and returns the associated session info
 * In production, this would validate with the authorization server
 */
export async function verifyAccessToken(
    accessToken: string,
): Promise<TokenInfo | null> {
    // Find session by access token
    for (const [_sessionId, tokenInfo] of tokenStore.entries()) {
        if (tokenInfo.accessToken === accessToken) {
            // Check expiration
            if (Date.now() >= tokenInfo.expiresAt) {
                return null;
            }
            return tokenInfo;
        }
    }
    return null;
}

/**
 * Stores OAuth authorization state for a pending authorization
 */
export async function storeAuthState(
    state: string,
    authState: AuthState,
): Promise<void> {
    authStateStore.set(state, authState);

    // Clean up expired states (older than 10 minutes)
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    for (const [key, value] of authStateStore.entries()) {
        if (value.createdAt < tenMinutesAgo) {
            authStateStore.delete(key);
        }
    }
}

/**
 * Retrieves and removes OAuth authorization state
 */
export async function consumeAuthState(
    state: string,
): Promise<AuthState | null> {
    const authState = authStateStore.get(state);
    if (authState) {
        authStateStore.delete(state);

        // Verify state hasn't expired (10 minute window)
        if (Date.now() - authState.createdAt > 10 * 60 * 1000) {
            return null;
        }
    }
    return authState || null;
}

/**
 * Checks if a token needs refresh (within 5 minutes of expiry)
 */
export function tokenNeedsRefresh(tokenInfo: TokenInfo): boolean {
    const fiveMinutes = 5 * 60 * 1000;
    return Date.now() >= tokenInfo.expiresAt - fiveMinutes;
}
