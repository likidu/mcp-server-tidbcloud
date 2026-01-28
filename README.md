# TiDB Cloud MCP Server

An MCP (Model Context Protocol) server that enables LLMs to interact with TiDB Cloud through natural language.

## Features

- **Cluster Management**: Create, list, update, and delete TiDB Cloud Serverless clusters
- **Branch Management**: Create, list, get, and delete branches for clusters
- **Async Operation Support**: Proper handling of long-running operations with status checking
- **stdio Transport**: Works with Claude Desktop and other MCP clients

## Prerequisites

- Node.js 18 or later
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

## Configuration

### Environment Variables

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

## Usage with Claude Desktop

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
- `clusterId` (required): The ID of the cluster

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
- `clusterId` (required): The ID of the cluster to update
- `displayName` (optional): New display name
- `spendingLimitMonthly` (optional): Monthly spending limit in USD
- `labels` (optional): Key-value labels

#### `tidbcloud_delete_cluster`

Deletes a cluster. **Warning: This is irreversible!**

**Parameters:**
- `clusterId` (required): The ID of the cluster to delete

### Branch Management

#### `tidbcloud_list_branches`

Lists all branches for a cluster.

**Parameters:**
- `clusterId` (required): The ID of the cluster
- `pageSize` (optional): Number of branches per page (1-100)
- `pageToken` (optional): Token for pagination

#### `tidbcloud_get_branch`

Gets detailed information about a specific branch. Useful for checking if a branch has finished creating.

**Parameters:**
- `clusterId` (required): The ID of the cluster
- `branchId` (required): The ID of the branch

#### `tidbcloud_create_branch`

Creates a new branch for a TiDB Cloud Starter or Essential cluster. This is an async operation.

**Parameters:**
- `clusterId` (required): The ID of the TiDB Cloud cluster
- `displayName` (required): Display name for the new branch (max 64 characters)
- `parentId` (optional): Parent branch ID (defaults to main cluster)
- `parentTimestamp` (optional): RFC3339 timestamp for point-in-time branching

#### `tidbcloud_delete_branch`

Deletes a branch. **Warning: This is irreversible!**

**Parameters:**
- `clusterId` (required): The ID of the cluster
- `branchId` (required): The ID of the branch to delete

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
│   ├── server/                    # MCP Server package
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
│   └── client/                    # MCP Client (future)
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

## License

MIT
