import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadGoldenSet, type EvalReport } from "./types.js";
import { runEvalSuite } from "./runner.js";
import { buildReport, evaluateGate, formatReportMarkdown, DEFAULT_THRESHOLDS } from "./report.js";
import { env } from "../src/config.js";

/**
 * CLI entrypoint. Usage:
 *   npx tsx evals/run.ts               — full suite, n=3 judge samples
 *   npx tsx evals/run.ts --subset 12   — first 12 cases, n=1 judge sample (fast PR check)
 *   npx tsx evals/run.ts --cases retrieval-05,aggregation-02 --judge-n 3 --no-write
 *   npx tsx evals/run.ts --gate        — exit 1 if thresholds aren't met (for CI)
 */

const EVALS_DIR = import.meta.dirname;
const REPORTS_DIR = join(EVALS_DIR, "reports");
const PRIVATE_REPORTS_DIR = join(REPORTS_DIR, "private");
const BASELINE_PATH = join(EVALS_DIR, "baseline.json");

function parseArgs(argv: string[]) {
  const subsetIdx = argv.indexOf("--subset");
  const subset = subsetIdx >= 0 ? Number(argv[subsetIdx + 1]) : undefined;
  const casesIdx = argv.indexOf("--cases");
  const caseIds = casesIdx >= 0 ? argv[casesIdx + 1]?.split(",").filter(Boolean) : undefined;
  const judgeIdx = argv.indexOf("--judge-n");
  const judgeN = judgeIdx >= 0 ? Number(argv[judgeIdx + 1]) : undefined;
  const gate = argv.includes("--gate");
  const write = !argv.includes("--no-write");
  if (subset !== undefined && (!Number.isInteger(subset) || subset < 1)) throw new Error("--subset must be a positive integer");
  if (judgeN !== undefined && (!Number.isInteger(judgeN) || judgeN < 1)) throw new Error("--judge-n must be a positive integer");
  if (subset && caseIds) throw new Error("Use either --subset or --cases, not both");
  return { subset, caseIds, judgeN, gate, write };
}

async function main() {
  const { subset, caseIds, judgeN: requestedJudgeN, gate, write } = parseArgs(process.argv.slice(2));

  let cases = loadGoldenSet(join(EVALS_DIR, "golden.jsonl"));
  if (subset) cases = cases.slice(0, subset);
  if (caseIds) {
    const requested = new Set(caseIds);
    cases = cases.filter((goldenCase) => requested.has(goldenCase.id));
    const missing = caseIds.filter((id) => !cases.some((goldenCase) => goldenCase.id === id));
    if (missing.length > 0) throw new Error(`Unknown case id(s): ${missing.join(", ")}`);
  }

  const judgeN = requestedJudgeN ?? (subset ? 1 : 3);
  console.log(`Running ${cases.length} case(s) against ${env.AGENT_MODEL}, judge n=${judgeN}...`);

  const results = await runEvalSuite(cases, { concurrency: 4, judgeN });
  const report = buildReport(results, env.AGENT_MODEL);

  // reports/ is empty in a fresh clone and Git does not preserve empty
  // directories. Create it at write time so the documented command works
  // without a manual mkdir step.
  const timestamp = report.runAt.replace(/[:.]/g, "-");

  const baseline: EvalReport | undefined = existsSync(BASELINE_PATH)
    ? (JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as EvalReport)
    : undefined;

  const markdown = formatReportMarkdown(report, baseline);
  if (write) {
    mkdirSync(REPORTS_DIR, { recursive: true });
    mkdirSync(PRIVATE_REPORTS_DIR, { recursive: true });
    writeFileSync(join(PRIVATE_REPORTS_DIR, `${timestamp}.json`), JSON.stringify(report, null, 2));

    // The full local report keeps answers and retrieved row ids for debugging.
    // The committed/UI artifact omits those personal-data-bearing fields while
    // retaining questions, scores, judge explanations, latency, and cost.
    const publicReport = {
      ...report,
      results: report.results.map(({ answerText: _answerText, seenRowIds: _seenRowIds, errorMessage: _error, ...result }) => result),
    };
    writeFileSync(join(REPORTS_DIR, `${timestamp}.json`), JSON.stringify(publicReport, null, 2));
    writeFileSync(join(REPORTS_DIR, `${timestamp}.md`), markdown);
  }
  console.log(markdown);

  if (gate) {
    const result = evaluateGate(report, DEFAULT_THRESHOLDS);
    if (!result.passed) {
      console.error("\nEVAL GATE FAILED:");
      for (const f of result.failures) console.error(`  - ${f}`);
      process.exit(1);
    }
    console.log("\nEval gate passed.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
