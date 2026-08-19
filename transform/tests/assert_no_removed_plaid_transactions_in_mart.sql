-- A Plaid transaction whose most recent sync state is 'removed' must never
-- reach the mart. int_plaid_transactions already excludes removed
-- transactions (WHERE sync_action != 'removed'), so any Plaid row in the
-- mart that has no corresponding transaction_id there indicates a removed
-- transaction leaked through. This test fails (returns rows) if that happens.

SELECT f.row_id
FROM {{ ref('fct_context_rows') }} f
WHERE f.source = 'plaid'
  AND NOT EXISTS (
      SELECT 1
      FROM {{ ref('int_plaid_transactions') }} p
      WHERE 'plaid_' || p.transaction_id = f.row_id
  )
