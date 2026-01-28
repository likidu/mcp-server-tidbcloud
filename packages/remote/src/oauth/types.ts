/**
 * OAuth-related type definitions
 */

/**
 * Token information stored in session
 */
export interface TokenInfo {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
    tokenType: string;
    scopes: string[];
}

/**
 * OAuth token response from authorization server
 */
export interface OAuthTokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
}

/**
 * PKCE challenge parameters
 */
export interface PKCEChallenge {
    codeVerifier: string;
    codeChallenge: string;
    codeChallengeMethod: "S256";
}

/**
 * OAuth authorization state
 */
export interface AuthState {
    pkce: PKCEChallenge;
    redirectUri: string;
    scopes: string[];
    createdAt: number;
}
