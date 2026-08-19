import type { GoldenCase } from "../types.js";

/**
 * recall@k: fraction of the golden case's expected_row_ids that actually
 * appeared in a tool result this turn. Isolates retrieval quality from
 * generation quality — a case can score 1.0 recall and still get a bad
 * judge score if the final answer misused the retrieved data, and vice
 * versa, which is exactly the point of scoring them separately.
 *
 * A case with zero expected_row_ids (refusal, most no-data cases) scores
 * 1 automatically — there's nothing to recall.
 */
export function scoreRetrievalRecall(goldenCase: GoldenCase, seenRowIds: string[]): number {
  if (goldenCase.expected_row_ids.length === 0) return 1;
  const seen = new Set(seenRowIds);
  const hits = goldenCase.expected_row_ids.filter((id) => seen.has(id)).length;
  return hits / goldenCase.expected_row_ids.length;
}
