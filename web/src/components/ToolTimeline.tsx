import type { ToolTimelineItem } from "../hooks/useAgentChat.js";
import { formatDurationMs, formatToolName } from "../lib/format.js";

const STATUS_ICON: Record<ToolTimelineItem["status"], string> = {
  running: "◌",
  done: "✓",
  error: "✕",
};

function ToolInput({ item }: { item: ToolTimelineItem }) {
  if (item.name === "query_warehouse" && item.input && typeof item.input === "object" && "sql" in item.input) {
    return <pre className="tool-sql">{String((item.input as { sql: unknown }).sql)}</pre>;
  }
  const input = item.input as Record<string, unknown> | undefined;
  const keys = input ? Object.keys(input) : [];
  if (keys.length === 0) return null;
  return (
    <div className="tool-args">
      {keys.map((k) => (
        <span key={k}>
          <code>{k}</code>=<code>{JSON.stringify(input![k])}</code>
        </span>
      ))}
    </div>
  );
}

export function ToolTimeline({ items }: { items: ToolTimelineItem[] }) {
  if (items.length === 0) return null;

  return (
    <ol className="tool-timeline">
      {items.map((item) => (
        <li key={item.toolCallId} className={`tool-item tool-item--${item.status}`}>
          <div className="tool-item-head">
            <span className="tool-status-icon" aria-hidden>
              {STATUS_ICON[item.status]}
            </span>
            <span className="tool-name">{formatToolName(item.name)}</span>
            {item.durationMs !== undefined && (
              <span className="tool-duration">{formatDurationMs(item.durationMs)}</span>
            )}
          </div>
          <ToolInput item={item} />
          {item.status !== "running" && item.summary && (
            <details className="tool-summary">
              <summary>{item.status === "error" ? "Error details" : "Result"}</summary>
              <pre>{item.summary}</pre>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}
