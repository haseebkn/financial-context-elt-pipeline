import type { GoldenCase } from "../types.js";

/**
 * recall@k: fraction of the golden case's expected row requirements that
 * appeared in a tool result this turn. Exact expected_row_ids count as one
 * requirement each. An expected_row_id_prefix counts as one requirement and
 * is satisfied by any matching row — useful for recurring events where every
 * generated occurrence represents the same semantic event. An
 * expected_row_id_set counts as one requirement when at least min_hits of
 * its candidate ids were seen, which avoids arbitrarily selecting exact
 * occurrences from a larger recurring series. Isolates retrieval quality from
 * generation quality — a case can score 1.0 recall and still get a bad
 * judge score if the final answer misused the retrieved data, and vice
 * versa, which is exactly the point of scoring them separately.
 *
 * A case with zero expected_row_ids (refusal, most no-data cases) scores
 * 1 automatically — there's nothing to recall.
 */
export function scoreRetrievalRecall(goldenCase: GoldenCase, seenRowIds: string[]): number {
  const prefixes = goldenCase.expected_row_id_prefixes ?? [];
  const sets = goldenCase.expected_row_id_sets ?? [];
  const requirementCount = goldenCase.expected_row_ids.length + prefixes.length + sets.length;
  if (requirementCount === 0) return 1;
  const seen = new Set(seenRowIds);
  const exactHits = goldenCase.expected_row_ids.filter((id) => seen.has(id)).length;
  const prefixHits = prefixes.filter((prefix) => seenRowIds.some((id) => id.startsWith(prefix))).length;
  const setHits = sets.filter((set) => set.any_of.filter((id) => seen.has(id)).length >= set.min_hits).length;
  return (exactHits + prefixHits + setHits) / requirementCount;
}
