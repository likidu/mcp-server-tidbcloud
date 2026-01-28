/**
 * Database-related type definitions
 */

/**
 * Database connection configuration
 */
export interface DatabaseConfig {
    host: string;
    username: string;
    password: string;
    database?: string;
}

/**
 * Query result with columns and rows
 */
export interface QueryResult {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
}

/**
 * Execute result for DML/DDL statements
 */
export interface ExecuteResult {
    rowsAffected: number;
    lastInsertId?: number;
}

/**
 * Database information from SHOW DATABASES
 */
export interface DatabaseInfo {
    name: string;
}

/**
 * Table information from SHOW TABLES
 */
export interface TableInfo {
    name: string;
    type: string;
}
