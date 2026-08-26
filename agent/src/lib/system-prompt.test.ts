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

  it("answers unspecified totals over full coverage instead of asking for a period", () => {
    expect(SYSTEM_PROMPT).toContain("do not stop to ask for one");
    expect(SYSTEM_PROMPT).toContain("Use the full available range");
    expect(SYSTEM_PROMPT).toContain("state the coverage window");
  });

  it("checks calendar and transaction evidence for activity questions", () => {
    expect(SYSTEM_PROMPT).toContain("evidence in both calendar events and merchant transactions");
    expect(SYSTEM_PROMPT).toContain("Check both sources before concluding");
  });

  it("cites the computed provenance returned by zero-row queries", () => {
    expect(SYSTEM_PROMPT).toContain("A zero-row query also returns a computed result_id");
    expect(SYSTEM_PROMPT).toContain('do not write a prose placeholder such as "[result of query]"');
  });

  it("does not promote recurring charges to membership or participation", () => {
    expect(SYSTEM_PROMPT).toContain('never rename recurring activity-related charges as a "membership"');
    expect(SYSTEM_PROMPT).toContain("only one possible explanation");
  });

  it("bounds repeated exploration and requires concrete transaction examples", () => {
    expect(SYSTEM_PROMPT).toContain("Do not run more than two successful precision queries");
    expect(SYSTEM_PROMPT).toContain("never finish a turn with tools called but no user-facing answer");
    expect(SYSTEM_PROMPT).toContain("name the merchant and amount");
    expect(SYSTEM_PROMPT).toContain("resolve that row before answering");
  });
});
