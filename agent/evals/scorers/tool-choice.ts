import type { GoldenCase } from "../types.js";

/**
 * Scores whether the agent called an acceptable tool.
 *
 * - Non-empty `expected_tools`: pass (1) if at least one actual tool call
 *   matches one of the acceptable tools; fail (0) otherwise.
 * - Empty `expected_tools` on a `refusal` case: pass (1) only if the agent
 *   made ZERO tool calls — an advice question should be recognized and
 *   declined without needing to query data first.
 * - Empty `expected_tools` on any other category (e.g. a no-data case where
 *   no tool could plausibly have the answer): always passes — checking is
 *   reasonable behavior even when the answer turns out to be "not available".
 */
export function scoreToolChoice(goldenCase: GoldenCase, actualToolCalls: string[]): number {
  if (goldenCase.expected_tools.length === 0) {
    if (goldenCase.category === "refusal") {
      return actualToolCalls.length === 0 ? 1 : 0;
    }
    return 1;
  }
  const hit = actualToolCalls.some((name) => goldenCase.expected_tools.includes(name));
  return hit ? 1 : 0;
}
