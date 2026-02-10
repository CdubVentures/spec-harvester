import { buildRunId } from '../utils/common.js';
import { callOpenAI } from './openaiClient.js';
import { normalizeCostRates } from '../billing/costRates.js';
import { appendCostLedgerEntry } from '../billing/costLedger.js';

function healthSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean' },
      provider: { type: 'string' },
      model: { type: 'string' },
      echo: { type: 'string' },
      reasoning_used: { type: 'boolean' }
    },
    required: ['ok', 'provider', 'model', 'echo', 'reasoning_used']
  };
}

function defaultUsageRow() {
  return {
    provider: '',
    model: '',
    prompt_tokens: 0,
    completion_tokens: 0,
    cached_prompt_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
    estimated_usage: false,
    retry_without_schema: false,
    deepseek_mode_detected: false,
    json_schema_requested: false
  };
}

export async function runLlmHealthCheck({
  storage,
  config,
  provider = '',
  model = '',
  logger = null
}) {
  if (!config.llmEnabled || !config.llmApiKey) {
    throw new Error('LLM is not enabled or LLM_API_KEY is missing');
  }

  const runId = buildRunId();
  const resolvedProvider = String(provider || config.llmProvider || 'openai').trim().toLowerCase();
  const resolvedModel = String(model || config.llmModelExtract || '').trim();
  const echo = `spec-health-${Date.now()}`;
  const usage = defaultUsageRow();

  const response = await callOpenAI({
    model: resolvedModel,
    system: [
      'You are validating model connectivity and JSON schema output.',
      'Return strict JSON matching schema.',
      'Do not include markdown.'
    ].join('\n'),
    user: JSON.stringify({
      echo,
      request: 'Return ok=true and mirror provider/model and whether reasoning mode was enabled.'
    }),
    jsonSchema: healthSchema(),
    apiKey: config.llmApiKey,
    baseUrl: config.llmBaseUrl,
    provider: resolvedProvider,
    usageContext: {
      category: 'health',
      productId: 'llm-health-check',
      runId,
      round: 0,
      reason: 'health',
      host: '',
      url_count: 0,
      evidence_chars: 0
    },
    costRates: normalizeCostRates(config),
    onUsage: async (usageRow) => {
      Object.assign(usage, usageRow || {});
      await appendCostLedgerEntry({
        storage,
        config,
        entry: {
          ts: new Date().toISOString(),
          provider: usageRow.provider,
          model: usageRow.model,
          category: 'health',
          productId: 'llm-health-check',
          runId,
          round: 0,
          prompt_tokens: usageRow.prompt_tokens || 0,
          completion_tokens: usageRow.completion_tokens || 0,
          cached_prompt_tokens: usageRow.cached_prompt_tokens || 0,
          total_tokens: usageRow.total_tokens || 0,
          cost_usd: usageRow.cost_usd || 0,
          reason: 'health',
          host: '',
          url_count: 0,
          evidence_chars: 0,
          estimated_usage: Boolean(usageRow.estimated_usage),
          meta: {
            retry_without_schema: Boolean(usageRow.retry_without_schema),
            deepseek_mode_detected: Boolean(usageRow.deepseek_mode_detected),
            json_schema_requested: Boolean(usageRow.json_schema_requested),
            response_format_fallback: Boolean(usageRow.retry_without_schema)
          }
        }
      });
    },
    reasoningMode: Boolean(config.llmReasoningMode),
    reasoningBudget: Number(config.llmReasoningBudget || 0),
    timeoutMs: config.llmTimeoutMs || config.openaiTimeoutMs,
    logger
  });

  const parsedOk = Boolean(response && typeof response === 'object');
  const jsonValid = parsedOk &&
    typeof response.ok === 'boolean' &&
    typeof response.provider === 'string' &&
    typeof response.model === 'string' &&
    typeof response.echo === 'string' &&
    typeof response.reasoning_used === 'boolean';

  return {
    ts: new Date().toISOString(),
    run_id: runId,
    provider_resolved: usage.provider || resolvedProvider,
    base_url: config.llmBaseUrl,
    model: usage.model || resolvedModel,
    reasoning_mode: Boolean(config.llmReasoningMode),
    reasoning_budget: Number(config.llmReasoningBudget || 0),
    json_schema_requested: Boolean(usage.json_schema_requested),
    retry_without_schema: Boolean(usage.retry_without_schema),
    deepseek_mode_detected: Boolean(usage.deepseek_mode_detected),
    prompt_tokens: Number(usage.prompt_tokens || 0),
    completion_tokens: Number(usage.completion_tokens || 0),
    total_tokens: Number(usage.total_tokens || 0),
    estimated_usage: Boolean(usage.estimated_usage),
    cost_usd: Number(usage.cost_usd || 0),
    response_ok: Boolean(response?.ok),
    response_json_valid: Boolean(jsonValid),
    response_echo: String(response?.echo || ''),
    response: response || {}
  };
}
