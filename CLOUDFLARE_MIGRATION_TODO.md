# Cloudflare Migration TODO

This document tracks items to address when migrating from Vercel to Cloudflare Workers.

## Overview

The remote MCP server is currently deployed on Vercel with:
- Hono web framework (already Cloudflare-compatible)
- Upstash Redis for OAuth state storage (already Cloudflare-compatible)
- Node.js serverless functions

## Migration Tasks

### 1. Create Cloudflare Workers Project

- [ ] Initialize a new Cloudflare Workers project with `wrangler init`
- [ ] Configure `wrangler.toml` with project settings
- [ ] Set up environment variables in Cloudflare dashboard or `wrangler.toml`

### 2. Update Hono Adapter

Current (Vercel):
```typescript
import { handle } from "@hono/node-server/vercel";
export default handle(app);
```

Change to (Cloudflare):
```typescript
export default app;
// Cloudflare Workers natively supports Hono's fetch handler
```

### 3. OAuth Store - Already Compatible

The current implementation uses `@upstash/redis` which works on both platforms:

```typescript
import { Redis } from "@upstash/redis";
const redis = Redis.fromEnv();
```

Environment variables needed in Cloudflare:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

**Alternative: Cloudflare KV**

If you prefer native Cloudflare KV instead of Upstash Redis:

1. Create a new store implementation in `src/store/cloudflare-kv.ts`:

```typescript
import type { OAuthStore, AuthorizationState, AuthorizationCode } from "./types.js";

const STATE_PREFIX = "oauth:state:";
const CODE_PREFIX = "oauth:code:";

export class CloudflareKVStore implements OAuthStore {
  constructor(private kv: KVNamespace) {}

  async setState(key: string, data: AuthorizationState, ttlSeconds: number): Promise<void> {
    await this.kv.put(`${STATE_PREFIX}${key}`, JSON.stringify(data), {
      expirationTtl: ttlSeconds,
    });
  }

  async getState(key: string): Promise<AuthorizationState | null> {
    const data = await this.kv.get(`${STATE_PREFIX}${key}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  async deleteState(key: string): Promise<void> {
    await this.kv.delete(`${STATE_PREFIX}${key}`);
  }

  async setCode(key: string, data: AuthorizationCode, ttlSeconds: number): Promise<void> {
    await this.kv.put(`${CODE_PREFIX}${key}`, JSON.stringify(data), {
      expirationTtl: ttlSeconds,
    });
  }

  async getAndDeleteCode(key: string): Promise<AuthorizationCode | null> {
    const fullKey = `${CODE_PREFIX}${key}`;
    const data = await this.kv.get(fullKey);
    if (!data) return null;
    await this.kv.delete(fullKey);
    return JSON.parse(data);
  }
}
```

2. Update `src/store/index.ts` to use CloudflareKVStore:

```typescript
import { CloudflareKVStore } from "./cloudflare-kv.js";

// In Cloudflare Workers, KV namespace is passed via env bindings
export function getStore(env: { OAUTH_KV: KVNamespace }): OAuthStore {
  return new CloudflareKVStore(env.OAUTH_KV);
}
```

3. Configure KV namespace in `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "OAUTH_KV"
id = "your-kv-namespace-id"
```

### 4. API Route Structure

Current Vercel structure:
```
packages/remote/
├── api/
│   ├── index.ts      # Main Hono handler
│   ├── mcp.ts        # MCP endpoint
│   ├── register.ts   # OAuth register
│   ├── token.ts      # OAuth token
│   └── oauth-callback.ts
└── src/
    └── app.ts        # Hono app
```

Cloudflare Workers structure:
```
packages/remote/
├── src/
│   ├── index.ts      # Worker entry point (exports app)
│   └── app.ts        # Hono app (mostly unchanged)
└── wrangler.toml
```

### 5. Environment Variables

Migrate these environment variables to Cloudflare:

| Variable | Description |
|----------|-------------|
| `TIDB_CLOUD_ENV` | `dev` or `prod` |
| `TIDB_CLOUD_OAUTH_CLIENT_ID` | OAuth client ID |
| `TIDB_CLOUD_OAUTH_CLIENT_SECRET` | OAuth client secret (use secrets) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token (use secrets) |

Use `wrangler secret put` for sensitive values:
```bash
wrangler secret put TIDB_CLOUD_OAUTH_CLIENT_SECRET
wrangler secret put UPSTASH_REDIS_REST_TOKEN
```

### 6. Remove Vercel-Specific Code

- [ ] Remove `vercel.json`
- [ ] Remove `@hono/node-server` dependency (use `hono/cloudflare-workers`)
- [ ] Remove direct Node.js API handlers (`api/*.ts`)
- [ ] Consolidate all routes into Hono app

### 7. Update package.json

Remove Vercel-specific scripts and add Cloudflare:

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "tail": "wrangler tail"
  }
}
```

### 8. OAuth Callback URL

Update the OAuth callback URL registered with TiDB Cloud:
- From: `https://mcp-server-tidbcloud-remote.vercel.app/oauth/callback`
- To: `https://your-worker.your-subdomain.workers.dev/oauth/callback`

Or use a custom domain on Cloudflare.

### 9. Testing Checklist

After migration, verify:

- [ ] `/.well-known/oauth-authorization-server` returns correct metadata
- [ ] `/.well-known/oauth-protected-resource` returns correct metadata
- [ ] `/api/register` accepts POST and returns client credentials
- [ ] `/api/authorize` redirects to TiDB Cloud OAuth
- [ ] `/oauth/callback` exchanges code and redirects back
- [ ] `/api/token` exchanges authorization code for access token
- [ ] `/mcp` returns 401 without auth, works with valid token
- [ ] Full OAuth flow works with `mcp-remote`

### 10. Performance Considerations

Cloudflare Workers advantages:
- Edge deployment (lower latency globally)
- No cold starts
- 0ms startup time

Consider:
- [ ] Enable Cloudflare caching for static responses
- [ ] Use Durable Objects if you need stronger consistency than KV

## Dependencies to Update

| Current | Cloudflare Alternative |
|---------|----------------------|
| `@hono/node-server` | Remove (Hono works natively) |
| `@upstash/redis` | Keep (works on CF) or use Cloudflare KV |

## Timeline Estimate

1. Initial setup and configuration: 1-2 hours
2. Code migration: 2-4 hours
3. Testing and debugging: 2-4 hours
4. DNS and OAuth callback update: 1 hour

Total: ~1 day

## Resources

- [Hono on Cloudflare Workers](https://hono.dev/getting-started/cloudflare-workers)
- [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare KV documentation](https://developers.cloudflare.com/kv/)
- [Upstash Redis on Cloudflare](https://upstash.com/docs/redis/quickstarts/cloudflare-workers)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
