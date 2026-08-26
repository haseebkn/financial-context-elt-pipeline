import { describe, expect, it } from "vitest";
import { createResultId } from "./result-id.js";

describe("createResultId", () => {
  it("is stable for the same computed payload", () => {
    const payload = { total: 42, count: 3 };
    expect(createResultId("query", payload)).toBe(createResultId("query", payload));
  });

  it("changes when the result changes", () => {
    expect(createResultId("spend", { total: 42 })).not.toBe(
      createResultId("spend", { total: 43 })
    );
  });
});
