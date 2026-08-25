import { z } from "zod/v4";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { queryRowsParams } from "../lib/duckdb.js";

const GetPortfolioSnapshotSchema = z.object({}).strict();

/**
 * Deterministic, fixed-shape read of current account state — deliberately
 * NOT left to freeform SQL. The arithmetic and "what counts as current"
 * logic that matters most (latest balance, not an average or a stale row)
 * should be tested code, not generated on the fly per request.
 */
export const getPortfolioSnapshotTool = betaZodTool({
  name: "get_portfolio_snapshot",
  description:
    "Returns the user's current Alpaca account state: cash, equity, buying power, and market value of " +
    "open positions, plus their 5 most recent trade orders. Use this for 'what's my balance', " +
    "'how much cash do I have', 'what are my recent trades' — it always returns the latest known " +
    "snapshot, not a historical average.",
  inputSchema: GetPortfolioSnapshotSchema,
  run: async () => {
    const accountRows = await queryRowsParams(
      `SELECT account_id, status, cash, equity, portfolio_value, buying_power,
              long_market_value, short_market_value, extracted_at
       FROM main_analytics.dim_account_snapshot
       ORDER BY extracted_at DESC
       LIMIT 1`,
      []
    );

    if (accountRows.length === 0) {
      return "No account snapshot is available yet. The Alpaca extractor may not have run.";
    }

    const recentOrders = await queryRowsParams(
      `SELECT
         row_id,
         CAST(raw_payload AS JSON)->>'$.symbol' AS symbol,
         CAST(raw_payload AS JSON)->>'$.side' AS side,
         CAST(raw_payload AS JSON)->>'$.quantity' AS quantity,
         CAST(raw_payload AS JSON)->>'$.status' AS status,
         CAST(raw_payload AS JSON)->>'$.filled_price' AS filled_price,
         event_timestamp
       FROM main_analytics.fct_context_rows
       WHERE source = 'alpaca'
       ORDER BY event_timestamp DESC
       LIMIT 5`,
      []
    );

    // dim_account_snapshot has no row_id of its own, so synthesize one that
    // identifies this exact snapshot. Without it the model has nothing
    // citable to attach a balance claim to, every citation it invents is
    // unsupported, and the citation guard strips it — see F1 in the Phase 2
    // findings. The `alpaca_` prefix is what extractRowIdsFromToolResult
    // harvests, so this lands in seenRowIds like any real row.
    const account = accountRows[0] as Record<string, unknown>;
    const snapshotStamp = String(account["extracted_at"] ?? "").replace(/[^0-9]/g, "");
    const accountRowId = `alpaca_account_${String(account["account_id"] ?? "unknown")}_${snapshotStamp}`;

    return JSON.stringify(
      {
        account: { row_id: accountRowId, ...account },
        recent_orders: recentOrders,
        note:
          recentOrders.length === 0
            ? "No trade orders on record — this account has not placed any trades."
            : undefined,
      },
      null,
      2
    );
  },
});
