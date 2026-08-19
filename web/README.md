# Financial Context Web

React chat frontend for the [`agent/`](../agent) service. Three tabs:

- **Chat** — streams a conversation with the Claude agent over SSE, rendering tool calls, citations, and (per-message) a trace waterfall of spans and token usage.
- **Metrics** — aggregate stats computed by the agent service from the warehouse's `fct_agent_traces` table (turns, mean iterations, error/repair/cache-hit rates, cost, latency percentiles, tool distribution).
- **Evals** — renders the latest eval report written by `agent/`'s eval harness (`npm run eval` in `agent/`), with per-category breakdowns and failing/low-scoring cases.

## Setup

```bash
npm install --workspace web
npm run dev --workspace web
```

Opens on [http://localhost:5173](http://localhost:5173). The dev server proxies `/api/*` to the agent service at `http://127.0.0.1:8787` (see `vite.config.ts`), so the agent service must be running for the app to do anything beyond render its shell.

## Scripts

```bash
npm run dev --workspace web        # dev server with HMR
npm run build --workspace web      # typecheck + production build (dist/)
npm run test --workspace web       # vitest run
npm run test:watch --workspace web
npm run typecheck --workspace web
```

## Structure

- `src/lib/sse.ts` — chunk-boundary-safe SSE frame parser and `streamAgentEvents` async generator.
- `src/lib/message-parts.ts` — splits assistant text into plain-text and citation parts for rendering.
- `src/hooks/useAgentChat.ts` — the chat state machine: a pure `applyEvent` reducer over the agent's `AgentStreamEvent` union, plus the `send()` action that POSTs to `/api/chat` and drains the SSE stream.
- `src/components/` — `ChatView`, `MessageBubble`, `ToolTimeline`, `SpanWaterfall`, `CitationChip`, `MetricsView`, `EvalsView`.

Streaming event types are shared with `agent/` via an npm workspace — `financial-context-agent/streaming-types` resolves directly to `agent/src/streaming-types.ts`, so no build step or type duplication is needed to keep the two packages in sync.
