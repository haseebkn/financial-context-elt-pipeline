import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { app } from "./index.js";

describe("HTTP routes", () => {
  it("GET /health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("POST /api/chat rejects a body with no message", async () => {
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid request");
  });

  it("POST /api/chat rejects malformed JSON", async () => {
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/chat rejects a history entry with an invalid role", async () => {
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "hi",
        history: [{ role: "system", content: "not allowed" }],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/chat with a valid body streams SSE and returns 200", async () => {
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "What is my balance?" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
  });

  it("persists a trace record once the SSE stream is fully consumed", async () => {
    rmSync("./.test-raw-data/agent_traces", { recursive: true, force: true });

    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "What is my balance?" }),
    });
    // Draining the body is what triggers streamSSE's callback (and its
    // `finally` block, where the trace gets written) to actually run to
    // completion — a test that only checks status/headers without reading
    // the body never observes this side effect.
    await res.text();

    const tracesRoot = "./.test-raw-data/agent_traces";
    expect(existsSync(tracesRoot)).toBe(true);
    const [dateDir] = readdirSync(tracesRoot);
    expect(dateDir).toBeTruthy();
    const files = readdirSync(`${tracesRoot}/${dateDir}`);
    expect(files.length).toBeGreaterThan(0);

    const record = JSON.parse(readFileSync(`${tracesRoot}/${dateDir}/${files[0]}`, "utf-8"));
    expect(record.metadata.source).toBe("agent");
    expect(record.raw_payload.question).toBe("What is my balance?");
    expect(record.raw_payload.errored).toBe(true); // no real API key in this environment
  });

  it("GET /api/metrics returns a well-shaped aggregate against the real warehouse", async () => {
    const res = await app.request("/api/metrics");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { turns: number; toolCallDistribution: unknown[]; turnsPerDay: unknown[] };
    expect(body.turns).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(body.toolCallDistribution)).toBe(true);
    expect(Array.isArray(body.turnsPerDay)).toBe(true);
  });

  it("GET /api/traces/:id returns 404 for an unknown trace", async () => {
    const res = await app.request("/api/traces/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("GET /api/evals/latest returns 404 with a helpful message when no report exists", async () => {
    const res = await app.request("/api/evals/latest");
    // This repo's evals/reports/ is intentionally kept empty in source
    // control (.gitkeep only — see evals/README.md), so 404 is the expected
    // state unless a real eval run happened to leave a report on disk.
    if (res.status === 404) {
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("npm run eval");
    } else {
      expect(res.status).toBe(200);
    }
  });
});
