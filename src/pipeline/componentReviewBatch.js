// ── Component Review Batch Runner ────────────────────────────────────
//
// Reads pending_ai items from component_review.json, runs AI validation,
// and updates statuses. AI can auto-approve alias additions but new
// component rows require human confirmation.

import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso } from '../utils/common.js';
import { componentReviewPath } from '../engine/curationSuggestions.js';
import { validateComponentMatches } from '../llm/validateComponentMatches.js';
import { createBudgetGuard } from '../billing/budgetGuard.js';
import { normalizeCostRates } from '../billing/costRates.js';

function isObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function normalizeFieldKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function safeReadJson(fp) {
  try {
    return JSON.parse(await fs.readFile(fp, 'utf8'));
  } catch {
    return null;
  }
}

async function loadComponentDBs(helperRoot, category) {
  const dbDir = path.join(helperRoot, category, '_generated', 'component_db');
  const dbs = {};
  try {
    const entries = await fs.readdir(dbDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const data = await safeReadJson(path.join(dbDir, entry.name));
      if (!data?.component_type || !Array.isArray(data.items)) continue;
      const type = normalizeFieldKey(data.component_type);
      const entriesMap = {};
      for (const item of data.items) {
        if (!item.name) continue;
        entriesMap[item.name.toLowerCase()] = {
          canonical_name: item.name,
          maker: item.maker || '',
          properties: isObject(item.properties) ? item.properties : {},
          aliases: Array.isArray(item.aliases) ? item.aliases : [],
          __variance_policies: isObject(item.__variance_policies) ? item.__variance_policies : {},
          __constraints: isObject(item.__constraints) ? item.__constraints : {},
        };
      }
      dbs[type] = { entries: entriesMap };
    }
  } catch {
    // DB dir may not exist yet
  }
  return dbs;
}

export async function runComponentReviewBatch({
  config = {},
  category,
  logger,
}) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const reviewFilePath = componentReviewPath({ config, category });
  const reviewDoc = await safeReadJson(reviewFilePath);

  if (!reviewDoc || !Array.isArray(reviewDoc.items)) {
    return { processed: 0, accepted_alias: 0, pending_human: 0, rejected: 0 };
  }

  const pendingItems = reviewDoc.items.filter((item) => item.status === 'pending_ai');
  if (pendingItems.length === 0) {
    return { processed: 0, accepted_alias: 0, pending_human: 0, rejected: 0 };
  }

  // Load component DBs
  const componentDBs = await loadComponentDBs(helperRoot, category);

  // Budget guard
  const costRates = normalizeCostRates(config);
  const budgetGuard = createBudgetGuard(config);

  // Run AI validation
  const result = await validateComponentMatches({
    items: pendingItems,
    componentDBs,
    config,
    logger,
    budgetGuard,
    costRates,
  });

  if (!result.enabled || result.decisions.length === 0) {
    logger?.info?.('component_review_batch_no_decisions', {
      category,
      pending_count: pendingItems.length,
      enabled: result.enabled,
      skipped_reason: result.skipped_reason || null,
    });
    return { processed: 0, accepted_alias: 0, pending_human: 0, rejected: 0 };
  }

  // Build decision lookup
  const decisionMap = new Map();
  for (const d of result.decisions) {
    decisionMap.set(d.review_id, d);
  }

  let acceptedAlias = 0;
  let pendingHuman = 0;
  let rejected = 0;

  // Apply decisions to review items
  for (const item of reviewDoc.items) {
    if (item.status !== 'pending_ai') continue;
    const decision = decisionMap.get(item.review_id);
    if (!decision) continue;

    item.ai_decision = {
      decision: decision.decision,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
    };

    if (decision.decision === 'same_component') {
      // AI approved: write alias to _overrides
      item.status = 'accepted_alias';
      acceptedAlias += 1;

      if (item.matched_component && decision.suggested_alias) {
        try {
          await writeAliasOverride({
            helperRoot,
            category,
            componentType: item.component_type,
            componentName: item.matched_component,
            alias: decision.suggested_alias,
          });
        } catch (err) {
          logger?.warn?.('component_review_alias_write_failed', {
            review_id: item.review_id,
            error: err.message,
          });
        }
      }
    } else if (decision.decision === 'new_component') {
      // Needs human confirmation to add a new row
      item.status = 'pending_human';
      item.ai_suggested_name = decision.suggested_name || item.raw_query;
      item.ai_suggested_maker = decision.suggested_maker || '';
      pendingHuman += 1;
    } else if (decision.decision === 'reject') {
      item.status = 'rejected_ai';
      rejected += 1;
    }

    item.ai_reviewed_at = nowIso();
  }

  // Save updated review doc
  reviewDoc.updated_at = nowIso();
  await fs.mkdir(path.dirname(reviewFilePath), { recursive: true });
  await fs.writeFile(reviewFilePath, `${JSON.stringify(reviewDoc, null, 2)}\n`, 'utf8');

  const stats = {
    processed: result.decisions.length,
    accepted_alias: acceptedAlias,
    pending_human: pendingHuman,
    rejected,
  };

  logger?.info?.('component_review_batch_complete', {
    category,
    ...stats,
  });

  return stats;
}

async function writeAliasOverride({
  helperRoot,
  category,
  componentType,
  componentName,
  alias,
}) {
  const slug = String(componentName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const overrideDir = path.join(helperRoot, category, '_overrides', 'components');
  await fs.mkdir(overrideDir, { recursive: true });
  const overridePath = path.join(overrideDir, `${componentType}_${slug}.json`);

  let existing;
  try {
    existing = JSON.parse(await fs.readFile(overridePath, 'utf8'));
  } catch {
    existing = { componentType, name: componentName, properties: {} };
  }

  if (!existing.identity) existing.identity = {};
  const currentAliases = Array.isArray(existing.identity.aliases) ? existing.identity.aliases : [];
  const normalizedAlias = String(alias).trim();
  if (normalizedAlias && !currentAliases.some((a) => a.toLowerCase() === normalizedAlias.toLowerCase())) {
    currentAliases.push(normalizedAlias);
    existing.identity.aliases = currentAliases;
  }
  existing.updated_at = nowIso();

  await fs.writeFile(overridePath, JSON.stringify(existing, null, 2));
}
