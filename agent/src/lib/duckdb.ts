import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { env } from "../config.js";

let instancePromise: Promise<DuckDBInstance> | null = null;

/**
 * Lazily creates a single read-only DuckDBInstance for the process.
 * READ_ONLY is enforced at the connection level as defense-in-depth
 * alongside the SQL guard in lib/sql-guard.ts — even a guard bypass
 * can't write to the warehouse.
 */
function getInstance(): Promise<DuckDBInstance> {
  if (!instancePromise) {
    instancePromise = DuckDBInstance.create(env.DUCKDB_PATH, { access_mode: "READ_ONLY" });
  }
  return instancePromise;
}

export async function withConnection<T>(fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
  const instance = await getInstance();
  const conn = await instance.connect();
  try {
    return await fn(conn);
  } finally {
    conn.closeSync();
  }
}

/** Runs a query and returns rows as plain JSON-safe objects. */
export async function queryRows(sql: string): Promise<Record<string, unknown>[]> {
  return withConnection(async (conn) => {
    const reader = await conn.runAndReadAll(sql);
    return reader.getRowObjectsJson() as Record<string, unknown>[];
  });
}

/** Runs a parameterized query ($1, $2, ...) and returns rows as plain JSON-safe objects. */
export async function queryRowsParams(
  sql: string,
  values: (string | number | boolean | null)[]
): Promise<Record<string, unknown>[]> {
  return withConnection(async (conn) => {
    const reader = await conn.runAndReadAll(sql, values);
    return reader.getRowObjectsJson() as Record<string, unknown>[];
  });
}
