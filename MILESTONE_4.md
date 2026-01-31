# Milestone 4: Production Hardening & Future Enhancements

This document outlines the current status and future improvements for the TiDB Cloud MCP Server on Vercel.

## Current Status

### Completed

- ✅ MCP Server working on Vercel at `https://mcp-server-tidbcloud-remote.vercel.app/mcp`
- ✅ Streamable HTTP transport with stateless mode
- ✅ All 16 tools registered (region, cluster, branch, database tools)
- ✅ Landing page and health check endpoints via Hono
- ✅ **OAuth 2.1 Authorization Proxy** - Full implementation with PKCE support
- ✅ **Dynamic Client Registration** (RFC 7591) - Clients can self-register
- ✅ **Upstash Redis Integration** - State and authorization code storage
- ✅ **Security Middleware** - HTTPS enforcement, security headers, request ID tracking
- ✅ **Bearer Token Authentication** - MCP endpoint requires valid OAuth tokens
- ✅ **OAuth Metadata Discovery** (RFC 8414) - `.well-known/oauth-authorization-server`

### OAuth Implementation Details

The remote server implements a complete OAuth 2.1 authorization proxy for TiDB Cloud:

| Component | Endpoint | Description |
|-----------|----------|-------------|
| Client Registration | `/api/register` | Dynamic client registration (RFC 7591) |
| Authorization | `/api/authorize` | Initiates OAuth flow, redirects to TiDB Cloud |
| Callback | `/api/oauth-callback` | Handles TiDB Cloud redirect, exchanges code for tokens |
| Token | `/api/token` | Issues authorization codes, handles refresh grants |
| Metadata | `/.well-known/oauth-authorization-server` | OAuth server discovery |

**Security Features:**
- PKCE support (S256 and plain methods)
- One-time authorization codes (5-minute TTL, deleted after use)
- State expiration (10-minute TTL with timestamp validation)
- Serverless-compatible state encoding in URL parameters

### Upstash Redis Storage

OAuth state and authorization codes are stored in Upstash Redis:
- State keys: `oauth:state:<key>` with 600s TTL
- Code keys: `oauth:code:<key>` with 300s TTL
- Atomic `getAndDeleteCode()` for one-time code use

### Security Middleware

Production security headers applied to all responses:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- Content Security Policy for HTML pages
- HTTPS enforcement with 301 redirects
- Unique request ID tracking

## Priority 1: Security Improvements

### 1.1 Rate Limiting (High Priority)

**Status:** Not implemented

**Problem:** The current deployment has no per-client or per-IP rate limiting. The system relies only on OAuth state TTLs.

**Recommended Solution:** Use [@upstash/ratelimit](https://github.com/upstash/ratelimit) since Upstash Redis is already integrated.

```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(100, '1 m'), // 100 requests per minute
});

async function checkRateLimit(identifier: string): Promise<boolean> {
  const { success } = await ratelimit.limit(identifier);
  return success;
}
```

### 1.2 API Key Protection

**Status:** ✅ Implemented via OAuth

TiDB Cloud API access is now protected via OAuth 2.1:
- Users authenticate with their own TiDB Cloud credentials
- No shared API keys in environment variables
- Bearer tokens required for MCP endpoint access

### 1.3 Request Validation

**Status:** Partial

- ✅ OAuth state validation with expiration checks
- ✅ PKCE code verifier validation
- ✅ Redirect URI validation
- ⬚ Input validation for all tool parameters
- ⬚ Request size limits
- ⬚ Timeout handling for long-running operations

## Priority 2: Reliability Improvements

### 2.1 Error Handling

**Status:** Partial

- ✅ Structured OAuth error responses
- ✅ HTTP status codes for authentication failures
- ⬚ Retry logic for transient TiDB Cloud API failures
- ⬚ Circuit breaker pattern for API calls

### 2.2 Monitoring & Observability

**Status:** Partial

- ✅ Vercel Analytics integration
- ✅ Request ID tracking for tracing
- ⬚ Structured logging
- ⬚ Alerts for error rates

### 2.3 Health Checks

**Status:** Basic

- ✅ `/health` endpoint available
- ⬚ TiDB Cloud API connectivity check
- ⬚ Redis connectivity check
- ⬚ Readiness vs liveness differentiation

## Priority 3: Feature Enhancements

### 3.1 OAuth Enhancements

**Status:** Core complete, enhancements pending

- ✅ OAuth 2.1 with PKCE
- ✅ Dynamic client registration
- ⬚ Token revocation endpoint
- ⬚ Refresh token rotation
- ⬚ Scope-based access control

### 3.2 Additional Tools

Consider adding tools for:

- **Import/Export** - Data import and export operations
- **Backup/Restore** - Backup management
- **Metrics** - Cluster performance metrics
- **Billing** - Cost and usage information

### 3.3 Multi-Cluster Support

- Support multiple TiDB Cloud organizations
- Add cluster aliasing for easier reference

### 3.4 Per-User Database Configuration (UX Improvement)

**Status:** Not implemented

**Problem:** Currently, database credentials (`TIDB_CLOUD_DB_HOST`, `TIDB_CLOUD_DB_USER`, `TIDB_CLOUD_DB_PASSWORD`) are hardcoded in environment variables. However, each user connecting via OAuth has their own clusters and databases. This creates a poor UX where:
- All users share the same database connection
- Users cannot connect to their own clusters
- Manual credential entry is required for each SQL tool call

**Comparison with Neon:** The Neon MCP server doesn't require explicit database credentials because their Management API provides a `get_connection_string` endpoint that returns full connection details. TiDB Cloud's Management API does not expose database credentials, requiring a different approach.

#### Solution A: Connection Profile Tool

Add a `set_database_connection` tool that stores connection details in the user's session:

```typescript
// New tool: set_database_connection
{
  name: "set_database_connection",
  description: "Store database connection details for subsequent SQL operations",
  parameters: {
    host: { type: "string", required: true },
    username: { type: "string", required: true },
    password: { type: "string", required: true },
    database: { type: "string", required: false }
  }
}
```

**Implementation:**
- Store connection in Redis: `db:connection:{user_token_hash}` with session TTL (e.g., 1 hour)
- Encrypt password before storage
- SQL tools (`db_query`, `db_execute`, etc.) check Redis for stored connection before falling back to env vars
- Add `clear_database_connection` tool to remove stored credentials

**User Flow:**
```
User: "Connect to my database at gateway01.us-east-1.prod.aws.tidbcloud.com"
Claude: Uses set_database_connection tool
User: Provides username and password when prompted
Claude: "Connected! You can now run queries against your database."
User: "Show me all tables"
Claude: Uses db_query with stored connection (no re-prompting)
```

#### Solution B: Cluster Selection Tool

Add a `select_cluster` tool that leverages the Management API to simplify connection:

```typescript
// New tool: select_cluster
{
  name: "select_cluster",
  description: "List and select a cluster to connect to",
  parameters: {
    project_id: { type: "string", required: false },
    cluster_id: { type: "string", required: false }
  }
}
```

**Implementation:**
1. Use OAuth token to call Management API (`list_clusters`)
2. Display available clusters to user
3. When user selects a cluster, retrieve connection endpoint via API
4. Prompt user for database password only (username can be derived or prompted)
5. Store connection using Solution A's mechanism

**User Flow:**
```
User: "Connect to my TiDB cluster"
Claude: Uses select_cluster tool → "You have 3 clusters:
  1. prod-cluster (us-east-1) - AVAILABLE
  2. dev-cluster (us-west-2) - AVAILABLE  
  3. test-cluster (eu-west-1) - MAINTENANCE
  Which one would you like to use?"
User: "Use prod-cluster"
Claude: "Please provide the database password for prod-cluster"
User: Provides password
Claude: "Connected to prod-cluster! Ready for queries."
```

#### Recommended Approach

Implement both solutions together:
1. **`select_cluster`** - For discovery and easy cluster selection (leverages OAuth)
2. **`set_database_connection`** - For direct connection or after cluster selection
3. **`get_database_connection`** - Show current active connection (masked password)
4. **`clear_database_connection`** - Disconnect / clear stored credentials

This provides flexibility:
- Power users can directly set connection details
- New users can browse and select from their clusters
- Credentials persist within session (no repeated prompts)
- Secure storage with encryption and TTL

## Priority 4: Developer Experience

### 4.1 Local Development

- ⬚ Improve local MCP testing workflow
- ⬚ Add mock TiDB Cloud API for development
- ⬚ Create integration test suite

### 4.2 Documentation

- ✅ Landing page with tool documentation
- ✅ Quick-start guide on landing page
- ⬚ API reference documentation
- ⬚ Example prompts for Claude
- ⬚ Document common error scenarios

### 4.3 CI/CD

- ⬚ GitHub Actions for automated testing
- ⬚ Preview deployments for PRs
- ⬚ Automated dependency updates

## Implementation Timeline

| Priority | Item | Estimated Effort | Status |
|----------|------|------------------|--------|
| P1 | OAuth 2.1 Implementation | 8-12 hours | ✅ Complete |
| P1 | Upstash Redis Integration | 2-3 hours | ✅ Complete |
| P1 | Security Middleware | 2-3 hours | ✅ Complete |
| P1 | Rate Limiting (Upstash) | 1-2 hours | Not started |
| P1 | Request Validation | 2-3 hours | Partial |
| P2 | Enhanced Health Checks | 1-2 hours | Not started |
| P2 | Structured Logging | 1-2 hours | Not started |
| P3 | Token Revocation | 2-3 hours | Not started |
| P3 | Additional Tools | 4-8 hours each | Not started |
| P3 | Per-User DB Config (Connection Profile) | 3-4 hours | Not started |
| P3 | Per-User DB Config (Cluster Selection) | 4-6 hours | Not started |
| P4 | Integration Tests | 4-6 hours | Not started |

## Architecture Notes

### Current Flow (with OAuth)

```
Claude Desktop / MCP Client
    ↓
OAuth Discovery (/.well-known/oauth-authorization-server)
    ↓
Dynamic Client Registration (/api/register)
    ↓
Authorization (/api/authorize) → TiDB Cloud OAuth
    ↓
Callback (/api/oauth-callback) → Token Exchange
    ↓
MCP Requests with Bearer Token (/mcp)
    ↓
Vercel Serverless Function (api/mcp.ts)
    ↓
@modelcontextprotocol/sdk (StreamableHTTPServerTransport)
    ↓
Tool handlers → TiDB Cloud API (with user's token)
```

### File Structure

```
packages/remote/
├── api/
│   ├── index.ts           # Hono app for landing/health
│   ├── mcp.ts             # MCP endpoint with Bearer auth
│   ├── oauth-callback.ts  # OAuth callback handler
│   ├── register.ts        # Dynamic client registration
│   └── token.ts           # Token endpoint
├── src/
│   ├── app.ts             # Hono app with OAuth routes
│   ├── config.ts          # Configuration management
│   ├── dev.ts             # Local development server
│   ├── landing.ts         # Landing page HTML
│   ├── oauth-state.ts     # State encoding/decoding
│   ├── middleware/
│   │   └── security.ts    # Security headers & HTTPS
│   └── store/
│       ├── index.ts       # Store abstraction
│       ├── types.ts       # TypeScript interfaces
│       └── upstash.ts     # Upstash Redis implementation
└── vercel.json            # Vercel routing configuration
```

### Key Dependencies

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `hono` + `@hono/node-server` - Web framework
- `@upstash/redis` - Redis for OAuth state storage
- `@vercel/analytics` - Analytics tracking
- `@vercel/node` - Vercel serverless types

## Notes

- The MCP endpoint uses stateless mode (no session management) which is ideal for serverless
- Each request creates a new McpServer instance - this is by design for serverless
- OAuth state is encoded in URL parameters for serverless compatibility
- Upstash Redis provides persistent storage for authorization codes (one-time use)
- Security headers are applied globally via Hono middleware
