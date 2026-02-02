# TiDB Cloud MCP Server

## File Sync Rules

When updating `SKILL.md` (root), also update `packages/remote/src/skill.ts` with the same content.
The `skill.ts` file serves the skill documentation at the `/skill.md` endpoint on the deployed server.

## Project Structure

- `packages/server/` - Core MCP server (stdio transport, tools, API client)
- `packages/remote/` - HTTP wrapper with OAuth for Vercel deployment

## Environment

- Dev: Uses `dev.tidbcloud.com` OAuth endpoints
- Prod: Uses `tidbcloud.com` OAuth endpoints
- Set via `TIDB_CLOUD_ENV` environment variable
