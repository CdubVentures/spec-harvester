// ── Component Review Data Builder ────────────────────────────────────
//
// Mirrors reviewGridData.js patterns for component tables and enum lists.
// Three exported functions supply the review-components API endpoints.

import fs from 'node:fs/promises';
import path from 'node:path';
import { confidenceColor } from './confidenceColor.js';
import { evaluateVarianceBatch } from './varianceEvaluator.js';
import {
  buildSyntheticComponentCandidateId,
  buildWorkbookComponentCandidateId,
  buildPipelineEnumCandidateId,
  buildWorkbookEnumCandidateId
} from '../utils/candidateIdentifier.js';
import { buildComponentIdentifier } from '../utils/componentIdentifier.js';

function isObject(v) { return Boolean(v) && typeof v === 'object' && !Array.isArray(v); }
function toArray(v) { return Array.isArray(v) ? v : []; }
function slugify(v) { return String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function splitCandidateParts(v) {
  if (Array.isArray(v)) {
    const nested = v.flatMap((entry) => splitCandidateParts(entry));
    return [...new Set(nested)];
  }
  const text = String(v ?? '').trim();
  if (!text) return [];
  const parts = text.includes(',')
    ? text.split(',').map((part) => part.trim()).filter(Boolean)
    : [text];
  return [...new Set(parts)];
}

function isSharedLanePending(state, basePending = false) {
  const laneStatus = String(state?.ai_confirm_shared_status || '').trim().toLowerCase();
  const userAccepted = String(state?.user_accept_shared_status || '').trim().toLowerCase() === 'accepted';
  const userOverride = Boolean(state?.user_override_ai_shared);
  if (userAccepted || userOverride) return false;
  if (laneStatus) return laneStatus !== 'confirmed';
  return Boolean(basePending);
}

function toSpecDbCandidate(row, fallbackId) {
  const rawId = String(row?.candidate_id || fallbackId || '').trim();
  const productId = String(row?.product_id || '').trim();
  const candidateId = productId && rawId && !rawId.startsWith(`${productId}::`)
    ? `${productId}::${rawId}`
    : (rawId || `${fallbackId || 'specdb_candidate'}`);
  return {
    candidate_id: candidateId,
    value: row?.value ?? null,
    score: row?.score ?? 0,
    source_id: 'specdb',
    source: row?.source_host
      ? `${row.source_host}${productId ? ` (${productId})` : ''}`
      : `SpecDb${productId ? ` (${productId})` : ''}`,
    tier: row?.source_tier ?? null,
    method: row?.source_method || 'specdb_lookup',
    evidence: {
      url: row?.evidence_url || row?.source_url || '',
      snippet_id: row?.snippet_id || '',
      snippet_hash: row?.snippet_hash || '',
      quote: row?.quote || '',
      snippet_text: row?.snippet_text || '',
      source_id: 'specdb',
    },
  };
}

function appendAllSpecDbCandidates(target, rows, fallbackPrefix) {
  const existingIds = new Set(target.map((c) => String(c?.candidate_id || '')));
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const candidate = toSpecDbCandidate(row, `${fallbackPrefix}_${i}`);
    if (candidate.value == null || candidate.value === '') continue;
    if (existingIds.has(candidate.candidate_id)) continue;
    existingIds.add(candidate.candidate_id);
    target.push(candidate);
  }
}

async function safeReadJson(fp) {
  try { return JSON.parse(await fs.readFile(fp, 'utf8')); } catch { return null; }
}

async function listJsonFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isFile() && e.name.endsWith('.json')).map(e => e.name).sort();
  } catch { return []; }
}

// ── Layout ──────────────────────────────────────────────────────────

export async function buildComponentReviewLayout({ config = {}, category, specDb = null }) {
  if (!specDb) {
    return { category, types: [] };
  }
  const typeRows = specDb.getComponentTypeList();
  const types = typeRows.map(row => ({
    type: row.component_type,
    property_columns: specDb.getPropertyColumnsForType(row.component_type),
    item_count: row.item_count,
  }));
  return { category, types };
}

async function buildComponentReviewLayoutLegacy({ config = {}, category }) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const dbDir = path.join(helperRoot, category, '_generated', 'component_db');
  const files = await listJsonFiles(dbDir);

  const types = [];
  for (const f of files) {
    const data = await safeReadJson(path.join(dbDir, f));
    if (!data?.component_type || !Array.isArray(data.items)) continue;

    // Collect all property keys across items
    const propKeys = new Set();
    for (const item of data.items) {
      if (isObject(item.properties)) {
        for (const k of Object.keys(item.properties)) {
          if (!k.startsWith('__')) propKeys.add(k);
        }
      }
    }

    types.push({
      type: data.component_type,
      property_columns: [...propKeys].sort(),
      item_count: data.items.length,
    });
  }

  return { category, types };
}

// ── Component Payloads ──────────────────────────────────────────────

export async function buildComponentReviewPayloads({ config = {}, category, componentType, specDb = null }) {
  if (!specDb) {
    return {
      category,
      componentType,
      items: [],
      metrics: { total: 0, avg_confidence: 0, flags: 0 },
    };
  }
  return buildComponentReviewPayloadsSpecDb({ config, category, componentType, specDb });
}

// ── SpecDb-primary component payloads ────────────────────────────────

async function buildComponentReviewPayloadsSpecDb({ config = {}, category, componentType, specDb }) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');

  const allComponents = specDb.getAllComponentsForType(componentType);
  if (!allComponents.length) {
    return { category, componentType, items: [], metrics: { total: 0, avg_confidence: 0, flags: 0 } };
  }

  // Property columns from SpecDb
  const propertyColumns = specDb.getPropertyColumnsForType(componentType);

  // Still load pipeline component_review.json (kept for Phase 2 migration)
  const reviewPath = path.join(helperRoot, category, '_suggestions', 'component_review.json');
  const reviewDoc = await safeReadJson(reviewPath);
  const reviewItems = Array.isArray(reviewDoc?.items) ? reviewDoc.items : [];

  // Immutable workbook/import baseline for this component type.
  const workbookByIdentity = new Map();
  const workbookByName = new Map();
  try {
    const dbDir = path.join(helperRoot, category, '_generated', 'component_db');
    const dbFiles = await listJsonFiles(dbDir);
    for (const fileName of dbFiles) {
      const dbData = await safeReadJson(path.join(dbDir, fileName));
      if (!dbData || dbData.component_type !== componentType) continue;
      for (const item of toArray(dbData.items)) {
        const name = String(item?.name || '').trim();
        if (!name) continue;
        const maker = String(item?.maker || '').trim();
        const identityKey = `${name.toLowerCase()}::${maker.toLowerCase()}`;
        workbookByIdentity.set(identityKey, item);
        if (!workbookByName.has(name.toLowerCase())) {
          workbookByName.set(name.toLowerCase(), item);
        }
      }
      break;
    }
  } catch {
    // Best-effort workbook baseline only.
  }

  // Index review items by component name (case-insensitive)
  const dbNameLower = new Map();
  for (const comp of allComponents) {
    dbNameLower.set((comp.identity.canonical_name || '').toLowerCase(), comp.identity.canonical_name);
  }
  const reviewByComponent = new Map();
  for (const ri of reviewItems) {
    if (ri.status !== 'pending_ai') continue;
    if (ri.component_type !== componentType) continue;
    let dbName = null;
    if (ri.matched_component) {
      dbName = ri.matched_component;
    } else {
      const rawQuery = String(ri.raw_query || '').trim();
      dbName = dbNameLower.get(rawQuery.toLowerCase()) || rawQuery || null;
    }
    if (!dbName) continue;
    if (!reviewByComponent.has(dbName)) reviewByComponent.set(dbName, []);
    reviewByComponent.get(dbName).push(ri);
  }

  // Include unresolved component names seen in item field state and/or review queue.
  const existingNames = new Set(
    allComponents
      .map((c) => String(c?.identity?.canonical_name || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const unresolvedNames = new Set();

  for (const ri of reviewItems) {
    if (ri.status !== 'pending_ai') continue;
    if (ri.component_type !== componentType) continue;
    const hasMatchedComponent = Boolean(String(ri.matched_component || '').trim());
    const matchType = String(ri.match_type || '').trim().toLowerCase();
    if (hasMatchedComponent || (matchType && matchType !== 'new_component')) continue;
    const rawQuery = String(ri.raw_query || '').trim();
    if (!rawQuery) continue;
    if (!existingNames.has(rawQuery.toLowerCase())) unresolvedNames.add(rawQuery);
  }

  try {
    const distinctValues = specDb.getDistinctItemFieldValues(componentType);
    for (const row of distinctValues) {
      const value = String(row?.value || '').trim();
      if (!value) continue;
      if (!existingNames.has(value.toLowerCase())) unresolvedNames.add(value);
    }
  } catch {
    // Best-effort only
  }

  for (const unresolvedName of unresolvedNames) {
    const lower = unresolvedName.toLowerCase();
    if (existingNames.has(lower)) continue;
    allComponents.push({
      identity: {
        canonical_name: unresolvedName,
        maker: '',
        links: null,
        source: 'pipeline',
        review_status: 'pending',
        aliases_overridden: 0,
        created_at: null,
      },
      aliases: [],
      properties: [],
    });
    existingNames.add(lower);
  }

  const items = [];

  for (const comp of allComponents) {
    const { identity, aliases: aliasRows, properties: propRows } = comp;
    const itemName = identity.canonical_name;
    const itemMaker = identity.maker || '';
    const itemAliases = aliasRows
      .filter(a => a.alias !== itemName) // exclude canonical_name alias
      .map(a => a.alias);
    const aliasesOverridden = Boolean(identity.aliases_overridden);
    const reviewStatus = identity.review_status || 'pending';

    // Build property map from DB rows
    const propMap = {};
    for (const row of propRows) {
      propMap[row.property_key] = row;
    }
    const workbookIdentityKey = `${String(itemName || '').toLowerCase()}::${String(itemMaker || '').toLowerCase()}`;
    const workbookItem = workbookByIdentity.get(workbookIdentityKey)
      || workbookByName.get(String(itemName || '').toLowerCase())
      || null;
    const componentIdentifier = buildComponentIdentifier(componentType, itemName, itemMaker);
    let nameKeyState = null;
    let makerKeyState = null;
    let componentKeyStateByProperty = new Map();
    try {
      const keyStates = specDb.getKeyReviewStatesForComponent(componentIdentifier) || [];
      const byProperty = new Map(keyStates.map((state) => [String(state?.property_key || ''), state]));
      componentKeyStateByProperty = byProperty;
      nameKeyState = byProperty.get('__name') || null;
      makerKeyState = byProperty.get('__maker') || null;
    } catch {
      nameKeyState = null;
      makerKeyState = null;
      componentKeyStateByProperty = new Map();
    }

    // Build wb_* candidate helper
    const buildWbCandidate = (id, rawValue, dbGeneratedAt) => rawValue != null && rawValue !== '' ? [{
      candidate_id: id,
      value: rawValue,
      score: 1.0,
      source_id: 'workbook',
      source: 'Excel Import',
      tier: null,
      method: 'workbook_import',
      evidence: {
        url: '',
        retrieved_at: dbGeneratedAt || '',
        snippet_id: '',
        snippet_hash: '',
        quote: `Imported from ${category}Data.xlsm`,
        quote_span: null,
        snippet_text: `Imported from ${category}Data.xlsm`,
        source_id: 'workbook',
      },
    }] : [];

    // Name tracked state — derive from DB source
    const nameSource = identity.source || 'component_db';
    const nameIsOverridden = nameSource === 'user';
    const nameIsPipeline = nameSource === 'pipeline';
    const nameBaseConfidence = nameIsPipeline ? 0.6 : 1.0;
    const nameNeedsReview = isSharedLanePending(nameKeyState, nameIsPipeline);
    const workbookNameValue = String(workbookItem?.name || '').trim();
    const nameWbCandidates = workbookNameValue
      ? buildWbCandidate(
        buildWorkbookComponentCandidateId({
          componentType,
          componentName: itemName,
          propertyKey: '__name',
          value: workbookNameValue,
        }),
        workbookNameValue,
        identity.created_at
      )
      : [];
    const name_tracked = {
      selected: {
        value: nameKeyState?.selected_value ?? itemName,
        confidence: nameBaseConfidence,
        status: nameIsOverridden ? 'override' : (nameIsPipeline ? 'pipeline' : 'workbook'),
        color: confidenceColor(nameBaseConfidence, nameNeedsReview ? ['new_component'] : []),
      },
      needs_review: nameNeedsReview,
      reason_codes: nameIsOverridden ? ['manual_override'] : (nameNeedsReview ? ['new_component'] : []),
      source: nameIsOverridden ? 'user' : (nameIsPipeline ? 'pipeline' : 'workbook'),
      source_timestamp: null,
      variance_policy: null,
      constraints: [],
      overridden: nameIsOverridden,
      candidate_count: nameWbCandidates.length,
      candidates: nameWbCandidates,
      accepted_candidate_id: String(nameKeyState?.selected_candidate_id || '').trim() || null,
    };

    // Maker tracked state
    const makerIsOverridden = nameSource === 'user'; // identity source covers both name+maker
    const makerNeedsReview = isSharedLanePending(makerKeyState, !itemMaker && !makerIsOverridden);
    const workbookMakerValue = String(workbookItem?.maker || '').trim();
    const makerWbCandidates = workbookMakerValue ? buildWbCandidate(
      buildWorkbookComponentCandidateId({
        componentType,
        componentName: itemName,
        propertyKey: '__maker',
        value: workbookMakerValue,
      }),
      workbookMakerValue,
      identity.created_at
    ) : [];
    const maker_tracked = {
      selected: {
        value: makerKeyState?.selected_value ?? itemMaker,
        confidence: itemMaker ? 1.0 : 0,
        status: makerIsOverridden ? 'override' : (itemMaker ? 'workbook' : 'unknown'),
        color: confidenceColor(itemMaker ? 1.0 : 0, []),
      },
      needs_review: makerNeedsReview,
      reason_codes: makerIsOverridden ? ['manual_override'] : (makerNeedsReview ? ['new_component'] : []),
      source: makerIsOverridden ? 'user' : (itemMaker ? 'workbook' : 'unknown'),
      source_timestamp: null,
      variance_policy: null,
      constraints: [],
      overridden: makerIsOverridden,
      candidate_count: makerWbCandidates.length,
      candidates: makerWbCandidates,
      accepted_candidate_id: String(makerKeyState?.selected_candidate_id || '').trim() || null,
    };

    // Links tracked state
    const effectiveLinks = toArray(identity.links ? JSON.parse(identity.links) : []);
    const links_tracked = effectiveLinks.map((url) => ({
      selected: { value: url, confidence: 1.0, status: 'workbook', color: confidenceColor(1.0, []) },
      needs_review: false,
      reason_codes: [],
      source: 'workbook',
      source_timestamp: null,
      overridden: false,
    }));

    // Enrich name/maker candidates from pipeline review items
    const itemReviewItems = reviewByComponent.get(itemName) || [];
    if (itemReviewItems.length > 0) {
      // Name candidates from pipeline
      const nameByValue = new Map();
      for (const ri of itemReviewItems) {
        const val = (ri.raw_query || '').trim();
        if (!val) continue;
        if (!nameByValue.has(val)) nameByValue.set(val, { products: [], latest: '', matchType: ri.match_type, score: ri.combined_score || 0.5 });
        const entry = nameByValue.get(val);
        entry.products.push(ri.product_id);
        if (!entry.latest || ri.created_at > entry.latest) entry.latest = ri.created_at;
      }
      const existingNameVals = new Set(name_tracked.candidates.map(c => c.value));
      for (const [val, meta] of nameByValue) {
        if (existingNameVals.has(val)) continue;
        const count = meta.products.length;
        name_tracked.candidates.push({
          candidate_id: buildSyntheticComponentCandidateId({
            componentType,
            componentName: itemName,
            propertyKey: '__name',
            value: val,
          }),
          value: val, score: meta.score, source_id: 'pipeline',
          source: `Pipeline (${count} product${count !== 1 ? 's' : ''})`,
          tier: null, method: meta.matchType || 'component_review',
          evidence: {
            url: '', retrieved_at: meta.latest, snippet_id: '', snippet_hash: '',
            quote: `Extracted from ${count} product${count !== 1 ? 's' : ''}: ${meta.products.slice(0, 3).join(', ')}${count > 3 ? ` +${count - 3} more` : ''}`,
            quote_span: null, snippet_text: `Component ${meta.matchType === 'fuzzy_flagged' ? 'fuzzy matched' : 'not found in DB'}`,
            source_id: 'pipeline',
          },
        });
      }
      name_tracked.candidate_count = name_tracked.candidates.length;

      // Maker candidates from pipeline product_attributes
      const brandKey = `${componentType}_brand`;
      const makerByValue = new Map();
      for (const ri of itemReviewItems) {
        const attrs = isObject(ri.product_attributes) ? ri.product_attributes : {};
        const makerFromPipeline = attrs[brandKey] || attrs.ai_suggested_maker || ri.ai_suggested_maker;
        if (!makerFromPipeline) continue;
        for (const makerStr of splitCandidateParts(makerFromPipeline)) {
          if (!makerByValue.has(makerStr)) makerByValue.set(makerStr, { products: [], latest: '' });
          const entry = makerByValue.get(makerStr);
          entry.products.push(ri.product_id);
          if (!entry.latest || ri.created_at > entry.latest) entry.latest = ri.created_at;
        }
      }
      const existingMakerVals = new Set(maker_tracked.candidates.map(c => c.value));
      for (const [val, meta] of makerByValue) {
        if (existingMakerVals.has(val)) continue;
        const count = meta.products.length;
        maker_tracked.candidates.push({
          candidate_id: buildSyntheticComponentCandidateId({
            componentType,
            componentName: itemName,
            propertyKey: '__maker',
            value: val,
          }),
          value: val, score: 0.5, source_id: 'pipeline',
          source: `Pipeline (${count} product${count !== 1 ? 's' : ''})`,
          tier: null, method: 'product_extraction',
          evidence: {
            url: '', retrieved_at: meta.latest, snippet_id: '', snippet_hash: '',
            quote: `Extracted ${brandKey}="${val}" from ${count} product${count !== 1 ? 's' : ''}`,
            quote_span: null, snippet_text: 'Pipeline extraction from product runs',
            source_id: 'pipeline',
          },
        });
      }
      maker_tracked.candidate_count = maker_tracked.candidates.length;
    }

    // Build properties
    const properties = {};
    let itemConfSum = 0;
    let itemPropCount = 0;
    let itemFlags = 0;

    for (const key of propertyColumns) {
      const dbRow = propMap[key];
      const propertyKeyState = componentKeyStateByProperty.get(key) || null;
      const rawValue = propertyKeyState?.selected_value ?? dbRow?.value ?? null;
      const hasRawValue = rawValue !== null && rawValue !== '' && rawValue !== '-';
      const isOverridden = Boolean(dbRow?.overridden);
      const source = dbRow?.source || (hasRawValue ? 'component_db' : 'unknown');
      const confidence = hasRawValue || isOverridden ? (dbRow?.confidence ?? 1.0) : 0;
      const variance = dbRow?.variance_policy || null;
      const fieldConstraints = dbRow?.constraints ? JSON.parse(dbRow.constraints) : [];
      const baseNeedsReview = Boolean(dbRow?.needs_review) || (!hasRawValue && !isOverridden);
      const needsReview = isSharedLanePending(propertyKeyState, baseNeedsReview);
      const laneNeedsReview = propertyKeyState ? isSharedLanePending(propertyKeyState, false) : false;
      if (needsReview) itemFlags++;

      const reasonCodes = [];
      if (laneNeedsReview) reasonCodes.push('pending_ai');
      if (!hasRawValue && !isOverridden) reasonCodes.push('missing_value');
      if (isOverridden) reasonCodes.push('manual_override');
      for (const c of fieldConstraints) reasonCodes.push(`constraint:${c}`);

      // Workbook candidate (from component_db source rows)
      const workbookRawValue = workbookItem?.properties?.[key];
      const hasWorkbookRawValue = workbookRawValue !== undefined && workbookRawValue !== null && workbookRawValue !== '' && workbookRawValue !== '-';
      const wbCandidate = hasWorkbookRawValue ? [{
        candidate_id: buildWorkbookComponentCandidateId({
          componentType,
          componentName: itemName,
          propertyKey: key,
          value: workbookRawValue,
        }),
        value: workbookRawValue,
        score: 1.0,
        source_id: 'workbook',
        source: 'Excel Import',
        tier: null,
        method: 'workbook_import',
        evidence: {
          url: '', retrieved_at: '', snippet_id: '', snippet_hash: '',
          quote: `Imported from ${category}Data.xlsm`,
          quote_span: null, snippet_text: `Imported from ${category}Data.xlsm`,
          source_id: 'workbook',
        },
      }] : [];

      properties[key] = {
        slot_id: dbRow?.id ?? null,
        selected: {
          value: rawValue,
          confidence,
          status: isOverridden ? 'override' : (source === 'user' ? 'override' : (hasRawValue ? 'workbook' : 'unknown')),
          color: confidenceColor(confidence, reasonCodes),
        },
        needs_review: needsReview,
        reason_codes: reasonCodes,
        source: isOverridden ? 'user' : (source === 'component_db' ? 'workbook' : source),
        source_timestamp: null,
        variance_policy: variance,
        constraints: fieldConstraints,
        overridden: isOverridden,
        candidate_count: wbCandidate.length,
        candidates: wbCandidate,
        accepted_candidate_id: String(propertyKeyState?.selected_candidate_id || '').trim()
          || dbRow?.accepted_candidate_id
          || null,
      };

      itemConfSum += confidence;
      itemPropCount++;
    }

    // Pipeline property candidates from component_review items
    if (itemReviewItems.length > 0) {
      for (const key of propertyColumns) {
        const prop = properties[key];
        if (!prop) continue;
        const propByValue = new Map();
        for (const ri of itemReviewItems) {
          const attrs = isObject(ri.product_attributes) ? ri.product_attributes : {};
          const pipelineVal = attrs[key];
          if (pipelineVal === undefined || pipelineVal === null || pipelineVal === '') continue;
          for (const valStr of splitCandidateParts(pipelineVal)) {
            if (!propByValue.has(valStr)) propByValue.set(valStr, { products: [], latest: '' });
            const entry = propByValue.get(valStr);
            entry.products.push(ri.product_id);
            if (!entry.latest || ri.created_at > entry.latest) entry.latest = ri.created_at;
          }
        }
        const existingPropVals = new Set(prop.candidates.map(c => String(c.value)));
        for (const [val, meta] of propByValue) {
          if (existingPropVals.has(val)) continue;
          const count = meta.products.length;
          prop.candidates.push({
            candidate_id: buildSyntheticComponentCandidateId({
              componentType,
              componentName: itemName,
              propertyKey: key,
              value: val,
            }),
            value: val, score: 0.5, source_id: 'pipeline',
            source: `Pipeline (${count} product${count !== 1 ? 's' : ''})`,
            tier: null, method: 'product_extraction',
            evidence: {
              url: '', retrieved_at: meta.latest, snippet_id: '', snippet_hash: '',
              quote: `Extracted ${key}="${val}" from ${count} product${count !== 1 ? 's' : ''}`,
              quote_span: null, snippet_text: 'Pipeline extraction from product runs',
              source_id: 'pipeline',
            },
          });
        }
        prop.candidate_count = prop.candidates.length;
      }
    }

    // SpecDb enrichment: product-level candidates from SQLite
    let linkedProducts = [];
    try {
      const linkRows = specDb.getProductsForComponent(componentType, itemName, itemMaker);
      const productIds = linkRows.map(r => r.product_id);
      linkedProducts = linkRows.map(r => ({
        product_id: r.product_id,
        field_key: r.field_key,
        match_type: r.match_type || 'exact',
        match_score: r.match_score ?? null,
      }));

      if (productIds.length > 0) {
        const linkFieldKey = linkRows[0]?.field_key || componentType;
        const brandFieldKey = `${componentType}_brand`;

        // Name candidates from SpecDb
        const nameCandRows = specDb.getCandidatesForComponentProperty(componentType, itemName, itemMaker, linkFieldKey);
        if (nameCandRows.length > 0) {
          appendAllSpecDbCandidates(
            name_tracked.candidates,
            nameCandRows,
            `specdb_${componentType}_${slugify(itemName)}_name`
          );
          name_tracked.candidate_count = name_tracked.candidates.length;
        }

        // Maker candidates from SpecDb
        const makerCandRows = specDb.getCandidatesForComponentProperty(componentType, itemName, itemMaker, brandFieldKey);
        if (makerCandRows.length > 0) {
          appendAllSpecDbCandidates(
            maker_tracked.candidates,
            makerCandRows,
            `specdb_${componentType}_${slugify(itemName)}_maker`
          );
          maker_tracked.candidate_count = maker_tracked.candidates.length;
        }

        // Property candidates from SpecDb
        for (const key of propertyColumns) {
          const prop = properties[key];
          if (!prop) continue;
          const propCandRows = specDb.getCandidatesForComponentProperty(componentType, itemName, itemMaker, key);
          if (propCandRows.length > 0) {
            appendAllSpecDbCandidates(
              prop.candidates,
              propCandRows,
              `specdb_${componentType}_${slugify(itemName)}_${key}`
            );
            prop.candidate_count = prop.candidates.length;
          }
        }

        // Variance evaluation
        for (const key of propertyColumns) {
          const prop = properties[key];
          if (!prop) continue;
          const policy = prop.variance_policy;
          if (!policy || policy === 'override_allowed') continue;
          const dbValue = prop.selected?.value;
          if (dbValue == null) continue;
          const fieldStates = specDb.getItemFieldStateForProducts(productIds, [key]);
          if (!fieldStates.length) continue;
          const entries = fieldStates.map(s => ({ product_id: s.product_id, value: s.value }));
          const batch = evaluateVarianceBatch(policy, dbValue, entries);
          if (batch.summary.violations > 0) {
            if (!prop.reason_codes.includes('variance_violation')) {
              prop.reason_codes.push('variance_violation');
            }
            prop.needs_review = true;
            prop.variance_violations = {
              count: batch.summary.violations,
              total_products: batch.summary.total,
              products: batch.results
                .filter(r => !r.compliant)
                .slice(0, 5)
                .map(r => ({ product_id: r.product_id, value: r.value, reason: r.reason, details: r.details })),
            };
            itemFlags++;
          }
        }
      }
    } catch (_specDbErr) {
      // SpecDb enrichment is best-effort
    }

    const avgConf = itemPropCount > 0 ? itemConfSum / itemPropCount : 0;

    items.push({
      component_identity_id: identity.id ?? null,
      name: itemName,
      maker: itemMaker,
      aliases: itemAliases,
      aliases_overridden: aliasesOverridden,
      links: effectiveLinks,
      name_tracked,
      maker_tracked,
      links_tracked,
      properties,
      linked_products: linkedProducts,
      review_status: reviewStatus,
      metrics: {
        confidence: Math.round(avgConf * 100) / 100,
        flags: itemFlags,
        property_count: itemPropCount,
      },
    });
  }

  const visibleItems = items.filter((item) => {
    const linkedCount = Array.isArray(item.linked_products) ? item.linked_products.length : 0;
    const pipelineCandidateCount = item.name_tracked?.source === 'pipeline'
      ? Number(item.name_tracked?.candidate_count || 0)
      : 0;
    return linkedCount > 0 || pipelineCandidateCount > 0;
  });
  const visibleFlags = visibleItems.reduce((sum, item) => sum + (item.metrics?.flags || 0), 0);
  const visibleAvgConfidence = visibleItems.length > 0
    ? Math.round((visibleItems.reduce((sum, item) => sum + (item.metrics?.confidence || 0), 0) / visibleItems.length) * 100) / 100
    : 0;

  return {
    category,
    componentType,
    property_columns: propertyColumns,
    items: visibleItems,
    metrics: {
      total: visibleItems.length,
      avg_confidence: visibleAvgConfidence,
      flags: visibleFlags,
    },
  };
}

async function buildComponentReviewPayloadsLegacy({ config = {}, category, componentType, specDb = null }) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const dbDir = path.join(helperRoot, category, '_generated', 'component_db');
  const overrideDir = path.join(helperRoot, category, '_overrides', 'components');
  const files = await listJsonFiles(dbDir);

  let dbData = null;
  for (const f of files) {
    const data = await safeReadJson(path.join(dbDir, f));
    if (data?.component_type === componentType) { dbData = data; break; }
  }

  if (!dbData || !Array.isArray(dbData.items)) {
    return { category, componentType, items: [], metrics: { total: 0, avg_confidence: 0, flags: 0 } };
  }

  const dbGeneratedAt = dbData.generated_at || '';

  // Load overrides for this component type
  const overrides = {};
  const overrideFiles = await listJsonFiles(overrideDir);
  for (const of of overrideFiles) {
    if (of.startsWith(`${componentType}_`)) {
      const ovr = await safeReadJson(path.join(overrideDir, of));
      if (ovr?.name) overrides[ovr.name] = ovr;
    }
  }

  // Load identity observations for pipeline candidates on name/maker
  const identityPath = path.join(helperRoot, category, '_suggestions', 'component_identity.json');
  const identityDoc = await safeReadJson(identityPath);
  const identityObs = Array.isArray(identityDoc?.observations) ? identityDoc.observations : [];

  // Index identity observations by component_type + canonical_name
  const identityByComponent = new Map();
  for (const obs of identityObs) {
    if (obs.component_type !== componentType) continue;
    const name = (obs.canonical_name || '').trim();
    if (!name) continue;
    if (!identityByComponent.has(name)) identityByComponent.set(name, []);
    identityByComponent.get(name).push(obs);
  }

  // Load component_review.json for pipeline candidates (product_attributes)
  const reviewPath = path.join(helperRoot, category, '_suggestions', 'component_review.json');
  const reviewDoc = await safeReadJson(reviewPath);
  const reviewItems = Array.isArray(reviewDoc?.items) ? reviewDoc.items : [];

  // Index review items by component name (case-insensitive) for this component type
  // Includes both fuzzy_flagged (matched_component) and new_component (raw_query matches DB name)
  const dbNameLower = new Map(); // lowercase → actual DB name
  for (const dbItem of dbData.items) {
    dbNameLower.set((dbItem.name || '').toLowerCase(), dbItem.name);
  }
  const reviewByComponent = new Map(); // actual DB name → review items[]
  for (const ri of reviewItems) {
    if (ri.status !== 'pending_ai') continue;
    if (ri.component_type !== componentType) continue;
    // Match via matched_component (fuzzy_flagged) or raw_query (new_component matching DB name)
    let dbName = null;
    if (ri.matched_component) {
      dbName = ri.matched_component;
    } else {
      dbName = dbNameLower.get((ri.raw_query || '').toLowerCase()) || null;
    }
    if (!dbName) continue;
    if (!reviewByComponent.has(dbName)) reviewByComponent.set(dbName, []);
    reviewByComponent.get(dbName).push(ri);
  }

  // Collect all property keys
  const allPropKeys = new Set();
  for (const item of dbData.items) {
    if (isObject(item.properties)) {
      for (const k of Object.keys(item.properties)) {
        if (!k.startsWith('__')) allPropKeys.add(k);
      }
    }
  }
  const propertyColumns = [...allPropKeys].sort();

  const items = [];
  let totalConf = 0;
  let totalFlags = 0;

  for (const item of dbData.items) {
    const props = isObject(item.properties) ? item.properties : {};
    const variancePolicies = isObject(item.__variance_policies) ? item.__variance_policies : {};
    const constraints = isObject(item.__constraints) ? item.__constraints : {};
    const override = overrides[item.name] || null;

    // Identity overrides
    const nameOverride = override?.identity?.name;
    const makerOverride = override?.identity?.maker;
    const linksOverride = override?.identity?.links;
    const overrideTimestamps = isObject(override?.timestamps) ? override.timestamps : {};

    // Build tracked state for name
    const nameVal = nameOverride ?? item.name ?? '';
    const nameHasRaw = Boolean(item.name);
    const nameHasOverride = nameOverride !== undefined;
    // Generate workbook candidate for name when value comes from compiled workbook
    const nameWbCandidate = nameHasRaw ? [{
      candidate_id: buildWorkbookComponentCandidateId({
        componentType,
        componentName: item.name,
        propertyKey: '__name',
        value: item.name,
      }),
      value: item.name,
      score: 1.0,
      source_id: 'workbook',
      source: 'Excel Import',
      tier: null,
      method: 'workbook_import',
      evidence: {
        url: '',
        retrieved_at: dbGeneratedAt,
        snippet_id: '',
        snippet_hash: '',
        quote: `Imported from ${category}Data.xlsm`,
        quote_span: null,
        snippet_text: `Imported from ${category}Data.xlsm`,
        source_id: 'workbook',
      },
    }] : [];

    const name_tracked = {
      selected: {
        value: nameVal,
        confidence: nameHasOverride ? 1.0 : nameHasRaw ? 1.0 : 0,
        status: nameHasOverride ? 'override' : nameHasRaw ? 'workbook' : 'unknown',
        color: confidenceColor(nameHasOverride ? 1.0 : nameHasRaw ? 1.0 : 0, []),
      },
      needs_review: !nameHasRaw && !nameHasOverride,
      reason_codes: nameHasOverride ? ['manual_override'] : [],
      source: nameHasOverride ? 'user' : (nameHasRaw ? 'workbook' : 'unknown'),
      source_timestamp: nameHasOverride ? (overrideTimestamps['__name'] || override?.updated_at || null) : null,
      variance_policy: null,
      constraints: [],
      overridden: nameHasOverride,
      candidate_count: nameWbCandidate.length,
      candidates: nameWbCandidate,
      accepted_candidate_id: null,
    };

    // Enrich name candidates with pipeline identity observations
    const nameObservations = identityByComponent.get(item.name) || [];
    if (nameObservations.length > 0) {
      const pipelineNameCandidate = {
        candidate_id: buildSyntheticComponentCandidateId({
          componentType,
          componentName: item.name,
          propertyKey: '__name_identity',
          value: item.name,
        }),
        value: item.name,
        score: 1.0,
        source_id: 'pipeline',
        source: 'Pipeline (identity match)',
        tier: null,
        method: 'identity_observation',
        evidence: {
          url: '',
          retrieved_at: nameObservations[0].observed_at || '',
          snippet_id: '',
          snippet_hash: '',
          quote: `Matched ${nameObservations.length} time${nameObservations.length !== 1 ? 's' : ''} across products`,
          quote_span: null,
          snippet_text: `Resolved via ${nameObservations[0].match_type || 'exact'} match`,
          source_id: 'pipeline',
        },
      };
      // Avoid duplicating if workbook candidate already present with same value
      if (!name_tracked.candidates.some((c) => c.value === pipelineNameCandidate.value && c.source_id === 'pipeline')) {
        name_tracked.candidates.push(pipelineNameCandidate);
        name_tracked.candidate_count = name_tracked.candidates.length;
      }
    }

    // Enrich name/maker candidates from component_review items (pipeline product extractions)
    // Consolidate by unique value — multiple products with same value become one candidate with count
    const itemReviewItems = reviewByComponent.get(item.name) || [];
    if (itemReviewItems.length > 0) {
      // Group name values across products
      const nameByValue = new Map(); // value → { products: string[], latest: string, matchType: string, score: number }
      for (const ri of itemReviewItems) {
        const val = (ri.raw_query || '').trim();
        if (!val) continue;
        if (!nameByValue.has(val)) nameByValue.set(val, { products: [], latest: '', matchType: ri.match_type, score: ri.combined_score || 0.5 });
        const entry = nameByValue.get(val);
        entry.products.push(ri.product_id);
        if (!entry.latest || ri.created_at > entry.latest) entry.latest = ri.created_at;
      }
      const existingNameCandidateValues = new Set(name_tracked.candidates.map(c => c.value));
      for (const [val, meta] of nameByValue) {
        if (existingNameCandidateValues.has(val)) continue;
        const count = meta.products.length;
        name_tracked.candidates.push({
          candidate_id: buildSyntheticComponentCandidateId({
            componentType,
            componentName: item.name,
            propertyKey: '__name',
            value: val,
          }),
          value: val,
          score: meta.score,
          source_id: 'pipeline',
          source: `Pipeline (${count} product${count !== 1 ? 's' : ''})`,
          tier: null,
          method: meta.matchType || 'component_review',
          evidence: {
            url: '',
            retrieved_at: meta.latest,
            snippet_id: '',
            snippet_hash: '',
            quote: `Extracted from ${count} product${count !== 1 ? 's' : ''}: ${meta.products.slice(0, 3).join(', ')}${count > 3 ? ` +${count - 3} more` : ''}`,
            quote_span: null,
            snippet_text: `Component ${meta.matchType === 'fuzzy_flagged' ? 'fuzzy matched' : 'not found in DB'}`,
            source_id: 'pipeline',
          },
        });
      }
      name_tracked.candidate_count = name_tracked.candidates.length;
    }

    // Build tracked state for maker
    const makerVal = makerOverride ?? item.maker ?? '';
    const makerHasRaw = Boolean(item.maker);
    const makerHasOverride = makerOverride !== undefined;
    // Generate workbook candidate for maker when value comes from compiled workbook
    const makerWbCandidate = makerHasRaw ? [{
      candidate_id: buildWorkbookComponentCandidateId({
        componentType,
        componentName: item.name,
        propertyKey: '__maker',
        value: item.maker,
      }),
      value: item.maker,
      score: 1.0,
      source_id: 'workbook',
      source: 'Excel Import',
      tier: null,
      method: 'workbook_import',
      evidence: {
        url: '',
        retrieved_at: dbGeneratedAt,
        snippet_id: '',
        snippet_hash: '',
        quote: `Imported from ${category}Data.xlsm`,
        quote_span: null,
        snippet_text: `Imported from ${category}Data.xlsm`,
        source_id: 'workbook',
      },
    }] : [];

    const maker_tracked = {
      selected: {
        value: makerVal,
        confidence: makerHasOverride ? 1.0 : makerHasRaw ? 1.0 : 0,
        status: makerHasOverride ? 'override' : makerHasRaw ? 'workbook' : 'unknown',
        color: confidenceColor(makerHasOverride ? 1.0 : makerHasRaw ? 1.0 : 0, []),
      },
      needs_review: !makerHasRaw && !makerHasOverride,
      reason_codes: makerHasOverride ? ['manual_override'] : [],
      source: makerHasOverride ? 'user' : (makerHasRaw ? 'workbook' : 'unknown'),
      source_timestamp: makerHasOverride ? (overrideTimestamps['__maker'] || override?.updated_at || null) : null,
      variance_policy: null,
      constraints: [],
      overridden: makerHasOverride,
      candidate_count: makerWbCandidate.length,
      candidates: makerWbCandidate,
      accepted_candidate_id: null,
    };

    // Enrich maker candidates from pipeline product_attributes (e.g. sensor_brand, switch_brand)
    if (itemReviewItems.length > 0) {
      const brandKey = `${componentType}_brand`;
      const makerByValue = new Map();
      for (const ri of itemReviewItems) {
        const attrs = isObject(ri.product_attributes) ? ri.product_attributes : {};
        const makerFromPipeline = attrs[brandKey] || attrs.ai_suggested_maker || ri.ai_suggested_maker;
        if (!makerFromPipeline) continue;
        for (const makerStr of splitCandidateParts(makerFromPipeline)) {
          if (!makerByValue.has(makerStr)) makerByValue.set(makerStr, { products: [], latest: '' });
          const entry = makerByValue.get(makerStr);
          entry.products.push(ri.product_id);
          if (!entry.latest || ri.created_at > entry.latest) entry.latest = ri.created_at;
        }
      }
      const existingMakerValues = new Set(maker_tracked.candidates.map(c => c.value));
      for (const [val, meta] of makerByValue) {
        if (existingMakerValues.has(val)) continue;
        const count = meta.products.length;
        maker_tracked.candidates.push({
          candidate_id: buildSyntheticComponentCandidateId({
            componentType,
            componentName: item.name,
            propertyKey: '__maker',
            value: val,
          }),
          value: val,
          score: 0.5,
          source_id: 'pipeline',
          source: `Pipeline (${count} product${count !== 1 ? 's' : ''})`,
          tier: null,
          method: 'product_extraction',
          evidence: {
            url: '',
            retrieved_at: meta.latest,
            snippet_id: '',
            snippet_hash: '',
            quote: `Extracted ${brandKey}="${val}" from ${count} product${count !== 1 ? 's' : ''}`,
            quote_span: null,
            snippet_text: `Pipeline extraction from product runs`,
            source_id: 'pipeline',
          },
        });
      }
      maker_tracked.candidate_count = maker_tracked.candidates.length;
    }

    // Build tracked state for links
    const effectiveLinks = linksOverride ?? toArray(item.links);
    const linksTimestamp = linksOverride ? (overrideTimestamps['__links'] || override?.updated_at || null) : null;
    const links_tracked = effectiveLinks.map((url) => ({
      selected: {
        value: url,
        confidence: linksOverride ? 1.0 : 1.0,
        status: linksOverride ? 'override' : 'workbook',
        color: confidenceColor(linksOverride ? 1.0 : 1.0, []),
      },
      needs_review: false,
      reason_codes: linksOverride ? ['manual_override'] : [],
      source: linksOverride ? 'user' : 'workbook',
      source_timestamp: linksTimestamp,
      overridden: Boolean(linksOverride),
    }));

    const properties = {};
    let itemConfSum = 0;
    let itemPropCount = 0;
    let itemFlags = 0;

    for (const key of propertyColumns) {
      const rawValue = props[key];
      const hasRawValue = rawValue !== undefined && rawValue !== null && rawValue !== '' && rawValue !== '-';
      const overrideValue = override?.properties?.[key];
      const hasOverride = overrideValue !== undefined;
      const value = hasOverride ? overrideValue : rawValue;
      const variance = variancePolicies[key] || null;
      const fieldConstraints = toArray(constraints[key]);

      // Confidence + source based on provenance
      // Source reflects ORIGINAL provenance (never 'override') — the overridden flag handles user actions
      let confidence, source;
      if (hasOverride) {
        confidence = 1.0;
        source = 'user';
      } else if (hasRawValue) {
        confidence = 1.0;
        source = 'workbook';
      } else {
        confidence = 0;
        source = 'unknown';
      }

      const needsReview = !hasRawValue && !hasOverride;
      if (needsReview) itemFlags++;

      // Build reason codes (matches reviewGridData.js pattern)
      const reasonCodes = [];
      if (needsReview) reasonCodes.push('missing_value');
      if (hasOverride) reasonCodes.push('manual_override');
      for (const c of fieldConstraints) reasonCodes.push(`constraint:${c}`);

      // Generate workbook candidate when value comes from compiled workbook
      const wbCandidate = hasRawValue ? [{
        candidate_id: buildWorkbookComponentCandidateId({
          componentType,
          componentName: item.name,
          propertyKey: key,
          value: rawValue,
        }),
        value: rawValue,
        score: 1.0,
        source_id: 'workbook',
        source: 'Excel Import',
        tier: null,
        method: 'workbook_import',
        evidence: {
          url: '',
          retrieved_at: dbGeneratedAt,
          snippet_id: '',
          snippet_hash: '',
          quote: `Imported from ${category}Data.xlsm`,
          quote_span: null,
          snippet_text: `Imported from ${category}Data.xlsm`,
          source_id: 'workbook',
        },
      }] : [];

      properties[key] = {
        selected: {
          value: value ?? null,
          confidence,
          status: source,
          color: confidenceColor(confidence, reasonCodes),
        },
        needs_review: needsReview,
        reason_codes: reasonCodes,
        source,
        source_timestamp: hasOverride ? (overrideTimestamps[key] || override?.updated_at || null) : null,
        variance_policy: variance,
        constraints: fieldConstraints,
        overridden: hasOverride,
        candidate_count: wbCandidate.length,
        candidates: wbCandidate,
        accepted_candidate_id: null,
      };

      itemConfSum += confidence;
      itemPropCount++;
    }

    // Enrich property candidates from pipeline product_attributes (consolidated by value)
    if (itemReviewItems.length > 0) {
      for (const key of propertyColumns) {
        const prop = properties[key];
        if (!prop) continue;
        const propByValue = new Map();
        for (const ri of itemReviewItems) {
          const attrs = isObject(ri.product_attributes) ? ri.product_attributes : {};
          const pipelineVal = attrs[key];
          if (pipelineVal === undefined || pipelineVal === null || pipelineVal === '') continue;
          for (const valStr of splitCandidateParts(pipelineVal)) {
            if (!propByValue.has(valStr)) propByValue.set(valStr, { products: [], latest: '' });
            const entry = propByValue.get(valStr);
            entry.products.push(ri.product_id);
            if (!entry.latest || ri.created_at > entry.latest) entry.latest = ri.created_at;
          }
        }
        const existingPropValues = new Set(prop.candidates.map(c => String(c.value)));
        for (const [val, meta] of propByValue) {
          if (existingPropValues.has(val)) continue;
          const count = meta.products.length;
          prop.candidates.push({
            candidate_id: buildSyntheticComponentCandidateId({
              componentType,
              componentName: item.name,
              propertyKey: key,
              value: val,
            }),
            value: val,
            score: 0.5,
            source_id: 'pipeline',
            source: `Pipeline (${count} product${count !== 1 ? 's' : ''})`,
            tier: null,
            method: 'product_extraction',
            evidence: {
              url: '',
              retrieved_at: meta.latest,
              snippet_id: '',
              snippet_hash: '',
              quote: `Extracted ${key}="${val}" from ${count} product${count !== 1 ? 's' : ''}`,
              quote_span: null,
              snippet_text: `Pipeline extraction from product runs`,
              source_id: 'pipeline',
            },
          });
        }
        prop.candidate_count = prop.candidates.length;
      }
    }

    // ── SpecDb enrichment: product-level candidates from SQLite ──────
    let linkedProducts = [];
    if (specDb) {
      try {
        const linkRows = specDb.getProductsForComponent(componentType, item.name, item.maker || '');
        const productIds = linkRows.map(r => r.product_id);
        linkedProducts = linkRows.map(r => ({
          product_id: r.product_id,
          field_key: r.field_key,
          match_type: r.match_type || 'exact',
          match_score: r.match_score ?? null,
        }));

        if (productIds.length > 0) {
          // Determine field_key for name from link rows (e.g. 'sensor')
          const linkFieldKey = linkRows[0]?.field_key || componentType;
          const brandFieldKey = `${componentType}_brand`;

          // --- Name candidates from SpecDb ---
          const nameCandRows = specDb.getCandidatesForComponentProperty(componentType, item.name, item.maker || '', linkFieldKey);
          if (nameCandRows.length > 0) {
            const nameByVal = new Map();
            for (const c of nameCandRows) {
              const v = (c.value || '').trim();
              if (!v) continue;
              if (!nameByVal.has(v)) nameByVal.set(v, { rows: [], count: 0 });
              const entry = nameByVal.get(v);
              entry.rows.push(c);
              entry.count++;
            }
            const existingNameVals = new Set(name_tracked.candidates.map(c => c.value));
            for (const [val, meta] of nameByVal) {
              if (existingNameVals.has(val)) continue;
              const best = meta.rows[0];
              const count = meta.count;
              name_tracked.candidates.push({
                candidate_id: `specdb_${componentType}_${slugify(item.name)}_name_${slugify(val)}`,
                value: val,
                score: best.score ?? 0,
                source_id: 'specdb',
                source: `${best.source_host || 'SpecDb'} (${count} product${count !== 1 ? 's' : ''})`,
                tier: best.source_tier ?? null,
                method: best.source_method || 'specdb_lookup',
                evidence: {
                  url: best.evidence_url || best.source_url || '',
                  snippet_id: best.snippet_id || '',
                  snippet_hash: best.snippet_hash || '',
                  quote: best.quote || '',
                  snippet_text: best.snippet_text || '',
                  source_id: 'specdb',
                },
              });
            }
            name_tracked.candidate_count = name_tracked.candidates.length;
          }

          // --- Maker candidates from SpecDb ---
          const makerCandRows = specDb.getCandidatesForComponentProperty(componentType, item.name, item.maker || '', brandFieldKey);
          if (makerCandRows.length > 0) {
            const makerByVal = new Map();
            for (const c of makerCandRows) {
              const v = (c.value || '').trim();
              if (!v) continue;
              if (!makerByVal.has(v)) makerByVal.set(v, { rows: [], count: 0 });
              const entry = makerByVal.get(v);
              entry.rows.push(c);
              entry.count++;
            }
            const existingMakerVals = new Set(maker_tracked.candidates.map(c => c.value));
            for (const [val, meta] of makerByVal) {
              if (existingMakerVals.has(val)) continue;
              const best = meta.rows[0];
              const count = meta.count;
              maker_tracked.candidates.push({
                candidate_id: `specdb_${componentType}_${slugify(item.name)}_maker_${slugify(val)}`,
                value: val,
                score: best.score ?? 0,
                source_id: 'specdb',
                source: `${best.source_host || 'SpecDb'} (${count} product${count !== 1 ? 's' : ''})`,
                tier: best.source_tier ?? null,
                method: best.source_method || 'specdb_lookup',
                evidence: {
                  url: best.evidence_url || best.source_url || '',
                  snippet_id: best.snippet_id || '',
                  snippet_hash: best.snippet_hash || '',
                  quote: best.quote || '',
                  snippet_text: best.snippet_text || '',
                  source_id: 'specdb',
                },
              });
            }
            maker_tracked.candidate_count = maker_tracked.candidates.length;
          }

          // --- Property candidates from SpecDb (key = field_key, 1:1 mapping) ---
          for (const key of propertyColumns) {
            const prop = properties[key];
            if (!prop) continue;
            const propCandRows = specDb.getCandidatesForComponentProperty(componentType, item.name, item.maker || '', key);
            if (propCandRows.length > 0) {
              const propByVal = new Map();
              for (const c of propCandRows) {
                const v = (c.value || '').trim();
                if (!v) continue;
                if (!propByVal.has(v)) propByVal.set(v, { rows: [], count: 0 });
                const entry = propByVal.get(v);
                entry.rows.push(c);
                entry.count++;
              }
              const existingPropVals = new Set(prop.candidates.map(c => String(c.value)));
              for (const [val, meta] of propByVal) {
                if (existingPropVals.has(val)) continue;
                const best = meta.rows[0];
                const count = meta.count;
                prop.candidates.push({
                  candidate_id: `specdb_${componentType}_${slugify(item.name)}_${key}_${slugify(val)}`,
                  value: val,
                  score: best.score ?? 0,
                  source_id: 'specdb',
                  source: `${best.source_host || 'SpecDb'} (${count} product${count !== 1 ? 's' : ''})`,
                  tier: best.source_tier ?? null,
                  method: best.source_method || 'specdb_lookup',
                  evidence: {
                    url: best.evidence_url || best.source_url || '',
                    snippet_id: best.snippet_id || '',
                    snippet_hash: best.snippet_hash || '',
                    quote: best.quote || '',
                    snippet_text: best.snippet_text || '',
                    source_id: 'specdb',
                  },
                });
              }
              prop.candidate_count = prop.candidates.length;
            }
          }

          // --- Variance evaluation ---
          for (const key of propertyColumns) {
            const prop = properties[key];
            if (!prop) continue;
            const policy = prop.variance_policy;
            if (!policy || policy === 'override_allowed') continue;
            const dbValue = prop.selected?.value;
            if (dbValue == null) continue;
            const fieldStates = specDb.getItemFieldStateForProducts(productIds, [key]);
            if (!fieldStates.length) continue;
            const entries = fieldStates.map(s => ({ product_id: s.product_id, value: s.value }));
            const batch = evaluateVarianceBatch(policy, dbValue, entries);
            if (batch.summary.violations > 0) {
              if (!prop.reason_codes.includes('variance_violation')) {
                prop.reason_codes.push('variance_violation');
              }
              prop.needs_review = true;
              prop.variance_violations = {
                count: batch.summary.violations,
                total_products: batch.summary.total,
                products: batch.results
                  .filter(r => !r.compliant)
                  .slice(0, 5)
                  .map(r => ({ product_id: r.product_id, value: r.value, reason: r.reason, details: r.details })),
              };
              itemFlags++;
            }
          }
        }
      } catch (_specDbErr) {
        // SpecDb enrichment is best-effort — don't break the drawer
      }
    }

    const avgConf = itemPropCount > 0 ? itemConfSum / itemPropCount : 0;
    totalConf += avgConf;
    totalFlags += itemFlags;

    const aliasOverride = override?.identity?.aliases;
    const effectiveAliases = aliasOverride ?? toArray(item.aliases);
    const aliasesOverridden = Boolean(aliasOverride);

    items.push({
      component_identity_id: null,
      name: nameVal || item.name || '',
      maker: makerVal || item.maker || '',
      aliases: effectiveAliases,
      aliases_overridden: aliasesOverridden,
      links: effectiveLinks,
      name_tracked,
      maker_tracked,
      links_tracked,
      properties,
      linked_products: linkedProducts,
      review_status: override?.review_status || 'pending',
      metrics: {
        confidence: Math.round(avgConf * 100) / 100,
        flags: itemFlags,
        property_count: itemPropCount,
      },
    });
  }

  return {
    category,
    componentType,
    property_columns: propertyColumns,
    items,
    metrics: {
      total: items.length,
      avg_confidence: items.length > 0 ? Math.round((totalConf / items.length) * 100) / 100 : 0,
      flags: totalFlags,
    },
  };
}

// ── Enum Payloads ───────────────────────────────────────────────────

export async function buildEnumReviewPayloads({ config = {}, category, specDb = null }) {
  if (!specDb) {
    return { category, fields: [] };
  }
  return buildEnumReviewPayloadsSpecDb({ config, category, specDb });
}

// ── SpecDb-primary enum payloads ─────────────────────────────────────

async function buildEnumReviewPayloadsSpecDb({ config = {}, category, specDb }) {
  const fieldKeys = specDb.getAllEnumFields();
  const fields = [];

  for (const field of fieldKeys) {
    const enumListRow = specDb.getEnumList(field);
    const listRows = specDb.getListValues(field);
    const valueMap = new Map();

    for (const row of listRows) {
      const normalized = String(row.value).trim().toLowerCase();
      if (!normalized) continue;

      const enumKeyState = specDb.getKeyReviewState({
        category,
        targetKind: 'enum_key',
        fieldKey: field,
        enumValueNorm: normalized,
      });
      const basePending = Boolean(row.needs_review);
      const isPending = isSharedLanePending(enumKeyState, basePending);
      const source = row.source || 'known_values';
      const confidence = isPending ? 0.6 : 1.0;
      const color = isPending ? 'yellow' : 'green';

      // Build candidate based on source
      const candidates = [];
      if (source === 'pipeline') {
        candidates.push({
          candidate_id: buildPipelineEnumCandidateId({ fieldKey: field, value: row.value }),
          value: row.value,
          score: isPending ? 0.6 : 1.0,
          source_id: 'pipeline',
          source: 'Pipeline',
          tier: null,
          method: 'pipeline_extraction',
          evidence: {
            url: '', retrieved_at: row.source_timestamp || '',
            snippet_id: '', snippet_hash: '',
            quote: isPending ? 'Discovered by pipeline' : 'Discovered by pipeline, accepted by user',
            quote_span: null,
            snippet_text: isPending ? 'Discovered by pipeline' : 'Discovered by pipeline, accepted by user',
            source_id: 'pipeline',
          },
        });
      } else if (source !== 'manual') {
        candidates.push({
          candidate_id: buildWorkbookEnumCandidateId({ fieldKey: field, value: row.value }),
          value: row.value,
          score: 1.0,
          source_id: 'workbook',
          source: 'Excel Import',
          tier: null,
          method: 'workbook_import',
          evidence: {
            url: '', retrieved_at: '',
            snippet_id: '', snippet_hash: '',
            quote: `Imported from ${category}Data.xlsm`,
            quote_span: null,
            snippet_text: `Imported from ${category}Data.xlsm`,
            source_id: 'workbook',
          },
        });
      }

      const entry = {
        list_value_id: row.id ?? null,
        enum_list_id: row.list_id ?? null,
        value: row.value,
        source,
        source_timestamp: row.source_timestamp || null,
        confidence,
        color,
        needs_review: isPending,
        candidates,
        normalized_value: row.normalized_value || null,
        enum_policy: row.enum_policy || null,
        accepted_candidate_id: String(enumKeyState?.selected_candidate_id || '').trim()
          || row.accepted_candidate_id
          || null,
      };

      // SpecDb enrichment: linked products and additional candidates
      try {
        let productRows = specDb.getProductsForListValue(field, row.value);
        if (!productRows.length) {
          productRows = specDb.getProductsForFieldValue(field, row.value);
        }
        if (productRows.length > 0) {
          entry.linked_products = productRows.map(r => ({
            product_id: r.product_id,
            field_key: r.field_key,
          }));
        }

        let candRows = specDb.getCandidatesByListValue(field, row.id);
        if (!candRows.length) {
          candRows = specDb.getCandidatesForFieldValue(field, row.value);
        }
        if (candRows.length > 0) {
          appendAllSpecDbCandidates(
            entry.candidates,
            candRows,
            `specdb_enum_${slugify(field)}_${slugify(row.value)}`
          );
        }
      } catch (_) {
        // Best-effort enrichment
      }

      valueMap.set(normalized, entry);
    }

    const values = [...valueMap.values()].sort((a, b) => a.value.localeCompare(b.value));
    const flagCount = values.filter(v => v.needs_review).length;

    fields.push({
      field,
      enum_list_id: enumListRow?.id ?? null,
      values,
      metrics: { total: values.length, flags: flagCount },
    });
  }

  return { category, fields };
}

async function buildEnumReviewPayloadsLegacy({ config = {}, category, specDb = null }) {
  const helperRoot = path.resolve(config.helperFilesRoot || 'helper_files');
  const kvPath = path.join(helperRoot, category, '_generated', 'known_values.json');
  const suggestPath = path.join(helperRoot, category, '_suggestions', 'enums.json');
  const wbMapPath = path.join(helperRoot, category, '_control_plane', 'workbook_map.json');

  const kv = await safeReadJson(kvPath);
  const suggestions = await safeReadJson(suggestPath);
  const wbMap = await safeReadJson(wbMapPath);

  const kvFields = isObject(kv?.fields) ? kv.fields : {};
  const kvGeneratedAt = kv?.generated_at || '';

  // Build a lookup of manually added enum values (user-accepted or user-added)
  const manualEnumValues = isObject(wbMap?.manual_enum_values) ? wbMap.manual_enum_values : {};
  const manualEnumTimestamps = isObject(wbMap?.manual_enum_timestamps) ? wbMap.manual_enum_timestamps : {};
  const manualLookup = {};
  for (const [f, vals] of Object.entries(manualEnumValues)) {
    manualLookup[f] = new Set(toArray(vals).map(v => String(v).trim().toLowerCase()));
  }

  // Parse suggestions — handle both formats:
  // Old format: { fields: { fieldKey: [values] } }
  // Curation format: { suggestions: [{ field_key, value, ... }] }
  const sugByField = {};
  // Track ALL values that originally came from pipeline (including accepted ones)
  // so we can preserve their original source='pipeline' even after acceptance
  const pipelineOriginByField = {};
  if (isObject(suggestions?.fields)) {
    for (const [f, vals] of Object.entries(suggestions.fields)) {
      sugByField[f] = toArray(vals);
      if (!pipelineOriginByField[f]) pipelineOriginByField[f] = new Set();
      for (const v of toArray(vals)) {
        pipelineOriginByField[f].add(String(v).trim().toLowerCase());
      }
    }
  }
  if (Array.isArray(suggestions?.suggestions)) {
    for (const s of suggestions.suggestions) {
      const fk = String(s?.field_key || '').trim();
      const val = String(s?.value || '').trim();
      if (!fk || !val) continue;
      // Track pipeline origin for ALL suggestions (including accepted/dismissed)
      if (!pipelineOriginByField[fk]) pipelineOriginByField[fk] = new Set();
      pipelineOriginByField[fk].add(val.toLowerCase());
      // Only add pending suggestions to the active suggestions list
      if (s?.status && s.status !== 'pending') continue;
      if (!sugByField[fk]) sugByField[fk] = [];
      sugByField[fk].push(val);
    }
  }

  const allFields = new Set([...Object.keys(kvFields), ...Object.keys(sugByField)]);
  const fields = [];

  for (const field of [...allFields].sort()) {
    const workbookValues = toArray(kvFields[field]);
    const suggestedValues = toArray(sugByField[field]);
    const manualSet = manualLookup[field] || new Set();

    const valueMap = new Map();

    // Add workbook values (high confidence)
    // Source reflects ORIGINAL provenance — never destroyed by user actions:
    //   'pipeline' = originally discovered by pipeline, user accepted it
    //   'manual'   = user added it fresh (not from pipeline)
    //   'workbook' = from the original workbook, untouched by user
    const pipelineOriginSet = pipelineOriginByField[field] || new Set();
    for (const v of workbookValues) {
      const normalized = String(v).trim().toLowerCase();
      if (!normalized) continue;
      const isManual = manualSet.has(normalized);
      const wasPipeline = pipelineOriginSet.has(normalized);
      let valueSource;
      if (isManual && wasPipeline) {
        valueSource = 'pipeline'; // Originally from pipeline, user accepted it
      } else if (isManual) {
        valueSource = 'manual';   // User added it fresh
      } else {
        valueSource = 'workbook'; // From workbook, untouched
      }
      // Build candidate for audit trail (manual overrides are NOT candidates per source hierarchy)
      const wbCandidates = valueSource === 'manual' ? [] : [{
        candidate_id: valueSource === 'pipeline'
          ? buildPipelineEnumCandidateId({ fieldKey: field, value: v })
          : buildWorkbookEnumCandidateId({ fieldKey: field, value: v }),
        value: String(v).trim(),
        score: 1.0,
        source_id: valueSource === 'pipeline' ? 'pipeline' : 'workbook',
        source: valueSource === 'pipeline' ? 'Pipeline' : 'Excel Import',
        tier: null,
        method: valueSource === 'pipeline' ? 'pipeline_extraction' : 'workbook_import',
        evidence: {
          url: '',
          retrieved_at: kvGeneratedAt,
          snippet_id: '',
          snippet_hash: '',
          quote: valueSource === 'pipeline' ? 'Discovered by pipeline, accepted by user' : `Imported from ${category}Data.xlsm`,
          quote_span: null,
          snippet_text: valueSource === 'pipeline' ? 'Discovered by pipeline, accepted by user' : `Imported from ${category}Data.xlsm`,
          source_id: valueSource === 'pipeline' ? 'pipeline' : 'workbook',
        },
      }];
      valueMap.set(normalized, {
        value: String(v).trim(),
        source: valueSource,
        source_timestamp: manualEnumTimestamps[`${field}::${normalized}`] || null,
        confidence: 1.0,
        color: 'green',
        needs_review: false,
        candidates: wbCandidates,
        accepted_candidate_id: null,
      });
    }

    // Add pipeline suggestions (lower confidence, needs review)
    for (const v of suggestedValues) {
      const normalized = String(v).trim().toLowerCase();
      if (!normalized || valueMap.has(normalized)) continue;
      valueMap.set(normalized, {
        value: String(v).trim(),
        source: 'pipeline',
        source_timestamp: null,
        confidence: 0.6,
        color: 'yellow',
        needs_review: true,
        accepted_candidate_id: null,
        candidates: [{
          candidate_id: buildPipelineEnumCandidateId({ fieldKey: field, value: v }),
          value: String(v).trim(),
          score: 0.6,
          source_id: 'pipeline',
          source: 'Pipeline',
          tier: null,
          method: 'pipeline_extraction',
          evidence: {
            url: '',
            retrieved_at: kvGeneratedAt,
            snippet_id: '',
            snippet_hash: '',
            quote: 'Discovered by pipeline',
            quote_span: null,
            snippet_text: 'Discovered by pipeline',
            source_id: 'pipeline',
          },
        }],
      });
    }

    // SpecDb enrichment: product-level candidates + linked products for each enum value
    if (specDb) {
      try {
        for (const [, entry] of valueMap) {
          const lvRow = specDb.getListValueByFieldAndValue(field, entry.value);
          if (!lvRow) continue;

          // Linked products for this enum value
          let productRows = specDb.getProductsForListValue(field, entry.value);
          if (!productRows.length) {
            productRows = specDb.getProductsForFieldValue(field, entry.value);
          }
          if (productRows.length > 0) {
            entry.linked_products = productRows.map(r => ({
              product_id: r.product_id,
              field_key: r.field_key,
            }));
            entry.list_value_id = lvRow.id ?? entry.list_value_id ?? null;
            entry.enum_list_id = lvRow.list_id ?? entry.enum_list_id ?? null;
            entry.normalized_value = lvRow.normalized_value || null;
            entry.enum_policy = lvRow.enum_policy || null;
            entry.accepted_candidate_id = lvRow.accepted_candidate_id || null;
          }

          let candRows = specDb.getCandidatesByListValue(field, lvRow.id);
          if (!candRows.length) {
            candRows = specDb.getCandidatesForFieldValue(field, entry.value);
          }
          if (!candRows.length) continue;
          appendAllSpecDbCandidates(
            entry.candidates,
            candRows,
            `specdb_enum_${slugify(field)}_${slugify(entry.value)}`
          );
        }
      } catch (_specDbErr) {
        // Best-effort enrichment
      }
    }

    const values = [...valueMap.values()].sort((a, b) => a.value.localeCompare(b.value));
    const flagCount = values.filter(v => v.needs_review).length;

    fields.push({
      field,
      values,
      metrics: { total: values.length, flags: flagCount },
    });
  }

  return { category, fields };
}
