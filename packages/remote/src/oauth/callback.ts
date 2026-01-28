/**
 * OAuth callback and authorization handlers
 */

import type { Context } from "hono";
import { createPKCEChallenge, generateState } from "./pkce.js";
import { storeAuthState, consumeAuthState, storeToken } from "./token.js";
import type { OAuthTokenResponse, TokenInfo } from "./types.js";
import type { Config } from "../config.js";

/**
 * Creates the OAuth authorization initiation handler
 * This redirects users to the TiDB Cloud authorization server
 */
export function createAuthorizeHandler(config: Config) {
    return async (c: Context) => {
        // Generate PKCE challenge
        const pkce = createPKCEChallenge();

        // Generate state parameter
        const state = generateState();

        // Store auth state for callback verification
        await storeAuthState(state, {
            pkce,
            redirectUri: config.oauth.redirectUri,
            scopes: config.oauth.scopes,
            createdAt: Date.now(),
        });

        // Build authorization URL
        const authUrl = new URL(config.oauth.authorizeUrl);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("client_id", config.oauth.clientId);
        authUrl.searchParams.set("redirect_uri", config.oauth.redirectUri);
        authUrl.searchParams.set("scope", config.oauth.scopes.join(" "));
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("code_challenge", pkce.codeChallenge);
        authUrl.searchParams.set(
            "code_challenge_method",
            pkce.codeChallengeMethod,
        );

        // Redirect to authorization server
        return c.redirect(authUrl.toString());
    };
}

/**
 * Creates the OAuth callback handler
 * This exchanges the authorization code for tokens
 */
export function createCallbackHandler(config: Config) {
    return async (c: Context) => {
        const code = c.req.query("code");
        const state = c.req.query("state");
        const error = c.req.query("error");
        const errorDescription = c.req.query("error_description");

        // Handle errors from authorization server
        if (error) {
            return c.html(`
                <!DOCTYPE html>
                <html>
                <head><title>Authorization Failed</title></head>
                <body>
                    <h1>Authorization Failed</h1>
                    <p>Error: ${error}</p>
                    ${errorDescription ? `<p>Description: ${errorDescription}</p>` : ""}
                    <p>You can close this window.</p>
                </body>
                </html>
            `);
        }

        // Validate required parameters
        if (!code || !state) {
            return c.html(
                `
                <!DOCTYPE html>
                <html>
                <head><title>Invalid Request</title></head>
                <body>
                    <h1>Invalid Request</h1>
                    <p>Missing authorization code or state parameter.</p>
                </body>
                </html>
            `,
                400,
            );
        }

        // Retrieve and validate auth state
        const authState = await consumeAuthState(state);
        if (!authState) {
            return c.html(
                `
                <!DOCTYPE html>
                <html>
                <head><title>Invalid State</title></head>
                <body>
                    <h1>Invalid or Expired State</h1>
                    <p>The authorization request has expired or is invalid. Please try again.</p>
                </body>
                </html>
            `,
                400,
            );
        }

        try {
            // Exchange code for tokens
            const tokenResponse = await exchangeCodeForTokens(
                config,
                code,
                authState.pkce.codeVerifier,
            );

            // Generate session ID
            const sessionId = generateSessionId();

            // Parse and store token info
            const tokenInfo: TokenInfo = {
                accessToken: tokenResponse.access_token,
                refreshToken: tokenResponse.refresh_token,
                expiresAt: Date.now() + tokenResponse.expires_in * 1000,
                tokenType: tokenResponse.token_type,
                scopes: tokenResponse.scope
                    ? tokenResponse.scope.split(" ")
                    : authState.scopes,
            };

            await storeToken(sessionId, tokenInfo);

            // Return success page with session info
            // In production, this would set a secure cookie or return the session ID
            return c.html(`
                <!DOCTYPE html>
                <html>
                <head><title>Authorization Successful</title></head>
                <body>
                    <h1>Authorization Successful</h1>
                    <p>You have been authorized to access TiDB Cloud.</p>
                    <p>Session ID: <code>${sessionId}</code></p>
                    <p>You can now use this session with your MCP client.</p>
                    <p>This window can be closed.</p>
                    <script>
                        // Post message to opener if this was opened in a popup
                        if (window.opener) {
                            window.opener.postMessage({
                                type: 'oauth-callback',
                                sessionId: '${sessionId}',
                                success: true
                            }, '*');
                        }
                    </script>
                </body>
                </html>
            `);
        } catch (err) {
            const errorMessage =
                err instanceof Error ? err.message : "Unknown error";
            return c.html(
                `
                <!DOCTYPE html>
                <html>
                <head><title>Token Exchange Failed</title></head>
                <body>
                    <h1>Token Exchange Failed</h1>
                    <p>Error: ${errorMessage}</p>
                    <p>Please try again.</p>
                </body>
                </html>
            `,
                500,
            );
        }
    };
}

/**
 * Exchanges authorization code for tokens
 */
async function exchangeCodeForTokens(
    config: Config,
    code: string,
    codeVerifier: string,
): Promise<OAuthTokenResponse> {
    const response = await fetch(config.oauth.tokenUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: config.oauth.redirectUri,
            client_id: config.oauth.clientId,
            client_secret: config.oauth.clientSecret,
            code_verifier: codeVerifier,
        }).toString(),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    return (await response.json()) as OAuthTokenResponse;
}

/**
 * Generates a unique session ID
 */
function generateSessionId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
