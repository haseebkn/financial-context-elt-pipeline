import { describe, expect, it } from "vitest";
import { getPortfolioSnapshotTool } from "./get-portfolio-snapshot.js";

describe("get_portfolio_snapshot tool (integration, real warehouse)", () => {
  it("returns the latest account snapshot with real balance figures", async () => {
    const result = (await getPortfolioSnapshotTool.run({})) as string;
    const parsed = JSON.parse(result);

    expect(parsed.account).toBeTruthy();
    expect(parsed.account.status).toBe("ACTIVE");
    expect(typeof parsed.account.cash).toBe("string"); // DECIMAL comes back as JSON string
    expect(Number(parsed.account.cash)).toBeGreaterThan(0);
    expect(Array.isArray(parsed.recent_orders)).toBe(true);
  });

  it("notes when there are no orders rather than returning a silent empty array", async () => {
    const result = (await getPortfolioSnapshotTool.run({})) as string;
    const parsed = JSON.parse(result);
    if (parsed.recent_orders.length === 0) {
      expect(parsed.note).toMatch(/No trade orders on record/);
    }
  });
});
