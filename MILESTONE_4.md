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

**Solution:** The remote server does not store any database credentials server-side. Instead:
- Host/port are auto-discovered via the Management API
- Users configure credentials locally (Claude Desktop config or terminal environment variables)
- Credentials are passed as tool parameters for each database operation

**API Capabilities:** The TiDB Cloud Management API provides connection endpoints (host and port) via the `ClusterEndpoints` response. The existing `tidbcloud_get_cluster` and `tidbcloud_list_clusters` tools already display this information. The API does **not** expose database credentials (username/password).

| Available via API | Not Available via API |
|-------------------|----------------------|
| Host (endpoint)   | Username             |
| Port              | Password             |
| Region info       |                      |
| userPrefix        |                      |

#### How It Works

1. User asks to connect to a cluster
2. Claude uses `tidbcloud_get_cluster` to retrieve host/port from the API
3. Claude asks user how they want to configure credentials (Claude Desktop config or terminal)
4. Based on user's choice, Claude provides the appropriate setup instructions
5. For each database operation, credentials are passed as tool parameters

**User Flow:**
```
User: "Connect to my prod-cluster"
Claude: Uses tidbcloud_get_cluster to get endpoint info
Claude: "Found prod-cluster! Here are the connection details:

         Host: gateway01.us-east-1.prod.aws.tidbcloud.com
         Port: 4000
         Username format: 2abc123.root (where 2abc123 is your userPrefix)

         How would you like to configure the database credentials?
         1. Update Claude Desktop config (recommended for persistent setup)
         2. Set environment variables in terminal (for temporary/dev use)"

User: "1"
Claude: "Add these to your claude_desktop_config.json and restart Claude Desktop:

         {
           "mcpServers": {
             "TiDB Cloud": {
               "command": "npx",
               "args": ["-y", "mcp-remote", "https://mcp-server-tidbcloud-remote.vercel.app/mcp"],
               "env": {
                 "TIDB_CLOUD_DB_HOST": "gateway01.us-east-1.prod.aws.tidbcloud.com",
                 "TIDB_CLOUD_DB_USER": "<your-username>",
                 "TIDB_CLOUD_DB_PASSWORD": "<your-password>"
               }
             }
           }
         }

         Replace <your-username> and <your-password> with your credentials."
```

**Alternative: Terminal Setup**
```
User: "2"
Claude: "Run these commands in your terminal before starting Claude:

         export TIDB_CLOUD_DB_HOST='gateway01.us-east-1.prod.aws.tidbcloud.com'
         export TIDB_CLOUD_DB_USER='<your-username>'
         export TIDB_CLOUD_DB_PASSWORD='<your-password>'

         Replace <your-username> and <your-password> with your credentials.
         Note: These variables will only persist for the current terminal session."
```

**Branch Connection:**
```
User: "Connect to dev-branch on prod-cluster"
Claude: Uses tidbcloud_get_branch to get branch endpoint
Claude: "Found dev-branch! Here are the connection details:

         Host: gateway01.us-east-1.prod.aws.tidbcloud.com
         Port: 4001
         Username format: 2abc123.root (where 2abc123 is your userPrefix)

         How would you like to configure the database credentials?
         1. Update Claude Desktop config (recommended for persistent setup)
         2. Set environment variables in terminal (for temporary/dev use)"
```

#### Implementation Details

- **No server-side credential storage**: Remote server does not read or store `TIDB_CLOUD_DB_*` environment variables
- **Database tools** (`show_databases`, `db_query`, `db_execute`, etc.) accept `host`, `username`, `password` parameter overrides
- **Auto-discovery**: Host and port are retrieved via `tidbcloud_get_cluster` / `tidbcloud_get_branch`
- **userPrefix hint**: Username format can be suggested using cluster's `userPrefix` field (e.g., `{userPrefix}.root`)
- **Secure by design**: Credentials stay on user's machine, never transmitted to or stored on the server

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
| P3 | Per-User DB Config (env var guidance) | N/A | ✅ No new tools needed |
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
