/**
 * Database SQL execution tools for TiDB Cloud MCP Server
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  TiDBDatabase,
  TiDBDatabaseError,
  isReadOnlyQuery,
  formatDatabaseError,
} from "../db/client.js";
import type { DatabaseConfig } from "../db/types.js";

// ============================================================================
// Zod Schemas for Connection Override
// ============================================================================

const ConnectionOverrideSchema = z.object({
  host: z
    .string()
    .optional()
    .describe("Database host (overrides environment variable)"),
  username: z
    .string()
    .optional()
    .describe("Database username (overrides environment variable)"),
  password: z
    .string()
    .optional()
    .describe("Database password (overrides environment variable)"),
});

// ============================================================================
// Tool Input Schemas
// ============================================================================

const ShowDatabasesInputSchema = ConnectionOverrideSchema.strict();

const ShowTablesInputSchema = ConnectionOverrideSchema.extend({
  database: z
    .string()
    .min(1, "Database name is required")
    .describe("The database to list tables from"),
}).strict();

const DbQueryInputSchema = ConnectionOverrideSchema.extend({
  sql: z
    .string()
    .min(1, "SQL query is required")
    .describe(
      "The read-only SQL query to execute (SELECT, SHOW, DESCRIBE, EXPLAIN)",
    ),
  database: z.string().optional().describe("Database to use for the query"),
}).strict();

const DbExecuteInputSchema = ConnectionOverrideSchema.extend({
  sql: z
    .union([z.string(), z.array(z.string())])
    .describe("SQL statement(s) to execute (INSERT, UPDATE, DELETE, DDL)"),
  database: z
    .string()
    .optional()
    .describe("Database to use for the statements"),
}).strict();

const DbCreateUserInputSchema = z
  .object({
    username: z
      .string()
      .min(1, "Username is required")
      .describe("The username for the new database user"),
    password: z
      .string()
      .min(1, "Password is required")
      .describe("The password for the new database user"),
    userHost: z
      .string()
      .optional()
      .default("%")
      .describe(
        "Host from which the user can connect (default: '%' for any host)",
      ),
    // Admin connection overrides
    host: z
      .string()
      .optional()
      .describe("Admin database host (overrides environment variable)"),
    adminUsername: z
      .string()
      .optional()
      .describe("Admin username (overrides environment variable)"),
    adminPassword: z
      .string()
      .optional()
      .describe("Admin password (overrides environment variable)"),
  })
  .strict();

const DbRemoveUserInputSchema = z
  .object({
    username: z
      .string()
      .min(1, "Username is required")
      .describe("The username of the database user to remove"),
    userHost: z
      .string()
      .optional()
      .default("%")
      .describe("Host specification for the user (default: '%')"),
    // Admin connection overrides
    host: z
      .string()
      .optional()
      .describe("Admin database host (overrides environment variable)"),
    adminUsername: z
      .string()
      .optional()
      .describe("Admin username (overrides environment variable)"),
    adminPassword: z
      .string()
      .optional()
      .describe("Admin password (overrides environment variable)"),
  })
  .strict();

// Type definitions
type ShowDatabasesInput = z.infer<typeof ShowDatabasesInputSchema>;
type ShowTablesInput = z.infer<typeof ShowTablesInputSchema>;
type DbQueryInput = z.infer<typeof DbQueryInputSchema>;
type DbExecuteInput = z.infer<typeof DbExecuteInputSchema>;
type DbCreateUserInput = z.infer<typeof DbCreateUserInputSchema>;
type DbRemoveUserInput = z.infer<typeof DbRemoveUserInputSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolves database configuration from defaults and overrides
 */
function resolveConfig(
  defaultConfig: DatabaseConfig | undefined,
  overrides: { host?: string; username?: string; password?: string },
): DatabaseConfig {
  const host = overrides.host ?? defaultConfig?.host;
  const username = overrides.username ?? defaultConfig?.username;
  const password = overrides.password ?? defaultConfig?.password;

  if (!host || !username || !password) {
    throw new TiDBDatabaseError(
      "Database connection not configured. " +
        "The user has two options: " +
        "(1) Provide host, username, and password in this conversation, or " +
        "(2) Configure credentials in Claude Desktop config using mcp-remote --header flags " +
        "(recommended for persistent setup - credentials stay local, never stored on server). " +
        "Use tidbcloud_get_cluster to retrieve the host and port for the cluster.",
    );
  }

  return {
    host,
    username,
    password,
    database: defaultConfig?.database,
  };
}

/**
 * Formats query results as a markdown table
 */
function formatQueryResultsAsTable(
  columns: string[],
  rows: Record<string, unknown>[],
): string {
  if (rows.length === 0) {
    return "No results returned.";
  }

  const lines: string[] = [];

  // Header row
  lines.push("| " + columns.join(" | ") + " |");
  // Separator row
  lines.push("| " + columns.map(() => "---").join(" | ") + " |");
  // Data rows
  for (const row of rows) {
    const values = columns.map((col) => {
      const value = row[col];
      if (value === null) return "NULL";
      if (value === undefined) return "";
      return String(value);
    });
    lines.push("| " + values.join(" | ") + " |");
  }

  return lines.join("\n");
}

// ============================================================================
// Tool Registration
// ============================================================================

/**
 * Registers database SQL tools with the MCP server
 */
export function registerDatabaseTools(
  server: McpServer,
  defaultConfig: DatabaseConfig | undefined,
): void {
  // ========================================================================
  // show_databases
  // ========================================================================
  server.registerTool(
    "show_databases",
    {
      title: "Show Databases",
      description: `Lists all databases in the TiDB Cloud cluster.

Executes SHOW DATABASES and returns the list of database names.

Args:
  - host (string, optional): Database host override
  - username (string, optional): Username override
  - password (string, optional): Password override

Returns:
  List of database names in the cluster.`,
      inputSchema: ShowDatabasesInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ShowDatabasesInput) => {
      try {
        const config = resolveConfig(defaultConfig, params);
        const db = new TiDBDatabase(config);
        const result = await db.query("SHOW DATABASES");

        const databases = result.rows.map((row) => {
          const values = Object.values(row);
          return values[0] as string;
        });

        const textContent = [
          "# Databases",
          "",
          `Found ${databases.length} database(s):`,
          "",
          ...databases.map((name) => `- ${name}`),
        ].join("\n");

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: { databases },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatDatabaseError(error) }],
        };
      }
    },
  );

  // ========================================================================
  // show_tables
  // ========================================================================
  server.registerTool(
    "show_tables",
    {
      title: "Show Tables",
      description: `Lists all tables in a specified database.

Executes SHOW TABLES and returns the list of table names.

Args:
  - database (string, required): The database to list tables from
  - host (string, optional): Database host override
  - username (string, optional): Username override
  - password (string, optional): Password override

Returns:
  List of table names in the database.`,
      inputSchema: ShowTablesInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ShowTablesInput) => {
      try {
        const config = resolveConfig(defaultConfig, params);
        const db = new TiDBDatabase(config);
        const result = await db.query(
          `SHOW TABLES FROM \`${params.database}\``,
        );

        const tables = result.rows.map((row) => {
          const values = Object.values(row);
          return values[0] as string;
        });

        const textContent = [
          `# Tables in \`${params.database}\``,
          "",
          `Found ${tables.length} table(s):`,
          "",
          ...tables.map((name) => `- ${name}`),
        ].join("\n");

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: { database: params.database, tables },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatDatabaseError(error) }],
        };
      }
    },
  );

  // ========================================================================
  // db_query
  // ========================================================================
  server.registerTool(
    "db_query",
    {
      title: "Database Query",
      description: `Executes a read-only SQL query against the TiDB Cloud cluster.

Only SELECT, SHOW, DESCRIBE, and EXPLAIN statements are allowed.
Results are returned as a formatted markdown table.

Args:
  - sql (string, required): The read-only SQL query to execute
  - database (string, optional): Database to use for the query
  - host (string, optional): Database host override
  - username (string, optional): Username override
  - password (string, optional): Password override

Returns:
  Query results as a markdown table.`,
      inputSchema: DbQueryInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: DbQueryInput) => {
      try {
        // Validate read-only query
        if (!isReadOnlyQuery(params.sql)) {
          return {
            content: [
              {
                type: "text",
                text: "Error: Only read-only queries (SELECT, SHOW, DESCRIBE, EXPLAIN) are allowed. Use db_execute for data modification.",
              },
            ],
          };
        }

        const config = resolveConfig(defaultConfig, params);
        const db = new TiDBDatabase(config);
        const result = await db.query(params.sql, undefined, params.database);

        const tableOutput = formatQueryResultsAsTable(
          result.columns,
          result.rows,
        );

        const textContent = [
          "# Query Results",
          "",
          `Returned ${result.rowCount} row(s).`,
          "",
          tableOutput,
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
          content: [{ type: "text", text: formatDatabaseError(error) }],
        };
      }
    },
  );

  // ========================================================================
  // db_execute
  // ========================================================================
  server.registerTool(
    "db_execute",
    {
      title: "Database Execute",
      description: `Executes SQL statements that modify data or schema.

Use this for INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, and other DDL/DML statements.
Can execute a single statement or multiple statements in sequence.

**WARNING:** This tool can modify or delete data. Use with caution.

Args:
  - sql (string | string[], required): SQL statement(s) to execute
  - database (string, optional): Database to use
  - host (string, optional): Database host override
  - username (string, optional): Username override
  - password (string, optional): Password override

Returns:
  Number of rows affected by each statement.`,
      inputSchema: DbExecuteInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: DbExecuteInput) => {
      try {
        const config = resolveConfig(defaultConfig, params);
        const db = new TiDBDatabase(config);

        const statements = Array.isArray(params.sql)
          ? params.sql
          : [params.sql];

        const results = await db.executeMultiple(statements, params.database);

        const lines = [
          "# Execution Results",
          "",
          `Executed ${statements.length} statement(s).`,
          "",
        ];

        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          lines.push(`**Statement ${i + 1}:**`);
          lines.push(`- Rows affected: ${result.rowsAffected}`);
          if (result.lastInsertId !== undefined) {
            lines.push(`- Last insert ID: ${result.lastInsertId}`);
          }
          lines.push("");
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: {
            statementCount: statements.length,
            results: results.map((r) => ({
              rowsAffected: r.rowsAffected,
              lastInsertId: r.lastInsertId,
            })),
          },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatDatabaseError(error) }],
        };
      }
    },
  );

  // ========================================================================
  // db_create_user
  // ========================================================================
  server.registerTool(
    "db_create_user",
    {
      title: "Create Database User",
      description: `Creates a new database user in TiDB Cloud.

Creates a user with the specified username, password, and host restriction.

Args:
  - username (string, required): Username for the new user
  - password (string, required): Password for the new user
  - userHost (string, optional): Host restriction (default: '%' for any host)
  - host (string, optional): Admin database host override
  - adminUsername (string, optional): Admin username override
  - adminPassword (string, optional): Admin password override

Returns:
  Success message with created user information.`,
      inputSchema: DbCreateUserInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: DbCreateUserInput) => {
      try {
        const config = resolveConfig(defaultConfig, {
          host: params.host,
          username: params.adminUsername,
          password: params.adminPassword,
        });
        const db = new TiDBDatabase(config);

        const userHost = params.userHost ?? "%";
        const sql = `CREATE USER '${params.username}'@'${userHost}' IDENTIFIED BY '${params.password}'`;

        await db.execute(sql);

        const textContent = [
          "# User Created Successfully",
          "",
          `**Username:** ${params.username}`,
          `**Host:** ${userHost}`,
          "",
          "> Note: Grant privileges to the user using GRANT statements.",
        ].join("\n");

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: {
            username: params.username,
            host: userHost,
            created: true,
          },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatDatabaseError(error) }],
        };
      }
    },
  );

  // ========================================================================
  // db_remove_user
  // ========================================================================
  server.registerTool(
    "db_remove_user",
    {
      title: "Remove Database User",
      description: `Removes a database user from TiDB Cloud.

**WARNING:** This action is irreversible. The user will be permanently deleted.

Args:
  - username (string, required): Username of the user to remove
  - userHost (string, optional): Host specification (default: '%')
  - host (string, optional): Admin database host override
  - adminUsername (string, optional): Admin username override
  - adminPassword (string, optional): Admin password override

Returns:
  Success message confirming user removal.`,
      inputSchema: DbRemoveUserInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: DbRemoveUserInput) => {
      try {
        const config = resolveConfig(defaultConfig, {
          host: params.host,
          username: params.adminUsername,
          password: params.adminPassword,
        });
        const db = new TiDBDatabase(config);

        const userHost = params.userHost ?? "%";
        const sql = `DROP USER '${params.username}'@'${userHost}'`;

        await db.execute(sql);

        const textContent = [
          "# User Removed Successfully",
          "",
          `**Username:** ${params.username}`,
          `**Host:** ${userHost}`,
          "",
          "> The user has been permanently deleted.",
        ].join("\n");

        return {
          content: [{ type: "text", text: textContent }],
          structuredContent: {
            username: params.username,
            host: userHost,
            removed: true,
          },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatDatabaseError(error) }],
        };
      }
    },
  );
}
