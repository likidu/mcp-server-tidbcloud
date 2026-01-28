# Milestone 3 Plan: Hosted MCP Server with OAuth on Vercel

## Goal

Deploy the TiDB Cloud MCP Server as a hosted remote MCP server on Vercel, supporting both the Streamable HTTP transport and OAuth 2.1 authorization. This enables users to connect without managing API keys locally, similar to the [Neon MCP Server](https://github.com/neondatabase/mcp-server-neon).

## Prerequisites

- Milestone 1 & 2 completed (Cluster, Branch, Region, and SQL tools)
- Vercel account for deployment
- TiDB Cloud OAuth partnership approved (provides `client_id`, `client_secret`, OAuth endpoints)

---

## Part 1: Architecture Overview

### Deployment Model

```
┌─────────────────┐     ┌──────────────────────────────────┐     ┌─────────────────┐
│   MCP Client    │────▶│  TiDB Cloud MCP Server (Vercel)  │────▶│  TiDB Cloud API │
│ (Claude, etc.)  │◀────│  - Hono + Streamable HTTP        │◀────│  (serverless)   │
└─────────────────┘     │  - OAuth 2.1 Authorization       │     └─────────────────┘
                        └──────────────────────────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────────────┐
                        │   TiDB Cloud OAuth Server        │
                        │   (Authorization Server)         │
                        └──────────────────────────────────┘
```

### Key Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| Web Framework | Hono | Lightweight, edge-compatible HTTP framework |
| MCP Transport | Streamable HTTP | Modern MCP transport (replaces SSE) |
| Authorization | OAuth 2.1 | User authentication via TiDB Cloud |
| Deployment | Vercel | Serverless edge deployment |
| Session Storage | Vercel KV (Redis) | Store OAuth tokens and sessions |

---

## Part 2: TiDB Cloud OAuth Integration

### OAuth 2.1 Endpoints (Assumed)

Based on [TiDB Cloud OAuth documentation](https://docs.pingcap.com/tidbcloud/oauth2/), the following endpoints are expected after partnership approval:

| Endpoint | URL (Assumed) |
|----------|---------------|
| Authorization | `https://tidbcloud.com/oauth/authorize` |
| Token | `https://tidbcloud.com/oauth/token` |
| User Info | `https://tidbcloud.com/api/v1/me` |
| Revoke | `https://tidbcloud.com/oauth/revoke` |

### Supported Grant Types

1. **Authorization Code** (Primary) - For web apps and MCP clients
2. **Device Code** (Future) - For CLI tools and input-constrained devices

### OAuth Scopes (Assumed)

| Scope | Description |
|-------|-------------|
| `cluster:read` | Read cluster information |
| `cluster:write` | Create, update, delete clusters |
| `branch:read` | Read branch information |
| `branch:write` | Create, delete branches |
| `sql:read` | Execute read-only SQL queries |
| `sql:write` | Execute data modification SQL |

---

## Part 3: Implementation Plan

### Phase 1: Project Restructure

Create a new `remote` package for the hosted server:

```
packages/
├── server/           # Existing - Core MCP server logic
│   └── src/
│       ├── tools/    # Tool implementations
│       ├── api/      # TiDB Cloud API client
│       └── db/       # Database client
└── remote/           # NEW - Hosted server on Vercel
    ├── src/
    │   ├── app.ts           # Hono app entry
    │   ├── mcp/
    │   │   ├── handler.ts   # MCP Streamable HTTP handler
    │   │   └── session.ts   # Session management
    │   ├── oauth/
    │   │   ├── middleware.ts  # OAuth middleware
    │   │   ├── callback.ts    # OAuth callback handler
    │   │   ├── token.ts       # Token management
    │   │   └── metadata.ts    # Protected Resource Metadata
    │   └── config.ts        # Environment configuration
    ├── vercel.json          # Vercel configuration
    └── package.json
```

### Phase 2: Hono Server Setup

**File**: `packages/remote/src/app.ts`

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { mcpHandler } from "./mcp/handler.js";
import { oauthCallback, oauthAuthorize } from "./oauth/callback.js";
import { protectedResourceMetadata } from "./oauth/metadata.js";

const app = new Hono();

// CORS for MCP clients
app.use("/*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["Authorization", "Content-Type", "Accept", "Mcp-Session-Id"],
}));

// OAuth endpoints
app.get("/oauth/authorize", oauthAuthorize);
app.get("/oauth/callback", oauthCallback);

// Protected Resource Metadata (RFC 9728)
app.get("/.well-known/oauth-protected-resource", protectedResourceMetadata);

// MCP endpoint (Streamable HTTP)
app.post("/mcp", mcpHandler);
app.get("/mcp", mcpHandler);
app.delete("/mcp", mcpHandler);

export default app;
```

### Phase 3: Streamable HTTP Transport

**File**: `packages/remote/src/mcp/handler.ts`

Implement MCP Streamable HTTP transport following the [MCP specification](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports):

1. **POST /mcp** - Receive JSON-RPC requests, return responses (optionally via SSE stream)
2. **GET /mcp** - Open SSE stream for server-initiated messages
3. **DELETE /mcp** - Terminate session

Key requirements:
- Support `Mcp-Session-Id` header for session management
- Return `Content-Type: text/event-stream` or `application/json`
- Validate `Origin` header for security

### Phase 4: OAuth 2.1 Implementation

**File**: `packages/remote/src/oauth/middleware.ts`

```typescript
import { Context, Next } from "hono";
import { verifyAccessToken } from "./token.js";

export async function requireAuth(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  
  if (!authHeader?.startsWith("Bearer ")) {
    // Return 401 with WWW-Authenticate header per RFC 9728
    return c.json(
      { error: "unauthorized" },
      401,
      {
        "WWW-Authenticate": `Bearer resource_metadata="https://${c.req.header("host")}/.well-known/oauth-protected-resource"`,
      }
    );
  }

  const token = authHeader.slice(7);
  const tokenInfo = await verifyAccessToken(token);
  
  if (!tokenInfo) {
    return c.json({ error: "invalid_token" }, 401);
  }

  c.set("user", tokenInfo);
  await next();
}
```

**File**: `packages/remote/src/oauth/metadata.ts`

```typescript
// Protected Resource Metadata (RFC 9728)
export function protectedResourceMetadata(c: Context) {
  const host = c.req.header("host");
  
  return c.json({
    resource: `https://${host}`,
    authorization_servers: ["https://tidbcloud.com"],
    scopes_supported: [
      "cluster:read",
      "cluster:write", 
      "branch:read",
      "branch:write",
      "sql:read",
      "sql:write",
    ],
    bearer_methods_supported: ["header"],
  });
}
```

### Phase 5: Session & Token Storage

**File**: `packages/remote/src/oauth/token.ts`

Use Vercel KV (Redis) for token storage:

```typescript
import { kv } from "@vercel/kv";

interface TokenInfo {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  userId: string;
  scopes: string[];
}

export async function storeToken(sessionId: string, tokenInfo: TokenInfo) {
  await kv.set(`session:${sessionId}`, tokenInfo, {
    ex: 3600 * 24, // 24 hour expiry
  });
}

export async function getToken(sessionId: string): Promise<TokenInfo | null> {
  return kv.get(`session:${sessionId}`);
}

export async function deleteToken(sessionId: string) {
  await kv.del(`session:${sessionId}`);
}
```

### Phase 6: Vercel Deployment Configuration

**File**: `packages/remote/vercel.json`

```json
{
  "buildCommand": "pnpm build",
  "outputDirectory": "dist",
  "framework": null,
  "functions": {
    "api/**/*.ts": {
      "runtime": "@vercel/node@3"
    }
  },
  "rewrites": [
    { "source": "/(.*)", "destination": "/api/index.ts" }
  ]
}
```

**File**: `packages/remote/api/index.ts` (Vercel entry point)

```typescript
import { handle } from "hono/vercel";
import app from "../src/app.js";

export default handle(app);
```

---

## Part 4: Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `packages/remote/package.json` | Remote server package config |
| `packages/remote/tsconfig.json` | TypeScript config |
| `packages/remote/vercel.json` | Vercel deployment config |
| `packages/remote/api/index.ts` | Vercel serverless entry |
| `packages/remote/src/app.ts` | Hono application |
| `packages/remote/src/config.ts` | Environment configuration |
| `packages/remote/src/mcp/handler.ts` | Streamable HTTP handler |
| `packages/remote/src/mcp/session.ts` | MCP session management |
| `packages/remote/src/oauth/middleware.ts` | OAuth authentication middleware |
| `packages/remote/src/oauth/callback.ts` | OAuth callback handler |
| `packages/remote/src/oauth/token.ts` | Token storage & validation |
| `packages/remote/src/oauth/metadata.ts` | RFC 9728 metadata endpoint |

### Modified Files

| File | Changes |
|------|---------|
| `pnpm-workspace.yaml` | Add `packages/remote` |
| `packages/server/package.json` | Export tools for reuse |
| `README.md` | Document hosted server usage |

---

## Part 5: Dependencies

### packages/remote/package.json

```json
{
  "name": "@likidu/mcp-server-tidbcloud-remote",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "hono": "^4.6.0",
    "@hono/node-server": "^1.13.0",
    "@vercel/kv": "^2.0.0",
    "@modelcontextprotocol/sdk": "^1.7.0",
    "@likidu/mcp-server-tidbcloud": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "typescript": "^5.7.2"
  }
}
```

---

## Part 6: MCP Client Configuration

### Claude Desktop (Remote Server)

```json
{
  "mcpServers": {
    "tidbcloud-remote": {
      "url": "https://mcp-tidbcloud.vercel.app/mcp",
      "transport": "streamable-http"
    }
  }
}
```

The OAuth flow will be initiated automatically when the client connects.

---

## Part 7: Environment Variables (Vercel)

| Variable | Description |
|----------|-------------|
| `TIDB_OAUTH_CLIENT_ID` | OAuth client ID from TiDB Cloud partnership |
| `TIDB_OAUTH_CLIENT_SECRET` | OAuth client secret |
| `TIDB_OAUTH_AUTHORIZE_URL` | TiDB Cloud authorization endpoint |
| `TIDB_OAUTH_TOKEN_URL` | TiDB Cloud token endpoint |
| `KV_REST_API_URL` | Vercel KV Redis URL |
| `KV_REST_API_TOKEN` | Vercel KV token |
| `SERVER_HOST` | Server hostname (e.g., mcp-tidbcloud.vercel.app) |

---

## Part 8: Security Considerations

### Transport Security

1. All endpoints served over HTTPS (Vercel default)
2. Validate `Origin` header to prevent DNS rebinding attacks
3. Use `Mcp-Session-Id` for stateful session tracking

### OAuth Security

1. Implement PKCE (Proof Key for Code Exchange) with S256 challenge
2. Validate redirect URIs against pre-registered values
3. Use short-lived access tokens with refresh token rotation
4. Store tokens encrypted in Vercel KV

### Token Handling

1. Never log or expose access tokens
2. Validate token audience matches this server
3. Implement token refresh before expiry
4. Clear tokens on session termination

---

## Part 9: Verification Plan

### Local Testing

```bash
# Start local Hono server
cd packages/remote
pnpm dev

# Test MCP endpoint
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test"}},"id":1}'
```

### Test Scenarios

1. **OAuth Flow**
   - Initiate authorization request
   - Complete OAuth callback
   - Verify token storage
   - Test token refresh

2. **MCP Communication**
   - Initialize session
   - List tools
   - Execute tool calls
   - Terminate session

3. **Error Handling**
   - Invalid token → 401 with WWW-Authenticate
   - Insufficient scope → 403 with required scopes
   - Session not found → 404

---

## Part 10: Rollout Plan

### Phase 1: Local Development (Without OAuth)
- Implement Hono server with Streamable HTTP
- Test with API key authentication (existing method)
- Verify all tools work via HTTP transport

### Phase 2: OAuth Integration (Mock)
- Implement OAuth endpoints with mock authorization server
- Test complete flow locally
- Verify token storage and refresh

### Phase 3: TiDB Cloud OAuth (After Partnership)
- Configure real TiDB Cloud OAuth endpoints
- Test with actual TiDB Cloud accounts
- Deploy to Vercel staging

### Phase 4: Production Deployment
- Deploy to production Vercel
- Monitor for errors and performance
- Document usage instructions

---

## Summary

| Category | Item | Status |
|----------|------|--------|
| Web Framework | Hono | New |
| MCP Transport | Streamable HTTP | New |
| OAuth 2.1 | Authorization Code flow | New |
| Deployment | Vercel serverless | New |
| Session Storage | Vercel KV (Redis) | New |
| **New Package** | `@likidu/mcp-server-tidbcloud-remote` | New |

### Key Features

1. **Hosted MCP Server** - No local installation required
2. **OAuth Authentication** - Users authorize via TiDB Cloud
3. **Streamable HTTP** - Modern MCP transport protocol
4. **Edge Deployment** - Fast, globally distributed via Vercel
5. **Stateless Design** - Serverless-friendly architecture

This milestone transforms the local MCP server into a hosted service that users can connect to without managing credentials locally.
