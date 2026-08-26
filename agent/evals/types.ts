import { z } from "zod/v4";
import { readFileSync } from "node:fs";

export const GoldenCaseSchema = z
  .object({
    id: z.string().min(1),
    category: z.enum(["retrieval", "aggregation", "multihop", "refusal", "nodata"]),
    question: z.string().min(1),
    expected_tools: z.array(z.string()),
    forbidden_tools: z.array(z.string()).optional(),
    expected_row_ids: z.array(z.string()),
    rubric: z.string().min(1),
  })
  .strict();

export type GoldenCase = z.infer<typeof GoldenCaseSchema>;

/** Loads and validates every case in a JSONL golden set. Throws on the first invalid line. */
export function loadGoldenSet(path: string): GoldenCase[] {
  const raw = readFileSync(path, "utf-8");
  const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  return lines.map((line, i) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      throw new Error(`golden.jsonl line ${i + 1}: invalid JSON — ${(e as Error).message}`);
    }
    const result = GoldenCaseSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`golden.jsonl line ${i + 1}: ${result.error.issues.map((iss) => iss.message).join("; ")}`);
    }
    return result.data;
  });
}

export interface CaseResult {
  id: string;
  category: GoldenCase["category"];
  question: string;
  answerText: string;
  toolCalls: string[];
  seenRowIds: string[];
  errored: boolean;
  errorMessage?: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;

  toolChoiceScore: number; // 0 or 1
  recallScore: number; // 0..1
  judgeScore: number; // 1..5 (mean across n samples)
  judgeSpread: number; // max judge score - min judge score across samples
  judgeExplanation: string;
  citationsValid: boolean;
}

export interface EvalReport {
  runAt: string;
  model: string;
  totalCases: number;
  categoryBreakdown: Record<
    GoldenCase["category"],
    { count: number; toolChoiceAccuracy: number; meanRecall: number; meanJudgeScore: number; meanJudgeSpread: number }
  >;
  aggregate: {
    toolChoiceAccuracy: number;
    meanRecall: number;
    meanJudgeScore: number;
    meanJudgeSpread: number;
    maxJudgeSpread: number;
    totalCostUsd: number;
    p50DurationMs: number;
    p95DurationMs: number;
  };
  results: CaseResult[];
}
