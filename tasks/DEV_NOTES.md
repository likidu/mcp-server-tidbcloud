# Dev Notes

## TiDB Cloud API Authentication

### API Endpoints & Auth Methods

TiDB Cloud has **multiple APIs** with different base URLs and authentication methods:

| API | Base URL | Token Source | Auth Method | Purpose |
|-----|----------|--------------|-------------|---------|
| **Serverless API** (v1beta1) | `https://serverless.tidbapi.com` | Organization Settings > API Keys | **Digest Auth** | Managing Serverless/Starter clusters and branches |
| **Dedicated API** (v1beta1) | `https://api.tidbcloud.com` | Organization Settings > API Keys | **Digest Auth** | Managing Dedicated clusters |
| **Data Service API** | `<region>.data.tidbcloud.com` | Data Service > Data App > API Keys | Basic Auth | Custom data endpoints for Data Apps |

### Correct Configuration

For the **Serverless Branch API** (`/v1beta1/clusters/{clusterId}/branches`):

- **Base URL**: `https://serverless.tidbapi.com`
- **Auth Method**: HTTP Digest Authentication (MD5)
- **API Keys**: Organization Settings > API Keys (NOT Data Service keys)

### How to Get API Keys

1. Log in to [TiDB Cloud Console](https://tidbcloud.com)
2. Click on your organization name in the left sidebar
3. Navigate to **Organization Settings** > **API Keys**
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
