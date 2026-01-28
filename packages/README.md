# Packages

This monorepo contains two packages that work together to provide MCP server functionality for TiDB Cloud.

## Package Overview

| Aspect | `server` | `remote` |
|--------|----------|----------|
| **Role** | Core library + stdio server | HTTP wrapper with OAuth |
| **Transport** | stdio (for Claude Desktop) | HTTP (for web/remote access) |
| **Can run standalone?** | Yes | Yes |
| **Contains tools?** | Yes (source of truth) | No (imports from server) |

## `server`

The core MCP server implementation containing:

- All TiDB Cloud tools (cluster, branch, region, database management)
- TiDB Cloud API client
- Configuration management
- stdio transport for local MCP clients (e.g., Claude Desktop)

This package is also published as `@likidu/mcp-server-tidbcloud` and can be used as a library.

## `remote`

A hosted MCP server that wraps the core `server` package with:

- HTTP transport (Streamable HTTP)
- OAuth 2.1 authentication support
- Hono web framework
- Vercel deployment configuration

The remote package imports tools and API client from `server`:

```typescript
import {
    registerClusterTools,
    registerBranchTools,
    registerRegionTools,
    registerDatabaseTools,
} from "@likidu/mcp-server-tidbcloud/tools";
import { TiDBCloudClient } from "@likidu/mcp-server-tidbcloud/api";
```

## When to Use Which

- **Local development with Claude Desktop**: Use `server` directly with stdio transport
- **Remote/hosted deployment**: Use `remote` which provides HTTP access with OAuth
- **Building your own integration**: Import from `server` as a library
