# Milestone 4: Production Hardening & Future Enhancements

This document outlines future improvements for the TiDB Cloud MCP Server after the initial Vercel deployment is working.

## Current Status (Completed)

- ✅ MCP Server working on Vercel at `https://mcp-server-tidbcloud-remote.vercel.app/mcp`
- ✅ Streamable HTTP transport with stateless mode
- ✅ All 16 tools registered (region, cluster, branch, database tools)
- ✅ Landing page and health check endpoints via Hono
- ✅ Code cleanup (removed unused OAuth and rate limiting code)

## Priority 1: Security Improvements

### 1.1 Rate Limiting (High Priority)

**Problem:** The current deployment has no rate limiting. The in-memory rate limiter was removed because it doesn't work in serverless environments (each request may hit a different instance).

**Solution Options:**

1. **Vercel KV Rate Limiting** (Recommended)
   - Use [Vercel KV](https://vercel.com/docs/storage/vercel-kv) for distributed rate limiting
   - Implement sliding window algorithm
   - Estimated effort: 2-4 hours

   ```typescript
   // Example implementation
   import { kv } from '@vercel/kv';
   
   async function checkRateLimit(ip: string): Promise<boolean> {
     const key = `ratelimit:${ip}`;
     const count = await kv.incr(key);
     if (count === 1) {
       await kv.expire(key, 60); // 60 second window
     }
     return count <= 100; // 100 requests per minute
   }
   ```

2. **Upstash Redis** (Alternative)
   - Use [@upstash/ratelimit](https://github.com/upstash/ratelimit) package
   - Ready-made sliding window implementation
   - Free tier available

3. **Vercel Edge Middleware** (Simplest)
   - Use Vercel's built-in rate limiting via Edge Config
   - Less flexible but zero additional infrastructure

**Recommendation:** Start with Vercel KV for simplicity since you're already on Vercel.

### 1.2 API Key Protection

**Current State:** TiDB Cloud API keys are stored as Vercel environment variables (secure) but anyone can call the MCP endpoint.

**Future Options:**

1. **MCP Authentication** - When MCP spec adds authentication support, implement it
2. **IP Allowlisting** - Restrict to known Claude Desktop IPs (if available)
3. **Custom API Key** - Add a custom header requirement for accessing the endpoint

### 1.3 Request Validation

- Add input validation for all tool parameters
- Implement request size limits
- Add timeout handling for long-running operations

## Priority 2: Reliability Improvements

### 2.1 Error Handling

- Add structured error responses with error codes
- Implement retry logic for transient TiDB Cloud API failures
- Add circuit breaker pattern for API calls

### 2.2 Monitoring & Observability

- Add Vercel Analytics integration
- Implement structured logging
- Add request tracing (correlation IDs)
- Set up alerts for error rates

### 2.3 Health Checks

- Enhance `/health` endpoint to check TiDB Cloud API connectivity
- Add readiness vs liveness differentiation

## Priority 3: Feature Enhancements

### 3.1 OAuth Authentication (When Available)

TiDB Cloud may add OAuth support in the future. When available:

- Implement OAuth 2.0 PKCE flow
- Support per-user authentication
- Remove need for shared API keys

### 3.2 Additional Tools

Consider adding tools for:

- **Import/Export** - Data import and export operations
- **Backup/Restore** - Backup management
- **Metrics** - Cluster performance metrics
- **Billing** - Cost and usage information

### 3.3 Multi-Cluster Support

- Support multiple TiDB Cloud organizations
- Add cluster aliasing for easier reference

## Priority 4: Developer Experience

### 4.1 Local Development

- Improve local MCP testing workflow
- Add mock TiDB Cloud API for development
- Create integration test suite

### 4.2 Documentation

- Add API reference documentation
- Create example prompts for Claude
- Document common error scenarios

### 4.3 CI/CD

- Add GitHub Actions for automated testing
- Implement preview deployments for PRs
- Add automated dependency updates

## Implementation Timeline

| Priority | Item | Estimated Effort | Dependencies |
|----------|------|------------------|--------------|
| P1 | Rate Limiting (Vercel KV) | 2-4 hours | Vercel KV setup |
| P1 | Request Validation | 2-3 hours | None |
| P2 | Structured Logging | 1-2 hours | None |
| P2 | Enhanced Health Checks | 1 hour | None |
| P3 | Additional Tools | 4-8 hours each | TiDB Cloud API support |
| P4 | Integration Tests | 4-6 hours | None |

## Architecture Notes

### Current Flow

```
Claude Desktop
    ↓
Settings → Connectors → Add custom connector
    ↓
https://mcp-server-tidbcloud-remote.vercel.app/mcp
    ↓
Vercel Serverless Function (api/mcp.ts)
    ↓
@modelcontextprotocol/sdk (StreamableHTTPServerTransport)
    ↓
Tool handlers → TiDB Cloud API
```

### File Structure

```
packages/remote/
├── api/
│   ├── index.ts      # Hono app for landing/health (via @hono/node-server/vercel)
│   └── mcp.ts        # MCP endpoint (raw Vercel function)
├── src/
│   ├── app.ts        # Hono app definition
│   ├── config.ts     # Configuration
│   ├── dev.ts        # Local development server
│   ├── landing.ts    # Landing page HTML
│   └── middleware/
│       └── security.ts  # Security headers
└── vercel.json       # Vercel routing configuration
```

### Key Dependencies

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `hono` + `@hono/node-server` - Web framework for non-MCP endpoints
- `@vercel/node` - Vercel serverless types

## Notes

- The MCP endpoint uses stateless mode (no session management) which is ideal for serverless
- Each request creates a new McpServer instance - this is by design for serverless
- Hono is kept for the landing page and health check - could be removed if minimal footprint is preferred
