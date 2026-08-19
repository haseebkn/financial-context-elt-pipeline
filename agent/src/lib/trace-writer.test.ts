import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeTraceRecord, type TraceRecord } from "./trace-writer.js";

function makeRecord(overrides: Partial<TraceRecord> = {}): TraceRecord {
  return {
    trace_id: "t1",
    question: "What did I spend at Starbucks?",
    stop_reason: "end_turn",
    iterations: 2,
    repaired: false,
    errored: false,
    error_message: null,
    citations_valid: true,
    input_tokens: 500,
    output_tokens: 100,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 400,
    cost_usd: 0.0045,
    total_duration_ms: 1200,
    tool_calls: [{ name: "search_context", duration_ms: 300, is_error: false }],
    ...overrides,
  };
}

describe("writeTraceRecord", () => {
  it("writes a valid envelope with metadata and raw_payload matching the record", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "trace-test-"));
    const path = writeTraceRecord(makeRecord(), baseDir);

    const written = JSON.parse(readFileSync(path, "utf-8"));
    expect(written.metadata.source).toBe("agent");
    expect(written.metadata.resource).toBe("traces");
    expect(written.metadata.partition_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(written.raw_payload.trace_id).toBe("t1");
    expect(written.raw_payload.cost_usd).toBe(0.0045);
    expect(written.raw_payload.tool_calls).toHaveLength(1);
  });

  it("partitions files by date under agent_traces/", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "trace-test-"));
    const path = writeTraceRecord(makeRecord(), baseDir);
    expect(path).toContain("agent_traces");
  });

  it("creates unique filenames across multiple writes in the same run", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "trace-test-"));
    const p1 = writeTraceRecord(makeRecord({ trace_id: "a" }), baseDir);
    const p2 = writeTraceRecord(makeRecord({ trace_id: "b" }), baseDir);
    expect(p1).not.toBe(p2);
  });

  it("records an errored turn with its error message", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "trace-test-"));
    const path = writeTraceRecord(
      makeRecord({ errored: true, error_message: "401 authentication_error", citations_valid: false }),
      baseDir
    );
    const written = JSON.parse(readFileSync(path, "utf-8"));
    expect(written.raw_payload.errored).toBe(true);
    expect(written.raw_payload.error_message).toContain("authentication_error");
  });

  it("creates the partition directory if it doesn't exist", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "trace-test-"));
    writeTraceRecord(makeRecord(), baseDir);
    const partitions = readdirSync(join(baseDir, "agent_traces"));
    expect(partitions.length).toBeGreaterThan(0);
  });
});
