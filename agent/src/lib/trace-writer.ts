import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Writes one completed turn's trace as a JSON file into the raw landing
 * zone, mirroring load/file_writer.py's envelope pattern (metadata +
 * raw_payload) so it can be picked up by a dbt staging model exactly like
 * every other source in this pipeline — same ELT discipline, not a
 * one-off side channel.
 */

export interface TraceRecord {
  trace_id: string;
  question: string;
  stop_reason: string;
  iterations: number;
  repaired: boolean;
  errored: boolean;
  error_message: string | null;
  citations_valid: boolean;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cost_usd: number;
  total_duration_ms: number;
  tool_calls: { name: string; duration_ms: number; is_error: boolean }[];
}

const RAW_DATA_ROOT = process.env.RAW_DATA_ROOT ?? "../raw_data";

export function writeTraceRecord(record: TraceRecord, baseDir: string = RAW_DATA_ROOT): string {
  const now = new Date();
  const partitionDate = now.toISOString().slice(0, 10);

  const envelope = {
    metadata: {
      extracted_at: now.toISOString(),
      source: "agent",
      resource: "traces",
      run_id: randomUUID(),
      partition_date: partitionDate,
    },
    raw_payload: record,
  };

  const targetDir = join(baseDir, "agent_traces", partitionDate);
  mkdirSync(targetDir, { recursive: true });

  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const filePath = join(targetDir, `trace_${timestamp}_${randomUUID().slice(0, 8)}.json`);
  writeFileSync(filePath, JSON.stringify(envelope, null, 2), "utf-8");
  return filePath;
}
