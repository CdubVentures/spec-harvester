import { toPosixKey } from '../s3/storage.js';

function round(value, digits = 4) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function createStatsTemplate(extra = {}) {
  return {
    attempts: 0,
    http_ok_count: 0,
    http_ok: 0,
    identity_match_count: 0,
    identity_match: 0,
    major_anchor_conflict_count: 0,
    major_anchor_conflicts: 0,
    fields_contributed_count: 0,
    fields_accepted_count: 0,
    accepted_fields_count: 0,
    accepted_critical_fields_count: 0,
    products_seen: 0,
    recent_products: [],
    approved_attempts: 0,
    candidate_attempts: 0,
    per_field_helpfulness: {},
    per_field_accept_count: {},
    last_seen_at: null,
    ...extra
  };
}

function ensureDomainStats(domains, rootDomain) {
  if (!domains[rootDomain]) {
    domains[rootDomain] = createStatsTemplate({
      rootDomain,
      per_brand: {}
    });
  } else if (!domains[rootDomain].per_brand) {
    domains[rootDomain].per_brand = {};
  }
  return domains[rootDomain];
}

function ensureBrandStats(domainEntry, brand) {
  const normalizedBrand = String(brand || '').trim();
  if (!normalizedBrand) {
    return null;
  }

  const brandKey = slug(normalizedBrand);
  if (!brandKey) {
    return null;
  }

  if (!domainEntry.per_brand[brandKey]) {
    domainEntry.per_brand[brandKey] = createStatsTemplate({
      brand: normalizedBrand,
      brand_key: brandKey
    });
  }
  return domainEntry.per_brand[brandKey];
}

function updateDerivedStats(entry) {
  const attempts = Math.max(1, entry.attempts || 0);
  entry.http_ok_rate = round((entry.http_ok_count || 0) / attempts, 6);
  entry.identity_match_rate = round((entry.identity_match_count || 0) / attempts, 6);
  entry.major_anchor_conflict_rate = round((entry.major_anchor_conflict_count || 0) / attempts, 6);
  entry.acceptance_yield = round(
    (entry.fields_accepted_count || 0) / Math.max(1, entry.fields_contributed_count || 0),
    6
  );

  const yieldBoost = Math.min(1, entry.acceptance_yield * 10);
  entry.planner_score = round(
    (entry.identity_match_rate * 0.5) +
      ((1 - entry.major_anchor_conflict_rate) * 0.2) +
      (entry.http_ok_rate * 0.1) +
      (yieldBoost * 0.2),
    6
  );
}

function syncNamedMetrics(entry, seenAt) {
  entry.http_ok = entry.http_ok_count || 0;
  entry.identity_match = entry.identity_match_count || 0;
  entry.major_anchor_conflicts = entry.major_anchor_conflict_count || 0;
  entry.accepted_fields_count = entry.fields_accepted_count || 0;
  entry.per_field_accept_count = { ...(entry.per_field_helpfulness || {}) };
  entry.last_seen_at = seenAt;
}

function valueIsFilled(value) {
  const text = String(value || '').trim().toLowerCase();
  return text !== '' && text !== 'unk';
}

function collectAcceptedDomainHelpfulness(provenance, criticalFieldSet) {
  const map = {};

  for (const [field, row] of Object.entries(provenance || {})) {
    if (!valueIsFilled(row?.value)) {
      continue;
    }

    const evidence = row?.evidence || [];
    if (!evidence.length) {
      continue;
    }

    const uniqueDomainsForField = new Set();
    for (const item of evidence) {
      const rootDomain = item?.rootDomain || item?.host || '';
      if (!rootDomain) {
        continue;
      }
      uniqueDomainsForField.add(rootDomain);
    }

    for (const rootDomain of uniqueDomainsForField) {
      if (!map[rootDomain]) {
        map[rootDomain] = {
          fieldsAccepted: 0,
          acceptedCriticalFields: 0,
          perField: {}
        };
      }

      map[rootDomain].fieldsAccepted += 1;
      map[rootDomain].perField[field] = (map[rootDomain].perField[field] || 0) + 1;
      if (criticalFieldSet.has(field)) {
        map[rootDomain].acceptedCriticalFields += 1;
      }
    }
  }

  return map;
}

function topHelpfulFields(perFieldHelpfulness, limit = 12) {
  return Object.entries(perFieldHelpfulness || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([field, count]) => ({ field, count }));
}

function applyPromotionThresholds(domains) {
  const rows = Object.values(domains || {});
  return rows
    .filter((entry) => (entry.approved_attempts || 0) === 0)
    .filter((entry) => (entry.products_seen || 0) >= 20)
    .filter((entry) => (entry.identity_match_rate || 0) >= 0.98)
    .filter((entry) => (entry.major_anchor_conflict_count || 0) === 0)
    .filter((entry) => (entry.fields_accepted_count || 0) >= 10)
    .filter((entry) => (entry.accepted_critical_fields_count || 0) >= 1)
    .sort((a, b) => (b.planner_score || 0) - (a.planner_score || 0))
    .map((entry) => ({
      rootDomain: entry.rootDomain,
      products_seen: entry.products_seen,
      identity_match_rate: entry.identity_match_rate,
      major_anchor_conflict_count: entry.major_anchor_conflict_count,
      fields_accepted_count: entry.fields_accepted_count,
      accepted_critical_fields_count: entry.accepted_critical_fields_count,
      planner_score: entry.planner_score
    }));
}

function buildPerBrandExpansionPlans(domains, approvedRootDomains) {
  const approved = approvedRootDomains || new Set();
  const byBrand = new Map();

  for (const domain of Object.values(domains || {})) {
    const rootDomain = domain.rootDomain;
    if (!rootDomain || approved.has(rootDomain)) {
      continue;
    }

    const perBrand = domain.per_brand || {};
    for (const [brandKey, stats] of Object.entries(perBrand)) {
      if ((stats.attempts || 0) < 2) {
        continue;
      }
      if ((stats.identity_match_rate || 0) < 0.9) {
        continue;
      }
      if ((stats.fields_accepted_count || 0) < 1) {
        continue;
      }
      if ((stats.major_anchor_conflict_count || 0) > 1) {
        continue;
      }

      let readiness = 'low';
      if (
        (stats.attempts || 0) >= 8 &&
        (stats.identity_match_rate || 0) >= 0.98 &&
        (stats.major_anchor_conflict_count || 0) === 0 &&
        (stats.fields_accepted_count || 0) >= 8
      ) {
        readiness = 'high';
      } else if (
        (stats.attempts || 0) >= 4 &&
        (stats.identity_match_rate || 0) >= 0.95 &&
        (stats.fields_accepted_count || 0) >= 3
      ) {
        readiness = 'medium';
      }

      const score = round(
        ((stats.identity_match_rate || 0) * 0.5) +
          ((1 - (stats.major_anchor_conflict_rate || 0)) * 0.2) +
          (Math.min(1, (stats.fields_accepted_count || 0) / 10) * 0.2) +
          (Math.min(1, (stats.products_seen || 0) / 20) * 0.1),
        6
      );

      if (!byBrand.has(brandKey)) {
        byBrand.set(brandKey, {
          brand: stats.brand || brandKey,
          brand_key: brandKey,
          generated_at: new Date().toISOString(),
          suggestions: []
        });
      }

      byBrand.get(brandKey).suggestions.push({
        rootDomain,
        readiness,
        score,
        attempts: stats.attempts || 0,
        candidate_attempts: stats.candidate_attempts || 0,
        identity_match_rate: stats.identity_match_rate || 0,
        major_anchor_conflict_rate: stats.major_anchor_conflict_rate || 0,
        fields_accepted_count: stats.fields_accepted_count || 0,
        accepted_critical_fields_count: stats.accepted_critical_fields_count || 0,
        top_fields: topHelpfulFields(stats.per_field_helpfulness, 8)
      });
    }
  }

  const plans = [...byBrand.values()].map((plan) => ({
    ...plan,
    suggestions: plan.suggestions.sort((a, b) => b.score - a.score),
    suggestion_count: plan.suggestions.length
  }));

  plans.sort((a, b) => b.suggestion_count - a.suggestion_count || a.brand.localeCompare(b.brand));
  return plans;
}

export function sourceIntelKey(config, category) {
  return toPosixKey(config.s3OutputPrefix, '_source_intel', category, 'domain_stats.json');
}

export function promotionSuggestionsKey(config, category, date = new Date()) {
  const stamp = date.toISOString().slice(0, 10);
  return toPosixKey(
    config.s3OutputPrefix,
    '_source_intel',
    category,
    'promotion_suggestions',
    `${stamp}.json`
  );
}

export function expansionPlanKey(config, category, date = new Date()) {
  const stamp = date.toISOString().slice(0, 10);
  return toPosixKey(
    config.s3OutputPrefix,
    '_source_intel',
    category,
    'expansion_plans',
    `${stamp}.json`
  );
}

export function brandExpansionPlanKey(config, category, brandKey, date = new Date()) {
  const stamp = date.toISOString().slice(0, 10);
  return toPosixKey(
    config.s3OutputPrefix,
    '_source_intel',
    category,
    'expansion_plans',
    'brands',
    brandKey,
    `${stamp}.json`
  );
}

export async function loadSourceIntel({ storage, config, category }) {
  const key = sourceIntelKey(config, category);
  const existing = await storage.readJsonOrNull(key);

  return {
    key,
    data: existing || {
      category,
      updated_at: null,
      domains: {}
    }
  };
}

async function writeExpansionPlans({
  storage,
  config,
  category,
  intelPayload,
  categoryConfig,
  date = new Date()
}) {
  const plans = buildPerBrandExpansionPlans(
    intelPayload.domains || {},
    categoryConfig?.approvedRootDomains || new Set()
  );

  const globalKey = expansionPlanKey(config, category, date);
  const globalPayload = {
    category,
    generated_at: new Date().toISOString(),
    plan_count: plans.length,
    plans: plans.map((plan) => ({
      brand: plan.brand,
      brand_key: plan.brand_key,
      suggestion_count: plan.suggestion_count,
      top_suggestions: plan.suggestions.slice(0, 20)
    }))
  };

  await storage.writeObject(globalKey, Buffer.from(JSON.stringify(globalPayload, null, 2), 'utf8'), {
    contentType: 'application/json'
  });

  const perBrandKeys = [];
  for (const plan of plans) {
    const key = brandExpansionPlanKey(config, category, plan.brand_key, date);
    const payload = {
      category,
      brand: plan.brand,
      brand_key: plan.brand_key,
      generated_at: new Date().toISOString(),
      suggestion_count: plan.suggestion_count,
      suggestions: plan.suggestions
    };

    await storage.writeObject(key, Buffer.from(JSON.stringify(payload, null, 2), 'utf8'), {
      contentType: 'application/json'
    });
    perBrandKeys.push(key);
  }

  return {
    expansionPlanKey: globalKey,
    brandPlanKeys: perBrandKeys,
    planCount: plans.length
  };
}

export async function generateSourceExpansionPlans({
  storage,
  config,
  category,
  categoryConfig
}) {
  const loaded = await loadSourceIntel({ storage, config, category });
  return writeExpansionPlans({
    storage,
    config,
    category,
    intelPayload: loaded.data,
    categoryConfig
  });
}

export async function persistSourceIntel({
  storage,
  config,
  category,
  productId,
  brand,
  sourceResults,
  provenance,
  categoryConfig
}) {
  const loaded = await loadSourceIntel({ storage, config, category });
  const current = loaded.data;
  const domains = { ...(current.domains || {}) };
  const perDomainRunSeen = new Set();
  const seenAt = new Date().toISOString();

  for (const source of sourceResults || []) {
    const rootDomain = source.rootDomain || source.host;
    if (!rootDomain) {
      continue;
    }

    const entry = ensureDomainStats(domains, rootDomain);
    const brandStats = ensureBrandStats(entry, brand);
    entry.attempts += 1;
    if (brandStats) {
      brandStats.attempts += 1;
    }

    const status = Number.parseInt(source.status || 0, 10);
    if (status >= 200 && status < 400) {
      entry.http_ok_count += 1;
      if (brandStats) {
        brandStats.http_ok_count += 1;
      }
    }

    if (source.identity?.match) {
      entry.identity_match_count += 1;
      if (brandStats) {
        brandStats.identity_match_count += 1;
      }
    }

    if ((source.anchorCheck?.majorConflicts || []).length > 0) {
      entry.major_anchor_conflict_count += 1;
      if (brandStats) {
        brandStats.major_anchor_conflict_count += 1;
      }
    }

    const contributedCount = (source.fieldCandidates || []).length;
    entry.fields_contributed_count += contributedCount;
    if (brandStats) {
      brandStats.fields_contributed_count += contributedCount;
    }

    if (source.approvedDomain) {
      entry.approved_attempts += 1;
      if (brandStats) {
        brandStats.approved_attempts += 1;
      }
    } else {
      entry.candidate_attempts += 1;
      if (brandStats) {
        brandStats.candidate_attempts += 1;
      }
    }

    perDomainRunSeen.add(rootDomain);
  }

  for (const rootDomain of perDomainRunSeen) {
    const entry = ensureDomainStats(domains, rootDomain);
    const recent = new Set(entry.recent_products || []);
    if (!recent.has(productId)) {
      entry.products_seen += 1;
    }
    recent.add(productId);
    entry.recent_products = [...recent].slice(-200);

    const brandStats = ensureBrandStats(entry, brand);
    if (brandStats) {
      const brandRecent = new Set(brandStats.recent_products || []);
      if (!brandRecent.has(productId)) {
        brandStats.products_seen += 1;
      }
      brandRecent.add(productId);
      brandStats.recent_products = [...brandRecent].slice(-200);
    }
  }

  const acceptedHelpfulness = collectAcceptedDomainHelpfulness(
    provenance,
    categoryConfig?.criticalFieldSet || new Set()
  );

  for (const [rootDomain, stat] of Object.entries(acceptedHelpfulness)) {
    const entry = ensureDomainStats(domains, rootDomain);
    const brandStats = ensureBrandStats(entry, brand);
    entry.fields_accepted_count += stat.fieldsAccepted;
    entry.accepted_critical_fields_count += stat.acceptedCriticalFields;
    if (brandStats) {
      brandStats.fields_accepted_count += stat.fieldsAccepted;
      brandStats.accepted_critical_fields_count += stat.acceptedCriticalFields;
    }

    for (const [field, count] of Object.entries(stat.perField || {})) {
      entry.per_field_helpfulness[field] = (entry.per_field_helpfulness[field] || 0) + count;
      if (brandStats) {
        brandStats.per_field_helpfulness[field] =
          (brandStats.per_field_helpfulness[field] || 0) + count;
      }
    }
  }

  for (const entry of Object.values(domains)) {
    updateDerivedStats(entry);
    syncNamedMetrics(entry, seenAt);
    for (const brandEntry of Object.values(entry.per_brand || {})) {
      updateDerivedStats(brandEntry);
      syncNamedMetrics(brandEntry, seenAt);
    }
  }

  const payload = {
    category,
    updated_at: new Date().toISOString(),
    domains
  };

  await storage.writeObject(loaded.key, Buffer.from(JSON.stringify(payload, null, 2), 'utf8'), {
    contentType: 'application/json'
  });

  const suggestions = applyPromotionThresholds(domains);
  const suggestionKey = promotionSuggestionsKey(config, category);
  const suggestionPayload = {
    category,
    generated_at: new Date().toISOString(),
    thresholds: {
      min_products_seen: 20,
      min_identity_match_rate: 0.98,
      max_major_anchor_conflicts: 0,
      min_fields_accepted_count: 10,
      min_accepted_critical_fields_count: 1
    },
    suggestion_count: suggestions.length,
    suggestions
  };

  await storage.writeObject(suggestionKey, Buffer.from(JSON.stringify(suggestionPayload, null, 2), 'utf8'), {
    contentType: 'application/json'
  });

  const expansionResult = await writeExpansionPlans({
    storage,
    config,
    category,
    intelPayload: payload,
    categoryConfig
  });

  return {
    domainStatsKey: loaded.key,
    promotionSuggestionsKey: suggestionKey,
    expansionPlanKey: expansionResult.expansionPlanKey,
    brandExpansionPlanCount: expansionResult.planCount,
    intel: payload
  };
}
