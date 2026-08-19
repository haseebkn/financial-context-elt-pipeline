{{
  config(
    materialized='table'
  )
}}

-- Materialized as a table for the same reason as dim_account_snapshot: it's
-- queried by the agent service's /api/metrics endpoint from a different
-- working directory than dbt build runs from, and a view's read_json_auto()
-- would resolve its relative path against the wrong cwd there.
SELECT
    trace_id,
    question,
    stop_reason,
    iterations,
    repaired,
    errored,
    error_message,
    citations_valid,
    input_tokens,
    output_tokens,
    cache_creation_input_tokens,
    cache_read_input_tokens,
    cost_usd,
    total_duration_ms,
    tool_calls_json,
    extracted_at,
    run_id
FROM {{ ref('stg_agent_traces') }}
-- Idempotency safety net, consistent with the rest of the warehouse — traces
-- are write-once in practice, but dedup by freshest extraction regardless.
QUALIFY ROW_NUMBER() OVER (PARTITION BY trace_id ORDER BY extracted_at DESC) = 1
