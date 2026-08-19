import { describe, expect, it } from "vitest";
import { judgeSingle } from "./judge.js";
import type { GoldenCase } from "../types.js";

/**
 * Same wiring-verification pattern as src/agent-loop.smoke.test.ts: no real
 * ANTHROPIC_API_KEY is available in this environment, so this confirms the
 * judge's request (forced tool_choice, the submit_judgment schema) is
 * well-formed enough to reach the API and get a structured auth error back,
 * not a local crash. Skipped in CI.
 */
describe("judgeSingle (network smoke test — no real API key required)", () => {
  it.skipIf(process.env.CI)("reaches the API and fails with a structured auth error", async () => {
    const goldenCase: GoldenCase = {
      id: "smoke-1",
      category: "retrieval",
      question: "What did I spend at Starbucks?",
      expected_tools: ["search_context"],
      expected_row_ids: [],
      rubric: "Mentions a Starbucks purchase with an amount.",
    };

    await expect(judgeSingle(goldenCase, "You spent $4.33 at Starbucks.")).rejects.toThrow(
      /authentication|api key|invalid/i
    );
  });
});
