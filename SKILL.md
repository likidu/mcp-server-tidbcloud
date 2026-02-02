---
name: tidbcloud
description: Manage TiDB Cloud Serverless clusters, branches, and execute SQL queries via MCP.
homepage: https://github.com/likidu/mcp-server-tidbcloud
---

# TiDB Cloud MCP Server

Use this skill to manage TiDB Cloud Serverless clusters, branches, and execute SQL queries through natural language. The server supports OAuth authentication for secure access to your TiDB Cloud account.

## Server URL

```
https://mcp-server-tidbcloud-remote.vercel.app/mcp
```

## Authentication

This server uses OAuth 2.0 Device Code flow for headless authentication.

### First-Time Setup

1. **Request a device code:**
   ```bash
   curl -X POST https://mcp-server-tidbcloud-remote.vercel.app/api/device/code \
     -H "Content-Type: application/json" \
     -d '{"client_id": "openclaw"}'
   ```

2. **You'll receive a response like:**
   ```json
   {
     "device_code": "...",
     "user_code": "ABCD-1234",
     "verification_uri": "https://dev.tidbcloud.com/oauth/device",
     "verification_uri_complete": "https://dev.tidbcloud.com/oauth/device?user_code=ABCD-1234",
     "expires_in": 600,
     "interval": 5
   }
   ```

3. **Visit the URL and enter the code** to authorize access to your TiDB Cloud account.

4. **Poll for the token:**
   ```bash
   curl -X POST https://mcp-server-tidbcloud-remote.vercel.app/api/token \
     -d "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
     -d "device_code=<your-device-code>" \
     -d "client_id=openclaw"
   ```

5. **Use the token** with Bearer authentication for all MCP requests.

## Available Tools

### Region Discovery
- **tidbcloud_list_regions** - List all available regions for cluster creation

### Cluster Management
- **tidbcloud_list_clusters** - List all Serverless clusters in your organization
- **tidbcloud_get_cluster** - Get details about a specific cluster (including connection endpoint)
- **tidbcloud_create_cluster** - Create a new Serverless cluster
- **tidbcloud_update_cluster** - Update cluster configuration
- **tidbcloud_delete_cluster** - Delete a cluster (irreversible)

### Branch Management
- **tidbcloud_list_branches** - List all branches for a cluster
- **tidbcloud_get_branch** - Get branch details and connection endpoint
- **tidbcloud_create_branch** - Create a new branch (max 5 per org)
- **tidbcloud_delete_branch** - Delete a branch (irreversible)

### Database Operations (requires DB credentials)
- **show_databases** - List all databases
- **show_tables** - List tables in a database
- **db_query** - Execute read-only SQL (SELECT, SHOW, DESCRIBE, EXPLAIN)
- **db_execute** - Execute write SQL (INSERT, UPDATE, DELETE, CREATE, ALTER, DROP)
- **db_create_user** - Create a database user
- **db_remove_user** - Remove a database user

## Database Credentials

For SQL operations, provide credentials via headers:
- `X-TiDB-DB-Host`: Your cluster's gateway endpoint
- `X-TiDB-DB-User`: Database username (typically `{prefix}.root`)
- `X-TiDB-DB-Password`: Database password

Use `tidbcloud_get_cluster` to find your cluster's connection endpoint.

## Example Prompts

- "List all my TiDB Cloud clusters"
- "Create a new cluster named 'dev-cluster' in us-east-1"
- "Show me the connection details for cluster 'my-cluster'"
- "Create a branch called 'feature-test' from cluster 'main-db'"
- "Run SELECT * FROM users LIMIT 10 on database 'myapp'"
- "What regions are available for TiDB Cloud?"

## Notes

- **Async Operations**: Cluster and branch creation are async. Use the `get` tools to check status.
- **Branch Limits**: Maximum 5 branches per organization (default quota).
- **Read-Only Mode**: `db_query` only allows SELECT/SHOW/DESCRIBE/EXPLAIN for safety.
