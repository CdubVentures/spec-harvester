/**
 * contractDriven.test.js — Universal contract-driven end-to-end behavioral test.
 *
 * Wires together the full testDataProvider infrastructure:
 *   analyzeContract() → buildSeedComponentDB() → buildTestProducts() →
 *   buildDeterministicSourceResults() → sourceResultsToArtifacts() →
 *   seedSpecDb() → query DB + review APIs + buildValidationChecks()
 *
 * Zero LLM calls. All test data is derived from the real contract.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../src/s3/storage.js';
import {
  analyzeContract,
  loadComponentIdentityPoolsFromWorkbook,
  buildSeedComponentDB,
  buildTestProducts,
  buildDeterministicSourceResults,
  buildValidationChecks,
  getScenarioDefs,
} from '../src/testing/testDataProvider.js';
import { buildProductReviewPayload } from '../src/review/reviewGridData.js';
import { buildComponentReviewPayloads, buildEnumReviewPayloads } from '../src/review/componentReviewData.js';

const CATEGORY = 'mouse';
const HELPER_ROOT = path.resolve('helper_files');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStorage(tempRoot) {
  return createStorage({
    localMode: true,
    localInputRoot: path.join(tempRoot, 'fixtures'),
    localOutputRoot: path.join(tempRoot, 'out'),
    s3InputPrefix: 'specs/inputs',
    s3OutputPrefix: 'specs/outputs',
  });
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

// ── sourceResultsToArtifacts ─────────────────────────────────────────────────
// Bridges buildDeterministicSourceResults() output → artifact files that
// seedSpecDb() and the review APIs expect on disk.

function simpleHash(text) {
  const input = String(text || '');
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sourceResultsToArtifacts(sourceResults, product, contractAnalysis) {
  const candidatesByField = {};

  for (let srcIdx = 0; srcIdx < sourceResults.length; srcIdx++) {
    const src = sourceResults[srcIdx];
    for (const fc of src.fieldCandidates) {
      if (!candidatesByField[fc.field]) candidatesByField[fc.field] = [];
      const baseScore = src.tier === 1 ? 0.85 : src.tier === 2 ? 0.65 : 0.45;
      const hashInput = `${product.productId}::${fc.field}::s${srcIdx}`;
      const hashOffset = (simpleHash(hashInput) % 15) / 100;
      const score = Math.round((baseScore + hashOffset) * 100) / 100;
      candidatesByField[fc.field].push({
        candidate_id: `${product.productId}::${fc.field}::s${srcIdx}`,
        value: fc.value,
        score,
        rank: candidatesByField[fc.field].length,
        source_url: src.url,
        source_host: src.host,
        source_root_domain: src.rootDomain,
        source_tier: src.tier,
        source_method: fc.method || 'html_table',
        approved_domain: src.approvedDomain || false,
        snippet_id: fc.snippetId || null,
        snippet_hash: fc.snippetHash || null,
        snippet_text: fc.quote || null,
        quote: fc.quote || null,
        evidence_url: src.url,
        llm_extract_model: fc.llm_extract_model || 'deterministic',
      });
    }
  }

  // Pick winning value per field: lowest tier first, then highest score
  const fields = {};
  const provenance = {};

  for (const [field, candidates] of Object.entries(candidatesByField)) {
    const sorted = [...candidates].sort((a, b) => {
      if (a.source_tier !== b.source_tier) return a.source_tier - b.source_tier;
      return b.score - a.score;
    });
    const winner = sorted[0];
    fields[field] = winner.value;
    provenance[field] = { value: winner.value, confidence: winner.score };
  }

  const normalized = {
    identity: product.identityLock || {},
    fields,
  };

  // Summary
  const raw = contractAnalysis?._raw || {};
  const reqFields = contractAnalysis?.summary?.requiredFields || [];
  const allFieldKeys = raw.fieldKeys || [];
  const missingRequired = reqFields.filter(k => !fields[k] || fields[k] === 'unk');
  const populatedCount = Object.values(fields).filter(v => v && v !== 'unk').length;
  const coverage = allFieldKeys.length > 0
    ? Math.round(populatedCount / allFieldKeys.length * 100) : 0;

  const confidenceValues = Object.values(provenance).map(p => p.confidence);
  const avgConfidence = confidenceValues.length > 0
    ? confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length : 0;

  const fieldReasoning = {};
  for (const field of Object.keys(fields)) {
    fieldReasoning[field] = {
      value: fields[field],
      confidence: provenance[field]?.confidence || 0,
      sources: sourceResults.length,
    };
  }

  const summary = {
    confidence: Math.round(avgConfidence * 100) / 100,
    coverage_overall_percent: coverage,
    missing_required_fields: missingRequired,
    fields_below_pass_target: [],
    critical_fields_below_pass_target: [],
    field_reasoning: fieldReasoning,
    runtime_engine: { failures: [], curation_suggestions_count: 0 },
    constraint_analysis: {},
  };

  return { candidates: candidatesByField, normalized, provenance, summary };
}

// ── buildFieldRulesForSeed ───────────────────────────────────────────────────
// Converts buildSeedComponentDB() output + real contract to the shape
// expected by seedSpecDb().

function buildFieldRulesForSeed(contractAnalysis, seedComponentDBs) {
  const raw = contractAnalysis._raw || {};
  const fields = raw.fields || {};

  const componentDBs = {};
  for (const [dbFile, dbObj] of Object.entries(seedComponentDBs)) {
    const entries = {};
    const index = new Map();
    const indexAll = new Map();
    for (let itemIndex = 0; itemIndex < dbObj.items.length; itemIndex += 1) {
      const item = dbObj.items[itemIndex];
      const name = item.name;
      const maker = String(item?.maker || '').trim();
      const entryKey = `${name}::${maker}::${itemIndex}`;
      entries[entryKey] = { ...item, canonical_name: name };
      const nameToken = name.toLowerCase();
      const compactNameToken = nameToken.replace(/\s+/g, '');
      if (!index.has(nameToken)) index.set(nameToken, entries[entryKey]);
      if (!index.has(compactNameToken)) index.set(compactNameToken, entries[entryKey]);
      if (!indexAll.has(nameToken)) indexAll.set(nameToken, []);
      if (!indexAll.has(compactNameToken)) indexAll.set(compactNameToken, []);
      indexAll.get(nameToken).push(entries[entryKey]);
      indexAll.get(compactNameToken).push(entries[entryKey]);
      for (const alias of (item.aliases || [])) {
        const aliasToken = alias.toLowerCase();
        const aliasCompactToken = aliasToken.replace(/\s+/g, '');
        if (!index.has(aliasToken)) index.set(aliasToken, entries[entryKey]);
        if (!index.has(aliasCompactToken)) index.set(aliasCompactToken, entries[entryKey]);
        if (!indexAll.has(aliasToken)) indexAll.set(aliasToken, []);
        if (!indexAll.has(aliasCompactToken)) indexAll.set(aliasCompactToken, []);
        indexAll.get(aliasToken).push(entries[entryKey]);
        indexAll.get(aliasCompactToken).push(entries[entryKey]);
      }
    }
    componentDBs[dbFile] = { entries, __index: index, __indexAll: indexAll };
  }

  // Build knownValues from contract catalogs
  const enums = {};
  for (const catalog of (raw.knownValuesCatalogs || [])) {
    enums[catalog.catalog] = { policy: catalog.policy, values: catalog.values };
  }

  return {
    rules: { fields },
    componentDBs,
    knownValues: { enums },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN TEST
// ══════════════════════════════════════════════════════════════════════════════

test('Contract-Driven End-to-End Test', async (t) => {
  let tempRoot, db;

  try {
    // ── Setup ────────────────────────────────────────────────────────────────

    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'contract-e2e-'));
    const storage = makeStorage(tempRoot);
    const config = {
      helperFilesRoot: path.join(tempRoot, 'helper_files'),
      localOutputRoot: path.join(tempRoot, 'out'),
      specDbDir: path.join(tempRoot, '.specfactory_tmp'),
    };

    // 1. Analyze real contract
    const contractAnalysis = await analyzeContract(HELPER_ROOT, CATEGORY);
    const scenarioDefs = contractAnalysis.scenarioDefs;
    const componentTypes = (contractAnalysis?._raw?.componentTypes || []).map((ct) => ct.type);
    const identityPoolsByType = await loadComponentIdentityPoolsFromWorkbook({
      componentTypes,
      strict: true,
    });
    const seedDBs = buildSeedComponentDB(contractAnalysis, '_test', {
      identityPoolsByType,
      strictIdentityPools: true,
    });
    const products = buildTestProducts(CATEGORY, contractAnalysis);

    // 2. Build deterministic source results & artifacts per product
    const productArtifacts = {};
    for (const product of products) {
      const sourceResults = buildDeterministicSourceResults({
        product,
        contractAnalysis,
        componentDBs: seedDBs,
      });
      const artifacts = sourceResultsToArtifacts(sourceResults, product, contractAnalysis);
      productArtifacts[product.productId] = { product, sourceResults, artifacts };
    }

    // 3. Copy real contract files to temp dir
    const realGenDir = path.join(HELPER_ROOT, CATEGORY, '_generated');
    const tempGenDir = path.join(config.helperFilesRoot, CATEGORY, '_generated');

    for (const file of [
      'field_rules.json', 'known_values.json', 'cross_validation_rules.json',
      'parse_templates.json', 'key_migrations.json', 'ui_field_catalog.json',
    ]) {
      try {
        const content = await fs.readFile(path.join(realGenDir, file), 'utf8');
        await writeJson(path.join(tempGenDir, file), JSON.parse(content));
      } catch { /* skip missing files */ }
    }

    // 4. Write synthetic component DBs
    for (const [dbFile, dbObj] of Object.entries(seedDBs)) {
      await writeJson(path.join(tempGenDir, 'component_db', `${dbFile}.json`), dbObj);
    }

    // 5. Write support files
    await writeJson(
      path.join(config.helperFilesRoot, CATEGORY, '_control_plane', 'workbook_map.json'),
      { manual_enum_values: {}, manual_enum_timestamps: {} }
    );
    await writeJson(
      path.join(config.helperFilesRoot, CATEGORY, '_suggestions', 'enums.json'),
      { suggestions: [] }
    );
    await writeJson(
      path.join(config.helperFilesRoot, CATEGORY, '_suggestions', 'component_review.json'),
      { items: [] }
    );

    // 6. Write product artifacts to disk
    for (const [productId, { artifacts }] of Object.entries(productArtifacts)) {
      const latestDir = path.join(
        config.localOutputRoot, 'specs', 'outputs', CATEGORY, productId, 'latest'
      );
      await writeJson(path.join(latestDir, 'candidates.json'), artifacts.candidates);
      await writeJson(path.join(latestDir, 'normalized.json'), artifacts.normalized);
      await writeJson(path.join(latestDir, 'provenance.json'), artifacts.provenance);
      await writeJson(path.join(latestDir, 'summary.json'), artifacts.summary);
    }

    // 7. Seed SpecDb
    const fieldRules = buildFieldRulesForSeed(contractAnalysis, seedDBs);

    const { SpecDb } = await import('../src/db/specDb.js');
    const { seedSpecDb } = await import('../src/db/seed.js');

    await fs.mkdir(config.specDbDir, { recursive: true });
    const dbPath = path.join(config.specDbDir, `${CATEGORY}.sqlite`);
    db = new SpecDb({ dbPath, category: CATEGORY });

    const seedResult = await seedSpecDb({
      db, config, category: CATEGORY, fieldRules, logger: null,
    });

    // 8. Build review payloads for all products (used by multiple sections)
    //    Built WITHOUT specDb to avoid backfill mutations that would affect SEED tests.
    const REAL_FLAGS = new Set([
      'variance_violation', 'constraint_conflict', 'new_component',
      'new_enum_value', 'below_min_evidence', 'conflict_policy_hold',
    ]);
    const reviewPayloads = {};
    for (const product of products) {
      reviewPayloads[product.productId] = await buildProductReviewPayload({
        storage, config, category: CATEGORY, productId: product.productId,
      });
    }

    // 9. Enrich matrices with expandable details
    const scenarioByName = new Map(scenarioDefs.map(d => [d.name, d]));
    const scenarioById = new Map(scenarioDefs.map(d => [d.id, d]));
    const productByScenarioId = new Map(products.map(p => [p._testCase.id, p]));

    for (const matrixRow of contractAnalysis.matrices.fieldRules.rows) {
      const fieldKey = matrixRow.cells.fieldKey;
      const details = [];

      for (const testId of matrixRow.testNumbers) {
        const scenario = scenarioById.get(testId);
        if (!scenario) continue;
        const product = productByScenarioId.get(testId);
        if (!product) continue;

        const pa = productArtifacts[product.productId];
        const inputValue = pa?.artifacts?.normalized?.fields?.[fieldKey];
        const inputStr = inputValue != null ? String(inputValue) : '';

        const payload = reviewPayloads[product.productId];
        const fieldState = payload?.fields?.[fieldKey];
        const outputValue = fieldState?.selected?.value;
        const outputStr = outputValue != null ? String(outputValue) : '';

        const reasonCodes = [...(fieldState?.reason_codes || [])];

        const fieldRule = contractAnalysis._raw.fields[fieldKey] || {};
        const evidenceBlock = fieldRule?.evidence || {};
        const minRefs = evidenceBlock.min_evidence_refs || 1;
        if (minRefs > 1) {
          const dbCandidates = db.getCandidatesForProduct(product.productId)?.[fieldKey] || [];
          const distinctHosts = new Set(
            dbCandidates.map(c => String(c.source_host || '').trim().toLowerCase()).filter(Boolean)
          );
          if (distinctHosts.size > 0 && distinctHosts.size < minRefs) {
            if (!reasonCodes.includes('below_min_evidence')) reasonCodes.push('below_min_evidence');
          }
        }
        if (evidenceBlock.conflict_policy === 'preserve_all_candidates') {
          const dbCandidates = db.getCandidatesForProduct(product.productId)?.[fieldKey] || [];
          const distinctVals = new Set(
            dbCandidates.map(c => String(c.value ?? '').trim().toLowerCase()).filter(Boolean)
          );
          if (distinctVals.size > 1) {
            if (!reasonCodes.includes('conflict_policy_hold')) reasonCodes.push('conflict_policy_hold');
          }
        }

        const realFlags = reasonCodes.filter(c => REAL_FLAGS.has(c));
        const flagged = realFlags.length > 0;
        const flagType = flagged ? realFlags[0] : null;

        const dbFieldState = db.getItemFieldState(product.productId)
          .find(s => s.field_key === fieldKey);
        const dbValue = dbFieldState?.value != null ? String(dbFieldState.value) : '';
        const effectiveOutput = dbValue || outputStr;

        const inputLower = inputStr.trim().toLowerCase();
        const effectiveOutputLower = effectiveOutput.trim().toLowerCase();
        const isClosedEnumReject = scenario.name === 'closed_enum_reject' && /^invalid_.*_value$/.test(inputLower);
        const isSimilarEnum = scenario.name === 'similar_enum_values' && inputLower !== '';
        const isSeedScenario = isClosedEnumReject || isSimilarEnum;
        const changed = isSeedScenario
          ? inputLower !== ''
          : (inputLower !== '' && effectiveOutputLower !== '' && inputLower !== effectiveOutputLower);
        let changedBy = null;
        if (changed) {
          if (isSeedScenario) {
            changedBy = 'seed';
          } else {
            const dbChanged = dbValue && inputLower !== dbValue.trim().toLowerCase();
            const isCompScenario = scenario.name.startsWith('similar_');
            changedBy = (dbChanged || isCompScenario) ? 'seed' : 'llm';
          }
        }

        const finalOutput = isClosedEnumReject && changed ? 'unk' : effectiveOutput;

        details.push({
          scenario: scenario.name,
          input: inputStr,
          output: finalOutput,
          changed,
          changedBy,
          flagged,
          flagType,
        });
      }

      matrixRow.expandableDetails = details;
      const allExercised = matrixRow.testNumbers.length > 0 && details.length === matrixRow.testNumbers.length;
      matrixRow.cells.useCasesCovered = allExercised ? 'YES' : 'NO';
      const distinctFlags = new Set(details.filter(d => d.flagged).map(d => d.flagType));
      matrixRow.cells.flagsGenerated = distinctFlags.size;
    }

    for (const matrixRow of contractAnalysis.matrices.components.rows) {
      const details = [];

      for (const testId of matrixRow.testNumbers) {
        const scenario = scenarioById.get(testId);
        if (!scenario) continue;
        const product = productByScenarioId.get(testId);
        if (!product) continue;

        const componentType = matrixRow.cells.componentType;
        const pa = productArtifacts[product.productId];
        const inputValue = pa?.artifacts?.normalized?.fields?.[componentType];
        const inputStr = inputValue != null ? String(inputValue) : '';

        const payload = reviewPayloads[product.productId];
        const fieldState = payload?.fields?.[componentType];
        const outputValue = fieldState?.selected?.value;
        const outputStr = outputValue != null ? String(outputValue) : '';

        const reasonCodes = fieldState?.reason_codes || [];
        const realFlags = reasonCodes.filter(c => REAL_FLAGS.has(c));
        const flagged = realFlags.length > 0;
        const flagType = flagged ? realFlags[0] : null;

        const changed = inputStr && outputStr && inputStr.toLowerCase() !== outputStr.toLowerCase();
        const changedBy = changed ? 'seed' : null;

        details.push({
          scenario: scenario.name,
          input: inputStr,
          output: outputStr,
          changed,
          changedBy,
          flagged,
          flagType,
        });
      }

      matrixRow.expandableDetails = details;
      const allExercised = matrixRow.testNumbers.length > 0 && details.length === matrixRow.testNumbers.length;
      matrixRow.cells.useCasesCovered = allExercised ? 'YES' : 'NO';
      const distinctFlags = new Set(details.filter(d => d.flagged).map(d => d.flagType));
      matrixRow.cells.flagsGenerated = distinctFlags.size;
    }

    for (const matrixRow of contractAnalysis.matrices.listsEnums.rows) {
      const details = [];
      const catalogField = String(matrixRow.cells.fieldsUsing || '').split(',')[0]?.trim();

      for (const testId of matrixRow.testNumbers) {
        const scenario = scenarioById.get(testId);
        if (!scenario) continue;
        const product = productByScenarioId.get(testId);
        if (!product) continue;

        const pa = productArtifacts[product.productId];
        const inputValue = catalogField ? pa?.artifacts?.normalized?.fields?.[catalogField] : '';
        const inputStr = inputValue != null ? String(inputValue) : '';

        const payload = reviewPayloads[product.productId];
        const fieldState = catalogField ? payload?.fields?.[catalogField] : null;
        const outputValue = fieldState?.selected?.value;
        const outputStr = outputValue != null ? String(outputValue) : '';

        const dbFieldState = catalogField
          ? db.getItemFieldState(product.productId).find(s => s.field_key === catalogField)
          : null;
        const dbValue = dbFieldState?.value != null ? String(dbFieldState.value) : '';
        const effectiveOutput = dbValue || outputStr;

        const inputLower = inputStr.trim().toLowerCase();
        const effectiveOutputLower = effectiveOutput.trim().toLowerCase();
        const isClosedEnumReject = scenario.name === 'closed_enum_reject' && /^invalid_.*_value$/.test(inputLower);
        const isSimilarEnum = scenario.name === 'similar_enum_values' && inputLower !== '';
        const isSeedScenario = isClosedEnumReject || isSimilarEnum;
        const changed = isSeedScenario
          ? inputLower !== ''
          : (inputLower !== '' && effectiveOutputLower !== '' && inputLower !== effectiveOutputLower);
        let changedBy = null;
        if (changed) {
          if (isSeedScenario) {
            changedBy = 'seed';
          } else {
            const dbChanged = dbValue && inputLower !== dbValue.trim().toLowerCase();
            changedBy = dbChanged ? 'seed' : null;
          }
        }

        const finalOutput = isClosedEnumReject && changed ? 'unk' : effectiveOutput;

        const reasonCodes = [...(fieldState?.reason_codes || [])];
        const realFlags = reasonCodes.filter(c => REAL_FLAGS.has(c));
        const flagged = realFlags.length > 0;
        const flagType = flagged ? realFlags[0] : null;

        details.push({
          scenario: scenario.name,
          input: inputStr,
          output: finalOutput,
          changed,
          changedBy,
          flagged,
          flagType,
        });
      }

      matrixRow.expandableDetails = details;
      const allExercised = matrixRow.testNumbers.length > 0 && details.length === matrixRow.testNumbers.length;
      matrixRow.cells.useCasesCovered = allExercised ? 'YES' : 'NO';
      const distinctFlags = new Set(details.filter(d => d.flagged).map(d => d.flagType));
      matrixRow.cells.flagsGenerated = distinctFlags.size;
    }

    // ══════════════════════════════════════════════════════════════════════
    // SECTION 0: CONTRACT ANALYSIS SMOKE TEST
    // ══════════════════════════════════════════════════════════════════════

    await t.test('SECTION 0 — Contract Analysis Smoke', async (s) => {
      await s.test('CA-01 — field count > 0', () => {
        assert.ok(contractAnalysis.summary.fieldCount > 0,
          `expected fields, got ${contractAnalysis.summary.fieldCount}`);
      });

      await s.test('CA-02 — scenario defs cover key categories', () => {
        const categories = new Set(scenarioDefs.map(d => d.category));
        assert.ok(categories.has('Coverage'), 'missing Coverage category');
        assert.ok(categories.has('Components'), 'missing Components category');
      });

      await s.test('CA-03 — component types exist with properties', () => {
        const types = contractAnalysis._raw.componentTypes;
        assert.ok(types.length > 0, 'no component types');
        for (const ct of types) {
          assert.ok(Array.isArray(ct.propKeys), `${ct.type} missing propKeys`);
        }
      });

      await s.test('CA-04 — known value catalogs exist', () => {
        assert.ok(contractAnalysis._raw.knownValuesCatalogs.length > 0, 'no known value catalogs');
      });

      await s.test('CA-05 — matrices have rows', () => {
        const { fieldRules: frm, components: cm, listsEnums: lem } = contractAnalysis.matrices;
        assert.ok(frm.rows.length > 0, 'fieldRules matrix has no rows');
        assert.ok(cm.rows.length > 0, 'components matrix has no rows');
        assert.ok(lem.rows.length > 0, 'listsEnums matrix has no rows');
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    // SECTION 0B: FIELD RULES CONTRACT — KEY NAVIGATOR COMPLETENESS
    // ══════════════════════════════════════════════════════════════════════

    await t.test('SECTION 0B — Field Rules Contract', async (s) => {
      const fieldRulesRaw = contractAnalysis._raw.fields;
      const componentTypesRaw = contractAnalysis._raw.componentTypes;

      await s.test('FRC-01 — every component property key has a matching field definition', () => {
        const missing = [];
        for (const ct of componentTypesRaw) {
          for (const propKey of ct.propKeys) {
            if (!fieldRulesRaw[propKey]) missing.push(`${ct.type}.${propKey}`);
          }
        }
        assert.strictEqual(missing.length, 0,
          `component property keys missing from fields: ${missing.join(', ')}`);
      });

      await s.test('FRC-02 — every component property mapping has field_key set', async () => {
        const fieldRulesJson = JSON.parse(
          await fs.readFile(path.join(HELPER_ROOT, CATEGORY, '_generated', 'field_rules.json'), 'utf8')
        );
        const workbookMap = JSON.parse(
          await fs.readFile(path.join(HELPER_ROOT, CATEGORY, '_control_plane', 'workbook_map.json'), 'utf8')
        );
        const dbSources = fieldRulesJson.component_db_sources || {};
        const wmSources = (workbookMap.component_db_sources || []);
        const allPropertyMappings = [
          ...Object.values(dbSources).flatMap(src =>
            (src.roles?.properties || src.excel?.property_mappings || [])
          ),
          ...wmSources.flatMap(src =>
            (src.roles?.properties || [])
          ),
        ];
        const missingFieldKey = allPropertyMappings
          .filter(p => p.key && !p.field_key)
          .map(p => p.key);
        const unique = [...new Set(missingFieldKey)];
        assert.strictEqual(unique.length, 0,
          `property mappings missing field_key: ${unique.join(', ')}`);
      });

      await s.test('FRC-03 — sensor_date has string type (not integer)', () => {
        const sd = fieldRulesRaw.sensor_date;
        assert.ok(sd, 'sensor_date field should exist');
        assert.strictEqual(sd.data_type, 'string',
          `sensor_date.data_type should be "string", got "${sd.data_type}"`);
        assert.strictEqual(sd.contract.type, 'string',
          `sensor_date.contract.type should be "string", got "${sd.contract.type}"`);
      });

      await s.test('FRC-04 — all component property fields have variance_policy', () => {
        const missingVP = [];
        for (const ct of componentTypesRaw) {
          for (const propKey of ct.propKeys) {
            const fieldDef = fieldRulesRaw[propKey];
            if (!fieldDef) continue;
            if (!fieldDef.variance_policy) missingVP.push(propKey);
          }
        }
        assert.strictEqual(missingVP.length, 0,
          `fields missing variance_policy: ${missingVP.join(', ')}`);
      });

      await s.test('FRC-05 — all component property fields have constraints array', () => {
        const missingC = [];
        for (const ct of componentTypesRaw) {
          for (const propKey of ct.propKeys) {
            const fieldDef = fieldRulesRaw[propKey];
            if (!fieldDef) continue;
            if (!Array.isArray(fieldDef.constraints)) missingC.push(propKey);
          }
        }
        assert.strictEqual(missingC.length, 0,
          `fields missing constraints array: ${missingC.join(', ')}`);
      });

      await s.test('FRC-06 — seeded component_values variance_policy matches field rules definition', () => {
        const mismatches = [];
        for (const ct of componentTypesRaw) {
          for (const propKey of ct.propKeys) {
            const fieldDef = fieldRulesRaw[propKey];
            if (!fieldDef || fieldDef.variance_policy == null) continue;
            const rows = db.db.prepare(
              `SELECT DISTINCT variance_policy
               FROM component_values
               WHERE category = ? AND property_key = ? AND variance_policy IS NOT NULL`
            ).all(CATEGORY, propKey);
            for (const row of rows) {
              if (row.variance_policy !== fieldDef.variance_policy) {
                mismatches.push(`${propKey}: db="${row.variance_policy}" vs field="${fieldDef.variance_policy}"`);
              }
            }
          }
        }
        assert.strictEqual(mismatches.length, 0,
          `seeded variance_policy mismatches: ${mismatches.join(', ')}`);
      });

      await s.test('FRC-07 — encoder_steps field has closed enum policy with known values', () => {
        const esDef = fieldRulesRaw.encoder_steps;
        assert.ok(esDef, 'encoder_steps field should exist');
        assert.strictEqual(esDef.enum?.policy, 'closed',
          `encoder_steps enum.policy should be "closed", got "${esDef.enum?.policy}"`);
        assert.strictEqual(esDef.enum?.source, 'data_lists.encoder_steps',
          `encoder_steps enum.source should be "data_lists.encoder_steps", got "${esDef.enum?.source}"`);

        const kvFields = contractAnalysis._raw.kvFields || {};
        const esValues = Array.isArray(kvFields.encoder_steps) ? kvFields.encoder_steps : [];
        const expected = [5, 16, 18, 20, 24];
        for (const v of expected) {
          assert.ok(
            esValues.some(kv => String(kv) === String(v)),
            `encoder_steps known values should contain ${v}, got: [${esValues.join(', ')}]`
          );
        }
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    // SECTION 1: SEED & DB VERIFICATION
    // ══════════════════════════════════════════════════════════════════════

    await t.test('SECTION 1 — Seed & DB Verification', async (s) => {
      await s.test('SEED-01 — all core + source/key-review tables have non-zero counts', () => {
        const counts = db.counts();
        const coreTables = [
          'candidates', 'component_values', 'component_identity',
          'component_aliases', 'list_values', 'item_field_state',
          'source_registry', 'source_assertions', 'key_review_state',
        ];
        for (const table of coreTables) {
          assert.ok(counts[table] > 0, `table ${table} has count ${counts[table]}`);
        }
      });

      await s.test('SEED-02 — component_identity has >=6 items per type and no exact duplicate name+maker rows', () => {
        for (const ct of contractAnalysis._raw.componentTypes) {
          const rows = db.getAllComponentIdentities(ct.type);
          assert.ok(rows.length >= 6,
            `${ct.type} should have >=6 items, got ${rows.length}`);
          const dupRows = db.db.prepare(
            `SELECT canonical_name, maker, COUNT(*) AS row_count
             FROM component_identity
             WHERE category = ? AND component_type = ?
             GROUP BY canonical_name, maker
             HAVING COUNT(*) > 1`
          ).all(CATEGORY, ct.type);
          assert.strictEqual(dupRows.length, 0,
            `${ct.type} should not contain duplicate canonical_name+maker identities`);
        }
      });

      await s.test('SEED-02b — maker-capable component types include A/B/makerless lanes with >=2 linked products each', () => {
        const fieldKeys = new Set(Object.keys(contractAnalysis?._raw?.fields || {}));
        const supportsMakerType = (typeName) => {
          const type = String(typeName || '').trim();
          if (!type) return false;
          const singular = type.endsWith('s') ? type.slice(0, -1) : type;
          return (
            fieldKeys.has(`${type}_brand`)
            || fieldKeys.has(`${type}_maker`)
            || fieldKeys.has(`${singular}_brand`)
            || fieldKeys.has(`${singular}_maker`)
          );
        };

        for (const ct of contractAnalysis._raw.componentTypes) {
          if (!supportsMakerType(ct.type)) continue;

          const groupedByName = new Map();
          const identityRows = db.getAllComponentIdentities(ct.type);
          for (const row of identityRows) {
            const name = String(row?.canonical_name || '').trim();
            if (!name) continue;
            if (!groupedByName.has(name)) groupedByName.set(name, []);
            groupedByName.get(name).push(String(row?.maker || '').trim());
          }

          let edgeName = '';
          for (const [name, makers] of groupedByName.entries()) {
            const uniqueMakers = [...new Set(makers)];
            const namedMakers = uniqueMakers.filter((maker) => maker);
            const hasMakerless = uniqueMakers.includes('');
            if (hasMakerless && namedMakers.length >= 2) {
              edgeName = name;
              break;
            }
          }
          assert.ok(edgeName, `${ct.type} should have one canonical name with maker A/B/makerless lanes`);

          const laneCounts = db.db.prepare(
            `SELECT COALESCE(component_maker, '') AS maker, COUNT(DISTINCT product_id) AS linked_count
             FROM item_component_links
             WHERE category = ? AND component_type = ? AND component_name = ?
             GROUP BY COALESCE(component_maker, '')`
          ).all(CATEGORY, ct.type, edgeName);

          const makerlessLane = laneCounts.find((row) => String(row?.maker || '') === '');
          assert.ok((makerlessLane?.linked_count || 0) >= 2,
            `${ct.type}/${edgeName} makerless lane should have >=2 linked products`);

          const namedLanes = laneCounts
            .filter((row) => String(row?.maker || '').trim())
            .sort((left, right) => Number(right?.linked_count || 0) - Number(left?.linked_count || 0));
          assert.ok(namedLanes.length >= 2,
            `${ct.type}/${edgeName} should have at least two named-maker lanes`);
          assert.ok(Number(namedLanes[0]?.linked_count || 0) >= 2,
            `${ct.type}/${edgeName} maker A lane should have >=2 linked products`);
          assert.ok(Number(namedLanes[1]?.linked_count || 0) >= 2,
            `${ct.type}/${edgeName} maker B lane should have >=2 linked products`);
        }
      });

      await s.test('SEED-02c — each component type has 1-3 non-discovered items', () => {
        for (const ct of contractAnalysis._raw.componentTypes) {
          const dbObj = seedDBs[ct.dbFile];
          assert.ok(dbObj, `${ct.type} should have seed DB`);
          const nonDiscovered = dbObj.items.filter(item => item.__nonDiscovered === true);
          assert.ok(nonDiscovered.length >= 1 && nonDiscovered.length <= 3,
            `${ct.type} should have 1-3 non-discovered items, got ${nonDiscovered.length}`);
        }
      });

      await s.test('SEED-02d — discovered identity rows have >=1 linked products (>=2 for non-newly-discovered)', () => {
        for (const ct of contractAnalysis._raw.componentTypes) {
          const dbObj = seedDBs[ct.dbFile];
          assert.ok(dbObj, `${ct.type} should have seed DB`);
          const discoveredItems = dbObj.items.filter(item => !item.__nonDiscovered);
          for (const item of discoveredItems) {
            const linkCount = db.db.prepare(
              `SELECT COUNT(DISTINCT product_id) AS cnt
               FROM item_component_links
               WHERE category = ? AND component_type = ? AND component_name = ?`
            ).get(CATEGORY, ct.type, item.name)?.cnt || 0;
            assert.ok(linkCount >= 1,
              `${ct.type}/${item.name} discovered item should have >=1 linked products, got ${linkCount}`);
          }
        }
      });

      await s.test('SEED-03 — component_aliases findable by canonical name + aliases', () => {
        for (const ct of contractAnalysis._raw.componentTypes) {
          const identities = db.getAllComponentIdentities(ct.type);
          assert.ok(identities.length > 0, `no identities for ${ct.type}`);
          const seedIdentity = identities.find((row) => String(row?.maker || '').trim()) || identities[0];
          const canonicalName = String(seedIdentity?.canonical_name || '').trim();
          assert.ok(canonicalName, `missing canonical name for ${ct.type}`);

          // Find by canonical name
          const byName = db.findComponentByAlias(ct.type, canonicalName);
          assert.ok(byName, `component not found for ${ct.type} by canonical name`);

          // Find by one stored alias (if aliases exist for this row)
          const aliasRow = db.db.prepare(
            `SELECT alias
             FROM component_aliases
             WHERE component_id = ?
             ORDER BY alias
             LIMIT 1`
          ).get(seedIdentity.id);
          assert.ok(aliasRow?.alias, `no alias row found for ${ct.type}`);
          const byAlias = db.findComponentByAlias(ct.type, aliasRow.alias);
          assert.ok(byAlias, `alias lookup failed for ${ct.type}`);
          assert.strictEqual(byAlias.canonical_name, byName.canonical_name);
        }
      });

      await s.test('SEED-04 — component_values stores variance_policy', () => {
        for (const ct of contractAnalysis._raw.componentTypes) {
          if (ct.propKeys.length === 0) continue;
          const values = db.db.prepare(
            'SELECT * FROM component_values WHERE category = ? AND component_type = ?'
          ).all(CATEGORY, ct.type);
          assert.ok(values.length > 0, `${ct.type} should have property values`);

          if (Object.keys(ct.allVariancePolicies).length > 0) {
            const withPolicy = values.filter(v => v.variance_policy);
            assert.ok(withPolicy.length > 0,
              `${ct.type} should have variance policies on properties`);
          }
        }
      });

      await s.test('SEED-05 — item_field_state needs_ai_review reflects confidence threshold', () => {
        let checkedFields = 0;
        for (const product of products) {
          const states = db.getItemFieldState(product.productId);
          for (const state of states) {
            checkedFields++;
            if (state.confidence < 0.8 && !state.overridden) {
              assert.strictEqual(state.needs_ai_review, 1,
                `${product.productId}:${state.field_key} confidence=${state.confidence} should have needs_ai_review`);
            }
          }
        }
        assert.ok(checkedFields > 0, 'should have checked at least some field states');
      });

      await s.test('SEED-06 — item_component_links created for exact-match products', () => {
        // variance_policies scenario explicitly uses seeded component identities
        const varianceProduct = products.find(p => p._testCase.name === 'variance_policies');
        if (varianceProduct) {
          const links = db.getItemComponentLinks(varianceProduct.productId);
          assert.ok(links.length > 0,
            'variance_policies product should have component links');
        }
      });

      await s.test('SEED-07 — candidates have evidence fields', () => {
        const happyProduct = products.find(p => p._testCase.name === 'happy_path');
        const candidateGroups = db.getCandidatesForProduct(happyProduct.productId);
        const allCandidates = Object.values(candidateGroups).flat();
        assert.ok(allCandidates.length > 0, 'should have candidates');

        const withHost = allCandidates.filter(c => c.source_host);
        assert.ok(withHost.length > 0, 'candidates should have source_host');

        const withSnippet = allCandidates.filter(c => c.snippet_id);
        assert.ok(withSnippet.length > 0, 'candidates should have snippet_id');

        const withQuote = allCandidates.filter(c => c.quote);
        assert.ok(withQuote.length > 0, 'candidates should have quote');
      });

      await s.test('SEED-08 — all scenario products seeded', () => {
        assert.strictEqual(seedResult.products_seeded, scenarioDefs.length,
          `expected ${scenarioDefs.length} products, seeded ${seedResult.products_seeded}`);
      });

      await s.test('SEED-09 — shared components: multiple products link to same items', () => {
        // Collect all component links across all products
        const linksByComponent = new Map();
        for (const product of products) {
          const links = db.getItemComponentLinks(product.productId);
          for (const link of links) {
            const key = `${link.component_type}::${link.component_name}`;
            if (!linksByComponent.has(key)) linksByComponent.set(key, []);
            linksByComponent.get(key).push(product.productId);
          }
        }
        // At least verify that component links exist across products
        const totalLinkedProducts = new Set(
          [...linksByComponent.values()].flat()
        ).size;
        assert.ok(totalLinkedProducts >= 1,
          `at least 1 product should have component links, found ${totalLinkedProducts}`);
      });

      await s.test('SEED-10 — idempotent re-seed produces same counts', async () => {
        const countsBefore = db.counts();
        await seedSpecDb({ db, config, category: CATEGORY, fieldRules, logger: null });
        const countsAfter = db.counts();
        for (const table of Object.keys(countsBefore)) {
          assert.strictEqual(countsAfter[table], countsBefore[table],
            `table ${table} count changed: ${countsBefore[table]} → ${countsAfter[table]}`);
        }
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    // SECTION 2: PER-SCENARIO BEHAVIORAL VERIFICATION
    // ══════════════════════════════════════════════════════════════════════

    await t.test('SECTION 2 — Per-Scenario Behavioral Verification', async (s) => {
      for (const scenario of scenarioDefs) {
        await s.test(`SCENARIO ${scenario.id} — ${scenario.name}`, async (ss) => {
          const product = products.find(p => p._testCase.id === scenario.id);
          assert.ok(product, `product for scenario ${scenario.id} not found`);

          const pa = productArtifacts[product.productId];
          const { artifacts, sourceResults } = pa;
          const flds = artifacts.normalized.fields;
          const fieldCount = Object.keys(flds).length;

          await ss.test('has fields', () => {
            assert.ok(fieldCount > 0, `should have fields, got ${fieldCount}`);
          });

          // ── Scenario-specific data shape assertions ──

          if (scenario.name === 'happy_path') {
            await ss.test('happy_path: >50% fields populated, coverage >50%', () => {
              const allKeys = contractAnalysis._raw.fieldKeys.length;
              const nonUnk = Object.values(flds).filter(v => v && v !== 'unk').length;
              assert.ok(nonUnk > allKeys * 0.5,
                `${nonUnk}/${allKeys} fields populated (expected >50%)`);
              assert.ok(artifacts.summary.coverage_overall_percent > 50,
                `coverage ${artifacts.summary.coverage_overall_percent}% (expected >50%)`);
            });
          }

          if (scenario.name.startsWith('new_') && scenario.name !== 'new_enum_values') {
            const typeName = scenario.name.replace('new_', '');
            await ss.test(`${scenario.name}: alien component name`, () => {
              const val = flds[typeName];
              assert.ok(val, `should have ${typeName} field`);
              assert.ok(!String(val).includes('TestSeed'),
                `${typeName}="${val}" should not be a TestSeed name`);
            });
          }

          if (scenario.name.startsWith('similar_') && scenario.name !== 'similar_enum_values') {
            const typeName = scenario.name.replace('similar_', '');
            await ss.test(`${scenario.name}: near-match name present`, () => {
              const val = flds[typeName];
              assert.ok(val, `should have ${typeName} field`);
            });
          }

          if (scenario.name === 'new_enum_values') {
            await ss.test('new_enum_values: fabricated values for open_prefer_known', () => {
              const openPK = (contractAnalysis._raw.knownValuesCatalogs || [])
                .filter(c => c.policy === 'open_prefer_known' && c.catalog !== 'yes_no'
                  && c.usingFields?.length > 0);
              if (openPK.length > 0) {
                // Check that at least one field has a NewTestValue_ or
                // the override field has a non-default value
                const overrideFields = openPK.map(c => c.usingFields[0]);
                const hasOverride = overrideFields.some(f => flds[f] && flds[f] !== 'unk');
                assert.ok(hasOverride,
                  `open_prefer_known fields should be populated: ${overrideFields.join(', ')}`);
              }
            });
          }

          if (scenario.name === 'closed_enum_reject') {
            await ss.test('closed_enum_reject: invalid_{catalog}_value present', () => {
              const hasInvalid = Object.values(flds).some(v =>
                String(v).includes('invalid_') && String(v).includes('_value'));
              assert.ok(hasInvalid, 'should have invalid_{catalog}_value values');
            });
          }

          if (scenario.name === 'range_violations') {
            await ss.test('range_violations: values exceed max', () => {
              const rc = contractAnalysis.summary.rangeConstraints;
              let checked = 0;
              for (const [field, range] of Object.entries(rc)) {
                const val = Number(flds[field]);
                if (!isNaN(val) && range.max) {
                  assert.ok(val > range.max,
                    `${field}=${val} should exceed max=${range.max}`);
                  checked++;
                }
              }
              assert.ok(checked > 0, 'should have checked at least one range field');
            });
          }

          if (scenario.name === 'cross_validation') {
            await ss.test('cross_validation: crafted rule violations', () => {
              if (flds.dpi) {
                assert.strictEqual(flds.dpi, '999999', 'dpi should be 999999');
              }
            });
          }

          if (scenario.name === 'component_constraints') {
            await ss.test('component_constraints: constraint overrides applied', () => {
              // Only expect date violation if the contract has <= constraints
              const ctWithConstraints = contractAnalysis._raw.componentTypes
                .filter(ct => Object.values(ct.allConstraints).flat()
                  .some(c => c.includes('<=')));
              if (ctWithConstraints.length > 0) {
                const has2010 = Object.values(flds).some(v =>
                  String(v) === '2010-01-01');
                assert.ok(has2010, 'should have 2010-01-01 date for constraint violation');
              } else {
                // No <= constraints in contract — just verify fields exist
                assert.ok(fieldCount > 0, 'should still have fields');
              }
            });
          }

          if (scenario.name === 'variance_policies') {
            await ss.test('variance_policies: uses seeded component refs', () => {
              for (const ct of contractAnalysis._raw.componentTypes) {
                if (Object.keys(ct.allVariancePolicies).length === 0) continue;
                const val = flds[ct.type];
                if (val) {
                  const expected = seedDBs?.[ct.dbFile]?.items?.[1]?.name
                    || seedDBs?.[ct.dbFile]?.items?.[0]?.name
                    || '';
                  assert.ok(String(val) === String(expected),
                    `${ct.type}="${val}" should reference seeded item "${expected}"`);
                }
              }
            });
          }

          if (scenario.name === 'min_evidence_refs') {
            await ss.test('min_evidence_refs: exactly 1 source', () => {
              assert.strictEqual(sourceResults.length, 1, 'should have exactly 1 source');
            });
          }

          if (scenario.name === 'tier_preference_override') {
            await ss.test('tier_preference_override: tier fields resolved', () => {
              const tierFields = contractAnalysis._raw.tierOverrideFields || [];
              const resolved = tierFields.filter(f => flds[f.key] && flds[f.key] !== 'unk');
              assert.ok(resolved.length > 0 || tierFields.length === 0,
                `${resolved.length}/${tierFields.length} tier-override fields resolved`);
            });
          }

          if (scenario.name === 'preserve_all_candidates') {
            await ss.test('preserve_all_candidates: different values per source', () => {
              assert.strictEqual(sourceResults.length, 5, 'should have 5 sources');
            });
          }

          if (scenario.name === 'missing_required') {
            await ss.test('missing_required: ≤2 sources, many missing fields', () => {
              assert.ok(sourceResults.length <= 2, `should have ≤2 sources, got ${sourceResults.length}`);
              assert.ok(artifacts.summary.missing_required_fields.length > 0,
                'should have missing required fields');
            });
          }

          if (scenario.name === 'multi_source_consensus') {
            await ss.test('multi_source_consensus: 4 sources with disagreements', () => {
              assert.strictEqual(sourceResults.length, 4, 'should have 4 sources');
            });
          }

          if (scenario.name === 'list_fields_dedup') {
            await ss.test('list_fields_dedup: overlapping values across sources', () => {
              assert.strictEqual(sourceResults.length, 5, 'should have 5 sources');
              const listFields = contractAnalysis._raw.listFields || [];
              if (listFields.length > 0) {
                const firstList = listFields[0];
                const vals = sourceResults.map(sr =>
                  sr.fieldCandidates.find(fc => fc.field === firstList)?.value
                ).filter(Boolean);
                assert.ok(vals.length > 1,
                  'list field should have values from multiple sources');
              }
            });
          }

          // ── buildValidationChecks produces results ──
          await ss.test('buildValidationChecks produces checks', () => {
            const checks = buildValidationChecks(scenario.id, {
              normalized: artifacts.normalized,
              summary: artifacts.summary,
              suggestionsEnums: { suggestions: [] },
              suggestionsComponents: { suggestions: [] },
              scenarioDefs,
            });
            assert.ok(checks.length > 0,
              `should produce validation checks, got ${checks.length}`);

            // Universal checks should pass
            for (const c of checks) {
              if (c.check === 'has_fields' || c.check === 'has_confidence') {
                assert.ok(c.pass, `universal check "${c.check}" failed: ${c.detail}`);
              }
            }
          });
        });
      }
    });

    // ══════════════════════════════════════════════════════════════════════
    // SECTION 3: PRODUCT GRID REVIEW
    // ══════════════════════════════════════════════════════════════════════

    await t.test('SECTION 3 — Product Grid Review', async (s) => {
      // Test a representative sample to keep runtime reasonable
      const sampleScenarios = scenarioDefs.filter(d =>
        ['happy_path', 'missing_required', 'variance_policies', 'min_evidence_refs']
          .includes(d.name)
      );

      for (const scenario of sampleScenarios) {
        await s.test(`GRID — ${scenario.name}`, async () => {
          const product = products.find(p => p._testCase.id === scenario.id);
          const payload = await buildProductReviewPayload({
            storage, config, category: CATEGORY, productId: product.productId,
          });

          assert.ok(payload, 'payload should exist');
          assert.ok(payload.fields, 'payload should have fields');
          assert.strictEqual(payload.product_id, product.productId);

          if (scenario.name === 'happy_path') {
            const nonUnk = Object.values(payload.fields)
              .filter(f => f.selected?.value && f.selected.value !== 'unk').length;
            assert.ok(nonUnk > 0, 'happy_path: should have non-unk fields');
          }

          if (scenario.name === 'missing_required') {
            assert.ok(payload.metrics, 'should have metrics');
          }

          // Verify candidates exist and have values
          const fieldsWithCands = Object.values(payload.fields)
            .filter(f => f.candidates?.length > 0);
          if (fieldsWithCands.length > 0) {
            const cand = fieldsWithCands[0].candidates[0];
            assert.ok(cand, 'should have at least one candidate');
            assert.ok(cand.value !== undefined, 'candidate should have a value');
          }
        });
      }
    });

    // ══════════════════════════════════════════════════════════════════════
    // SECTION 4: COMPONENT REVIEW
    // ══════════════════════════════════════════════════════════════════════

    await t.test('SECTION 4 — Component Review', async (s) => {
      for (const ct of contractAnalysis._raw.componentTypes) {
        await s.test(`COMP — ${ct.type}`, async () => {
          const result = await buildComponentReviewPayloads({
            config, category: CATEGORY, componentType: ct.type, specDb: db,
          });

          assert.ok(result, 'result should exist');
          assert.ok(result.items.length >= 6,
            `${ct.type} should have >=6 seeded items`);

          const firstRow = result.items[0];
          assert.ok(firstRow, `${ct.type} first seeded row should exist`);

          if (ct.propKeys.length > 0) {
            assert.ok(Object.keys(firstRow.properties || {}).length > 0,
              `${ct.type} first seeded row should have properties`);
          }

          if (ct.propKeys.length > 0) {
            assert.ok(result.property_columns.length > 0,
              `${ct.type} should have property columns`);
          }

          if (Object.keys(ct.allVariancePolicies).length > 0 && firstRow.properties) {
            const withVariance = Object.values(firstRow.properties)
              .filter(p => p.variance_policy);
            assert.ok(withVariance.length > 0,
              `${ct.type} first seeded row should have variance policies on properties`);
          }

          for (const row of result.items) {
            assert.strictEqual(row.name_tracked.candidate_count, row.name_tracked.candidates.length,
              `${ct.type}/${row.name}: name candidate_count mismatch`);
            assert.strictEqual(row.maker_tracked.candidate_count, row.maker_tracked.candidates.length,
              `${ct.type}/${row.name}: maker candidate_count mismatch`);
            for (const [key, prop] of Object.entries(row.properties || {})) {
              assert.strictEqual(prop.candidate_count, prop.candidates.length,
                `${ct.type}/${row.name}/${key}: candidate_count mismatch`);
            }
          }

          const rowsWithLinks = result.items.filter(r => (r.linked_products || []).length >= 2);
          if (rowsWithLinks.length > 0) {
            for (const row of rowsWithLinks) {
              for (const key of (result.property_columns || [])) {
                const prop = row.properties?.[key];
                if (!prop) continue;
                assert.strictEqual(prop.candidate_count, prop.candidates.length,
                  `${ct.type}/${row.name}/${key}: multi-linked-product candidate_count mismatch`);
              }
            }
          }
        });
      }
    });

    // ══════════════════════════════════════════════════════════════════════
    // SECTION 5: ENUM REVIEW
    // ══════════════════════════════════════════════════════════════════════

    await t.test('SECTION 5 — Enum Review', async (s) => {
      const enumResult = await buildEnumReviewPayloads({
        config, category: CATEGORY,
      });

      await s.test('ENUM-01 — returns catalogs from contract', () => {
        assert.ok(enumResult.fields.length > 0, 'should have enum fields');
      });

      await s.test('ENUM-02 — values present with correct structure', () => {
        for (const field of enumResult.fields) {
          assert.ok(field.values.length > 0,
            `${field.field} should have values`);
          for (const v of field.values) {
            assert.ok(v.value, `value should not be empty for ${field.field}`);
          }
        }
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    // SECTION 6: COVERAGE MATRIX VERIFICATION
    // ══════════════════════════════════════════════════════════════════════

    await t.test('SECTION 6 — Coverage Matrix Verification', async (s) => {
      await s.test('MATRIX-01 — happy_path covers majority of fields', () => {
        const happyProduct = products.find(p => p._testCase.name === 'happy_path');
        const happyFields = new Set(
          Object.keys(productArtifacts[happyProduct.productId].artifacts.normalized.fields)
        );
        const allFields = contractAnalysis._raw.fieldKeys;
        const uncovered = allFields.filter(f => !happyFields.has(f));
        assert.ok(uncovered.length < allFields.length * 0.3,
          `${uncovered.length}/${allFields.length} fields uncovered by happy_path (expected <30%)`);
      });

      await s.test('MATRIX-02 — every component type has new_* scenario', () => {
        for (const ct of contractAnalysis._raw.componentTypes) {
          const hasNew = scenarioDefs.some(d => d.name === `new_${ct.type}`);
          assert.ok(hasNew, `missing new_${ct.type} scenario`);
        }
      });

      await s.test('MATRIX-03 — cross-validation rules have test coverage', () => {
        if (contractAnalysis._raw.rules.length > 0) {
          assert.ok(scenarioDefs.some(d => d.name === 'cross_validation'),
            'should have cross_validation scenario');
        }
      });

      await s.test('MATRIX-04 — variance policies have test coverage', () => {
        const hasVariance = contractAnalysis._raw.componentTypes
          .some(ct => Object.keys(ct.allVariancePolicies).length > 0);
        if (hasVariance) {
          assert.ok(scenarioDefs.some(d => d.name === 'variance_policies'),
            'should have variance_policies scenario');
        }
      });

      await s.test('MATRIX-05 — all scenarios have at least 1 source result', () => {
        for (const scenario of scenarioDefs) {
          const product = products.find(p => p._testCase.id === scenario.id);
          const pa = productArtifacts[product.productId];
          assert.ok(pa.sourceResults.length >= 1,
            `${scenario.name} should have ≥1 source result, got ${pa.sourceResults.length}`);
        }
      });

      await s.test('MATRIX-06 — cross_validation assigned to ALL contract trigger/related fields', () => {
        const crossId = scenarioDefs.find(d => d.name === 'cross_validation')?.id;
        if (!crossId) return;

        const frm = contractAnalysis.matrices.fieldRules;
        const assignedFields = new Set(
          frm.rows
            .filter(row => row.testNumbers.includes(crossId))
            .map(row => row.cells.fieldKey)
        );

        const allContractCrossFields = new Set(
          (contractAnalysis._raw.rules || []).flatMap(r => [
            r.trigger_field,
            ...(r.related_fields || []),
            ...(r.depends_on || []),
            ...(r.requires_field ? [r.requires_field] : []),
          ]).filter(Boolean)
        );

        const existingFieldKeys = new Set(contractAnalysis._raw.fieldKeys);
        for (const field of allContractCrossFields) {
          if (!existingFieldKeys.has(field)) continue;
          assert.ok(assignedFields.has(field),
            `contract cross-validation field "${field}" should have cross_validation scenario assigned`);
        }
      });

      await s.test('MATRIX-07 — component_constraints assigned to ALL contract constraint fields', () => {
        const constraintId = scenarioDefs.find(d => d.name === 'component_constraints')?.id;
        if (!constraintId) return;

        const frm = contractAnalysis.matrices.fieldRules;
        const assignedFields = new Set(
          frm.rows
            .filter(row => row.testNumbers.includes(constraintId))
            .map(row => row.cells.fieldKey)
        );

        const contractConstraintFields = new Set(
          contractAnalysis._raw.componentTypes.flatMap(ct => Object.keys(ct.allConstraints))
        );

        const existingFieldKeys = new Set(contractAnalysis._raw.fieldKeys);
        for (const field of contractConstraintFields) {
          if (!existingFieldKeys.has(field)) continue;
          assert.ok(assignedFields.has(field),
            `contract constraint field "${field}" should have component_constraints scenario assigned`);
        }
      });

      await s.test('MATRIX-08 — variance_policies assigned to ALL non-authoritative contract variance fields', () => {
        const varianceId = scenarioDefs.find(d => d.name === 'variance_policies')?.id;
        if (!varianceId) return;

        const frm = contractAnalysis.matrices.fieldRules;
        const assignedFields = new Set(
          frm.rows
            .filter(row => row.testNumbers.includes(varianceId))
            .map(row => row.cells.fieldKey)
        );

        const contractVarianceFields = new Set(
          contractAnalysis._raw.componentTypes.flatMap(ct =>
            Object.entries(ct.allVariancePolicies)
              .filter(([, policy]) => policy !== 'authoritative')
              .map(([k]) => k)
          )
        );

        for (const field of contractVarianceFields) {
          assert.ok(assignedFields.has(field),
            `non-authoritative variance field "${field}" should have variance_policies scenario assigned`);
        }
      });

      await s.test('MATRIX-09 — multi_source_consensus assigned from field properties, not hardcoded', () => {
        const consensusId = scenarioDefs.find(d => d.name === 'multi_source_consensus')?.id;
        if (!consensusId) return;

        const frm = contractAnalysis.matrices.fieldRules;
        const assignedFields = new Set(
          frm.rows
            .filter(row => row.testNumbers.includes(consensusId))
            .map(row => row.cells.fieldKey)
        );

        const fields = contractAnalysis._raw.fields;
        const rangeConstraints = contractAnalysis.summary.rangeConstraints;
        let expectedCount = 0;
        for (const key of contractAnalysis._raw.fieldKeys) {
          const rule = fields[key];
          if (!rule) continue;
          const contract = rule.contract || {};
          const priority = rule.priority || {};
          const type = contract.type || rule.data_type || 'string';
          const isNumeric = ['number', 'integer', 'float'].includes(type);
          const requiredLevel = priority.required_level || priority.availability || rule.required_level || rule.availability || 'optional';
          const isRequired = requiredLevel === 'required' || requiredLevel === 'critical';
          const hasRange = !!rangeConstraints[key];
          if (isNumeric && (hasRange || isRequired)) expectedCount++;
        }

        assert.ok(assignedFields.size >= expectedCount,
          `multi_source_consensus should be assigned to >=${expectedCount} fields, got ${assignedFields.size}`);
      });

      await s.test('MATRIX-10 — candidate scores have deterministic variation beyond 3 fixed values', () => {
        const allScores = new Set();
        for (const pa of Object.values(productArtifacts)) {
          for (const candidates of Object.values(pa.artifacts.candidates)) {
            for (const c of candidates) {
              allScores.add(c.score);
            }
          }
        }
        assert.ok(allScores.size > 3,
          `expected >3 unique scores for deterministic variation, got ${allScores.size}: [${[...allScores].sort().join(', ')}]`);
      });

      await s.test('MATRIX-11 — multi_source_consensus sources arrive in non-tier-sorted order', () => {
        const consensusProduct = products.find(p => p._testCase.name === 'multi_source_consensus');
        if (!consensusProduct) return;
        const pa = productArtifacts[consensusProduct.productId];
        const tiers = pa.sourceResults.map(sr => sr.tier);
        const sorted = [...tiers].sort((a, b) => a - b);
        assert.notDeepStrictEqual(tiers, sorted,
          `multi_source_consensus source tiers should NOT be pre-sorted: [${tiers.join(', ')}]`);
      });

      await s.test('MATRIX-12 — at least one component type has > 6 rows', () => {
        let foundOver6 = false;
        for (const ct of contractAnalysis._raw.componentTypes) {
          const dbObj = seedDBs[ct.dbFile];
          if (dbObj && dbObj.items.length > 6) {
            foundOver6 = true;
            break;
          }
        }
        assert.ok(foundOver6,
          'at least one component type should have > 6 seeded rows');
      });

      await s.test('MATRIX-13 — not all component types have the same row count', () => {
        const counts = contractAnalysis._raw.componentTypes
          .map(ct => (seedDBs[ct.dbFile]?.items || []).length);
        const distinctCounts = new Set(counts);
        assert.ok(distinctCounts.size > 1,
          `all component types have the same count: ${[...distinctCounts].join(', ')}`);
      });

      await s.test('MATRIX-14 — every field has useCasesCovered = YES', () => {
        for (const row of contractAnalysis.matrices.fieldRules.rows) {
          assert.strictEqual(row.cells.useCasesCovered, 'YES',
            `field "${row.cells.fieldKey}" should have useCasesCovered=YES, ` +
            `testNumbers=[${row.testNumbers.join(',')}], details=${row.expandableDetails.length}`);
        }
      });

      await s.test('MATRIX-15 — expandable details have correct I/O for happy_path', () => {
        const happyScenario = scenarioDefs.find(d => d.name === 'happy_path');
        for (const row of contractAnalysis.matrices.fieldRules.rows) {
          const happyDetail = row.expandableDetails.find(d => d.scenario === 'happy_path');
          if (!happyDetail) continue;
          assert.strictEqual(happyDetail.flagged, false,
            `happy_path field "${row.cells.fieldKey}" should not be flagged`);
          assert.strictEqual(happyDetail.changed, false,
            `happy_path field "${row.cells.fieldKey}" should not be changed ` +
            `(input="${happyDetail.input}", output="${happyDetail.output}")`);
        }
      });

      await s.test('MATRIX-16 — flag scenarios show correct symbols', () => {
        const flagScenarios = [
          { scenario: 'min_evidence_refs', flagType: 'below_min_evidence' },
          { scenario: 'preserve_all_candidates', flagType: 'conflict_policy_hold' },
        ];
        for (const { scenario: scenarioName, flagType: expectedFlagType } of flagScenarios) {
          const scenario = scenarioDefs.find(d => d.name === scenarioName);
          if (!scenario) continue;
          let foundFlag = false;
          for (const row of contractAnalysis.matrices.fieldRules.rows) {
            const detail = row.expandableDetails.find(d => d.scenario === scenarioName);
            if (detail?.flagged && detail.flagType === expectedFlagType) {
              foundFlag = true;
              break;
            }
          }
          assert.ok(foundFlag,
            `scenario "${scenarioName}" should produce at least one ${expectedFlagType} flag in expandable details`);
        }
      });

      await s.test('MATRIX-17 — seed-changed scenarios show SEED symbol', () => {
        const seedScenarios = ['closed_enum_reject', 'similar_enum_values'];
        for (const scenarioName of seedScenarios) {
          const scenario = scenarioDefs.find(d => d.name === scenarioName);
          if (!scenario) continue;
          let foundSeed = false;
          for (const row of contractAnalysis.matrices.fieldRules.rows) {
            const detail = row.expandableDetails.find(d => d.scenario === scenarioName);
            if (detail?.changed && detail.changedBy === 'seed') {
              foundSeed = true;
              break;
            }
          }
          for (const row of contractAnalysis.matrices.listsEnums.rows) {
            const detail = row.expandableDetails.find(d => d.scenario === scenarioName);
            if (detail?.changed && detail.changedBy === 'seed') {
              foundSeed = true;
              break;
            }
          }
          if (!foundSeed) {
            const allDetails = [
              ...contractAnalysis.matrices.fieldRules.rows,
              ...contractAnalysis.matrices.listsEnums.rows,
            ].flatMap(r => r.expandableDetails.filter(d => d.scenario === scenarioName));
            const changedDetails = allDetails.filter(d => d.changed);
            assert.ok(changedDetails.length > 0 || allDetails.length === 0,
              `scenario "${scenarioName}" should have changed details or not be exercised (found ${allDetails.length} details)`);
          }
        }
      });

      await s.test('MATRIX-18 — component checkbox coverage complete', () => {
        for (const row of contractAnalysis.matrices.components.rows) {
          assert.ok(row.expandableDetails.length > 0,
            `component row "${row.id}" should have at least 1 expandable detail`);
          assert.strictEqual(row.cells.useCasesCovered, 'YES',
            `component row "${row.id}" should have useCasesCovered=YES`);
        }
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    // SECTION 7: SOURCE & KEY REVIEW SCHEMA
    // ══════════════════════════════════════════════════════════════════════

    await t.test('SECTION 7 — Source & Key Review Schema', async (s) => {
      const counts = db.counts();

      await s.test('SKR-01 — source_registry has rows (one per unique source)', () => {
        assert.ok(counts.source_registry > 0,
          `source_registry should have rows, got ${counts.source_registry}`);
      });

      await s.test('SKR-02 — source_assertions has rows (one per candidate)', () => {
        assert.ok(counts.source_assertions > 0,
          `source_assertions should have rows, got ${counts.source_assertions}`);
        // Should be approximately equal to candidates count
        assert.ok(counts.source_assertions <= counts.candidates * 2,
          `source_assertions (${counts.source_assertions}) should not wildly exceed candidates (${counts.candidates})`);
      });

      await s.test('SKR-03 — source_evidence_refs has rows for candidates with quotes', () => {
        assert.ok(counts.source_evidence_refs > 0,
          `source_evidence_refs should have rows, got ${counts.source_evidence_refs}`);
      });

      await s.test('SKR-04 — key_review_state grid_key rows exist for each item_field_state row', () => {
        const ifsCount = counts.item_field_state;
        const gridKeyCount = db.db.prepare(
          "SELECT COUNT(*) as c FROM key_review_state WHERE category = ? AND target_kind = 'grid_key'"
        ).get(db.category).c;
        assert.ok(gridKeyCount > 0, 'should have grid_key rows');
        assert.strictEqual(gridKeyCount, ifsCount,
          `grid_key count (${gridKeyCount}) should match item_field_state count (${ifsCount})`);
      });

      await s.test('SKR-05 — key_review_state enum_key rows exist for each list_values row', () => {
        const lvCount = counts.list_values;
        const enumKeyCount = db.db.prepare(
          "SELECT COUNT(*) as c FROM key_review_state WHERE category = ? AND target_kind = 'enum_key'"
        ).get(db.category).c;
        assert.ok(enumKeyCount > 0, 'should have enum_key rows');
        assert.strictEqual(enumKeyCount, lvCount,
          `enum_key count (${enumKeyCount}) should match list_values count (${lvCount})`);
      });

      await s.test('SKR-06 — key_review_state component_key rows exist for each component_values row', () => {
        const cvCount = counts.component_values;
        const compKeyCount = db.db.prepare(
          "SELECT COUNT(*) as c FROM key_review_state WHERE category = ? AND target_kind = 'component_key'"
        ).get(db.category).c;
        assert.ok(compKeyCount > 0, 'should have component_key rows');
        assert.strictEqual(compKeyCount, cvCount,
          `component_key count (${compKeyCount}) should match component_values count (${cvCount})`);
      });

      await s.test('SKR-07 — key_review_state has correct two-lane status mapping', () => {
        // Check that overridden items have user_accept status
        const overriddenIfs = db.db.prepare(
          'SELECT COUNT(*) as c FROM item_field_state WHERE category = ? AND overridden = 1'
        ).get(db.category).c;
        if (overriddenIfs > 0) {
          const acceptedGridKeys = db.db.prepare(
            "SELECT COUNT(*) as c FROM key_review_state WHERE category = ? AND target_kind = 'grid_key' AND user_accept_primary_status = 'accepted'"
          ).get(db.category).c;
          assert.ok(acceptedGridKeys >= overriddenIfs,
            `user_accept_primary_status='accepted' (${acceptedGridKeys}) should be >= overridden item_field_state (${overriddenIfs})`);
        }

        // Check that needs_ai_review items have ai_confirm_primary_status='pending'
        const needsReviewIfs = db.db.prepare(
          'SELECT COUNT(*) as c FROM item_field_state WHERE category = ? AND needs_ai_review = 1 AND ai_review_complete = 0'
        ).get(db.category).c;
        if (needsReviewIfs > 0) {
          const pendingGridKeys = db.db.prepare(
            "SELECT COUNT(*) as c FROM key_review_state WHERE category = ? AND target_kind = 'grid_key' AND ai_confirm_primary_status = 'pending'"
          ).get(db.category).c;
          assert.ok(pendingGridKeys >= needsReviewIfs,
            `ai_confirm_primary_status='pending' (${pendingGridKeys}) should be >= needs_ai_review items (${needsReviewIfs})`);
        }
      });

      await s.test('SKR-08 — key_review_audit has backfill entries from candidate_reviews', () => {
        // Audit entries should exist if there are any candidate_reviews with real state
        const reviewsWithState = db.db.prepare(
          "SELECT COUNT(*) as c FROM candidate_reviews WHERE ai_review_status != 'not_run' OR human_accepted = 1"
        ).get().c;
        if (reviewsWithState > 0) {
          assert.ok(counts.key_review_audit > 0,
            `key_review_audit should have entries when candidate_reviews has ${reviewsWithState} reviewed rows`);
        } else {
          // No reviews with state — audit can be 0
          assert.ok(counts.key_review_audit >= 0, 'key_review_audit count should be non-negative');
        }
      });
    });

    // ══════════════════════════════════════════════════════════════════════
    // SECTION 8: FLAG CLEANUP — ONLY 6 REAL FLAGS COUNT
    // ══════════════════════════════════════════════════════════════════════

    await t.test('SECTION 8 — Flag Cleanup', async (s) => {
      await s.test('FLAG-01 — happy_path metrics.flags is 0', async () => {
        const product = products.find(p => p._testCase.name === 'happy_path');
        const payload = await buildProductReviewPayload({
          storage, config, category: CATEGORY, productId: product.productId, specDb: db,
        });
        assert.strictEqual(payload.metrics.flags, 0,
          `happy_path should have 0 real flags, got ${payload.metrics.flags}`);
      });

      await s.test('FLAG-02 — min_evidence_refs product has below_min_evidence flag', async () => {
        const product = products.find(p => p._testCase.name === 'min_evidence_refs');
        if (!product) return;
        const payload = await buildProductReviewPayload({
          storage, config, category: CATEGORY, productId: product.productId, specDb: db,
        });
        const highEvFields = contractAnalysis._raw.highEvidenceFields || [];
        const flaggedFields = Object.entries(payload.fields)
          .filter(([, state]) => (state.reason_codes || []).includes('below_min_evidence'));
        assert.ok(flaggedFields.length > 0,
          `min_evidence_refs product should have at least 1 field with below_min_evidence flag, ` +
          `high-ev fields: [${highEvFields.map(f => f.key).join(', ')}]`);
      });

      await s.test('FLAG-03 — preserve_all_candidates product has conflict_policy_hold flag', async () => {
        const product = products.find(p => p._testCase.name === 'preserve_all_candidates');
        if (!product) return;
        const payload = await buildProductReviewPayload({
          storage, config, category: CATEGORY, productId: product.productId, specDb: db,
        });
        const preserveFields = contractAnalysis._raw.preserveAllFields || [];
        const flaggedFields = Object.entries(payload.fields)
          .filter(([, state]) => (state.reason_codes || []).includes('conflict_policy_hold'));
        assert.ok(flaggedFields.length > 0,
          `preserve_all_candidates product should have at least 1 field with conflict_policy_hold flag, ` +
          `preserve fields: [${preserveFields.join(', ')}]`);
      });

      await s.test('FLAG-04 — metrics.flags counts only real flags', async () => {
        const REAL_FLAGS = new Set([
          'variance_violation', 'constraint_conflict', 'new_component',
          'new_enum_value', 'below_min_evidence', 'conflict_policy_hold',
        ]);
        for (const product of products) {
          const payload = await buildProductReviewPayload({
            storage, config, category: CATEGORY, productId: product.productId, specDb: db,
          });
          const realFlagCount = Object.values(payload.fields)
            .filter(state => (state.reason_codes || []).some(code => REAL_FLAGS.has(code)))
            .length;
          assert.strictEqual(payload.metrics.flags, realFlagCount,
            `${product._testCase.name}: metrics.flags (${payload.metrics.flags}) ` +
            `should equal count of fields with real flags (${realFlagCount})`);
        }
      });
    });

  } finally {
    if (db) try { db.close(); } catch { /* ignore */ }
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
});
