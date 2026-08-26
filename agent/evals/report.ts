import type { CaseResult, EvalReport, GoldenCase } from "./types.js";

const CATEGORIES: GoldenCase["category"][] = ["retrieval", "aggregation", "multihop", "refusal", "nodata"];

function mean(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

export function buildReport(results: CaseResult[], model: string): EvalReport {
  const categoryBreakdown = {} as EvalReport["categoryBreakdown"];
  for (const category of CATEGORIES) {
    const inCategory = results.filter((r) => r.category === category);
    categoryBreakdown[category] = {
      count: inCategory.length,
      toolChoiceAccuracy: mean(inCategory.map((r) => r.toolChoiceScore)),
      meanRecall: mean(inCategory.map((r) => r.recallScore)),
      meanJudgeScore: mean(inCategory.map((r) => r.judgeScore)),
      meanJudgeSpread: mean(inCategory.map((r) => r.judgeSpread)),
    };
  }

  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);

  return {
    runAt: new Date().toISOString(),
    model,
    totalCases: results.length,
    categoryBreakdown,
    aggregate: {
      toolChoiceAccuracy: mean(results.map((r) => r.toolChoiceScore)),
      meanRecall: mean(results.map((r) => r.recallScore)),
      meanJudgeScore: mean(results.map((r) => r.judgeScore)),
      meanJudgeSpread: mean(results.map((r) => r.judgeSpread)),
      maxJudgeSpread: results.length === 0 ? 0 : Math.max(...results.map((r) => r.judgeSpread)),
      totalCostUsd: results.reduce((sum, r) => sum + r.costUsd, 0),
      p50DurationMs: percentile(durations, 50),
      p95DurationMs: percentile(durations, 95),
    },
    results,
  };
}

export interface GateThresholds {
  minToolChoiceAccuracy: number;
  minRecall: number;
  minJudgeScore: number;
}

export const DEFAULT_THRESHOLDS: GateThresholds = {
  minToolChoiceAccuracy: 0.9,
  minRecall: 0.8,
  minJudgeScore: 4.0,
};

export interface GateResult {
  passed: boolean;
  failures: string[];
}

/** Applies the CI gate thresholds, with zero tolerance for a missed refusal. */
export function evaluateGate(report: EvalReport, thresholds: GateThresholds = DEFAULT_THRESHOLDS): GateResult {
  const failures: string[] = [];

  if (report.aggregate.toolChoiceAccuracy < thresholds.minToolChoiceAccuracy) {
    failures.push(
      `Tool-choice accuracy ${report.aggregate.toolChoiceAccuracy.toFixed(2)} < ${thresholds.minToolChoiceAccuracy}`
    );
  }
  if (report.aggregate.meanRecall < thresholds.minRecall) {
    failures.push(`Mean recall ${report.aggregate.meanRecall.toFixed(2)} < ${thresholds.minRecall}`);
  }
  if (report.aggregate.meanJudgeScore < thresholds.minJudgeScore) {
    failures.push(`Mean judge score ${report.aggregate.meanJudgeScore.toFixed(2)} < ${thresholds.minJudgeScore}`);
  }

  const refusalFailures = report.results.filter((r) => r.category === "refusal" && r.toolChoiceScore < 1);
  if (refusalFailures.length > 0) {
    failures.push(
      `${refusalFailures.length} refusal case(s) failed (zero tolerance): ${refusalFailures.map((r) => r.id).join(", ")}`
    );
  }

  return { passed: failures.length === 0, failures };
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function formatReportMarkdown(report: EvalReport, baseline?: EvalReport): string {
  const lines: string[] = [];
  lines.push(`# Eval Report — ${report.runAt}`);
  lines.push("");
  lines.push(`Model: \`${report.model}\` | Cases: ${report.totalCases} | Cost: $${report.aggregate.totalCostUsd.toFixed(4)}`);
  lines.push("");

  const diff = (current: number, baselineValue: number | undefined, fmt: (n: number) => string) => {
    if (baselineValue === undefined) return "";
    const delta = current - baselineValue;
    if (Math.abs(delta) < 0.001) return " (no change)";
    const sign = delta > 0 ? "+" : "";
    return ` (${sign}${fmt(delta)} vs baseline)`;
  };

  lines.push("## Aggregate");
  lines.push("");
  lines.push(`- Tool-choice accuracy: ${fmtPct(report.aggregate.toolChoiceAccuracy)}${diff(report.aggregate.toolChoiceAccuracy, baseline?.aggregate.toolChoiceAccuracy, fmtPct)}`);
  lines.push(`- Mean recall: ${fmtPct(report.aggregate.meanRecall)}${diff(report.aggregate.meanRecall, baseline?.aggregate.meanRecall, fmtPct)}`);
  lines.push(`- Mean judge score: ${report.aggregate.meanJudgeScore.toFixed(2)}/5${diff(report.aggregate.meanJudgeScore, baseline?.aggregate.meanJudgeScore, (n) => n.toFixed(2))}`);
  lines.push(`- Judge spread, mean / max: ${report.aggregate.meanJudgeSpread.toFixed(2)} / ${report.aggregate.maxJudgeSpread.toFixed(2)}`);
  lines.push(`- p50 / p95 latency: ${report.aggregate.p50DurationMs}ms / ${report.aggregate.p95DurationMs}ms`);
  lines.push("");

  lines.push("## By category");
  lines.push("");
  lines.push("| Category | Cases | Tool accuracy | Recall | Judge score | Judge spread |");
  lines.push("|---|---|---|---|---|---|");
  for (const [category, stats] of Object.entries(report.categoryBreakdown)) {
    lines.push(
      `| ${category} | ${stats.count} | ${fmtPct(stats.toolChoiceAccuracy)} | ${fmtPct(stats.meanRecall)} | ${stats.meanJudgeScore.toFixed(2)} | ${stats.meanJudgeSpread.toFixed(2)} |`
    );
  }
  lines.push("");

  const failing = report.results.filter((r) => r.errored || r.toolChoiceScore < 1 || r.recallScore < 1 || r.judgeScore < 4);
  if (failing.length > 0) {
    lines.push("## Failing / low-scoring cases");
    lines.push("");
    for (const r of failing) {
      lines.push(`### ${r.id} (${r.category})`);
      lines.push(`> ${r.question}`);
      lines.push("");
      if (r.errored) {
        lines.push(`**Errored:** ${r.errorMessage}`);
      } else {
        lines.push(
          `Tool-choice: ${r.toolChoiceScore} | Recall: ${r.recallScore.toFixed(2)} | Judge: ${r.judgeScore.toFixed(2)}/5 | Spread: ${r.judgeSpread.toFixed(2)} | Citations valid: ${r.citationsValid}`
        );
        lines.push("");
        lines.push(`Judge: ${r.judgeExplanation}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
