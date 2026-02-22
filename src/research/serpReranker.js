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

const IDENTITY_MATCH_BONUS = {
  strong: 2.0,
  partial: 0.8,
  weak: 0,
  none: -1.5
};

function deterministicScoreWithBreakdown(row, { identity = {}, frontier = null } = {}) {
  const url = normalizeText(row?.url);
  const text = `${row?.title || ''} ${row?.snippet || ''} ${url}`.toLowerCase();
  const brand = String(identity?.brand || '').toLowerCase();
  const model = String(identity?.model || '').toLowerCase();
  const host = normalizeHost(row?.host || '');

  let baseScore = 0;
  if (brand && text.includes(brand)) baseScore += 2.5;
  if (model && text.includes(model)) baseScore += 2.5;
  if (/spec|manual|datasheet|technical|support/.test(text)) baseScore += 1.3;
  if (/review|benchmark|latency|measure/.test(text)) baseScore += 0.9;
  if (/forum|reddit|community/.test(text)) baseScore -= 0.9;
  if (host) {
    if (host.includes(brand.replace(/\s+/g, ''))) baseScore += 1.2;
    if (host.includes('wikipedia')) baseScore -= 1;
  }

  let frontierPenalty = 0;
  if (frontier && typeof frontier.rankPenaltyForUrl === 'function') {
    frontierPenalty = Number(frontier.rankPenaltyForUrl(url) || 0);
  }

  const identityLevel = String(row?.identity_match_level || '').toLowerCase();
  const identityBonus = IDENTITY_MATCH_BONUS[identityLevel] ?? 0;

  const variantGuardPenalty = row?.variant_guard_hit ? -3.0 : 0;

  const multiModelPenalty = row?.multi_model_hint ? -1.5 : 0;

  const tierBonus = row?.tier === 1 ? 1.5 : (row?.tier === 2 ? 0.5 : 0);

  const total = baseScore + frontierPenalty + identityBonus + variantGuardPenalty + multiModelPenalty + tierBonus;

  return {
    score: total,
    breakdown: {
      base_score: baseScore,
      frontier_penalty: frontierPenalty,
      identity_bonus: identityBonus,
      variant_guard_penalty: variantGuardPenalty,
      multi_model_penalty: multiModelPenalty,
      tier_bonus: tierBonus
    }
  };
}

export async function rerankSerpResults({
  config,
  logger,
  llmContext = {},
  identity = {},
  missingFields = [],
  serpResults = [],
  frontier = null,
  topK = 16,
  domainSafetyResults = null
} = {}) {
  const safetyFiltered = domainSafetyResults
    ? toArray(serpResults).filter((row) => {
      const host = normalizeHost(row?.host || '');
      const safety = domainSafetyResults.get(host);
      return !safety || safety.safe !== false;
    })
    : toArray(serpResults);

  const scored = safetyFiltered.map((row, idx) => {
    const { score, breakdown } = deterministicScoreWithBreakdown(row, { identity, frontier });
    return {
      ...row,
      rank: Number.parseInt(String(row?.rank || idx + 1), 10) || (idx + 1),
      host: normalizeHost(row?.host || ''),
      score_det: score,
      score_breakdown: breakdown
    };
  });
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
