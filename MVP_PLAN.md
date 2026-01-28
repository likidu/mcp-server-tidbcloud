# MCP Server for TiDB Cloud - MVP Plan

## Overview

This document outlines the MVP (Minimum Viable Product) plan for building an MCP (Model Context Protocol) server that integrates with TiDB Cloud's OpenAPI. The MVP focuses on implementing branch creation functionality for TiDB Cloud Starter clusters.

## Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌──────────────────────────────────┐
│  Claude Desktop │◄────►│  TiDB Cloud MCP │◄────►│  TiDB Cloud OpenAPI              │
│  (MCP Client)   │ MCP  │  Server         │ HTTP │  (https://serverless.tidbapi.com)│
└─────────────────┘      └─────────────────┘      └──────────────────────────────────┘
        │                        │
        │ stdio transport        │ REST API calls
        │ (local execution)      │ with Bearer token auth
```

## Technology Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript |
| Package Manager | pnpm |
| MCP SDK | `@modelcontextprotocol/sdk` (official TypeScript SDK) |
| Schema Validation | Zod |
| HTTP Client | Native `fetch` (Node.js 18+) |
| Transport | stdio (for local Claude Desktop integration) |

## TiDB Cloud API Details

### Base URL
```
https://serverless.tidbapi.com
```

### Authentication
- **Method**: Bearer Token (OAuth 2.0)
- **Header**: `Authorization: Bearer <access_token>`

### Branch API Endpoint (v1beta1)
Based on CLI command structure and API patterns:

```
POST /v1beta1/clusters/{clusterId}/branches
```

#### Request Body
```json
{
  "displayName": "string",
  "parentId": "string (optional, defaults to cluster)",
  "parentTimestamp": "string (optional, RFC3339 format)"
}
```

#### Response
```json
{
  "branchId": "string",
  "clusterId": "string",
  "displayName": "string",
  "state": "string",
  "createdAt": "string",
  "parentId": "string"
}
```

## Project Structure

The project uses a **monorepo structure** with pnpm workspaces, similar to [Neon's MCP server](https://github.com/neondatabase/mcp-server-neon). This allows for future expansion with an MCP client package.

```
mcp-server-tidbcloud/
├── packages/
│   ├── server/                    # MCP Server package
│   │   ├── src/
│   │   │   ├── index.ts           # Entry point, MCP server setup
│   │   │   ├── server.ts          # MCP server configuration
│   │   │   ├── tools/
│   │   │   │   ├── index.ts       # Tool exports
│   │   │   │   └── branch.ts      # Branch creation tool
│   │   │   ├── api/
│   │   │   │   ├── client.ts      # TiDB Cloud API client
│   │   │   │   └── types.ts       # API type definitions
│   │   │   └── config.ts          # Configuration handling
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── client/                    # MCP Client package (future)
│       └── ...
│
├── package.json                   # Root package.json (workspace config)
├── pnpm-workspace.yaml            # pnpm workspace configuration
├── tsconfig.base.json             # Shared TypeScript config
├── .env.example                   # Environment variables template
└── README.md
```

## Implementation Plan

### Phase 1: Project Setup

1. **Initialize monorepo with pnpm workspaces**
   - Create root `package.json` with workspace configuration
   - Create `pnpm-workspace.yaml` to define packages
   - Create shared `tsconfig.base.json` for common TypeScript settings

2. **Set up server package** (`packages/server/`)
   - Create `package.json` with dependencies
   - Configure TypeScript (`tsconfig.json`) extending base config
   - Set up build scripts

3. **Install dependencies** (in `packages/server/`)
   ```
   @modelcontextprotocol/sdk
   zod
   ```

4. **Development dependencies** (in root or server package)
   ```
   typescript
   @types/node
   tsx (for development)
   ```

### Phase 2: Core Implementation

All paths below are relative to `packages/server/`.

1. **Configuration Module** (`src/config.ts`)
   - Read TiDB Cloud API credentials from environment variables
   - Support `TIDB_CLOUD_API_TOKEN` for Bearer token authentication
   - Validate required configuration on startup

2. **API Client** (`src/api/client.ts`)
   - Create typed HTTP client for TiDB Cloud API
   - Implement error handling and response parsing
   - Support Bearer token authentication

3. **Type Definitions** (`src/api/types.ts`)
   - Define TypeScript interfaces for API requests/responses
   - Branch creation request/response types
   - Error response types

4. **Branch Tool** (`src/tools/branch.ts`)
   - Implement `create_branch` tool using MCP SDK
   - Define input schema with Zod:
     - `clusterId` (required): Target cluster ID
     - `displayName` (required): Branch name
     - `parentId` (optional): Parent branch ID
     - `parentTimestamp` (optional): Point-in-time for branching
   - Return structured response with branch details

5. **MCP Server** (`src/server.ts` and `src/index.ts`)
   - Initialize McpServer from SDK
   - Register branch creation tool
   - Configure stdio transport for local execution
   - Add server metadata (name, version)

### Phase 3: Testing & Documentation

1. **Manual Testing**
   - Test with Claude Desktop configuration
   - Verify branch creation with a TiDB Cloud Starter cluster

2. **Documentation**
   - Update README with setup instructions
   - Document environment variables
   - Provide Claude Desktop configuration example

## MCP Tool Definition

### `create_branch`

**Description**: Creates a new branch for a TiDB Cloud Starter or Essential cluster.

**Input Schema**:
```typescript
{
  clusterId: z.string().describe("The ID of the TiDB Cloud cluster"),
  displayName: z.string().describe("Display name for the new branch"),
  parentId: z.string().optional().describe("Parent branch ID (defaults to main cluster)"),
  parentTimestamp: z.string().optional().describe("RFC3339 timestamp for point-in-time branching")
}
```

**Output**: Branch creation result including branch ID, state, and connection details.

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TIDB_CLOUD_API_TOKEN` | Yes | TiDB Cloud API Bearer token |

### Claude Desktop Configuration

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tidbcloud": {
      "command": "node",
      "args": ["/path/to/mcp-server-tidbcloud/packages/server/dist/index.js"],
      "env": {
        "TIDB_CLOUD_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

## TiDB Cloud Starter Considerations

- **Branch Limits**: Maximum 5 branches per organization (default quota)
- **Storage Limits**: 10 GiB per branch for free clusters
- **Point-in-time**: Last 24 hours available for free Starter clusters
- **Region**: Branches are created in the same region as the parent cluster
- **Cluster Size**: Cannot create branches for clusters larger than 100 GiB

## Success Criteria

1. MCP server starts successfully and connects via stdio transport
2. `create_branch` tool is discoverable by Claude Desktop
3. Branch can be created on a TiDB Cloud Starter cluster via natural language
4. Proper error handling for API failures and invalid inputs

## Future Enhancements (Post-MVP)

- List branches tool
- Delete branch tool
- Get branch details tool
- List clusters tool
- Create cluster tool
- Streamable HTTP transport for remote hosting
- Connection string generation for branches

## References

- [TiDB Cloud API Overview](https://docs.pingcap.com/tidbcloud/api-overview/)
- [TiDB Cloud Branching Overview](https://docs.pingcap.com/tidbcloud/branch-overview/)
- [TiDB Cloud Branch Management](https://docs.pingcap.com/tidbcloud/branch-manage/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP SDK Documentation](https://modelcontextprotocol.io/docs/sdk)
- [ticloud serverless branch create](https://docs.pingcap.com/tidbcloud/ticloud-branch-create/)
