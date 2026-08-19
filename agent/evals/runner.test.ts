import { describe, expect, it } from "vitest";
import { runEvalCase, runEvalSuite } from "./runner.js";
import type { AgentStreamEvent } from "../src/streaming-types.js";
import type { GoldenCase } from "./types.js";

const CASE: GoldenCase = {
  id: "test-1",
  category: "retrieval",
  question: "What did I spend at Starbucks?",
  expected_tools: ["search_context"],
  expected_row_ids: ["plaid_abc"],
  rubric: "Mentions the Starbucks purchase.",
};

async function* fakeTurn(events: AgentStreamEvent[]): AsyncGenerator<AgentStreamEvent> {
  for (const e of events) yield e;
}

const fakeJudge = async () => ({ meanScore: 4.5, spread: 0.5, citationsValid: true, explanation: "solid answer" });

describe("runEvalCase (offline, scripted fakes — no network)", () => {
  it("scores a well-behaved turn: correct tool, correct citation, judged well", async () => {
    const events: AgentStreamEvent[] = [
      { type: "tool_call", traceId: "t1", toolCallId: "tc1", name: "search_context", input: {} },
      {
        type: "tool_result",
        traceId: "t1",
        toolCallId: "tc1",
        name: "search_context",
        isError: false,
        summary: JSON.stringify([{ row_id: "plaid_abc", text: "Starbucks $4.33" }]),
        durationMs: 10,
      },
      { type: "text_delta", traceId: "t1", text: "You spent $4.33 at Starbucks [plaid_abc]." },
      { type: "citation", traceId: "t1", rowId: "plaid_abc", source: "plaid" },
      {
        type: "done",
        traceId: "t1",
        stopReason: "end_turn",
        usage: { inputTokens: 500, outputTokens: 50, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, estimatedCostUsd: 0.003 },
        totalDurationMs: 500, iterations: 1, repaired: false,
      },
    ];

    const result = await runEvalCase(CASE, {
      agentTurn: () => fakeTurn(events),
      judge: fakeJudge,
    });

    expect(result.errored).toBe(false);
    expect(result.toolChoiceScore).toBe(1); // called search_context, matches expected_tools
    expect(result.recallScore).toBe(1); // plaid_abc was seen
    expect(result.judgeScore).toBe(4.5);
    expect(result.answerText).toContain("Starbucks");
    expect(result.inputTokens).toBe(500);
    expect(result.costUsd).toBe(0.003);
  });

  it("scores a turn that calls the wrong tool and misses the expected row_id", async () => {
    const events: AgentStreamEvent[] = [
      { type: "tool_call", traceId: "t1", toolCallId: "tc1", name: "query_warehouse", input: {} },
      {
        type: "tool_result",
        traceId: "t1",
        toolCallId: "tc1",
        name: "query_warehouse",
        isError: false,
        summary: "Query returned 0 rows.",
        durationMs: 5,
      },
      { type: "text_delta", traceId: "t1", text: "I couldn't find that." },
      {
        type: "done",
        traceId: "t1",
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 20, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, estimatedCostUsd: 0.001 },
        totalDurationMs: 200, iterations: 1, repaired: false,
      },
    ];

    const result = await runEvalCase(CASE, {
      agentTurn: () => fakeTurn(events),
      judge: fakeJudge,
    });

    expect(result.toolChoiceScore).toBe(0); // called query_warehouse, not search_context
    expect(result.recallScore).toBe(0); // plaid_abc never seen
  });

  it("handles a fatal error event without calling the judge", async () => {
    let judgeCalled = false;
    const events: AgentStreamEvent[] = [
      { type: "error", traceId: "t1", message: "401 authentication_error", fatal: true },
    ];

    const result = await runEvalCase(CASE, {
      agentTurn: () => fakeTurn(events),
      judge: async () => {
        judgeCalled = true;
        return fakeJudge();
      },
    });

    expect(result.errored).toBe(true);
    expect(result.errorMessage).toContain("authentication_error");
    expect(judgeCalled).toBe(false);
  });

  it("handles the agent-turn generator throwing", async () => {
    async function* throwingTurn(): AsyncGenerator<AgentStreamEvent> {
      throw new Error("network exploded");
      yield { type: "text_delta", traceId: "t1", text: "" }; // eslint-disable-line no-unreachable
    }

    const result = await runEvalCase(CASE, { agentTurn: throwingTurn, judge: fakeJudge });
    expect(result.errored).toBe(true);
    expect(result.errorMessage).toContain("network exploded");
  });

  it("extracts row_ids embedded in tool_result summaries even without an explicit citation event", async () => {
    const events: AgentStreamEvent[] = [
      { type: "tool_call", traceId: "t1", toolCallId: "tc1", name: "search_context", input: {} },
      {
        type: "tool_result",
        traceId: "t1",
        toolCallId: "tc1",
        name: "search_context",
        isError: false,
        summary: '[{"row_id":"plaid_abc","text":"Starbucks"}]',
        durationMs: 10,
      },
      { type: "text_delta", traceId: "t1", text: "Found it." },
      {
        type: "done",
        traceId: "t1",
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, estimatedCostUsd: 0 },
        totalDurationMs: 50, iterations: 1, repaired: false,
      },
    ];

    const result = await runEvalCase(CASE, { agentTurn: () => fakeTurn(events), judge: fakeJudge });
    expect(result.recallScore).toBe(1);
  });
});

describe("runEvalSuite (offline)", () => {
  it("runs multiple cases concurrently and returns results in input order", async () => {
    const cases: GoldenCase[] = [
      { ...CASE, id: "c1" },
      { ...CASE, id: "c2" },
      { ...CASE, id: "c3" },
    ];

    const doneEvent: AgentStreamEvent = {
      type: "done",
      traceId: "t1",
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, estimatedCostUsd: 0 },
      totalDurationMs: 10,
      iterations: 1,
      repaired: false,
    };

    const results = await runEvalSuite(cases, {
      concurrency: 2,
      agentTurn: () => fakeTurn([doneEvent]),
      judge: fakeJudge,
    });

    expect(results.map((r) => r.id)).toEqual(["c1", "c2", "c3"]);
    expect(results.every((r) => !r.errored)).toBe(true);
  });
});
