/**
 * Shared utilities for database tools
 */

import { z } from "zod";
import { TiDBDatabaseError } from "../db/client.js";
import type { DatabaseConfig } from "../db/types.js";

// ============================================================================
// Zod Schemas for Connection Override
// ============================================================================

export const ConnectionOverrideSchema = z.object({
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
// Helper Functions
// ============================================================================

/**
 * Resolves database configuration from defaults and overrides
 */
export function resolveConfig(
    defaultConfig: DatabaseConfig | undefined,
    overrides: { host?: string; username?: string; password?: string },
): DatabaseConfig {
    const host = overrides.host ?? defaultConfig?.host;
    const username = overrides.username ?? defaultConfig?.username;
    const password = overrides.password ?? defaultConfig?.password;

    if (!host || !username || !password) {
        throw new TiDBDatabaseError(
            "Database credentials missing. " +
                "Use tidbcloud_get_cluster to get host (endpoints.public.host) and username prefix (userPrefix), " +
                "then ask the user for the password. " +
                "Alternatively, credentials can be pre-configured via Claude Desktop config headers.",
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
export function formatQueryResultsAsTable(
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
