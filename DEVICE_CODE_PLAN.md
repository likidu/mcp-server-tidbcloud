# OAuth 2.0 Device Code Flow Implementation Plan

## Overview

Add OAuth 2.0 Device Code flow (RFC 8628) support to the **remote MCP server** (`packages/remote/`) alongside the existing Authorization Code flow. This enables the same server to support:

- **Cursor** (and similar clients): Use Authorization Code flow with browser redirects
- **openclaw** (and CLI-based clients): Use Device Code flow for headless authentication

## Background

### Current Remote Server OAuth Support
- **Authorization Code with PKCE** - Browser-based OAuth for clients like Cursor
- **Refresh Token** - Token rotation for long-lived sessions

### Why Add Device Code Flow?
- MCP clients like "openclaw" run in terminal/headless environments
- Cannot handle browser redirects required by Authorization Code flow
- Device Code flow allows authentication via a separate browser session
- Both flows share the same token endpoint and produce compatible Bearer tokens

## Architecture: Dual OAuth Flow Support

```
                    MCP Client
                        │
        ┌───────────────┼───────────────┐
        │               │               │
        ▼               │               ▼
  ┌─────────────┐       │       ┌───────────────┐
  │   Cursor    │       │       │   openclaw    │
  │ (has browser)│      │       │ (headless)    │
  └──────┬──────┘       │       └───────┬───────┘
         │              │               │
         ▼              │               ▼
  ┌─────────────┐       │       ┌───────────────┐
  │ Auth Code   │       │       │ Device Code   │
  │    Flow     │       │       │    Flow       │
  └──────┬──────┘       │       └───────┬───────┘
         │              │               │
         └──────────────┼───────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │  /api/token     │
              │ (unified)       │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  Bearer Token   │
              │  for /mcp       │
              └─────────────────┘
```

## TiDB Cloud Device Code Endpoints

### Environment-Based OAuth Base URLs

| Environment | OAuth Base URL |
|-------------|----------------|
| **dev** | `https://oauth.dev.tidbcloud.com` |
| **prod** | `https://oauth.tidbcloud.com` |

### Endpoint Paths

| Endpoint | Path |
|----------|------|
| Device Authorization | `/v1/device_authorization` |
| Token Exchange | `/v1/token` |

### OAuth Client Credentials

Device Code flow uses the **same OAuth credentials** as Authorization Code flow:
```
TIDB_CLOUD_OAUTH_CLIENT_ID=your-oauth-client-id
TIDB_CLOUD_OAUTH_CLIENT_SECRET=your-oauth-client-secret
```

Both grant types are supported by the same OAuth client - no additional credentials needed.

## Device Code Flow (RFC 8628)

```
┌──────────┐                    ┌──────────────┐                    ┌─────────────┐
│ MCP      │                    │ Remote MCP   │                    │ TiDB Cloud  │
│ Client   │                    │ Server       │                    │ OAuth       │
└────┬─────┘                    └──────┬───────┘                    └──────┬──────┘
     │                                 │                                   │
     │ 1. POST /api/device/code        │                                   │
     │ ───────────────────────────────>│                                   │
     │                                 │ 2. POST /v1/device_authorization  │
     │                                 │ ─────────────────────────────────>│
     │                                 │                                   │
     │                                 │ 3. {device_code, user_code, ...}  │
     │                                 │ <─────────────────────────────────│
     │ 4. {user_code, verification_uri}│                                   │
     │ <───────────────────────────────│                                   │
     │                                 │                                   │
     │ 5. POST /api/token              │                                   │
     │    grant_type=device_code       │                                   │
     │    device_code=xxx              │                                   │
     │ ───────────────────────────────>│                                   │
     │                                 │ 6. POST /v1/token                 │
     │                                 │    grant_type=device_code         │
     │                                 │ ─────────────────────────────────>│
     │                                 │                                   │
     │                                 │ 7. {authorization_pending} or     │
     │                                 │    {access_token, refresh_token}  │
     │                                 │ <─────────────────────────────────│
     │ 8. Same response                │                                   │
     │ <───────────────────────────────│                                   │
     │                                 │                                   │
     │ (Client polls until authorized) │                                   │
     │                                 │                                   │
     │ 9. Use Bearer token for /mcp    │                                   │
     │ ───────────────────────────────>│                                   │
```

## Implementation Plan

### Phase 1: Add Device Authorization Endpoint

#### 1.1 Create `/packages/remote/api/device.ts`

New endpoint to initiate device code flow:

```typescript
// POST /api/device/code
// Proxies to TiDB Cloud's device authorization endpoint

interface DeviceCodeRequest {
  client_id: string;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}
```

**Implementation:**
1. Accept client_id from MCP client
2. Forward request to TiDB Cloud's `/v1/device_authorization`
3. Return device code response to client

#### 1.2 Add Route in `/packages/remote/src/app.ts`

```typescript
// Add new route
app.post("/api/device/code", async (c) => {
  // Handle device code request
});
```

### Phase 2: Extend Token Endpoint

#### 2.1 Modify `/packages/remote/api/token.ts`

Add support for `urn:ietf:params:oauth:grant-type:device_code` grant type:

```typescript
// Existing grant types:
// - authorization_code
// - refresh_token

// Add new grant type:
if (grantType === "urn:ietf:params:oauth:grant-type:device_code") {
  const { device_code, client_id } = body;
  
  // Forward to TiDB Cloud's token endpoint
  const response = await fetch(`${oauthBaseUrl}/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: DEVICE_CODE_CLIENT_ID,
      client_secret: DEVICE_CODE_CLIENT_SECRET,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code,
    }),
  });
  
  // Handle responses:
  // - 400 with authorization_pending: return as-is (client should retry)
  // - 400 with slow_down: return as-is (client should slow polling)
  // - 200 with tokens: return access_token and refresh_token
}
```

### Phase 3: Update OAuth Metadata

#### 3.1 Modify `/.well-known/oauth-authorization-server` in `/packages/remote/src/app.ts`

Update metadata to advertise Device Code support:

```typescript
// Before:
grant_types_supported: ["authorization_code", "refresh_token"]

// After:
grant_types_supported: [
  "authorization_code",
  "refresh_token",
  "urn:ietf:params:oauth:grant-type:device_code"
],
device_authorization_endpoint: `${baseUrl}/api/device/code`,
```

### Phase 4: Add Configuration

#### 4.1 Modify `/packages/remote/src/config.ts`

Add Device Code OAuth base URL helper (reuses existing OAuth credentials):

```typescript
// Environment-based OAuth endpoints for Device Code flow
const DEVICE_CODE_OAUTH_BASE: Record<Environment, string> = {
  dev: "https://oauth.dev.tidbcloud.com",
  prod: "https://oauth.tidbcloud.com",
};

export function getDeviceCodeOAuthBase(env: Environment): string {
  return DEVICE_CODE_OAUTH_BASE[env];
}
```

**Note:** Device Code flow reuses existing `TIDB_CLOUD_OAUTH_CLIENT_ID` and `TIDB_CLOUD_OAUTH_CLIENT_SECRET` - no new environment variables needed.

### Phase 5: Update Documentation

#### 5.1 Update README.md

Document both authentication flows:
- Authorization Code for browser-capable clients
- Device Code for headless/CLI clients

## Files Summary

### New Files
| File | Purpose |
|------|---------|
| `packages/remote/api/device.ts` | Device authorization endpoint |

### Modified Files
| File | Changes |
|------|---------|
| `packages/remote/src/app.ts` | Add device route, update OAuth metadata |
| `packages/remote/api/token.ts` | Add device_code grant type handling |
| `packages/remote/src/config.ts` | Add device code OAuth base URL helper |
| `README.md` | Document dual auth flow support |

## Client Experience

### Cursor (Authorization Code Flow)
Works exactly as before - no changes needed.

### openclaw (Device Code Flow)

1. **Discover OAuth endpoints:**
   ```
   GET /.well-known/oauth-authorization-server
   → device_authorization_endpoint: /api/device/code
   ```

2. **Request device code:**
   ```
   POST /api/device/code
   Content-Type: application/json
   {"client_id": "openclaw"}
   
   Response:
   {
     "device_code": "...",
     "user_code": "ABCD-EFGH",
     "verification_uri": "https://tidbcloud.com/oauth/device",
     "verification_uri_complete": "https://tidbcloud.com/oauth/device?user_code=ABCD-EFGH",
     "expires_in": 900,
     "interval": 5
   }
   ```

3. **Display to user:**
   ```
   To authenticate, visit: https://tidbcloud.com/oauth/device
   Enter code: ABCD-EFGH
   ```

4. **Poll for token:**
   ```
   POST /api/token
   Content-Type: application/x-www-form-urlencoded
   
   grant_type=urn:ietf:params:oauth:grant-type:device_code
   &device_code=...
   &client_id=openclaw
   
   Response (pending):
   {"error": "authorization_pending"}
   
   Response (success):
   {"access_token": "...", "refresh_token": "...", "expires_in": 3600}
   ```

5. **Use token:**
   ```
   POST /mcp
   Authorization: Bearer <access_token>
   ```

## Testing Plan

1. **Unit Tests**
   - Device code endpoint request/response
   - Token endpoint with device_code grant type
   - Error handling (authorization_pending, slow_down, expired_token)

2. **Integration Tests**
   - Full device code flow end-to-end
   - Verify both auth flows work simultaneously
   - Token refresh for device code tokens

3. **Manual Testing**
   - Test with Cursor (Authorization Code) - verify no regression
   - Test with openclaw (Device Code)
   - Test in both dev and prod environments

## Verification

After implementation, verify:

1. **OAuth Metadata includes Device Code:**
   ```bash
   curl https://your-server/.well-known/oauth-authorization-server | jq .grant_types_supported
   # Should include "urn:ietf:params:oauth:grant-type:device_code"
   ```

2. **Device Code endpoint works:**
   ```bash
   curl -X POST https://your-server/api/device/code \
     -H "Content-Type: application/json" \
     -d '{"client_id": "test"}'
   # Should return device_code, user_code, verification_uri
   ```

3. **Token endpoint handles device_code grant:**
   ```bash
   curl -X POST https://your-server/api/token \
     -d "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
     -d "device_code=..." \
     -d "client_id=test"
   # Should return authorization_pending or tokens
   ```

4. **Both flows produce valid tokens for /mcp**

## Security Considerations

1. **Client Credentials**: Using TiDB Cloud CLI's public credentials (designed to be embedded)
2. **No State Storage**: Device code flow is stateless on our server - TiDB Cloud manages the state
3. **Polling Rate Limiting**: Respect `interval` from device code response
4. **Token Security**: Same Bearer token security as Authorization Code flow

## References

- [RFC 8628 - OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628)
- [TiDB Cloud OAuth 2.0 Blog Post](https://www.pingcap.com/blog/tidb-cloud-supports-oauth-2-0-for-a-more-secure-login-experience/)
- [tidbcloud-cli OAuth Implementation](https://github.com/tidbcloud/tidbcloud-cli/tree/main/internal/cli/auth)
