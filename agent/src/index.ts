import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { env } from "./config.js";
import { runAgentTurn } from "./agent-loop.js";
import { toSseFrame, type AgentStreamEvent } from "./streaming-types.js";
import { buildTraceRecord } from "./lib/trace-accumulator.js";
import { writeTraceRecord } from "./lib/trace-writer.js";
import { getMetrics, getTraceById } from "./lib/metrics.js";
import { getLatestEvalReport } from "./lib/eval-reports.js";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/api/metrics", async (c) => {
  try {
    return c.json(await getMetrics());
  } catch (e) {
    return c.json({ error: "Failed to compute metrics", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});

app.get("/api/evals/latest", (c) => {
  const report = getLatestEvalReport();
  if (!report) return c.json({ error: "No eval report yet — run `npm run eval` in agent/." }, 404);
  return c.json(report);
});

app.get("/api/traces/:id", async (c) => {
  const traceId = c.req.param("id");
  try {
    const trace = await getTraceById(traceId);
    if (!trace) return c.json({ error: "Trace not found" }, 404);
    return c.json(trace);
  } catch (e) {
    return c.json({ error: "Failed to fetch trace", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});

const ChatRequestSchema = z.object({
  message: z.string().min(1),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .default([]),
});

app.post("/api/chat", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const history: BetaMessageParam[] = parsed.data.history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  return streamSSE(c, async (stream) => {
    const events: AgentStreamEvent[] = [];
    try {
      for await (const event of runAgentTurn({ history, userMessage: parsed.data.message })) {
        events.push(event);
        await stream.write(toSseFrame(event));
        if (event.type === "done" || (event.type === "error" && event.fatal)) break;
      }
    } finally {
      // Trace persistence is best-effort: a disk/permissions failure here
      // must never take down the response the user already received.
      try {
        writeTraceRecord(buildTraceRecord(events, parsed.data.message));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("Failed to persist trace record:", e);
      }
      await stream.close();
    }
  });
});

// Only start listening when this file is run directly (`tsx src/index.ts` /
// `node dist/index.js`) — importing `app` for tests must not bind a port.
// Compares resolved filesystem paths (via fileURLToPath) rather than raw
// strings, since a naive `file://` string comparison breaks on Windows
// (backslash vs forward-slash path separators, drive-letter casing).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    // eslint-disable-next-line no-console
    console.log(`Agent service listening on http://localhost:${info.port}`);
  });
}

export { app };
