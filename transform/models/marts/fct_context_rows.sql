{{
  config(
    materialized='incremental',
    unique_key='row_id'
  )
}}

WITH calendar_events AS (
    SELECT
        'calendar_' || event_id AS row_id,
        'calendar' AS source,
        start_time AS event_timestamp,
        -- Generate narrative text summary for context
        'Calendar Event: ' || COALESCE(summary, '(No Title)') || 
        ' at ' || COALESCE(location, 'No Location') || 
        ' from ' || COALESCE(strftime(start_time, '%Y-%m-%d %H:%M'), 'N/A') || 
        ' to ' || COALESCE(strftime(end_time, '%Y-%m-%d %H:%M'), 'N/A') || 
        '. Description: ' || COALESCE(description, '(None)') AS summary_text,
        -- Construct JSON string for structured fallback
        to_json({
            'event_id': event_id,
            'summary': summary,
            'description': description,
            'start_time': start_time,
            'end_time': end_time,
            'location': location,
            'organizer_email': organizer_email
        }) AS raw_payload
    FROM {{ ref('int_calendar_events') }}
),

plaid_transactions AS (
    SELECT
        'plaid_' || transaction_id AS row_id,
        'plaid' AS source,
        CAST(transaction_date AS TIMESTAMP) AS event_timestamp,
        -- Generate narrative text summary depending on transaction type
        CASE
            WHEN amount > 0 THEN 'Financial Transaction: Spent $' || CAST(amount AS VARCHAR) || ' at ' || COALESCE(name, 'unknown vendor')
            ELSE 'Financial Transaction: Received $' || CAST(ABS(amount) AS VARCHAR) || ' at ' || COALESCE(name, 'unknown vendor')
        END || ' under category ' || COALESCE(primary_category, 'General') || 
        ' on ' || strftime(transaction_date, '%Y-%m-%d') || '.' AS summary_text,
        to_json({
            'transaction_id': transaction_id,
            'account_id': account_id,
            'amount': amount,
            'name': name,
            'category': primary_category,
            'date': transaction_date,
            'pending': is_pending
        }) AS raw_payload
    FROM {{ ref('int_plaid_transactions') }}
),

deduplicated_alpaca_orders AS (
    SELECT *
    FROM {{ ref('stg_alpaca_orders') }}
    QUALIFY ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY extracted_at DESC) = 1
),

alpaca_orders AS (
    SELECT
        'alpaca_' || order_id AS row_id,
        'alpaca' AS source,
        created_at AS event_timestamp,
        -- Generate narrative text summary for Alpaca transactions
        'Financial Trade: ' || COALESCE(UPPER(side), 'UNKNOWN SIDE') || 
        ' order of ' || CAST(quantity AS VARCHAR) || ' shares of ' || symbol || 
        ' (' || order_type || ') was ' || status || 
        ' at average price $' || COALESCE(CAST(filled_avg_price AS VARCHAR), 'N/A') || 
        ' on ' || strftime(created_at, '%Y-%m-%d %H:%M') || '.' AS summary_text,
        to_json({
            'order_id': order_id,
            'client_order_id': client_order_id,
            'symbol': symbol,
            'quantity': quantity,
            'side': side,
            'status': status,
            'filled_price': filled_avg_price,
            'created_at': created_at,
            'filled_at': filled_at
        }) AS raw_payload
    FROM deduplicated_alpaca_orders
),

unioned AS (
    SELECT * FROM calendar_events
    UNION ALL
    SELECT * FROM plaid_transactions
    UNION ALL
    SELECT * FROM alpaca_orders
)

SELECT
    row_id,
    source,
    event_timestamp,
    summary_text,
    raw_payload
FROM unioned

{% if is_incremental() %}
  -- On incremental runs, only process rows newer than the current maximum timestamp
  WHERE event_timestamp > (SELECT MAX(event_timestamp) FROM {{ this }})
{% endif %}
