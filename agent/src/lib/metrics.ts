import { queryRows, queryRowsParams } from "./duckdb.js";

export interface AggregateMetrics {
  turns: number;
  meanIterations: number;
  repairRate: number;
  errorRate: number;
  totalCostUsd: number;
  p50DurationMs: number;
  p95DurationMs: number;
  cacheHitRate: number;
  toolCallDistribution: { name: string; count: number }[];
  turnsPerDay: { day: string; count: number }[];
}

export async function getMetrics(): Promise<AggregateMetrics> {
  const [aggregateRows, toolDistRows, perDayRows] = await Promise.all([
    queryRows(`
      SELECT
        COUNT(*) AS turns,
        COALESCE(AVG(iterations), 0) AS mean_iterations,
        COALESCE(AVG(CASE WHEN repaired THEN 1.0 ELSE 0.0 END), 0) AS repair_rate,
        COALESCE(AVG(CASE WHEN errored THEN 1.0 ELSE 0.0 END), 0) AS error_rate,
        COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
        COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_duration_ms), 0) AS p50_duration_ms,
        COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_duration_ms), 0) AS p95_duration_ms,
        COALESCE(
          SUM(cache_read_input_tokens)::DOUBLE
            / NULLIF(SUM(cache_read_input_tokens + input_tokens), 0),
          0
        ) AS cache_hit_rate
      FROM main_analytics.fct_agent_traces
    `),
    queryRows(`
      SELECT tc->>'$.name' AS name, COUNT(*) AS count
      FROM main_analytics.fct_agent_traces, UNNEST(json_transform(tool_calls_json, '["JSON"]')) AS t(tc)
      GROUP BY name
      ORDER BY count DESC
    `),
    queryRows(`
      SELECT CAST(extracted_at AS DATE)::VARCHAR AS day, COUNT(*) AS count
      FROM main_analytics.fct_agent_traces
      GROUP BY day
      ORDER BY day DESC
    `),
  ]);

  const agg = aggregateRows[0] ?? {};

  return {
    turns: Number(agg["turns"] ?? 0),
    meanIterations: Number(agg["mean_iterations"] ?? 0),
    repairRate: Number(agg["repair_rate"] ?? 0),
    errorRate: Number(agg["error_rate"] ?? 0),
    totalCostUsd: Number(agg["total_cost_usd"] ?? 0),
    p50DurationMs: Number(agg["p50_duration_ms"] ?? 0),
    p95DurationMs: Number(agg["p95_duration_ms"] ?? 0),
    cacheHitRate: Number(agg["cache_hit_rate"] ?? 0),
    toolCallDistribution: toolDistRows.map((r) => ({ name: String(r["name"]), count: Number(r["count"]) })),
    turnsPerDay: perDayRows.map((r) => ({ day: String(r["day"]), count: Number(r["count"]) })),
  };
}

export async function getTraceById(traceId: string): Promise<Record<string, unknown> | null> {
  const rows = await queryRowsParams(
    `SELECT * FROM main_analytics.fct_agent_traces WHERE trace_id = $1`,
    [traceId]
  );
  return rows[0] ?? null;
}
