# Milestone 4: HTAP Diagnostics + Vector Search Tools

## Context

Current TiDB Cloud MCP 17-tool server is a strong foundation. M4 adds the two key differentiators that make this defensible: **HTAP diagnostics** (EXPLAIN ANALYZE with TiKV/TiFlash visibility) and **native vector search** (unified SQL + vector in one MCP server). No other database MCP server combines these capabilities.

## Scope: 5 New Tools

| Tool | Category | File |
|------|----------|------|
| `db_explain` | Diagnostics | `diagnostics.ts` |
| `db_show_slow_queries` | Diagnostics | `diagnostics.ts` |
| `db_vector_search` | Vector | `vector.ts` |
| `db_vector_upsert` | Vector | `vector.ts` |
| `db_vector_info` | Vector | `vector.ts` |

## Implementation Steps

### Step 1: Extract shared utilities into `packages/server/src/tools/utils.ts`

Extract from `database.ts` into a new shared file:
- `ConnectionOverrideSchema` (Zod schema for host/username/password overrides)
- `resolveConfig()` (resolves DB config from defaults + overrides)
- `formatQueryResultsAsTable()` (markdown table formatting)

Then update `database.ts` to import these from `utils.ts`. No behavior change.

Also export `DANGEROUS_PATTERNS` from `db/client.ts` (currently module-private) so `vector.ts` can reuse it for filter validation.

- [ ] Create `packages/server/src/tools/utils.ts`
- [ ] Refactor `packages/server/src/tools/database.ts` to import from utils
- [ ] Export `DANGEROUS_PATTERNS` from `packages/server/src/db/client.ts`

### Step 2: Create `packages/server/src/tools/diagnostics.ts`

#### `db_explain`
- **Input**: `sql` (required), `database` (optional), `format` (optional: row/brief/verbose/dot/tidb_json), + connection overrides
- **Behavior**:
  - If SQL starts with `SELECT` or `WITH`: runs `EXPLAIN ANALYZE [FORMAT='<format>'] <sql>`
  - Otherwise: runs `EXPLAIN [FORMAT='<format>'] <sql>` (no execution) with a warning that actual stats are only available for SELECT
  - Validates against `DANGEROUS_PATTERNS`
- **Output parsing**: Parse the `task` column to categorize operators:
  - `root` = TiDB SQL layer
  - `cop[tikv]` = TiKV (row store)
  - `cop[tiflash]` / `mpp[tiflash]` = TiFlash (columnar store)
- **Return**: HTAP summary (operator counts per engine, total time/memory/disk) + full execution plan as markdown table
- **Annotations**: `readOnlyHint: true`, `idempotentHint: true`

#### `db_show_slow_queries`
- **Input**: `database` (optional filter), `limit` (1-100, default 20), `threshold` (min query time in seconds), + connection overrides
- **SQL**:
  ```sql
  SELECT Time, Query_time, DB, Query, Digest, Cop_proc_avg, Mem_max, Disk_max
  FROM INFORMATION_SCHEMA.SLOW_QUERY
  WHERE Is_internal = 0
    [AND DB = '<database>']
    [AND Query_time >= <threshold>]
  ORDER BY Query_time DESC
  LIMIT <limit>
  ```
- **Return**: Formatted markdown table of slow queries
- **Annotations**: `readOnlyHint: true`, `idempotentHint: true`

- [ ] Implement `db_explain` tool
- [ ] Implement `db_show_slow_queries` tool

### Step 3: Create `packages/server/src/tools/vector.ts`

#### `db_vector_search`
- **Input**: `database`, `table`, `vectorColumn`, `queryVector` (number[]), `distanceMetric` (cosine/l2/negative_inner_product, default cosine), `limit` (1-1000, default 10), `columns` (optional string[]), `filter` (optional WHERE clause without WHERE keyword), + connection overrides
- **SQL**:
  ```sql
  SELECT <columns>, VEC_COSINE_DISTANCE(<vectorColumn>, VEC_FROM_TEXT('<json_array>')) AS distance
  FROM `<database>`.`<table>`
  [WHERE <filter>]
  ORDER BY distance ASC
  LIMIT <limit>
  ```
- **Distance function mapping**: cosine -> `VEC_COSINE_DISTANCE()`, l2 -> `VEC_L2_DISTANCE()`, negative_inner_product -> `VEC_NEGATIVE_INNER_PRODUCT()`
- **Security for `filter` param**: Validate against DANGEROUS_PATTERNS + block subqueries (SELECT/INSERT/UPDATE/DELETE/DROP/ALTER/CREATE keywords) + block semicolons

#### `db_vector_upsert`
- **Input**: `database`, `table`, `rows` (array of `{ data: Record<string, unknown>, vectors: Record<string, number[]> }`, max 100), `onDuplicate` (error/update, default error), + connection overrides
- **SQL**: Builds batch INSERT with `VEC_FROM_TEXT()` for vector columns. If `onDuplicate: "update"`, appends `ON DUPLICATE KEY UPDATE`.
- **Security**: Vector arrays validated by Zod as `z.array(z.number())`. Table/column names backtick-escaped.

#### `db_vector_info`
- **Input**: `database`, `table` (optional), + connection overrides
- **SQL**:
  ```sql
  SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_COMMENT
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = '<database>'
    AND COLUMN_TYPE LIKE 'VECTOR%'
    [AND TABLE_NAME = '<table>']
  ORDER BY TABLE_NAME, ORDINAL_POSITION
  ```
  Plus a second query for vector indexes.
- **Return**: Tables with their vector columns (name, type, dimensions) and vector indexes

- [ ] Implement `db_vector_search` tool
- [ ] Implement `db_vector_upsert` tool
- [ ] Implement `db_vector_info` tool

### Step 4: Wire up registration

- [ ] Update `packages/server/src/tools/index.ts` - add exports for `registerDiagnosticsTools` and `registerVectorTools`
- [ ] Update `packages/server/src/server.ts` - register new tool groups
- [ ] Update `packages/remote/src/app.ts` - register new tool groups (+ imports)

### Step 5: Update documentation

- [ ] Update `SKILL.md` with 5 new tools
- [ ] Update `packages/remote/src/skill.ts` with same content

## Key Files

| File | Action |
|------|--------|
| `packages/server/src/tools/utils.ts` | **Create** - shared schemas and helpers |
| `packages/server/src/tools/diagnostics.ts` | **Create** - 2 diagnostics tools |
| `packages/server/src/tools/vector.ts` | **Create** - 3 vector tools |
| `packages/server/src/tools/database.ts` | **Modify** - import shared utils instead of inline definitions |
| `packages/server/src/tools/index.ts` | **Modify** - add 2 new exports |
| `packages/server/src/db/client.ts` | **Modify** - export `DANGEROUS_PATTERNS` |
| `packages/server/src/server.ts` | **Modify** - register new tool groups |
| `packages/remote/src/app.ts` | **Modify** - register new tool groups |
| `SKILL.md` + `packages/remote/src/skill.ts` | **Modify** - document new tools |

## Verification

1. `pnpm build` - both packages compile without errors
2. `pnpm dev` with MCP inspector - verify all 22 tools appear (17 existing + 5 new)
3. Manual testing with a real TiDB Cloud Serverless cluster:
   - `db_explain` with a SELECT query - verify HTAP summary shows operator breakdown
   - `db_show_slow_queries` - verify it returns results (or empty set)
   - `db_vector_info` on a database with vector columns
   - `db_vector_upsert` to insert test vectors
   - `db_vector_search` to query those vectors back
4. `pnpm dev:remote` - verify remote server registers all tools correctly
