import type { SpanItem } from "../hooks/useAgentChat.js";
import { formatDurationMs } from "../lib/format.js";

const SPAN_LABEL: Record<SpanItem["spanType"], string> = {
  llm_call: "LLM call",
  tool_exec: "Tool execution",
  citation_validation: "Citation validation",
};

export function SpanWaterfall({ spans }: { spans: SpanItem[] }) {
  if (spans.length === 0) {
    return <p className="empty-state">No spans recorded for this turn yet.</p>;
  }

  const maxDuration = Math.max(1, ...spans.map((s) => s.durationMs ?? 0));

  return (
    <div className="span-waterfall">
      {spans.map((span) => {
        const widthPct = span.durationMs ? Math.max(2, (span.durationMs / maxDuration) * 100) : 2;
        return (
          <div key={span.spanId} className={`span-row span-row--${span.status}`}>
            <div className="span-row-label">
              <span>{SPAN_LABEL[span.spanType]}</span>
              {span.label && <span className="span-row-sublabel">{span.label}</span>}
            </div>
            <div className="span-row-bar-track">
              <div
                className="span-row-bar"
                style={{ width: `${widthPct}%` }}
                title={span.durationMs ? `${span.durationMs}ms` : "running…"}
              />
            </div>
            <div className="span-row-duration">{formatDurationMs(span.durationMs)}</div>
            {span.usage && (
              <div className="span-row-usage" title="input / output / cache-read tokens for this call">
                {span.usage.inputTokens}in · {span.usage.outputTokens}out · {span.usage.cacheReadInputTokens}cached
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
