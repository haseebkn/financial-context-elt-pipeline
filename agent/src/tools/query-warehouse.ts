import { z } from "zod/v4";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { guardSql } from "../lib/sql-guard.js";
import { queryRows } from "../lib/duckdb.js";
import { createResultId } from "../lib/result-id.js";

const QueryWarehouseSchema = z
  .object({
    sql: z
      .string()
      .min(1)
      .describe(
        "A single read-only SELECT query against the warehouse. Available tables: " +
          "main_analytics.fct_context_rows (unified narrative rows across all sources — columns: " +
          "row_id, source, event_timestamp, extracted_at, summary_text, raw_payload [JSON text]), " +
          "main_analytics.dim_account_snapshot (Alpaca account balance history — columns: account_id, " +
          "status, cash, equity, portfolio_value, buying_power, long_market_value, short_market_value, " +
          "extracted_at), main_staging.stg_alpaca_orders, main_staging.stg_calendar_events, " +
          "main_staging.stg_plaid_transactions (raw per-extraction rows), " +
          "main_intermediate.int_calendar_events, main_intermediate.int_plaid_transactions " +
          "(deduplicated to the freshest state per record). " +
          "For per-transaction amount/category on fct_context_rows, parse raw_payload: " +
          "CAST(raw_payload AS JSON)->>'$.amount'. Use this tool for counts, sums, filters, and joins " +
          "the other tools don't cover — not for open-ended semantic questions (use search_context)."
      ),
  })
  .strict();

const MAX_RESULT_ROWS_IN_RESPONSE = 200;

export const queryWarehouseTool = betaZodTool({
  name: "query_warehouse",
  description:
    "Runs a read-only SQL query against the DuckDB warehouse. Use this for aggregations (totals, " +
    "counts, group-bys), precise filters, or joins across sources that semantic search can't answer " +
    "correctly. Every query is validated: only SELECT statements against the warehouse's own tables " +
    "are permitted, no file access or statement chaining. If a query is rejected, the reason explains " +
    "exactly what to fix — retry once with a corrected query rather than giving up.",
  inputSchema: QueryWarehouseSchema,
  run: async (args) => {
    const guard = guardSql(args.sql);
    if (!guard.ok) {
      return `Query rejected: ${guard.reason}`;
    }

    try {
      const rows = await queryRows(guard.sql!);
      if (rows.length === 0) {
        const payload = { sql: guard.sql, rows: [] };
        return JSON.stringify(
          {
            result_id: createResultId("query", payload),
            rows: [],
            note: "Query returned 0 rows.",
          },
          null,
          2
        );
      }
      const truncated = rows.length > MAX_RESULT_ROWS_IN_RESPONSE;
      const payload = truncated ? rows.slice(0, MAX_RESULT_ROWS_IN_RESPONSE) : rows;
      return JSON.stringify(
        {
          result_id: createResultId("query", { sql: guard.sql, rows: payload }),
          rows: payload,
          ...(truncated
            ? {
                truncated: true,
                returned_rows: MAX_RESULT_ROWS_IN_RESPONSE,
                total_rows: rows.length,
                guidance: "Add aggregation or a tighter filter instead of relying on more rows.",
              }
            : {}),
        },
        null,
        2
      );
    } catch (e) {
      return `Query failed to execute: ${(e as Error).message}. This usually means a column or table name is wrong — check the schema in the tool description and retry once.`;
    }
  },
});
