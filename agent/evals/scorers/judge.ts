import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../src/config.js";
import type { GoldenCase } from "../types.js";

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export const JUDGE_SYSTEM_PROMPT =
  "You are grading an AI financial assistant's answer against a case-specific rubric. The rubric is the sole " +
  "contract: grade whether the answer actually delivers every outcome it requires. Do not reward caution, a " +
  "clarifying question, a refusal, or an offer to answer later when the rubric requires factual results or " +
  "calculated totals; an answer that provides none of the required result should score 1. Only reward a refusal " +
  "when the rubric itself requires or permits declining. Do not invent requirements absent from the rubric. Be " +
  "strict about fabricated facts and citations: a cited row_id must support the claim attached to it.";

const JUDGE_TOOL = {
  name: "submit_judgment",
  description: "Submit your evaluation of the assistant's answer.",
  input_schema: {
    type: "object" as const,
    properties: {
      score: {
        type: "integer" as const,
        minimum: 1,
        maximum: 5,
        description: "1 = fails the rubric outright, 5 = fully satisfies it.",
      },
      citations_valid: {
        type: "boolean" as const,
        description: "True if every factual claim is properly cited and no citation is fabricated or misattributed.",
      },
      explanation: {
        type: "string" as const,
        description: "One or two sentences justifying the score, referencing the rubric.",
      },
    },
    required: ["score", "citations_valid", "explanation"],
    additionalProperties: false,
  },
};

export interface JudgeResult {
  score: number;
  citationsValid: boolean;
  explanation: string;
}

/** Scores one answer against its case's rubric using Claude as judge, forced into structured output via tool_choice. */
export async function judgeSingle(goldenCase: GoldenCase, answerText: string): Promise<JudgeResult> {
  const response = await client.messages.create({
    model: env.AGENT_MODEL,
    max_tokens: 1024,
    system: JUDGE_SYSTEM_PROMPT,
    tools: [JUDGE_TOOL],
    tool_choice: { type: "tool", name: "submit_judgment" },
    messages: [
      {
        role: "user",
        content:
          `Question: ${goldenCase.question}\n\n` +
          `Rubric: ${goldenCase.rubric}\n\n` +
          `Assistant's answer:\n${answerText || "(empty — the assistant produced no text response)"}`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Judge did not return a tool_use block — cannot extract a structured score.");
  }
  const input = toolUse.input as { score: number; citations_valid: boolean; explanation: string };
  return { score: input.score, citationsValid: input.citations_valid, explanation: input.explanation };
}

/**
 * Runs the judge n times and averages the score, since a single LLM-judge
 * sample is noise dressed as a metric. Returns the mean score, the spread
 * (max - min) so callers can see how much the judge disagreed with itself,
 * and the explanation from the run closest to the mean.
 */
export async function judgeWithSpread(
  goldenCase: GoldenCase,
  answerText: string,
  n = 3
): Promise<{ meanScore: number; spread: number; citationsValid: boolean; explanation: string }> {
  const runs = await Promise.all(Array.from({ length: n }, () => judgeSingle(goldenCase, answerText)));
  const scores = runs.map((r) => r.score);
  const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const spread = Math.max(...scores) - Math.min(...scores);
  const closest = runs.reduce((best, r) => (Math.abs(r.score - meanScore) < Math.abs(best.score - meanScore) ? r : best));
  // citations_valid is treated as unanimous-required: if any run flagged a
  // citation problem, surface it — false negatives here are worse than
  // false positives for a hallucination check.
  const citationsValid = runs.every((r) => r.citationsValid);
  return { meanScore, spread, citationsValid, explanation: closest.explanation };
}
