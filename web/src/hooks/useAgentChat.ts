import { useCallback, useRef, useState } from "react";
import type { AgentStreamEvent, UsageSummary } from "financial-context-agent/streaming-types";
import { streamAgentEvents } from "../lib/sse.js";

export interface ToolTimelineItem {
  toolCallId: string;
  name: string;
  input: unknown;
  status: "running" | "done" | "error";
  summary?: string;
  durationMs?: number;
}

export interface SpanItem {
  spanId: string;
  spanType: "llm_call" | "tool_exec" | "citation_validation";
  label?: string;
  status: "running" | "done" | "error";
  durationMs?: number;
  usage?: NonNullable<Extract<AgentStreamEvent, { type: "span_end" }>["usage"]>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolTimeline: ToolTimelineItem[];
  spans: SpanItem[];
  citedRowIds: string[];
  status: "streaming" | "done" | "error";
  errorMessage?: string;
  usage?: UsageSummary;
  traceId?: string;
}

export type StreamFn = (
  message: string,
  history: { role: "user" | "assistant"; content: string }[]
) => AsyncGenerator<AgentStreamEvent>;

const defaultStreamFn: StreamFn = async function* (message, history) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status}`);
  }
  yield* streamAgentEvents(response);
};

function applyEvent(message: ChatMessage, event: AgentStreamEvent): ChatMessage {
  switch (event.type) {
    case "text_delta":
      return { ...message, content: message.content + event.text, traceId: event.traceId };
    case "text_correction":
      return { ...message, content: event.text };
    case "tool_call":
      return {
        ...message,
        toolTimeline: [
          ...message.toolTimeline,
          { toolCallId: event.toolCallId, name: event.name, input: event.input, status: "running" },
        ],
      };
    case "tool_result":
      return {
        ...message,
        toolTimeline: message.toolTimeline.map((item) =>
          item.toolCallId === event.toolCallId
            ? { ...item, status: event.isError ? "error" : "done", summary: event.summary, durationMs: event.durationMs }
            : item
        ),
      };
    case "span_start":
      return {
        ...message,
        spans: [
          ...message.spans,
          { spanId: event.spanId, spanType: event.spanType, label: event.label, status: "running" },
        ],
      };
    case "span_end":
      return {
        ...message,
        spans: message.spans.map((s) =>
          s.spanId === event.spanId
            ? { ...s, status: event.isError ? "error" : "done", durationMs: event.durationMs, usage: event.usage }
            : s
        ),
      };
    case "citation":
      return message.citedRowIds.includes(event.rowId)
        ? message
        : { ...message, citedRowIds: [...message.citedRowIds, event.rowId] };
    case "error":
      return { ...message, status: "error", errorMessage: event.message };
    case "done":
      return { ...message, status: "done", usage: event.usage, traceId: event.traceId };
    case "thinking_delta":
      return message; // not rendered yet — reserved for a future "show thinking" toggle
    default:
      return message;
  }
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `msg-${idCounter}`;
}

export function useAgentChat(streamFn: StreamFn = defaultStreamFn) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef(false);

  const send = useCallback(
    async (userText: string) => {
      const history = messages
        .filter((m) => m.status !== "streaming")
        .map((m) => ({ role: m.role, content: m.content }));

      const userMessage: ChatMessage = {
        id: nextId(),
        role: "user",
        content: userText,
        toolTimeline: [],
        spans: [],
        citedRowIds: [],
        status: "done",
      };
      const assistantId = nextId();
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        toolTimeline: [],
        spans: [],
        citedRowIds: [],
        status: "streaming",
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsStreaming(true);
      abortRef.current = false;

      const updateAssistant = (updater: (m: ChatMessage) => ChatMessage) => {
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? updater(m) : m)));
      };

      try {
        for await (const event of streamFn(userText, history)) {
          if (abortRef.current) break;
          updateAssistant((m) => applyEvent(m, event));
        }
      } catch (e) {
        updateAssistant((m) => ({
          ...m,
          status: "error",
          errorMessage: e instanceof Error ? e.message : String(e),
        }));
      } finally {
        setIsStreaming(false);
      }
    },
    [messages, streamFn]
  );

  return { messages, isStreaming, send };
}
