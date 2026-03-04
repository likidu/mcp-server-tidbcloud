/**
 * HTAP diagnostics tools for TiDB Cloud MCP Server
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
    TiDBDatabase,
    DANGEROUS_PATTERNS,
    formatDatabaseError,
} from "../db/client.js";
import type { DatabaseConfig } from "../db/types.js";
import {
    ConnectionOverrideSchema,
    resolveConfig,
    formatQueryResultsAsTable,
} from "./utils.js";

// ============================================================================
// Tool Input Schemas
// ============================================================================

const ExplainFormat = z
    .enum(["row", "brief", "verbose", "dot", "tidb_json"])
    .optional()
    .default("row")
    .describe(
        "Output format for the execution plan (default: row)",
    );

const DbExplainInputSchema = ConnectionOverrideSchema.extend({
    sql: z
        .string()
        .min(1, "SQL query is required")
        .describe("The SQL statement to explain"),
    database: z.string().optional().describe("Database to use"),
    format: ExplainFormat,
}).strict();

const DbShowSlowQueriesInputSchema = ConnectionOverrideSchema.extend({
    database: z
        .string()
        .optional()
        .describe("Filter slow queries by database name"),
    limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(20)
        .describe("Maximum number of slow queries to return (1-100, default 20)"),
    threshold: z
        .number()
        .min(0)
        .optional()
        .describe("Minimum query time in seconds to filter by"),
}).strict();

// Type definitions
type DbExplainInput = z.infer<typeof DbExplainInputSchema>;
type DbShowSlowQueriesInput = z.infer<typeof DbShowSlowQueriesInputSchema>;

// ============================================================================
// HTAP Summary Helpers
// ============================================================================

interface HtapSummary {
    tidb: number;
    tikv: number;
    tiflash: number;
    totalTime: string | null;
    totalMemory: string | null;
    totalDisk: string | null;
}

/**
 * Parses EXPLAIN ANALYZE results to produce an HTAP engine breakdown.
 * Looks at the `task` column to categorize operators by engine.
 */
function buildHtapSummary(rows: Record<string, unknown>[]): HtapSummary {
    const summary: HtapSummary = {
        tidb: 0,
        tikv: 0,
        tiflash: 0,
        totalTime: null,
        totalMemory: null,
        totalDisk: null,
    };

    for (const row of rows) {
        const task = String(row["task"] ?? row["Task"] ?? "").toLowerCase();
        if (task.includes("tiflash") || task.includes("mpp")) {
            summary.tiflash++;
        } else if (task.includes("tikv") || task.includes("cop")) {
            summary.tikv++;
        } else {
            // root tasks run in the TiDB SQL layer
            summary.tidb++;
        }
    }

    // Extract totals from the root operator (first row)
    if (rows.length > 0) {
        const root = rows[0];
        const time = root["time"] ?? root["Time"] ?? root["act_time"];
        const mem = root["memory"] ?? root["Memory"] ?? root["mem"];
        const disk = root["disk"] ?? root["Disk"];

        if (time !== undefined && time !== null) summary.totalTime = String(time);
        if (mem !== undefined && mem !== null) summary.totalMemory = String(mem);
        if (disk !== undefined && disk !== null) summary.totalDisk = String(disk);
    }

    return summary;
}

function formatHtapSummary(summary: HtapSummary, isAnalyze: boolean): string {
    const lines = [
        "## HTAP Engine Breakdown",
        "",
        `| Engine | Operators |`,
        `| --- | --- |`,
        `| TiDB (SQL layer) | ${summary.tidb} |`,
        `| TiKV (row store) | ${summary.tikv} |`,
        `| TiFlash (columnar) | ${summary.tiflash} |`,
    ];

    if (isAnalyze) {
        lines.push("");
        lines.push("## Execution Stats");
        lines.push("");
        if (summary.totalTime) lines.push(`- **Total time:** ${summary.totalTime}`);
        if (summary.totalMemory) lines.push(`- **Memory:** ${summary.totalMemory}`);
        if (summary.totalDisk) lines.push(`- **Disk:** ${summary.totalDisk}`);
    }

    return lines.join("\n");
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Registers HTAP diagnostics tools with the MCP server
 */
export function registerDiagnosticsTools(
    server: McpServer,
    defaultConfig: DatabaseConfig | undefined,
): void {
    // ========================================================================
    // db_explain
    // ========================================================================
    server.registerTool(
        "db_explain",
        {
            title: "Explain Query",
            description: `Explains a SQL statement's execution plan with HTAP engine breakdown (TiDB/TiKV/TiFlash).

For SELECT/WITH queries, runs EXPLAIN ANALYZE to get actual execution stats.
For other statements (INSERT, UPDATE, etc.), runs EXPLAIN without execution.

Returns an HTAP summary showing which engines (TiDB SQL layer, TiKV row store, TiFlash columnar store) are used, plus the full execution plan.

Connection credentials (host, username, password) are needed. The host and username prefix can be obtained from tidbcloud_get_cluster (endpoints.public.host and userPrefix). Only the password needs to be provided by the user — either inline or pre-configured via Claude Desktop config headers.`,
            inputSchema: DbExplainInputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
        },
        async (params: DbExplainInput) => {
            try {
                // Validate against dangerous patterns
                if (DANGEROUS_PATTERNS.some((p) => p.test(params.sql))) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: "Error: SQL contains potentially dangerous patterns.",
                            },
                        ],
                    };
                }

                const config = resolveConfig(defaultConfig, params);
                const db = new TiDBDatabase(config);

                const normalized = params.sql.trim().toUpperCase();
                const isSelect =
                    normalized.startsWith("SELECT") ||
                    normalized.startsWith("WITH");

                const formatClause =
                    params.format && params.format !== "row"
                        ? `FORMAT='${params.format}' `
                        : "";

                const explainSql = isSelect
                    ? `EXPLAIN ANALYZE ${formatClause}${params.sql}`
                    : `EXPLAIN ${formatClause}${params.sql}`;

                const result = await db.query(
                    explainSql,
                    undefined,
                    params.database,
                );

                const summary = buildHtapSummary(result.rows);
                const table = formatQueryResultsAsTable(
                    result.columns,
                    result.rows,
                );

                const sections = [
                    `# ${isSelect ? "EXPLAIN ANALYZE" : "EXPLAIN"} Results`,
                    "",
                ];

                if (!isSelect) {
                    sections.push(
                        "> **Note:** EXPLAIN ANALYZE (with actual execution stats) is only available for SELECT/WITH queries. Showing estimated plan only.",
                        "",
                    );
                }

                sections.push(
                    formatHtapSummary(summary, isSelect),
                    "",
                    "## Full Execution Plan",
                    "",
                    table,
                );

                return {
                    content: [
                        { type: "text", text: sections.join("\n") },
                    ],
                    structuredContent: {
                        isAnalyze: isSelect,
                        htap: summary,
                        columns: result.columns,
                        rows: result.rows,
                        rowCount: result.rowCount,
                    },
                };
            } catch (error) {
                return {
                    content: [
                        { type: "text", text: formatDatabaseError(error) },
                    ],
                };
            }
        },
    );

    // ========================================================================
    // db_show_slow_queries
    // ========================================================================
    server.registerTool(
        "db_show_slow_queries",
        {
            title: "Show Slow Queries",
            description: `Lists slow queries from the TiDB Cloud cluster's slow query log.

Returns recent slow queries ordered by query time, with details including execution time, database, query text, and resource usage (CPU, memory, disk).

Connection credentials (host, username, password) are needed. The host and username prefix can be obtained from tidbcloud_get_cluster (endpoints.public.host and userPrefix). Only the password needs to be provided by the user — either inline or pre-configured via Claude Desktop config headers.`,
            inputSchema: DbShowSlowQueriesInputSchema,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
        },
        async (params: DbShowSlowQueriesInput) => {
            try {
                const config = resolveConfig(defaultConfig, params);
                const db = new TiDBDatabase(config);

                const conditions = ["Is_internal = 0"];
                if (params.database) {
                    // Escape single quotes in database name
                    const safeDb = params.database.replace(/'/g, "''");
                    conditions.push(`DB = '${safeDb}'`);
                }
                if (params.threshold !== undefined) {
                    conditions.push(`Query_time >= ${Number(params.threshold)}`);
                }

                const limit = params.limit ?? 20;
                const sql = [
                    "SELECT Time, Query_time, DB, Query, Digest, Cop_proc_avg, Mem_max, Disk_max",
                    "FROM INFORMATION_SCHEMA.SLOW_QUERY",
                    `WHERE ${conditions.join(" AND ")}`,
                    "ORDER BY Query_time DESC",
                    `LIMIT ${limit}`,
                ].join(" ");

                const result = await db.query(sql);

                const table = formatQueryResultsAsTable(
                    result.columns,
                    result.rows,
                );

                const textContent = [
                    "# Slow Queries",
                    "",
                    `Found ${result.rowCount} slow quer${result.rowCount === 1 ? "y" : "ies"}.`,
                    "",
                    table,
                ].join("\n");

                return {
                    content: [{ type: "text", text: textContent }],
                    structuredContent: {
                        columns: result.columns,
                        rows: result.rows,
                        rowCount: result.rowCount,
                    },
                };
            } catch (error) {
                return {
                    content: [
                        { type: "text", text: formatDatabaseError(error) },
                    ],
                };
            }
        },
    );
}
