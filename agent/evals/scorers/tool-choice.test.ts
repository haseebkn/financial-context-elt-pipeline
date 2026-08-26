import { describe, expect, it } from "vitest";
import { scoreToolChoice } from "./tool-choice.js";
import type { GoldenCase } from "../types.js";

function makeCase(overrides: Partial<GoldenCase>): GoldenCase {
  return {
    id: "test-1",
    category: "retrieval",
    question: "q",
    expected_tools: [],
    expected_row_ids: [],
    rubric: "r",
    ...overrides,
  };
}

describe("scoreToolChoice", () => {
  it("passes when the actual call matches one of several acceptable tools", () => {
    const c = makeCase({ expected_tools: ["summarize_spend", "query_warehouse"] });
    expect(scoreToolChoice(c, ["query_warehouse"])).toBe(1);
  });

  it("fails when no actual tool call matches any acceptable tool", () => {
    const c = makeCase({ expected_tools: ["search_context"] });
    expect(scoreToolChoice(c, ["query_warehouse"])).toBe(0);
  });

  it("fails when no tool was called at all but one was expected", () => {
    const c = makeCase({ expected_tools: ["search_context"] });
    expect(scoreToolChoice(c, [])).toBe(0);
  });

  it("refusal category with empty expected_tools requires zero tool calls", () => {
    const c = makeCase({ category: "refusal", expected_tools: [] });
    expect(scoreToolChoice(c, [])).toBe(1);
    expect(scoreToolChoice(c, ["search_context"])).toBe(0);
  });

  it("non-refusal category with empty expected_tools always passes", () => {
    const c = makeCase({ category: "nodata", expected_tools: [] });
    expect(scoreToolChoice(c, [])).toBe(1);
    expect(scoreToolChoice(c, ["query_warehouse"])).toBe(1);
  });

  it("fails when an otherwise-correct turn calls a forbidden irrelevant tool", () => {
    const c = makeCase({
      expected_tools: ["query_warehouse"],
      forbidden_tools: ["get_portfolio_snapshot"],
    });
    expect(scoreToolChoice(c, ["query_warehouse"])).toBe(1);
    expect(scoreToolChoice(c, ["query_warehouse", "get_portfolio_snapshot"])).toBe(0);
  });
});
