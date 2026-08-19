import { useState } from "react";
import type { ChatMessage } from "../hooks/useAgentChat.js";
import { MessageText } from "./MessageText.js";
import { ToolTimeline } from "./ToolTimeline.js";
import { SpanWaterfall } from "./SpanWaterfall.js";
import { formatUsd } from "../lib/format.js";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const [showTrace, setShowTrace] = useState(false);
  const isUser = message.role === "user";

  return (
    <div className={`message ${isUser ? "message--user" : "message--assistant"}`}>
      <div className="message-role">{isUser ? "You" : "Agent"}</div>

      <div className="message-bubble">
        {!isUser && <ToolTimeline items={message.toolTimeline} />}

        {message.status === "streaming" && !message.content && message.toolTimeline.length === 0 && (
          <p className="message-text message-text--pending">
            <span className="pulse-dot" /> thinking…
          </p>
        )}

        {message.content && <MessageText text={message.content} />}

        {message.status === "streaming" && (message.content || message.toolTimeline.length > 0) && (
          <span className="stream-cursor" aria-hidden />
        )}

        {message.status === "error" && (
          <p className="message-text message-text--error">
            {message.errorMessage ?? "Something went wrong."}
          </p>
        )}

        {!isUser && message.status === "done" && (
          <div className="message-footer">
            <button className="link-button" onClick={() => setShowTrace((v) => !v)}>
              {showTrace ? "Hide trace" : "Show trace"}
            </button>
            {message.usage && (
              <span className="message-meta">
                {formatUsd(message.usage.estimatedCostUsd)} · {message.usage.inputTokens + message.usage.outputTokens} tokens
              </span>
            )}
          </div>
        )}

        {showTrace && (
          <div className="trace-panel">
            <SpanWaterfall spans={message.spans} />
            {message.usage && (
              <dl className="trace-usage-grid">
                <dt>Input</dt>
                <dd>{message.usage.inputTokens}</dd>
                <dt>Output</dt>
                <dd>{message.usage.outputTokens}</dd>
                <dt>Cache write</dt>
                <dd>{message.usage.cacheCreationInputTokens}</dd>
                <dt>Cache read</dt>
                <dd>{message.usage.cacheReadInputTokens}</dd>
                <dt>Cost</dt>
                <dd>{formatUsd(message.usage.estimatedCostUsd)}</dd>
              </dl>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
