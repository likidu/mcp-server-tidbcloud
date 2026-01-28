# Dev Notes

## Authentication Issue (RESOLVED): "Error: Authentication failed. Please check your API token."

### Root Cause

TiDB Cloud has **multiple APIs** with different base URLs and authentication methods, which caused significant confusion:

| API | Base URL | Token Source | Auth Method | Purpose |
|-----|----------|--------------|-------------|---------|
| **Serverless API** (v1beta1) | `https://serverless.tidbapi.com` | Organization Settings → API Keys | **Digest Auth** | Managing Serverless/Starter clusters and branches |
| **Dedicated API** (v1beta1) | `https://api.tidbcloud.com` | Organization Settings → API Keys | **Digest Auth** | Managing Dedicated clusters |
| **Data Service API** | `<region>.data.tidbcloud.com` | Data Service → Data App → API Keys | Basic Auth | Custom data endpoints for Data Apps |

### The Confusion

During debugging, we went through several incorrect assumptions:

1. **First attempt**: Used Bearer token auth (wrong - that's for OAuth/CLI)
2. **Second attempt**: Used Basic Auth with Data Service API keys (wrong API key type)
3. **Third attempt**: Used Digest Auth but with wrong base URL (`api.tidbcloud.com` instead of `serverless.tidbapi.com`)
4. **Final solution**: Digest Auth + `serverless.tidbapi.com` + Organization API keys

### Correct Configuration

For the **Serverless Branch API** (`/v1beta1/clusters/{clusterId}/branches`):

- **Base URL**: `https://serverless.tidbapi.com`
- **Auth Method**: HTTP Digest Authentication
- **API Keys**: Organization Settings → API Keys (NOT Data Service keys)

### How to Get API Keys

1. Log in to [TiDB Cloud Console](https://tidbcloud.com)
2. Click on your organization name in the left sidebar
3. Navigate to **Organization Settings** → **API Keys**
4. Click **Create API Key**
5. Copy both the **Public Key** and **Private Key**

### Testing

```bash
TIDB_CLOUD_PUBLIC_KEY='your-public-key' \
TIDB_CLOUD_PRIVATE_KEY='your-private-key' \
npx @modelcontextprotocol/inspector node packages/server/dist/index.js
```

### References

- [TiDB Cloud API Overview](https://docs.pingcap.com/tidbcloud/api-overview/)
- [TiDB Cloud Serverless API v1beta1](https://docs.pingcap.com/tidbcloud/api/v1beta1/serverless/)
- [TiDB Cloud API Samples](https://github.com/tidbcloud/tidbcloud-api-samples)

---

## Recommendations for TiDB Cloud OpenAPI Improvements

Based on the confusion encountered during development, here are recommendations for improving the TiDB Cloud API documentation and design:

### 1. Consolidate API Base URLs

**Problem**: Multiple base URLs (`serverless.tidbapi.com`, `api.tidbcloud.com`, `<region>.data.tidbcloud.com`) make it unclear which endpoint to use for which operation.

**Recommendation**: 
- Use a single base URL (e.g., `api.tidbcloud.com`) with path-based routing
- Example: `/serverless/v1beta1/clusters/...` instead of separate domains
- Or clearly document a decision tree at the top of API docs

### 2. Standardize Authentication Methods

**Problem**: Different APIs use different auth methods (Digest, Basic, Bearer/OAuth), and it's not immediately clear which method applies where.

**Recommendation**:
- Standardize on a single auth method across all APIs (preferably Bearer tokens with API keys)
- If multiple methods must exist, add a prominent "Authentication" section at the top of each API reference page
- Include a comparison table in the main API overview

### 3. Clarify API Key Types

**Problem**: There are two types of API keys (Organization API Keys vs Data Service API Keys), and the documentation doesn't clearly explain when to use which.

**Recommendation**:
- Rename keys to be more descriptive (e.g., "Management API Key" vs "Data API Key")
- Add a warning banner when users create Data Service keys explaining they only work with Data Service endpoints
- In API docs, explicitly state which key type is required for each endpoint

### 4. Improve Error Messages

**Problem**: The 401 error just says "Authentication failed" without indicating whether the issue is the auth method, key type, or key value.

**Recommendation**:
- Return more specific error messages:
  - "Invalid authentication method. This endpoint requires Digest authentication."
  - "Invalid API key type. This endpoint requires Organization API keys, not Data Service keys."
  - "Invalid credentials. Please check your public key and private key."

### 5. Add OpenAPI Specification Downloads

**Problem**: Developers integrating with the API have to manually read documentation and implement clients.

**Recommendation**:
- Provide downloadable OpenAPI 3.0 spec files for each API
- Include authentication schemes in the spec
- Host specs at predictable URLs (e.g., `https://serverless.tidbapi.com/openapi.json`)

### 6. Create a Unified SDK

**Problem**: Each integration needs to implement Digest auth and handle multiple endpoints manually.

**Recommendation**:
- Provide official SDKs for popular languages (JavaScript/TypeScript, Python, Go)
- SDKs should handle auth complexity internally
- Single SDK should work across all TiDB Cloud APIs

### 7. Document API Relationships

**Problem**: It's unclear how the different APIs relate to each other and what operations are available where.

**Recommendation**:
- Create an "API Architecture" diagram showing all APIs and their relationships
- Add a capabilities matrix showing which operations are available on which API
- Provide clear migration guides when APIs are deprecated or consolidated
