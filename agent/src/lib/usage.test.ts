import { describe, expect, it } from "vitest";
import { addUsage, emptyUsage, estimateCostUsd } from "./usage.js";

describe("usage accounting", () => {
  it("starts at zero", () => {
    const u = emptyUsage();
    expect(u.inputTokens).toBe(0);
    expect(u.estimatedCostUsd).toBe(0);
  });

  it("accumulates across multiple turns", () => {
    let usage = emptyUsage();
    usage = addUsage(usage, { input_tokens: 100, output_tokens: 50 }, "claude-opus-5");
    usage = addUsage(usage, { input_tokens: 20, output_tokens: 10 }, "claude-opus-5");
    expect(usage.inputTokens).toBe(120);
    expect(usage.outputTokens).toBe(60);
  });

  it("prices cache reads far cheaper than fresh input", () => {
    const fresh = estimateCostUsd(
      { inputTokens: 1_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      "claude-opus-5"
    );
    const cached = estimateCostUsd(
      { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 1_000_000 },
      "claude-opus-5"
    );
    expect(cached).toBeLessThan(fresh);
    expect(fresh).toBe(5.0);
    expect(cached).toBe(0.5);
  });

  it("returns 0 cost for an unpriced model rather than throwing", () => {
    const cost = estimateCostUsd(
      { inputTokens: 1000, outputTokens: 1000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      "some-unknown-model"
    );
    expect(cost).toBe(0);
  });

  it("prices claude-sonnet-5, the current AGENT_MODEL default", async () => {
    // Regression guard for exactly how AGENT_MODEL got switched from
    // claude-opus-5 to claude-sonnet-5: config.ts's default changed, but
    // PRICE_PER_MTOK is a separate table, and estimateCostUsd falls back to
    // 0 for anything missing from it (see the test above) — so every trace
    // written after that switch would have silently reported $0 cost until
    // this was caught. Importing config.ts's actual default, rather than
    // repeating the string "claude-sonnet-5" here, means this test breaks
    // the moment the two drift apart again, on either side.
    const { env } = await import("../config.js");
    const cost = estimateCostUsd(
      { inputTokens: 1_000_000, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      env.AGENT_MODEL
    );
    expect(cost).toBeGreaterThan(0);
  });
});
