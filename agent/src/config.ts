import { z } from "zod";

/**
 * Fail-fast environment schema. The process refuses to boot rather than
 * running with a missing credential or a silently-wrong default — the
 * TypeScript mirror of config/settings.py on the Python side.
 */
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required to run the agent loop"),
  AGENT_MODEL: z.string().default("claude-opus-5"),

  // Path to the DuckDB warehouse file, relative to the repo root.
  DUCKDB_PATH: z.string().default("../financial_engine.db"),

  // The internal retrieval service (Python/FastAPI, vector_prep/retrieval_service.py).
  RETRIEVAL_SERVICE_URL: z.string().url().default("http://127.0.0.1:8100"),
  RETRIEVAL_SERVICE_TOKEN: z.string().min(1, "RETRIEVAL_SERVICE_TOKEN is required to call the retrieval service"),

  // Agent loop bounds.
  MAX_TOOL_ITERATIONS: z.coerce.number().int().positive().default(8),
  TASK_BUDGET_TOKENS: z.coerce.number().int().min(20000).default(64000),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

/** Pure parse — exported separately so tests can exercise validation without process.exit. */
export function parseEnv(source: NodeJS.ProcessEnv): z.SafeParseReturnType<unknown, Env> {
  return EnvSchema.safeParse(source);
}

function loadEnv(): Env {
  const result = parseEnv(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return result.data;
}

// Tests get real values from vitest.config.ts's `test.env` block, so this
// runs the same validation path as production rather than special-casing
// the test runner — a broken env schema should fail tests too.
export const env: Env = loadEnv();
