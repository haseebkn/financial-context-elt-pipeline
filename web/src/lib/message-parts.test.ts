import { describe, expect, it } from "vitest";
import { parseMessageBlocks, parseMessageParts, sourceFromRowId } from "./message-parts.js";

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

describe("parseMessageParts — markdown inline", () => {
  it("parses bold as its own part instead of leaving literal asterisks", () => {
    expect(parseMessageParts("Cash: **$100,000.00** today")).toEqual([
      { type: "text", text: "Cash: " },
      { type: "bold", text: "$100,000.00" },
      { type: "text", text: " today" },
    ]);
  });

  it("parses inline code", () => {
    expect(parseMessageParts("run `npm test` now")).toEqual([
      { type: "text", text: "run " },
      { type: "code", text: "npm test" },
      { type: "text", text: " now" },
    ]);
  });

  it("keeps citations working alongside markdown", () => {
    expect(parseMessageParts("**$4.33** at Starbucks [plaid_t1]")).toEqual([
      { type: "bold", text: "$4.33" },
      { type: "text", text: " at Starbucks " },
      { type: "citation", rowId: "plaid_t1" },
    ]);
  });
});

describe("parseMessageBlocks", () => {
  it("splits paragraphs on blank lines", () => {
    const blocks = parseMessageBlocks("First para.\n\nSecond para.");
    expect(blocks).toEqual([
      { type: "paragraph", parts: [{ type: "text", text: "First para." }] },
      { type: "paragraph", parts: [{ type: "text", text: "Second para." }] },
    ]);
  });

  it("groups consecutive bullets into a single list", () => {
    const blocks = parseMessageBlocks("- one\n- two\n- three");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("list");
    if (blocks[0]!.type === "list") expect(blocks[0]!.items).toHaveLength(3);
  });

  it("separates a lead-in line from the bullets that follow it", () => {
    const blocks = parseMessageBlocks(
      "The four charges:\n- 2026-06-11 [plaid_a]\n- 2026-05-12 [plaid_b]"
    );
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "list"]);
    if (blocks[1]!.type === "list") expect(blocks[1]!.items).toHaveLength(2);
  });

  it("keeps citations inside list items", () => {
    const blocks = parseMessageBlocks("- charge [plaid_a]");
    const items = blocks[0]!.type === "list" ? blocks[0]!.items : [];
    expect(items[0]).toContainEqual({ type: "citation", rowId: "plaid_a" });
  });

  it("renders bold inside a paragraph rather than as asterisks", () => {
    const blocks = parseMessageBlocks("Cash is **$100,000.00**.");
    if (blocks[0]!.type === "paragraph") {
      expect(blocks[0]!.parts).toContainEqual({ type: "bold", text: "$100,000.00" });
    }
  });

  it("produces no blocks for empty or whitespace-only text", () => {
    expect(parseMessageBlocks("")).toEqual([]);
    expect(parseMessageBlocks("   \n\n  ")).toEqual([]);
  });

  it("keeps a multi-line paragraph as one block", () => {
    const blocks = parseMessageBlocks("line one\nline two");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("paragraph");
  });

  it("parses the markdown table emitted by a live aggregation turn", () => {
    const blocks = parseMessageBlocks(
      [
        "Spending by category:",
        "",
        "| Category | Total | Txns |",
        "|---|---:|---:|",
        "| Food and Drink | **$4,422.92** | 20 |",
        "| Recreation | $314.00 | 4 |",
      ].join("\n")
    );

    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "table"]);
    const table = blocks[1]!;
    expect(table.type).toBe("table");
    if (table.type === "table") {
      expect(table.headers).toHaveLength(3);
      expect(table.rows).toHaveLength(2);
      expect(table.rows[0]![1]).toContainEqual({ type: "bold", text: "$4,422.92" });
    }
  });

  it("keeps citation chips inside table cells", () => {
    const blocks = parseMessageBlocks(
      "| Merchant | Amount |\n|---|---:|\n| Starbucks [plaid_a] | $4.33 |"
    );
    const table = blocks[0]!;
    expect(table.type).toBe("table");
    if (table.type === "table") {
      expect(table.rows[0]![0]).toContainEqual({ type: "citation", rowId: "plaid_a" });
    }
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
