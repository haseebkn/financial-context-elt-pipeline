import { describe, expect, it } from "vitest";
import { scoreRetrievalRecall } from "./retrieval-recall.js";
import type { GoldenCase } from "../types.js";

function makeCase(expected_row_ids: string[]): GoldenCase {
  return {
    id: "test-1",
    category: "retrieval",
    question: "q",
    expected_tools: [],
    expected_row_ids,
    rubric: "r",
  };
}

describe("scoreRetrievalRecall", () => {
  it("scores 1.0 when every expected row_id was seen", () => {
    const c = makeCase(["plaid_a", "plaid_b"]);
    expect(scoreRetrievalRecall(c, ["plaid_a", "plaid_b", "plaid_c"])).toBe(1);
  });

  it("scores partial recall when only some expected row_ids were seen", () => {
    const c = makeCase(["plaid_a", "plaid_b"]);
    expect(scoreRetrievalRecall(c, ["plaid_a"])).toBe(0.5);
  });

  it("scores 0 when none of the expected row_ids were seen", () => {
    const c = makeCase(["plaid_a", "plaid_b"]);
    expect(scoreRetrievalRecall(c, ["plaid_z"])).toBe(0);
  });

  it("scores 1.0 automatically when the case has no expected row_ids", () => {
    const c = makeCase([]);
    expect(scoreRetrievalRecall(c, [])).toBe(1);
    expect(scoreRetrievalRecall(c, ["plaid_a"])).toBe(1);
  });

  it("accepts any occurrence of a recurring event by row-id prefix", () => {
    const c = {
      ...makeCase([]),
      expected_row_id_prefixes: ["calendar_birthday_event_"],
    };
    expect(scoreRetrievalRecall(c, ["calendar_birthday_event_20510726"])).toBe(1);
    expect(scoreRetrievalRecall(c, ["calendar_unrelated_20510726"])).toBe(0);
  });

  it("requires k-of-n candidates for a recurring merchant series", () => {
    const c = {
      ...makeCase([]),
      expected_row_id_sets: [{ any_of: ["plaid_a", "plaid_b", "plaid_c", "plaid_d"], min_hits: 2 }],
    };
    expect(scoreRetrievalRecall(c, ["plaid_a", "plaid_c"])).toBe(1);
    expect(scoreRetrievalRecall(c, ["plaid_a"])).toBe(0);
  });
});
