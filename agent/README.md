# Agent Service

A Node/TypeScript service that puts an LLM agent in front of the financial context warehouse: it answers questions by calling tools that search, query, and aggregate real data — never from prior knowledge.

## Architecture

```
Browser / client
      │  POST /api/chat (SSE)
      ▼
agent/ (Node, Hono)  ──HTTP──▶  vector_prep/retrieval_service.py (Python, FastAPI)
      │                              │
      │  DuckDB (read-only)          │  ChromaDB + sentence-transformers
      ▼                              ▼
financial_engine.db            vector_store/
```

The Python side stays Python (ChromaDB and sentence-transformers have no reason to move); the Node side owns the LLM loop, the SQL-generation tool, and the HTTP API. See `sql-guard.ts`'s header comment for why `query_warehouse` needs its own validation layer even though the DuckDB connection is opened read-only.

## Tools

| Tool | Purpose |
|---|---|
| `search_context` | Semantic search over calendar/Plaid/Alpaca narrative rows, via the retrieval service |
| `query_warehouse` | Freeform read-only SQL, validated by `lib/sql-guard.ts` (single-statement SELECT, table allowlist, banned-function blocklist, LIMIT enforcement) |
| `get_portfolio_snapshot` | Fixed query: latest account balance + 5 most recent trades |
| `summarize_spend` | Fixed aggregation: spend/income totals by category or time bucket |

`get_portfolio_snapshot` and `summarize_spend` are deliberately not left to freeform SQL — the arithmetic that matters most for a financial answer should be tested code with a documented sign convention, not regenerated per call.

## Setup

```bash
cd agent
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY and RETRIEVAL_SERVICE_TOKEN
```

`RETRIEVAL_SERVICE_TOKEN` must match the same value set in the repo root `.env` (read by `config/settings.py`).

## Running

Requires the retrieval service running first (from the repo root):

```bash
# Terminal 1 — retrieval service
uvicorn vector_prep.retrieval_service:app --host 127.0.0.1 --port 8100

# Terminal 2 — agent service
cd agent
npm run dev
```

Then:

```bash
curl -N -X POST http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "How much did I spend on coffee last month?"}'
```

Streams Server-Sent Events per `src/streaming-types.ts` — `text_delta`, `thinking_delta`, `span_start`/`span_end` (llm_call / tool_exec / citation_validation, with per-call token usage on llm_call spans — this is the waterfall data), `tool_call`, `tool_result`, `citation`, `text_correction` (issued if citation repair rewrites the answer after it already streamed), `error`, `done`.

## Observability

Every completed turn writes a trace record to `raw_data/agent_traces/<date>/*.json`, following the same landing-zone envelope pattern as the extractors (`src/lib/trace-writer.ts`). A dbt staging + mart model (`stg_agent_traces` → `fct_agent_traces`, materialized as a table) reads them into the warehouse — it degrades gracefully to an empty, correctly-typed table if no traces exist yet (a fresh clone, or before the agent has ever handled a request), rather than breaking `dbt build`.

```bash
curl http://localhost:8787/api/metrics
curl http://localhost:8787/api/traces/<trace_id>
```

`/api/metrics` returns turns/day, mean iterations, repair rate, error rate, total cost, p50/p95 latency, cache-hit rate, and the tool-call distribution — all computed by real SQL against `fct_agent_traces`, not pre-aggregated at write time. Run `dbt build` after generating some traffic to pick up new trace files.

## Testing

```bash
npm run typecheck
npm test
```

The DuckDB-backed tool tests (`query-warehouse.test.ts`, `get-portfolio-snapshot.test.ts`, `summarize-spend.test.ts`) run against the real `financial_engine.db` over a read-only connection — no mocking, genuine coverage of the guard + DuckDB composition. `search-context.test.ts` mocks `fetch`. `agent-loop.smoke.test.ts` makes a real network call to `api.anthropic.com` to confirm the request this code constructs is well-formed enough to reach the API (it expects and asserts on a structured *authentication* error, since no real key is required to run it) — skipped automatically under `CI=true`.

**Known limitation:** no `ANTHROPIC_API_KEY` was available while building this, so the live agentic loop (actual tool-calling turns, streaming behavior, citation repair against real model output) has not been exercised end-to-end against the real API — only its request construction (via the smoke test above) and every piece of orchestration logic *around* the model call (citation validation, usage accounting, stop-reason handling, SSE framing, the SQL guard, all four tools against the real warehouse) have real test coverage. Run the smoke test yourself with a real key to close that last gap.
