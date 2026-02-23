import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { spawn, exec as execCb } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { watch } from 'chokidar';
import { loadConfig, loadDotEnvFile } from '../config.js';
import { createStorage } from '../s3/storage.js';
import { loadCategoryConfig } from '../categories/loader.js';
import { loadQueueState, saveQueueState, listQueueProducts, upsertQueueProduct, clearQueueByStatus } from '../queue/queueState.js';
import { buildReviewLayout, buildProductReviewPayload, buildReviewQueue, readLatestArtifacts, buildFieldLabelsMap } from '../review/reviewGridData.js';
import { buildComponentReviewLayout, buildComponentReviewPayloads, buildEnumReviewPayloads } from '../review/componentReviewData.js';
import { setOverrideFromCandidate, setManualOverride, buildReviewMetrics } from '../review/overrideWorkflow.js';
import { applySharedLaneState } from '../review/keyReviewState.js';
import {
  resolveExplicitPositiveId,
  resolveGridFieldStateForMutation,
  resolveComponentMutationContext,
  resolveEnumMutationContext,
} from './reviewMutationResolvers.js';
import { handleReviewItemMutationRoute } from './reviewItemRoutes.js';
import { handleReviewComponentMutationRoute } from './reviewComponentMutationRoutes.js';
import { handleReviewEnumMutationRoute } from './reviewEnumMutationRoutes.js';
import { buildLlmMetrics } from '../publish/publishingPipeline.js';
import { buildSearchHints, buildAnchorsSuggestions, buildKnownValuesSuggestions } from '../learning/learningSuggestionEmitter.js';
import { SpecDb } from '../db/specDb.js';
import { findProductsReferencingComponent, cascadeComponentChange, cascadeEnumChange } from '../review/componentImpact.js';
import { componentReviewPath } from '../engine/curationSuggestions.js';
import { runComponentReviewBatch } from '../pipeline/componentReviewBatch.js';
import { invalidateFieldRulesCache } from '../field-rules/loader.js';
import { createSessionCache } from '../field-rules/sessionCache.js';
import { loadWorkbookMap, saveWorkbookMap, validateWorkbookMap } from '../ingest/categoryCompile.js';
import { llmRoutingSnapshot } from '../llm/routing.js';
import { buildTrafficLight } from '../validator/trafficLight.js';
import { buildRoundSummaryFromEvents } from './roundSummary.js';
import { buildEvidenceSearchPayload } from './evidenceSearch.js';
import { slugify as canonicalSlugify } from '../catalog/slugify.js';
import { cleanVariant as canonicalCleanVariant } from '../catalog/identityDedup.js';
import { buildComponentIdentifier } from '../utils/componentIdentifier.js';
import {
  buildComponentReviewSyntheticCandidateId
} from '../utils/candidateIdentifier.js';
import { generateTestSourceResults, buildDeterministicSourceResults, buildSeedComponentDB, TEST_CASES, analyzeContract, buildTestProducts, getScenarioDefs, buildValidationChecks, loadComponentIdentityPoolsFromWorkbook } from '../testing/testDataProvider.js';
import { runTestProduct } from '../testing/testRunner.js';
import { registerInfraRoutes } from './routes/infraRoutes.js';
import { registerConfigRoutes } from './routes/configRoutes.js';
import { registerIndexlabRoutes } from './routes/indexlabRoutes.js';
import { registerCatalogRoutes } from './routes/catalogRoutes.js';
import { registerBrandRoutes } from './routes/brandRoutes.js';
import { registerStudioRoutes } from './routes/studioRoutes.js';
import { registerReviewRoutes } from './routes/reviewRoutes.js';
import { registerTestModeRoutes } from './routes/testModeRoutes.js';
import { registerQueueBillingLearningRoutes } from './routes/queueBillingLearningRoutes.js';
import { registerSourceStrategyRoutes } from './routes/sourceStrategyRoutes.js';
import {
  loadBrandRegistry,
  saveBrandRegistry,
  addBrand,
  addBrandsBulk,
  updateBrand,
  removeBrand,
  getBrandsForCategory,
  seedBrandsFromActiveFiltering,
  renameBrand,
  getBrandImpactAnalysis
} from '../catalog/brandRegistry.js';
import {
  listProducts,
  loadProductCatalog,
  addProduct as catalogAddProduct,
  addProductsBulk as catalogAddProductsBulk,
  updateProduct as catalogUpdateProduct,
  removeProduct as catalogRemoveProduct,
  seedFromWorkbook as catalogSeedFromWorkbook
} from '../catalog/productCatalog.js';
import { reconcileOrphans } from '../catalog/reconciler.js';
import {
  toInt, toFloat, toUnitRatio, hasKnownValue, normalizeModelToken, parseCsvTokens,
  normalizePathToken, normalizeJsonText, jsonRes, corsHeaders, readJsonBody,
  safeReadJson, safeStat, listDirs, listFiles, normalizeDomainToken, domainFromUrl,
  urlPathToken, parseTsMs, percentileFromSorted, clampScore, readJsonlEvents,
  readGzipJsonlEvents, parseNdjson, safeJoin, incrementMapCounter, countMapValuesAbove,
  UNKNOWN_VALUE_TOKENS, isKnownValue, addTokensFromText,
  SITE_KIND_RANK, REVIEW_DOMAIN_HINTS, RETAILER_DOMAIN_HINTS, AGGREGATOR_DOMAIN_HINTS,
  FETCH_OUTCOME_KEYS, inferSiteKindByDomain, classifySiteKind, isHelperPseudoDomain,
  createFetchOutcomeCounters, normalizeFetchOutcome, classifyFetchOutcomeFromEvent,
  createDomainBucket, createUrlStat, ensureUrlStat, bumpUrlStatEvent,
  choosePreferredSiteKind, cooldownSecondsRemaining, resolveHostBudget,
  resolveDomainChecklistStatus, llmProviderFromModel, classifyLlmTracePhase,
  resolveLlmRoleDefaults, resolveLlmKnobDefaults, resolvePricingForModel,
  resolveTokenProfileForModel, collectLlmModels, deriveTrafficLightCounts,
  markEnumSuggestionStatus,
} from './helpers/requestHelpers.js';
import {
  initIndexLabDataBuilders,
  readIndexLabRunEvents,
  resolveRunProductId,
  resolveIndexLabRunContext,
  readIndexLabRunNeedSet,
  readIndexLabRunSearchProfile,
  readIndexLabRunPhase07Retrieval,
  readIndexLabRunPhase08Extraction,
  readIndexLabRunDynamicFetchDashboard,
  readIndexLabRunSourceIndexingPackets,
  readIndexLabRunItemIndexingPacket,
  readIndexLabRunRunMetaPacket,
  readIndexLabRunSerpExplorer,
  readIndexLabRunLlmTraces,
  readIndexLabRunEvidenceIndex,
  clampAutomationPriority,
  automationPriorityForRequiredLevel,
  automationPriorityForJobType,
  toStringList,
  addUniqueStrings,
  buildAutomationJobId,
  normalizeAutomationStatus,
  normalizeAutomationQuery,
  buildSearchProfileQueryMaps,
  readIndexLabRunAutomationQueue,
  listIndexLabRuns,
  buildIndexingDomainChecklist,
} from './routes/indexlabDataBuilders.js';

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// helpers: toInt, toFloat, toUnitRatio, hasKnownValue → ./helpers/requestHelpers.js

// helper: deriveTrafficLightCounts → ./helpers/requestHelpers.js

// helpers: normalizeModelToken..resolveLlmRoleDefaults → ./helpers/requestHelpers.js

// helper: resolveLlmKnobDefaults → ./helpers/requestHelpers.js

// helpers: resolvePricingForModel..collectLlmModels → ./helpers/requestHelpers.js

// helpers: markEnumSuggestionStatus..safeJoin → ./helpers/requestHelpers.js

// indexlab data builders: readIndexLabRunEvents..buildIndexingDomainChecklist → ./routes/indexlabDataBuilders.js

function mimeType(ext) {
  const map = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  };
  return map[ext] || 'application/octet-stream';
}

// â”€â”€ Catalog helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function cleanVariant(v) {
  return canonicalCleanVariant(v);
}

function normText(v) {
  return String(v ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function catalogKey(brand, model, variant) {
  return `${normText(brand)}|${normText(model)}|${normText(cleanVariant(variant))}`;
}

function slugify(value) {
  return canonicalSlugify(value);
}

function buildProductIdFromParts(category, brand, model, variant) {
  return [slugify(category), slugify(brand), slugify(model), slugify(cleanVariant(variant))]
    .filter(Boolean)
    .join('-');
}


// â”€â”€ Args â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const args = process.argv.slice(2);
function argVal(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
}
const PORT = toInt(argVal('port', '8788'), 8788);
const isLocal = args.includes('--local');

// â”€â”€ Config + Storage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
loadDotEnvFile();
const config = loadConfig({ localMode: isLocal || true, outputMode: 'local' });
const storage = createStorage(config);
const OUTPUT_ROOT = path.resolve(config.localOutputRoot || 'out');
const HELPER_ROOT = path.resolve(config.helperFilesRoot || 'helper_files');
const INDEXLAB_ROOT = path.resolve(argVal('indexlab-root', 'artifacts/indexlab'));

initIndexLabDataBuilders({
  indexLabRoot: INDEXLAB_ROOT,
  outputRoot: OUTPUT_ROOT,
  storage,
  config,
  getSpecDbReady,
  isProcessRunning,
});

const markEnumSuggestionStatusBound = (category, field, value, status = 'accepted') =>
  markEnumSuggestionStatus(category, field, value, status, HELPER_ROOT);

const sessionCache = createSessionCache({
  loadCategoryConfig: (category) => loadCategoryConfig(category, { storage, config }),
  readJsonIfExists: safeReadJson,
  writeFile: (filePath, data) => fs.writeFile(filePath, data),
  mkdir: (dirPath, opts) => fs.mkdir(dirPath, opts),
  helperRoot: HELPER_ROOT,
});

function normalizeCategoryToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+$/g, '');
}

function categoryExists(category) {
  if (!category) return false;
  const categoryPath = path.join(HELPER_ROOT, category);
  return fsSync.existsSync(categoryPath);
}

function resolveCategoryAlias(category) {
  const normalized = normalizeCategoryToken(category);
  if (!normalized) return normalized;
  if (normalized.startsWith('_test_')) return normalized;
  if (!normalized.startsWith('test_')) return normalized;

  if (categoryExists(normalized)) return normalized;
  const canonicalTestCategory = `_${normalized}`;
  if (categoryExists(canonicalTestCategory)) return canonicalTestCategory;
  return normalized;
}

// â”€â”€ Lazy SpecDb Cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const specDbCache = new Map();
const specDbSeedPromises = new Map();
const reviewLayoutByCategory = new Map();

function getSpecDb(category) {
  const resolvedCategory = resolveCategoryAlias(category);
  if (!resolvedCategory) return null;
  if (specDbCache.has(resolvedCategory)) return specDbCache.get(resolvedCategory);

  // Strict ID-driven runtime: use only the category-local SpecDb.
  const primaryPath = path.join('.specfactory_tmp', resolvedCategory, 'spec.sqlite');

  try {
    fsSync.accessSync(primaryPath);
    const db = new SpecDb({ dbPath: primaryPath, category: resolvedCategory });
    // Check if this DB actually has seeded data
    if (db.isSeeded()) {
      specDbCache.set(resolvedCategory, db);
      return db;
    }
    // DB exists but is not seeded yet - trigger background seed and return it
    specDbCache.set(resolvedCategory, db);
    triggerAutoSeed(resolvedCategory, db);
    return db;
  } catch { /* create */ }

  // No DB found - create at the primary path and trigger seed
  try {
    fsSync.mkdirSync(path.dirname(primaryPath), { recursive: true });
    const db = new SpecDb({ dbPath: primaryPath, category: resolvedCategory });
    specDbCache.set(resolvedCategory, db);
    triggerAutoSeed(resolvedCategory, db);
    return db;
  } catch {
    specDbCache.set(resolvedCategory, null);
    return null;
  }
}

/** Background auto-seed: loads field rules and seeds the SpecDb */
function triggerAutoSeed(category, db) {
  const resolvedCategory = resolveCategoryAlias(category);
  if (!resolvedCategory) return;
  if (specDbSeedPromises.has(resolvedCategory)) return;
  const promise = (async () => {
    try {
      const { loadFieldRules } = await import('../field-rules/loader.js');
      const { seedSpecDb } = await import('../db/seed.js');
      const fieldRules = await loadFieldRules(resolvedCategory, { config });
      const result = await seedSpecDb({ db, config, category: resolvedCategory, fieldRules });
      console.log(`[auto-seed] ${resolvedCategory}: ${result.components_seeded} components, ${result.list_values_seeded} list values, ${result.products_seeded} products (${result.duration_ms}ms)`);
    } catch (err) {
      console.error(`[auto-seed] ${resolvedCategory} failed:`, err.message);
    } finally {
      specDbSeedPromises.delete(resolvedCategory);
    }
  })();
  specDbSeedPromises.set(resolvedCategory, promise);
}

async function getSpecDbReady(category) {
  const resolvedCategory = resolveCategoryAlias(category);
  const db = getSpecDb(resolvedCategory);
  if (!db) return null;
  const pending = specDbSeedPromises.get(resolvedCategory);
  if (pending) {
    try {
      await pending;
    } catch {
      // keep best available DB handle; caller validates seeded content.
    }
  }
  return getSpecDb(resolvedCategory);
}

function ensureGridKeyReviewState(specDb, category, productId, fieldKey, itemFieldStateId = null) {
  if (!specDb || !productId || !fieldKey) return null;
  try {
    const existing = specDb.getKeyReviewState({
      category,
      targetKind: 'grid_key',
      itemIdentifier: productId,
      fieldKey,
      itemFieldStateId,
    });
    if (existing) return existing;

    const ifs = itemFieldStateId
      ? specDb.getItemFieldStateById(itemFieldStateId)
      : specDb.db.prepare(
        'SELECT * FROM item_field_state WHERE category = ? AND product_id = ? AND field_key = ? LIMIT 1'
      ).get(category, productId, fieldKey);
    if (!ifs) return null;

    let aiConfirmPrimaryStatus = null;
    if (ifs.needs_ai_review && !ifs.ai_review_complete) aiConfirmPrimaryStatus = 'pending';
    else if (ifs.ai_review_complete) aiConfirmPrimaryStatus = 'confirmed';

    const userAcceptPrimaryStatus = ifs.overridden ? 'accepted' : null;

    const id = specDb.upsertKeyReviewState({
      category,
      targetKind: 'grid_key',
      itemIdentifier: productId,
      fieldKey,
      itemFieldStateId: ifs.id ?? itemFieldStateId ?? null,
      selectedValue: ifs.value ?? null,
      selectedCandidateId: ifs.accepted_candidate_id ?? null,
      confidenceScore: ifs.confidence ?? 0,
      aiConfirmPrimaryStatus,
      userAcceptPrimaryStatus,
    });
    return specDb.db.prepare('SELECT * FROM key_review_state WHERE id = ?').get(id) || null;
  } catch {
    return null;
  }
}

function resolveKeyReviewForLaneMutation(specDb, category, body) {
  if (!specDb) {
    return {
      stateRow: null,
      error: 'specdb_not_ready',
      errorMessage: 'SpecDb is not available for this category.',
    };
  }
  const idReq = resolveExplicitPositiveId(body, ['id']);
  if (idReq.provided) {
    const byId = idReq.id ? specDb.db.prepare('SELECT * FROM key_review_state WHERE id = ?').get(idReq.id) : null;
    if (byId) return { stateRow: byId, error: null };
    return {
      stateRow: null,
      error: 'key_review_state_id_not_found',
      errorMessage: `key_review_state id '${idReq.raw}' was not found.`,
    };
  }
  const fieldStateCtx = resolveGridFieldStateForMutation(specDb, category, body);
  if (fieldStateCtx?.error) {
    if (fieldStateCtx.error === 'item_field_state_id_required') {
      return {
        stateRow: null,
        error: 'id_or_item_field_state_id_required',
        errorMessage: 'Provide key_review_state id or itemFieldStateId for this lane mutation.',
      };
    }
    return {
      stateRow: null,
      error: fieldStateCtx.error,
      errorMessage: fieldStateCtx.errorMessage,
    };
  }
  const fieldStateRow = fieldStateCtx?.row;
  if (!fieldStateRow) return { stateRow: null, error: null };
  const productId = String(fieldStateRow.product_id || '').trim();
  const fieldKey = String(fieldStateRow.field_key || '').trim();
  if (!productId || !fieldKey) return { stateRow: null, error: null };
  return {
    stateRow: ensureGridKeyReviewState(specDb, category, productId, fieldKey, fieldStateRow.id),
    error: null,
  };
}

function markPrimaryLaneReviewedInItemState(specDb, category, keyReviewState) {
  if (!specDb || !keyReviewState) return;
  if (keyReviewState.target_kind !== 'grid_key') return;
  if (!keyReviewState.item_identifier || !keyReviewState.field_key) return;
  try {
    specDb.db.prepare(
      `UPDATE item_field_state
       SET needs_ai_review = 0,
           ai_review_complete = 1,
           updated_at = datetime('now')
       WHERE category = ? AND product_id = ? AND field_key = ?`
    ).run(category, keyReviewState.item_identifier, keyReviewState.field_key);
  } catch { /* best-effort sync */ }
}

function syncItemFieldStateFromPrimaryLaneAccept(specDb, category, keyReviewState) {
  if (!specDb || !keyReviewState) return;
  if (keyReviewState.target_kind !== 'grid_key') return;
  const productId = String(keyReviewState.item_identifier || '').trim();
  const fieldKey = String(keyReviewState.field_key || '').trim();
  if (!productId || !fieldKey) return;

  const current = specDb.db.prepare(
    'SELECT * FROM item_field_state WHERE category = ? AND product_id = ? AND field_key = ?'
  ).get(category, productId, fieldKey) || null;
  const selectedCandidateId = String(keyReviewState.selected_candidate_id || '').trim() || null;
  const candidateRow = selectedCandidateId ? specDb.getCandidateById(selectedCandidateId) : null;
  const selectedValue = candidateRow?.value ?? keyReviewState.selected_value ?? current?.value ?? null;
  if (!isMeaningfulValue(selectedValue) && !current) return;

  const confidenceScore = Number.isFinite(Number(candidateRow?.score))
    ? Number(candidateRow.score)
    : (Number.isFinite(Number(keyReviewState.confidence_score))
      ? Number(keyReviewState.confidence_score)
      : Number(current?.confidence || 0));
  const aiStatus = String(keyReviewState?.ai_confirm_primary_status || '').trim().toLowerCase();
  const aiConfirmed = aiStatus === 'confirmed';
  const source = candidateRow
    ? 'pipeline'
    : (String(current?.source || '').trim() || 'pipeline');

  specDb.upsertItemFieldState({
    productId,
    fieldKey,
    value: selectedValue,
    confidence: confidenceScore,
    source,
    acceptedCandidateId: selectedCandidateId || current?.accepted_candidate_id || null,
    overridden: false,
    needsAiReview: !aiConfirmed,
    aiReviewComplete: aiConfirmed,
  });
  try {
    specDb.syncItemListLinkForFieldValue({
      productId,
      fieldKey,
      value: selectedValue,
    });
  } catch { /* best-effort list-link sync */ }
}

function syncPrimaryLaneAcceptFromItemSelection({
  specDb,
  category,
  productId,
  fieldKey,
  selectedCandidateId = null,
  selectedValue = null,
  confidenceScore = null,
  reason = null,
}) {
  if (!specDb) return null;
  const state = ensureGridKeyReviewState(specDb, category, productId, fieldKey);
  if (!state) return null;

  const scoreValue = Number.isFinite(Number(confidenceScore))
    ? Number(confidenceScore)
    : null;
  specDb.db.prepare(`
    UPDATE key_review_state
    SET selected_candidate_id = ?,
        selected_value = ?,
        confidence_score = COALESCE(?, confidence_score),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    selectedCandidateId,
    selectedValue,
    scoreValue,
    state.id
  );

  const at = new Date().toISOString();
  specDb.updateKeyReviewUserAccept({ id: state.id, lane: 'primary', status: 'accepted', at });
  specDb.insertKeyReviewAudit({
    keyReviewStateId: state.id,
    eventType: 'user_accept',
    actorType: 'user',
    actorId: null,
    oldValue: state.user_accept_primary_status || null,
    newValue: 'accepted',
    reason: reason || 'User accepted item value via override',
  });

  return specDb.db.prepare('SELECT * FROM key_review_state WHERE id = ?').get(state.id) || null;
}

function deleteKeyReviewStateRows(specDb, stateIds = []) {
  if (!specDb || !Array.isArray(stateIds) || stateIds.length === 0) return 0;
  const ids = stateIds
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (ids.length === 0) return 0;

  const tx = specDb.db.transaction((rows) => {
    for (const id of rows) {
      specDb.db.prepare(`
        DELETE FROM key_review_run_sources
        WHERE key_review_run_id IN (
          SELECT run_id FROM key_review_runs WHERE key_review_state_id = ?
        )
      `).run(id);
      specDb.db.prepare('DELETE FROM key_review_runs WHERE key_review_state_id = ?').run(id);
      specDb.db.prepare('DELETE FROM key_review_audit WHERE key_review_state_id = ?').run(id);
      specDb.db.prepare('DELETE FROM key_review_state WHERE id = ?').run(id);
    }
  });
  tx(ids);
  return ids.length;
}

function resetTestModeSharedReviewState(specDb, category) {
  if (!specDb || !category) return 0;
  const ids = specDb.db.prepare(`
    SELECT id
    FROM key_review_state
    WHERE category = ?
      AND target_kind IN ('component_key', 'enum_key')
  `).all(category).map((row) => row.id);
  return deleteKeyReviewStateRows(specDb, ids);
}

function purgeTestModeCategoryState(specDb, category) {
  const cat = String(category || '').trim();
  if (!specDb || !cat || !cat.startsWith('_test_')) {
    return {
      clearedKeyReview: 0,
      clearedSources: 0,
      clearedCandidates: 0,
      clearedFieldState: 0,
      clearedComponentData: 0,
      clearedEnumData: 0,
      clearedCatalogState: 0,
      clearedArtifacts: 0,
    };
  }

  let clearedKeyReview = 0;
  let clearedSources = 0;
  let clearedCandidates = 0;
  let clearedFieldState = 0;
  let clearedComponentData = 0;
  let clearedEnumData = 0;
  let clearedCatalogState = 0;
  let clearedArtifacts = 0;

  const tx = specDb.db.transaction(() => {
    const keyReviewIds = specDb.db.prepare(`
      SELECT id
      FROM key_review_state
      WHERE category = ?
    `).all(cat).map((row) => row.id);
    clearedKeyReview = deleteKeyReviewStateRows(specDb, keyReviewIds);

    const sourceIds = specDb.db.prepare(`
      SELECT source_id
      FROM source_registry
      WHERE category = ?
    `).all(cat).map((row) => String(row.source_id || '').trim()).filter(Boolean);

    if (sourceIds.length > 0) {
      const placeholders = sourceIds.map(() => '?').join(',');
      specDb.db.prepare(`
        DELETE FROM key_review_run_sources
        WHERE assertion_id IN (
          SELECT assertion_id
          FROM source_assertions
          WHERE source_id IN (${placeholders})
        )
      `).run(...sourceIds);
      specDb.db.prepare(`
        DELETE FROM source_evidence_refs
        WHERE assertion_id IN (
          SELECT assertion_id
          FROM source_assertions
          WHERE source_id IN (${placeholders})
        )
      `).run(...sourceIds);
      clearedSources += specDb.db.prepare(`
        DELETE FROM source_assertions
        WHERE source_id IN (${placeholders})
      `).run(...sourceIds).changes;
      specDb.db.prepare(`
        DELETE FROM source_artifacts
        WHERE source_id IN (${placeholders})
      `).run(...sourceIds);
      clearedSources += specDb.db.prepare(`
        DELETE FROM source_registry
        WHERE source_id IN (${placeholders})
      `).run(...sourceIds).changes;
    }

    specDb.db.prepare(`
      DELETE FROM candidate_reviews
      WHERE candidate_id IN (
        SELECT candidate_id
        FROM candidates
        WHERE category = ?
      )
    `).run(cat);

    specDb.db.prepare('DELETE FROM item_list_links WHERE category = ?').run(cat);
    specDb.db.prepare('DELETE FROM item_component_links WHERE category = ?').run(cat);
    clearedCandidates = specDb.db.prepare('DELETE FROM candidates WHERE category = ?').run(cat).changes;
    clearedFieldState = specDb.db.prepare('DELETE FROM item_field_state WHERE category = ?').run(cat).changes;

    specDb.db.prepare(`
      DELETE FROM component_aliases
      WHERE component_id IN (
        SELECT id
        FROM component_identity
        WHERE category = ?
      )
    `).run(cat);
    clearedComponentData += specDb.db.prepare('DELETE FROM component_values WHERE category = ?').run(cat).changes;
    clearedComponentData += specDb.db.prepare('DELETE FROM component_identity WHERE category = ?').run(cat).changes;
    clearedEnumData += specDb.db.prepare('DELETE FROM list_values WHERE category = ?').run(cat).changes;
    clearedEnumData += specDb.db.prepare('DELETE FROM enum_lists WHERE category = ?').run(cat).changes;

    clearedCatalogState += specDb.db.prepare('DELETE FROM products WHERE category = ?').run(cat).changes;
    clearedCatalogState += specDb.db.prepare('DELETE FROM product_queue WHERE category = ?').run(cat).changes;
    clearedCatalogState += specDb.db.prepare('DELETE FROM product_runs WHERE category = ?').run(cat).changes;
    clearedCatalogState += specDb.db.prepare('DELETE FROM curation_suggestions WHERE category = ?').run(cat).changes;
    clearedCatalogState += specDb.db.prepare('DELETE FROM component_review_queue WHERE category = ?').run(cat).changes;
    clearedCatalogState += specDb.db.prepare('DELETE FROM llm_route_matrix WHERE category = ?').run(cat).changes;

    clearedArtifacts += specDb.db.prepare('DELETE FROM artifacts WHERE category = ?').run(cat).changes;
    clearedArtifacts += specDb.db.prepare('DELETE FROM audit_log WHERE category = ?').run(cat).changes;
    // Phase 12+ auxiliary tables may not exist in every DB build.
    try { clearedArtifacts += specDb.db.prepare('DELETE FROM category_brain WHERE category = ?').run(cat).changes; } catch { /* ignore */ }
    try { clearedArtifacts += specDb.db.prepare('DELETE FROM source_corpus WHERE category = ?').run(cat).changes; } catch { /* ignore */ }
    try { clearedArtifacts += specDb.db.prepare('DELETE FROM runtime_events WHERE category = ?').run(cat).changes; } catch { /* ignore */ }
    try { clearedArtifacts += specDb.db.prepare('DELETE FROM source_intel_domains WHERE category = ?').run(cat).changes; } catch { /* ignore */ }
    try { clearedArtifacts += specDb.db.prepare('DELETE FROM source_intel_field_rewards WHERE category = ?').run(cat).changes; } catch { /* ignore */ }
    try { clearedArtifacts += specDb.db.prepare('DELETE FROM source_intel_brands WHERE category = ?').run(cat).changes; } catch { /* ignore */ }
    try { clearedArtifacts += specDb.db.prepare('DELETE FROM source_intel_paths WHERE category = ?').run(cat).changes; } catch { /* ignore */ }
  });
  tx();

  return {
    clearedKeyReview,
    clearedSources,
    clearedCandidates,
    clearedFieldState,
    clearedComponentData,
    clearedEnumData,
    clearedCatalogState,
    clearedArtifacts,
  };
}

function resetTestModeProductReviewState(specDb, category, productId) {
  const pid = String(productId || '').trim();
  if (!specDb || !category || !pid) return {
    clearedCandidates: 0,
    clearedKeyReview: 0,
    clearedFieldState: 0,
    clearedLinks: 0,
    clearedSources: 0,
  };

  const stateIds = specDb.db.prepare(`
    SELECT id
    FROM key_review_state
    WHERE category = ?
      AND target_kind = 'grid_key'
      AND item_identifier = ?
  `).all(category, pid).map((row) => row.id);
  const clearedKeyReview = deleteKeyReviewStateRows(specDb, stateIds);

  let deletedCandidates = 0;
  let deletedFieldState = 0;
  let deletedLinks = 0;
  let deletedSources = 0;
  const tx = specDb.db.transaction(() => {
    const itemFieldStateIds = specDb.db.prepare(`
      SELECT id
      FROM item_field_state
      WHERE category = ? AND product_id = ?
    `).all(category, pid).map((row) => row.id);
    const sourceIds = specDb.db.prepare(`
      SELECT source_id
      FROM source_registry
      WHERE category = ? AND product_id = ?
    `).all(category, pid).map((row) => row.source_id);

    if (itemFieldStateIds.length > 0) {
      const placeholders = itemFieldStateIds.map(() => '?').join(',');
      specDb.db.prepare(`
        DELETE FROM source_evidence_refs
        WHERE assertion_id IN (
          SELECT assertion_id
          FROM source_assertions
          WHERE item_field_state_id IN (${placeholders})
        )
      `).run(...itemFieldStateIds);
      deletedSources += specDb.db.prepare(`
        DELETE FROM source_assertions
        WHERE item_field_state_id IN (${placeholders})
      `).run(...itemFieldStateIds).changes;
    }

    if (sourceIds.length > 0) {
      const placeholders = sourceIds.map(() => '?').join(',');
      specDb.db.prepare(`
        DELETE FROM source_evidence_refs
        WHERE assertion_id IN (
          SELECT assertion_id
          FROM source_assertions
          WHERE source_id IN (${placeholders})
        )
      `).run(...sourceIds);
      deletedSources += specDb.db.prepare(`
        DELETE FROM source_assertions
        WHERE source_id IN (${placeholders})
      `).run(...sourceIds).changes;
      specDb.db.prepare(`
        DELETE FROM source_artifacts
        WHERE source_id IN (${placeholders})
      `).run(...sourceIds);
      deletedSources += specDb.db.prepare(`
        DELETE FROM source_registry
        WHERE source_id IN (${placeholders})
      `).run(...sourceIds).changes;
    }

    specDb.db.prepare(`
      DELETE FROM candidate_reviews
      WHERE context_type = 'item'
        AND context_id = ?
    `).run(pid);
    specDb.db.prepare(`
      DELETE FROM candidate_reviews
      WHERE candidate_id IN (
        SELECT candidate_id
        FROM candidates
        WHERE category = ? AND product_id = ?
      )
    `).run(category, pid);

    deletedLinks += specDb.db.prepare(`
      DELETE FROM item_component_links
      WHERE category = ? AND product_id = ?
    `).run(category, pid).changes;
    deletedLinks += specDb.db.prepare(`
      DELETE FROM item_list_links
      WHERE category = ? AND product_id = ?
    `).run(category, pid).changes;
    deletedFieldState = specDb.db.prepare(`
      DELETE FROM item_field_state
      WHERE category = ? AND product_id = ?
    `).run(category, pid).changes;

    deletedCandidates = specDb.db
      .prepare('DELETE FROM candidates WHERE category = ? AND product_id = ?')
      .run(category, pid).changes;
  });
  tx();

  return {
    clearedCandidates: deletedCandidates,
    clearedKeyReview,
    clearedFieldState: deletedFieldState,
    clearedLinks: deletedLinks,
    clearedSources: deletedSources,
  };
}

function normalizeLower(value) {
  return String(value ?? '').trim().toLowerCase();
}

const UNKNOWN_LIKE_TOKENS = new Set(['', 'unk', 'unknown', 'n/a', 'na', 'null', 'undefined', '-']);

function isMeaningfulValue(value) {
  return !UNKNOWN_LIKE_TOKENS.has(normalizeLower(value));
}

function candidateLooksReference(candidateId, sourceToken = '') {
  const token = String(sourceToken || '').trim().toLowerCase();
  const cid = String(candidateId || '').trim();
  return cid.startsWith('ref_')
    || cid.startsWith('ref-')
    || cid.includes('::ref_')
    || cid.includes('::ref-')
    || token.includes('reference')
    || token.includes('component_db');
}

function extractComparableValueTokens(rawValue) {
  if (Array.isArray(rawValue)) {
    const nested = [];
    for (const entry of rawValue) {
      nested.push(...extractComparableValueTokens(entry));
    }
    return [...new Set(nested)];
  }
  const text = String(rawValue ?? '').trim();
  if (!text) return [];
  const parts = text.includes(',')
    ? text.split(',').map((part) => String(part ?? '').trim()).filter(Boolean)
    : [text];
  return [...new Set(parts.map((part) => normalizeLower(part)).filter(Boolean))];
}

function splitCandidateParts(rawValue) {
  if (Array.isArray(rawValue)) {
    const nested = rawValue.flatMap((entry) => splitCandidateParts(entry));
    return [...new Set(nested)];
  }
  const text = String(rawValue ?? '').trim();
  if (!text) return [];
  const parts = text.includes(',')
    ? text.split(',').map((part) => String(part ?? '').trim()).filter(Boolean)
    : [text];
  return [...new Set(parts)];
}

async function getReviewFieldRow(category, fieldKey) {
  const cached = reviewLayoutByCategory.get(category);
  if (cached?.rowsByKey && (Date.now() - (cached.loadedAt || 0) < 15_000)) {
    return cached.rowsByKey.get(fieldKey) || null;
  }
  try {
    const session = await sessionCache.getSessionRules(category);
    const layout = await buildReviewLayout({ storage, config, category, fieldOrderOverride: session.draftFieldOrder, fieldsOverride: session.draftFields });
    const rowsByKey = new Map((layout.rows || []).map((row) => [String(row.key || ''), row]));
    reviewLayoutByCategory.set(category, { rowsByKey, loadedAt: Date.now() });
    return rowsByKey.get(fieldKey) || null;
  } catch {
    return null;
  }
}

function candidateMatchesReviewItemValue(reviewItem, candidateNorm) {
  if (!candidateNorm) return false;
  const direct = normalizeLower(reviewItem?.matched_component || reviewItem?.raw_query || '');
  if (direct && direct === candidateNorm) return true;
  const attrs = parseReviewItemAttributes(reviewItem);
  return Object.values(attrs).some((attrValue) => (
    extractComparableValueTokens(attrValue).includes(candidateNorm)
  ));
}

function parseReviewItemAttributes(reviewItem) {
  const raw = reviewItem?.product_attributes;
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function makerTokensFromReviewItem(reviewItem, componentType) {
  const attrs = parseReviewItemAttributes(reviewItem);
  const fieldKey = String(reviewItem?.field_key || '').trim();
  const keys = [
    `${componentType}_brand`,
    `${componentType}_maker`,
    fieldKey ? `${fieldKey}_brand` : '',
    fieldKey ? `${fieldKey}_maker` : '',
    'brand',
    'maker',
  ].filter(Boolean);
  const tokens = [];
  for (const key of keys) {
    for (const valuePart of splitCandidateParts(attrs[key])) {
      if (!isMeaningfulValue(valuePart)) continue;
      tokens.push(normalizeLower(valuePart));
    }
  }
  for (const valuePart of splitCandidateParts(reviewItem?.ai_suggested_maker)) {
    if (!isMeaningfulValue(valuePart)) continue;
    tokens.push(normalizeLower(valuePart));
  }
  return [...new Set(tokens)];
}

function reviewItemMatchesMakerLane(reviewItem, {
  componentType,
  componentMaker,
  allowMakerlessForNamedLane = false,
}) {
  const laneMaker = normalizeLower(componentMaker || '');
  const makerTokens = makerTokensFromReviewItem(reviewItem, componentType);
  if (!laneMaker) return makerTokens.length === 0;
  if (!makerTokens.length) return Boolean(allowMakerlessForNamedLane);
  return makerTokens.includes(laneMaker);
}

function isResolvedCandidateReview(
  reviewRow,
  {
    includeHumanAccepted = true,
    treatSharedAcceptAsPending = false,
  } = {},
) {
  if (!reviewRow) return false;
  const aiStatus = normalizeLower(reviewRow.ai_review_status || '');
  const aiReason = normalizeLower(reviewRow.ai_reason || '');
  if (aiStatus === 'rejected') return true;
  if (aiStatus === 'accepted') {
    if (treatSharedAcceptAsPending && aiReason === 'shared_accept') {
      return false;
    }
    return true;
  }
  if (includeHumanAccepted && Number(reviewRow.human_accepted) === 1) {
    return true;
  }
  return false;
}

function buildCandidateReviewLookup(reviewRows) {
  const exact = new Map();
  for (const row of Array.isArray(reviewRows) ? reviewRows : []) {
    const cid = String(row?.candidate_id || '').trim();
    if (!cid) continue;
    exact.set(cid, row);
  }
  return { exact };
}

function getReviewForCandidateId(lookup, candidateId) {
  if (!lookup) return null;
  const cid = String(candidateId || '').trim();
  if (!cid) return null;
  if (lookup.exact.has(cid)) return lookup.exact.get(cid) || null;
  return null;
}

function collectPendingCandidateIds({
  candidateRows,
  reviewLookup = null,
  includeHumanAccepted = true,
  treatSharedAcceptAsPending = false,
}) {
  const actionableIds = [];
  const seen = new Set();
  for (const row of Array.isArray(candidateRows) ? candidateRows : []) {
    const cid = String(row?.candidate_id || '').trim();
    if (!cid || seen.has(cid)) continue;
    const rowValue = row?.value;
    if (!isMeaningfulValue(rowValue)) continue;
    seen.add(cid);
    actionableIds.push(cid);
  }
  const pending = [];
  for (const cid of actionableIds) {
    const reviewRow = getReviewForCandidateId(reviewLookup, cid);
    if (!isResolvedCandidateReview(reviewRow, {
      includeHumanAccepted,
      treatSharedAcceptAsPending,
    })) {
      pending.push(cid);
    }
  }
  return pending;
}

async function collectComponentReviewPropertyCandidateRows({
  category,
  componentType,
  componentName,
  componentMaker,
  allowMakerlessForNamedLane = false,
  propertyKey,
}) {
  const normalizedComponentName = normalizeLower(componentName);
  const normalizedPropertyKey = String(propertyKey || '').trim();
  if (!category || !componentType || !normalizedComponentName || !normalizedPropertyKey) return [];
  if (normalizedPropertyKey.startsWith('__')) return [];
  const filePath = componentReviewPath({ config, category });
  const data = await safeReadJson(filePath);
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) return [];

  const rows = [];
  const seen = new Set();
  for (const item of items) {
    const status = normalizeLower(item?.status || '');
    if (status === 'dismissed' || status === 'ignored' || status === 'rejected') continue;
    if (String(item?.component_type || '').trim() !== String(componentType || '').trim()) continue;

    const matchedName = normalizeLower(item?.matched_component || '');
    const rawName = normalizeLower(item?.raw_query || '');
    const isSameComponent = matchedName
      ? matchedName === normalizedComponentName
      : rawName === normalizedComponentName;
    if (!isSameComponent) continue;
    if (!reviewItemMatchesMakerLane(item, { componentType, componentMaker, allowMakerlessForNamedLane })) continue;

    const attrs = parseReviewItemAttributes(item);
    const matchedEntry = Object.entries(attrs).find(([attrKey]) => (
      normalizeLower(attrKey) === normalizeLower(normalizedPropertyKey)
    ));
    if (!matchedEntry) continue;
    const [, attrValue] = matchedEntry;
    for (const valuePart of splitCandidateParts(attrValue)) {
      if (!isMeaningfulValue(valuePart)) continue;
      const candidateId = buildComponentReviewSyntheticCandidateId({
        productId: String(item?.product_id || '').trim(),
        fieldKey: normalizedPropertyKey,
        reviewId: String(item?.review_id || '').trim() || null,
        value: valuePart,
      });
      const cid = String(candidateId || '').trim();
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      rows.push({ candidate_id: cid, value: valuePart });
    }
  }
  return rows;
}

function normalizeCandidatePrimaryReviewStatus(candidate, reviewRow = null) {
  if (candidate?.is_synthetic_selected) return 'accepted';
  if (reviewRow) {
    if (Number(reviewRow.human_accepted) === 1) return 'accepted';
    const aiStatus = normalizeLower(reviewRow.ai_review_status || '');
    if (aiStatus === 'accepted') return 'accepted';
    if (aiStatus === 'rejected') return 'rejected';
    return 'pending';
  }
  const sourceToken = normalizeLower(candidate?.source_id || candidate?.source || '');
  const methodToken = normalizeLower(candidate?.method || candidate?.source_method || '');
  if (
    sourceToken === 'reference'
    || sourceToken === 'component_db'
    || sourceToken === 'known_values'
    || sourceToken === 'user'
    || sourceToken === 'manual'
    || methodToken.includes('reference_data')
    || methodToken.includes('manual')
  ) {
    return 'accepted';
  }
  return 'pending';
}

function annotateCandidatePrimaryReviews(candidates, reviewRows = []) {
  const lookup = buildCandidateReviewLookup(reviewRows);
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const candidateId = String(candidate?.candidate_id || '').trim();
    const reviewRow = candidateId ? getReviewForCandidateId(lookup, candidateId) : null;
    candidate.primary_review_status = normalizeCandidatePrimaryReviewStatus(candidate, reviewRow);
    candidate.human_accepted = Number(reviewRow?.human_accepted || 0) === 1;
  }
}

function getPendingItemPrimaryCandidateIds(specDb, {
  productId,
  fieldKey,
  itemFieldStateId,
}) {
  if (!specDb || !productId || !fieldKey || !itemFieldStateId) return [];
  const candidatesByField = specDb.getCandidatesForProduct(productId) || {};
  const candidateRows = candidatesByField[fieldKey] || [];
  const reviewRows = specDb.getReviewsForContext('item', String(itemFieldStateId)) || [];
  const reviewLookup = buildCandidateReviewLookup(reviewRows);
  return collectPendingCandidateIds({
    candidateRows,
    reviewLookup,
  });
}

function getPendingComponentSharedCandidateIds(specDb, {
  componentType,
  componentName,
  componentMaker,
  propertyKey,
  componentValueId,
}) {
  if (!specDb || !componentValueId || !propertyKey) return [];
  const candidateRows = specDb.getCandidatesForComponentProperty(
    componentType,
    componentName,
    componentMaker || '',
    propertyKey,
  ) || [];
  const reviewRows = specDb.getReviewsForContext('component', String(componentValueId)) || [];
  const reviewLookup = buildCandidateReviewLookup(reviewRows);
  // Include synthetic pipeline review candidates derived from component_review queue
  // so lane status remains pending until all candidate-level confirmations are resolved.
  return collectPendingCandidateIds({
    candidateRows: candidateRows,
    reviewLookup,
    includeHumanAccepted: false,
    treatSharedAcceptAsPending: true,
  });
}

async function getPendingComponentSharedCandidateIdsAsync(specDb, {
  category,
  componentType,
  componentName,
  componentMaker,
  propertyKey,
  componentValueId,
}) {
  if (!specDb || !componentValueId || !propertyKey) return [];
  const candidateRows = specDb.getCandidatesForComponentProperty(
    componentType,
    componentName,
    componentMaker || '',
    propertyKey,
  ) || [];
  const reviewRows = specDb.getReviewsForContext('component', String(componentValueId)) || [];
  const reviewLookup = buildCandidateReviewLookup(reviewRows);
  const ambiguousMakerRows = specDb.db.prepare(`
    SELECT COUNT(DISTINCT LOWER(TRIM(COALESCE(maker, '')))) AS maker_count
    FROM component_identity
    WHERE category = ?
      AND component_type = ?
      AND LOWER(TRIM(canonical_name)) = LOWER(TRIM(?))
  `).get(specDb.category, componentType, componentName);
  const allowMakerlessForNamedLane = Boolean(String(componentMaker || '').trim())
    && Number(ambiguousMakerRows?.maker_count || 0) <= 1;
  const syntheticRows = await collectComponentReviewPropertyCandidateRows({
    category,
    componentType,
    componentName,
    componentMaker,
    allowMakerlessForNamedLane,
    propertyKey,
  });
  return collectPendingCandidateIds({
    candidateRows: [...candidateRows, ...syntheticRows],
    reviewLookup,
    includeHumanAccepted: false,
    treatSharedAcceptAsPending: true,
  });
}

function getPendingEnumSharedCandidateIds(specDb, {
  fieldKey,
  listValueId,
}) {
  if (!specDb || !fieldKey || !listValueId) return [];
  const candidateRows = specDb.getCandidatesByListValue(fieldKey, listValueId) || [];
  const reviewRows = specDb.getReviewsForContext('list', String(listValueId)) || [];
  const reviewLookup = buildCandidateReviewLookup(reviewRows);
  return collectPendingCandidateIds({
    candidateRows,
    reviewLookup,
    includeHumanAccepted: false,
    treatSharedAcceptAsPending: true,
  });
}

async function syncSyntheticCandidatesFromComponentReview({ category, specDb }) {
  if (!specDb) return { upserted: 0 };
  const filePath = componentReviewPath({ config, category });
  const data = await safeReadJson(filePath);
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) return { upserted: 0 };

  let upserted = 0;
  let assertionsUpserted = 0;
  const sourceIds = new Set();
  const nowIso = new Date().toISOString();
  const categoryToken = String(specDb.category || category || '').trim();
  const selectItemFieldSlotId = specDb.db.prepare(
    'SELECT id FROM item_field_state WHERE category = ? AND product_id = ? AND field_key = ? LIMIT 1'
  );
  const selectEvidenceRef = specDb.db.prepare(
    'SELECT 1 FROM source_evidence_refs WHERE assertion_id = ? LIMIT 1'
  );
  for (const item of items) {
    const status = String(item?.status || '').trim().toLowerCase();
    if (status === 'dismissed') continue;
    const productId = String(item?.product_id || '').trim();
    const fieldKey = String(item?.field_key || '').trim();
    if (!productId || !fieldKey) continue;
    const runToken = normalizePathToken(item?.run_id || 'component-review', 'component-review');
    const reviewToken = normalizePathToken(item?.review_id || 'pending', 'pending');
    const sourceId = `${categoryToken}::${productId}::pipeline::${runToken}::${reviewToken}`;
    const sourceUrl = `pipeline://component-review/${reviewToken}`;
    specDb.upsertSourceRegistry({
      sourceId,
      category: categoryToken,
      itemIdentifier: productId,
      productId,
      runId: item?.run_id || null,
      sourceUrl,
      sourceHost: 'pipeline',
      sourceRootDomain: 'pipeline',
      sourceTier: null,
      sourceMethod: item?.match_type || 'component_review',
      crawlStatus: 'fetched',
      httpStatus: null,
      fetchedAt: item?.created_at || nowIso,
    });
    sourceIds.add(sourceId);

    const pushCandidate = (candidateId, value, score, method, quote, snippetText, candidateFieldKey = fieldKey) => {
      const text = String(value ?? '').trim();
      if (!text || !isMeaningfulValue(text)) return;
      const resolvedFieldKey = String(candidateFieldKey || '').trim();
      if (!resolvedFieldKey) return;
      const itemFieldStateId = selectItemFieldSlotId.get(categoryToken, productId, resolvedFieldKey)?.id ?? null;
      const normalizedText = normalizeLower(text);
      specDb.insertCandidate({
        candidate_id: candidateId,
        product_id: productId,
        field_key: resolvedFieldKey,
        value: text,
        normalized_value: normalizedText,
        score: Number.isFinite(Number(score)) ? Number(score) : 0.5,
        rank: 1,
        source_url: sourceUrl,
        source_host: 'pipeline',
        source_root_domain: 'pipeline',
        source_tier: null,
        source_method: method,
        approved_domain: 0,
        snippet_id: String(item.review_id || ''),
        snippet_hash: '',
        snippet_text: snippetText || '',
        quote: quote || '',
        quote_span_start: null,
        quote_span_end: null,
        evidence_url: '',
        evidence_retrieved_at: item.created_at || null,
        is_component_field: 1,
        component_type: item.component_type || null,
        is_list_field: 0,
        llm_extract_model: null,
        extracted_at: item.created_at || nowIso,
        run_id: item.run_id || null,
      });
      upserted += 1;
      const assertionId = String(candidateId || '').trim();
      if (!assertionId) return;
      specDb.upsertSourceAssertion({
        assertionId,
        sourceId,
        fieldKey: resolvedFieldKey,
        contextKind: 'scalar',
        contextRef: itemFieldStateId ? `item_field_state:${itemFieldStateId}` : `item_field:${productId}:${resolvedFieldKey}`,
        itemFieldStateId,
        componentValueId: null,
        listValueId: null,
        enumListId: null,
        valueRaw: text,
        valueNormalized: normalizedText,
        unit: null,
        candidateId: assertionId,
        extractionMethod: method || item?.match_type || 'component_review',
      });
      assertionsUpserted += 1;
      if (!selectEvidenceRef.get(assertionId)) {
        const quoteText = String(quote || snippetText || `Pipeline component review candidate for ${fieldKey}`).trim();
        specDb.insertSourceEvidenceRef({
          assertionId,
          evidenceUrl: sourceUrl,
          snippetId: String(item.review_id || '').trim() || null,
          quote: quoteText || null,
          method: method || item?.match_type || 'component_review',
          tier: null,
          retrievedAt: item.created_at || nowIso,
        });
      }
    };

    const primaryValue = String(item?.matched_component || item?.raw_query || '').trim();
    if (primaryValue) {
      const id = buildComponentReviewSyntheticCandidateId({
        productId,
        fieldKey,
        reviewId: String(item?.review_id || '').trim() || null,
        value: primaryValue,
      });
      pushCandidate(
        id,
        primaryValue,
        item?.combined_score ?? 0.5,
        item?.match_type || 'component_review',
        item?.raw_query ? `Raw query: "${item.raw_query}"` : '',
        item?.reasoning_note || 'Pipeline component review candidate',
      );
    }

    const attrs = item?.product_attributes && typeof item.product_attributes === 'object'
      ? item.product_attributes
      : {};
    for (const [attrKeyRaw, attrValue] of Object.entries(attrs)) {
      const attrKey = String(attrKeyRaw || '').trim();
      if (!attrKey) continue;
      for (const attrText of splitCandidateParts(attrValue)) {
        if (!isMeaningfulValue(attrText)) continue;
        const id = buildComponentReviewSyntheticCandidateId({
          productId,
          fieldKey: attrKey,
          reviewId: String(item?.review_id || '').trim() || attrKey,
          value: attrText,
        });
        pushCandidate(
          id,
          attrText,
          item?.property_score ?? 0.4,
          'product_extraction',
          `Extracted attribute "${attrKey}" from product run`,
          `${attrKey}: ${attrText}`,
          attrKey,
        );
      }
    }
  }
  return { upserted, assertionsUpserted, sourcesUpserted: sourceIds.size };
}

async function markSharedReviewItemsResolved({
  category,
  fieldKey,
  productId,
  selectedValue,
  laneAction = 'accept',
  specDb = null,
}) {
  const candidateNorm = normalizeLower(selectedValue);
  if (!candidateNorm) return { changed: 0 };
  const filePath = componentReviewPath({ config, category });
  const data = await safeReadJson(filePath);
  if (!data || !Array.isArray(data.items)) return { changed: 0 };

  const now = new Date().toISOString();
  const nextStatus = laneAction === 'accept' ? 'accepted_alias' : 'confirmed_ai';
  const changedReviewIds = [];
  let changed = 0;
  for (const item of data.items) {
    if (item?.status !== 'pending_ai') continue;
    if (String(item?.product_id || '').trim() !== String(productId || '').trim()) continue;
    if (String(item?.field_key || '').trim() !== String(fieldKey || '').trim()) continue;
    if (!candidateMatchesReviewItemValue(item, candidateNorm)) continue;
    item.status = nextStatus;
    if (laneAction === 'accept') {
      item.matched_component = String(selectedValue);
    }
    item.human_reviewed_at = now;
    changedReviewIds.push(String(item.review_id || '').trim());
    changed += 1;
  }
  if (!changed) return { changed: 0 };

  data.updated_at = now;
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  const runtimeSpecDb = specDb || getSpecDb(category);
  if (runtimeSpecDb) {
    try {
      for (const reviewId of changedReviewIds) {
        if (!reviewId) continue;
        if (laneAction === 'accept') {
          runtimeSpecDb.db.prepare(
            `UPDATE component_review_queue
             SET status = ?, matched_component = ?, human_reviewed_at = ?, updated_at = datetime('now')
             WHERE category = ? AND review_id = ?`
          ).run('accepted_alias', String(selectedValue), now, category, reviewId);
        } else {
          runtimeSpecDb.db.prepare(
            `UPDATE component_review_queue
             SET status = ?, human_reviewed_at = ?, updated_at = datetime('now')
             WHERE category = ? AND review_id = ?`
          ).run('confirmed_ai', now, category, reviewId);
        }
      }
    } catch { /* best-effort */ }
  }
  return { changed };
}

async function remapPendingComponentReviewItemsForNameChange({
  category,
  componentType,
  oldName,
  newName,
  specDb = null,
}) {
  const oldNorm = normalizeLower(oldName);
  const newValue = String(newName || '').trim();
  if (!oldNorm || !newValue || oldNorm === normalizeLower(newValue)) return { changed: 0 };

  const filePath = componentReviewPath({ config, category });
  const data = await safeReadJson(filePath);
  let changed = 0;
  const changedReviewIds = [];

  if (data && Array.isArray(data.items)) {
    for (const item of data.items) {
      if (item?.status !== 'pending_ai') continue;
      if (String(item?.component_type || '').trim() !== String(componentType || '').trim()) continue;
      const matchedNorm = normalizeLower(item?.matched_component || '');
      const rawNorm = normalizeLower(item?.raw_query || '');
      const shouldRebind = matchedNorm === oldNorm || (!matchedNorm && rawNorm === oldNorm);
      if (!shouldRebind) continue;
      item.matched_component = newValue;
      changed += 1;
      changedReviewIds.push(String(item.review_id || '').trim());
    }
    if (changed > 0) {
      data.updated_at = new Date().toISOString();
      await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    }
  }

  const runtimeSpecDb = specDb || getSpecDb(category);
  if (runtimeSpecDb) {
    try {
      if (changedReviewIds.length > 0) {
        const stmt = runtimeSpecDb.db.prepare(
          `UPDATE component_review_queue
           SET matched_component = ?, updated_at = datetime('now')
           WHERE category = ? AND review_id = ?`
        );
        for (const reviewId of changedReviewIds) {
          if (!reviewId) continue;
          stmt.run(newValue, category, reviewId);
        }
      } else {
        runtimeSpecDb.db.prepare(
          `UPDATE component_review_queue
           SET matched_component = ?, updated_at = datetime('now')
           WHERE category = ?
             AND component_type = ?
             AND status = 'pending_ai'
             AND (
               LOWER(TRIM(COALESCE(matched_component, ''))) = LOWER(TRIM(?))
               OR (
                 (matched_component IS NULL OR TRIM(matched_component) = '')
                 AND LOWER(TRIM(COALESCE(raw_query, ''))) = LOWER(TRIM(?))
               )
             )`
        ).run(newValue, category, componentType, oldName, oldName);
      }
    } catch {
      // best-effort sync
    }
  }

  return { changed };
}

async function propagateSharedLaneDecision({
  category,
  specDb,
  keyReviewState,
  laneAction,
  candidateValue = null,
}) {
  if (!specDb || !keyReviewState) return { propagated: false };
  if (String(keyReviewState.target_kind || '') !== 'grid_key') return { propagated: false };
  if (laneAction !== 'accept') return { propagated: false };

  const fieldKey = String(keyReviewState.field_key || '').trim();
  const selectedValue = String(
    candidateValue ?? keyReviewState.selected_value ?? ''
  ).trim();
  if (!fieldKey || !isMeaningfulValue(selectedValue)) return { propagated: false };

  // Grid shared accepts are strictly slot-scoped: one item field slot action must never
  // mutate peer item slots, component property slots, or enum value slots.
  return { propagated: false };
}

// â”€â”€ Process Manager â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let childProc = null;
let childLog = [];
const MAX_LOG = 2000;
let lastProcessSnapshot = {
  pid: null,
  command: null,
  startedAt: null,
  exitCode: null,
  endedAt: null
};

function isProcessRunning() {
  return Boolean(childProc && childProc.exitCode === null);
}

function processStatus() {
  const running = isProcessRunning();
  const active = running ? childProc : null;
  return {
    running,
    pid: active?.pid || lastProcessSnapshot.pid || null,
    command: active?._cmd || lastProcessSnapshot.command || null,
    startedAt: active?._startedAt || lastProcessSnapshot.startedAt || null,
    exitCode: running ? null : (lastProcessSnapshot.exitCode ?? null),
    endedAt: running ? null : (lastProcessSnapshot.endedAt || null)
  };
}

const SEARXNG_CONTAINER_NAME = 'spec-harvester-searxng';
const SEARXNG_DEFAULT_BASE_URL = 'http://127.0.0.1:8080';
const SEARXNG_COMPOSE_PATH = path.resolve('tools', 'searxng', 'docker-compose.yml');

function normalizeUrlToken(value, fallback = SEARXNG_DEFAULT_BASE_URL) {
  const raw = String(value || '').trim() || String(fallback || '').trim();
  try {
    const parsed = new URL(raw);
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return String(fallback || '').trim().replace(/\/+$/, '');
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function runCommandCapture(command, args = [], options = {}) {
  const timeoutMs = Math.max(1_000, Number.parseInt(String(options.timeoutMs || 20_000), 10) || 20_000);
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let proc = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      proc = spawn(command, args, {
        cwd: options.cwd || path.resolve('.'),
        env: options.env || process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      finish({
        ok: false,
        code: null,
        stdout,
        stderr,
        error: error?.message || String(error || '')
      });
      return;
    }

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      finish({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}\ncommand_timeout`.trim(),
        error: 'command_timeout'
      });
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    proc.on('error', (error) => {
      clearTimeout(timer);
      finish({
        ok: false,
        code: null,
        stdout,
        stderr,
        error: error?.message || String(error || '')
      });
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      finish({
        ok: code === 0,
        code: Number.isFinite(code) ? code : null,
        stdout,
        stderr
      });
    });
  });
}

async function probeSearxngHttp(baseUrl) {
  const normalizedBase = normalizeUrlToken(baseUrl, SEARXNG_DEFAULT_BASE_URL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const probe = new URL('/search', `${normalizedBase}/`);
    probe.searchParams.set('q', 'health');
    probe.searchParams.set('format', 'json');
    probe.searchParams.set('language', 'en');
    probe.searchParams.set('safesearch', '0');
    const response = await fetch(probe, { signal: controller.signal });
    return {
      ok: response.ok,
      status: response.status
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error?.message || String(error || '')
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getSearxngStatus() {
  const baseUrl = normalizeUrlToken(config.searxngBaseUrl || process.env.SEARXNG_BASE_URL || '', SEARXNG_DEFAULT_BASE_URL);
  const composeFileExists = fsSync.existsSync(SEARXNG_COMPOSE_PATH);
  const dockerVersion = await runCommandCapture('docker', ['--version'], { timeoutMs: 6_000 });
  const dockerAvailable = dockerVersion.ok;

  let running = false;
  let statusText = '';
  let portsText = '';
  let containerFound = false;
  let dockerPsError = '';

  if (dockerAvailable) {
    const ps = await runCommandCapture(
      'docker',
      ['ps', '-a', '--filter', `name=${SEARXNG_CONTAINER_NAME}`, '--format', '{{.Names}}\t{{.Status}}\t{{.Ports}}'],
      { timeoutMs: 10_000 }
    );
    if (ps.ok) {
      const first = String(ps.stdout || '')
        .split(/\r?\n/)
        .map((row) => row.trim())
        .find(Boolean) || '';
      if (first) {
        containerFound = true;
        const parts = first.split('\t');
        statusText = String(parts[1] || '').trim();
        portsText = String(parts[2] || '').trim();
        running = /^up\b/i.test(statusText);
      }
    } else {
      dockerPsError = String(ps.stderr || ps.error || '').trim();
    }
  }

  const httpProbe = running ? await probeSearxngHttp(baseUrl) : { ok: false, status: 0 };
  const httpReady = Boolean(httpProbe.ok);
  const canStart = dockerAvailable && composeFileExists;
  const needsStart = !running;

  let message = '';
  if (!dockerAvailable) {
    message = 'docker_not_available';
  } else if (!composeFileExists) {
    message = 'compose_file_missing';
  } else if (needsStart) {
    message = 'stopped';
  } else if (!httpReady) {
    message = 'container_running_http_unready';
  } else {
    message = 'ready';
  }

  return {
    container_name: SEARXNG_CONTAINER_NAME,
    compose_path: SEARXNG_COMPOSE_PATH,
    compose_file_exists: composeFileExists,
    base_url: baseUrl,
    docker_available: dockerAvailable,
    container_found: containerFound,
    running,
    status: statusText || (running ? 'Up' : 'Not running'),
    ports: portsText || '',
    http_ready: httpReady,
    http_status: Number(httpProbe.status || 0),
    can_start: canStart,
    needs_start: needsStart,
    message,
    docker_error: dockerPsError || undefined,
    http_error: httpProbe?.error || undefined
  };
}

async function startSearxngStack() {
  const composeFileExists = fsSync.existsSync(SEARXNG_COMPOSE_PATH);
  if (!composeFileExists) {
    return {
      ok: false,
      error: 'compose_file_missing',
      status: await getSearxngStatus()
    };
  }

  const up = await runCommandCapture(
    'docker',
    ['compose', '-f', SEARXNG_COMPOSE_PATH, 'up', '-d'],
    { timeoutMs: 60_000 }
  );
  if (!up.ok) {
    return {
      ok: false,
      error: String(up.stderr || up.error || 'docker_compose_up_failed').trim(),
      status: await getSearxngStatus()
    };
  }

  for (let i = 0; i < 10; i += 1) {
    const status = await getSearxngStatus();
    if (status.http_ready || status.running) {
      return {
        ok: true,
        started: true,
        compose_stdout: String(up.stdout || '').trim(),
        status
      };
    }
    await sleep(800);
  }

  return {
    ok: true,
    started: true,
    compose_stdout: String(up.stdout || '').trim(),
    status: await getSearxngStatus()
  };
}

function startProcess(cmd, cliArgs, envOverrides = {}) {
  if (isProcessRunning()) {
    throw new Error('process_already_running');
  }
  childLog = [];
  const runtimeEnv = {
    ...process.env,
    LOCAL_MODE: 'true'
  };
  for (const [key, value] of Object.entries(envOverrides || {})) {
    if (!key) continue;
    if (value === undefined || value === null || value === '') continue;
    runtimeEnv[String(key)] = String(value);
  }
  const child = spawn('node', [cmd, ...cliArgs], {
    cwd: path.resolve('.'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: runtimeEnv,
  });
  child._cmd = `node ${cmd} ${cliArgs.join(' ')}`;
  child._startedAt = new Date().toISOString();
  lastProcessSnapshot = {
    pid: child.pid || null,
    command: child._cmd,
    startedAt: child._startedAt,
    exitCode: null,
    endedAt: null
  };
  child.stdout.on('data', (d) => {
    const lines = d.toString().split('\n').filter(Boolean);
    childLog.push(...lines);
    if (childLog.length > MAX_LOG) childLog.splice(0, childLog.length - MAX_LOG);
    broadcastWs('process', lines);
  });
  child.stderr.on('data', (d) => {
    const lines = d.toString().split('\n').filter(Boolean);
    childLog.push(...lines);
    if (childLog.length > MAX_LOG) childLog.splice(0, childLog.length - MAX_LOG);
    broadcastWs('process', lines);
  });
  child.on('exit', (code, signal) => {
    const resolvedExitCode = Number.isFinite(code) ? code : null;
    const resolvedSignal = String(signal || '').trim();
    broadcastWs(
      'process',
      [`[process exited with code ${resolvedExitCode === null ? 'null' : resolvedExitCode}${resolvedSignal ? ` signal ${resolvedSignal}` : ''}]`]
    );
    lastProcessSnapshot = {
      ...lastProcessSnapshot,
      pid: child.pid || lastProcessSnapshot.pid,
      command: child._cmd || lastProcessSnapshot.command,
      startedAt: child._startedAt || lastProcessSnapshot.startedAt,
      exitCode: resolvedExitCode,
      endedAt: new Date().toISOString()
    };
    if (childProc === child) {
      childProc = null;
    }
    if (resolvedExitCode === 0) {
      const catIdx = cliArgs.indexOf('--category');
      if (catIdx >= 0 && cliArgs[catIdx + 1]) {
        const cat = cliArgs[catIdx + 1];
        sessionCache.invalidateSessionCache(cat);
        invalidateFieldRulesCache(cat);
        reviewLayoutByCategory.delete(cat);
        broadcastWs('data-change', { type: 'process-completed', category: cat });
      }
    }
  });
  childProc = child;
  return processStatus();
}

function waitForProcessExit(proc = childProc, timeoutMs = 7000) {
  const runningProc = proc;
  if (!runningProc || runningProc.exitCode !== null) {
    return Promise.resolve(true);
  }
  const limitMs = Math.max(250, Number.parseInt(String(timeoutMs || 7000), 10) || 7000);
  return new Promise((resolve) => {
    let finished = false;
    const onExit = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      runningProc.off('exit', onExit);
      resolve(runningProc.exitCode !== null);
    }, limitMs);
    runningProc.once('exit', onExit);
  });
}

function killWindowsProcessTree(pid) {
  const safePid = Number.parseInt(String(pid || ''), 10);
  if (!Number.isFinite(safePid) || safePid <= 0 || process.platform !== 'win32') {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    execCb(`taskkill /PID ${safePid} /T /F`, (error) => {
      resolve(!error);
    });
  });
}

function parsePidRows(value) {
  return [...new Set(
    String(value || '')
      .split(/\r?\n/)
      .map((row) => Number.parseInt(String(row || '').trim(), 10))
      .filter((pid) => Number.isFinite(pid) && pid > 0)
  )];
}

async function findOrphanIndexLabPids() {
  if (process.platform === 'win32') {
    const psScript = [
      "$ErrorActionPreference='SilentlyContinue'",
      "Get-CimInstance Win32_Process",
      "| Where-Object {",
      "  (",
      "    $_.Name -match '^(node|node\\.exe|cmd\\.exe|powershell\\.exe|pwsh\\.exe)$'",
      "  )",
      "  -and $_.CommandLine",
      "  -and (",
      "    $_.CommandLine -match 'src[\\\\/]cli[\\\\/](spec|indexlab)\\.js'",
      "  )",
      "  -and (",
      "    $_.CommandLine -match '\\bindexlab\\b'",
      "    -or $_.CommandLine -match '--mode\\s+indexlab'",
      "    -or $_.CommandLine -match '--local'",
      "  )",
      "}",
      "| Select-Object -ExpandProperty ProcessId"
    ].join(' ');
    const listed = await runCommandCapture(
      'powershell',
      ['-NoProfile', '-Command', psScript],
      { timeoutMs: 8_000 }
    );
    if (!listed.ok && !String(listed.stdout || '').trim()) return [];
    return parsePidRows(listed.stdout);
  }

  const listed = await runCommandCapture(
    'sh',
    ['-lc', "ps -eo pid=,args= | grep -E \"(node|sh|bash).*(src/cli/(spec|indexlab)\\.js).*(indexlab|--mode indexlab|--local)\" | grep -v grep | awk '{print $1}'"],
    { timeoutMs: 8_000 }
  );
  if (!listed.ok && !String(listed.stdout || '').trim()) return [];
  return parsePidRows(listed.stdout);
}

async function stopOrphanIndexLabProcesses(timeoutMs = 8000) {
  const currentPid = Number.parseInt(String(childProc?.pid || 0), 10);
  const targets = (await findOrphanIndexLabPids())
    .filter((pid) => !(Number.isFinite(currentPid) && currentPid > 0 && pid === currentPid));
  if (targets.length === 0) {
    return {
      attempted: false,
      killed: 0,
      pids: []
    };
  }

  let killed = 0;
  for (const pid of targets) {
    let ok = false;
    if (process.platform === 'win32') {
      ok = await killWindowsProcessTree(pid);
    } else {
      const term = await runCommandCapture('kill', ['-TERM', String(pid)], { timeoutMs: Math.min(3_000, timeoutMs) });
      if (!term.ok) {
        const force = await runCommandCapture('kill', ['-KILL', String(pid)], { timeoutMs: Math.min(3_000, timeoutMs) });
        ok = Boolean(force.ok);
      } else {
        ok = true;
      }
    }
    if (ok) killed += 1;
  }

  return {
    attempted: true,
    killed,
    pids: targets
  };
}

async function stopProcess(timeoutMs = 8000, options = {}) {
  const force = Boolean(options?.force);
  const runningProc = childProc;
  if (!runningProc || runningProc.exitCode !== null) {
    const orphanStop = await stopOrphanIndexLabProcesses(timeoutMs);
    return {
      ...processStatus(),
      stop_attempted: Boolean(orphanStop.attempted || force),
      stop_confirmed: true,
      orphan_killed: orphanStop.killed
    };
  }

  try { runningProc.kill('SIGTERM'); } catch { /* ignore */ }
  let exited = await waitForProcessExit(runningProc, Math.min(3000, timeoutMs));

  if (!exited && runningProc.exitCode === null) {
    try { runningProc.kill('SIGKILL'); } catch { /* ignore */ }
    exited = await waitForProcessExit(runningProc, 2000);
  }

  if (!exited && runningProc.exitCode === null) {
    await killWindowsProcessTree(runningProc.pid);
    exited = await waitForProcessExit(runningProc, Math.max(1000, timeoutMs - 5000));
  }
  let orphanKilled = 0;
  if (!exited && runningProc.exitCode === null) {
    const orphanStop = await stopOrphanIndexLabProcesses(timeoutMs);
    orphanKilled = orphanStop.killed;
    if (orphanStop.killed > 0) {
      exited = true;
    }
  }
  if (force) {
    const orphanStop = await stopOrphanIndexLabProcesses(timeoutMs);
    orphanKilled += Number(orphanStop.killed || 0);
    if (orphanStop.killed > 0) {
      exited = true;
    }
  }

  return {
    ...processStatus(),
    stop_attempted: true,
    stop_confirmed: Boolean(exited || runningProc.exitCode !== null || orphanKilled > 0),
    orphan_killed: orphanKilled
  };
}

// â”€â”€ Route Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const CATEGORY_SEGMENT_SCOPES = new Set([
  'catalog',
  'product',
  'events',
  'llm-settings',
  'queue',
  'billing',
  'learning',
  'studio',
  'workbook',
  'review',
  'review-components',
]);

const TEST_MODE_ACTION_SEGMENTS = new Set([
  'create',
  'contract-summary',
  'status',
  'generate-products',
  'run',
  'validate',
]);

function parsePath(url) {
  const [pathname, qs] = (url || '/').split('?');
  const params = new URLSearchParams(qs || '');
  const parts = pathname
    .replace(/^\/api\/v1/, '')
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try { return decodeURIComponent(part); } catch { return part; }
    });

  if (parts[1] && CATEGORY_SEGMENT_SCOPES.has(parts[0])) {
    parts[1] = resolveCategoryAlias(parts[1]);
  }
  if (parts[0] === 'test-mode' && parts[1] && !TEST_MODE_ACTION_SEGMENTS.has(parts[1])) {
    parts[1] = resolveCategoryAlias(parts[1]);
  }
  if (
    parts[0] === 'indexing'
    && (parts[1] === 'domain-checklist' || parts[1] === 'review-metrics')
    && parts[2]
  ) {
    parts[2] = resolveCategoryAlias(parts[2]);
  }

  return { parts, params, pathname };
}

// â”€â”€ Catalog builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function buildCatalog(category) {
  const catalog = await loadProductCatalog(config, category);
  const inputKeys = await storage.listInputKeys(category);
  const specDb = getSpecDb(category);
  const queue = await loadQueueState({ storage, category, specDb }).catch(() => ({ state: { products: {} } }));
  const queueProducts = queue.state?.products || {};

  // Map: normKey â†’ row (for dedup)
  const seen = new Map();

  // 1. Seed from product_catalog.json (authoritative product list)
  for (const [pid, entry] of Object.entries(catalog.products || {})) {
    const brand = String(entry.brand || '').trim();
    const model = String(entry.model || '').trim();
    const variant = cleanVariant(entry.variant);
    if (!brand || !model) continue;
    const key = catalogKey(brand, model, variant);
    if (seen.has(key)) continue;
    seen.set(key, {
      productId: pid,
      id: entry.id || 0,
      identifier: entry.identifier || '',
      brand,
      model,
      variant,
      status: 'pending',
      hasFinal: false,
      validated: false,
      confidence: 0,
      coverage: 0,
      fieldsFilled: 0,
      fieldsTotal: 0,
      lastRun: '',
      inActive: true,
    });
  }

  // 2. Merge from storage inputs (enriches existing catalog entries only)
  for (const inputKey of inputKeys) {
    const input = await storage.readJsonOrNull(inputKey);
    if (!input) continue;
    const existingProductId = input.productId || path.basename(inputKey, '.json').replace(`${category}-`, '');
    const il = input.identityLock || {};
    const brand = String(il.brand || input.brand || '').trim();
    const model = String(il.model || input.model || '').trim();
    const variant = cleanVariant(il.variant || input.variant);
    if (!brand || !model) continue;

    const latestBase = storage.resolveOutputKey(category, existingProductId, 'latest');
    const [summary, normalized, hasFinal] = await Promise.all([
      storage.readJsonOrNull(`${latestBase}/summary.json`),
      storage.readJsonOrNull(`${latestBase}/normalized.json`),
      storage.objectExists(`final/${category}/${existingProductId}/normalized.json`).catch(() => false),
    ]);
    const identity = normalized?.identity || {};
    const qp = queueProducts[existingProductId] || {};

    const resolvedBrand = identity.brand || brand;
    const resolvedModel = identity.model || model;
    let resolvedVariant = cleanVariant(identity.variant || variant);

    // Try exact match first, then collapse variant into base product
    let key = catalogKey(resolvedBrand, resolvedModel, resolvedVariant);
    if (!seen.has(key) && resolvedVariant) {
      const keyNoVariant = catalogKey(resolvedBrand, resolvedModel, '');
      if (seen.has(keyNoVariant)) {
        resolvedVariant = '';
        key = keyNoVariant;
      }
    }

    // Only enrich products already in the catalog â€” skip orphaned storage inputs
    if (!seen.has(key)) continue;

    const existing = seen.get(key);
    Object.assign(existing, {
      productId: existingProductId,
      status: qp.status || (summary ? 'complete' : 'pending'),
      hasFinal,
      validated: !!(summary?.validated),
      confidence: summary?.confidence || 0,
      coverage: (summary?.coverage_overall_percent || 0) / 100,
      fieldsFilled: summary?.fields_filled || 0,
      fieldsTotal: summary?.fields_total || 0,
      lastRun: summary?.lastRun || summary?.generated_at || '',
      inActive: existing.inActive || !!input.active || !!(input.targets && Object.keys(input.targets).length),
    });
  }

  // 3. Sort by brand, model, variant
  const rows = [...seen.values()];
  rows.sort((a, b) =>
    a.brand.localeCompare(b.brand) ||
    a.model.localeCompare(b.model) ||
    a.variant.localeCompare(b.variant)
  );
  return rows;
}

// â”€â”€ Compiled component DB dual-write â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function patchCompiledComponentDb(category, componentType, entityName, propertyPatch, identityPatch) {
  const dbDir = path.join(HELPER_ROOT, category, '_generated', 'component_db');
  const files = await listFiles(dbDir, '.json');
  for (const f of files) {
    const fp = path.join(dbDir, f);
    const data = await safeReadJson(fp);
    if (data?.component_type !== componentType || !Array.isArray(data.items)) continue;
    const item = data.items.find(it => it.name === entityName);
    if (!item) return;
    if (propertyPatch && typeof propertyPatch === 'object') {
      if (!item.properties) item.properties = {};
      Object.assign(item.properties, propertyPatch);
    }
    if (identityPatch && typeof identityPatch === 'object') {
      if (identityPatch.name !== undefined) item.name = identityPatch.name;
      if (identityPatch.maker !== undefined) item.maker = identityPatch.maker;
      if (identityPatch.links !== undefined) item.links = identityPatch.links;
      if (identityPatch.aliases !== undefined) item.aliases = identityPatch.aliases;
    }
    await fs.writeFile(fp, JSON.stringify(data, null, 2));
    return;
  }
}

// â”€â”€ Static assets root (needed by route context) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DIST_ROOT = process.env.__GUI_DIST_ROOT
  ? path.resolve(process.env.__GUI_DIST_ROOT)
  : path.resolve('tools/gui-react/dist');

// â”€â”€ Route Handler Registration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const routeCtx = {
  jsonRes,
  readJsonBody,
  toInt,
  toFloat,
  toUnitRatio,
  hasKnownValue,
  config,
  storage,
  fs,
  path,
  OUTPUT_ROOT,
  HELPER_ROOT,
  DIST_ROOT,
  INDEXLAB_ROOT,
  canonicalSlugify,
  listDirs,
  listFiles,
  safeReadJson,
  safeStat,
  safeJoin,
  getSearxngStatus,
  startSearxngStack,
  startProcess,
  stopProcess,
  processStatus,
  isProcessRunning,
  waitForProcessExit,
  getSpecDb,
  getSpecDbReady,
  broadcastWs,
  resolveCategoryAlias,
  sessionCache,
  reviewLayoutByCategory,
  specDbCache,
  invalidateFieldRulesCache,
  buildCatalog,
  reconcileOrphans,
  loadProductCatalog,
  listProducts,
  catalogAddProduct,
  catalogAddProductsBulk: catalogAddProductsBulk,
  catalogUpdateProduct,
  catalogRemoveProduct,
  catalogSeedFromWorkbook: catalogSeedFromWorkbook,
  upsertQueueProduct,
  readJsonlEvents,
  loadCategoryConfig,
  loadWorkbookMap,
  saveWorkbookMap,
  validateWorkbookMap,
  buildFieldLabelsMap,
  cleanVariant,
  slugify,
  spawn,
  // LLM config helpers
  collectLlmModels,
  llmProviderFromModel,
  resolvePricingForModel,
  resolveTokenProfileForModel,
  resolveLlmRoleDefaults,
  resolveLlmKnobDefaults,
  llmRoutingSnapshot,
  buildLlmMetrics,
  buildIndexingDomainChecklist,
  buildReviewMetrics,
  // IndexLab data builders
  readIndexLabRunEvents,
  readIndexLabRunNeedSet,
  readIndexLabRunSearchProfile,
  readIndexLabRunPhase07Retrieval,
  readIndexLabRunPhase08Extraction,
  readIndexLabRunDynamicFetchDashboard,
  readIndexLabRunSourceIndexingPackets,
  readIndexLabRunItemIndexingPacket,
  readIndexLabRunRunMetaPacket,
  readIndexLabRunSerpExplorer,
  readIndexLabRunLlmTraces,
  readIndexLabRunAutomationQueue,
  readIndexLabRunEvidenceIndex,
  listIndexLabRuns,
  buildRoundSummaryFromEvents,
  buildSearchHints,
  buildAnchorsSuggestions,
  buildKnownValuesSuggestions,
  // Brand registry
  loadBrandRegistry,
  saveBrandRegistry,
  addBrand,
  addBrandsBulk,
  updateBrand,
  removeBrand,
  getBrandsForCategory,
  seedBrandsFromActiveFiltering,
  renameBrand,
  getBrandImpactAnalysis,
  // Review
  buildReviewLayout,
  buildProductReviewPayload,
  buildReviewQueue,
  buildComponentReviewLayout,
  buildComponentReviewPayloads,
  buildEnumReviewPayloads,
  readLatestArtifacts,
  findProductsReferencingComponent,
  componentReviewPath,
  runComponentReviewBatch,
  resolveGridFieldStateForMutation,
  setOverrideFromCandidate,
  setManualOverride,
  syncPrimaryLaneAcceptFromItemSelection,
  resolveKeyReviewForLaneMutation,
  getPendingItemPrimaryCandidateIds,
  markPrimaryLaneReviewedInItemState,
  syncItemFieldStateFromPrimaryLaneAccept,
  isMeaningfulValue,
  propagateSharedLaneDecision,
  syncSyntheticCandidatesFromComponentReview,
  resolveComponentMutationContext,
  candidateLooksReference,
  normalizeLower,
  buildComponentIdentifier,
  applySharedLaneState,
  cascadeComponentChange,
  loadQueueState,
  saveQueueState,
  remapPendingComponentReviewItemsForNameChange,
  getPendingComponentSharedCandidateIdsAsync,
  resolveEnumMutationContext,
  getPendingEnumSharedCandidateIds,
  cascadeEnumChange,
  markEnumSuggestionStatusBound,
  annotateCandidatePrimaryReviews,
  ensureGridKeyReviewState,
  patchCompiledComponentDb,
  // Test mode
  buildTrafficLight,
  deriveTrafficLightCounts,
  analyzeContract,
  buildTestProducts,
  generateTestSourceResults,
  buildDeterministicSourceResults,
  buildSeedComponentDB,
  buildValidationChecks,
  loadComponentIdentityPoolsFromWorkbook,
  runTestProduct,
  purgeTestModeCategoryState,
  resetTestModeSharedReviewState,
  resetTestModeProductReviewState,
};

const handleInfraRoutes = registerInfraRoutes(routeCtx);
const handleConfigRoutes = registerConfigRoutes(routeCtx);
const handleIndexlabRoutes = registerIndexlabRoutes(routeCtx);
const handleCatalogRoutes = registerCatalogRoutes(routeCtx);
const handleBrandRoutes = registerBrandRoutes(routeCtx);
const handleStudioRoutes = registerStudioRoutes(routeCtx);
const handleReviewRoutes = registerReviewRoutes(routeCtx);
const handleTestModeRoutes = registerTestModeRoutes(routeCtx);
const handleQueueBillingLearningRoutes = registerQueueBillingLearningRoutes(routeCtx);
const handleSourceStrategyRoutes = registerSourceStrategyRoutes(routeCtx);

// â”€â”€ Route Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function handleApi(req, res) {
  const { parts, params } = parsePath(req.url);
  const method = req.method;

  const infraResult = await handleInfraRoutes(parts, params, method, req, res);
  if (infraResult !== false) return infraResult;

  const configResult = await handleConfigRoutes(parts, params, method, req, res);
  if (configResult !== false) return configResult;

  const indexlabResult = await handleIndexlabRoutes(parts, params, method, req, res);
  if (indexlabResult !== false) return indexlabResult;

  const catalogResult = await handleCatalogRoutes(parts, params, method, req, res);
  if (catalogResult !== false) return catalogResult;

  const brandResult = await handleBrandRoutes(parts, params, method, req, res);
  if (brandResult !== false) return brandResult;

  const studioResult = await handleStudioRoutes(parts, params, method, req, res);
  if (studioResult !== false) return studioResult;

  const qblResult = await handleQueueBillingLearningRoutes(parts, params, method, req, res);
  if (qblResult !== false) return qblResult;

  const reviewResult = await handleReviewRoutes(parts, params, method, req, res);
  if (reviewResult !== false) return reviewResult;

  const testModeResult = await handleTestModeRoutes(parts, params, method, req, res);
  if (testModeResult !== false) return testModeResult;

  const sourceStrategyResult = await handleSourceStrategyRoutes(parts, params, method, req, res);
  if (sourceStrategyResult !== false) return sourceStrategyResult;

  return null; // not handled
}


// â”€â”€ Static File Serving â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function serveStatic(req, res) {
  let filePath = path.join(DIST_ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  // For SPA, serve index.html for non-file paths
  const ext = path.extname(filePath);
  if (!ext) filePath = path.join(DIST_ROOT, 'index.html');

  const stream = createReadStream(filePath);
  stream.on('error', () => {
    // Fallback to index.html for SPA routing
    const indexStream = createReadStream(path.join(DIST_ROOT, 'index.html'));
    indexStream.on('error', () => {
      res.statusCode = 404;
      res.end('Not Found');
    });
    res.setHeader('Content-Type', 'text/html');
    indexStream.pipe(res);
  });
  const contentType = mimeType(path.extname(filePath) || '.html');
  res.setHeader('Content-Type', contentType);
  // Prevent caching of all static files so new builds are always picked up
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  stream.pipe(res);
}

// â”€â”€ WebSocket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const wsClients = new Set();

function wsToken(value) {
  return String(value || '').trim().toLowerCase();
}

function wsEventProductId(evt) {
  return String(evt?.productId || evt?.product_id || '').trim();
}

function wsEventMatchesCategory(evt, categoryToken) {
  if (!categoryToken) return true;
  const evtCategory = wsToken(evt?.category || evt?.cat || '');
  if (evtCategory) return evtCategory === categoryToken;
  const pid = wsToken(wsEventProductId(evt));
  return pid.startsWith(`${categoryToken}-`);
}

function wsClientWantsChannel(client, channel) {
  const channels = Array.isArray(client?._channels) ? client._channels : [];
  if (channels.length === 0) return true;
  return channels.includes(channel);
}

function wsFilterPayload(channel, data, client) {
  if (channel === 'events' && Array.isArray(data)) {
    const categoryToken = wsToken(client?._category);
    const productId = String(client?._productId || '').trim();
    let rows = data;
    if (categoryToken) {
      rows = rows.filter((evt) => wsEventMatchesCategory(evt, categoryToken));
    }
    if (productId) {
      rows = rows.filter((evt) => wsEventProductId(evt) === productId);
    }
    return rows.length > 0 ? rows : null;
  }
  if (channel === 'indexlab-event' && Array.isArray(data)) {
    const categoryToken = wsToken(client?._category);
    const productId = String(client?._productId || '').trim();
    let rows = data;
    if (categoryToken) {
      rows = rows.filter((evt) => wsToken(evt?.category || '') === categoryToken);
    }
    if (productId) {
      rows = rows.filter((evt) => String(evt?.product_id || '').trim() === productId);
    }
    return rows.length > 0 ? rows : null;
  }
  if (channel === 'data-change' && data && typeof data === 'object') {
    const categoryToken = wsToken(client?._category);
    const dataCategory = wsToken(data.category);
    if (categoryToken && dataCategory && categoryToken !== dataCategory) {
      return null;
    }
  }
  return data;
}

function broadcastWs(channel, data) {
  const timestamp = new Date().toISOString();
  for (const client of wsClients) {
    if (client.readyState !== 1) continue; // OPEN
    if (!wsClientWantsChannel(client, channel)) continue;
    const filtered = wsFilterPayload(channel, data, client);
    if (filtered === null || filtered === undefined) continue;
    try {
      client.send(JSON.stringify({ channel, data: filtered, ts: timestamp }));
    } catch {
      // ignore broken sockets
    }
  }
}

// â”€â”€ File Watchers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function setupWatchers() {
  const eventsPath = path.join(OUTPUT_ROOT, '_runtime', 'events.jsonl');
  let lastEventSize = 0;
  const indexlabOffsets = new Map();

  // Watch events.jsonl for new lines
  const eventsWatcher = watch(eventsPath, { persistent: true, ignoreInitial: true });
  eventsWatcher.on('change', async () => {
    try {
      const stat = await fs.stat(eventsPath);
      if (stat.size <= lastEventSize) { lastEventSize = stat.size; return; }
      const fd = await fs.open(eventsPath, 'r');
      const buf = Buffer.alloc(stat.size - lastEventSize);
      await fd.read(buf, 0, buf.length, lastEventSize);
      await fd.close();
      lastEventSize = stat.size;
      const newLines = buf.toString('utf8').split('\n').filter(Boolean);
      const events = newLines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      if (events.length > 0) broadcastWs('events', events);
    } catch { /* ignore */ }
  });

  const indexlabPattern = path.join(INDEXLAB_ROOT, '*', 'run_events.ndjson');
  const indexlabWatcher = watch(indexlabPattern, { persistent: true, ignoreInitial: true });

  const publishIndexLabDelta = async (filePath) => {
    try {
      const stat = await fs.stat(filePath);
      const key = path.resolve(filePath);
      const previousSize = indexlabOffsets.get(key) || 0;
      if (stat.size < previousSize) {
        indexlabOffsets.set(key, 0);
      }
      const start = Math.max(0, Math.min(previousSize, stat.size));
      if (stat.size <= start) {
        indexlabOffsets.set(key, stat.size);
        return;
      }
      const fd = await fs.open(filePath, 'r');
      const buf = Buffer.alloc(stat.size - start);
      await fd.read(buf, 0, buf.length, start);
      await fd.close();
      indexlabOffsets.set(key, stat.size);
      const rows = parseNdjson(buf.toString('utf8'));
      if (rows.length > 0) {
        broadcastWs('indexlab-event', rows);
      }
    } catch {
      // ignore watcher errors
    }
  };

  indexlabWatcher.on('add', publishIndexLabDelta);
  indexlabWatcher.on('change', publishIndexLabDelta);
}

// â”€â”€ HTTP Server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const server = http.createServer(async (req, res) => {
  corsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // API routes
  if (req.url.startsWith('/api/v1/') || req.url === '/health') {
    try {
      const handled = await handleApi(req, res);
      if (handled === null) {
        jsonRes(res, 404, { error: 'not_found' });
      }
    } catch (err) {
      console.error('[gui-server] API error:', err.message);
      jsonRes(res, 500, { error: 'internal', message: err.message });
    }
    return;
  }

  // Static files
  serveStatic(req, res);
});

// WebSocket server
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws' || req.url?.startsWith('/ws?')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wsClients.add(ws);
      ws.on('message', (msg) => {
        try {
          const data = JSON.parse(msg.toString());
          // Store subscription info on the client (for future filtering)
          if (data.subscribe) ws._channels = data.subscribe;
          if (data.category) ws._category = data.category;
          if (data.productId) ws._productId = data.productId;
        } catch { /* ignore */ }
      });
      ws.on('close', () => wsClients.delete(ws));
      ws.on('error', () => wsClients.delete(ws));
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const msg = `[gui-server] running on http://localhost:${PORT}`;
  console.log(msg);
  console.log(`[gui-server] API:     http://localhost:${PORT}/api/v1/health`);
  console.log(`[gui-server] WS:      ws://localhost:${PORT}/ws`);
  console.log(`[gui-server] Static:  ${DIST_ROOT}`);
  try {
    const distFiles = fsSync.readdirSync(path.join(DIST_ROOT, 'assets'));
    console.log(`[gui-server] Assets:  ${distFiles.join(', ')}`);
  } catch { console.log('[gui-server] Assets:  (could not list)'); }
  setupWatchers();

  // Auto-open browser when --open flag is passed (used by SpecFactory.exe launcher)
  if (args.includes('--open')) {
    const url = `http://localhost:${PORT}?_=${Date.now()}`;
    console.log(`[gui-server] Opening browser -> ${url}`);
    // Windows: start, macOS: open, Linux: xdg-open
    const cmd = process.platform === 'win32' ? `start "" "${url}"`
      : process.platform === 'darwin' ? `open "${url}"`
      : `xdg-open "${url}"`;
    execCb(cmd);
  }
});
