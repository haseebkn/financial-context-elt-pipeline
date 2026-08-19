import type { AgentStreamEvent } from "../streaming-types.js";
import type { TraceRecord } from "./trace-writer.js";

/**
 * Pure reducer over one turn's full event list -> a persistable TraceRecord.
 * Kept separate from trace-writer.ts's file I/O and from the route handler
 * so it can be tested with plain arrays of events, no server or filesystem
 * involved.
 */
export function buildTraceRecord(events: AgentStreamEvent[], question: string): TraceRecord {
  const toolCalls: TraceRecord["tool_calls"] = [];
  let stopReason = "unknown";
  let iterations = 0;
  let repaired = false;
  let errored = false;
  let errorMessage: string | null = null;
  let citationsValid = true;
  let usage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, estimatedCostUsd: 0 };
  let totalDurationMs = 0;
  const traceId = events.find((e) => "traceId" in e)?.traceId ?? "unknown";

  for (const event of events) {
    switch (event.type) {
      case "tool_result":
        toolCalls.push({ name: event.name, duration_ms: event.durationMs, is_error: event.isError });
        break;
      case "text_correction":
        repaired = true;
        // citations_valid tracks whether the ORIGINAL streamed answer had a
        // valid citation set, not whether the post-repair text does — a
        // text_correction only ever fires because validateCitations()
        // found an unsupported citation in that original answer.
        citationsValid = false;
        break;
      case "error":
        if (event.fatal) {
          errored = true;
          errorMessage = event.message;
        }
        break;
      case "done":
        stopReason = event.stopReason;
        iterations = event.iterations;
        repaired = repaired || event.repaired;
        usage = event.usage;
        totalDurationMs = event.totalDurationMs;
        break;
    }
  }

  return {
    trace_id: traceId,
    question,
    stop_reason: stopReason,
    iterations,
    repaired,
    errored,
    error_message: errorMessage,
    citations_valid: citationsValid,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_creation_input_tokens: usage.cacheCreationInputTokens,
    cache_read_input_tokens: usage.cacheReadInputTokens,
    cost_usd: usage.estimatedCostUsd,
    total_duration_ms: totalDurationMs,
    tool_calls: toolCalls,
  };
}
