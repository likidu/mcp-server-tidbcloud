# Milestone 1 Plan: TiDB Cloud MCP Server Feature Parity

## Goal
Implement feature parity with the existing TiDB MCP Server and add Cluster CRUD operations, with proper handling of async operations. Focus on local testing.

---

## Part 1: Tools to Implement

### 1.1 Database Operations Tools (from TiDB MCP Server)

These require **SQL execution** capability, which means we need the **Data Service API** or direct database connection, NOT the Serverless Management API.

| Tool | Purpose | API Required |
|------|---------|--------------|
| `show_databases` | List all databases | SQL: `SHOW DATABASES` |
| `switch_database` | Connect to specific database | SQL: `USE {db_name}` |
| `show_tables` | Display tables in current database | SQL: `SHOW TABLES` |
| `db_query` | Run read-only SQL queries | SQL execution |
| `db_execute` | Run data modification SQL | SQL execution |
| `db_create_user` | Create database user | SQL: `CREATE USER` |
| `db_remove_user` | Delete database user | SQL: `DROP USER` |

**Important**: These 7 tools require a **separate connection method** - either:
- TiDB Serverless Driver (`@tidbcloud/serverless`)
- MySQL2 driver with TLS connection
- Data Service API endpoints

### 1.2 Branch Management Tools (already partially implemented)

| Tool | Purpose | API Endpoint | Status |
|------|---------|--------------|--------|
| `tidbcloud_create_branch` | Create a branch | POST `/v1beta1/clusters/{id}/branches` | ✅ Exists |
| `tidbcloud_list_branches` | List all branches | GET `/v1beta1/clusters/{id}/branches` | ⚠️ Client exists, tool needed |
| `tidbcloud_get_branch` | Get branch details | GET `/v1beta1/clusters/{id}/branches/{branchId}` | ⚠️ Client exists, tool needed |
| `tidbcloud_delete_branch` | Delete a branch | DELETE `/v1beta1/clusters/{id}/branches/{branchId}` | ⚠️ Client exists, tool needed |

### 1.3 Cluster Management Tools (new)

| Tool | Purpose | API Endpoint |
|------|---------|--------------|
| `tidbcloud_list_clusters` | List all clusters | GET `/v1beta1/clusters` |
| `tidbcloud_get_cluster` | Get cluster details | GET `/v1beta1/clusters/{id}` |
| `tidbcloud_create_cluster` | Create new cluster | POST `/v1beta1/clusters` |
| `tidbcloud_update_cluster` | Update cluster settings | PATCH `/v1beta1/clusters/{id}` |
| `tidbcloud_delete_cluster` | Delete cluster | DELETE `/v1beta1/clusters/{id}` |

---

## Part 2: Async Operation Handling

### 2.1 Operations That Are Async

Based on the API documentation, these operations return immediately but complete asynchronously:
- Cluster creation (state: `CREATING` → `ACTIVE`)
- Branch creation (state: `CREATING` → `ACTIVE`)
- Cluster deletion (state: `DELETING` → removed)
- Branch deletion (state: `DELETING` → removed)

### 2.2 Strategy: Stateless Context Passing (Neon Pattern)

Following Neon's approach, we will:
1. **Return immediately** with operation status and resource ID
2. **Include status in response** so user/LLM knows it's pending
3. **Provide a separate status-check tool** for polling
4. **Pass context through the LLM** (no server-side state)

### 2.3 Status Check Tools

| Tool | Purpose |
|------|---------|
| `tidbcloud_get_cluster_status` | Check cluster creation/deletion status |
| `tidbcloud_get_branch_status` | Check branch creation/deletion status |

**Response Format Example**:
```
Branch "dev-branch" creation initiated.

Status: CREATING
Branch ID: branch-abc123
Cluster ID: cluster-xyz789

Note: Branch creation typically takes 1-2 minutes. 
Use tidbcloud_get_branch_status to check when it becomes ACTIVE.
```

---

## Part 3: Implementation Plan

### Phase 1: Extend API Client (Day 1)

**File**: `packages/server/src/api/client.ts`

Add methods:
```typescript
// Cluster operations
listClusters(): Promise<{ clusters: Cluster[] }>
getCluster(clusterId: string): Promise<Cluster>
createCluster(request: CreateClusterRequest): Promise<Cluster>
updateCluster(clusterId: string, request: UpdateClusterRequest): Promise<Cluster>
deleteCluster(clusterId: string): Promise<void>
```

**File**: `packages/server/src/api/types.ts`

Add types:
```typescript
interface Cluster {
  clusterId: string
  displayName: string
  state: ClusterState
  region: string
  createdAt: string
  // ... other fields from API spec
}

enum ClusterState {
  CREATING, ACTIVE, PAUSED, RESUMING, MODIFYING, DELETING
}

interface CreateClusterRequest {
  displayName: string
  region: string
  // ... other fields
}
```

### Phase 2: Implement Cluster Tools (Day 2)

**New File**: `packages/server/src/tools/cluster.ts`

Implement:
- `tidbcloud_list_clusters`
- `tidbcloud_get_cluster`
- `tidbcloud_create_cluster`
- `tidbcloud_update_cluster`
- `tidbcloud_delete_cluster`

Each tool follows the existing pattern:
1. Zod schema for input validation
2. Call API client method
3. Format response with status info
4. Include async operation notes when applicable

### Phase 3: Complete Branch Tools (Day 2)

**File**: `packages/server/src/tools/branch.ts`

Add tools:
- `tidbcloud_list_branches`
- `tidbcloud_get_branch`
- `tidbcloud_delete_branch`

### Phase 4: SQL Execution Tools (Day 3-4)

**Decision Required**: How to execute SQL queries?

**Option A: TiDB Serverless Driver** (Recommended)
- Add `@tidbcloud/serverless` dependency
- Connect using cluster connection string
- Requires: host, username, password per cluster

**Option B: MySQL2 Driver**
- Add `mysql2` dependency
- Direct TLS connection to cluster
- Requires: connection credentials

**Option C: Data Service API**
- Use existing Digest Auth
- Different API endpoint per Data App
- Requires: Data App setup per cluster

**Recommendation**: Use **Option A** (`@tidbcloud/serverless`) because:
- Official TiDB driver
- Works well with serverless deployments
- Connection pooling handled
- Compatible with edge runtimes

**New File**: `packages/server/src/db/client.ts`
```typescript
class TiDBConnection {
  constructor(connectionString: string)
  query(sql: string): Promise<QueryResult>
  execute(sql: string | string[]): Promise<ExecuteResult>
  close(): Promise<void>
}
```

**New File**: `packages/server/src/tools/database.ts`

Implement:
- `show_databases`
- `switch_database`
- `show_tables`
- `db_query`
- `db_execute`
- `db_create_user`
- `db_remove_user`

### Phase 5: Testing & Documentation (Day 5)

1. Test all tools with MCP Inspector
2. Update README with new tools
3. Update DEV_NOTES with findings

---

## Part 4: Files to Modify/Create

### Modified Files
| File | Changes |
|------|---------|
| `packages/server/src/api/client.ts` | Add cluster CRUD methods |
| `packages/server/src/api/types.ts` | Add Cluster types |
| `packages/server/src/tools/branch.ts` | Add list, get, delete tools |
| `packages/server/src/tools/index.ts` | Export new tool registrations |
| `packages/server/src/server.ts` | Register new tools |
| `packages/server/package.json` | Add `@tidbcloud/serverless` dependency |
| `README.md` | Document new tools |

### New Files
| File | Purpose |
|------|---------|
| `packages/server/src/tools/cluster.ts` | Cluster management tools |
| `packages/server/src/tools/database.ts` | SQL execution tools |
| `packages/server/src/db/client.ts` | Database connection client |
| `packages/server/src/db/types.ts` | Database types |

---

## Part 5: Tool Specifications

### Cluster Tools

#### `tidbcloud_list_clusters`
```typescript
Input: {
  pageSize?: number  // default 10
  pageToken?: string // for pagination
}
Output: List of clusters with state, region, connection info
```

#### `tidbcloud_create_cluster`
```typescript
Input: {
  displayName: string     // required
  region: string          // required, e.g., "us-east-1"
  rootPassword?: string   // optional, auto-generated if not provided
  labels?: Record<string, string>
}
Output: Cluster details with CREATING status, connection info
```

### Database Tools

#### `db_query`
```typescript
Input: {
  clusterId: string       // required
  sql: string             // required, read-only SQL
  database?: string       // optional, database to use
}
Output: Query results as formatted table
Annotations: { readOnlyHint: true }
```

#### `db_execute`
```typescript
Input: {
  clusterId: string       // required
  sql: string | string[]  // required, DML statements
  database?: string       // optional
}
Output: Execution result (rows affected)
Annotations: { readOnlyHint: false, destructiveHint: true }
```

---

## Part 6: Verification Plan

### Local Testing with MCP Inspector

```bash
# Build
pnpm build

# Test with inspector
TIDB_CLOUD_PUBLIC_KEY='xxx' \
TIDB_CLOUD_PRIVATE_KEY='yyy' \
npx @modelcontextprotocol/inspector node packages/server/dist/index.js
```

### Test Scenarios

1. **Cluster Operations**
   - List clusters → verify pagination works
   - Create cluster → verify async status returned
   - Get cluster → verify status updates
   - Delete cluster → verify async handling

2. **Branch Operations**
   - List branches for a cluster
   - Create branch → already tested
   - Get branch status
   - Delete branch

3. **Database Operations** (requires active cluster)
   - Connect to cluster
   - Run `SHOW DATABASES`
   - Run `SELECT` query
   - Run `INSERT` statement
   - Create/remove user

---

## Part 7: Decision Required - SQL Execution Approach

**For the SQL execution tools (show_databases, db_query, db_execute, etc.), how should we handle database credentials?**

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A** | Environment Variables (`TIDB_CLOUD_DB_USER`, `TIDB_CLOUD_DB_PASSWORD`) | Simple setup | Only one cluster at a time |
| **B** | Per-Tool Parameters (username/password in each call) | Multi-cluster flexible | User provides creds each time |
| **C** | Skip SQL tools for Milestone 1 | Focus on Management API only | Add SQL in later milestone |

**Recommendation**: Option C - defer SQL tools to a later milestone, keeping Milestone 1 focused on the Management API (Cluster + Branch CRUD). But save it as a TODO for the Milestone 2 plan.

---

## Summary

| Category | Count | Status |
|----------|-------|--------|
| Cluster Management Tools | 5 | New |
| Branch Management Tools | 4 | 1 exists, 3 new |
| Database/SQL Tools | 7 | New |
| **Total Tools** | **16** | |

This plan provides full feature parity with the TiDB MCP Server and adds cluster management capabilities with proper async operation handling.
