import { callLlmWithRouting, hasLlmRouteApiKey } from '../llm/routing.js';

function normalizeHost(value) {
  return String(value || '').toLowerCase().replace(/^www\./, '');
}

function normalizeText(value) {
  return String(value || '').trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function rerankSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      selected_urls: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            url: { type: 'string' },
            keep: { type: 'boolean' },
            reason: { type: 'string' },
            score: { type: 'number' }
          },
          required: ['url', 'keep']
        }
      }
    },
    required: ['selected_urls']
  };
}

function deterministicScore(row, { identity = {}, frontier = null } = {}) {
  const url = normalizeText(row?.url);
  const text = `${row?.title || ''} ${row?.snippet || ''} ${url}`.toLowerCase();
  const brand = String(identity?.brand || '').toLowerCase();
  const model = String(identity?.model || '').toLowerCase();
  const host = normalizeHost(row?.host || '');

  let score = 0;
  if (brand && text.includes(brand)) score += 2.5;
  if (model && text.includes(model)) score += 2.5;
  if (/spec|manual|datasheet|technical|support/.test(text)) score += 1.3;
  if (/review|benchmark|latency|measure/.test(text)) score += 0.9;
  if (/forum|reddit|community/.test(text)) score -= 0.9;
  if (host) {
    if (host.includes(brand.replace(/\s+/g, ''))) score += 1.2;
    if (host.includes('wikipedia')) score -= 1;
  }
  if (frontier && typeof frontier.rankPenaltyForUrl === 'function') {
    score += Number(frontier.rankPenaltyForUrl(url) || 0);
  }
  return score;
}

export async function rerankSerpResults({
  config,
  logger,
  llmContext = {},
  identity = {},
  missingFields = [],
  serpResults = [],
  frontier = null,
  topK = 16
} = {}) {
  const scored = toArray(serpResults).map((row, idx) => ({
    ...row,
    rank: Number.parseInt(String(row?.rank || idx + 1), 10) || (idx + 1),
    host: normalizeHost(row?.host || ''),
    score_det: deterministicScore(row, { identity, frontier })
  }));
  const deterministic = scored
    .sort((a, b) => b.score_det - a.score_det || a.rank - b.rank)
    .slice(0, Math.max(1, topK));

  if (!config?.llmEnabled || !hasLlmRouteApiKey(config, { role: 'plan' })) {
    return deterministic.map((row) => ({
      ...row,
      keep: true,
      rerank_score: row.score_det,
      rerank_reason: 'deterministic'
    }));
  }

  const payload = {
    identity_lock: {
      brand: String(identity.brand || ''),
      model: String(identity.model || ''),
      variant: String(identity.variant || '')
    },
    missing_fields: toArray(missingFields).slice(0, 40),
    results: deterministic.map((row) => ({
      rank: row.rank,
      url: row.url,
      host: row.host,
      title: normalizeText(row.title).slice(0, 240),
      snippet: normalizeText(row.snippet).slice(0, 320),
      score_det: Number.parseFloat((row.score_det || 0).toFixed(4))
    }))
  };

  try {
    const result = await callLlmWithRouting({
      config,
      reason: 'uber_serp_reranker',
      role: 'plan',
      modelOverride: String(
        config.llmModelTriage ||
        config.cortexModelRerankFast ||
        config.cortexModelSearchFast ||
        config.llmModelFast ||
        ''
      ).trim(),
      system: [
        'You rerank search results for evidence-first hardware spec extraction.',
        'Return strict JSON only.',
        'Keep URLs with strong identity match and likely field relevance.',
        'Drop low-value, duplicate, or dead-pattern URLs.'
      ].join('\n'),
      user: JSON.stringify(payload),
      jsonSchema: rerankSchema(),
      usageContext: {
        category: llmContext.category || '',
        productId: llmContext.productId || '',
        runId: llmContext.runId || '',
        round: llmContext.round || 0,
        reason: 'uber_serp_reranker',
        host: '',
        url_count: deterministic.length,
        evidence_chars: JSON.stringify(payload).length,
        trace_context: {
          purpose: 'serp_rerank',
          target_fields: toArray(missingFields).slice(0, 40)
        }
      },
      costRates: llmContext.costRates || config,
      onUsage: async (usageRow) => {
        if (typeof llmContext.recordUsage === 'function') {
          await llmContext.recordUsage(usageRow);
        }
      },
      reasoningMode: false,
      timeoutMs: config.llmTimeoutMs || config.openaiTimeoutMs,
      logger
    });
    const pickedByUrl = new Map();
    for (const row of result?.selected_urls || []) {
      const url = normalizeText(row?.url);
      if (!url) {
        continue;
      }
      pickedByUrl.set(url, {
        keep: Boolean(row?.keep),
        reason: String(row?.reason || ''),
        score: Number.parseFloat(String(row?.score || '0')) || 0
      });
    }
    const merged = deterministic
      .map((row) => {
        const picked = pickedByUrl.get(row.url) || null;
        return {
          ...row,
          keep: picked ? picked.keep : true,
          rerank_score: picked ? picked.score : row.score_det,
          rerank_reason: picked?.reason || 'llm_default_keep'
        };
      })
      .filter((row) => row.keep)
      .sort((a, b) => b.rerank_score - a.rerank_score || a.rank - b.rank)
      .slice(0, Math.max(1, topK));
    if (!merged.length) {
      return deterministic.slice(0, Math.max(1, topK)).map((row) => ({
        ...row,
        keep: true,
        rerank_score: row.score_det,
        rerank_reason: 'llm_empty_fallback'
      }));
    }
    return merged;
  } catch (error) {
    logger?.warn?.('uber_serp_reranker_failed', {
      message: error.message
    });
    return deterministic.map((row) => ({
      ...row,
      keep: true,
      rerank_score: row.score_det,
      rerank_reason: 'deterministic_fallback'
    }));
  }
}
