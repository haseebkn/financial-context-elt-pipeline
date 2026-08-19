import { useEffect, useState } from "react";
import { formatDurationMs, formatToolName, formatUsd } from "../lib/format.js";

interface AggregateMetrics {
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

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function MetricsView() {
  const [metrics, setMetrics] = useState<AggregateMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/metrics")
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then(setMetrics)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <p className="empty-state">Failed to load metrics: {error}</p>;
  if (!metrics) return <p className="empty-state">Loading metrics…</p>;

  if (metrics.turns === 0) {
    return (
      <p className="empty-state">
        No agent turns recorded yet. Chat with the agent, then run <code>dbt build</code> to pick up
        the new trace files.
      </p>
    );
  }

  const maxToolCount = Math.max(1, ...metrics.toolCallDistribution.map((t) => t.count));

  return (
    <div className="metrics-view">
      <div className="stat-grid">
        <StatCard label="Turns" value={String(metrics.turns)} />
        <StatCard label="Mean iterations" value={metrics.meanIterations.toFixed(1)} />
        <StatCard label="Error rate" value={`${(metrics.errorRate * 100).toFixed(0)}%`} />
        <StatCard label="Repair rate" value={`${(metrics.repairRate * 100).toFixed(0)}%`} />
        <StatCard label="Cache hit rate" value={`${(metrics.cacheHitRate * 100).toFixed(0)}%`} />
        <StatCard label="Total cost" value={formatUsd(metrics.totalCostUsd)} />
        <StatCard label="p50 latency" value={formatDurationMs(metrics.p50DurationMs)} />
        <StatCard label="p95 latency" value={formatDurationMs(metrics.p95DurationMs)} />
      </div>

      <section className="panel-section">
        <h3>Tool call distribution</h3>
        {metrics.toolCallDistribution.length === 0 ? (
          <p className="empty-state">No tool calls recorded yet.</p>
        ) : (
          <div className="bar-list">
            {metrics.toolCallDistribution.map((t) => (
              <div key={t.name} className="bar-row">
                <span className="bar-label">{formatToolName(t.name)}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(t.count / maxToolCount) * 100}%` }} />
                </div>
                <span className="bar-count">{t.count}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel-section">
        <h3>Turns per day</h3>
        <div className="bar-list">
          {metrics.turnsPerDay.map((d) => (
            <div key={d.day} className="bar-row">
              <span className="bar-label mono">{d.day}</span>
              <div className="bar-track">
                <div
                  className="bar-fill bar-fill--alt"
                  style={{ width: `${(d.count / Math.max(1, ...metrics.turnsPerDay.map((x) => x.count))) * 100}%` }}
                />
              </div>
              <span className="bar-count">{d.count}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
