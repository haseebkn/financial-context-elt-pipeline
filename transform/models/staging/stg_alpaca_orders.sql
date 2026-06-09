WITH raw_data AS (
    SELECT
        CAST(metadata.extracted_at AS TIMESTAMP) AS extracted_at,
        metadata.run_id AS run_id,
        -- Unnest the JSON list of orders using json_transform
        unnest(json_transform(CAST(raw_payload AS JSON), '["JSON"]')) AS order_data
    FROM read_json_auto('{{ var("alpaca_orders_path") }}')
)

SELECT
    (order_data->>'$.id') AS order_id,
    (order_data->>'$.client_order_id') AS client_order_id,
    (order_data->>'$.symbol') AS symbol,
    CAST(order_data->>'$.qty' AS DECIMAL(18, 4)) AS quantity,
    (order_data->>'$.type') AS order_type,
    (order_data->>'$.side') AS side,
    (order_data->>'$.status') AS status,
    CAST(order_data->>'$.created_at' AS TIMESTAMP) AS created_at,
    CAST(order_data->>'$.filled_at' AS TIMESTAMP) AS filled_at,
    CAST(order_data->>'$.filled_avg_price' AS DECIMAL(18, 4)) AS filled_avg_price,
    extracted_at,
    run_id
FROM raw_data
