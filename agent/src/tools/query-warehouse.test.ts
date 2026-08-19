import { describe, expect, it } from "vitest";
import { queryWarehouseTool } from "./query-warehouse.js";

// These run against the real financial_engine.db over a READ_ONLY connection
// — safe (no writes possible) and gives genuine confidence the guard and
// the DuckDB layer actually compose correctly, not just in isolation.

describe("query_warehouse tool (integration, real warehouse)", () => {
  it("runs an allowed aggregation query and returns rows", async () => {
    const result = await queryWarehouseTool.run({
      sql: "SELECT source, COUNT(*) AS n FROM main_analytics.fct_context_rows GROUP BY source ORDER BY source",
    });
    expect(result).toContain("calendar");
    expect(result).toContain("plaid");
  });

  it("rejects a disallowed table with a clear reason fed back to the model", async () => {
    const result = await queryWarehouseTool.run({ sql: "SELECT * FROM main_analytics.nonexistent_table" });
    expect(result).toMatch(/Query rejected/);
    expect(result).toMatch(/not in the allowed set/);
  });

  it("rejects a write statement", async () => {
    const result = await queryWarehouseTool.run({
      sql: "DELETE FROM main_analytics.fct_context_rows",
    });
    expect(result).toMatch(/Query rejected/);
    expect(result).toMatch(/Only SELECT queries/);
  });

  it("rejects a path-traversal attempt via a table function", async () => {
    const result = await queryWarehouseTool.run({
      sql: "SELECT * FROM read_text('../README.md')",
    });
    expect(result).toMatch(/Query rejected/);
    expect(result).toMatch(/disallowed function/);
  });

  it("returns a clean message for zero rows rather than an empty JSON array", async () => {
    const result = await queryWarehouseTool.run({
      sql: "SELECT * FROM main_analytics.fct_context_rows WHERE row_id = 'this-row-id-does-not-exist'",
    });
    expect(result).toBe("Query returned 0 rows.");
  });

  it("surfaces a real DuckDB execution error usefully (bad column name)", async () => {
    const result = await queryWarehouseTool.run({
      sql: "SELECT this_column_does_not_exist FROM main_analytics.fct_context_rows",
    });
    expect(result).toMatch(/Query failed to execute/);
  });
});
