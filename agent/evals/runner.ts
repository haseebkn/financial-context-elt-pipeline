import { runAgentTurn } from "../src/agent-loop.js";
import { env } from "../src/config.js";
import type { AgentStreamEvent } from "../src/streaming-types.js";
import type { CaseResult, GoldenCase } from "./types.js";
import { scoreToolChoice } from "./scorers/tool-choice.js";
import { scoreRetrievalRecall } from "./scorers/retrieval-recall.js";
import { judgeWithSpread as realJudgeWithSpread } from "./scorers/judge.js";

export type AgentTurnFn = (params: { history: []; userMessage: string }) => AsyncGenerator<AgentStreamEvent>;
export type JudgeFn = typeof realJudgeWithSpread;

/**
 * Runs one golden case through the agent loop and scores it. Takes the
 * agent-turn and judge functions as parameters (each defaulting to the real
 * implementation) so the orchestration logic — event collection, scoring,
 * error handling — can be tested against scripted fakes without hitting the
 * network. See runner.test.ts.
 */
export async function runEvalCase(
  goldenCase: GoldenCase,
  options: { judgeN?: number; agentTurn?: AgentTurnFn; judge?: JudgeFn } = {}
): Promise<CaseResult> {
  const agentTurn = options.agentTurn ?? runAgentTurn;
  const judgeWithSpread = options.judge ?? realJudgeWithSpread;
  const judgeN = options.judgeN ?? 3;

  const toolCalls: string[] = [];
  const seenRowIds = new Set<string>();
  let answerText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  const startedAt = Date.now();

  try {
    for await (const event of agentTurn({ history: [], userMessage: goldenCase.question })) {
      switch (event.type) {
        case "tool_call":
          toolCalls.push(event.name);
          break;
        case "citation":
          seenRowIds.add(event.rowId);
          break;
        case "text_delta":
          answerText += event.text;
          break;
        case "text_correction":
          answerText = event.text;
          break;
        case "tool_result":
          for (const match of event.summary.matchAll(/\b((?:calendar|plaid|alpaca)_[a-zA-Z0-9_-]+)\b/g)) {
            seenRowIds.add(match[1]!);
          }
          break;
        case "error":
          if (event.fatal) {
            return {
              id: goldenCase.id,
              category: goldenCase.category,
              question: goldenCase.question,
              answerText: "",
              toolCalls,
              seenRowIds: [...seenRowIds],
              errored: true,
              errorMessage: event.message,
              durationMs: Date.now() - startedAt,
              inputTokens,
              outputTokens,
              costUsd,
              toolChoiceScore: 0,
              recallScore: 0,
              judgeScore: 0,
              judgeExplanation: "Case errored before producing an answer.",
              citationsValid: false,
            };
          }
          break;
        case "done":
          inputTokens = event.usage.inputTokens;
          outputTokens = event.usage.outputTokens;
          costUsd = event.usage.estimatedCostUsd;
          break;
      }
    }
  } catch (e) {
    return {
      id: goldenCase.id,
      category: goldenCase.category,
      question: goldenCase.question,
      answerText: "",
      toolCalls,
      seenRowIds: [...seenRowIds],
      errored: true,
      errorMessage: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - startedAt,
      inputTokens,
      outputTokens,
      costUsd,
      toolChoiceScore: 0,
      recallScore: 0,
      judgeScore: 0,
      judgeExplanation: "Case threw before producing an answer.",
      citationsValid: false,
    };
  }

  const toolChoiceScore = scoreToolChoice(goldenCase, toolCalls);
  const recallScore = scoreRetrievalRecall(goldenCase, [...seenRowIds]);
  const judged = await judgeWithSpread(goldenCase, answerText, judgeN);

  return {
    id: goldenCase.id,
    category: goldenCase.category,
    question: goldenCase.question,
    answerText,
    toolCalls,
    seenRowIds: [...seenRowIds],
    errored: false,
    durationMs: Date.now() - startedAt,
    inputTokens,
    outputTokens,
    costUsd,
    toolChoiceScore,
    recallScore,
    judgeScore: judged.meanScore,
    judgeExplanation: judged.explanation,
    citationsValid: judged.citationsValid,
  };
}

/** Runs a suite with bounded concurrency to avoid hammering rate limits. */
export async function runEvalSuite(
  cases: GoldenCase[],
  options: { concurrency?: number; judgeN?: number; agentTurn?: AgentTurnFn; judge?: JudgeFn } = {}
): Promise<CaseResult[]> {
  const concurrency = options.concurrency ?? 4;
  const results: CaseResult[] = new Array(cases.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= cases.length) return;
      results[i] = await runEvalCase(cases[i]!, options);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, worker));
  return results;
}

export { env };
