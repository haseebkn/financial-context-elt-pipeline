/**
 * Splits rendered answer text into plain-text and citation segments, so the
 * UI can render [row_id] markers as clickable chips instead of raw text.
 * Mirrors the citation pattern in agent/src/lib/citations.ts (bracketed
 * token, not immediately followed by "(" so a markdown link isn't mistaken
 * for a citation) — kept as a small local copy rather than importing,
 * since this is a rendering concern that only needs the regex shape, not
 * the agent's validation logic.
 */

const CITATION_PATTERN = /\[([a-zA-Z0-9_-]+)\](?!\()/g;

export type MessagePart = { type: "text"; text: string } | { type: "citation"; rowId: string };

export function parseMessageParts(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(CITATION_PATTERN)) {
    const index = match.index;
    if (index > lastIndex) {
      parts.push({ type: "text", text: text.slice(lastIndex, index) });
    }
    parts.push({ type: "citation", rowId: match[1]! });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: "text", text: text.slice(lastIndex) });
  }

  return parts;
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
    default:
      return "Unknown";
  }
}
