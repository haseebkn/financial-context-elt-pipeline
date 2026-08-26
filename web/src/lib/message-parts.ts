/**
 * Splits rendered answer text into plain-text and citation segments, so the
 * UI can render [row_id] markers as clickable chips instead of raw text.
 * Mirrors the citation pattern in agent/src/lib/citations.ts (bracketed
 * token, not immediately followed by "(" so a markdown link isn't mistaken
 * for a citation) — kept as a small local copy rather than importing,
 * since this is a rendering concern that only needs the regex shape, not
 * the agent's validation logic.
 */

/**
 * One pass over the inline syntax the agent actually emits: **bold**, `code`,
 * and [row_id] citations. The alternation keeps them mutually exclusive, so a
 * citation inside bold is treated as whichever opens first rather than
 * nesting — enough for the answers this renders, and far cheaper than
 * pulling in a full markdown parser for three constructs.
 */
const INLINE_PATTERN = /\*\*([^*]+)\*\*|`([^`]+)`|\[([a-zA-Z0-9_-]+)\](?!\()/g;

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "citation"; rowId: string }
  | { type: "bold"; text: string }
  | { type: "code"; text: string };

export type MessageBlock =
  | { type: "paragraph"; parts: MessagePart[] }
  | { type: "list"; items: MessagePart[][] }
  | { type: "table"; headers: MessagePart[][]; rows: MessagePart[][][] };

export function parseMessageParts(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index;
    if (index > lastIndex) {
      parts.push({ type: "text", text: text.slice(lastIndex, index) });
    }
    if (match[1] !== undefined) parts.push({ type: "bold", text: match[1] });
    else if (match[2] !== undefined) parts.push({ type: "code", text: match[2] });
    else if (match[3] !== undefined) parts.push({ type: "citation", rowId: match[3] });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", text: text.slice(lastIndex) });
  }

  return parts;
}

/**
 * Groups answer text into paragraphs and bullet lists.
 *
 * The agent emits markdown freely — bold figures, "- " bullets, blank-line
 * paragraph breaks — and this used to render inside a single <p>, so users
 * saw literal asterisks and every bullet ran onto one line.
 */
export function parseMessageBlocks(text: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  const splitTableRow = (line: string): string[] =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  const isTableSeparator = (line: string, columnCount: number): boolean => {
    const cells = splitTableRow(line);
    return (
      cells.length === columnCount &&
      cells.every((cell) => /^:?-{3,}:?$/.test(cell))
    );
  };

  const flushParagraph = () => {
    const joined = paragraphLines.join("\n").trim();
    if (joined) blocks.push({ type: "paragraph", parts: parseMessageParts(joined) });
    paragraphLines = [];
  };
  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ type: "list", items: listItems.map(parseMessageParts) });
    }
    listItems = [];
  };

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const headerCells = line.includes("|") ? splitTableRow(line) : [];
    if (
      headerCells.length > 1 &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1]!, headerCells.length)
    ) {
      flushList();
      flushParagraph();

      const rows: MessagePart[][][] = [];
      i += 2; // Skip the alignment row and advance to the first body row.
      while (i < lines.length) {
        const rowLine = lines[i]!;
        if (!rowLine.trim() || !rowLine.includes("|")) break;
        const cells = splitTableRow(rowLine);
        if (cells.length !== headerCells.length) break;
        rows.push(cells.map(parseMessageParts));
        i++;
      }

      blocks.push({
        type: "table",
        headers: headerCells.map(parseMessageParts),
        rows,
      });
      i--; // Let the outer loop process the first non-table line.
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      listItems.push(bullet[1]!);
    } else if (line.trim() === "") {
      flushList();
      flushParagraph();
    } else {
      flushList();
      paragraphLines.push(line);
    }
  }

  flushList();
  flushParagraph();
  return blocks;
}

/** Maps a row_id's prefix (calendar_/plaid_/alpaca_) to its source label. */
export function sourceFromRowId(rowId: string): string {
  const prefix = rowId.split("_")[0];
  switch (prefix) {
    case "calendar":
      return "Calendar";
    case "plaid":
      return "Plaid";
    case "alpaca":
      return "Alpaca";
    case "computed":
      return "Computed";
    default:
      return "Unknown";
  }
}
