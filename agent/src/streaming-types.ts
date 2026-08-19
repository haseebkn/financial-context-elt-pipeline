/**
 * The SSE event union the agent loop emits and the frontend consumes.
 * Defined once here so both sides of the boundary share a single source
 * of truth instead of duplicating the shape.
 */

export interface TraceMeta {
  traceId: string;
}

export interface TextDeltaEvent extends TraceMeta {
  type: "text_delta";
  text: string;
}

export interface ThinkingDeltaEvent extends TraceMeta {
  type: "thinking_delta";
  text: string;
}

export interface ToolCallEvent extends TraceMeta {
  type: "tool_call";
  toolCallId: string;
  name: string;
  input: unknown;
}

export interface ToolResultEvent extends TraceMeta {
  type: "tool_result";
  toolCallId: string;
  name: string;
  isError: boolean;
  /** Kept small/summarized — full payloads live in the trace record, not the stream. */
  summary: string;
  durationMs: number;
}

export type SpanType = "llm_call" | "tool_exec" | "citation_validation";

export interface SpanStartEvent extends TraceMeta {
  type: "span_start";
  spanId: string;
  spanType: SpanType;
  /** e.g. the tool name for a tool_exec span. */
  label?: string;
}

export interface SpanEndEvent extends TraceMeta {
  type: "span_end";
  spanId: string;
  spanType: SpanType;
  durationMs: number;
  isError: boolean;
  /** Populated only on llm_call spans — this request's own usage, not cumulative. */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
}

export interface CitationEvent extends TraceMeta {
  type: "citation";
  rowId: string;
  source: string;
}

export interface TextCorrectionEvent extends TraceMeta {
  type: "text_correction";
  /** Replaces the text streamed so far — issued when citation repair rewrites the answer. */
  text: string;
  reason: string;
}

export interface ErrorEvent extends TraceMeta {
  type: "error";
  message: string;
  /** Set when the loop can't continue (vs. a tool-level error it can recover from). */
  fatal: boolean;
}

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  estimatedCostUsd: number;
}

export interface DoneEvent extends TraceMeta {
  type: "done";
  stopReason: string;
  usage: UsageSummary;
  totalDurationMs: number;
  /** Number of LLM-call iterations in the tool-use loop (bounded by MAX_TOOL_ITERATIONS). */
  iterations: number;
  /** Whether the citation repair pass fired and changed the answer. */
  repaired: boolean;
}

export type AgentStreamEvent =
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | SpanStartEvent
  | SpanEndEvent
  | ToolCallEvent
  | ToolResultEvent
  | CitationEvent
  | TextCorrectionEvent
  | ErrorEvent
  | DoneEvent;

/** Formats one event as an SSE wire frame (`data: {...}\n\n`). */
export function toSseFrame(event: AgentStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
