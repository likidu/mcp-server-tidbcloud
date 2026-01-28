/**
 * OAuth authentication middleware for Hono
 */

import type { Context, Next } from "hono";
import { verifyAccessToken } from "./token.js";
import type { TokenInfo } from "./types.js";
import type { Config } from "../config.js";

// Extend Hono context with user info
declare module "hono" {
    interface ContextVariableMap {
        tokenInfo: TokenInfo;
    }
}

/**
 * Creates an authentication middleware that requires a valid OAuth token
 */
export function createAuthMiddleware(config: Config) {
    return async (c: Context, next: Next) => {
        const authHeader = c.req.header("Authorization");
        const host = c.req.header("host") || config.server.serverHost;
        const scheme = c.req.header("x-forwarded-proto") || "https";

        // Check for Bearer token
        if (!authHeader?.startsWith("Bearer ")) {
            // Return 401 with WWW-Authenticate header per RFC 9728
            return c.json(
                {
                    error: "unauthorized",
                    error_description: "Missing or invalid Authorization header",
                },
                401,
                {
                    "WWW-Authenticate": `Bearer resource_metadata="${scheme}://${host}/.well-known/oauth-protected-resource"`,
                },
            );
        }

        const token = authHeader.slice(7); // Remove "Bearer " prefix

        // Verify the token
        const tokenInfo = await verifyAccessToken(token);

        if (!tokenInfo) {
            return c.json(
                {
                    error: "invalid_token",
                    error_description: "The access token is invalid or expired",
                },
                401,
                {
                    "WWW-Authenticate": `Bearer resource_metadata="${scheme}://${host}/.well-known/oauth-protected-resource", error="invalid_token"`,
                },
            );
        }

        // Store token info in context for handlers to use
        c.set("tokenInfo", tokenInfo);

        await next();
    };
}

/**
 * Creates middleware that checks for specific scopes
 */
export function requireScopes(...requiredScopes: string[]) {
    return async (c: Context, next: Next) => {
        const tokenInfo = c.get("tokenInfo");

        if (!tokenInfo) {
            return c.json(
                {
                    error: "unauthorized",
                    error_description: "Authentication required",
                },
                401,
            );
        }

        // Check if token has all required scopes
        const hasAllScopes = requiredScopes.every((scope) =>
            tokenInfo.scopes.includes(scope),
        );

        if (!hasAllScopes) {
            const host = c.req.header("host") || "";
            const scheme = c.req.header("x-forwarded-proto") || "https";

            return c.json(
                {
                    error: "insufficient_scope",
                    error_description: `Required scopes: ${requiredScopes.join(" ")}`,
                },
                403,
                {
                    "WWW-Authenticate": `Bearer resource_metadata="${scheme}://${host}/.well-known/oauth-protected-resource", error="insufficient_scope", scope="${requiredScopes.join(" ")}"`,
                },
            );
        }

        await next();
    };
}

/**
 * Optional auth middleware - allows unauthenticated requests but attaches token info if present
 */
export function optionalAuth() {
    return async (c: Context, next: Next) => {
        const authHeader = c.req.header("Authorization");

        if (authHeader?.startsWith("Bearer ")) {
            const token = authHeader.slice(7);
            const tokenInfo = await verifyAccessToken(token);

            if (tokenInfo) {
                c.set("tokenInfo", tokenInfo);
            }
        }

        await next();
    };
}
