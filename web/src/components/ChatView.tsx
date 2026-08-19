import { useEffect, useRef, useState } from "react";
import { useAgentChat } from "../hooks/useAgentChat.js";
import { MessageBubble } from "./MessageBubble.js";

const SUGGESTIONS = [
  "How much did I spend on Food and Drink?",
  "What's my current cash balance?",
  "Did I go rock climbing recently?",
  "Should I buy more AAPL?",
];

export function ChatView() {
  const { messages, isStreaming, send } = useAgentChat();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    void send(trimmed);
  };

  return (
    <div className="chat-view">
      <div className="chat-scroll">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Ask about your transactions, calendar events, or account balance.</p>
            <div className="suggestion-row">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggestion-chip" onClick={() => submit(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      <form
        className="chat-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        <input
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your finances…"
          disabled={isStreaming}
          aria-label="Message"
        />
        <button type="submit" className="chat-send" disabled={isStreaming || !input.trim()}>
          {isStreaming ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}
