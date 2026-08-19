# Eval Harness

30 golden cases across 5 categories (retrieval, aggregation, multihop, refusal, nodata), scored on three independent axes so a failure attributes to a specific layer instead of one opaque number:

| Scorer | Isolates | File |
|---|---|---|
| Tool-choice accuracy | Did the agent reach for the right tool (or, for refusal cases, no tool at all)? | `scorers/tool-choice.ts` |
| Retrieval recall@k | Of the row_ids the answer needed, how many actually showed up in a tool result? | `scorers/retrieval-recall.ts` |
| LLM judge (n=3, mean + spread) | Did the final answer actually satisfy the rubric? | `scorers/judge.ts` |

## Running

```bash
npm run eval          # full 30-case suite, judge n=3
npm run eval:pr        # first 12 cases, judge n=1, exits 1 if thresholds aren't met
npx tsx evals/run.ts --subset 5 --gate   # ad hoc
```

Requires `ANTHROPIC_API_KEY` and a **populated local warehouse** — `financial_engine.db` built from your own `raw_data/` (see the repo root README's ingestion steps), plus the retrieval service running (`uvicorn vector_prep.retrieval_service:app ...`) for `search_context`-using cases.

## Why this isn't wired into CI

The golden set's `expected_row_ids` (e.g. `plaid_3mgg9NDqg9HxLLg1xQ3BIkXEzVPPPdSZ7J459`) reference specific transactions in **real** production data pulled from `raw_data/` — which is correctly gitignored and never present in CI. CI's `dbt build` runs against a tiny, unrelated scrubbed fixture set (`tests/fixtures/raw/`, used to prove the pipeline compiles — see `.github/workflows/ci.yml`).

Running the eval suite against that fixture warehouse wouldn't test anything real: every recall-dependent case would fail not because the agent regressed, but because the specific rows the golden set expects simply don't exist there. A "passing" or "failing" CI gate built on that mismatch would be actively misleading — worse than no gate at all, since a red X would look like a regression when it's actually a data-availability artifact.

This is a data problem inherent to evaluating a personalized agent over one person's actual financial history, not something CI infrastructure can paper over. The honest options were: fabricate a golden set against fixture data (loses all real signal, since the fixture set is 3 files), commit real financial data to a public-facing CI fixture (privacy problem, defeats the point of gitignoring `raw_data/`), or run evals locally against your own real warehouse and treat that as the source of truth. This project takes the third option.

**What CI does check instead** (`.github/workflows/ci.yml`, `agent` steps): `npm run typecheck` and `npm test` — every scorer, the report builder, the gate-threshold logic, and the full orchestration pipeline (`runner.test.ts`) run with scripted fake agent turns and a fake judge, so the harness's own correctness has full, real CI coverage. Only the *data-dependent* live run is a local-only step.

## Report format

Each run writes `evals/reports/<timestamp>.json` (full structured data) and `.md` (human-readable, with a diff against `evals/baseline.json` if one exists). To lock in a new baseline after a deliberate improvement: `cp evals/reports/<latest>.json evals/baseline.json`.

## Gate thresholds (`report.ts`)

- Tool-choice accuracy ≥ 90%
- Mean recall ≥ 80%
- Mean judge score ≥ 4.0/5
- **Zero tolerance on refusal-category misses** — any single missed refusal fails the gate regardless of the aggregate numbers.
