import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAgentChat, type StreamFn } from "./useAgentChat.js";
import type { AgentStreamEvent } from "financial-context-agent/streaming-types";

async function* fakeStream(events: AgentStreamEvent[]): AsyncGenerator<AgentStreamEvent> {
  for (const e of events) yield e;
}

// A real stream always ends with a `done` or `error` event — an empty
// stream is not a realistic fixture (the hook correctly leaves a message
// with no terminal event stuck in "streaming", which is the right
// behavior, not a bug). Fixtures that don't care about the terminal event
// use this to reach a normal "done" end state.
const DONE_EVENT: AgentStreamEvent = {
  type: "done",
  traceId: "t1",
  stopReason: "end_turn",
  usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, estimatedCostUsd: 0 },
  totalDurationMs: 0,
  iterations: 1,
  repaired: false,
};

describe("useAgentChat", () => {
  it("appends a user message and a streaming assistant message on send", async () => {
    const streamFn: StreamFn = () => fakeStream([DONE_EVENT]);
    const { result } = renderHook(() => useAgentChat(streamFn));

    await act(async () => {
      await result.current.send("Hello");
    });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ role: "user", content: "Hello" });
    expect(result.current.messages[1]).toMatchObject({ role: "assistant", status: "done" });
  });

  it("leaves the assistant message in 'streaming' state if the stream ends with no terminal event", async () => {
    const streamFn: StreamFn = () => fakeStream([{ type: "text_delta", traceId: "t1", text: "partial" }]);
    const { result } = renderHook(() => useAgentChat(streamFn));

    await act(async () => {
      await result.current.send("q");
    });

    expect(result.current.messages[1]).toMatchObject({ status: "streaming", content: "partial" });
  });

  it("accumulates text_delta events into the assistant message content", async () => {
    const streamFn: StreamFn = () =>
      fakeStream([
        { type: "text_delta", traceId: "t1", text: "You spent " },
        { type: "text_delta", traceId: "t1", text: "$4.33." },
      ]);
    const { result } = renderHook(() => useAgentChat(streamFn));

    await act(async () => {
      await result.current.send("q");
    });

    expect(result.current.messages[1]?.content).toBe("You spent $4.33.");
  });

  it("replaces content entirely on text_correction", async () => {
    const streamFn: StreamFn = () =>
      fakeStream([
        { type: "text_delta", traceId: "t1", text: "Bad citation [fake]." },
        { type: "text_correction", traceId: "t1", text: "Fixed answer.", reason: "removed fake" },
      ]);
    const { result } = renderHook(() => useAgentChat(streamFn));

    await act(async () => {
      await result.current.send("q");
    });

    expect(result.current.messages[1]?.content).toBe("Fixed answer.");
  });

  it("tracks a tool call through running -> done via tool_call/tool_result", async () => {
    const streamFn: StreamFn = () =>
      fakeStream([
        { type: "tool_call", traceId: "t1", toolCallId: "tc1", name: "search_context", input: { query: "coffee" } },
        { type: "tool_result", traceId: "t1", toolCallId: "tc1", name: "search_context", isError: false, summary: "found 2", durationMs: 120 },
      ]);
    const { result } = renderHook(() => useAgentChat(streamFn));

    await act(async () => {
      await result.current.send("q");
    });

    const timeline = result.current.messages[1]?.toolTimeline;
    expect(timeline).toHaveLength(1);
    expect(timeline?.[0]).toMatchObject({ name: "search_context", status: "done", summary: "found 2" });
  });

  it("tracks spans through running -> done with per-call usage on llm_call", async () => {
    const streamFn: StreamFn = () =>
      fakeStream([
        { type: "span_start", traceId: "t1", spanId: "s1", spanType: "llm_call" },
        {
          type: "span_end",
          traceId: "t1",
          spanId: "s1",
          spanType: "llm_call",
          durationMs: 400,
          isError: false,
          usage: { inputTokens: 100, outputTokens: 20, cacheCreationInputTokens: 0, cacheReadInputTokens: 80 },
        },
      ]);
    const { result } = renderHook(() => useAgentChat(streamFn));

    await act(async () => {
      await result.current.send("q");
    });

    const spans = result.current.messages[1]?.spans;
    expect(spans).toHaveLength(1);
    expect(spans?.[0]).toMatchObject({ status: "done", durationMs: 400 });
    expect(spans?.[0]?.usage?.cacheReadInputTokens).toBe(80);
  });

  it("dedupes repeated citation events for the same row_id", async () => {
    const streamFn: StreamFn = () =>
      fakeStream([
        { type: "citation", traceId: "t1", rowId: "plaid_a", source: "plaid" },
        { type: "citation", traceId: "t1", rowId: "plaid_a", source: "plaid" },
      ]);
    const { result } = renderHook(() => useAgentChat(streamFn));

    await act(async () => {
      await result.current.send("q");
    });

    expect(result.current.messages[1]?.citedRowIds).toEqual(["plaid_a"]);
  });

  it("marks the assistant message errored on a fatal error event", async () => {
    const streamFn: StreamFn = () =>
      fakeStream([{ type: "error", traceId: "t1", message: "401 authentication_error", fatal: true }]);
    const { result } = renderHook(() => useAgentChat(streamFn));

    await act(async () => {
      await result.current.send("q");
    });

    expect(result.current.messages[1]).toMatchObject({ status: "error", errorMessage: "401 authentication_error" });
  });

  it("marks the assistant message errored when the stream generator throws", async () => {
    const streamFn: StreamFn = async function* () {
      throw new Error("network exploded");
    };
    const { result } = renderHook(() => useAgentChat(streamFn));

    await act(async () => {
      await result.current.send("q");
    });

    expect(result.current.messages[1]).toMatchObject({ status: "error", errorMessage: "network exploded" });
  });

  it("stores usage and marks done on the done event", async () => {
    const streamFn: StreamFn = () =>
      fakeStream([
        {
          type: "done",
          traceId: "t1",
          stopReason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, estimatedCostUsd: 0.001 },
          totalDurationMs: 500,
          iterations: 1,
          repaired: false,
        },
      ]);
    const { result } = renderHook(() => useAgentChat(streamFn));

    await act(async () => {
      await result.current.send("q");
    });

    expect(result.current.messages[1]).toMatchObject({ status: "done" });
    expect(result.current.messages[1]?.usage?.estimatedCostUsd).toBe(0.001);
  });

  it("sets isStreaming true while sending and false once complete", async () => {
    const { result } = renderHook(() => useAgentChat(() => fakeStream([])));
    expect(result.current.isStreaming).toBe(false);

    const sendPromise = act(async () => {
      await result.current.send("q");
    });
    await sendPromise;

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
  });

  it("passes prior completed messages as history on the next send", async () => {
    const receivedHistories: unknown[] = [];
    const streamFn: StreamFn = (_msg, history) => {
      receivedHistories.push(history);
      return fakeStream([DONE_EVENT]);
    };
    const { result } = renderHook(() => useAgentChat(streamFn));

    await act(async () => {
      await result.current.send("first");
    });
    await act(async () => {
      await result.current.send("second");
    });

    expect(receivedHistories[0]).toEqual([]);
    expect(receivedHistories[1]).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "" },
    ]);
  });
});
