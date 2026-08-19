import { parseMessageParts } from "../lib/message-parts.js";
import { CitationChip } from "./CitationChip.js";

/** Renders answer text with [row_id] markers replaced by citation chips. */
export function MessageText({ text }: { text: string }) {
  const parts = parseMessageParts(text);
  return (
    <p className="message-text">
      {parts.map((part, i) =>
        part.type === "text" ? (
          <span key={i}>{part.text}</span>
        ) : (
          <CitationChip key={i} rowId={part.rowId} />
        )
      )}
    </p>
  );
}
