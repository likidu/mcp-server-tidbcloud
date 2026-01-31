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

/**
 * Stored refresh token data for token rotation
 */
export interface RefreshTokenData {
  /** The actual TiDB Cloud refresh token */
  upstreamRefreshToken: string;
  /** Client ID that owns this token */
  clientId: string;
  /** When this refresh token was issued */
  issuedAt: number;
}

export interface OAuthStore {
  /**
   * Store authorization state (used during OAuth flow initiation)
   */
  setState(
    key: string,
    data: AuthorizationState,
    ttlSeconds: number,
  ): Promise<void>;

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
  setCode(
    key: string,
    data: AuthorizationCode,
    ttlSeconds: number,
  ): Promise<void>;

  /**
   * Retrieve and delete authorization code (one-time use)
   */
  getAndDeleteCode(key: string): Promise<AuthorizationCode | null>;

  /**
   * Store refresh token mapping for token rotation
   */
  setRefreshToken(
    key: string,
    data: RefreshTokenData,
    ttlSeconds: number,
  ): Promise<void>;

  /**
   * Retrieve and delete refresh token (one-time use for rotation)
   * Returns null if token doesn't exist (may have been revoked or reused)
   */
  getAndDeleteRefreshToken(key: string): Promise<RefreshTokenData | null>;
}
