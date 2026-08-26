import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadGoldenSet } from "../types.js";
import { JUDGE_SYSTEM_PROMPT } from "./judge.js";

describe("judge rubric discipline", () => {
  it("does not reward aggregation-05 for asking a clarifying question instead of reporting totals", () => {
    const goldenCase = loadGoldenSet(join(import.meta.dirname, "..", "golden.jsonl")).find(
      (candidate) => candidate.id === "aggregation-05"
    );

    expect(goldenCase?.rubric).toContain("A clarifying question without the totals fails");
    expect(JUDGE_SYSTEM_PROMPT).toContain("a clarifying question");
    expect(JUDGE_SYSTEM_PROMPT).toContain("provides none of the required result should score 1");
    expect(JUDGE_SYSTEM_PROMPT).toContain("rubric is the sole contract");
  });
});
