/**
 * OAuth State Storage
 * Shared between Hono app and direct API handlers
 */

export interface AuthorizationState {
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  clientId: string;
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

export const authorizationStates = new Map<string, AuthorizationState>();
export const authorizationCodes = new Map<string, AuthorizationCode>();

export function cleanupExpiredStates(): void {
  const now = Date.now();
  const expirationTime = 10 * 60 * 1000; // 10 minutes

  for (const [state, data] of authorizationStates.entries()) {
    if (now - data.createdAt > expirationTime) {
      authorizationStates.delete(state);
    }
  }

  for (const [code, data] of authorizationCodes.entries()) {
    if (now - data.createdAt > expirationTime) {
      authorizationCodes.delete(code);
    }
  }
}

export function generateRandomString(length: number): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  return Array.from(randomValues, (v) => chars[v % chars.length]).join("");
}
