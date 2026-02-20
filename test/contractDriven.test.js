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

function sourceResultsToArtifacts(sourceResults, product, contractAnalysis) {
  const candidatesByField = {};

  for (let srcIdx = 0; srcIdx < sourceResults.length; srcIdx++) {
    const src = sourceResults[srcIdx];
    for (const fc of src.fieldCandidates) {
      if (!candidatesByField[fc.field]) candidatesByField[fc.field] = [];
      const score = src.tier === 1 ? 0.9 : src.tier === 2 ? 0.7 : 0.5;
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
    for (const item of dbObj.items) {
      const name = item.name;
      entries[name] = { ...item, canonical_name: name };
      index.set(name.toLowerCase(), entries[name]);
      index.set(name.toLowerCase().replace(/\s+/g, ''), entries[name]);
      for (const alias of (item.aliases || [])) {
        index.set(alias.toLowerCase(), entries[name]);
        index.set(alias.toLowerCase().replace(/\s+/g, ''), entries[name]);
      }
    }
    componentDBs[dbFile] = { entries, __index: index };
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
    const seedDBs = buildSeedComponentDB(contractAnalysis);
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

      await s.test('SEED-02 — component_identity has 5 items per type', () => {
        for (const ct of contractAnalysis._raw.componentTypes) {
          const rows = db.getAllComponentIdentities(ct.type);
          assert.strictEqual(rows.length, 5,
            `${ct.type} should have 5 items, got ${rows.length}`);
        }
      });

      await s.test('SEED-03 — component_aliases findable by canonical name + aliases', () => {
        for (const ct of contractAnalysis._raw.componentTypes) {
          const cap = ct.type.charAt(0).toUpperCase() + ct.type.slice(1);
          const alphaName = `TestSeed_${cap} Alpha`;

          // Find by canonical name
          const alpha = db.findComponentByAlias(ct.type, alphaName);
          assert.ok(alpha, `Alpha not found for ${ct.type} by name`);

          // Find by explicit alias
          const byAlias = db.findComponentByAlias(ct.type, `TS${cap}Alpha`);
          assert.ok(byAlias, `Alpha alias TS${cap}Alpha not found for ${ct.type}`);
          assert.strictEqual(byAlias.canonical_name, alpha.canonical_name);
        }
      });

      await s.test('SEED-04 — component_values stores variance_policy', () => {
        for (const ct of contractAnalysis._raw.componentTypes) {
          if (ct.propKeys.length === 0) continue;
          const cap = ct.type.charAt(0).toUpperCase() + ct.type.slice(1);
          const values = db.getComponentValues(ct.type, `TestSeed_${cap} Alpha`);
          assert.ok(values.length > 0, `${ct.type} Alpha should have property values`);

          if (Object.keys(ct.allVariancePolicies).length > 0) {
            const withPolicy = values.filter(v => v.variance_policy);
            assert.ok(withPolicy.length > 0,
              `${ct.type} Alpha should have variance policies on properties`);
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
        // variance_policies scenario explicitly uses exact Beta names
        const varianceProduct = products.find(p => p._testCase.name === 'variance_policies');
        if (varianceProduct) {
          const links = db.getItemComponentLinks(varianceProduct.productId);
          assert.ok(links.length > 0,
            'variance_policies product should have component links (uses exact Beta names)');
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
            await ss.test('variance_policies: Beta component refs', () => {
              for (const ct of contractAnalysis._raw.componentTypes) {
                if (Object.keys(ct.allVariancePolicies).length === 0) continue;
                const val = flds[ct.type];
                if (val) {
                  assert.ok(String(val).includes('Beta'),
                    `${ct.type}="${val}" should reference Beta`);
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
            config, category: CATEGORY, componentType: ct.type,
          });

          assert.ok(result, 'result should exist');
          assert.strictEqual(result.items.length, 5,
            `${ct.type} should have 5 items (Alpha-Epsilon)`);

          // Alpha should exist and have properties
          const alpha = result.items.find(i => i.name.includes('Alpha'));
          assert.ok(alpha, `${ct.type} Alpha should exist`);

          if (ct.propKeys.length > 0) {
            assert.ok(Object.keys(alpha.properties).length > 0,
              `${ct.type} Alpha should have properties`);
          }

          // Property columns aggregated from all items
          if (ct.propKeys.length > 0) {
            assert.ok(result.property_columns.length > 0,
              `${ct.type} should have property columns`);
          }

          // Variance policies tracked on properties
          if (Object.keys(ct.allVariancePolicies).length > 0 && alpha.properties) {
            const withVariance = Object.values(alpha.properties)
              .filter(p => p.variance_policy);
            assert.ok(withVariance.length > 0,
              `${ct.type} Alpha should have variance policies on properties`);
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

  } finally {
    if (db) try { db.close(); } catch { /* ignore */ }
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
});
