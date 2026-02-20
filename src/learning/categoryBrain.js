import { toPosixKey } from '../s3/storage.js';
import { nowIso } from '../utils/common.js';
import { promotionSuggestionsKey } from '../intel/sourceIntel.js';
import { defaultFieldLexicon, updateFieldLexicon } from './fieldLexicon.js';
import { defaultFieldConstraints, updateFieldConstraints } from './fieldConstraints.js';
import { defaultFieldYield, updateFieldYield } from './fieldYield.js';
import { defaultIdentityGrammar, updateIdentityGrammar } from './identityGrammar.js';
import { defaultQueryLearning, updateQueryLearning } from './queryLearning.js';
import {
  defaultFieldAvailability,
  summarizeAvailability,
  updateFieldAvailability
} from './fieldAvailability.js';

function round(value, digits = 6) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

function artifactKey(storage, category, filename) {
  return storage.resolveOutputKey('_learning', category, filename);
}

function defaultStats(category) {
  return {
    category,
    updated_at: nowIso(),
    runs_total: 0,
    validated_runs: 0,
    validation_rate: 0,
    average_confidence: 0,
    average_completeness_required: 0,
    last_run: null
  };
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

async function readArtifact(storage, category, filename, fallbackFactory) {
  const key = artifactKey(storage, category, filename);
  const existing = await storage.readJsonOrNull(key);
  return {
    key,
    value: existing || fallbackFactory()
  };
}

async function writeArtifact(storage, key, value) {
  await storage.writeObject(
    key,
    Buffer.from(JSON.stringify(value, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  return key;
}

function normalizeSourcesOverride(input = {}) {
  return {
    approved: {
      manufacturer: [...new Set(toArray(input.approved?.manufacturer).map((v) => String(v).toLowerCase()))],
      lab: [...new Set(toArray(input.approved?.lab).map((v) => String(v).toLowerCase()))],
      database: [...new Set(toArray(input.approved?.database).map((v) => String(v).toLowerCase()))],
      retailer: [...new Set(toArray(input.approved?.retailer).map((v) => String(v).toLowerCase()))],
      quarantine: [...new Set(toArray(input.approved?.quarantine).map((v) => String(v).toLowerCase()))]
    },
    denylist: [...new Set(toArray(input.denylist).map((v) => String(v).toLowerCase()))]
  };
}

async function autoPromoteSources({
  storage,
  config,
  category,
  summary
}) {
  const suggestionKey =
    summary?.source_intel?.promotion_suggestions_key ||
    promotionSuggestionsKey(config, category);
  const suggestions = await storage.readJsonOrNull(suggestionKey);
  if (!suggestions?.suggestions?.length) {
    return {
      override_key: null,
      promoted_domains: [],
      suggestion_key: suggestionKey
    };
  }

  const overrideKey = toPosixKey(
    config.s3InputPrefix,
    '_sources',
    'overrides',
    category,
    'sources.override.json'
  );
  const currentOverride = normalizeSourcesOverride(await storage.readJsonOrNull(overrideKey) || {});
  const existingApproved = new Set([
    ...currentOverride.approved.manufacturer,
    ...currentOverride.approved.lab,
    ...currentOverride.approved.database,
    ...currentOverride.approved.retailer,
    ...currentOverride.approved.quarantine
  ]);
  const denylist = new Set(currentOverride.denylist);

  const promoted = [];
  for (const row of suggestions.suggestions.slice(0, 40)) {
    const domain = String(row.rootDomain || '').toLowerCase().trim();
    if (!domain || existingApproved.has(domain) || denylist.has(domain)) {
      continue;
    }
    currentOverride.approved.quarantine.push(domain);
    existingApproved.add(domain);
    promoted.push({
      rootDomain: domain,
      planner_score: row.planner_score || 0,
      products_seen: row.products_seen || 0,
      promoted_at: nowIso()
    });
  }

  if (promoted.length > 0) {
    currentOverride.approved.quarantine = [...new Set(currentOverride.approved.quarantine)].sort();
    await storage.writeObject(
      overrideKey,
      Buffer.from(JSON.stringify(currentOverride, null, 2), 'utf8'),
      { contentType: 'application/json' }
    );
  }

  return {
    override_key: promoted.length > 0 ? overrideKey : null,
    promoted_domains: promoted,
    suggestion_key: suggestionKey
  };
}

function updateStats(stats, summary, runId) {
  const next = {
    ...stats,
    runs_total: (stats.runs_total || 0) + 1,
    validated_runs: (stats.validated_runs || 0) + (summary?.validated ? 1 : 0),
    updated_at: nowIso()
  };

  next.validation_rate = round(
    next.validated_runs / Math.max(1, next.runs_total),
    6
  );
  const prevConfidence = Number.parseFloat(String(stats.average_confidence || 0)) || 0;
  const prevCompleteness = Number.parseFloat(String(stats.average_completeness_required || 0)) || 0;
  const confidence = Number.parseFloat(String(summary?.confidence || 0)) || 0;
  const completeness = Number.parseFloat(String(summary?.completeness_required || 0)) || 0;

  next.average_confidence = round(
    ((prevConfidence * (next.runs_total - 1)) + confidence) / Math.max(1, next.runs_total),
    6
  );
  next.average_completeness_required = round(
    ((prevCompleteness * (next.runs_total - 1)) + completeness) / Math.max(1, next.runs_total),
    6
  );
  next.last_run = {
    runId,
    validated: Boolean(summary?.validated),
    confidence,
    completeness_required: completeness,
    missing_required_count: toArray(summary?.missing_required_fields).length,
    critical_missing_count: toArray(summary?.critical_fields_below_pass_target).length,
    contradiction_count: Number.parseInt(String(summary?.constraint_analysis?.contradiction_count || 0), 10) || 0,
    generated_at: summary?.generated_at || nowIso()
  };
  return next;
}

function buildTopYieldRows(fieldYield, limit = 20) {
  return Object.entries(fieldYield?.by_domain || {})
    .map(([domain, row]) => ({
      domain,
      attempts: row.attempts || 0,
      top_fields: Object.entries(row.fields || {})
        .sort((a, b) => (b[1].yield || 0) - (a[1].yield || 0))
        .slice(0, 8)
        .map(([field, item]) => ({
          field,
          yield: item.yield || 0,
          seen: item.seen || 0,
          accepted: item.accepted || 0
        }))
    }))
    .sort((a, b) => (b.top_fields[0]?.yield || 0) - (a.top_fields[0]?.yield || 0))
    .slice(0, limit);
}

export async function loadCategoryBrain({
  storage,
  category,
  specDb = null,
  config = {}
}) {
  const fallbackFactories = {
    field_lexicon: defaultFieldLexicon,
    constraints: defaultFieldConstraints,
    field_yield: defaultFieldYield,
    identity_grammar: defaultIdentityGrammar,
    query_templates: defaultQueryLearning,
    source_promotions: () => ({ version: 1, updated_at: nowIso(), history: [] }),
    stats: () => defaultStats(category),
    field_availability: defaultFieldAvailability
  };

  /* --- SQLite primary path --- */
  if (specDb) {
    const dbArtifacts = specDb.getCategoryBrainArtifacts(category);
    const hasResults = dbArtifacts && Object.keys(dbArtifacts).length > 0;

    if (hasResults) {
      const resolve = (name) => {
        const value = dbArtifacts[name] || fallbackFactories[name]();
        const key = artifactKey(storage, category, `${name}.json`);
        return { key, value };
      };

      return {
        category,
        artifacts: {
          lexicon:          resolve('field_lexicon'),
          constraints:      resolve('constraints'),
          fieldYield:       resolve('field_yield'),
          identityGrammar:  resolve('identity_grammar'),
          queryTemplates:   resolve('query_templates'),
          sourcePromotions: resolve('source_promotions'),
          stats:            resolve('stats'),
          fieldAvailability: resolve('field_availability')
        }
      };
    }
  }

  /* --- JSON / storage fallback path --- */
  const [lexicon, constraints, fieldYield, identityGrammar, queryTemplates, sourcePromotions, stats, fieldAvailability] = await Promise.all([
    readArtifact(storage, category, 'field_lexicon.json', fallbackFactories.field_lexicon),
    readArtifact(storage, category, 'constraints.json', fallbackFactories.constraints),
    readArtifact(storage, category, 'field_yield.json', fallbackFactories.field_yield),
    readArtifact(storage, category, 'identity_grammar.json', fallbackFactories.identity_grammar),
    readArtifact(storage, category, 'query_templates.json', fallbackFactories.query_templates),
    readArtifact(storage, category, 'source_promotions.json', fallbackFactories.source_promotions),
    readArtifact(storage, category, 'stats.json', fallbackFactories.stats),
    readArtifact(storage, category, 'field_availability.json', fallbackFactories.field_availability)
  ]);

  return {
    category,
    artifacts: {
      lexicon,
      constraints,
      fieldYield,
      identityGrammar,
      queryTemplates,
      sourcePromotions,
      stats,
      fieldAvailability
    }
  };
}

export async function updateCategoryBrain({
  storage,
  config,
  category,
  job,
  normalized,
  summary,
  provenance,
  sourceResults,
  discoveryResult,
  runId,
  specDb = null
}) {
  const loaded = await loadCategoryBrain({
    storage,
    category,
    specDb,
    config
  });

  const seenAt = nowIso();
  const lexicon = updateFieldLexicon({
    artifact: loaded.artifacts.lexicon.value,
    provenance,
    seenAt
  });
  const constraints = updateFieldConstraints({
    artifact: loaded.artifacts.constraints.value,
    normalized,
    validated: Boolean(summary?.validated),
    seenAt
  });
  const fieldYield = updateFieldYield({
    artifact: loaded.artifacts.fieldYield.value,
    provenance,
    sourceResults,
    seenAt
  });
  const identityGrammar = updateIdentityGrammar({
    artifact: loaded.artifacts.identityGrammar.value,
    job,
    normalized,
    summary,
    seenAt
  });
  const queryTemplates = updateQueryLearning({
    artifact: loaded.artifacts.queryTemplates.value,
    summary,
    job,
    discoveryResult,
    seenAt
  });
  const fieldAvailability = updateFieldAvailability({
    artifact: loaded.artifacts.fieldAvailability?.value,
    fieldOrder: Object.keys(normalized?.fields || {}),
    normalized,
    summary,
    provenance,
    validated: Boolean(summary?.validated),
    seenAt
  });
  const stats = updateStats(loaded.artifacts.stats.value, summary, runId);

  const promotionUpdate = await autoPromoteSources({
    storage,
    config,
    category,
    summary
  });
  const sourcePromotions = loaded.artifacts.sourcePromotions.value;
  sourcePromotions.updated_at = seenAt;
  sourcePromotions.history = toArray(sourcePromotions.history);
  if (promotionUpdate.promoted_domains.length > 0) {
    sourcePromotions.history.push({
      ts: seenAt,
      override_key: promotionUpdate.override_key,
      suggestion_key: promotionUpdate.suggestion_key,
      promoted_domains: promotionUpdate.promoted_domains
    });
    sourcePromotions.history = sourcePromotions.history.slice(-200);
  }

  const artifactMap = {
    field_lexicon:      { key: loaded.artifacts.lexicon.key, value: lexicon },
    constraints:        { key: loaded.artifacts.constraints.key, value: constraints },
    field_yield:        { key: loaded.artifacts.fieldYield.key, value: fieldYield },
    identity_grammar:   { key: loaded.artifacts.identityGrammar.key, value: identityGrammar },
    query_templates:    { key: loaded.artifacts.queryTemplates.key, value: queryTemplates },
    source_promotions:  { key: loaded.artifacts.sourcePromotions.key, value: sourcePromotions },
    stats:              { key: loaded.artifacts.stats.key, value: stats },
    field_availability: {
      key: loaded.artifacts.fieldAvailability?.key || artifactKey(storage, category, 'field_availability.json'),
      value: fieldAvailability
    }
  };

  /* --- SQLite primary writes --- */
  if (specDb) {
    for (const [artifactName, { value }] of Object.entries(artifactMap)) {
      specDb.upsertCategoryBrainArtifact(category, artifactName, value);
    }
  }

  /* --- JSON / storage writes (fallback or dual-write) --- */
  const writeJson = !specDb || config?.brainJsonWrite === true;
  const keys = {};

  if (writeJson) {
    const writes = await Promise.all(
      Object.entries(artifactMap).map(([name, { key, value }]) =>
        writeArtifact(storage, key, value)
      )
    );
    const names = Object.keys(artifactMap);
    for (let i = 0; i < names.length; i++) {
      keys[names[i]] = writes[i];
    }
  } else {
    for (const [name, { key }] of Object.entries(artifactMap)) {
      keys[name] = key;
    }
  }

  return {
    category,
    keys,
    promotion_update: promotionUpdate
  };
}

export async function buildLearningReport({
  storage,
  category
}) {
  const loaded = await loadCategoryBrain({
    storage,
    category
  });
  const lexicon = loaded.artifacts.lexicon.value;
  const constraints = loaded.artifacts.constraints.value;
  const fieldYield = loaded.artifacts.fieldYield.value;
  const identityGrammar = loaded.artifacts.identityGrammar.value;
  const queryTemplates = loaded.artifacts.queryTemplates.value;
  const sourcePromotions = loaded.artifacts.sourcePromotions.value;
  const stats = loaded.artifacts.stats.value;
  const fieldAvailability = loaded.artifacts.fieldAvailability?.value || defaultFieldAvailability();
  const availabilitySummary = summarizeAvailability(fieldAvailability);

  return {
    category,
    updated_at: nowIso(),
    stats,
    field_count_lexicon: Object.keys(lexicon.fields || {}).length,
    constrained_field_count: Object.keys(constraints.fields || {}).length,
    yield_domain_count: Object.keys(fieldYield.by_domain || {}).length,
    brand_grammar_count: Object.keys(identityGrammar.brands || {}).length,
    query_template_count: Object.keys(queryTemplates.queries || {}).length,
    promotion_history_count: toArray(sourcePromotions.history).length,
    field_availability: {
      expected_count: availabilitySummary.counts.expected,
      sometimes_count: availabilitySummary.counts.sometimes,
      rare_count: availabilitySummary.counts.rare,
      top_expected_unknown: availabilitySummary.top_expected_unknown
    },
    top_yield_domains: buildTopYieldRows(fieldYield, 25),
    templates_by_field: queryTemplates.templates_by_field || {},
    latest_promotions: toArray(sourcePromotions.history).slice(-5)
  };
}
