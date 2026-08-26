import { createHash } from "node:crypto";

/**
 * Stable provenance id for one computed tool result. Unlike a sample row id,
 * this id represents the exact aggregate/query payload the model saw.
 */
export function createResultId(kind: "query" | "spend", payload: unknown): string {
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
  return `computed_${kind}_${digest}`;
}
