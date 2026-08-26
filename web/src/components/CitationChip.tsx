import { sourceFromRowId } from "../lib/message-parts.js";

const SOURCE_COLOR: Record<string, string> = {
  Calendar: "#a78bfa",
  Plaid: "#34d399",
  Alpaca: "#fbbf24",
  Computed: "#60a5fa",
  Unknown: "#9ca3af",
};

export function CitationChip({ rowId }: { rowId: string }) {
  const source = sourceFromRowId(rowId);
  const color = SOURCE_COLOR[source] ?? SOURCE_COLOR["Unknown"];

  return (
    <span
      className="citation-chip"
      style={{ "--chip-color": color } as React.CSSProperties}
      title={rowId}
    >
      {source}
    </span>
  );
}
