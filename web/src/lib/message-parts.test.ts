import { describe, expect, it } from "vitest";
import { parseMessageParts, sourceFromRowId } from "./message-parts.js";

describe("parseMessageParts", () => {
  it("splits plain text with no citations into a single text part", () => {
    expect(parseMessageParts("No citations here.")).toEqual([{ type: "text", text: "No citations here." }]);
  });

  it("splits text around a single citation", () => {
    const parts = parseMessageParts("You spent $4.33 [plaid_abc] at Starbucks.");
    expect(parts).toEqual([
      { type: "text", text: "You spent $4.33 " },
      { type: "citation", rowId: "plaid_abc" },
      { type: "text", text: " at Starbucks." },
    ]);
  });

  it("handles multiple citations", () => {
    const parts = parseMessageParts("[plaid_a] and [plaid_b]");
    expect(parts).toEqual([
      { type: "citation", rowId: "plaid_a" },
      { type: "text", text: " and " },
      { type: "citation", rowId: "plaid_b" },
    ]);
  });

  it("does not treat a markdown link as a citation", () => {
    const parts = parseMessageParts("See [the docs](https://example.com).");
    expect(parts).toEqual([{ type: "text", text: "See [the docs](https://example.com)." }]);
  });

  it("handles a citation at the very start and end with no surrounding text", () => {
    expect(parseMessageParts("[plaid_x]")).toEqual([{ type: "citation", rowId: "plaid_x" }]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseMessageParts("")).toEqual([]);
  });
});

describe("sourceFromRowId", () => {
  it("maps known prefixes to their source label", () => {
    expect(sourceFromRowId("calendar_abc")).toBe("Calendar");
    expect(sourceFromRowId("plaid_abc")).toBe("Plaid");
    expect(sourceFromRowId("alpaca_abc")).toBe("Alpaca");
  });

  it("returns Unknown for an unrecognized prefix", () => {
    expect(sourceFromRowId("mystery_abc")).toBe("Unknown");
  });
});
