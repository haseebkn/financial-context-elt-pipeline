import { describe, expect, it } from "vitest";
import { extractCitations, extractRowIdsFromToolResult, validateCitations } from "./citations.js";

describe("extractCitations", () => {
  it("finds bracketed row_id citations", () => {
    const text = "You spent $12 at the coffee shop [plaid_t1] and $50 on groceries [plaid_t2].";
    expect(extractCitations(text)).toEqual(["plaid_t1", "plaid_t2"]);
  });

  it("dedupes repeated citations", () => {
    const text = "See [calendar_e1] and again [calendar_e1].";
    expect(extractCitations(text)).toEqual(["calendar_e1"]);
  });

  it("does not treat a markdown link as a citation", () => {
    const text = "See [the docs](https://example.com) for more.";
    expect(extractCitations(text)).toEqual([]);
  });

  it("returns an empty array when there are no citations", () => {
    expect(extractCitations("No citations here.")).toEqual([]);
  });
});

describe("extractRowIdsFromToolResult", () => {
  it("finds row_ids embedded in JSON tool output", () => {
    const toolResult = JSON.stringify([
      { row_id: "plaid_t1", text: "Coffee" },
      { row_id: "alpaca_o5", text: "Order" },
    ]);
    expect(extractRowIdsFromToolResult(toolResult)).toEqual(
      expect.arrayContaining(["plaid_t1", "alpaca_o5"])
    );
  });

  it("returns an empty array for tool output with no row_ids", () => {
    expect(extractRowIdsFromToolResult("Query returned 0 rows.")).toEqual([]);
  });
});

describe("validateCitations", () => {
  it("is valid when every citation is backed by a seen row_id", () => {
    const result = validateCitations("You spent $12 [plaid_t1].", new Set(["plaid_t1"]));
    expect(result.valid).toBe(true);
    expect(result.unsupportedIds).toEqual([]);
  });

  it("is invalid when a citation was never seen in a tool result", () => {
    const result = validateCitations("You spent $12 [plaid_t99].", new Set(["plaid_t1"]));
    expect(result.valid).toBe(false);
    expect(result.unsupportedIds).toEqual(["plaid_t99"]);
  });

  it("is valid with zero citations (caller decides if that's suspicious)", () => {
    const result = validateCitations("I don't have data on that.", new Set());
    expect(result.valid).toBe(true);
    expect(result.citedIds).toEqual([]);
  });

  it("flags only the unsupported subset when some citations are valid and some are not", () => {
    const result = validateCitations("[plaid_t1] is real, [plaid_fake] is not.", new Set(["plaid_t1"]));
    expect(result.valid).toBe(false);
    expect(result.unsupportedIds).toEqual(["plaid_fake"]);
  });
});
