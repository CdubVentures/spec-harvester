function toNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 6) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

function normalizeModel(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePricingEntry(entry = {}) {
  if (!entry || typeof entry !== 'object') return null;
  const inputPer1M = toNumber(entry.inputPer1M ?? entry.input_per_1m ?? entry.input, NaN);
  const outputPer1M = toNumber(entry.outputPer1M ?? entry.output_per_1m ?? entry.output, NaN);
  const cachedInputPer1M = toNumber(
    entry.cachedInputPer1M ?? entry.cached_input_per_1m ?? entry.cached_input ?? entry.cached,
    NaN
  );
  if (!Number.isFinite(inputPer1M) && !Number.isFinite(outputPer1M) && !Number.isFinite(cachedInputPer1M)) {
    return null;
  }
  return {
    inputPer1M: Number.isFinite(inputPer1M) ? inputPer1M : 0,
    outputPer1M: Number.isFinite(outputPer1M) ? outputPer1M : 0,
    cachedInputPer1M: Number.isFinite(cachedInputPer1M) ? cachedInputPer1M : 0
  };
}

function resolveModelPricingMap(rates = {}) {
  const map = rates.llmModelPricingMap || rates.modelPricing || {};
  if (!map || typeof map !== 'object') return {};
  const output = {};
  for (const [rawModel, rawEntry] of Object.entries(map)) {
    const model = String(rawModel || '').trim();
    if (!model) continue;
    const normalizedEntry = normalizePricingEntry(rawEntry);
    if (!normalizedEntry) continue;
    output[model] = normalizedEntry;
  }
  return output;
}

function resolveModelPricingFromMap(rates = {}, model = '') {
  const token = normalizeModel(model);
  if (!token) return null;
  const map = resolveModelPricingMap(rates);
  let exact = null;
  let prefix = null;
  for (const [rawModel, rawEntry] of Object.entries(map)) {
    const modelToken = normalizeModel(rawModel);
    if (!modelToken) continue;
    if (token === modelToken) {
      exact = rawEntry;
      break;
    }
    if (token.startsWith(modelToken) || modelToken.startsWith(token)) {
      if (!prefix || modelToken.length > normalizeModel(prefix._model || '').length) {
        prefix = { ...rawEntry, _model: rawModel };
      }
    }
  }
  if (exact) return exact;
  if (prefix) {
    const { _model, ...rest } = prefix;
    return rest;
  }
  return null;
}

function resolveModelSpecificRates(rates = {}, model = '') {
  const token = normalizeModel(model);
  const output = {
    inputPer1M: toNumber(rates.llmCostInputPer1M ?? rates.inputPer1M, 1.25),
    outputPer1M: toNumber(rates.llmCostOutputPer1M ?? rates.outputPer1M, 10),
    cachedInputPer1M: toNumber(rates.llmCostCachedInputPer1M ?? rates.cachedInputPer1M, 0.125)
  };

  const applyIfValid = (value, setter) => {
    const num = toNumber(value, -1);
    if (num >= 0) {
      setter(num);
    }
  };

  const fromMap = resolveModelPricingFromMap(rates, model);
  if (fromMap) {
    output.inputPer1M = toNumber(fromMap.inputPer1M, output.inputPer1M);
    output.outputPer1M = toNumber(fromMap.outputPer1M, output.outputPer1M);
    output.cachedInputPer1M = toNumber(fromMap.cachedInputPer1M, output.cachedInputPer1M);
    return output;
  }

  if (token === 'deepseek-chat' || token.startsWith('deepseek-chat')) {
    applyIfValid(rates.llmCostInputPer1MDeepseekChat ?? rates.inputPer1MDeepseekChat, (num) => { output.inputPer1M = num; });
    applyIfValid(rates.llmCostOutputPer1MDeepseekChat ?? rates.outputPer1MDeepseekChat, (num) => { output.outputPer1M = num; });
    applyIfValid(rates.llmCostCachedInputPer1MDeepseekChat ?? rates.cachedInputPer1MDeepseekChat, (num) => { output.cachedInputPer1M = num; });
  }

  if (token === 'deepseek-reasoner' || token.startsWith('deepseek-reasoner')) {
    applyIfValid(rates.llmCostInputPer1MDeepseekReasoner ?? rates.inputPer1MDeepseekReasoner, (num) => { output.inputPer1M = num; });
    applyIfValid(rates.llmCostOutputPer1MDeepseekReasoner ?? rates.outputPer1MDeepseekReasoner, (num) => { output.outputPer1M = num; });
    applyIfValid(rates.llmCostCachedInputPer1MDeepseekReasoner ?? rates.cachedInputPer1MDeepseekReasoner, (num) => { output.cachedInputPer1M = num; });
  }

  return output;
}

export function normalizeCostRates(config = {}) {
  return {
    llmCostInputPer1M: toNumber(config.llmCostInputPer1M ?? config.inputPer1M, 1.25),
    llmCostOutputPer1M: toNumber(config.llmCostOutputPer1M ?? config.outputPer1M, 10),
    llmCostCachedInputPer1M: toNumber(config.llmCostCachedInputPer1M ?? config.cachedInputPer1M, 0.125),
    llmCostInputPer1MDeepseekChat: toNumber(config.llmCostInputPer1MDeepseekChat ?? config.inputPer1MDeepseekChat, -1),
    llmCostOutputPer1MDeepseekChat: toNumber(config.llmCostOutputPer1MDeepseekChat ?? config.outputPer1MDeepseekChat, -1),
    llmCostCachedInputPer1MDeepseekChat: toNumber(config.llmCostCachedInputPer1MDeepseekChat ?? config.cachedInputPer1MDeepseekChat, -1),
    llmCostInputPer1MDeepseekReasoner: toNumber(config.llmCostInputPer1MDeepseekReasoner ?? config.inputPer1MDeepseekReasoner, -1),
    llmCostOutputPer1MDeepseekReasoner: toNumber(config.llmCostOutputPer1MDeepseekReasoner ?? config.outputPer1MDeepseekReasoner, -1),
    llmCostCachedInputPer1MDeepseekReasoner: toNumber(config.llmCostCachedInputPer1MDeepseekReasoner ?? config.cachedInputPer1MDeepseekReasoner, -1),
    llmModelPricingMap: resolveModelPricingMap(config)
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

export function computeLlmCostUsd({ usage = {}, rates = {}, model = '' }) {
  const normalizedRates = resolveModelSpecificRates(rates, model);
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
