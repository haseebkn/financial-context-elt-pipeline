import type { UsageSummary } from "../streaming-types.js";

/**
 * Per-model list pricing, USD per million tokens. Keep in sync with
 * shared/models.md pricing if the model changes. Only claude-opus-5 is
 * wired up today since that's the only model this service calls.
 */
const PRICE_PER_MTOK: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-opus-5": { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheRead: 0.5 },
};

export interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export function emptyUsage(): UsageSummary {
  return { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, estimatedCostUsd: 0 };
}

export function addUsage(accumulated: UsageSummary, raw: RawUsage, model: string): UsageSummary {
  const next: UsageSummary = {
    inputTokens: accumulated.inputTokens + (raw.input_tokens ?? 0),
    outputTokens: accumulated.outputTokens + (raw.output_tokens ?? 0),
    cacheCreationInputTokens: accumulated.cacheCreationInputTokens + (raw.cache_creation_input_tokens ?? 0),
    cacheReadInputTokens: accumulated.cacheReadInputTokens + (raw.cache_read_input_tokens ?? 0),
    estimatedCostUsd: 0,
  };
  next.estimatedCostUsd = estimateCostUsd(next, model);
  return next;
}

export function estimateCostUsd(usage: Omit<UsageSummary, "estimatedCostUsd">, model: string): number {
  const price = PRICE_PER_MTOK[model];
  if (!price) return 0;
  const cost =
    (usage.inputTokens / 1_000_000) * price.input +
    (usage.outputTokens / 1_000_000) * price.output +
    (usage.cacheCreationInputTokens / 1_000_000) * price.cacheWrite +
    (usage.cacheReadInputTokens / 1_000_000) * price.cacheRead;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
