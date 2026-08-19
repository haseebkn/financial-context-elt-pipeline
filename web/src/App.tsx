import { useState } from "react";
import { ChatView } from "./components/ChatView.js";
import { MetricsView } from "./components/MetricsView.js";
import { EvalsView } from "./components/EvalsView.js";
import "./App.css";

type Tab = "chat" | "metrics" | "evals";

const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "metrics", label: "Metrics" },
  { id: "evals", label: "Evals" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("chat");

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">
          <span className="app-title-accent">Financial</span> Context Agent
        </div>
        <nav className="app-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`app-tab ${tab === t.id ? "app-tab--active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        {tab === "chat" && <ChatView />}
        {tab === "metrics" && <MetricsView />}
        {tab === "evals" && <EvalsView />}
      </main>
    </div>
  );
}
