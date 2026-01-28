/**
 * Security middleware for the remote MCP server
 */

import type { Context, Next } from "hono";

/**
 * Middleware to enforce HTTPS in production environments
 *
 * In production, redirects HTTP requests to HTTPS.
 * Allows HTTP in development for local testing.
 */
export function httpsEnforcement() {
  return async (c: Context, next: Next) => {
    // Skip in development
    if (process.env.NODE_ENV !== "production") {
      return next();
    }

    const proto = c.req.header("x-forwarded-proto");

    // If not HTTPS, redirect
    if (proto && proto !== "https") {
      const host = c.req.header("host");
      const path = c.req.path;
      const query = c.req.url.includes("?")
        ? c.req.url.substring(c.req.url.indexOf("?"))
        : "";

      return c.redirect(`https://${host}${path}${query}`, 301);
    }

    return next();
  };
}

/**
 * Security headers middleware
 *
 * Adds common security headers to responses
 */
export function securityHeaders() {
  return async (c: Context, next: Next) => {
    await next();

    // Prevent MIME type sniffing
    c.header("X-Content-Type-Options", "nosniff");

    // Prevent clickjacking
    c.header("X-Frame-Options", "DENY");

    // XSS protection (legacy, but still useful)
    c.header("X-XSS-Protection", "1; mode=block");

    // Referrer policy
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");

    // Content Security Policy for landing page
    const contentType = c.res.headers?.get?.("content-type") ?? "";
    if (c.req.path === "/" && contentType.includes("text/html")) {
      c.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
      );
    }
  };
}

/**
 * Request ID middleware for audit logging
 *
 * Adds a unique request ID to each request for tracing
 */
export function requestId() {
  return async (c: Context, next: Next) => {
    const id =
      c.req.header("x-request-id") ||
      `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    c.set("requestId", id);
    c.header("X-Request-ID", id);

    return next();
  };
}
