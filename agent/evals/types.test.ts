import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadGoldenSet } from "./types.js";

describe("golden.jsonl", () => {
  const cases = loadGoldenSet(join(import.meta.dirname, "golden.jsonl"));

  it("loads and validates every line without error", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it("has at least 5 cases per category", () => {
    const byCategory = new Map<string, number>();
    for (const c of cases) byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + 1);
    for (const category of ["retrieval", "aggregation", "multihop", "refusal", "nodata"]) {
      expect(byCategory.get(category) ?? 0).toBeGreaterThanOrEqual(5);
    }
  });

  it("has unique ids", () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every refusal case has empty expected_tools and expected_row_ids", () => {
    for (const c of cases.filter((c) => c.category === "refusal")) {
      expect(c.expected_tools).toEqual([]);
      expect(c.expected_row_ids).toEqual([]);
    }
  });
});
