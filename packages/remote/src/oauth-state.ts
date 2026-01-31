/**
 * OAuth State Storage
 *
 * In serverless environments, we can't rely on in-memory state between requests.
 * Instead, we encode the state data in the OAuth state parameter itself using
 * base64-encoded JSON. This is safe because:
 * 1. The state is only used to pass data between our own endpoints
 * 2. The actual security (PKCE) is handled by code_verifier validation
 * 3. TiDB Cloud validates the state round-trip
 */

export interface AuthorizationState {
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  clientId: string;
  clientState?: string; // The original state from the MCP client
  createdAt: number;
}

export interface AuthorizationCode {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  createdAt: number;
}

export function generateRandomString(length: number): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  return Array.from(randomValues, (v) => chars[v % chars.length]).join("");
}

/**
 * Encode authorization state into a URL-safe string
 */
export function encodeState(state: AuthorizationState): string {
  const json = JSON.stringify(state);
  // Use base64url encoding (URL-safe)
  return Buffer.from(json).toString("base64url");
}

/**
 * Decode authorization state from URL-safe string
 */
export function decodeState(encoded: string): AuthorizationState | null {
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf-8");
    const state = JSON.parse(json) as AuthorizationState;

    // Validate required fields
    if (!state.redirectUri || !state.createdAt) {
      return null;
    }

    // Check expiration (10 minutes)
    if (Date.now() - state.createdAt > 10 * 60 * 1000) {
      return null;
    }

    return state;
  } catch {
    return null;
  }
}

/**
 * Encode authorization code data into a URL-safe string
 * This allows the token endpoint to work in serverless environments
 * where in-memory state is not shared between instances.
 */
export function encodeAuthCode(codeData: AuthorizationCode): string {
  const json = JSON.stringify(codeData);
  return Buffer.from(json).toString("base64url");
}

/**
 * Decode authorization code data from URL-safe string
 */
export function decodeAuthCode(encoded: string): AuthorizationCode | null {
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf-8");
    const codeData = JSON.parse(json) as AuthorizationCode;

    // Validate required fields
    if (!codeData.accessToken || !codeData.createdAt) {
      return null;
    }

    // Check expiration (10 minutes)
    if (Date.now() - codeData.createdAt > 10 * 60 * 1000) {
      return null;
    }

    return codeData;
  } catch {
    return null;
  }
}
