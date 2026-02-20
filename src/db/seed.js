/**
 * Seed logic for SpecDb — populates all tables from existing JSON artifacts + field rules.
 *
 * Usage:
 *   const result = await seedSpecDb({ db, config, category, fieldRules, logger });
 *
 * Seed order respects FK dependencies:
 *   1. component_identity + component_aliases + component_values
 *   2. list_values
 *   3-7. Per-product: candidates, item_field_state, item_component_links, item_list_links, candidate_reviews
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { buildComponentIdentifier } from '../utils/componentIdentifier.js';
import { buildScopedItemCandidateId } from '../utils/candidateIdentifier.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function isObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function normalizeToken(v) {
  return String(v || '').trim().toLowerCase();
}

function toScopedCandidateId({
  productId,
  rawCandidateId,
  fieldKey,
  value = '',
  sourceHost = '',
  sourceMethod = '',
  index = 0,
  runId = '',
}) {
  return buildScopedItemCandidateId({
    productId,
    fieldKey,
    rawCandidateId,
    value,
    sourceHost,
    sourceMethod,
    index,
    runId,
  });
}

function reserveCandidateId(usedIds, candidateIdBase) {
  let next = String(candidateIdBase || '').trim();
  if (!next) return next;
  if (!usedIds.has(next)) {
    usedIds.add(next);
    return next;
  }
  let ordinal = 1;
  while (usedIds.has(`${next}::dup_${ordinal}`)) ordinal += 1;
  next = `${next}::dup_${ordinal}`;
  usedIds.add(next);
  return next;
}

// ── Field metadata lookup ────────────────────────────────────────────────────

function buildFieldMeta(fieldRules) {
  const meta = {};
  const fields = fieldRules.rules?.fields;
  if (!isObject(fields)) return meta;

  for (const [fieldKey, rule] of Object.entries(fields)) {
    if (!isObject(rule)) continue;
    const component = isObject(rule.component) ? rule.component : null;
    const shape = rule.output_shape || rule.contract?.shape || 'scalar';
    const isList = shape === 'list';
    const isComponentField = component != null && component.type != null;
    meta[fieldKey] = {
      is_component_field: isComponentField,
      component_type: isComponentField ? component.type : null,
      is_list_field: isList,
      enum_policy: rule.enum?.policy ?? null
    };
  }
  return meta;
}

// ── Step 1a: Component override seeding ──────────────────────────────────────

async function seedComponentOverrides(db, config, category) {
  const helperRoot = config.helperFilesRoot || 'helper_files';
  const overrideDir = path.join(helperRoot, category, '_overrides', 'components');
  let overrideCount = 0;

  let files;
  try {
    const entries = await fs.readdir(overrideDir, { withFileTypes: true });
    files = entries.filter(e => e.isFile() && e.name.endsWith('.json')).map(e => e.name);
  } catch (error) {
    if (error.code === 'ENOENT') return { overrideCount: 0 };
    throw error;
  }

  // Read all override files async before entering the synchronous transaction
  const overrides = [];
  for (const fileName of files) {
    const ovr = await readJsonIfExists(path.join(overrideDir, fileName));
    if (isObject(ovr) && ovr.name) overrides.push({ fileName, ovr });
  }

  const tx = db.db.transaction(() => {
    for (const { fileName, ovr } of overrides) {
      const componentType = ovr.componentType || fileName.split('_')[0];
      const componentName = ovr.name;
      const maker = ovr.identity?.maker ?? '';

      // Update review_status on component_identity
      if (ovr.review_status) {
        db.updateComponentReviewStatus(componentType, componentName, maker, ovr.review_status);
      }

      // Update aliases_overridden flag
      if (ovr.identity?.aliases) {
        db.updateAliasesOverridden(componentType, componentName, maker, true);
        // Seed override aliases
        const idRow = db.db.prepare(
          'SELECT id FROM component_identity WHERE category = ? AND component_type = ? AND canonical_name = ? AND maker = ?'
        ).get(db.category, componentType, componentName, maker || '');
        if (idRow) {
          for (const alias of ovr.identity.aliases) {
            const trimmed = String(alias || '').trim();
            if (trimmed) db.insertAlias(idRow.id, trimmed, 'user');
          }
        }
      }

      // Seed property overrides
      if (isObject(ovr.properties)) {
        for (const [propKey, propVal] of Object.entries(ovr.properties)) {
          db.upsertComponentValue({
            componentType,
            componentName,
            componentMaker: maker,
            propertyKey: propKey,
            value: propVal != null ? String(propVal) : null,
            confidence: 1.0,
            source: 'user',
            overridden: true
          });
          overrideCount++;
        }
      }
    }
  });
  tx();

  return { overrideCount };
}

// ── Step 1: Component seeding ────────────────────────────────────────────────

function seedComponents(db, fieldRules) {
  const componentDBs = fieldRules.componentDBs || {};
  let identityCount = 0;
  let aliasCount = 0;
  let valueCount = 0;

  const tx = db.db.transaction(() => {
    for (const [typeKey, compDb] of Object.entries(componentDBs)) {
      const componentType = typeKey;
      const entries = isObject(compDb.entries) ? compDb.entries : {};

      for (const entry of Object.values(entries)) {
        if (!isObject(entry)) continue;
        const canonicalName = String(entry.canonical_name || entry.name || '').trim();
        if (!canonicalName) continue;
        const maker = String(entry.maker || '').trim();
        const links = Array.isArray(entry.links) ? entry.links : null;

        const idRow = db.upsertComponentIdentity({
          componentType,
          canonicalName,
          maker,
          links,
          source: 'component_db'
        });
        identityCount++;

        if (idRow && idRow.id) {
          const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
          for (const alias of aliases) {
            const trimmed = String(alias || '').trim();
            if (!trimmed) continue;
            db.insertAlias(idRow.id, trimmed, 'component_db');
            aliasCount++;
          }
          // Also add canonical_name as alias for findComponentByAlias lookups
          db.insertAlias(idRow.id, canonicalName, 'component_db');
          aliasCount++;
        }

        const properties = isObject(entry.properties) ? entry.properties : {};
        const variancePolicies = isObject(entry.__variance_policies) ? entry.__variance_policies : {};
        const entryConstraints = isObject(entry.__constraints) ? entry.__constraints : {};
        for (const [propKey, propVal] of Object.entries(properties)) {
          db.upsertComponentValue({
            componentType,
            componentName: canonicalName,
            componentMaker: maker,
            propertyKey: propKey,
            value: propVal != null ? String(propVal) : null,
            confidence: 1.0,
            variancePolicy: variancePolicies[propKey] ?? null,
            source: 'component_db',
            constraints: Array.isArray(entryConstraints[propKey]) ? entryConstraints[propKey] : null
          });
          valueCount++;
        }
      }
    }
  });
  tx();

  return { identityCount, aliasCount, valueCount };
}

// ── Step 2: List values seeding ──────────────────────────────────────────────

async function seedListValues(db, fieldRules, config, category) {
  let count = 0;

  const tx = db.db.transaction((rows) => {
    for (const row of rows) {
      db.upsertListValue(row);
      count++;
    }
  });

  // From knownValues.enums
  const rows = [];
  const enums = fieldRules.knownValues?.enums;
  if (isObject(enums)) {
    for (const [fieldKey, enumDef] of Object.entries(enums)) {
      const policy = enumDef.policy || 'open';
      const values = Array.isArray(enumDef.values) ? enumDef.values : [];
      for (const value of values) {
        const trimmed = String(value || '').trim();
        if (!trimmed) continue;
        rows.push({
          fieldKey,
          value: trimmed,
          normalizedValue: normalizeToken(trimmed),
          source: 'known_values',
          enumPolicy: policy
        });
      }
    }
  }

  // From workbook_map.json manual_enum_values
  const helperRoot = config.helperFilesRoot || 'helper_files';
  const workbookMapPath = path.join(helperRoot, category, '_control_plane', 'workbook_map.json');
  const workbookMap = await readJsonIfExists(workbookMapPath);
  const manualEnumTimestamps = isObject(workbookMap?.manual_enum_timestamps) ? workbookMap.manual_enum_timestamps : {};
  if (isObject(workbookMap?.manual_enum_values)) {
    for (const [fieldKey, values] of Object.entries(workbookMap.manual_enum_values)) {
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        const trimmed = String(value || '').trim();
        if (!trimmed) continue;
        const tsKey = `${fieldKey}::${normalizeToken(trimmed)}`;
        rows.push({
          fieldKey,
          value: trimmed,
          normalizedValue: normalizeToken(trimmed),
          source: 'manual',
          enumPolicy: null,
          sourceTimestamp: manualEnumTimestamps[tsKey] || null
        });
      }
    }
  }

  // From _suggestions/enums.json — pending pipeline enum suggestions
  const suggestPath = path.join(helperRoot, category, '_suggestions', 'enums.json');
  const suggestDoc = await readJsonIfExists(suggestPath);
  if (Array.isArray(suggestDoc?.suggestions)) {
    for (const s of suggestDoc.suggestions) {
      const fk = String(s?.field_key || '').trim();
      const val = String(s?.value || '').trim();
      if (!fk || !val) continue;
      if (s.status && s.status !== 'pending') continue;
      rows.push({
        fieldKey: fk,
        value: val,
        normalizedValue: normalizeToken(val),
        source: 'pipeline',
        enumPolicy: null,
        needsReview: true,
        sourceTimestamp: s.first_seen_at || s.created_at || null
      });
    }
  }

  tx(rows);
  return { count };
}

// ── Per-source candidate collector ───────────────────────────────────────────

/**
 * Reads candidate arrays from runs/{runId}/extracted/{source}/candidates.json.
 * Returns a flat array of candidates with _source_host, _source_url metadata.
 */
async function collectPerSourceCandidates(outputRoot, productId, runId) {
  if (!runId) return [];
  const extractedDir = path.join(outputRoot, productId, 'runs', runId, 'extracted');
  let sourceDirs;
  try {
    sourceDirs = await fs.readdir(extractedDir, { withFileTypes: true });
  } catch { return []; }

  const all = [];
  for (const sd of sourceDirs) {
    if (!sd.isDirectory()) continue;
    const candPath = path.join(extractedDir, sd.name, 'candidates.json');
    const data = await readJsonIfExists(candPath);
    if (!Array.isArray(data) || data.length === 0) continue;

    // Extract source host from directory name (e.g. "razer.com__0000" → "razer.com")
    const sourceHost = sd.name.replace(/__\d+$/, '');
    const sourceUrl = `https://${sourceHost}`;

    for (let i = 0; i < data.length; i++) {
      const c = data[i];
      if (!isObject(c) || !c.field || c.value == null) continue;
      all.push({
        ...c,
        _source_host: sourceHost,
        _source_url: sourceUrl,
        _rank: i
      });
    }
  }
  return all;
}

// ── Steps 3-7: Per-product seeding ───────────────────────────────────────────

async function seedProducts(db, config, category, fieldRules, fieldMeta) {
  const outputRoot = path.join(config.localOutputRoot || 'out', 'specs', 'outputs', category);
  const helperRoot = config.helperFilesRoot || 'helper_files';
  const overridesDir = path.join(helperRoot, category, '_overrides');

  let entries;
  try {
    entries = await fs.readdir(outputRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return { productCount: 0, errors: [] };
    throw error;
  }

  const errors = [];
  let productCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '_index') continue;

    const productId = entry.name;
    const latestDir = path.join(outputRoot, productId, 'latest');

    try {
      const [candidates, normalized, provenance, overrides] = await Promise.all([
        readJsonIfExists(path.join(latestDir, 'candidates.json')),
        readJsonIfExists(path.join(latestDir, 'normalized.json')),
        readJsonIfExists(path.join(latestDir, 'provenance.json')),
        readJsonIfExists(path.join(overridesDir, `${productId}.overrides.json`))
      ]);

      if (!normalized) continue;

      // Collect per-source candidates from the latest run when latest/candidates.json is empty
      const perSourceCandidates = await collectPerSourceCandidates(outputRoot, productId, normalized.runId);
      const usedCandidateIds = new Set();

      const tx = db.db.transaction(() => {
        // Step 3a: Insert candidates from latest/candidates.json (merged format: {fieldKey: [...]})
        if (isObject(candidates)) {
          for (const [fieldKey, fieldCandidates] of Object.entries(candidates)) {
            if (!Array.isArray(fieldCandidates)) continue;
            const fm = fieldMeta[fieldKey] || {};
            for (let i = 0; i < fieldCandidates.length; i++) {
              const c = fieldCandidates[i];
              if (!isObject(c)) continue;
              const baseCandidateId = toScopedCandidateId({
                productId,
                rawCandidateId: c.candidate_id || c.id,
                fieldKey,
                value: c.value ?? '',
                sourceHost: c.source_host ?? c.evidence?.host ?? '',
                sourceMethod: c.source_method ?? c.method ?? c.evidence?.method ?? '',
                index: i,
                runId: c.run_id ?? normalized.runId ?? '',
              });
              const candidateId = reserveCandidateId(usedCandidateIds, baseCandidateId);
              db.insertCandidate({
                candidate_id: candidateId,
                category,
                product_id: productId,
                field_key: fieldKey,
                value: c.value ?? null,
                normalized_value: c.normalized_value ?? null,
                score: c.score ?? c.confidence ?? 0,
                rank: c.rank ?? i,
                source_url: c.source_url ?? c.evidence?.url ?? null,
                source_host: c.source_host ?? c.evidence?.host ?? null,
                source_root_domain: c.source_root_domain ?? c.evidence?.rootDomain ?? null,
                source_tier: c.source_tier ?? c.evidence?.tier ?? null,
                source_method: c.source_method ?? c.evidence?.method ?? null,
                approved_domain: c.approved_domain ?? c.evidence?.approvedDomain ?? false,
                snippet_id: c.snippet_id ?? null,
                snippet_hash: c.snippet_hash ?? null,
                snippet_text: c.snippet_text ?? null,
                quote: c.quote ?? c.evidence?.quote ?? null,
                quote_span_start: c.quote_span?.[0] ?? null,
                quote_span_end: c.quote_span?.[1] ?? null,
                evidence_url: c.evidence_url ?? c.evidence?.url ?? null,
                evidence_retrieved_at: c.evidence_retrieved_at ?? c.evidence?.retrieved_at ?? null,
                is_component_field: fm.is_component_field || false,
                component_type: fm.component_type ?? null,
                is_list_field: fm.is_list_field || false,
                llm_extract_model: c.llm_extract_model ?? c.model ?? null,
                extracted_at: c.extracted_at || new Date().toISOString(),
                run_id: c.run_id ?? normalized.runId ?? null
              });
            }
          }
        }

        // Step 3b: Insert per-source candidates from runs/*/extracted/*/candidates.json
        // These are flat arrays: [{field, value, method, keyPath, ...}, ...]
        for (const psc of perSourceCandidates) {
          const fieldKey = normalizeToken(psc.field);
          if (!fieldKey) continue;
          const fm = fieldMeta[fieldKey] || {};
          const sourceHost = psc._source_host || '';
          const baseCandidateId = toScopedCandidateId({
            productId,
            rawCandidateId: psc.candidate_id || psc.id || '',
            fieldKey,
            value: psc.value ?? '',
            sourceHost,
            sourceMethod: psc.method || 'unk',
            index: psc._rank ?? 0,
            runId: normalized.runId ?? '',
          });
          const candidateId = reserveCandidateId(usedCandidateIds, baseCandidateId);
          db.insertCandidate({
            candidate_id: candidateId,
            category,
            product_id: productId,
            field_key: fieldKey,
            value: psc.value ?? null,
            normalized_value: null,
            score: psc.score ?? psc.confidence ?? 0.5,
            rank: psc._rank ?? 0,
            source_url: psc._source_url || null,
            source_host: sourceHost,
            source_root_domain: sourceHost.split('.').slice(-2).join('.') || null,
            source_tier: psc.tier ?? null,
            source_method: psc.method || null,
            approved_domain: false,
            snippet_id: null,
            snippet_hash: null,
            snippet_text: null,
            quote: psc.keyPath ? `Extracted from ${psc.method}:${psc.keyPath}` : null,
            quote_span_start: null,
            quote_span_end: null,
            evidence_url: psc._source_url || null,
            evidence_retrieved_at: null,
            is_component_field: fm.is_component_field || false,
            component_type: fm.component_type ?? null,
            is_list_field: fm.is_list_field || false,
            llm_extract_model: psc.model ?? null,
            extracted_at: new Date().toISOString(),
            run_id: normalized.runId ?? null
          });
        }

        // Step 4: Insert item_field_state from normalized + provenance + overrides
        const fields = isObject(normalized.fields) ? normalized.fields : {};
        const overrideMap = isObject(overrides?.overrides) ? overrides.overrides : {};

        for (const [fieldKey, rawValue] of Object.entries(fields)) {
          const prov = isObject(provenance) ? provenance[fieldKey] : null;
          const ovr = overrideMap[fieldKey];
          const isOverridden = isObject(ovr);

          const value = isOverridden ? (ovr.value ?? ovr.override_value ?? rawValue) : rawValue;
          const confidence = isOverridden ? 1.0 : (prov?.confidence ?? 0);
          const source = isOverridden ? 'override' : 'pipeline';
          const candidateId = isOverridden
            ? toScopedCandidateId({
              productId,
              rawCandidateId: ovr.candidate_id ?? null,
              fieldKey,
              value: ovr.value ?? ovr.override_value ?? rawValue ?? '',
              sourceHost: ovr.source?.host ?? '',
              sourceMethod: ovr.source?.method ?? ovr.override_source ?? '',
              index: 0,
            })
            : null;

          db.upsertItemFieldState({
            productId,
            fieldKey,
            value: value != null ? String(value) : null,
            confidence,
            source,
            acceptedCandidateId: candidateId,
            overridden: isOverridden,
            needsAiReview: !isOverridden && confidence < 0.8,
            aiReviewComplete: false
          });
        }

        // Step 5: Insert item_component_links
        const componentDBs = fieldRules.componentDBs || {};
        for (const [fieldKey, fm] of Object.entries(fieldMeta)) {
          if (!fm.is_component_field || !fm.component_type) continue;
          const rawValue = fields[fieldKey];
          const rawValueText = String(rawValue ?? '').trim();
          if (!rawValueText || normalizeToken(rawValueText) === 'unk' || normalizeToken(rawValueText) === 'n/a') continue;

          const compType = fm.component_type;
          // Try singular key first (loadFieldRules keys by filename: sensor.json → "sensor"),
          // then plural fallback (some callers use plural keys: "sensors", "switches")
          const compDb = componentDBs[compType];
          if (!compDb?.__index) {
            db.upsertItemComponentLink({
              productId,
              fieldKey,
              componentType: compType,
              componentName: rawValueText,
              componentMaker: '',
              matchType: 'unresolved',
              matchScore: 0.0
            });
            continue;
          }

          const token = normalizeToken(rawValueText);
          const matched = compDb.__index.get(token) || compDb.__index.get(token.replace(/\s+/g, ''));
          if (matched) {
            db.upsertItemComponentLink({
              productId,
              fieldKey,
              componentType: compType,
              componentName: matched.canonical_name || rawValueText,
              componentMaker: matched.maker || '',
              matchType: 'exact',
              matchScore: 1.0
            });
          } else {
            db.upsertItemComponentLink({
              productId,
              fieldKey,
              componentType: compType,
              componentName: rawValueText,
              componentMaker: '',
              matchType: 'unresolved',
              matchScore: 0.0
            });
          }
        }

        // Step 6: Insert item_list_links for list-type fields
        for (const [fieldKey, fm] of Object.entries(fieldMeta)) {
          if (!fm.is_list_field) continue;
          const rawValue = fields[fieldKey];
          if (!rawValue || normalizeToken(rawValue) === 'unk') continue;

          const listRow = db.getListValueByFieldAndValue(fieldKey, String(rawValue));
          if (listRow) {
            db.upsertItemListLink({
              productId,
              fieldKey,
              listValueId: listRow.id
            });
          }
        }

        // Step 7: Insert candidate_reviews from override files
        if (isObject(overrideMap)) {
          for (const [fieldKey, ovr] of Object.entries(overrideMap)) {
            if (!isObject(ovr)) continue;
            if (!ovr.candidate_id) continue;
            const candidateId = toScopedCandidateId({
              productId,
              rawCandidateId: ovr.candidate_id,
              fieldKey,
              value: ovr.value ?? ovr.override_value ?? '',
              sourceHost: ovr.source?.host ?? '',
              sourceMethod: ovr.source?.method ?? ovr.override_source ?? '',
              index: 0,
            });

            // Ensure a candidate row exists for this override
            const existingCandidate = db.getCandidateById(candidateId);
            if (!existingCandidate) {
              const fm = fieldMeta[fieldKey] || {};
              db.insertCandidate({
                candidate_id: candidateId,
                category,
                product_id: productId,
                field_key: fieldKey,
                value: ovr.value ?? ovr.override_value ?? null,
                normalized_value: null,
                score: 1.0,
                rank: 0,
                source_url: ovr.override_provenance?.url ?? ovr.source?.evidence_key ?? null,
                source_host: ovr.source?.host ?? null,
                source_method: ovr.source?.method ?? ovr.override_source ?? null,
                source_tier: ovr.source?.tier ?? null,
                approved_domain: false,
                snippet_id: ovr.override_provenance?.snippet_id ?? null,
                snippet_hash: ovr.override_provenance?.snippet_hash ?? null,
                quote: ovr.override_provenance?.quote ?? null,
                evidence_url: ovr.override_provenance?.url ?? null,
                evidence_retrieved_at: ovr.override_provenance?.retrieved_at ?? null,
                is_component_field: fm.is_component_field || false,
                component_type: fm.component_type ?? null,
                is_list_field: fm.is_list_field || false,
                extracted_at: ovr.set_at || ovr.overridden_at || new Date().toISOString(),
                run_id: null
              });
            }

            db.upsertReview({
              candidateId,
              contextType: 'item',
              contextId: productId,
              humanAccepted: true,
              humanAcceptedAt: ovr.overridden_at || ovr.set_at || null,
              aiReviewStatus: 'not_run',
              humanOverrideAi: false
            });
          }
        }
      });
      tx();
      productCount++;
    } catch (error) {
      errors.push({ productId, error: error.message });
    }
  }

  return { productCount, errors };
}

// ── Queue state seeding ──────────────────────────────────────────────────────

async function seedQueueState(db, config, category) {
  // Try modern queue state path first, then legacy
  const helperRoot = path.resolve(config?.helperFilesRoot || 'helper_files');
  const modernPath = path.resolve(`_queue/${category}/state.json`);
  const legacyPath = path.join(helperRoot, category, '_queue', 'state.json');

  let state = await readJsonIfExists(modernPath) || await readJsonIfExists(legacyPath);
  if (!state || !isObject(state.products)) return { count: 0 };

  let count = 0;
  const tx = db.db.transaction(() => {
    for (const [productId, row] of Object.entries(state.products)) {
      if (!isObject(row)) continue;
      db.upsertQueueProduct({
        product_id: productId,
        s3key: row.s3key || '',
        status: row.status || 'pending',
        priority: row.priority ?? 3,
        attempts_total: row.attempts_total ?? 0,
        retry_count: row.retry_count ?? 0,
        max_attempts: row.max_attempts ?? 3,
        next_retry_at: row.next_retry_at || null,
        last_run_id: row.last_run_id || null,
        cost_usd_total: row.cost_usd_total_for_product ?? row.cost_usd_total ?? 0,
        rounds_completed: row.rounds_completed ?? 0,
        next_action_hint: row.next_action_hint || null,
        last_urls_attempted: row.last_urls_attempted || [],
        last_error: row.last_error || null,
        last_started_at: row.last_started_at || null,
        last_completed_at: row.last_completed_at || null,
        last_summary: row.last_summary || null
      });
      count++;
    }
  });
  tx();
  return { count };
}

// ── Curation suggestions seeding ─────────────────────────────────────────────

async function seedCurationSuggestions(db, config, category) {
  const helperRoot = path.resolve(config?.helperFilesRoot || 'helper_files');
  const enumPath = path.join(helperRoot, category, '_suggestions', 'enums.json');
  const compPath = path.join(helperRoot, category, '_suggestions', 'components.json');

  let count = 0;
  const tx = db.db.transaction(() => {
    // Enum suggestions
    const enumDoc = null; // Read synchronously not available, seed from already-loaded data
    // We'll handle this lazily — the file was already seeded to list_values in seedListValues
    // For curation_suggestions table, parse the enums.json suggestions array
  });

  // Async reads then sync insert
  const enumDoc = await readJsonIfExists(enumPath);
  const compDoc = await readJsonIfExists(compPath);

  const txInsert = db.db.transaction(() => {
    if (enumDoc && Array.isArray(enumDoc.suggestions)) {
      for (const s of enumDoc.suggestions) {
        if (!s.field_key || !s.value) continue;
        db.upsertCurationSuggestion({
          suggestion_id: s.suggestion_id || `enum_${s.field_key}_${normalizeToken(s.value)}`,
          suggestion_type: s.suggestion_type || 'enum_value',
          field_key: s.field_key,
          value: s.value,
          status: s.status || 'pending',
          source: s.source || 'pipeline',
          product_id: s.product_id || null,
          run_id: s.run_id || null,
          first_seen_at: s.first_seen_at || new Date().toISOString(),
          last_seen_at: s.last_seen_at || new Date().toISOString()
        });
        count++;
      }
    }

    if (compDoc && Array.isArray(compDoc.suggestions)) {
      for (const s of compDoc.suggestions) {
        if (!s.component_type || !s.value) continue;
        db.upsertCurationSuggestion({
          suggestion_id: s.suggestion_id || `comp_${s.component_type}_${normalizeToken(s.value)}`,
          suggestion_type: s.suggestion_type || 'new_component',
          component_type: s.component_type,
          field_key: s.field_key || null,
          value: s.value,
          status: s.status || 'pending',
          source: s.source || 'pipeline',
          product_id: s.product_id || null,
          run_id: s.run_id || null,
          first_seen_at: s.first_seen_at || new Date().toISOString(),
          last_seen_at: s.last_seen_at || new Date().toISOString()
        });
        count++;
      }
    }
  });
  txInsert();
  return { count };
}

// ── Component review queue seeding ───────────────────────────────────────────

async function seedComponentReviewQueue(db, config, category) {
  const helperRoot = path.resolve(config?.helperFilesRoot || 'helper_files');
  const reviewPath = path.join(helperRoot, category, '_suggestions', 'component_review.json');
  const reviewDoc = await readJsonIfExists(reviewPath);
  if (!reviewDoc || !Array.isArray(reviewDoc.items)) return { count: 0 };

  let count = 0;
  const tx = db.db.transaction(() => {
    for (const item of reviewDoc.items) {
      if (!item.component_type || !item.raw_query) continue;
      db.upsertComponentReviewItem({
        review_id: item.review_id || `cr_${item.component_type}_${normalizeToken(item.raw_query)}`,
        component_type: item.component_type,
        field_key: item.field_key || null,
        raw_query: item.raw_query,
        matched_component: item.matched_component || null,
        match_type: item.match_type || 'fuzzy_flagged',
        name_score: item.name_score ?? 0,
        property_score: item.property_score ?? 0,
        combined_score: item.combined_score ?? 0,
        alternatives: item.alternatives || [],
        product_id: item.product_id || null,
        run_id: item.run_id || null,
        status: item.status || 'pending_ai',
        product_attributes: item.product_attributes || {},
        reasoning_note: item.reasoning_note || null
      });
      count++;
    }
  });
  tx();
  return { count };
}

// ── Product catalog seeding ───────────────────────────────────────────────────

async function seedProductCatalog(db, config, category) {
  const helperRoot = path.resolve(config?.helperFilesRoot || 'helper_files');
  const catalogPath = path.join(helperRoot, category, '_control_plane', 'product_catalog.json');
  const catalog = await readJsonIfExists(catalogPath);
  if (!catalog || !isObject(catalog.products)) return { count: 0 };

  let count = 0;
  const tx = db.db.transaction(() => {
    for (const [productId, entry] of Object.entries(catalog.products)) {
      if (!isObject(entry)) continue;
      db.upsertProduct({
        product_id: productId,
        brand: entry.brand || '',
        model: entry.model || '',
        variant: entry.variant || '',
        status: entry.status || 'active',
        seed_urls: Array.isArray(entry.seed_urls) ? entry.seed_urls : [],
        identifier: entry.identifier || null
      });
      count++;
    }
  });
  tx();
  return { count };
}

// ── Backfill item_component_links from item_field_state ──────────────────────

function backfillComponentLinks(db, fieldMeta, fieldRules) {
  const componentDBs = fieldRules.componentDBs || {};
  let backfilled = 0;

  const tx = db.db.transaction(() => {
    for (const [fieldKey, fm] of Object.entries(fieldMeta)) {
      if (!fm.is_component_field || !fm.component_type) continue;
      const compType = fm.component_type;
      const compDb = componentDBs[compType];
      if (!compDb) continue;

      // Build alias → canonical_name lookup from DB
      const aliasMap = new Map();
      try {
        const identities = db.db.prepare(
          'SELECT id, canonical_name, maker FROM component_identity WHERE category = ? AND component_type = ?'
        ).all(db.category, compType);
        for (const id of identities) {
          aliasMap.set(id.canonical_name.trim().toLowerCase(), { name: id.canonical_name, maker: id.maker || '' });
          const aliases = db.db.prepare('SELECT alias FROM component_aliases WHERE component_id = ?').all(id.id);
          for (const a of aliases) {
            if (a.alias) aliasMap.set(a.alias.trim().toLowerCase(), { name: id.canonical_name, maker: id.maker || '' });
          }
        }
      } catch { continue; }

      // Find all item_field_state rows for this field that aren't already linked
      const fieldRows = db.db.prepare(`
        SELECT ifs.product_id, ifs.value
        FROM item_field_state ifs
        WHERE ifs.category = ? AND ifs.field_key = ?
          AND ifs.value IS NOT NULL AND LOWER(TRIM(ifs.value)) NOT IN ('unk', 'n/a', '')
          AND NOT EXISTS (
            SELECT 1 FROM item_component_links icl
            WHERE icl.category = ifs.category AND icl.product_id = ifs.product_id AND icl.field_key = ifs.field_key
          )
      `).all(db.category, fieldKey);

      for (const row of fieldRows) {
        const token = row.value.trim().toLowerCase();
        const match = aliasMap.get(token);
        if (match) {
          db.upsertItemComponentLink({
            productId: row.product_id,
            fieldKey,
            componentType: compType,
            componentName: match.name,
            componentMaker: match.maker,
            matchType: 'alias',
            matchScore: 1.0
          });
          backfilled++;
        }
      }
    }
  });
  tx();
  return { backfilled };
}

// ── Step 9: Source + Key Review backfill ──────────────────────────────────────

function seedSourceAndKeyReview(db, category, fieldMeta) {
  let sourceRegistryCount = 0;
  let sourceAssertionCount = 0;
  let sourceEvidenceRefCount = 0;
  let keyReviewStateCount = 0;
  let keyReviewAuditCount = 0;
  let keyReviewRunCount = 0;

  const tx = db.db.transaction(() => {
    // 9a: candidates → source_registry + source_assertions + source_evidence_refs
    const allCandidates = db.db.prepare(
      'SELECT * FROM candidates WHERE category = ?'
    ).all(db.category);
    const itemFieldStateRows = db.db.prepare(
      'SELECT id, product_id, field_key FROM item_field_state WHERE category = ?'
    ).all(db.category);
    const itemFieldStateIdBySlot = new Map();
    for (const row of itemFieldStateRows) {
      itemFieldStateIdBySlot.set(`${row.product_id}::${row.field_key}`, row.id);
    }

    const enumListRows = db.db.prepare(
      'SELECT id, field_key FROM enum_lists WHERE category = ?'
    ).all(db.category);
    const enumListIdByField = new Map();
    for (const row of enumListRows) {
      enumListIdByField.set(String(row.field_key || ''), row.id);
    }

    const listValueRows = db.db.prepare(
      'SELECT id, list_id, field_key, value FROM list_values WHERE category = ?'
    ).all(db.category);
    const listValueIdByFieldValue = new Map();
    for (const row of listValueRows) {
      const valueToken = normalizeToken(row.value);
      if (!valueToken) continue;
      listValueIdByFieldValue.set(`${row.field_key}::${valueToken}`, row.id);
    }

    const componentLinkRows = db.db.prepare(
      'SELECT product_id, field_key, component_type, component_name, component_maker FROM item_component_links WHERE category = ?'
    ).all(db.category);
    const componentLinkByProductType = new Map();
    for (const row of componentLinkRows) {
      const key = `${row.product_id}::${row.component_type || row.field_key || ''}`;
      if (!componentLinkByProductType.has(key)) {
        componentLinkByProductType.set(key, row);
      }
    }

    const componentValueRows = db.db.prepare(
      'SELECT id, component_type, component_name, component_maker, property_key FROM component_values WHERE category = ?'
    ).all(db.category);
    const componentValueIdBySlot = new Map();
    for (const row of componentValueRows) {
      componentValueIdBySlot.set(
        `${row.component_type}::${row.component_name}::${row.component_maker || ''}::${row.property_key}`,
        row.id
      );
    }

    // Group candidates by (product_id, source_host, run_id) → one source_registry row
    const sourceMap = new Map();
    for (const c of allCandidates) {
      const host = c.source_host || 'unknown';
      const runId = c.run_id || 'seed';
      const groupKey = `${c.product_id}::${host}::${runId}`;
      if (!sourceMap.has(groupKey)) {
        sourceMap.set(groupKey, {
          sourceId: `${category}::${c.product_id}::${host}::${runId}`,
          productId: c.product_id,
          host,
          runId,
          candidates: [],
          sourceUrl: c.source_url || `https://${host}`,
          sourceRootDomain: c.source_root_domain || host,
          sourceTier: c.source_tier,
          sourceMethod: c.source_method,
        });
      }
      sourceMap.get(groupKey).candidates.push(c);
    }

    for (const [, src] of sourceMap) {
      db.upsertSourceRegistry({
        sourceId: src.sourceId,
        category,
        itemIdentifier: src.productId,
        productId: src.productId,
        runId: src.runId === 'seed' ? null : src.runId,
        sourceUrl: src.sourceUrl,
        sourceHost: src.host,
        sourceRootDomain: src.sourceRootDomain,
        sourceTier: src.sourceTier,
        sourceMethod: src.sourceMethod,
        crawlStatus: 'fetched',
      });
      sourceRegistryCount++;

      for (const c of src.candidates) {
        const fm = fieldMeta[c.field_key] || {};
        const contextKind = fm.is_component_field ? 'component' : fm.is_list_field ? 'list' : 'scalar';
        const assertionId = c.candidate_id;
        const itemFieldStateId = itemFieldStateIdBySlot.get(`${c.product_id}::${c.field_key}`) || null;
        const enumListId = contextKind === 'list'
          ? (enumListIdByField.get(String(c.field_key || '')) || null)
          : null;
        const listValueId = contextKind === 'list'
          ? (listValueIdByFieldValue.get(`${c.field_key}::${normalizeToken(c.value)}`) || null)
          : null;

        let componentValueId = null;
        const componentType = String(c.component_type || fm.component_type || '').trim();
        if (componentType) {
          const linkRow = componentLinkByProductType.get(`${c.product_id}::${componentType}`);
          if (linkRow) {
            componentValueId = componentValueIdBySlot.get(
              `${componentType}::${linkRow.component_name}::${linkRow.component_maker || ''}::${c.field_key}`
            ) || null;
          }
        }
        const contextRef = componentValueId
          ? `component_value:${componentValueId}`
          : (listValueId
            ? `list_value:${listValueId}`
            : (itemFieldStateId ? `item_field_state:${itemFieldStateId}` : (c.component_type || null)));

        db.upsertSourceAssertion({
          assertionId,
          sourceId: src.sourceId,
          fieldKey: c.field_key,
          contextKind,
          contextRef,
          itemFieldStateId,
          componentValueId,
          listValueId,
          enumListId,
          valueRaw: c.value,
          valueNormalized: c.normalized_value,
          unit: null,
          candidateId: c.candidate_id,
          extractionMethod: c.source_method || c.llm_extract_model || null,
        });
        sourceAssertionCount++;

        if (c.quote || c.evidence_url) {
          // Idempotent: skip if an evidence ref already exists for this assertion
          const existingRef = db.db.prepare(
            'SELECT 1 FROM source_evidence_refs WHERE assertion_id = ? LIMIT 1'
          ).get(assertionId);
          if (!existingRef) {
            db.insertSourceEvidenceRef({
              assertionId,
              evidenceUrl: c.evidence_url,
              snippetId: c.snippet_id,
              quote: c.quote,
              method: c.source_method,
              tier: c.source_tier,
              retrievedAt: c.evidence_retrieved_at,
            });
            sourceEvidenceRefCount++;
          }
        }
      }
    }

    // 9b: item_field_state → key_review_state (grid_key)
    const allFieldStates = db.db.prepare(
      'SELECT * FROM item_field_state WHERE category = ?'
    ).all(db.category);

    // Pre-load candidate_reviews for shared lane mapping
    const allReviews = db.db.prepare(
      'SELECT * FROM candidate_reviews WHERE candidate_id IN (SELECT candidate_id FROM candidates WHERE category = ?)'
    ).all(db.category);
    const reviewByCandidate = new Map();
    for (const r of allReviews) {
      if (!reviewByCandidate.has(r.candidate_id)) reviewByCandidate.set(r.candidate_id, []);
      reviewByCandidate.get(r.candidate_id).push(r);
    }

    // Pre-load llm_route_matrix for contract snapshots
    const routes = db.db.prepare(
      'SELECT * FROM llm_route_matrix WHERE category = ?'
    ).all(db.category);
    const fieldRoutes = routes.filter(r => r.scope === 'field');
    const componentRoutes = routes.filter(r => r.scope === 'component');
    const listRoutes = routes.filter(r => r.scope === 'list');

    function findRoute(routeList) {
      return routeList.length > 0 ? routeList[0] : null;
    }

    for (const ifs of allFieldStates) {
      // Primary lane mapping
      let aiConfirmPrimaryStatus = null;
      if (ifs.needs_ai_review && !ifs.ai_review_complete) aiConfirmPrimaryStatus = 'pending';
      else if (ifs.ai_review_complete) aiConfirmPrimaryStatus = 'confirmed';

      let userAcceptPrimaryStatus = null;
      if (ifs.overridden) userAcceptPrimaryStatus = 'accepted';

      // Check candidate_reviews for shared lane
      let aiConfirmSharedStatus = null;
      let aiConfirmSharedConfidence = null;
      let aiConfirmSharedAt = null;
      let userAcceptSharedStatus = null;
      let userOverrideAiShared = 0;

      if (ifs.accepted_candidate_id) {
        const reviews = reviewByCandidate.get(ifs.accepted_candidate_id) || [];
        for (const rev of reviews) {
          if (rev.context_type === 'component' || rev.context_type === 'list') {
            if (rev.ai_review_status === 'accepted') aiConfirmSharedStatus = 'confirmed';
            else if (rev.ai_review_status === 'rejected') aiConfirmSharedStatus = 'rejected';
            else if (rev.ai_review_status === 'pending') aiConfirmSharedStatus = 'pending';
            aiConfirmSharedConfidence = rev.ai_confidence;
            aiConfirmSharedAt = rev.ai_reviewed_at;
            if (rev.human_accepted) userAcceptSharedStatus = 'accepted';
            if (rev.human_override_ai) userOverrideAiShared = 1;
          }
        }
      }

      // Contract snapshot from route matrix
      const route = findRoute(fieldRoutes);

      db.upsertKeyReviewState({
        category,
        targetKind: 'grid_key',
        itemIdentifier: ifs.product_id,
        fieldKey: ifs.field_key,
        requiredLevel: route?.required_level ?? null,
        availability: route?.availability ?? null,
        difficulty: route?.difficulty ?? null,
        effort: route?.effort ?? null,
        aiMode: route?.model_ladder_today ?? null,
        evidencePolicy: route?.insufficient_evidence_action ?? null,
        minEvidenceRefsEffective: route?.llm_output_min_evidence_refs_required ?? 1,
        sendMode: route?.all_source_data ? 'all_source_data' : (route?.single_source_data ? 'single_source_data' : null),
        selectedValue: ifs.value,
        selectedCandidateId: ifs.accepted_candidate_id,
        confidenceScore: ifs.confidence || 0,
        aiConfirmPrimaryStatus,
        aiConfirmSharedStatus,
        aiConfirmSharedConfidence,
        aiConfirmSharedAt,
        userAcceptPrimaryStatus,
        userAcceptSharedStatus,
        userOverrideAiShared,
      });
      keyReviewStateCount++;
    }

    // 9c: component_values → key_review_state (component_key)
    const allComponentValues = db.db.prepare(
      'SELECT * FROM component_values WHERE category = ?'
    ).all(db.category);

    for (const cv of allComponentValues) {
      let aiConfirmSharedStatus = null;
      if (cv.overridden) {
        // overridden → user accepted
      } else if (cv.needs_review) {
        aiConfirmSharedStatus = 'pending';
      } else {
        aiConfirmSharedStatus = 'not_run';
      }

      let userAcceptSharedStatus = null;
      if (cv.overridden) userAcceptSharedStatus = 'accepted';

      const componentIdentifier = buildComponentIdentifier(
        cv.component_type,
        cv.component_name,
        cv.component_maker || ''
      );
      const route = findRoute(componentRoutes);

      db.upsertKeyReviewState({
        category,
        targetKind: 'component_key',
        componentIdentifier,
        propertyKey: cv.property_key,
        fieldKey: cv.property_key,
        requiredLevel: route?.required_level ?? null,
        availability: route?.availability ?? null,
        difficulty: route?.difficulty ?? null,
        effort: route?.effort ?? null,
        aiMode: route?.model_ladder_today ?? null,
        evidencePolicy: route?.insufficient_evidence_action ?? null,
        minEvidenceRefsEffective: route?.llm_output_min_evidence_refs_required ?? 1,
        sendMode: route?.all_source_data ? 'all_source_data' : (route?.single_source_data ? 'single_source_data' : null),
        componentSendMode: route?.component_values_send?.includes('prime') ? 'component_values_prime_sources' : 'component_values',
        selectedValue: cv.value,
        selectedCandidateId: cv.accepted_candidate_id,
        confidenceScore: cv.confidence || 0,
        aiConfirmSharedStatus,
        userAcceptSharedStatus,
      });
      keyReviewStateCount++;
    }

    // 9d: list_values → key_review_state (enum_key)
    const allListValues = db.db.prepare(
      'SELECT * FROM list_values WHERE category = ?'
    ).all(db.category);

    for (const lv of allListValues) {
      let aiConfirmSharedStatus = null;
      if (lv.overridden) {
        // overridden → user accepted
      } else if (lv.needs_review) {
        aiConfirmSharedStatus = 'pending';
      } else if (lv.source === 'pipeline') {
        aiConfirmSharedStatus = 'pending';
      } else if (lv.source === 'known_values') {
        aiConfirmSharedStatus = 'not_run';
      } else {
        aiConfirmSharedStatus = 'not_run';
      }

      let userAcceptSharedStatus = null;
      if (lv.overridden) userAcceptSharedStatus = 'accepted';

      const enumValueNorm = lv.normalized_value || String(lv.value || '').trim().toLowerCase();
      const route = findRoute(listRoutes);

      db.upsertKeyReviewState({
        category,
        targetKind: 'enum_key',
        fieldKey: lv.field_key,
        enumValueNorm: enumValueNorm,
        requiredLevel: route?.required_level ?? null,
        availability: route?.availability ?? null,
        difficulty: route?.difficulty ?? null,
        effort: route?.effort ?? null,
        aiMode: route?.model_ladder_today ?? null,
        evidencePolicy: route?.insufficient_evidence_action ?? null,
        minEvidenceRefsEffective: route?.llm_output_min_evidence_refs_required ?? 1,
        sendMode: route?.all_source_data ? 'all_source_data' : (route?.single_source_data ? 'single_source_data' : null),
        listSendMode: route?.list_values_send?.includes('prime') ? 'list_values_prime_sources' : 'list_values',
        selectedValue: lv.value,
        selectedCandidateId: lv.accepted_candidate_id,
        aiConfirmSharedStatus,
        userAcceptSharedStatus,
      });
      keyReviewStateCount++;
    }

    // 9e: candidate_reviews → key_review_audit + key_review_runs
    // Idempotent: track which (review_id, event_type) combinations we've already seeded
    const existingAuditCheck = db.db.prepare(
      'SELECT 1 FROM key_review_audit WHERE key_review_state_id = ? AND event_type = ? AND COALESCE(actor_id, \'\') = ? LIMIT 1'
    );
    const existingRunCheck = db.db.prepare(
      'SELECT 1 FROM key_review_runs WHERE key_review_state_id = ? AND model_used = ? AND stage = ? LIMIT 1'
    );

    for (const rev of allReviews) {
      if (rev.ai_review_status === 'not_run' && !rev.human_accepted) continue;

      // Find the key_review_state this review maps to
      const cand = db.db.prepare('SELECT * FROM candidates WHERE candidate_id = ?').get(rev.candidate_id);
      if (!cand) continue;

      let stateRow = null;
      if (rev.context_type === 'item') {
        stateRow = db.db.prepare(
          "SELECT id FROM key_review_state WHERE category = ? AND target_kind = 'grid_key' AND item_identifier = ? AND field_key = ?"
        ).get(db.category, cand.product_id, cand.field_key);
      } else if (rev.context_type === 'component') {
        const link = db.db.prepare(
          'SELECT * FROM item_component_links WHERE category = ? AND product_id = ? AND field_key = ?'
        ).get(db.category, cand.product_id, cand.field_key);
        if (link) {
          const compId = buildComponentIdentifier(
            link.component_type,
            link.component_name,
            link.component_maker || ''
          );
          stateRow = db.db.prepare(
            "SELECT id FROM key_review_state WHERE category = ? AND target_kind = 'component_key' AND component_identifier = ? AND property_key = ?"
          ).get(db.category, compId, cand.field_key);
        }
      } else if (rev.context_type === 'list') {
        const norm = String(cand.value || '').trim().toLowerCase();
        stateRow = db.db.prepare(
          "SELECT id FROM key_review_state WHERE category = ? AND target_kind = 'enum_key' AND field_key = ? AND enum_value_norm = ?"
        ).get(db.category, cand.field_key, norm);
      }

      if (!stateRow) continue;

      // Audit entries (idempotent: skip if already exists)
      if (rev.ai_review_status && rev.ai_review_status !== 'not_run') {
        if (!existingAuditCheck.get(stateRow.id, 'ai_review', rev.ai_review_model || '')) {
          db.insertKeyReviewAudit({
            keyReviewStateId: stateRow.id,
            eventType: 'ai_review',
            actorType: 'ai',
            actorId: rev.ai_review_model || null,
            newValue: rev.ai_review_status,
            reason: rev.ai_reason || null,
          });
          keyReviewAuditCount++;
        }
      }

      if (rev.human_accepted) {
        if (!existingAuditCheck.get(stateRow.id, 'user_accept', '')) {
          db.insertKeyReviewAudit({
            keyReviewStateId: stateRow.id,
            eventType: 'user_accept',
            actorType: 'user',
            newValue: 'accepted',
          });
          keyReviewAuditCount++;
        }
      }

      if (rev.human_override_ai) {
        if (!existingAuditCheck.get(stateRow.id, 'user_override_ai', '')) {
          db.insertKeyReviewAudit({
            keyReviewStateId: stateRow.id,
            eventType: 'user_override_ai',
            actorType: 'user',
            newValue: 'override',
          });
          keyReviewAuditCount++;
        }
      }

      // key_review_runs when ai_review_model present (idempotent)
      if (rev.ai_review_model && rev.ai_review_status !== 'not_run') {
        if (!existingRunCheck.get(stateRow.id, rev.ai_review_model, rev.context_type)) {
          const runStatus = (rev.ai_review_status === 'accepted' || rev.ai_review_status === 'rejected') ? 'success' : 'failed';
          const runId = db.insertKeyReviewRun({
            keyReviewStateId: stateRow.id,
            stage: rev.context_type,
            status: runStatus,
            modelUsed: rev.ai_review_model,
            finishedAt: rev.ai_reviewed_at || null,
          });
          keyReviewRunCount++;

          // Link to source assertion (candidate_id = assertion_id)
          try {
            db.insertKeyReviewRunSource({
              keyReviewRunId: runId,
              assertionId: rev.candidate_id,
              packetRole: 'prime',
              position: 0,
            });
          } catch { /* assertion may not exist */ }
        }
      }
    }
  });
  tx();

  return {
    sourceRegistryCount,
    sourceAssertionCount,
    sourceEvidenceRefCount,
    keyReviewStateCount,
    keyReviewAuditCount,
    keyReviewRunCount,
  };
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function seedSpecDb({ db, config, category, fieldRules, logger }) {
  const start = Date.now();
  const errors = [];

  const fieldMeta = buildFieldMeta(fieldRules);

  // Step 1: Components
  const compResult = seedComponents(db, fieldRules);
  if (logger) {
    logger.log?.('info', `[seed] Components: ${compResult.identityCount} identities, ${compResult.aliasCount} aliases, ${compResult.valueCount} values`);
  }

  // Step 1a: Component overrides (must run after base components to overlay)
  const overrideResult = await seedComponentOverrides(db, config, category);
  if (logger && overrideResult.overrideCount > 0) {
    logger.log?.('info', `[seed] Component overrides: ${overrideResult.overrideCount} properties`);
  }

  // Step 2: List values
  const listResult = await seedListValues(db, fieldRules, config, category);
  if (logger) {
    logger.log?.('info', `[seed] List values: ${listResult.count}`);
  }

  // Steps 3-7: Per-product
  const productResult = await seedProducts(db, config, category, fieldRules, fieldMeta);
  if (productResult.errors.length > 0) {
    errors.push(...productResult.errors);
  }
  if (logger) {
    logger.log?.('info', `[seed] Products: ${productResult.productCount}, errors: ${productResult.errors.length}`);
  }

  // Step 4a: Backfill item_component_links from item_field_state + aliases
  const backfillResult = backfillComponentLinks(db, fieldMeta, fieldRules);
  if (logger && backfillResult.backfilled > 0) {
    logger.log?.('info', `[seed] Component link backfill: ${backfillResult.backfilled} links`);
  }

  // Step 5: Product catalog
  const catalogResult = await seedProductCatalog(db, config, category);
  if (logger && catalogResult.count > 0) {
    logger.log?.('info', `[seed] Product catalog: ${catalogResult.count} products`);
  }

  // Step 6: Queue state from JSON
  const queueResult = await seedQueueState(db, config, category);
  if (logger && queueResult.count > 0) {
    logger.log?.('info', `[seed] Queue state: ${queueResult.count} products`);
  }

  // Step 7: Curation suggestions from JSON
  const sugResult = await seedCurationSuggestions(db, config, category);
  if (logger && sugResult.count > 0) {
    logger.log?.('info', `[seed] Curation suggestions: ${sugResult.count}`);
  }

  // Step 8: Component review queue from JSON
  const crqResult = await seedComponentReviewQueue(db, config, category);
  if (logger && crqResult.count > 0) {
    logger.log?.('info', `[seed] Component review queue: ${crqResult.count}`);
  }

  // Step 9: Backfill source + key review tables from existing data
  const skrResult = seedSourceAndKeyReview(db, category, fieldMeta);
  if (logger) {
    logger.log?.('info', `[seed] Source & Key Review: ${skrResult.sourceRegistryCount} sources, ${skrResult.sourceAssertionCount} assertions, ${skrResult.keyReviewStateCount} review states, ${skrResult.keyReviewAuditCount} audit entries`);
  }

  const duration_ms = Date.now() - start;
  const counts = db.counts();

  return {
    category,
    counts,
    duration_ms,
    errors,
    components_seeded: compResult.identityCount,
    component_overrides_seeded: overrideResult.overrideCount,
    list_values_seeded: listResult.count,
    products_seeded: productResult.productCount,
    component_links_backfilled: backfillResult.backfilled,
    catalog_seeded: catalogResult.count,
    queue_seeded: queueResult.count,
    suggestions_seeded: sugResult.count,
    review_queue_seeded: crqResult.count,
    source_registry_seeded: skrResult.sourceRegistryCount,
    source_assertions_seeded: skrResult.sourceAssertionCount,
    source_evidence_refs_seeded: skrResult.sourceEvidenceRefCount,
    key_review_states_seeded: skrResult.keyReviewStateCount,
    key_review_audit_seeded: skrResult.keyReviewAuditCount,
    key_review_runs_seeded: skrResult.keyReviewRunCount,
  };
}
