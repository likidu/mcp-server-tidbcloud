# TiDB Cloud MCP Server

An MCP (Model Context Protocol) server that enables LLMs to interact with TiDB Cloud through natural language.

## Features

- **Cluster Management**: Create, list, update, and delete TiDB Cloud Serverless clusters
- **Branch Management**: Create, list, get, and delete branches for clusters
- **Database Operations**: Execute SQL queries and manage database schemas
- **Region Discovery**: List available regions for cluster creation
- **Async Operation Support**: Proper handling of long-running operations with status checking
- **Two Transport Options**:
  - **stdio**: Local server for Claude Desktop (API keys in env vars)
  - **Streamable HTTP**: Remote server for hosted deployments (API keys in headers)

## Prerequisites

- Node.js 22 or later
- pnpm package manager
- TiDB Cloud account with API access

## Getting Your API Keys

1. Log in to [TiDB Cloud Console](https://tidbcloud.com)
2. Click on your organization name in the left sidebar
3. Navigate to **Organization Settings** → **API Keys**
4. Click **Create API Key**
5. Copy both the **Public Key** and **Private Key** (save the private key securely - it won't be shown again)

## Installation

```bash
# Clone the repository
git clone https://github.com/tidbcloud/mcp-server-tidbcloud.git
cd mcp-server-tidbcloud

# Install dependencies
pnpm install

# Build the project
pnpm build
```

## Usage with Claude Desktop

There are two ways to use this MCP server with Claude Desktop:

### Option 1: Local Server (stdio) — Recommended

Run the server locally with API keys configured in Claude Desktop. Best for development or when you need full control.

Add the following to your Claude Desktop configuration file (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tidbcloud": {
      "command": "node",
      "args": ["/path/to/mcp-server-tidbcloud/packages/server/dist/index.js"],
      "env": {
        "TIDB_CLOUD_PUBLIC_KEY": "your-public-key",
        "TIDB_CLOUD_PRIVATE_KEY": "your-private-key"
      }
    }
  }
}
```

**Environment Variables (Local Server):**

| Variable | Required | Description |
|----------|----------|-------------|
| `TIDB_CLOUD_PUBLIC_KEY` | Yes | TiDB Cloud API public key |
| `TIDB_CLOUD_PRIVATE_KEY` | Yes | TiDB Cloud API private key |
| `TIDB_CLOUD_API_URL` | No | API base URL (defaults to `https://serverless.tidbapi.com`) |
| `TIDB_CLOUD_DB_HOST` | No | Default database host for SQL operations |
| `TIDB_CLOUD_DB_USER` | No | Default database username |
| `TIDB_CLOUD_DB_PASSWORD` | No | Default database password |

### Option 2: Remote Server

Connect to the hosted MCP server using `mcp-remote`. Your API keys are passed via headers — they are not stored on the server.

**Claude Desktop Configuration:**

```json
{
  "mcpServers": {
    "TiDB Cloud": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://mcp-server-tidbcloud.workers.dev/mcp",
        "--header", "X-TiDB-API-Public-Key:${TIDB_CLOUD_PUBLIC_KEY}",
        "--header", "X-TiDB-API-Private-Key:${TIDB_CLOUD_PRIVATE_KEY}"
      ],
      "env": {
        "TIDB_CLOUD_PUBLIC_KEY": "your-public-key",
        "TIDB_CLOUD_PRIVATE_KEY": "your-private-key"
      }
    }
  }
}
```

**With Database Credentials (for SQL operations):**

To use database tools (`show_databases`, `db_query`, `db_execute`, etc.), configure your database credentials. The credentials are stored locally and sent via custom headers:

```json
{
  "mcpServers": {
    "TiDB Cloud": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://mcp-server-tidbcloud.workers.dev/mcp",
        "--header", "X-TiDB-API-Public-Key:${TIDB_CLOUD_PUBLIC_KEY}",
        "--header", "X-TiDB-API-Private-Key:${TIDB_CLOUD_PRIVATE_KEY}",
        "--header", "X-TiDB-DB-Host:${TIDB_CLOUD_DB_HOST}",
        "--header", "X-TiDB-DB-User:${TIDB_CLOUD_DB_USER}",
        "--header", "X-TiDB-DB-Password:${TIDB_CLOUD_DB_PASSWORD}"
      ],
      "env": {
        "TIDB_CLOUD_PUBLIC_KEY": "your-public-key",
        "TIDB_CLOUD_PRIVATE_KEY": "your-private-key",
        "TIDB_CLOUD_DB_HOST": "gateway01.us-east-1.prod.aws.tidbcloud.com",
        "TIDB_CLOUD_DB_USER": "your-username",
        "TIDB_CLOUD_DB_PASSWORD": "your-password"
      }
    }
  }
}
```

To get your cluster's host, use the `tidbcloud_get_cluster` tool - it will display the connection endpoint. Your username format is typically `{userPrefix}.root` where `userPrefix` is shown in the cluster details.

## Available Tools

### Region Tools

#### `tidbcloud_list_regions`

Lists all available regions for TiDB Cloud Serverless clusters.

**Parameters:** None

### Cluster Management

#### `tidbcloud_list_clusters`

Lists all TiDB Cloud Serverless clusters in your organization.

**Parameters:**
- `pageSize` (optional): Number of clusters per page (1-100, default 10)
- `pageToken` (optional): Token for fetching the next page

#### `tidbcloud_get_cluster`

Gets detailed information about a specific cluster, including connection endpoint (host and port).

**Parameters:**
- `cluster` (required): The cluster name or ID

#### `tidbcloud_create_cluster`

Creates a new TiDB Cloud Serverless cluster. This is an async operation - the cluster will be in CREATING state initially.

**Parameters:**
- `displayName` (required): Display name for the cluster (max 64 chars)
- `region` (required): Cloud region name (use `tidbcloud_list_regions` to get valid values)
- `rootPassword` (optional): Root password. Auto-generated if not provided
- `spendingLimitMonthly` (optional): Monthly spending limit in USD
- `labels` (optional): Key-value labels for the cluster

#### `tidbcloud_update_cluster`

Updates an existing cluster's configuration.

**Parameters:**
- `cluster` (required): The cluster name or ID to update
- `displayName` (optional): New display name
- `spendingLimitMonthly` (optional): Monthly spending limit in USD
- `labels` (optional): Key-value labels

#### `tidbcloud_delete_cluster`

Deletes a cluster. **Warning: This is irreversible!**

**Parameters:**
- `cluster` (required): The cluster name or ID to delete

### Branch Management

#### `tidbcloud_list_branches`

Lists all branches for a cluster.

**Parameters:**
- `cluster` (required): The cluster name or ID
- `pageSize` (optional): Number of branches per page (1-100)
- `pageToken` (optional): Token for pagination

#### `tidbcloud_get_branch`

Gets detailed information about a specific branch, including connection endpoint. Useful for checking if a branch has finished creating.

**Parameters:**
- `cluster` (required): The cluster name or ID
- `branch` (required): The branch name or ID

#### `tidbcloud_create_branch`

Creates a new branch for a TiDB Cloud Starter or Essential cluster. This is an async operation.

**Parameters:**
- `cluster` (required): The cluster name or ID
- `displayName` (required): Display name for the new branch (max 64 characters)
- `parentId` (optional): Parent branch ID (defaults to main cluster)
- `parentTimestamp` (optional): RFC3339 timestamp for point-in-time branching

#### `tidbcloud_delete_branch`

Deletes a branch. **Warning: This is irreversible!**

**Parameters:**
- `cluster` (required): The cluster name or ID
- `branch` (required): The branch name or ID to delete

### Database Operations

Database tools require connection credentials. Set them via environment variables or pass them as parameters.

#### `show_databases`

Lists all databases in the TiDB Cloud cluster.

**Parameters:**
- `host` (optional): Database host override
- `username` (optional): Username override
- `password` (optional): Password override

#### `show_tables`

Lists all tables in a specified database.

**Parameters:**
- `database` (required): The database to list tables from
- `host` (optional): Database host override
- `username` (optional): Username override
- `password` (optional): Password override

#### `db_query`

Executes a read-only SQL query. Only SELECT, SHOW, DESCRIBE, and EXPLAIN statements are allowed.

**Parameters:**
- `sql` (required): The read-only SQL query to execute
- `database` (optional): Database to use for the query
- `host` (optional): Database host override
- `username` (optional): Username override
- `password` (optional): Password override

#### `db_execute`

Executes SQL statements that modify data or schema (INSERT, UPDATE, DELETE, CREATE, ALTER, DROP). **Warning: This can modify or delete data.**

**Parameters:**
- `sql` (required): SQL statement or array of statements to execute
- `database` (optional): Database to use
- `host` (optional): Database host override
- `username` (optional): Username override
- `password` (optional): Password override

#### `db_create_user`

Creates a new database user.

**Parameters:**
- `username` (required): Username for the new user
- `password` (required): Password for the new user
- `userHost` (optional): Host restriction (default: '%' for any host)
- `host` (optional): Admin database host override
- `adminUsername` (optional): Admin username override
- `adminPassword` (optional): Admin password override

#### `db_remove_user`

Removes a database user. **Warning: This is irreversible!**

**Parameters:**
- `username` (required): Username of the user to remove
- `userHost` (optional): Host specification (default: '%')
- `host` (optional): Admin database host override
- `adminUsername` (optional): Admin username override
- `adminPassword` (optional): Admin password override

## Async Operations

Some operations (cluster creation, branch creation, deletions) are asynchronous. The tools will return immediately with the current state, and you can use the corresponding `get` tool to check when the operation completes:

- After `tidbcloud_create_cluster`: Use `tidbcloud_get_cluster` to check when state changes from `CREATING` to `ACTIVE`
- After `tidbcloud_create_branch`: Use `tidbcloud_get_branch` to check when state changes from `CREATING` to `ACTIVE`

## Development

```bash
# Run in development mode with auto-reload
pnpm dev

# Build the project
pnpm build

# Clean build artifacts
pnpm clean

# Test with MCP Inspector (stdio server)
TIDB_CLOUD_PUBLIC_KEY='your-key' TIDB_CLOUD_PRIVATE_KEY='your-key' \
  npx @modelcontextprotocol/inspector node packages/server/dist/index.js
```

### Test Remote Server with MCP Inspector

To test the remote HTTP server locally with API key authentication:

1. Start the remote server:
```bash
pnpm dev:remote
```

2. In a separate terminal, connect the MCP inspector via `mcp-remote` with API key headers:
```bash
npx @modelcontextprotocol/inspector \
  npx mcp-remote http://localhost:3000/mcp \
  --header "X-TiDB-API-Public-Key:YOUR_PUBLIC_KEY" \
  --header "X-TiDB-API-Private-Key:YOUR_PRIVATE_KEY"
```

## Project Structure

```
mcp-server-tidbcloud/
├── packages/
│   ├── server/                    # Core MCP Server (stdio transport)
│   │   ├── src/
│   │   │   ├── index.ts           # Entry point
│   │   │   ├── server.ts          # MCP server setup
│   │   │   ├── config.ts          # Configuration
│   │   │   ├── api/
│   │   │   │   ├── client.ts      # TiDB Cloud API client
│   │   │   │   └── types.ts       # Type definitions
│   │   │   ├── db/
│   │   │   │   ├── client.ts      # Database client
│   │   │   │   └── types.ts       # Database types
│   │   │   └── tools/
│   │   │       ├── index.ts       # Tool exports
│   │   │       ├── cluster.ts     # Cluster management tools
│   │   │       ├── branch.ts      # Branch management tools
│   │   │       ├── database.ts    # Database SQL tools
│   │   │       └── region.ts      # Region discovery tools
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── remote/                    # Remote MCP Server (HTTP transport)
│       ├── src/
│       │   ├── app.ts             # Hono web app
│       │   ├── config.ts          # Configuration
│       │   ├── dev.ts             # Local dev server
│       │   ├── landing.ts         # Landing page
│       │   ├── skill.ts           # Skill documentation
│       │   ├── worker.ts          # Cloudflare Workers entry point
│       │   └── middleware/        # Security middleware
│       ├── package.json
│       └── wrangler.toml          # Cloudflare Workers configuration
│
├── package.json                   # Root workspace config
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## TiDB Cloud Limitations

### Cluster Limitations
- Serverless clusters are available in select regions (use `tidbcloud_list_regions` to see available regions)
- Spending limits can be configured to control costs

### Branch Limitations
- Maximum 5 branches per organization (default quota)
- Cannot branch clusters larger than 100 GiB
- Branches are created in the same region as the parent cluster
- Free Starter clusters: point-in-time limited to last 24 hours
- Paid clusters: point-in-time limited to last 14 days

## Security

### Security Considerations

This MCP server grants powerful database management capabilities. Please review the following security guidance:

- **Always review actions**: Review and authorize actions requested by the LLM before execution
- **Development use**: This server is intended for local development and IDE integrations
- **API key security**: Never expose your API keys in client-side code or public repositories
- **Access control**: Ensure only authorized users have access to your MCP server URL
- **Audit access**: Monitor usage and regularly audit who has access to your API keys

### Environment Variable Security

- Store API keys securely using environment variables or secret management tools
- Never commit `.env` files containing real credentials
- Rotate API keys periodically

### Read-Only Mode

For safer operations, the `db_query` tool only allows read-only SQL statements (SELECT, SHOW, DESCRIBE, EXPLAIN). For data modifications, use `db_execute` with caution.

For more information, see the [MCP Security Best Practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices).

## License

MIT
