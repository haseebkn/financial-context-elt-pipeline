import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getLatestEvalReport } from "./eval-reports.js";

describe("getLatestEvalReport", () => {
  it("returns null when the reports directory doesn't exist", () => {
    expect(getLatestEvalReport(join(tmpdir(), "does-not-exist-xyz"))).toBeNull();
  });

  it("returns null when the directory exists but has no JSON reports", () => {
    const dir = mkdtempSync(join(tmpdir(), "evals-empty-"));
    writeFileSync(join(dir, ".gitkeep"), "");
    expect(getLatestEvalReport(dir)).toBeNull();
  });

  it("returns the chronologically latest report by filename", () => {
    const dir = mkdtempSync(join(tmpdir(), "evals-reports-"));
    writeFileSync(join(dir, "2026-01-01T00-00-00-000Z.json"), JSON.stringify({ runAt: "old" }));
    writeFileSync(join(dir, "2026-06-15T12-00-00-000Z.json"), JSON.stringify({ runAt: "new" }));

    const report = getLatestEvalReport(dir) as { runAt: string };
    expect(report.runAt).toBe("new");
  });

  it("ignores non-JSON files like .md reports", () => {
    const dir = mkdtempSync(join(tmpdir(), "evals-reports-"));
    writeFileSync(join(dir, "2026-01-01T00-00-00-000Z.json"), JSON.stringify({ runAt: "the-one" }));
    writeFileSync(join(dir, "2026-06-15T12-00-00-000Z.md"), "# markdown report");

    const report = getLatestEvalReport(dir) as { runAt: string };
    expect(report.runAt).toBe("the-one");
  });
});
