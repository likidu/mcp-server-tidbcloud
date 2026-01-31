/**
 * OAuth Store Interface
 *
 * Abstract interface for storing OAuth state and authorization codes.
 * Implementations can use different backends (Upstash Redis, Cloudflare KV, etc.)
 */

export interface AuthorizationState {
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  clientId: string;
  clientState?: string;
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

export interface OAuthStore {
  /**
   * Store authorization state (used during OAuth flow initiation)
   */
  setState(key: string, data: AuthorizationState, ttlSeconds: number): Promise<void>;

  /**
   * Retrieve authorization state
   */
  getState(key: string): Promise<AuthorizationState | null>;

  /**
   * Delete authorization state (after use)
   */
  deleteState(key: string): Promise<void>;

  /**
   * Store authorization code with token data
   */
  setCode(key: string, data: AuthorizationCode, ttlSeconds: number): Promise<void>;

  /**
   * Retrieve and delete authorization code (one-time use)
   */
  getAndDeleteCode(key: string): Promise<AuthorizationCode | null>;
}
