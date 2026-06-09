WITH raw_data AS (
    SELECT
        CAST(metadata.extracted_at AS TIMESTAMP) AS extracted_at,
        metadata.run_id AS run_id,
        CAST(raw_payload AS JSON) AS raw_payload
    FROM read_json_auto('{{ var("plaid_transactions_path") }}')
),

flattened_added AS (
    SELECT
        extracted_at,
        run_id,
        'added' AS sync_action,
        unnest(json_transform(json_extract(raw_payload, '$.added'), '["JSON"]')) AS tx_data
    FROM raw_data
    -- Wrap in json_extract to avoid DuckDB operator precedence parsing conflicts in WHERE clauses
    WHERE json_extract(raw_payload, '$.added') IS NOT NULL 
      AND json_array_length(json_extract(raw_payload, '$.added')) > 0
),

flattened_modified AS (
    SELECT
        extracted_at,
        run_id,
        'modified' AS sync_action,
        unnest(json_transform(json_extract(raw_payload, '$.modified'), '["JSON"]')) AS tx_data
    FROM raw_data
    WHERE json_extract(raw_payload, '$.modified') IS NOT NULL 
      AND json_array_length(json_extract(raw_payload, '$.modified')) > 0
),

flattened_removed AS (
    SELECT
        extracted_at,
        run_id,
        'removed' AS sync_action,
        -- Plaid removed array lists objects containing transaction_id
        unnest(json_transform(json_extract(raw_payload, '$.removed'), '["JSON"]')) AS tx_data
    FROM raw_data
    WHERE json_extract(raw_payload, '$.removed') IS NOT NULL 
      AND json_array_length(json_extract(raw_payload, '$.removed')) > 0
),

unioned AS (
    SELECT * FROM flattened_added
    UNION ALL
    SELECT * FROM flattened_modified
    UNION ALL
    SELECT * FROM flattened_removed
)

SELECT
    (tx_data->>'$.transaction_id') AS transaction_id,
    (tx_data->>'$.account_id') AS account_id,
    CAST(tx_data->>'$.amount' AS DECIMAL(18, 4)) AS amount,
    CAST(tx_data->>'$.date' AS DATE) AS transaction_date,
    (tx_data->>'$.name') AS name,
    (tx_data->>'$.category[0]') AS primary_category,
    CAST(tx_data->>'$.pending' AS BOOLEAN) AS is_pending,
    sync_action,
    extracted_at,
    run_id
FROM unioned
