# TiDB Cloud MCP Server

An MCP (Model Context Protocol) server that enables LLMs to interact with TiDB Cloud through natural language.

## Features

- **Cluster Management**: Create, list, update, and delete TiDB Cloud Serverless clusters
- **Branch Management**: Create, list, get, and delete branches for clusters
- **Database Operations**: Execute SQL queries and manage database schemas
- **Async Operation Support**: Proper handling of long-running operations with status checking
- **Two Transport Options**:
  - **stdio**: Local server for Claude Desktop (API keys in config)
  - **HTTP**: Remote server for hosted deployments (Vercel, etc.)

## Prerequisites

- Node.js 22 or later
- pnpm package manager
- TiDB Cloud account with API access

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/mcp-server-tidbcloud.git
cd mcp-server-tidbcloud

# Install dependencies
pnpm install

# Build the project
pnpm build
```

## Usage with Claude Desktop

There are two ways to use this MCP server with Claude Desktop:

### Option 1: Remote Server (Recommended)

Connect to the hosted MCP server. No local setup or API keys needed in Claude Desktop.

Add the following to your Claude Desktop configuration file (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tidbcloud": {
      "url": "https://mcp-server-tidbcloud-remote.vercel.app/mcp"
    }
  }
}
```

### Option 2: Local Server (stdio)

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

### Getting Your API Keys

1. Log in to [TiDB Cloud Console](https://tidbcloud.com)
2. Click on your organization name in the left sidebar
3. Navigate to **Organization Settings** → **API Keys**
4. Click **Create API Key**
5. Copy both the **Public Key** and **Private Key** (save the private key securely - it won't be shown again)

## Available Tools

### Cluster Management

#### `tidbcloud_list_clusters`

Lists all TiDB Cloud Serverless clusters in your organization.

**Parameters:**
- `pageSize` (optional): Number of clusters per page (1-100, default 10)
- `pageToken` (optional): Token for fetching the next page

#### `tidbcloud_get_cluster`

Gets detailed information about a specific cluster.

**Parameters:**
- `cluster` (required): The cluster name or ID

#### `tidbcloud_create_cluster`

Creates a new TiDB Cloud Serverless cluster. This is an async operation - the cluster will be in CREATING state initially.

**Parameters:**
- `displayName` (required): Display name for the cluster (max 64 chars)
- `region` (required): Cloud region (e.g., 'us-east-1', 'eu-west-1')
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

Gets detailed information about a specific branch. Useful for checking if a branch has finished creating.

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

# Test with MCP Inspector
TIDB_CLOUD_PUBLIC_KEY='your-key' TIDB_CLOUD_PRIVATE_KEY='your-key' \
  npx @modelcontextprotocol/inspector node packages/server/dist/index.js
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
│   │   │   └── tools/
│   │   │       ├── index.ts       # Tool exports
│   │   │       ├── cluster.ts     # Cluster management tools
│   │   │       └── branch.ts      # Branch management tools
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── remote/                    # Remote MCP Server (HTTP transport)
│       ├── src/
│       │   ├── index.ts           # Entry point
│       │   ├── app.ts             # Hono web app
│       │   ├── config.ts          # Configuration with OAuth support
│       │   ├── landing.ts         # Landing page
│       │   └── middleware/        # Security middleware
│       ├── package.json
│       └── tsconfig.json
│
├── package.json                   # Root workspace config
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## TiDB Cloud Limitations

### Cluster Limitations
- Serverless clusters are available in select regions
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
- **Production environments**: Not recommended for production without proper OAuth setup
- **Access control**: Ensure only authorized users have access to your MCP server URL
- **API key security**: Never expose your API keys in client-side code or public repositories
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
