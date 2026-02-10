import { callOpenAI } from './openaiClient.js';

function summarySchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      markdown: { type: 'string' }
    },
    required: ['markdown']
  };
}

function validatedFieldSnapshot(normalized, provenance) {
  const fields = {};
  for (const [field, value] of Object.entries(normalized.fields || {})) {
    const text = String(value || '').trim().toLowerCase();
    if (!text || text === 'unk') {
      continue;
    }
    fields[field] = {
      value,
      confirmations: provenance?.[field]?.approved_confirmations || 0,
      evidence_count: (provenance?.[field]?.evidence || []).length
    };
  }
  return fields;
}

export async function writeSummaryMarkdownLLM({
  normalized,
  provenance,
  summary,
  config,
  logger
}) {
  if (!config.llmEnabled || !config.llmWriteSummary || !config.openaiApiKey) {
    return null;
  }

  const payload = {
    productId: normalized.productId,
    runId: normalized.runId,
    quality: normalized.quality,
    summary: {
      validated: summary.validated,
      validated_reason: summary.validated_reason,
      confidence: summary.confidence,
      completeness_required_percent: summary.completeness_required_percent,
      coverage_overall_percent: summary.coverage_overall_percent
    },
    identity: normalized.identity,
    fields: validatedFieldSnapshot(normalized, provenance)
  };

  const system = [
    'Write concise markdown summary of provided hardware evidence results.',
    'Rules:',
    '- Use only provided values.',
    '- Do not invent or infer missing facts.',
    '- Mention unknowns as unknown where relevant.',
    '- No opinions or recommendations.'
  ].join('\n');

  try {
    const result = await callOpenAI({
      model: config.openaiModelWrite,
      system,
      user: JSON.stringify(payload),
      jsonSchema: summarySchema(),
      apiKey: config.openaiApiKey,
      baseUrl: config.openaiBaseUrl,
      reasoningMode: Boolean(config.llmReasoningMode),
      reasoningBudget: Number(config.llmReasoningBudget || 0),
      timeoutMs: config.openaiTimeoutMs,
      logger
    });

    const markdown = String(result.markdown || '').trim();
    return markdown ? `${markdown}\n` : null;
  } catch (error) {
    logger?.warn?.('llm_summary_failed', { message: error.message });
    return null;
  }
}
