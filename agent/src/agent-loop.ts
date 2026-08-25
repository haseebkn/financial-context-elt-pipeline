import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaTextBlock, BetaToolUseBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { randomUUID } from "node:crypto";
import { env } from "./config.js";
import { tools } from "./tools/index.js";
import { SYSTEM_PROMPT } from "./lib/system-prompt.js";
import { buildRequestContext } from "./lib/request-context.js";
import {
  extractRowIdsFromToolResult,
  stripUnsupportedCitations,
  validateCitations,
} from "./lib/citations.js";
import { addUsage, emptyUsage, type RawUsage } from "./lib/usage.js";
import type { AgentStreamEvent, SpanType } from "./streaming-types.js";

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const MAX_TOKENS = 4096;

function isTextBlock(block: unknown): block is BetaTextBlock {
  return (block as { type?: string })?.type === "text";
}
function isToolUseBlock(block: unknown): block is BetaToolUseBlock {
  return (block as { type?: string })?.type === "tool_use";
}

/**
 * Runs one agent turn end to end, yielding the AgentStreamEvent protocol
 * consumed by routes.ts (which frames each event as SSE) and the frontend.
 *
 * Design notes:
 * - Uses the SDK's beta tool runner (client.beta.messages.toolRunner) rather
 *   than a hand-written loop: its per-turn hooks (generateToolResponse,
 *   pushMessages) cover the approval/interception/repair needs this project
 *   has without owning the entire request/response cycle.
 * - Tool-result timing is measured as the wall-clock duration of the whole
 *   generateToolResponse() call for a turn, not per individual tool_use
 *   block. In the common case (one tool call per turn, which the system
 *   prompt's "retry once" guidance encourages) this is exact; with several
 *   parallel tool calls in one turn it's the combined batch duration,
 *   reported on each of that turn's tool_result events — documented here
 *   rather than built out further, since per-call timing would need
 *   correlating against tool_use_id inside each tool's run() closure, which
 *   betaZodTool does not expose.
 * - Citation validation runs once, after the loop's natural stop. On a
 *   violation the offending brackets are stripped mechanically — no second
 *   model call. An earlier version asked the model to rewrite the answer
 *   "removing unsupported citations"; with nothing citable in scope it
 *   rewrote correct, tool-sourced answers into false denials.
 */
export async function* runAgentTurn(params: {
  history: BetaMessageParam[];
  userMessage: string;
  traceId?: string;
  now?: Date;
}): AsyncGenerator<AgentStreamEvent> {
  const traceId = params.traceId ?? randomUUID();
  const seenRowIds = new Set<string>();
  let usage = emptyUsage();
  const toolNameById = new Map<string, string>();

  const runner = client.beta.messages.toolRunner({
    model: env.AGENT_MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      {
        type: "text",
        text: buildRequestContext(params.now ?? new Date(), env.USER_TIME_ZONE),
      },
    ],
    tools: [...tools],
    messages: [...params.history, { role: "user", content: params.userMessage }],
    max_iterations: env.MAX_TOOL_ITERATIONS,
    stream: true,
  });

  let finalText = "";
  const textSegments: string[] = [];
  let finalStopReason = "end_turn";
  let iterationCount = 0;
  const startedAt = Date.now();

  // Tracks whichever span is currently open, so the outer catch below can
  // close it (isError: true) before yielding the error event. Without this,
  // an exception thrown mid-span (e.g. an auth failure surfacing inside
  // stream.finalMessage(), or generateToolResponse() rejecting) leaves a
  // span_start with no matching span_end — a dangling span in the trace.
  // Verified this actually happens: a real 401 arrives while llm_call's
  // span is open, not before it starts.
  let openSpan: { spanId: string; spanType: SpanType; startedAt: number } | null = null;

  try {
    for await (const stream of runner) {
      iterationCount++;
      const llmSpanId = randomUUID();
      const llmSpanStart = Date.now();
      openSpan = { spanId: llmSpanId, spanType: "llm_call", startedAt: llmSpanStart };
      yield { type: "span_start", traceId, spanId: llmSpanId, spanType: "llm_call" };

      const events: AgentStreamEvent[] = [];
      stream.on("text", (delta) => events.push({ type: "text_delta", traceId, text: delta }));
      stream.on("thinking", (delta) => events.push({ type: "thinking_delta", traceId, text: delta }));

      const finalMessage = await stream.finalMessage();

      // Separate this iteration's prose from the previous one's. Without it
      // the client concatenates every segment raw, producing run-ons like
      // "…from your transaction data.Now the precise total…". The separator
      // is streamed as a delta (rather than only inserted server-side) so a
      // client accumulating text_delta events ends up with exactly the same
      // string as finalText below.
      if (textSegments.length > 0 && events.some((ev) => ev.type === "text_delta")) {
        yield { type: "text_delta", traceId, text: "\n\n" };
      }
      for (const ev of events) yield ev;

      const turnUsage = finalMessage.usage as RawUsage;
      usage = addUsage(usage, turnUsage, env.AGENT_MODEL);
      finalStopReason = finalMessage.stop_reason ?? "end_turn";

      yield {
        type: "span_end",
        traceId,
        spanId: llmSpanId,
        spanType: "llm_call",
        durationMs: Date.now() - llmSpanStart,
        isError: false,
        usage: {
          inputTokens: turnUsage.input_tokens ?? 0,
          outputTokens: turnUsage.output_tokens ?? 0,
          cacheCreationInputTokens: turnUsage.cache_creation_input_tokens ?? 0,
          cacheReadInputTokens: turnUsage.cache_read_input_tokens ?? 0,
        },
      };
      openSpan = null;

      const toolUseBlocks = finalMessage.content.filter(isToolUseBlock);
      for (const block of toolUseBlocks) {
        toolNameById.set(block.id, block.name);
        yield { type: "tool_call", traceId, toolCallId: block.id, name: block.name, input: block.input };
      }

      if (toolUseBlocks.length > 0) {
        const toolSpanId = randomUUID();
        const toolLabel = toolUseBlocks.map((b) => b.name).join("+");
        openSpan = { spanId: toolSpanId, spanType: "tool_exec", startedAt: Date.now() };
        yield { type: "span_start", traceId, spanId: toolSpanId, spanType: "tool_exec", label: toolLabel };

        const batchStart = Date.now();
        const toolResponse = await runner.generateToolResponse();
        const durationMs = Date.now() - batchStart;

        let batchHadError = false;

        if (toolResponse) {
          const resultBlocks = Array.isArray(toolResponse.content) ? toolResponse.content : [];
          for (const rb of resultBlocks) {
            const block = rb as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
            if (block.type !== "tool_result") continue;
            const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
            for (const rowId of extractRowIdsFromToolResult(text)) seenRowIds.add(rowId);
            if (block.is_error) batchHadError = true;

            yield {
              type: "tool_result",
              traceId,
              toolCallId: block.tool_use_id ?? "unknown",
              name: toolNameById.get(block.tool_use_id ?? "") ?? "unknown",
              isError: Boolean(block.is_error),
              summary: text.length > 300 ? `${text.slice(0, 300)}…` : text,
              durationMs,
            };
          }
        }

        yield {
          type: "span_end",
          traceId,
          spanId: toolSpanId,
          spanType: "tool_exec",
          durationMs,
          isError: batchHadError,
        };
        openSpan = null;
      }

      // Accumulate rather than overwrite. finalText used to hold only the
      // last iteration's text, so it disagreed with the text the client had
      // actually accumulated — citation validation saw only the final
      // segment, and a text_correction replaced the user's whole message
      // with just that segment, silently dropping earlier prose.
      const textBlocks = finalMessage.content.filter(isTextBlock);
      if (textBlocks.length > 0) {
        textSegments.push(textBlocks.map((b) => b.text).join("\n"));
        finalText = textSegments.join("\n\n");
      }

      // Soft token budget: a manual accumulated-usage check, not the SDK's
      // beta task_budget request parameter — this SDK version (0.68.0) does
      // not expose it in its TypeScript types, and forcing it through with
      // an unverified @ts-expect-error against a beta header felt riskier
      // than a simple client-side accounting check with the same effect
      // (bounded resource usage per turn). Only breaks when the loop would
      // otherwise continue (a tool call is pending) — a turn that finished
      // naturally never gets cut off by this.
      if (toolUseBlocks.length > 0 && usage.inputTokens + usage.outputTokens >= env.TASK_BUDGET_TOKENS) {
        finalStopReason = "task_budget_reached";
        if (!finalText.trim()) {
          finalText = "I've used my working budget for this turn before finishing. Ask again to continue.";
        }
        break;
      }
    }
  } catch (e) {
    if (openSpan) {
      yield {
        type: "span_end",
        traceId,
        spanId: openSpan.spanId,
        spanType: openSpan.spanType,
        durationMs: Date.now() - openSpan.startedAt,
        isError: true,
      };
    }
    yield {
      type: "error",
      traceId,
      message: e instanceof Error ? e.message : String(e),
      fatal: true,
    };
    return;
  }

  // Citation validation — single repair pass, not a second agentic turn.
  // IMPORTANT: the original (unrepaired) text was already streamed live to
  // the caller as text_delta events above, before validation could run —
  // that's the cost of streaming immediately rather than buffering the
  // whole answer. If repair changes the text, a text_correction event tells
  // the caller to replace what it already rendered, rather than silently
  // disagreeing with what the user already saw.
  const validation = validateCitations(finalText, seenRowIds);
  let repaired = false;
  if (!validation.valid) {
    const citationSpanId = randomUUID();
    const citationSpanStart = Date.now();
    yield { type: "span_start", traceId, spanId: citationSpanId, spanType: "citation_validation" };

    // Deterministic, subtractive repair — no second model call. See
    // stripUnsupportedCitations() for why the previous LLM rewrite was
    // removed: asked to "remove unsupported citations" with an empty allowed
    // list, it rewrote correct answers into false denials.
    const strippedText = stripUnsupportedCitations(finalText, seenRowIds);
    if (strippedText.trim() && strippedText !== finalText) {
      finalText = strippedText;
      repaired = true;
      yield {
        type: "text_correction",
        traceId,
        text: finalText,
        reason: `Removed unsupported citation(s): ${validation.unsupportedIds.join(", ")}`,
      };
    }

    yield {
      type: "span_end",
      traceId,
      spanId: citationSpanId,
      spanType: "citation_validation",
      durationMs: Date.now() - citationSpanStart,
      isError: !repaired,
    };
  }

  // Only emit citations actually backed by a row seen this turn. This
  // previously iterated every cited id, so an unsupported one surviving
  // repair still reached the UI as a source chip.
  for (const rowId of validateCitations(finalText, seenRowIds).citedIds) {
    if (!seenRowIds.has(rowId)) continue;
    const [source] = rowId.split("_");
    yield { type: "citation", traceId, rowId, source: source ?? "unknown" };
  }

  yield {
    type: "done",
    traceId,
    stopReason: finalStopReason,
    usage,
    totalDurationMs: Date.now() - startedAt,
    iterations: iterationCount,
    repaired,
  };
}
