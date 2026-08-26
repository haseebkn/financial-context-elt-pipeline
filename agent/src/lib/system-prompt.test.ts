import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "./system-prompt.js";

describe("SYSTEM_PROMPT live-regression rules", () => {
  it("does not let data coverage redefine a relative period", () => {
    expect(SYSTEM_PROMPT).toContain('Never redefine "last month" or "next week"');
  });

  it("keeps recurring charges and transaction categories as observations", () => {
    expect(SYSTEM_PROMPT).toContain("does not prove a membership or a visit");
    expect(SYSTEM_PROMPT).toContain("do not prove money moved between the user's own accounts");
  });

  it("forbids unsolicited adjusted-spend calculations and unrelated tools", () => {
    expect(SYSTEM_PROMPT).toContain('do not volunteer an "adjusted"');
    expect(SYSTEM_PROMPT).toContain("Calendar questions do not need a portfolio snapshot");
  });

  it("uses computed provenance for aggregates and refuses subjective judgments without tools", () => {
    expect(SYSTEM_PROMPT).toContain("Cite the computed result_id for counts, sums");
    expect(SYSTEM_PROMPT).toContain("they do not prove an aggregate claim");
    expect(SYSTEM_PROMPT).toContain("Do not call tools before declining these questions");
  });
});
