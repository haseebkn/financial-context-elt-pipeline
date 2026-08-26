/**
 * Mechanical citation guard: extracts [row_id] citations from the model's
 * answer text and confirms each one actually appeared in a tool result
 * this turn, rather than trusting the model's word for it. This is the
 * hallucination guard described in the system prompt's citation contract.
 */

const CITATION_PATTERN = /\[([a-zA-Z0-9_-]+)\](?!\()/g;
const ROW_ID_PATTERN = /\b((?:(?:calendar|plaid|alpaca|computed)_[a-zA-Z0-9_-]+))\b/g;

/** Extracts every [row_id]-style citation token from the answer text. */
export function extractCitations(text: string): string[] {
  const matches = [...text.matchAll(CITATION_PATTERN)].map((m) => m[1]!);
  return [...new Set(matches)];
}

/** Extracts every row_id-shaped token appearing anywhere in a tool result string. */
export function extractRowIdsFromToolResult(toolResultText: string): string[] {
  const matches = [...toolResultText.matchAll(ROW_ID_PATTERN)].map((m) => m[1]!);
  return matches;
}

export interface CitationValidation {
  valid: boolean;
  citedIds: string[];
  unsupportedIds: string[];
}

/**
 * Validates that every citation in the answer text is backed by a row_id
 * that appeared in this turn's tool results. An answer with zero citations
 * is valid on its own (not every response makes a factual claim needing
 * one — e.g. a refusal, or "I don't have that data") — the caller decides
 * whether zero citations is suspicious given the question asked.
 */
export function validateCitations(answerText: string, seenRowIds: ReadonlySet<string>): CitationValidation {
  const citedIds = extractCitations(answerText);
  const unsupportedIds = citedIds.filter((id) => !seenRowIds.has(id));
  return { valid: unsupportedIds.length === 0, citedIds, unsupportedIds };
}

/**
 * Removes citation brackets whose row_id was not seen in this turn's tool
 * results, leaving the surrounding prose intact.
 *
 * This replaces what used to be a second LLM call asked to "rewrite the
 * answer to remove unsupported citations". That was actively harmful: given
 * `Allowed row_ids: (none)` the repair model concluded nothing was
 * supportable and rewrote a correct answer ("Cash: $100,000.00 ... status
 * ACTIVE", straight from a successful tool call) into "I don't have
 * supporting records available to report your cash balance" — turning a
 * true statement into a false one, and on other runs deleting the exact
 * figure the user had asked for.
 *
 * A bad citation means the attribution is wrong, not that the claim is.
 * Stripping the bracket removes the false attribution and cannot delete
 * content, is deterministic, and costs no tokens or latency.
 */
export function stripUnsupportedCitations(
  answerText: string,
  seenRowIds: ReadonlySet<string>
): string {
  // Fresh regex per call — a module-level /g pattern carries lastIndex state.
  const pattern = /[ \t]*\[([a-zA-Z0-9_-]+)\](?!\()/g;
  return (
    answerText
      .replace(pattern, (match, id: string) => (seenRowIds.has(id) ? match : ""))
      // Tidy the punctuation the removed bracket leaves behind.
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+([.,;:!?])/g, "$1")
      .replace(/\(\s*\)/g, "")
      .replace(/[ \t]+$/gm, "")
  );
}
