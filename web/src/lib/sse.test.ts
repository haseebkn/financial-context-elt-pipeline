import { describe, expect, it } from "vitest";
import { SseFrameParser } from "./sse.js";

function frame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

describe("SseFrameParser", () => {
  it("parses a single complete frame delivered in one chunk", () => {
    const parser = new SseFrameParser();
    const events = parser.push(frame({ type: "text_delta", traceId: "t1", text: "hi" }));
    expect(events).toEqual([{ type: "text_delta", traceId: "t1", text: "hi" }]);
  });

  it("parses multiple frames delivered in one chunk", () => {
    const parser = new SseFrameParser();
    const events = parser.push(
      frame({ type: "text_delta", traceId: "t1", text: "a" }) +
        frame({ type: "text_delta", traceId: "t1", text: "b" })
    );
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ text: "b" });
  });

  it("buffers a frame split across multiple chunks — mid-JSON", () => {
    const parser = new SseFrameParser();
    const whole = frame({ type: "text_delta", traceId: "t1", text: "hello world" });
    const splitPoint = Math.floor(whole.length / 2);

    const first = parser.push(whole.slice(0, splitPoint));
    expect(first).toEqual([]); // nothing complete yet

    const second = parser.push(whole.slice(splitPoint));
    expect(second).toEqual([{ type: "text_delta", traceId: "t1", text: "hello world" }]);
  });

  it("buffers a frame split exactly at the \\n\\n delimiter", () => {
    const parser = new SseFrameParser();
    const whole = frame({ type: "text_delta", traceId: "t1", text: "x" });
    const delimiterIndex = whole.indexOf("\n\n");

    const first = parser.push(whole.slice(0, delimiterIndex + 1)); // splits the \n\n itself
    expect(first).toEqual([]);
    const second = parser.push(whole.slice(delimiterIndex + 1));
    expect(second).toHaveLength(1);
  });

  it("handles many frames trickling in one character at a time", () => {
    const parser = new SseFrameParser();
    const whole = frame({ type: "text_delta", traceId: "t1", text: "a" }) + frame({ type: "citation", traceId: "t1", rowId: "plaid_x", source: "plaid" });

    const collected: unknown[] = [];
    for (const ch of whole) {
      collected.push(...parser.push(ch));
    }
    expect(collected).toHaveLength(2);
  });

  it("skips a malformed frame without crashing and keeps parsing subsequent ones", () => {
    const parser = new SseFrameParser();
    const events = parser.push("data: {not valid json\n\n" + frame({ type: "text_delta", traceId: "t1", text: "ok" }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ text: "ok" });
  });

  it("ignores non-data lines within a frame", () => {
    const parser = new SseFrameParser();
    const events = parser.push(`: heartbeat comment\ndata: ${JSON.stringify({ type: "done", traceId: "t1", stopReason: "end_turn", usage: {}, totalDurationMs: 1, iterations: 1, repaired: false })}\n\n`);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("done");
  });

  it("retains partial data across a push with no complete frame at all", () => {
    const parser = new SseFrameParser();
    expect(parser.push("data: {\"type\":")).toEqual([]);
    expect(parser.push('"text_delta","traceId":"t1","text":"z"}\n\n')).toHaveLength(1);
  });
});
