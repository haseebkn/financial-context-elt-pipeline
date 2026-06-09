SELECT
    event_id,
    status,
    summary,
    description,
    start_time,
    end_time,
    organizer_email,
    location,
    extracted_at,
    run_id
FROM {{ ref('stg_calendar_events') }}
-- Keep only the freshest version of each event to guarantee idempotency
QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY extracted_at DESC) = 1
