import { describe, expect, it } from "vitest";
import { buildTraceRecord } from "./trace-accumulator.js";
import type { AgentStreamEvent } from "../streaming-types.js";

const DONE = (overrides: Partial<Extract<AgentStreamEvent, { type: "done" }>> = {}): AgentStreamEvent => ({
  type: "done",
  traceId: "t1",
  stopReason: "end_turn",
  usage: { inputTokens: 500, outputTokens: 100, cacheCreationInputTokens: 0, cacheReadInputTokens: 400, estimatedCostUsd: 0.005 },
  totalDurationMs: 1200,
  iterations: 2,
  repaired: false,
  ...overrides,
});

describe("buildTraceRecord", () => {
  it("builds a clean record from a well-behaved turn", () => {
    const events: AgentStreamEvent[] = [
      { type: "tool_call", traceId: "t1", toolCallId: "tc1", name: "search_context", input: {} },
      { type: "tool_result", traceId: "t1", toolCallId: "tc1", name: "search_context", isError: false, summary: "ok", durationMs: 200 },
      { type: "text_delta", traceId: "t1", text: "Answer." },
      DONE(),
    ];

    const record = buildTraceRecord(events, "What did I spend?");

    expect(record.trace_id).toBe("t1");
    expect(record.question).toBe("What did I spend?");
    expect(record.stop_reason).toBe("end_turn");
    expect(record.iterations).toBe(2);
    expect(record.errored).toBe(false);
    expect(record.citations_valid).toBe(true);
    expect(record.repaired).toBe(false);
    expect(record.tool_calls).toEqual([{ name: "search_context", duration_ms: 200, is_error: false }]);
    expect(record.input_tokens).toBe(500);
    expect(record.cost_usd).toBe(0.005);
    expect(record.total_duration_ms).toBe(1200);
  });

  it("marks citations invalid and repaired=true when a text_correction fired", () => {
    const events: AgentStreamEvent[] = [
      { type: "text_delta", traceId: "t1", text: "Bad citation [fake_id]." },
      { type: "text_correction", traceId: "t1", text: "Fixed answer.", reason: "removed fake_id" },
      DONE({ repaired: true }),
    ];

    const record = buildTraceRecord(events, "q");
    expect(record.repaired).toBe(true);
    expect(record.citations_valid).toBe(false);
  });

  it("records a fatal error and stops without a done event's data", () => {
    const events: AgentStreamEvent[] = [
      { type: "error", traceId: "t1", message: "401 authentication_error", fatal: true },
    ];

    const record = buildTraceRecord(events, "q");
    expect(record.errored).toBe(true);
    expect(record.error_message).toContain("authentication_error");
    expect(record.stop_reason).toBe("unknown"); // no done event arrived
  });

  it("aggregates multiple tool calls across iterations", () => {
    const events: AgentStreamEvent[] = [
      { type: "tool_result", traceId: "t1", toolCallId: "tc1", name: "search_context", isError: false, summary: "ok", durationMs: 100 },
      { type: "tool_result", traceId: "t1", toolCallId: "tc2", name: "query_warehouse", isError: true, summary: "rejected", durationMs: 5 },
      DONE({ iterations: 3 }),
    ];

    const record = buildTraceRecord(events, "q");
    expect(record.tool_calls).toHaveLength(2);
    expect(record.tool_calls[1]!.is_error).toBe(true);
    expect(record.iterations).toBe(3);
  });

  it("falls back to 'unknown' trace_id when no event carries one (defensive, shouldn't happen in practice)", () => {
    const record = buildTraceRecord([], "q");
    expect(record.trace_id).toBe("unknown");
  });
});
