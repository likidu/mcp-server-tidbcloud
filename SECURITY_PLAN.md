# Security Enhancement Plan

This document outlines security enhancements for the TiDB Cloud MCP Server, based on analysis of [Neon's MCP Server](https://github.com/neondatabase/mcp-server-neon) and the [MCP Security Best Practices specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices).

## Implementation Status

| # | Enhancement | Priority | Status |
|---|-------------|----------|--------|
| 1 | Read-Only Mode | High | Pending |
| 2 | Security Warnings and Documentation | High | **Completed** |
| 3 | Token Validation and OAuth Improvements | High | Pending |
| 4 | Scope Minimization | Medium | Pending |
| 5 | Input Validation Hardening | Medium | **Completed** |
| 6 | Rate Limiting | Medium | **Completed** |
| 7 | Audit Logging | Medium | Pending |
| 8 | HTTPS Enforcement | High | **Completed** |
| 9 | Environment Variable Security | High | **Completed** |
| 10 | Destructive Operation Safeguards | High | Pending |

## Current State

The remote server currently:
- Supports API key authentication via environment variables
- Has OAuth scaffolding in place but not fully implemented
- Allows unauthenticated access to `/mcp` endpoint for testing
- No read-only mode
- No tool filtering based on permissions

## Security Enhancements

### 1. Read-Only Mode

**Priority: High**

Implement a read-only mode that restricts available tools to non-destructive operations only.

#### Implementation

```typescript
// Tools available in read-only mode
const READ_ONLY_TOOLS = [
  'tidbcloud_list_clusters',
  'tidbcloud_get_cluster',
  'tidbcloud_list_branches',
  'tidbcloud_get_branch',
  'tidbcloud_list_regions',
  'show_databases',
  'show_tables',
  'db_query',  // Only SELECT, SHOW, DESCRIBE, EXPLAIN
];

// Tools requiring full access (disabled in read-only mode)
const WRITE_TOOLS = [
  'tidbcloud_create_cluster',
  'tidbcloud_update_cluster',
  'tidbcloud_delete_cluster',
  'tidbcloud_create_branch',
  'tidbcloud_delete_branch',
  'db_execute',
  'db_create_user',
  'db_remove_user',
];
```

#### Configuration Options

1. **Environment variable**: `MCP_READ_ONLY=true`
2. **Request header**: `x-read-only: true`
3. **OAuth scope**: During OAuth consent, user can uncheck "Full access"

#### Important Note

Like Neon, read-only mode restricts which *tools* are available, not the SQL content within `db_query`. For true read-only SQL access, users should use database roles with restricted permissions.

---

### 2. Security Warnings and Documentation

**Priority: High** | **Status: Completed**

Add clear security warnings following Neon's approach.

#### Implementation (Completed)

**Landing Page** (`packages/remote/src/landing.ts`):
- Added yellow warning box with security notice
- Lists key security considerations
- Links to MCP Security Best Practices documentation

**README.md**:
- Added comprehensive Security section
- Covers API key security, environment variable handling
- Documents read-only mode behavior
- Links to MCP security best practices

---

### 3. Token Validation and OAuth Improvements

**Priority: High**

Current OAuth implementation needs hardening per MCP spec.

#### Required Improvements

1. **Token Audience Validation**
   ```typescript
   // Verify token was issued for this MCP server
   if (token.aud !== config.server.serverUrl) {
     throw new Error('Token audience mismatch');
   }
   ```

2. **Token Introspection**
   - Validate tokens against TiDB Cloud's OAuth server
   - Check token expiration
   - Verify scopes match requested operations

3. **Prevent Token Passthrough**
   - Never accept tokens not explicitly issued for this MCP server
   - This prevents confused deputy attacks

4. **Session ID Security**
   - Generate cryptographically secure session IDs
   - Bind session IDs to user identity
   - Implement session expiration (currently 30 min, good)
   - Never use sessions for authentication alone

---

### 4. Scope Minimization

**Priority: Medium**

Implement granular scopes instead of all-or-nothing access.

#### Proposed Scopes

| Scope | Description | Tools |
|-------|-------------|-------|
| `mcp:read` | Read-only access to clusters and branches | list_*, get_*, show_*, db_query |
| `mcp:write` | Create/update clusters and branches | create_*, update_* |
| `mcp:delete` | Delete clusters and branches | delete_* |
| `mcp:sql` | Execute SQL statements | db_execute |
| `mcp:admin` | User management | db_create_user, db_remove_user |

#### Progressive Authorization

1. Start with minimal scopes (`mcp:read`)
2. Challenge for elevated scopes when write operations are attempted
3. Allow users to grant specific scopes incrementally

---

### 5. Input Validation Hardening

**Priority: Medium** | **Status: Completed**

Already using Zod for schema validation, but additional checks needed.

#### Implementation (Completed)

**Enhanced SQL validation** (`packages/server/src/db/client.ts`):
- `isReadOnlyQuery()` now blocks dangerous patterns even in SELECT statements
- Blocked patterns include: `INTO OUTFILE`, `INTO DUMPFILE`, `LOAD_FILE`, `LOAD DATA`, `BENCHMARK`, `SLEEP`, `GET_LOCK`, `RELEASE_LOCK`, system variable access (`@@global`, `@@session`)

**New validation utilities** (`packages/server/src/db/client.ts`):
- `isValidResourceId()`: Validates cluster/branch ID format
- `sanitizeDisplayName()`: Removes potentially dangerous characters from display names

---

### 6. Rate Limiting

**Priority: Medium** | **Status: Completed**

Protect against abuse and DoS attacks.

#### Implementation (Completed)

**Rate limiter middleware** (`packages/remote/src/middleware/rateLimit.ts`):
- In-memory rate limiting (for single-instance deployment)
- 100 requests per minute per IP for `/mcp` endpoint
- Returns proper `429 Too Many Requests` with `Retry-After` header
- Sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers
- Includes `strictRateLimiter()` for destructive operations (10/min)
- Automatic cleanup of expired entries

**Integration** (`packages/remote/src/app.ts`):
- Rate limiter applied to `/mcp` endpoint

---

### 7. Audit Logging

**Priority: Medium**

Track all operations for security monitoring.

#### Log Format

```typescript
interface AuditLog {
  timestamp: string;
  requestId: string;
  userId?: string;
  sessionId?: string;
  tool: string;
  parameters: Record<string, unknown>; // Redact sensitive values
  result: 'success' | 'error';
  errorMessage?: string;
  duration: number;
  ipAddress: string;
}
```

#### What to Log

- All tool invocations
- Authentication attempts (success/failure)
- Authorization failures
- SQL queries executed (without sensitive data)
- Cluster/branch creation/deletion

#### What NOT to Log

- Passwords
- API keys
- Full SQL query results
- Bearer tokens

---

### 8. HTTPS Enforcement

**Priority: High (for production)** | **Status: Completed**

#### Implementation (Completed)

**Security middleware** (`packages/remote/src/middleware/security.ts`):
- `httpsEnforcement()`: Redirects HTTP to HTTPS in production (`NODE_ENV=production`)
- `securityHeaders()`: Adds security headers to all responses:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - CSP for landing page
- `requestId()`: Adds unique request ID for tracing/audit

**Integration** (`packages/remote/src/app.ts`):
- All security middleware applied globally

**Vercel**: Already enforces HTTPS by default.

---

### 9. Environment Variable Security

**Priority: High** | **Status: Completed**

#### Implementation (Completed)

**Configuration utilities** (`packages/remote/src/config.ts`):
- `redactSensitiveData()`: Recursively redacts sensitive fields (privateKey, clientSecret, password, token, secret, apiKey, authorization)
- `validateConfig()`: Validates required configuration on startup
  - Throws error in production if no auth configured
  - Warns in development mode
  - Logs safe (redacted) configuration on startup
- `getSafeConfig()`: Returns redacted config for safe logging
- `ConfigValidationError`: Custom error class for config issues

**Integration** (`packages/remote/src/app.ts`):
- Config validated on startup
- Production: exits with error if invalid
- Development: warns but continues

---

### 10. Destructive Operation Safeguards

**Priority: High**

Additional protections for dangerous operations.

#### Delete Operations

1. **Confirmation requirement**: Consider requiring a confirmation parameter
   ```typescript
   const DeleteClusterInputSchema = z.object({
     clusterId: z.string(),
     confirm: z.literal(true).describe('Must be true to confirm deletion'),
   });
   ```

2. **Cooldown period**: Rate limit delete operations more strictly

3. **Audit trail**: Always log delete operations with full context

#### SQL Execute

1. **Transaction boundaries**: Consider wrapping in transactions with rollback option
2. **Statement limits**: Limit number of statements per call
3. **Size limits**: Limit result set sizes to prevent memory exhaustion

---

## Implementation Priority

| Phase | Items | Effort |
|-------|-------|--------|
| **Phase 1** | Read-only mode, Security warnings, HTTPS enforcement | 1-2 days |
| **Phase 2** | Token validation, Audit logging, Rate limiting | 2-3 days |
| **Phase 3** | Scope minimization, Input validation hardening | 2-3 days |
| **Phase 4** | Full OAuth flow with TiDB Cloud Partner Program | Depends on partner approval |

---

## References

- [MCP Security Best Practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices)
- [MCP Authorization Tutorial](https://modelcontextprotocol.io/docs/tutorials/security/authorization)
- [Neon MCP Server Security](https://neon.com/docs/ai/neon-mcp-server)
- [OAuth 2.1 Specification](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-13)
- [RFC 9728 - Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
