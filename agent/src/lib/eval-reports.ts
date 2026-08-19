import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPORTS_DIR = join(import.meta.dirname, "..", "..", "evals", "reports");

/** Returns the most recently written eval report JSON, or null if none exist yet. */
export function getLatestEvalReport(reportsDir: string = REPORTS_DIR): unknown | null {
  if (!existsSync(reportsDir)) return null;

  const jsonFiles = readdirSync(reportsDir).filter((f) => f.endsWith(".json"));
  if (jsonFiles.length === 0) return null;

  // Filenames are ISO timestamps with `:`/`.` replaced by `-` (see evals/run.ts),
  // so a plain lexicographic sort is also chronological.
  jsonFiles.sort();
  const latest = jsonFiles[jsonFiles.length - 1]!;

  return JSON.parse(readFileSync(join(reportsDir, latest), "utf-8"));
}
