import { describe, expect, it } from "vitest";
import { buildReport, evaluateGate, formatReportMarkdown, DEFAULT_THRESHOLDS } from "./report.js";
import type { CaseResult } from "./types.js";

function makeResult(overrides: Partial<CaseResult>): CaseResult {
  return {
    id: "c1",
    category: "retrieval",
    question: "q",
    answerText: "a",
    toolCalls: [],
    seenRowIds: [],
    errored: false,
    durationMs: 100,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.001,
    toolChoiceScore: 1,
    recallScore: 1,
    judgeScore: 5,
    judgeSpread: 0,
    judgeExplanation: "good",
    citationsValid: true,
    ...overrides,
  };
}

describe("buildReport", () => {
  it("computes per-category and aggregate stats", () => {
    const results = [
      makeResult({ id: "r1", category: "retrieval", toolChoiceScore: 1, recallScore: 1, judgeScore: 5 }),
      makeResult({ id: "r2", category: "retrieval", toolChoiceScore: 0, recallScore: 0.5, judgeScore: 3 }),
      makeResult({ id: "a1", category: "aggregation", toolChoiceScore: 1, recallScore: 1, judgeScore: 4 }),
    ];
    const report = buildReport(results, "claude-opus-5");

    expect(report.totalCases).toBe(3);
    expect(report.categoryBreakdown.retrieval.count).toBe(2);
    expect(report.categoryBreakdown.retrieval.toolChoiceAccuracy).toBeCloseTo(0.5);
    expect(report.categoryBreakdown.aggregation.count).toBe(1);
    expect(report.aggregate.meanJudgeScore).toBeCloseTo((5 + 3 + 4) / 3);
    expect(report.aggregate.meanJudgeSpread).toBe(0);
  });

  it("computes p50/p95 duration from real values", () => {
    const results = Array.from({ length: 10 }, (_, i) => makeResult({ id: `c${i}`, durationMs: (i + 1) * 100 }));
    const report = buildReport(results, "claude-opus-5");
    expect(report.aggregate.p50DurationMs).toBeGreaterThan(0);
    expect(report.aggregate.p95DurationMs).toBeGreaterThanOrEqual(report.aggregate.p50DurationMs);
  });

  it("handles zero results without dividing by zero", () => {
    const report = buildReport([], "claude-opus-5");
    expect(report.aggregate.meanJudgeScore).toBe(0);
    expect(report.aggregate.p50DurationMs).toBe(0);
    expect(report.aggregate.maxJudgeSpread).toBe(0);
  });

  it("reports judge disagreement instead of hiding it behind the mean", () => {
    const report = buildReport(
      [makeResult({ id: "stable", judgeSpread: 0 }), makeResult({ id: "noisy", judgeSpread: 2 })],
      "claude-opus-5"
    );
    expect(report.aggregate.meanJudgeSpread).toBe(1);
    expect(report.aggregate.maxJudgeSpread).toBe(2);
    expect(formatReportMarkdown(report)).toContain("Judge spread, mean / max: 1.00 / 2.00");
  });
});

describe("evaluateGate", () => {
  it("passes when every threshold is met and no refusal case failed", () => {
    const results = [makeResult({ category: "refusal", toolChoiceScore: 1 })];
    const report = buildReport(results, "claude-opus-5");
    expect(evaluateGate(report, DEFAULT_THRESHOLDS).passed).toBe(true);
  });

  it("fails on tool-choice accuracy below threshold", () => {
    const results = [makeResult({ toolChoiceScore: 0 }), makeResult({ id: "c2", toolChoiceScore: 0 })];
    const report = buildReport(results, "claude-opus-5");
    const gate = evaluateGate(report, DEFAULT_THRESHOLDS);
    expect(gate.passed).toBe(false);
    expect(gate.failures.some((f) => f.includes("Tool-choice accuracy"))).toBe(true);
  });

  it("fails with zero tolerance on a single missed refusal even if aggregates pass", () => {
    const results = [
      ...Array.from({ length: 10 }, (_, i) => makeResult({ id: `ok${i}` })),
      makeResult({ id: "refusal-fail", category: "refusal", toolChoiceScore: 0 }),
    ];
    const report = buildReport(results, "claude-opus-5");
    const gate = evaluateGate(report, DEFAULT_THRESHOLDS);
    expect(gate.passed).toBe(false);
    expect(gate.failures.some((f) => f.includes("zero tolerance"))).toBe(true);
  });
});

describe("formatReportMarkdown", () => {
  it("produces markdown containing the aggregate stats", () => {
    const report = buildReport([makeResult({})], "claude-opus-5");
    const md = formatReportMarkdown(report);
    expect(md).toContain("Eval Report");
    expect(md).toContain("claude-opus-5");
    expect(md).toContain("Tool-choice accuracy");
  });

  it("includes a baseline diff when a baseline is provided", () => {
    const baseline = buildReport([makeResult({ recallScore: 0.5 })], "claude-opus-5");
    const current = buildReport([makeResult({ recallScore: 0.9 })], "claude-opus-5");
    const md = formatReportMarkdown(current, baseline);
    expect(md).toMatch(/vs baseline/);
  });

  it("lists failing cases with their judge explanation", () => {
    const report = buildReport([makeResult({ id: "bad1", judgeScore: 2, judgeExplanation: "missed the point" })], "claude-opus-5");
    const md = formatReportMarkdown(report);
    expect(md).toContain("bad1");
    expect(md).toContain("missed the point");
  });
});
