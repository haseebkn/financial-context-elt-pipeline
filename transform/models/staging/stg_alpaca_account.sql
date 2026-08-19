-- Alpaca account snapshots (cash, equity, buying power). Unlike orders,
-- raw_payload here is a single object per extraction, not an array.
WITH raw_data AS (
    SELECT
        CAST(metadata.extracted_at AS TIMESTAMP) AS extracted_at,
        metadata.run_id AS run_id,
        CAST(raw_payload AS JSON) AS raw_payload
    FROM read_json_auto('{{ var("alpaca_account_path") }}')
)

SELECT
    (raw_payload->>'$.id') AS account_id,
    (raw_payload->>'$.status') AS status,
    CAST(raw_payload->>'$.cash' AS DECIMAL(18, 4)) AS cash,
    CAST(raw_payload->>'$.equity' AS DECIMAL(18, 4)) AS equity,
    CAST(raw_payload->>'$.portfolio_value' AS DECIMAL(18, 4)) AS portfolio_value,
    CAST(raw_payload->>'$.buying_power' AS DECIMAL(18, 4)) AS buying_power,
    CAST(raw_payload->>'$.long_market_value' AS DECIMAL(18, 4)) AS long_market_value,
    CAST(raw_payload->>'$.short_market_value' AS DECIMAL(18, 4)) AS short_market_value,
    extracted_at,
    run_id
FROM raw_data
