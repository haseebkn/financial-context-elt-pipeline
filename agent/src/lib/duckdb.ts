import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { env } from "../config.js";

let instancePromise: Promise<DuckDBInstance> | null = null;
let activeOps = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * How long the warehouse file stays open after the last query finishes.
 * Long enough that the several queries inside one agent turn reuse a single
 * instance; short enough that the file is free again moments later.
 */
const IDLE_RELEASE_MS = 2_000;

/**
 * Lazily creates a read-only DuckDBInstance.
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

/**
 * Releases the warehouse file once nothing is querying it.
 *
 * The instance used to be a process-lifetime singleton, which meant the
 * agent held a lock on financial_engine.db from boot until shutdown. A
 * read-only DuckDB handle still blocks another process from opening the
 * file read-write, so `dbt build` failed outright while the agent was
 * running ("The process cannot access the file because it is being used by
 * another process") — and the documented workflow is to run dbt after
 * generating agent traffic. Holding the file only for the duration of
 * actual queries makes those two coexist.
 */
function scheduleRelease(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (activeOps > 0) return;
    const pending = instancePromise;
    instancePromise = null;
    void pending?.then((instance) => instance.closeSync()).catch(() => {});
  }, IDLE_RELEASE_MS);
  // Don't let the release timer hold the event loop open.
  idleTimer.unref?.();
}

/** Closes the warehouse immediately. Exported for shutdown and for tests. */
export async function closeWarehouse(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const pending = instancePromise;
  instancePromise = null;
  try {
    (await pending)?.closeSync();
  } catch {
    // Already closed, or never opened — nothing to release.
  }
}

export async function withConnection<T>(fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  activeOps++;
  try {
    const instance = await getInstance();
    const conn = await instance.connect();
    try {
      return await fn(conn);
    } finally {
      conn.closeSync();
    }
  } finally {
    activeOps--;
    if (activeOps === 0) scheduleRelease();
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
