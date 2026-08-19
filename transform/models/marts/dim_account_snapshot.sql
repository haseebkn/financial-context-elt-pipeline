{{
  config(
    materialized='table'
  )
}}

-- Materialized as a real table (not a view) deliberately: stg_alpaca_account
-- is a view whose read_json_auto() path is resolved at QUERY time against
-- whatever process's cwd is active then — correct when dbt itself queries it
-- during `dbt build` (cwd=transform/), wrong when a caller in a different
-- working directory (e.g. the agent service under agent/) queries it later.
-- Baking the data into a physical table at build time sidesteps that
-- entirely — the same reason fct_context_rows never hit this problem.
SELECT
    account_id,
    status,
    cash,
    equity,
    portfolio_value,
    buying_power,
    long_market_value,
    short_market_value,
    extracted_at,
    run_id
FROM {{ ref('stg_alpaca_account') }}
