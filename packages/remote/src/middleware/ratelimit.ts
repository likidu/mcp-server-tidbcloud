/**
 * Rate limiting middleware using Upstash Redis
 *
 * Provides per-IP and per-token rate limiting to protect against abuse.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { Context, Next } from "hono";

// Lazy initialization to avoid errors when Redis env vars are not set
let ratelimitInstance: Ratelimit | null = null;

function getRatelimit(): Ratelimit | null {
  if (ratelimitInstance) return ratelimitInstance;

  // Check if Redis is configured
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.warn("[ratelimit] Upstash Redis not configured, rate limiting disabled");
    return null;
  }

  try {
    ratelimitInstance = new Ratelimit({
      redis: Redis.fromEnv(),
      // 100 requests per minute using sliding window
      limiter: Ratelimit.slidingWindow(100, "1 m"),
      // Add prefix to avoid conflicts with other keys
      prefix: "ratelimit",
      // Enable analytics (optional, stores additional data)
      analytics: true,
    });
    return ratelimitInstance;
  } catch (error) {
    console.error("[ratelimit] Failed to initialize:", error);
    return null;
  }
}

/**
 * Extracts the client identifier for rate limiting
 *
 * Priority:
 * 1. Bearer token (hash of first 16 chars) - for authenticated requests
 * 2. Client IP from headers - for unauthenticated requests
 * 3. Fallback to "anonymous"
 */
function getClientIdentifier(c: Context): string {
  // Try to get Bearer token
  const authHeader = c.req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    // Use first 16 chars as identifier (don't expose full token in Redis)
    return `token:${token.substring(0, 16)}`;
  }

  // Try to get IP from various headers (Vercel/Cloudflare/etc.)
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    c.req.header("cf-connecting-ip") ||
    "anonymous";

  return `ip:${ip}`;
}

/**
 * Rate limiting middleware for Hono
 *
 * Applies sliding window rate limiting (100 requests per minute by default).
 * Returns 429 Too Many Requests if limit is exceeded.
 */
export function rateLimiter() {
  return async (c: Context, next: Next) => {
    const ratelimit = getRatelimit();

    // Skip if rate limiting is not configured
    if (!ratelimit) {
      return next();
    }

    const identifier = getClientIdentifier(c);

    try {
      const { success, limit, remaining, reset } = await ratelimit.limit(identifier);

      // Add rate limit headers to response
      c.header("X-RateLimit-Limit", limit.toString());
      c.header("X-RateLimit-Remaining", remaining.toString());
      c.header("X-RateLimit-Reset", reset.toString());

      if (!success) {
        // Calculate retry-after in seconds
        const retryAfter = Math.ceil((reset - Date.now()) / 1000);
        c.header("Retry-After", retryAfter.toString());

        return c.json(
          {
            error: "too_many_requests",
            error_description: "Rate limit exceeded. Please try again later.",
            retry_after: retryAfter,
          },
          429,
        );
      }

      return next();
    } catch (error) {
      // Log error but don't block the request if rate limiting fails
      console.error("[ratelimit] Error checking rate limit:", error);
      return next();
    }
  };
}

/**
 * Stricter rate limiter for sensitive endpoints (e.g., token endpoint)
 *
 * Uses a separate limiter with lower limits (20 requests per minute).
 */
let strictRatelimitInstance: Ratelimit | null = null;

function getStrictRatelimit(): Ratelimit | null {
  if (strictRatelimitInstance) return strictRatelimitInstance;

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }

  try {
    strictRatelimitInstance = new Ratelimit({
      redis: Redis.fromEnv(),
      // 20 requests per minute for sensitive endpoints
      limiter: Ratelimit.slidingWindow(20, "1 m"),
      prefix: "ratelimit:strict",
      analytics: true,
    });
    return strictRatelimitInstance;
  } catch (error) {
    console.error("[ratelimit] Failed to initialize strict limiter:", error);
    return null;
  }
}

/**
 * Strict rate limiting for sensitive endpoints
 *
 * Use this for endpoints like /api/token, /api/authorize
 */
export function strictRateLimiter() {
  return async (c: Context, next: Next) => {
    const ratelimit = getStrictRatelimit();

    if (!ratelimit) {
      return next();
    }

    const identifier = getClientIdentifier(c);

    try {
      const { success, limit, remaining, reset } = await ratelimit.limit(identifier);

      c.header("X-RateLimit-Limit", limit.toString());
      c.header("X-RateLimit-Remaining", remaining.toString());
      c.header("X-RateLimit-Reset", reset.toString());

      if (!success) {
        const retryAfter = Math.ceil((reset - Date.now()) / 1000);
        c.header("Retry-After", retryAfter.toString());

        return c.json(
          {
            error: "too_many_requests",
            error_description: "Rate limit exceeded. Please try again later.",
            retry_after: retryAfter,
          },
          429,
        );
      }

      return next();
    } catch (error) {
      console.error("[ratelimit] Error checking strict rate limit:", error);
      return next();
    }
  };
}
