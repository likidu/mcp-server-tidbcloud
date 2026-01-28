/**
 * TiDB Database client using @tidbcloud/serverless driver
 */

import {
    connect,
    type Connection,
    type FullResult,
} from "@tidbcloud/serverless";
import type { DatabaseConfig, QueryResult, ExecuteResult } from "./types.js";

/**
 * Custom error class for database errors
 */
export class TiDBDatabaseError extends Error {
    public readonly code?: string;

    constructor(message: string, code?: string) {
        super(message);
        this.name = "TiDBDatabaseError";
        this.code = code;
    }
}

/**
 * TiDB Database client for executing SQL queries
 */
export class TiDBDatabase {
    private config: DatabaseConfig;

    constructor(config: DatabaseConfig) {
        this.config = config;
    }

    /**
     * Creates a connection to the database
     */
    private createConnection(database?: string): Connection {
        return connect({
            host: this.config.host,
            username: this.config.username,
            password: this.config.password,
            database: database ?? this.config.database,
        });
    }

    /**
     * Executes a read-only query and returns the results
     * @param sql - The SQL query to execute
     * @param params - Optional query parameters
     * @param database - Optional database to use (overrides default)
     */
    async query(
        sql: string,
        params?: unknown[],
        database?: string,
    ): Promise<QueryResult> {
        try {
            const conn = this.createConnection(database);
            const result = (await conn.execute(sql, params, {
                fullResult: true,
            })) as FullResult;

            // Extract column names from the types object
            const columns = result.types ? Object.keys(result.types) : [];
            const rows = (result.rows ?? []) as Record<string, unknown>[];

            return {
                columns,
                rows,
                rowCount: rows.length,
            };
        } catch (error) {
            throw this.handleError(error);
        }
    }

    /**
     * Executes a DML/DDL statement and returns the affected row count
     * @param sql - The SQL statement to execute
     * @param params - Optional query parameters
     * @param database - Optional database to use (overrides default)
     */
    async execute(
        sql: string,
        params?: unknown[],
        database?: string,
    ): Promise<ExecuteResult> {
        try {
            const conn = this.createConnection(database);
            const result = (await conn.execute(sql, params, {
                fullResult: true,
            })) as FullResult;

            return {
                rowsAffected: result.rowsAffected ?? 0,
                lastInsertId: result.lastInsertId
                    ? Number(result.lastInsertId)
                    : undefined,
            };
        } catch (error) {
            throw this.handleError(error);
        }
    }

    /**
     * Executes multiple SQL statements in sequence
     * @param statements - Array of SQL statements to execute
     * @param database - Optional database to use
     */
    async executeMultiple(
        statements: string[],
        database?: string,
    ): Promise<ExecuteResult[]> {
        const results: ExecuteResult[] = [];
        for (const sql of statements) {
            const result = await this.execute(sql, undefined, database);
            results.push(result);
        }
        return results;
    }

    /**
     * Handles and transforms database errors into user-friendly messages
     */
    private handleError(error: unknown): TiDBDatabaseError {
        if (error instanceof Error) {
            const message = error.message;

            // Extract error code if available
            const codeMatch = message.match(/^(\w+):/);
            const code = codeMatch ? codeMatch[1] : undefined;

            // Map common errors to user-friendly messages
            if (
                message.includes("Access denied") ||
                message.includes("authentication")
            ) {
                return new TiDBDatabaseError(
                    "Authentication failed. Check username and password.",
                    "ER_ACCESS_DENIED_ERROR",
                );
            }

            if (
                message.includes("Unknown database") ||
                message.includes("database doesn't exist")
            ) {
                return new TiDBDatabaseError(
                    "Database does not exist.",
                    "ER_BAD_DB_ERROR",
                );
            }

            if (message.includes("doesn't exist")) {
                return new TiDBDatabaseError(
                    "Table does not exist.",
                    "ER_NO_SUCH_TABLE",
                );
            }

            if (message.includes("syntax") || message.includes("parse error")) {
                return new TiDBDatabaseError(
                    `SQL syntax error: ${message}`,
                    "ER_PARSE_ERROR",
                );
            }

            if (message.includes("Duplicate entry")) {
                return new TiDBDatabaseError(
                    "Duplicate entry for key.",
                    "ER_DUP_ENTRY",
                );
            }

            if (
                message.includes("connect") ||
                message.includes("ECONNREFUSED")
            ) {
                return new TiDBDatabaseError(
                    "Cannot connect to database. Check host and port.",
                    "ECONNREFUSED",
                );
            }

            return new TiDBDatabaseError(message, code);
        }

        return new TiDBDatabaseError("An unexpected database error occurred");
    }
}

/**
 * Validates that a SQL statement is read-only
 * @param sql - The SQL statement to validate
 * @returns true if the statement is read-only
 */
export function isReadOnlyQuery(sql: string): boolean {
    const normalized = sql.trim().toUpperCase();
    const readOnlyPrefixes = [
        "SELECT",
        "SHOW",
        "DESCRIBE",
        "DESC",
        "EXPLAIN",
        "WITH", // CTEs that start with WITH are typically SELECT
    ];
    return readOnlyPrefixes.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Formats a database error into a user-friendly message
 */
export function formatDatabaseError(error: unknown): string {
    if (error instanceof TiDBDatabaseError) {
        return `Error: ${error.message}`;
    }

    if (error instanceof Error) {
        return `Error: ${error.message}`;
    }

    return "Error: An unexpected database error occurred";
}
