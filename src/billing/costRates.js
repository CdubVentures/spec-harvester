function toNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 6) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

export function normalizeCostRates(config = {}) {
  return {
    inputPer1M: toNumber(config.llmCostInputPer1M, 0.28),
    outputPer1M: toNumber(config.llmCostOutputPer1M, 0.42),
    cachedInputPer1M: toNumber(config.llmCostCachedInputPer1M, 0)
  };
}

export function estimateTokensFromText(value) {
  const text = String(value || '');
  if (!text) {
    return 0;
  }
  // Conservative estimate for mixed JSON/text payloads.
  return Math.max(1, Math.ceil(text.length / 3.8));
}

export function normalizeUsage(usage = {}, fallback = {}) {
  const promptTokens = Math.max(
    0,
    Number.parseInt(
      String(
        usage.prompt_tokens ??
        usage.input_tokens ??
        fallback.promptTokens ??
        0
      ),
      10
    ) || 0
  );
  const completionTokens = Math.max(
    0,
    Number.parseInt(
      String(
        usage.completion_tokens ??
        usage.output_tokens ??
        fallback.completionTokens ??
        0
      ),
      10
    ) || 0
  );
  const cachedPromptTokens = Math.max(
    0,
    Number.parseInt(
      String(
        usage.cached_prompt_tokens ??
        usage.cached_input_tokens ??
        fallback.cachedPromptTokens ??
        0
      ),
      10
    ) || 0
  );

  const totalTokens = Math.max(
    promptTokens + completionTokens,
    Number.parseInt(
      String(usage.total_tokens ?? usage.totalTokens ?? fallback.totalTokens ?? 0),
      10
    ) || 0
  );

  return {
    promptTokens,
    completionTokens,
    cachedPromptTokens,
    totalTokens,
    estimated: Boolean(fallback.estimated)
  };
}

export function computeLlmCostUsd({ usage = {}, rates = {} }) {
  const normalizedRates = normalizeCostRates(rates);
  const inputTokens = Math.max(0, usage.promptTokens || 0);
  const outputTokens = Math.max(0, usage.completionTokens || 0);
  const cachedInputTokens = Math.max(0, usage.cachedPromptTokens || 0);
  const billableInputTokens = Math.max(0, inputTokens - cachedInputTokens);

  const inputCost = (billableInputTokens / 1_000_000) * normalizedRates.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * normalizedRates.outputPer1M;
  const cachedInputCost = (cachedInputTokens / 1_000_000) * normalizedRates.cachedInputPer1M;
  const totalCostUsd = inputCost + outputCost + cachedInputCost;

  return {
    costUsd: round(totalCostUsd, 8),
    components: {
      inputCost: round(inputCost, 8),
      outputCost: round(outputCost, 8),
      cachedInputCost: round(cachedInputCost, 8)
    }
  };
}
