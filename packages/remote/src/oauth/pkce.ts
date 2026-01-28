/**
 * PKCE (Proof Key for Code Exchange) implementation
 * Following RFC 7636 and OAuth 2.1 requirements
 */

import { createHash, randomBytes } from "crypto";
import type { PKCEChallenge } from "./types.js";

/**
 * Generates a cryptographically random code verifier
 * Per RFC 7636, the verifier should be 43-128 characters of unreserved URI characters
 */
export function generateCodeVerifier(): string {
    // Generate 32 bytes of random data, which will be 43 characters when base64url encoded
    const buffer = randomBytes(32);
    return base64UrlEncode(buffer);
}

/**
 * Generates the code challenge from the verifier using S256 method
 * challenge = BASE64URL(SHA256(verifier))
 */
export function generateCodeChallenge(verifier: string): string {
    const hash = createHash("sha256").update(verifier).digest();
    return base64UrlEncode(hash);
}

/**
 * Creates a complete PKCE challenge pair
 */
export function createPKCEChallenge(): PKCEChallenge {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    return {
        codeVerifier,
        codeChallenge,
        codeChallengeMethod: "S256",
    };
}

/**
 * Base64URL encoding without padding (per RFC 7636)
 */
function base64UrlEncode(buffer: Buffer): string {
    return buffer
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
}

/**
 * Generates a random state parameter for OAuth
 */
export function generateState(): string {
    return randomBytes(16).toString("hex");
}
