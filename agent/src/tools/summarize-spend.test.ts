import { describe, expect, it } from "vitest";
import { summarizeSpendTool } from "./summarize-spend.js";

describe("summarize_spend tool (integration, real warehouse)", () => {
  it("sums real spend by category over a wide date range", async () => {
    const result = (await summarizeSpendTool.run({
      start: "2020-01-01",
      end: "2030-01-01",
      group_by: "category",
      transaction_type: "spend",
    })) as string;

    const parsed = JSON.parse(result);
    expect(parsed.result_id).toMatch(/^computed_spend_[a-f0-9]{16}$/);
    expect(parsed.transaction_type).toBe("spend");
    expect(parsed.breakdown.length).toBeGreaterThan(0);
    // Every group total should be positive (spend convention: amount > 0).
    for (const g of parsed.breakdown) {
      expect(g.total).toBeGreaterThan(0);
    }
    expect(parsed.grand_total).toBeGreaterThan(0);
  });

  it("income totals come back positive despite negative underlying amounts", async () => {
    const result = (await summarizeSpendTool.run({
      start: "2020-01-01",
      end: "2030-01-01",
      group_by: "category",
      transaction_type: "income",
    })) as string;

    const parsed = JSON.parse(result);
    if (parsed.breakdown) {
      for (const g of parsed.breakdown) {
        expect(g.total).toBeGreaterThan(0); // ABS() applied
      }
    }
  });

  it("returns a clear message when nothing matches the range", async () => {
    const result = (await summarizeSpendTool.run({
      start: "1990-01-01",
      end: "1990-01-02",
      group_by: "category",
      transaction_type: "spend",
    })) as string;
    expect(result).toMatch(/No Plaid transactions found/);
  });

  it("groups by month without error", async () => {
    const result = (await summarizeSpendTool.run({
      start: "2020-01-01",
      end: "2030-01-01",
      group_by: "month",
      transaction_type: "spend",
    })) as string;
    const parsed = JSON.parse(result);
    expect(parsed.grouped_by).toBe("month");
  });

  it("rejects malformed dates before they ever reach SQL", async () => {
    await expect(async () => {
      summarizeSpendTool.parse({
        start: "not-a-date",
        end: "2026-01-01",
        group_by: "category",
        transaction_type: "spend",
      });
    }).rejects.toThrow();
  });
});
