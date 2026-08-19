-- Agent turn traces, written by the Node agent service (src/lib/trace-writer.ts)
-- following the same landing-zone envelope pattern as every extractor.
--
-- Unlike the other sources, this one may legitimately not exist yet on a
-- fresh clone or before the agent service has ever handled a request —
-- read_json_auto() errors outright on a glob that matches zero files, so
-- this model checks first via glob() (which returns zero rows rather than
-- erroring) and falls back to an empty, correctly-typed result instead of
-- breaking `dbt build` for anyone who hasn't used the agent chat feature yet.
{% set file_count_query %}
    SELECT COUNT(*) AS n FROM glob('{{ var("agent_traces_path") }}')
{% endset %}
{% set file_count = run_query(file_count_query).columns[0].values()[0] if execute else 0 %}

{% if file_count > 0 %}

WITH raw_data AS (
    SELECT
        CAST(metadata.extracted_at AS TIMESTAMP) AS extracted_at,
        metadata.run_id AS run_id,
        CAST(raw_payload AS JSON) AS raw_payload
    FROM read_json_auto('{{ var("agent_traces_path") }}')
)

SELECT
    (raw_payload->>'$.trace_id') AS trace_id,
    (raw_payload->>'$.question') AS question,
    (raw_payload->>'$.stop_reason') AS stop_reason,
    CAST(raw_payload->>'$.iterations' AS INTEGER) AS iterations,
    CAST(raw_payload->>'$.repaired' AS BOOLEAN) AS repaired,
    CAST(raw_payload->>'$.errored' AS BOOLEAN) AS errored,
    (raw_payload->>'$.error_message') AS error_message,
    CAST(raw_payload->>'$.citations_valid' AS BOOLEAN) AS citations_valid,
    CAST(raw_payload->>'$.input_tokens' AS INTEGER) AS input_tokens,
    CAST(raw_payload->>'$.output_tokens' AS INTEGER) AS output_tokens,
    CAST(raw_payload->>'$.cache_creation_input_tokens' AS INTEGER) AS cache_creation_input_tokens,
    CAST(raw_payload->>'$.cache_read_input_tokens' AS INTEGER) AS cache_read_input_tokens,
    CAST(raw_payload->>'$.cost_usd' AS DOUBLE) AS cost_usd,
    CAST(raw_payload->>'$.total_duration_ms' AS INTEGER) AS total_duration_ms,
    json_extract(raw_payload, '$.tool_calls') AS tool_calls_json,
    extracted_at,
    run_id
FROM raw_data

{% else %}

SELECT
    CAST(NULL AS VARCHAR) AS trace_id,
    CAST(NULL AS VARCHAR) AS question,
    CAST(NULL AS VARCHAR) AS stop_reason,
    CAST(NULL AS INTEGER) AS iterations,
    CAST(NULL AS BOOLEAN) AS repaired,
    CAST(NULL AS BOOLEAN) AS errored,
    CAST(NULL AS VARCHAR) AS error_message,
    CAST(NULL AS BOOLEAN) AS citations_valid,
    CAST(NULL AS INTEGER) AS input_tokens,
    CAST(NULL AS INTEGER) AS output_tokens,
    CAST(NULL AS INTEGER) AS cache_creation_input_tokens,
    CAST(NULL AS INTEGER) AS cache_read_input_tokens,
    CAST(NULL AS DOUBLE) AS cost_usd,
    CAST(NULL AS INTEGER) AS total_duration_ms,
    CAST(NULL AS JSON) AS tool_calls_json,
    CAST(NULL AS TIMESTAMP) AS extracted_at,
    CAST(NULL AS VARCHAR) AS run_id
WHERE FALSE

{% endif %}
