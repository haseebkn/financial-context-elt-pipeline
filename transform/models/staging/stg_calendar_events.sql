WITH raw_data AS (
    SELECT
        -- Parse extraction timestamp from metadata envelope
        CAST(metadata.extracted_at AS TIMESTAMP) AS extracted_at,
        metadata.run_id AS run_id,
        -- Unnest the events array from raw_payload using json_transform
        unnest(json_transform(CAST(raw_payload AS JSON)->'$.items', '["JSON"]')) AS event_data
    FROM read_json_auto('{{ var("google_calendar_events_path") }}')
)

SELECT
    -- Safely extract event parameters using JSON dot notation
    (event_data->>'$.id') AS event_id,
    (event_data->>'$.status') AS status,
    (event_data->>'$.summary') AS summary,
    (event_data->>'$.description') AS description,
    -- Cast start and end datetime fields, supporting both dateTime and date (all-day events)
    CAST(COALESCE(event_data->>'$.start.dateTime', event_data->>'$.start.date') AS TIMESTAMP) AS start_time,
    CAST(COALESCE(event_data->>'$.end.dateTime', event_data->>'$.end.date') AS TIMESTAMP) AS end_time,
    (event_data->>'$.organizer.email') AS organizer_email,
    (event_data->>'$.location') AS location,
    extracted_at,
    run_id
FROM raw_data
