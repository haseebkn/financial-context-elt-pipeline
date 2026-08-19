import type { AgentStreamEvent } from "financial-context-agent/streaming-types";

/**
 * Parses a raw SSE byte stream into AgentStreamEvent objects. Frames are
 * `data: {...}\n\n` (see agent/src/streaming-types.ts's toSseFrame), but a
 * network chunk can split a frame anywhere — mid-JSON, mid-delimiter, or
 * bundle several frames together. This buffers across chunks and only
 * emits once a full `\n\n`-terminated frame has arrived.
 */
export class SseFrameParser {
  private buffer = "";

  /** Feed one chunk of decoded text; returns any complete events it produced. */
  push(chunk: string): AgentStreamEvent[] {
    this.buffer += chunk;
    const events: AgentStreamEvent[] = [];

    let boundary: number;
    while ((boundary = this.buffer.indexOf("\n\n")) !== -1) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);

      const dataLine = frame
        .split("\n")
        .find((line) => line.startsWith("data:"));
      if (!dataLine) continue;

      const json = dataLine.slice(5).trim();
      if (!json) continue;

      try {
        events.push(JSON.parse(json) as AgentStreamEvent);
      } catch {
        // Malformed frame — skip it rather than crash the whole stream.
        // A single bad frame shouldn't take down an otherwise-working turn.
      }
    }

    return events;
  }
}

/** Reads a fetch Response's SSE body, yielding parsed events as they arrive. */
export async function* streamAgentEvents(response: Response): AsyncGenerator<AgentStreamEvent> {
  if (!response.body) throw new Error("Response has no readable body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseFrameParser();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
