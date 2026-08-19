import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Real-shaped values for the whole test run so src/config.ts's fail-fast
    // validation runs the same path as production instead of being bypassed.
    // ANTHROPIC_API_KEY is a placeholder — no test in this suite makes a
    // live API call (the agent loop's live-call tests are skipped without
    // a real key; see agent-loop.test.ts).
    env: {
      ANTHROPIC_API_KEY: "sk-ant-test-placeholder-not-a-real-key",
      DUCKDB_PATH: "../financial_engine.db",
      RETRIEVAL_SERVICE_URL: "http://127.0.0.1:8100",
      RETRIEVAL_SERVICE_TOKEN: "test-internal-token",
      // Redirects trace-writer.ts's default landing-zone path so route
      // tests (index.test.ts) never write into the real raw_data/ tree.
      RAW_DATA_ROOT: "./.test-raw-data",
    },
  },
});
