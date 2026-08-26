import { useEffect, useState } from "react";
import { formatDurationMs, formatUsd } from "../lib/format.js";

interface CategoryStats {
  count: number;
  toolChoiceAccuracy: number;
  meanRecall: number;
  meanJudgeScore: number;
  meanJudgeSpread: number;
}

interface EvalReport {
  runAt: string;
  model: string;
  totalCases: number;
  categoryBreakdown: Record<string, CategoryStats>;
  aggregate: {
    toolChoiceAccuracy: number;
    meanRecall: number;
    meanJudgeScore: number;
    meanJudgeSpread: number;
    maxJudgeSpread: number;
    totalCostUsd: number;
    p50DurationMs: number;
    p95DurationMs: number;
  };
  results: {
    id: string;
    category: string;
    question: string;
    toolChoiceScore: number;
    recallScore: number;
    judgeScore: number;
    judgeSpread: number;
    judgeExplanation: string;
    errored: boolean;
    manualAdjudication?: {
      verdict: "judge_false_negative";
      score: number;
      judgeN: number;
      spread: number;
      explanation: string;
    };
  }[];
}

export function EvalsView() {
  const [report, setReport] = useState<EvalReport | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/evals/latest")
      .then(async (r) => {
        if (r.status === 404) {
          setNotFound(true);
          return;
        }
        if (!r.ok) throw new Error(`${r.status}`);
        setReport(await r.json());
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <p className="empty-state">Failed to load eval report: {error}</p>;
  if (notFound) {
    return (
      <p className="empty-state">
        No eval report yet. Run <code>npm run eval</code> in <code>agent/</code> (requires
        <code> ANTHROPIC_API_KEY</code> and a populated local warehouse).
      </p>
    );
  }
  if (!report) return <p className="empty-state">Loading eval report…</p>;

  const failing = report.results.filter(
    (r) => r.errored || r.toolChoiceScore < 1 || r.recallScore < 1 || r.judgeScore < 4
  );

  return (
    <div className="metrics-view">
      <p className="eval-meta">
        {report.model} · {report.totalCases} cases · {new Date(report.runAt).toLocaleString()} ·{" "}
        {formatUsd(report.aggregate.totalCostUsd)}
      </p>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Tool-choice accuracy</div>
          <div className="stat-value">{(report.aggregate.toolChoiceAccuracy * 100).toFixed(0)}%</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Mean recall</div>
          <div className="stat-value">{(report.aggregate.meanRecall * 100).toFixed(0)}%</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Mean judge score</div>
          <div className="stat-value">{report.aggregate.meanJudgeScore.toFixed(2)}/5</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Judge spread mean / max</div>
          <div className="stat-value">
            {report.aggregate.meanJudgeSpread.toFixed(2)} / {report.aggregate.maxJudgeSpread.toFixed(2)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">p50 / p95</div>
          <div className="stat-value">
            {formatDurationMs(report.aggregate.p50DurationMs)} / {formatDurationMs(report.aggregate.p95DurationMs)}
          </div>
        </div>
      </div>

      <section className="panel-section">
        <h3>By category</h3>
        <table className="eval-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Cases</th>
              <th>Tool accuracy</th>
              <th>Recall</th>
              <th>Judge</th>
              <th>Spread</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(report.categoryBreakdown).map(([category, stats]) => (
              <tr key={category}>
                <td>{category}</td>
                <td>{stats.count}</td>
                <td>{(stats.toolChoiceAccuracy * 100).toFixed(0)}%</td>
                <td>{(stats.meanRecall * 100).toFixed(0)}%</td>
                <td>{stats.meanJudgeScore.toFixed(2)}</td>
                <td>{stats.meanJudgeSpread.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {failing.length > 0 && (
        <section className="panel-section">
          <h3>Raw failing / low-scoring cases</h3>
          <ol className="eval-failures">
            {failing.map((r) => (
              <li key={r.id}>
                <div className="eval-failure-head">
                  <span className="mono">{r.id}</span>
                  <span className="tool-duration">
                    tool {r.toolChoiceScore} · recall {r.recallScore.toFixed(2)} · judge {r.judgeScore.toFixed(2)} · spread {r.judgeSpread.toFixed(2)}
                  </span>
                </div>
                <p className="eval-failure-question">{r.question}</p>
                {r.judgeExplanation && <p className="eval-failure-explanation">{r.judgeExplanation}</p>}
                {r.manualAdjudication && (
                  <div className="eval-adjudication">
                    <strong>Manual adjudication · judge false negative</strong>
                    <span>
                      Targeted recheck: {r.manualAdjudication.score.toFixed(2)}/5 · n={r.manualAdjudication.judgeN} · spread {r.manualAdjudication.spread.toFixed(2)}
                    </span>
                    <p>{r.manualAdjudication.explanation}</p>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
