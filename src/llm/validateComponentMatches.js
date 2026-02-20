// ── Component Match Validation via LLM ──────────────────────────────
//
// Examines flagged component review items and decides:
// - SAME_COMPONENT: raw query refers to existing component → add as alias
// - NEW_COMPONENT: genuinely different → flag for human approval
// - REJECT: bad data, extraction error, insufficient evidence

import { callLlmWithRouting, hasLlmRouteApiKey } from './routing.js';

function responseSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            review_id: { type: 'string' },
            decision: { type: 'string', enum: ['same_component', 'new_component', 'reject'] },
            confidence: { type: 'number' },
            reasoning: { type: 'string' },
            suggested_alias: { type: 'string' },
            suggested_name: { type: 'string' },
            suggested_maker: { type: 'string' },
          },
          required: ['review_id', 'decision', 'confidence', 'reasoning'],
        },
      },
    },
    required: ['decisions'],
  };
}

function buildSystemPrompt(reasoningNote) {
  return `You validate component identity matches for hardware databases.

Given a raw query string extracted from a product specification, the candidate component's properties, and the product's extracted attributes, decide for each item:

- **same_component**: The raw query refers to the existing candidate component. It's a variant name, typo, or alias. Suggest the alias to add.
- **new_component**: This is genuinely a different component not in the database. Suggest a canonical name and maker.
- **reject**: Bad data, extraction error, or insufficient evidence to make a determination.

Guidelines:
- Compare properties carefully (DPI, IPS, acceleration, etc.). If properties match the candidate, it's likely the same component.
- Sensor/switch variants often differ by 1 digit but have genuinely different properties. Don't merge if properties differ.
- String similarity alone is insufficient — always check property alignment.
- Pay attention to variance_policies on each property:
  - "upper_bound": The component DB value is the maximum. Product values at or below are expected and valid.
  - "lower_bound": The component DB value is the minimum. Product values at or above are expected and valid.
  - "range": Values may vary within ~10% tolerance.
  - "authoritative": Values should match exactly.
- Pay attention to constraints (e.g., "sensor_date <= release_date") — these are cross-field validation rules.
- When in doubt, prefer "new_component" over "same_component" (false negatives are less harmful than false positives).
${reasoningNote ? `\nDomain-specific guidance:\n${reasoningNote}` : ''}

Respond with a JSON object containing a "decisions" array.`;
}

function buildUserPayload(items) {
  return JSON.stringify({
    items: items.map((item) => ({
      review_id: item.review_id,
      raw_query: item.raw_query,
      component_type: item.component_type,
      candidate_component: item.matched_component
        ? {
          name: item.matched_component,
          properties: item.candidate_properties || {},
          variance_policies: item.candidate_variance_policies || {},
          constraints: item.candidate_constraints || {},
        }
        : null,
      product_attributes: item.product_attributes || {},
      name_similarity: item.name_score,
      property_match_rate: item.property_score,
      alternatives: (item.alternatives || []).slice(0, 3).map((a) => ({
        name: a.canonical_name,
        score: a.score,
      })),
      match_type: item.match_type,
    })),
  }, null, 2);
}

function sanitizeDecisions(raw, itemIndex) {
  const decisions = [];
  for (const row of raw?.decisions || []) {
    const reviewId = String(row.review_id || '').trim();
    if (!reviewId || !itemIndex.has(reviewId)) continue;
    const decision = String(row.decision || '').trim().toLowerCase();
    if (!['same_component', 'new_component', 'reject'].includes(decision)) continue;
    decisions.push({
      review_id: reviewId,
      decision,
      confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)),
      reasoning: String(row.reasoning || '').trim(),
      suggested_alias: String(row.suggested_alias || '').trim() || undefined,
      suggested_name: String(row.suggested_name || '').trim() || undefined,
      suggested_maker: String(row.suggested_maker || '').trim() || undefined,
    });
  }
  return decisions;
}

export async function validateComponentMatches({
  items = [],
  componentDBs = {},
  config = {},
  logger,
  budgetGuard,
  costRates,
}) {
  const enabled = Boolean(config.llmEnabled && hasLlmRouteApiKey(config, { role: 'validate' }));
  if (!enabled || items.length === 0) {
    return { enabled: false, decisions: [] };
  }

  // Budget check
  if (budgetGuard) {
    const budgetDecision = budgetGuard.canCall({
      reason: 'validate_component_matches',
      essential: false,
    });
    if (!budgetDecision.allowed) {
      budgetGuard.block?.(budgetDecision.reason);
      logger?.warn?.('component_validate_skipped_budget', {
        reason: budgetDecision.reason,
        item_count: items.length,
      });
      return { enabled: true, decisions: [], skipped_reason: 'budget' };
    }
  }

  // Enrich items with component DB properties, variance policies, and constraints
  const enrichedItems = items.map((item) => {
    const db = componentDBs[item.component_type];
    let candidateProperties = {};
    let candidateVariancePolicies = {};
    let candidateConstraints = {};
    if (db && item.matched_component) {
      const entries = Object.values(db.entries || {});
      const match = entries.find((e) =>
        e.canonical_name?.toLowerCase() === item.matched_component?.toLowerCase()
      );
      if (match) {
        if (match.properties) candidateProperties = match.properties;
        if (match.__variance_policies) candidateVariancePolicies = match.__variance_policies;
        if (match.__constraints) candidateConstraints = match.__constraints;
      }
    }
    return {
      ...item,
      candidate_properties: candidateProperties,
      candidate_variance_policies: candidateVariancePolicies,
      candidate_constraints: candidateConstraints,
    };
  });

  // Group by component type for efficient batching
  const byType = new Map();
  for (const item of enrichedItems) {
    const type = item.component_type || 'unknown';
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(item);
  }

  const allDecisions = [];

  for (const [componentType, typeItems] of byType) {
    // Get reasoning note from the first item's rule if available
    const reasoningNote = typeItems[0]?.reasoning_note || '';

    const itemIndex = new Map();
    for (const item of typeItems) {
      itemIndex.set(item.review_id, item);
    }

    try {
      const result = await callLlmWithRouting({
        config,
        reason: 'validate_component_matches',
        role: 'validate',
        system: buildSystemPrompt(reasoningNote),
        user: buildUserPayload(typeItems),
        jsonSchema: responseSchema(),
        usageContext: {
          reason: 'validate_component_matches',
          component_type: componentType,
          item_count: typeItems.length,
        },
        costRates,
        reasoningMode: true,
        reasoningBudget: 4096,
        maxTokens: 4096,
        timeoutMs: 60_000,
        logger,
      });

      const parsed = typeof result?.parsed === 'object' ? result.parsed : {};
      const decisions = sanitizeDecisions(parsed, itemIndex);
      allDecisions.push(...decisions);

      logger?.info?.('component_validate_batch_complete', {
        component_type: componentType,
        items_sent: typeItems.length,
        decisions_returned: decisions.length,
      });
    } catch (error) {
      logger?.warn?.('component_validate_batch_failed', {
        component_type: componentType,
        items_sent: typeItems.length,
        error: error.message,
      });
    }
  }

  return {
    enabled: true,
    decisions: allDecisions,
  };
}
