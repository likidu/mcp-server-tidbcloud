# Milestone 2 Plan: SQL Execution Tools

## Goal

Add SQL execution capabilities to the TiDB Cloud MCP Server, enabling LLMs to query and modify data in TiDB Cloud clusters. This provides feature parity with the existing TiDB MCP Server's database operations.

## Prerequisites

- Milestone 1 completed (Cluster and Branch management tools)
- Active TiDB Cloud Serverless cluster for testing

---

## Part 1: Tools to Implement

| Tool | Purpose | SQL Equivalent |
|------|---------|----------------|
| `show_databases` | List all databases in a cluster | `SHOW DATABASES` |
| `switch_database` | Set the default database for subsequent queries | `USE {db_name}` |
| `show_tables` | Display tables in the current/specified database | `SHOW TABLES` |
| `db_query` | Run read-only SQL queries (SELECT) | Any SELECT statement |
| `db_execute` | Run data modification SQL (INSERT, UPDATE, DELETE, DDL) | DML/DDL statements |
| `db_create_user` | Create a new database user | `CREATE USER` |
| `db_remove_user` | Delete an existing database user | `DROP USER` |

**Total: 7 tools**

---

## Part 2: Connection Approach

### Recommended: TiDB Serverless Driver (`@tidbcloud/serverless`)

After evaluating the options from Milestone 1, we'll use the **TiDB Serverless Driver** because:

1. **Official Driver**: Maintained by PingCAP/TiDB team
2. **HTTP-based**: Works over HTTPS, no TCP connection needed
3. **Edge Compatible**: Works in serverless/edge runtimes
4. **Simple API**: Clean Promise-based interface
5. **No Connection Pooling Needed**: Each request is independent

### Installation

```bash
pnpm add @tidbcloud/serverless --filter @likidu/mcp-server-tidbcloud
```

### Connection String Format

```
mysql://<user>:<password>@<host>:4000/<database>?ssl={"rejectUnauthorized":true}
```

Example:
```
mysql://3sYZSxxxxxx.root:password123@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/test?ssl={"rejectUnauthorized":true}
```

---

## Part 3: Credential Management Strategy

### Hybrid Approach (Recommended)

Combine environment variables for default credentials with per-tool override capability:

**Environment Variables (Optional Defaults):**
```bash
TIDB_CLOUD_DB_HOST=gateway01.us-east-1.prod.aws.tidbcloud.com
TIDB_CLOUD_DB_USER=3sYZSxxxxxx.root
TIDB_CLOUD_DB_PASSWORD=your-password
TIDB_CLOUD_DB_NAME=test
```

**Per-Tool Parameters (Override):**
Each SQL tool accepts optional connection parameters:
- `host` - Override the default host
- `username` - Override the default username  
- `password` - Override the default password
- `database` - Override the default database

### Benefits

1. **Simple Default Setup**: Set env vars once, use across all tools
2. **Multi-Cluster Flexibility**: Override per-tool when needed
3. **Secure**: Credentials can be passed via environment, not exposed in prompts
4. **Claude Desktop Compatible**: Env vars work with MCP config

---

## Part 4: Implementation Plan

### Phase 1: Add Dependencies and Database Client

**File**: `packages/server/package.json`
```json
{
  "dependencies": {
    "@tidbcloud/serverless": "^0.2.0"
  }
}
```

**New File**: `packages/server/src/db/client.ts`
```typescript
import { connect } from "@tidbcloud/serverless";

export interface DatabaseConfig {
  host: string;
  username: string;
  password: string;
  database?: string;
}

export class TiDBDatabase {
  private config: DatabaseConfig;
  
  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<T[]> {
    const conn = connect({
      host: this.config.host,
      username: this.config.username,
      password: this.config.password,
      database: this.config.database,
    });
    
    const result = await conn.execute(sql, params);
    return result.rows as T[];
  }

  async execute(
    sql: string,
    params?: unknown[]
  ): Promise<{ rowsAffected: number }> {
    const conn = connect({
      host: this.config.host,
      username: this.config.username,
      password: this.config.password,
      database: this.config.database,
    });
    
    const result = await conn.execute(sql, params);
    return { rowsAffected: result.rowsAffected ?? 0 };
  }
}
```

**New File**: `packages/server/src/db/types.ts`
```typescript
export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface ExecuteResult {
  rowsAffected: number;
  lastInsertId?: number;
}

export interface DatabaseInfo {
  name: string;
}

export interface TableInfo {
  name: string;
  type: string;
}
```

### Phase 2: Update Configuration

**File**: `packages/server/src/config.ts`

Add optional database configuration:
```typescript
export interface Config {
  // Existing
  publicKey: string;
  privateKey: string;
  apiBaseUrl: string;
  
  // New - Database connection (optional)
  database?: {
    host: string;
    username: string;
    password: string;
    defaultDatabase?: string;
  };
}
```

### Phase 3: Implement SQL Tools

**New File**: `packages/server/src/tools/database.ts`

#### Tool: `show_databases`
```typescript
Input: {
  // Connection overrides (all optional if env vars set)
  host?: string
  username?: string
  password?: string
}
Output: List of database names
Annotations: { readOnlyHint: true }
```

#### Tool: `show_tables`
```typescript
Input: {
  database: string  // required
  // Connection overrides
  host?: string
  username?: string
  password?: string
}
Output: List of table names with types
Annotations: { readOnlyHint: true }
```

#### Tool: `db_query`
```typescript
Input: {
  sql: string       // required, read-only SQL
  database?: string // optional, defaults to env var
  // Connection overrides
  host?: string
  username?: string
  password?: string
}
Output: Query results as formatted markdown table
Annotations: { readOnlyHint: true }
```

#### Tool: `db_execute`
```typescript
Input: {
  sql: string | string[]  // required, DML/DDL statements
  database?: string
  // Connection overrides
  host?: string
  username?: string
  password?: string
}
Output: Execution result (rows affected)
Annotations: { 
  readOnlyHint: false, 
  destructiveHint: true 
}
```

#### Tool: `db_create_user`
```typescript
Input: {
  username: string   // required
  password: string   // required
  host?: string      // default '%' (any host)
  // Connection overrides for admin connection
  adminHost?: string
  adminUsername?: string
  adminPassword?: string
}
Output: Success message with created user info
Annotations: { readOnlyHint: false }
```

#### Tool: `db_remove_user`
```typescript
Input: {
  username: string   // required
  host?: string      // default '%'
  // Connection overrides
  adminHost?: string
  adminUsername?: string
  adminPassword?: string
}
Output: Success message
Annotations: { 
  readOnlyHint: false, 
  destructiveHint: true 
}
```

### Phase 4: Register Tools

**File**: `packages/server/src/tools/index.ts`
```typescript
export { registerBranchTools } from "./branch.js";
export { registerClusterTools } from "./cluster.js";
export { registerDatabaseTools } from "./database.js";  // NEW
```

**File**: `packages/server/src/server.ts`
```typescript
// Register tools
registerClusterTools(server, client);
registerBranchTools(server, client);
registerDatabaseTools(server, config.database);  // NEW
```

### Phase 5: Testing & Documentation

1. Test all 7 tools with MCP Inspector
2. Update README with database tools documentation
3. Add examples for common SQL operations

---

## Part 5: Files to Modify/Create

### New Files

| File | Purpose |
|------|---------|
| `packages/server/src/db/client.ts` | TiDB database connection wrapper |
| `packages/server/src/db/types.ts` | Database-related type definitions |
| `packages/server/src/tools/database.ts` | 7 SQL execution tools |

### Modified Files

| File | Changes |
|------|---------|
| `packages/server/package.json` | Add `@tidbcloud/serverless` dependency |
| `packages/server/src/config.ts` | Add optional database config |
| `packages/server/src/tools/index.ts` | Export database tools |
| `packages/server/src/server.ts` | Register database tools |
| `README.md` | Document database tools and configuration |
| `.env.example` | Add database environment variables |

---

## Part 6: Security Considerations

### SQL Injection Prevention

1. **Parameterized Queries**: Use prepared statements for user input
2. **Read-Only Validation**: `db_query` should reject non-SELECT statements
3. **Statement Parsing**: Validate SQL before execution

```typescript
// Example: Validate read-only query
function isReadOnlyQuery(sql: string): boolean {
  const normalized = sql.trim().toUpperCase();
  const readOnlyPrefixes = ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN'];
  return readOnlyPrefixes.some(prefix => normalized.startsWith(prefix));
}
```

### Credential Security

1. **Environment Variables**: Prefer env vars over per-request credentials
2. **No Logging**: Never log passwords or connection strings
3. **Error Sanitization**: Remove credentials from error messages

---

## Part 7: Error Handling

### Connection Errors
```typescript
case "ECONNREFUSED":
  return "Error: Cannot connect to database. Check host and port.";
case "ER_ACCESS_DENIED_ERROR":
  return "Error: Authentication failed. Check username and password.";
case "ER_BAD_DB_ERROR":
  return "Error: Database does not exist.";
```

### Query Errors
```typescript
case "ER_NO_SUCH_TABLE":
  return "Error: Table does not exist.";
case "ER_PARSE_ERROR":
  return "Error: SQL syntax error.";
case "ER_DUP_ENTRY":
  return "Error: Duplicate entry for key.";
```

---

## Part 8: Verification Plan

### Test Scenarios

1. **Connection Testing**
   - Connect with env vars only
   - Connect with per-tool overrides
   - Handle invalid credentials gracefully

2. **show_databases**
   - List databases on valid cluster
   - Handle connection errors

3. **show_tables**
   - List tables in specific database
   - Handle non-existent database

4. **db_query**
   - Run SELECT query
   - Return formatted results
   - Reject non-SELECT statements

5. **db_execute**
   - Run INSERT/UPDATE/DELETE
   - Run DDL (CREATE TABLE, etc.)
   - Return rows affected

6. **User Management**
   - Create user with password
   - Remove user
   - Handle permission errors

### Test Commands

```bash
# Build
pnpm build

# Test with MCP Inspector
TIDB_CLOUD_PUBLIC_KEY='xxx' \
TIDB_CLOUD_PRIVATE_KEY='yyy' \
TIDB_CLOUD_DB_HOST='gateway01.us-east-1.prod.aws.tidbcloud.com' \
TIDB_CLOUD_DB_USER='xxxxx.root' \
TIDB_CLOUD_DB_PASSWORD='password' \
npx @modelcontextprotocol/inspector node packages/server/dist/index.js
```

---

## Part 9: Claude Desktop Configuration

```json
{
  "mcpServers": {
    "tidbcloud": {
      "command": "node",
      "args": ["/path/to/mcp-server-tidbcloud/packages/server/dist/index.js"],
      "env": {
        "TIDB_CLOUD_PUBLIC_KEY": "your-public-key",
        "TIDB_CLOUD_PRIVATE_KEY": "your-private-key",
        "TIDB_CLOUD_DB_HOST": "gateway01.us-east-1.prod.aws.tidbcloud.com",
        "TIDB_CLOUD_DB_USER": "xxxxx.root",
        "TIDB_CLOUD_DB_PASSWORD": "your-db-password",
        "TIDB_CLOUD_DB_NAME": "test"
      }
    }
  }
}
```

---

## Summary

| Category | Count | Status |
|----------|-------|--------|
| Database/SQL Tools | 7 | New in Milestone 2 |
| New Files | 3 | db/client.ts, db/types.ts, tools/database.ts |
| Modified Files | 5 | package.json, config.ts, index.ts, server.ts, README.md |

### Tool Annotations Summary

| Tool | Read-Only | Destructive |
|------|-----------|-------------|
| `show_databases` | Yes | No |
| `show_tables` | Yes | No |
| `db_query` | Yes | No |
| `db_execute` | No | Yes |
| `db_create_user` | No | No |
| `db_remove_user` | No | Yes |

This milestone adds full SQL execution capability to the MCP server, completing feature parity with the existing TiDB MCP Server.
