import { describe, expect, it } from "vitest";
import { getMetrics, getTraceById } from "./metrics.js";

// Integration tests against the real financial_engine.db (read-only) — same
// pattern as the tool tests. As of this test run there is at least one real
// trace on disk (written by a live smoke-test run against the real API),
// so these exercise real SQL against real data, not a mock.

describe("getMetrics (integration, real warehouse)", () => {
  it("returns a well-shaped aggregate without throwing on an empty or small trace set", async () => {
    const metrics = await getMetrics();
    expect(metrics.turns).toBeGreaterThanOrEqual(0);
    expect(metrics.meanIterations).toBeGreaterThanOrEqual(0);
    expect(metrics.repairRate).toBeGreaterThanOrEqual(0);
    expect(metrics.repairRate).toBeLessThanOrEqual(1);
    expect(metrics.errorRate).toBeGreaterThanOrEqual(0);
    expect(metrics.errorRate).toBeLessThanOrEqual(1);
    expect(Array.isArray(metrics.toolCallDistribution)).toBe(true);
    expect(Array.isArray(metrics.turnsPerDay)).toBe(true);
  });

  it("cache hit rate is a valid fraction between 0 and 1", async () => {
    const metrics = await getMetrics();
    expect(metrics.cacheHitRate).toBeGreaterThanOrEqual(0);
    expect(metrics.cacheHitRate).toBeLessThanOrEqual(1);
  });
});

describe("getTraceById (integration, real warehouse)", () => {
  it("returns null for a trace_id that doesn't exist", async () => {
    const trace = await getTraceById("nonexistent-trace-id-xyz");
    expect(trace).toBeNull();
  });
});
