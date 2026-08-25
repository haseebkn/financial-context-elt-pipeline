import { describe, expect, it } from "vitest";
import { buildRequestContext } from "./request-context.js";

describe("buildRequestContext", () => {
  it("formats the date in the user's time zone", () => {
    const instant = new Date("2026-08-26T01:30:00.000Z");

    expect(buildRequestContext(instant, "America/St_Johns")).toContain(
      "Current date: 2026-08-25."
    );
    expect(buildRequestContext(instant, "UTC")).toContain("Current date: 2026-08-26.");
  });

  it("makes the relative-date rule explicit", () => {
    const context = buildRequestContext(new Date("2026-08-25T12:00:00.000Z"), "UTC");
    expect(context).toContain("never from the newest warehouse row");
  });
});
