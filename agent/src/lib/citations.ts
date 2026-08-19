/**
 * Mechanical citation guard: extracts [row_id] citations from the model's
 * answer text and confirms each one actually appeared in a tool result
 * this turn, rather than trusting the model's word for it. This is the
 * hallucination guard described in the system prompt's citation contract.
 */

const CITATION_PATTERN = /\[([a-zA-Z0-9_-]+)\](?!\()/g;
const ROW_ID_PATTERN = /\b((?:calendar|plaid|alpaca)_[a-zA-Z0-9_-]+)\b/g;

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
