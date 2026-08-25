import { describe, expect, it } from "vitest";
import {
  extractCitations,
  extractRowIdsFromToolResult,
  stripUnsupportedCitations,
  validateCitations,
} from "./citations.js";

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

describe("stripUnsupportedCitations", () => {
  it("removes an unsupported citation but keeps the claim", () => {
    const out = stripUnsupportedCitations("You spent $12 [plaid_fake].", new Set(["plaid_t1"]));
    expect(out).toBe("You spent $12.");
  });

  it("keeps supported citations untouched", () => {
    const text = "You spent $12 [plaid_t1] and $50 [plaid_t2].";
    expect(stripUnsupportedCitations(text, new Set(["plaid_t1", "plaid_t2"]))).toBe(text);
  });

  it("strips only the unsupported subset", () => {
    const out = stripUnsupportedCitations(
      "Real [plaid_t1], fake [plaid_fake], real again [plaid_t2].",
      new Set(["plaid_t1", "plaid_t2"])
    );
    expect(out).toBe("Real [plaid_t1], fake, real again [plaid_t2].");
  });

  it("is a no-op when there are no citations at all", () => {
    expect(stripUnsupportedCitations("I don't have that data.", new Set())).toBe(
      "I don't have that data."
    );
  });

  it("leaves markdown links alone", () => {
    const text = "See [the docs](https://example.com) for more.";
    expect(stripUnsupportedCitations(text, new Set())).toBe(text);
  });

  /**
   * F1 regression. The account balance answer below is entirely correct and
   * came straight from a successful get_portfolio_snapshot call; its only
   * defect is that the model cited an account_id rather than a row_id. The
   * previous LLM-based repair, handed an empty allowed list, replaced the
   * whole thing with "I don't have supporting records available to report
   * your cash balance" — a false statement about data it had retrieved.
   * Stripping must preserve every figure.
   */
  it("preserves a correct answer whose only fault is an invented citation", () => {
    const answer = [
      "**Cash: $100,000.00** — and no trades on record.",
      "",
      "Details from your latest Alpaca snapshot [bd132d5a-7d73-4878-b009-96d9d55c7afd]:",
      "",
      "- **Buying power:** $400,000.00 (4x margin on cash)",
      "- **Status:** ACTIVE",
    ].join("\n");

    const out = stripUnsupportedCitations(answer, new Set());

    expect(out).toContain("$100,000.00");
    expect(out).toContain("$400,000.00");
    expect(out).toContain("ACTIVE");
    expect(out).not.toContain("bd132d5a");
    expect(out).toContain("Details from your latest Alpaca snapshot:");
  });

  it("cannot shorten an answer by more than the citations it removed", () => {
    const answer = "Cash is $100,000.00 [bogus_id] as of today.";
    const out = stripUnsupportedCitations(answer, new Set());
    expect(out.length).toBeGreaterThan(answer.length - " [bogus_id]".length - 1);
    expect(out).toBe("Cash is $100,000.00 as of today.");
  });
});
