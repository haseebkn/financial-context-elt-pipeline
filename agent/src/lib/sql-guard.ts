import pkg from "node-sql-parser";
const { Parser } = pkg;

/**
 * Validates and sanitizes SQL before it ever reaches DuckDB. This is the
 * defense-in-depth layer behind the query_warehouse tool: the DuckDB
 * connection is also opened READ_ONLY (see lib/duckdb.ts), but READ_ONLY
 * only blocks writes — it does NOT block DuckDB's file-reading table
 * functions (read_csv_auto, read_json_auto, ...), which can read arbitrary
 * local files regardless of read-only mode. That gap is why the function
 * blocklist below exists alongside the table allowlist, not instead of it.
 */

const parser = new Parser();
const PARSE_OPTS = { database: "Postgresql" } as const;

/** Every table the agent is allowed to query, schema-qualified. */
const ALLOWED_TABLES = new Set(
  [
    "main_staging.stg_alpaca_orders",
    "main_staging.stg_calendar_events",
    "main_staging.stg_plaid_transactions",
    "main_intermediate.int_calendar_events",
    "main_intermediate.int_plaid_transactions",
    "main_analytics.fct_context_rows",
    "main_analytics.dim_account_snapshot",
  ].map((t) => t.toLowerCase())
);

/**
 * Case-insensitive, word-boundary scan for DuckDB functions/statements that
 * can read or affect the filesystem or extension state. Table-function
 * calls like `read_csv_auto(...)` don't appear in node-sql-parser's
 * tableList() output at all (verified empirically), so the table allowlist
 * alone cannot catch them — this regex layer is load-bearing, not optional.
 */
const BANNED_PATTERN =
  /\b(read_csv|read_json|read_parquet|read_ndjson|read_text|read_blob|glob|sniff_csv|pragma|attach|detach|install|load|copy|export|import|httpfs|iceberg_scan|delta_scan|postgres_scan|postgres_attach|mysql_scan|mysql_attach|sqlite_scan|sqlite_attach|url|http_get)\w*/i;

const DEFAULT_ROW_LIMIT = 500;
const MAX_ROW_LIMIT = 2000;

export interface GuardResult {
  ok: boolean;
  /** The (possibly LIMIT-appended) SQL to actually run, when ok=true. */
  sql?: string;
  /** Human-readable reason, when ok=false — fed back to the model for a repair attempt. */
  reason?: string;
}

function extractTableRefs(sql: string): string[] {
  const raw = parser.tableList(sql, PARSE_OPTS);
  // node-sql-parser returns entries like "select::main_analytics::fct_context_rows"
  // or "select::null::x" for a CTE alias with no schema.
  return raw.map((entry) => {
    const parts = entry.split("::");
    const schema = parts[1];
    const table = parts[2] ?? entry;
    return schema && schema !== "null" ? `${schema}.${table}`.toLowerCase() : table.toLowerCase();
  });
}

export function guardSql(sqlInput: string): GuardResult {
  const sql = sqlInput.trim().replace(/;+\s*$/g, ""); // tolerate one trailing semicolon

  if (BANNED_PATTERN.test(sql)) {
    return {
      ok: false,
      reason:
        "Query references a disallowed function or statement (file I/O, extension management, or attach/detach). " +
        "Only SELECT queries against the warehouse's own tables are permitted.",
    };
  }

  let statements;
  try {
    statements = parser.astify(sql, PARSE_OPTS);
  } catch (e) {
    return { ok: false, reason: `SQL failed to parse: ${(e as Error).message.split("\n")[0]}` };
  }

  const statementArray = Array.isArray(statements) ? statements : [statements];
  if (statementArray.length !== 1) {
    return { ok: false, reason: "Only a single SQL statement is permitted (no statement chaining)." };
  }

  const stmt = statementArray[0]!;
  if (stmt.type !== "select") {
    return {
      ok: false,
      reason: `Only SELECT queries are permitted (got "${stmt.type}"). This tool is read-only.`,
    };
  }

  let tableRefs: string[];
  try {
    tableRefs = extractTableRefs(sql);
  } catch (e) {
    return { ok: false, reason: `Could not determine referenced tables: ${(e as Error).message.split("\n")[0]}` };
  }

  // CTE aliases surface with schema "null" -> unqualified name; drop those
  // from the allowlist check since they're not real tables, then require
  // at least one *real* qualified table remains and every one is allowed.
  const realTableRefs = tableRefs.filter((t) => t.includes("."));
  if (realTableRefs.length === 0) {
    return {
      ok: false,
      reason:
        "Query does not reference any warehouse table. " +
        `Available tables: ${[...ALLOWED_TABLES].join(", ")}.`,
    };
  }
  const disallowed = realTableRefs.filter((t) => !ALLOWED_TABLES.has(t));
  if (disallowed.length > 0) {
    return {
      ok: false,
      reason:
        `Query references table(s) not in the allowed set: ${disallowed.join(", ")}. ` +
        `Available tables: ${[...ALLOWED_TABLES].join(", ")}.`,
    };
  }

  const hasLimit = Array.isArray((stmt as any).limit?.value) && (stmt as any).limit.value.length > 0;
  let finalSql = sql;
  if (!hasLimit) {
    finalSql = `${sql} LIMIT ${DEFAULT_ROW_LIMIT}`;
  } else {
    const limitValue = (stmt as any).limit.value[(stmt as any).limit.value.length - 1]?.value;
    if (typeof limitValue === "number" && limitValue > MAX_ROW_LIMIT) {
      return {
        ok: false,
        reason: `LIMIT ${limitValue} exceeds the maximum of ${MAX_ROW_LIMIT} rows. Lower the LIMIT or aggregate instead.`,
      };
    }
  }

  return { ok: true, sql: finalSql };
}
