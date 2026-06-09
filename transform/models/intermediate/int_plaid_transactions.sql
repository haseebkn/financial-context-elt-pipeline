WITH deduplicated AS (
    SELECT
        transaction_id,
        account_id,
        amount,
        transaction_date,
        name,
        primary_category,
        is_pending,
        sync_action,
        extracted_at,
        run_id
    FROM {{ ref('stg_plaid_transactions') }}
    -- Enforce idempotency: select the most recently updated state for each transaction
    QUALIFY ROW_NUMBER() OVER (PARTITION BY transaction_id ORDER BY extracted_at DESC) = 1
)

SELECT
    transaction_id,
    account_id,
    amount,
    transaction_date,
    name,
    primary_category,
    is_pending,
    extracted_at,
    run_id
FROM deduplicated
-- Filter out any transaction that has been deleted in Plaid (marked as removed)
WHERE sync_action != 'removed'
