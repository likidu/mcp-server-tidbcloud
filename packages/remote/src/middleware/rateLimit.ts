/**
 * Simple in-memory rate limiting middleware for Hono
 *
 * Note: For production with multiple instances, use Redis-based rate limiting
 */

import type { Context, Next } from "hono";

interface RateLimitEntry {
    count: number;
    resetTime: number;
}

interface RateLimitOptions {
    /** Time window in milliseconds (default: 60000 = 1 minute) */
    windowMs?: number;
    /** Maximum requests per window (default: 100) */
    max?: number;
    /** Function to generate a key for rate limiting (default: IP-based) */
    keyGenerator?: (c: Context) => string;
    /** Message to return when rate limited */
    message?: string;
    /** Skip rate limiting for certain requests */
    skip?: (c: Context) => boolean;
}

/**
 * Creates a rate limiting middleware
 */
export function rateLimiter(options: RateLimitOptions = {}) {
    const {
        windowMs = 60 * 1000, // 1 minute
        max = 100,
        keyGenerator = defaultKeyGenerator,
        message = "Too many requests, please try again later",
        skip,
    } = options;

    // In-memory store for rate limit tracking
    const store = new Map<string, RateLimitEntry>();

    // Cleanup expired entries periodically
    const cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of store.entries()) {
            if (now > entry.resetTime) {
                store.delete(key);
            }
        }
    }, windowMs);

    // Ensure cleanup doesn't prevent process exit
    if (cleanupInterval.unref) {
        cleanupInterval.unref();
    }

    return async (c: Context, next: Next) => {
        // Skip rate limiting if configured
        if (skip?.(c)) {
            return next();
        }

        const key = keyGenerator(c);
        const now = Date.now();

        let entry = store.get(key);

        // Create new entry or reset if window expired
        if (!entry || now > entry.resetTime) {
            entry = {
                count: 0,
                resetTime: now + windowMs,
            };
        }

        entry.count++;
        store.set(key, entry);

        // Calculate remaining requests and reset time
        const remaining = Math.max(0, max - entry.count);
        const resetSeconds = Math.ceil((entry.resetTime - now) / 1000);

        // Set rate limit headers
        c.header("X-RateLimit-Limit", String(max));
        c.header("X-RateLimit-Remaining", String(remaining));
        c.header("X-RateLimit-Reset", String(resetSeconds));

        // Check if rate limited
        if (entry.count > max) {
            c.header("Retry-After", String(resetSeconds));
            return c.json(
                {
                    error: "Too Many Requests",
                    message,
                    retryAfter: resetSeconds,
                },
                429
            );
        }

        return next();
    };
}

/**
 * Default key generator using IP address
 */
function defaultKeyGenerator(c: Context): string {
    // Try various headers for the real IP (in order of preference)
    const forwardedFor = c.req.header("x-forwarded-for");
    if (forwardedFor) {
        // Take the first IP in the list (client IP)
        return forwardedFor.split(",")[0].trim();
    }

    const realIp = c.req.header("x-real-ip");
    if (realIp) {
        return realIp;
    }

    const cfConnectingIp = c.req.header("cf-connecting-ip");
    if (cfConnectingIp) {
        return cfConnectingIp;
    }

    // Fallback to a default key
    return "unknown";
}

/**
 * Stricter rate limiter for destructive operations
 */
export function strictRateLimiter() {
    return rateLimiter({
        windowMs: 60 * 1000, // 1 minute
        max: 10, // Only 10 destructive operations per minute
        message: "Too many destructive operations, please slow down",
    });
}
