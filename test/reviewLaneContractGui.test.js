import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { SpecDb } from '../src/db/specDb.js';
import { seedSpecDb } from '../src/db/seed.js';
import { buildComponentIdentifier } from '../src/utils/componentIdentifier.js';
import {
  PRODUCT_A,
  PRODUCT_B,
  FIELD_RULES_FIELDS,
  SENSOR_ITEMS,
  KNOWN_VALUE_ENUMS,
  makeStorage,
  writeJson,
  seedFieldRules,
  seedComponentDb,
  seedKnownValues,
  seedWorkbookMap,
  seedLatestArtifacts,
  buildFieldRulesForSeed,
  replaceCandidateRow,
  findFreePort,
  waitForServerReady,
  apiJson,
  getItemFieldStateId,
  getComponentIdentityId,
  getComponentValueId,
  getEnumSlotIds,
  parseComponentIdentifier,
  resolveStrictKeyReviewSlotIds,
  upsertStrictKeyReviewState,
  getStrictKeyReviewState,
  stopProcess,
} from './fixtures/reviewLaneFixtures.js';

const CATEGORY = 'mouse_contract_lane_matrix_gui';

const PRODUCTS = {
  [PRODUCT_A]: {
    identity: { brand: 'Razer', model: 'Viper V3 Pro' },
    fields: { weight: '49', dpi: '35000', sensor: 'PAW3950', connection: '2.4GHz' },
    provenance: {
      weight: { value: '49', confidence: 0.95 },
      dpi: { value: '35000', confidence: 0.97 },
      sensor: { value: 'PAW3950', confidence: 0.98 },
      connection: { value: '2.4GHz', confidence: 0.98 },
    },
    candidates: {
      weight: [
        { candidate_id: 'p1-weight-1', value: '49', score: 0.95, host: 'razer.com', source_host: 'razer.com', source_method: 'dom', method: 'dom', source_tier: 1, tier: 1 },
        { candidate_id: 'collision_primary_candidate', value: '49', score: 0.71, host: 'collision.example', source_host: 'collision.example', source_method: 'llm', method: 'llm', source_tier: 3, tier: 3 },
        { candidate_id: 'weight-unk-candidate', value: 'unk', score: 0.1, host: 'unknown.example', source_host: 'unknown.example', source_method: 'llm', method: 'llm', source_tier: 3, tier: 3 },
      ],
      dpi: [{ candidate_id: 'p1-dpi-1', value: '35000', score: 0.97, host: 'razer.com', source_host: 'razer.com', source_method: 'dom', method: 'dom', source_tier: 1, tier: 1 }],
      sensor: [
        { candidate_id: 'p1-sensor-1', value: 'PAW3950', score: 0.98, host: 'razer.com', source_host: 'razer.com', source_method: 'dom', method: 'dom', source_tier: 1, tier: 1 },
        { candidate_id: 'global_sensor_candidate', value: 'PAW3950', score: 0.92, host: 'aggregate.example', source_host: 'aggregate.example', source_method: 'llm', method: 'llm', source_tier: 2, tier: 2 },
      ],
      connection: [
        { candidate_id: 'p1-conn-1', value: '2.4GHz', score: 0.98, host: 'razer.com', source_host: 'razer.com', source_method: 'dom', method: 'dom', source_tier: 1, tier: 1 },
        { candidate_id: 'global_connection_candidate', value: '2.4GHz', score: 0.9, host: 'aggregate.example', source_host: 'aggregate.example', source_method: 'llm', method: 'llm', source_tier: 2, tier: 2 },
        { candidate_id: 'p1-conn-3', value: '2.4GHz', score: 0.9, host: 'manual.example', source_host: 'manual.example', source_method: 'llm', method: 'llm', source_tier: 2, tier: 2 },
        { candidate_id: 'p1-conn-2', value: 'Wireless', score: 0.65, host: 'forum.example', source_host: 'forum.example', source_method: 'llm', method: 'llm', source_tier: 3, tier: 3 },
      ],
      dpi_max: [
        { candidate_id: 'cmp_dpi_35000', value: '35000', score: 0.9, host: 'pixart.com', source_host: 'pixart.com', source_method: 'dom', method: 'dom', source_tier: 1, tier: 1 },
        { candidate_id: 'cmp_dpi_25000', value: '25000', score: 0.82, host: 'mirror.example', source_host: 'mirror.example', source_method: 'llm', method: 'llm', source_tier: 2, tier: 2 },
        { candidate_id: 'collision_shared_candidate', value: '35000', score: 0.79, host: 'collision.example', source_host: 'collision.example', source_method: 'llm', method: 'llm', source_tier: 3, tier: 3 },
        { candidate_id: 'cmp_dpi_unknown', value: 'unk', score: 0.1, host: 'unknown.example', source_host: 'unknown.example', source_method: 'llm', method: 'llm', source_tier: 3, tier: 3 },
      ],
    },
  },
  [PRODUCT_B]: {
    identity: { brand: 'Pulsar', model: 'X2 V3' },
    fields: { weight: '52', dpi: '26000', sensor: 'PAW3950', connection: '2.4GHz' },
    provenance: {
      weight: { value: '52', confidence: 0.93 },
      dpi: { value: '26000', confidence: 0.95 },
      sensor: { value: 'PAW3950', confidence: 0.96 },
      connection: { value: '2.4GHz', confidence: 0.96 },
    },
    candidates: {
      weight: [{ candidate_id: 'p2-weight-1', value: '52', score: 0.93, host: 'pulsar.gg', source_host: 'pulsar.gg', source_method: 'dom', method: 'dom', source_tier: 1, tier: 1 }],
      dpi: [{ candidate_id: 'p2-dpi-1', value: '26000', score: 0.95, host: 'pulsar.gg', source_host: 'pulsar.gg', source_method: 'dom', method: 'dom', source_tier: 1, tier: 1 }],
      sensor: [{ candidate_id: 'p2-sensor-1', value: 'PAW3950', score: 0.96, host: 'pulsar.gg', source_host: 'pulsar.gg', source_method: 'dom', method: 'dom', source_tier: 1, tier: 1 }],
      connection: [{ candidate_id: 'p2-conn-1', value: '2.4GHz', score: 0.96, host: 'pulsar.gg', source_host: 'pulsar.gg', source_method: 'dom', method: 'dom', source_tier: 1, tier: 1 }],
    },
  },
};

async function seedProductCatalog(helperRoot, category) {
  await writeJson(path.join(helperRoot, category, '_control_plane', 'product_catalog.json'), {
    _doc: 'Per-category product catalog. Managed by GUI.',
    _version: 1,
    products: {
      [PRODUCT_A]: {
        id: 1,
        identifier: 'a1',
        brand: 'Razer',
        model: 'Viper V3 Pro',
        variant: '',
        status: 'active',
        seed_urls: [],
        added_at: '2026-02-18T00:00:00.000Z',
        added_by: 'test',
      },
      [PRODUCT_B]: {
        id: 2,
        identifier: 'b2',
        brand: 'Pulsar',
        model: 'X2 V3',
        variant: '',
        status: 'active',
        seed_urls: [],
        added_at: '2026-02-18T00:00:01.000Z',
        added_by: 'test',
      },
    },
  });
}

async function seedComponentReviewSuggestions(helperRoot, category) {
  await writeJson(path.join(helperRoot, category, '_suggestions', 'component_review.json'), {
    items: [
      {
        review_id: 'rv-cmp-35000',
        category,
        component_type: 'sensor',
        field_key: 'sensor',
        raw_query: 'PAW3950',
        // Deliberately lower-cased to validate case-insensitive pending-item binding in the GUI.
        matched_component: 'paw3950',
        match_type: 'exact',
        status: 'pending_ai',
        product_id: PRODUCT_A,
        created_at: '2026-02-18T00:00:00.000Z',
        product_attributes: { dpi_max: '35000', ips: '750', sensor_brand: 'PixArt' },
      },
      {
        review_id: 'rv-cmp-26000',
        category,
        component_type: 'sensor',
        field_key: 'sensor',
        raw_query: 'PAW3950',
        matched_component: 'paw3950',
        match_type: 'exact',
        status: 'pending_ai',
        product_id: PRODUCT_B,
        created_at: '2026-02-18T00:00:01.000Z',
        product_attributes: { dpi_max: '26000', sensor_brand: 'PixArt' },
      },
      {
        review_id: 'rv-enum-24',
        category,
        component_type: 'sensor',
        field_key: 'connection',
        raw_query: '2.4GHz',
        matched_component: '',
        match_type: 'exact',
        status: 'pending_ai',
        product_id: PRODUCT_A,
        created_at: '2026-02-18T00:00:02.000Z',
        product_attributes: { connection: '2.4GHz' },
      },
      {
        review_id: 'rv-enum-wireless',
        category,
        component_type: 'sensor',
        field_key: 'connection',
        raw_query: 'Wireless',
        matched_component: '',
        match_type: 'exact',
        status: 'pending_ai',
        product_id: PRODUCT_B,
        created_at: '2026-02-18T00:00:03.000Z',
        product_attributes: { connection: 'Wireless' },
      },
    ],
  });
}

function seedStrictLaneCandidates(db, category) {
  replaceCandidateRow(db, {
    candidateId: 'collision_primary_candidate',
    category,
    productId: PRODUCT_A,
    fieldKey: 'weight',
    value: '49',
    score: 0.71,
  });
  replaceCandidateRow(db, {
    candidateId: 'weight-unk-candidate',
    category,
    productId: PRODUCT_A,
    fieldKey: 'weight',
    value: 'unk',
    score: 0.1,
  });
  replaceCandidateRow(db, {
    candidateId: 'global_sensor_candidate',
    category,
    productId: PRODUCT_A,
    fieldKey: 'sensor',
    value: 'PAW3950',
    score: 0.92,
  });
  replaceCandidateRow(db, {
    candidateId: 'global_connection_candidate',
    category,
    productId: PRODUCT_A,
    fieldKey: 'connection',
    value: '2.4GHz',
    score: 0.9,
    isListField: true,
  });
  replaceCandidateRow(db, {
    candidateId: 'cmp_dpi_35000',
    category,
    productId: PRODUCT_A,
    fieldKey: 'dpi_max',
    value: '35000',
    score: 0.9,
    isComponentField: true,
    componentType: 'sensor',
  });
  replaceCandidateRow(db, {
    candidateId: 'cmp_dpi_25000',
    category,
    productId: PRODUCT_A,
    fieldKey: 'dpi_max',
    value: '25000',
    score: 0.82,
    isComponentField: true,
    componentType: 'sensor',
  });
  replaceCandidateRow(db, {
    candidateId: 'collision_shared_candidate',
    category,
    productId: PRODUCT_A,
    fieldKey: 'dpi_max',
    value: '35000',
    score: 0.79,
    isComponentField: true,
    componentType: 'sensor',
  });
  replaceCandidateRow(db, {
    candidateId: 'cmp_ips_750',
    category,
    productId: PRODUCT_A,
    fieldKey: 'ips',
    value: '750',
    score: 0.9,
    isComponentField: true,
    componentType: 'sensor',
  });
  replaceCandidateRow(db, {
    candidateId: 'cmp_dpi_unknown',
    category,
    productId: PRODUCT_A,
    fieldKey: 'dpi_max',
    value: 'unk',
    score: 0.1,
    isComponentField: true,
    componentType: 'sensor',
  });
}

async function waitForCondition(predicate, timeoutMs = 15_000, intervalMs = 120, label = 'condition') {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await predicate();
    if (ok) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timeout_waiting_for_condition:${label}`);
}

async function clickAndWaitForDrawer(page, valueTitle) {
  const rowButton = page.locator('button').filter({ has: page.locator(`span[title="${valueTitle}"]`) }).first();
  if (await rowButton.count() > 0) {
    await rowButton.click();
  } else {
    await page.locator(`span[title="${valueTitle}"]`).first().click();
  }
  await page.waitForSelector('section:has-text("Current Value")', { timeout: 20_000 });
}

async function clickGridCell(page, productId, fieldKey) {
  await page.locator(`[data-product-id="${productId}"][data-field-key="${fieldKey}"]`).first().click();
  await page.waitForSelector('section:has-text("Current Value")', { timeout: 20_000 });
}

async function ensureButtonVisible(page, label) {
  await page.waitForSelector(`button:has-text("${label}")`, { timeout: 10_000 });
}

async function ensureGuiBuilt() {
  const distIndex = path.join(path.resolve('.'), 'tools', 'gui-react', 'dist', 'index.html');
  try {
    await fs.access(distIndex);
  } catch {
    throw new Error(`gui_dist_missing:${distIndex}`);
  }
}

test('GUI click contract: grid + component + enum accept/confirm stay decoupled and propagate', { timeout: 240_000 }, async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-lane-contract-gui-'));
  const storage = makeStorage(tempRoot);
  const config = {
    helperFilesRoot: path.join(tempRoot, 'helper_files'),
    localOutputRoot: path.join(tempRoot, 'out'),
    specDbDir: path.join(tempRoot, '.specfactory_tmp'),
  };
  const repoRoot = path.resolve('.');
  const guiDistRoot = path.join(repoRoot, 'tools', 'gui-react', 'dist');

  let child = null;
  let db = null;
  let browser = null;
  let context = null;
  let page = null;
  const logs = [];

  try {
    await ensureGuiBuilt();
    // The review page can briefly query default "mouse" routes before selecting CATEGORY.
    // Seed a minimal mouse contract to keep background auto-seed from erroring in test logs.
    await seedFieldRules(config.helperFilesRoot, 'mouse');
    await seedComponentDb(config.helperFilesRoot, 'mouse');
    await seedKnownValues(config.helperFilesRoot, 'mouse');
    await seedFieldRules(config.helperFilesRoot, CATEGORY);
    await seedComponentDb(config.helperFilesRoot, CATEGORY);
    await seedKnownValues(config.helperFilesRoot, CATEGORY);
    await seedWorkbookMap(config.helperFilesRoot, CATEGORY);
    await seedProductCatalog(config.helperFilesRoot, CATEGORY);
    for (const [productId, product] of Object.entries(PRODUCTS)) {
      await seedLatestArtifacts(storage, CATEGORY, productId, product);
    }
    await seedComponentReviewSuggestions(config.helperFilesRoot, CATEGORY);

    const dbPath = path.join(tempRoot, '.specfactory_tmp', CATEGORY, 'spec.sqlite');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    db = new SpecDb({ dbPath, category: CATEGORY });
    await seedSpecDb({
      db,
      config,
      category: CATEGORY,
      fieldRules: buildFieldRulesForSeed(),
      logger: null,
    });
    seedStrictLaneCandidates(db, CATEGORY);

    const componentIdentifier = buildComponentIdentifier('sensor', 'PAW3950', 'PixArt');
    upsertStrictKeyReviewState(db, CATEGORY, {
      category: CATEGORY,
      targetKind: 'grid_key',
      itemIdentifier: PRODUCT_A,
      fieldKey: 'weight',
      selectedValue: '49',
      selectedCandidateId: 'p1-weight-1',
      confidenceScore: 0.95,
      aiConfirmPrimaryStatus: 'pending',
      userAcceptPrimaryStatus: null,
    });
    upsertStrictKeyReviewState(db, CATEGORY, {
      category: CATEGORY,
      targetKind: 'grid_key',
      itemIdentifier: PRODUCT_A,
      fieldKey: 'dpi',
      selectedValue: '35000',
      selectedCandidateId: 'p1-dpi-1',
      confidenceScore: 0.97,
      aiConfirmPrimaryStatus: 'pending',
      userAcceptPrimaryStatus: null,
    });
    upsertStrictKeyReviewState(db, CATEGORY, {
      category: CATEGORY,
      targetKind: 'grid_key',
      itemIdentifier: PRODUCT_A,
      fieldKey: 'connection',
      selectedValue: '2.4GHz',
      selectedCandidateId: 'global_connection_candidate',
      confidenceScore: 0.98,
      aiConfirmSharedStatus: 'pending',
      userAcceptSharedStatus: null,
    });
    upsertStrictKeyReviewState(db, CATEGORY, {
      category: CATEGORY,
      targetKind: 'grid_key',
      itemIdentifier: PRODUCT_B,
      fieldKey: 'connection',
      selectedValue: '2.4GHz',
      selectedCandidateId: 'global_connection_candidate',
      confidenceScore: 0.96,
      aiConfirmSharedStatus: 'pending',
      userAcceptSharedStatus: null,
    });
    upsertStrictKeyReviewState(db, CATEGORY, {
      category: CATEGORY,
      targetKind: 'component_key',
      fieldKey: 'dpi_max',
      componentIdentifier,
      propertyKey: 'dpi_max',
      selectedValue: '35000',
      selectedCandidateId: 'cmp_dpi_35000',
      confidenceScore: 0.9,
      aiConfirmSharedStatus: 'pending',
      userAcceptSharedStatus: null,
    });
    upsertStrictKeyReviewState(db, CATEGORY, {
      category: CATEGORY,
      targetKind: 'component_key',
      fieldKey: 'ips',
      componentIdentifier,
      propertyKey: 'ips',
      selectedValue: '750',
      selectedCandidateId: 'cmp_ips_750',
      confidenceScore: 0.9,
      aiConfirmSharedStatus: 'pending',
      userAcceptSharedStatus: null,
    });
    upsertStrictKeyReviewState(db, CATEGORY, {
      category: CATEGORY,
      targetKind: 'component_key',
      fieldKey: '__name',
      componentIdentifier,
      propertyKey: '__name',
      selectedValue: 'PAW3950',
      selectedCandidateId: null,
      confidenceScore: 1.0,
      aiConfirmSharedStatus: 'confirmed',
      userAcceptSharedStatus: null,
    });
    upsertStrictKeyReviewState(db, CATEGORY, {
      category: CATEGORY,
      targetKind: 'enum_key',
      fieldKey: 'connection',
      enumValueNorm: '2.4ghz',
      selectedValue: '2.4GHz',
      selectedCandidateId: 'global_connection_candidate',
      confidenceScore: 0.98,
      aiConfirmSharedStatus: 'pending',
      userAcceptSharedStatus: null,
    });
    upsertStrictKeyReviewState(db, CATEGORY, {
      category: CATEGORY,
      targetKind: 'enum_key',
      fieldKey: 'connection',
      enumValueNorm: 'wireless',
      selectedValue: 'Wireless',
      selectedCandidateId: 'p1-conn-2',
      confidenceScore: 0.65,
      aiConfirmSharedStatus: 'pending',
      userAcceptSharedStatus: null,
    });

    const port = await findFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const guiServerPath = path.resolve('src/api/guiServer.js');
    child = spawn('node', [guiServerPath, '--port', String(port), '--local'], {
      cwd: tempRoot,
      env: {
        ...process.env,
        HELPER_FILES_ROOT: config.helperFilesRoot,
        LOCAL_OUTPUT_ROOT: config.localOutputRoot,
        LOCAL_INPUT_ROOT: path.join(tempRoot, 'fixtures'),
        OUTPUT_MODE: 'local',
        LOCAL_MODE: 'true',
        __GUI_DIST_ROOT: guiDistRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => logs.push(String(chunk)));
    child.stderr.on('data', (chunk) => logs.push(String(chunk)));
    await waitForServerReady(baseUrl, child);

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    page = await context.newPage();
    await page.goto(`${baseUrl}/#/review`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Spec Factory', { timeout: 20_000 });

    const categorySelect = page.locator('aside select').first();
    await waitForCondition(async () => (await categorySelect.locator(`option[value="${CATEGORY}"]`).count()) > 0, 20_000, 150, 'category_option_visible');
    await categorySelect.selectOption(CATEGORY);
    await page.waitForSelector(`text=${CATEGORY}`, { timeout: 20_000 });
    await page.getByRole('link', { name: 'Review Grid' }).click();
    await waitForCondition(async () => {
      const payload = await apiJson(baseUrl, 'GET', `/review/${CATEGORY}/products-index`);
      return Array.isArray(payload?.products) && payload.products.length >= 2;
    }, 20_000, 150, 'products_index_populated');
    await page.waitForSelector(`[data-product-id="${PRODUCT_A}"][data-field-key="weight"]`, { timeout: 20_000 });

    await clickGridCell(page, PRODUCT_A, 'weight');
    await ensureButtonVisible(page, 'Accept Item');
    await ensureButtonVisible(page, 'Confirm Item');
    await page.getByRole('button', { name: 'Accept Item' }).first().click();
    const weightSlotId = getItemFieldStateId(db, CATEGORY, PRODUCT_A, 'weight');
    assert.ok(weightSlotId, 'weight item slot id should exist');
    await waitForCondition(async () => {
      const state = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'grid_key',
        itemIdentifier: PRODUCT_A,
        fieldKey: 'weight',
        itemFieldStateId: weightSlotId,
      });
      return state?.user_accept_primary_status === 'accepted';
    }, 15_000, 120, 'grid_item_accept_primary');
    const gridCandidatesSectionAfterAccept = page.locator('section').filter({ hasText: /Candidates \(/ }).first();
    const gridAcceptedValueCard = gridCandidatesSectionAfterAccept.locator('span[title="49"]').first();
    const gridConfirmAfterAccept = gridAcceptedValueCard.locator('xpath=ancestor::div[contains(@class,"border")][1]//button[normalize-space()="Confirm Item"]').first();
    await waitForCondition(async () => (
      (await gridConfirmAfterAccept.count()) > 0
    ), 15_000, 120, 'grid_confirm_still_visible_after_accept');

    await clickGridCell(page, PRODUCT_A, 'dpi');
    await ensureButtonVisible(page, 'Confirm Item');
    await page.getByRole('button', { name: 'Confirm Item' }).first().click();
    await waitForCondition(async () => {
      const payload = await apiJson(baseUrl, 'GET', `/review/${CATEGORY}/candidates/${PRODUCT_A}/dpi`);
      return payload?.keyReview?.primaryStatus === 'confirmed' && payload?.keyReview?.userAcceptPrimary == null;
    }, 15_000, 120, 'grid_item_confirm_primary');

    await clickGridCell(page, PRODUCT_A, 'connection');
    const gridCandidatesSection = page.locator('section').filter({ hasText: /Candidates \(/ }).first();
    assert.equal(await gridCandidatesSection.getByRole('button', { name: 'Accept Shared' }).count(), 0);
    assert.equal(await gridCandidatesSection.getByRole('button', { name: 'Confirm Shared' }).count(), 0);
    assert.equal(await gridCandidatesSection.locator('text=AI Shared Pending').count(), 0);
    // Candidate card styling can vary by list virtualization/order; button contract is authoritative.

    await page.getByRole('link', { name: 'Review Components' }).click();
    await page.waitForSelector('text=Enum Lists', { timeout: 20_000 });
    const debugToggle = page.getByRole('button', { name: /Debug LP\+ID/ }).first();
    if ((await debugToggle.count()) > 0) {
      const label = String(await debugToggle.innerText());
      if (!label.includes('ON')) {
        await debugToggle.click();
      }
      await waitForCondition(async () => String(await debugToggle.innerText()).includes('ON'), 10_000, 120, 'component_debug_toggle_on');
    }
    await page.getByRole('button', { name: /^Sensor/ }).first().click();
    await page.waitForSelector('span[title="35000"]', { timeout: 20_000 });
    // Regression: component name cell should not show pending AI badge just because
    // pipeline candidates exist when lane pending is false.
    const componentNameRow = page.locator('tr', { has: page.locator('span[title="PAW3950"]') }).first();
    const componentNameCell = componentNameRow.locator('td').first();
    assert.equal(await componentNameCell.locator('span[title="Shared AI review pending"]').count(), 0);
    assert.equal(await componentNameCell.locator('span[title="Item AI review pending"]').count(), 0);

    await clickAndWaitForDrawer(page, '35000');
    const componentCandidatesSection = page.locator('section').filter({ hasText: /Candidates \(/ }).first();
    const componentAcceptButton = componentCandidatesSection
      .locator('span[title="candidate_id: cmp_dpi_35000"]')
      .locator('xpath=ancestor::div[contains(@class,"border")][1]//button[normalize-space()="Accept"]')
      .first();
    await componentAcceptButton.click();
    await waitForCondition(async () => {
      const state = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'component_key',
        fieldKey: 'dpi_max',
        componentIdentifier,
        propertyKey: 'dpi_max',
      });
      return state?.user_accept_shared_status === 'accepted' && state?.ai_confirm_shared_status === 'pending';
    }, 15_000, 120, 'component_accept');
    const componentConfirmAfterAccept = componentCandidatesSection
      .locator('xpath=.//button[normalize-space()="Confirm"]')
      .first();
    await waitForCondition(async () => (
      (await componentConfirmAfterAccept.count()) > 0
    ), 15_000, 120, 'component_confirm_visible_after_accept_when_pending_candidates_remain');

    await clickAndWaitForDrawer(page, '750');
    const componentConfirmSection = page.locator('section').filter({ hasText: /Candidates \(/ }).first();
    const componentConfirmButton = componentConfirmSection
      .locator('span[title="750"]')
      .locator('xpath=ancestor::div[contains(@class,"border")][1]//button[normalize-space()="Confirm"]')
      .first();
    await componentConfirmButton.click();
    await waitForCondition(async () => {
      const state = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'component_key',
        fieldKey: 'ips',
        componentIdentifier,
        propertyKey: 'ips',
      });
      return state?.user_accept_shared_status == null
        && (state?.ai_confirm_shared_status === 'pending' || state?.ai_confirm_shared_status === 'confirmed')
        && Boolean(state?.ai_confirm_shared_at);
    }, 15_000, 120, 'component_confirm');

    await page.getByRole('button', { name: 'Enum Lists' }).click();
    await page.getByRole('button', { name: /connection/i }).first().waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: /connection/i }).first().click();
    await clickAndWaitForDrawer(page, '2.4GHz');
    const enumCandidatesSection = page.locator('section').filter({ hasText: /Candidates \(/ }).first();
    const enumAcceptButton = enumCandidatesSection
      .locator('span[title="candidate_id: global_connection_candidate"]')
      .locator('xpath=ancestor::div[contains(@class,"border")][1]//button[normalize-space()="Accept"]')
      .first();
    await enumAcceptButton.click();
    await waitForCondition(async () => {
      const state = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'enum_key',
        fieldKey: 'connection',
        enumValueNorm: '2.4ghz',
      });
      return state?.user_accept_shared_status === 'accepted' && state?.ai_confirm_shared_status === 'pending';
    }, 15_000, 120, 'enum_accept');
    await clickAndWaitForDrawer(page, 'Wireless');
    const enumWirelessCandidatesSection = page.locator('section').filter({ hasText: /Candidates \(/ }).first();
    const enumConfirmAfterAccept = enumWirelessCandidatesSection
      .locator('span[title="candidate_id: p1-conn-2"]')
      .locator('xpath=ancestor::div[contains(@class,"border")][1]//button[normalize-space()="Confirm"]')
      .first();

    const enumPayloadBeforeWireless = await apiJson(baseUrl, 'GET', `/review-components/${CATEGORY}/enums`);
    const connectionField = (enumPayloadBeforeWireless?.fields || []).find((entry) => entry?.field === 'connection');
    const wirelessEntry = (connectionField?.values || []).find(
      (entry) => String(entry?.value || '').trim().toLowerCase() === 'wireless',
    );
    assert.equal(Boolean(wirelessEntry), true);
    assert.equal(Boolean(wirelessEntry?.needs_review), true);

    if ((await enumConfirmAfterAccept.count()) > 0) {
      await enumConfirmAfterAccept.click();
    }
    await waitForCondition(async () => {
      const valueState = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'enum_key',
        fieldKey: 'connection',
        enumValueNorm: '2.4ghz',
      });
      const wirelessState = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'enum_key',
        fieldKey: 'connection',
        enumValueNorm: 'wireless',
      });
      return valueState?.user_accept_shared_status === 'accepted'
        && valueState?.ai_confirm_shared_status === 'pending'
        && wirelessState?.user_accept_shared_status == null
        && (wirelessState?.ai_confirm_shared_status === 'pending' || wirelessState?.ai_confirm_shared_status === 'confirmed');
    }, 15_000, 120, 'enum_confirm_independent');

    // Edge cases: pending lanes with no candidates should still expose fallback Confirm actions.
    db.db.prepare(
      'DELETE FROM candidates WHERE category = ? AND product_id = ? AND field_key = ?'
    ).run(CATEGORY, PRODUCT_A, 'weight');
    db.db.prepare(`
      UPDATE key_review_state
      SET selected_candidate_id = NULL,
          ai_confirm_primary_status = 'pending',
          ai_confirm_primary_confidence = NULL,
          ai_confirm_primary_at = NULL,
          ai_confirm_primary_error = NULL,
          user_accept_primary_status = NULL,
          updated_at = datetime('now')
      WHERE category = ?
        AND target_kind = 'grid_key'
        AND item_identifier = ?
        AND field_key = ?
    `).run(CATEGORY, PRODUCT_A, 'weight');

    db.upsertComponentValue({
      componentType: 'sensor',
      componentName: 'PAW3950',
      componentMaker: 'PixArt',
      propertyKey: 'custom_prop',
      value: 'alpha',
      confidence: 0.6,
      variancePolicy: null,
      source: 'manual',
      acceptedCandidateId: null,
      needsReview: true,
      overridden: false,
      constraints: [],
    });
    upsertStrictKeyReviewState(db, CATEGORY, {
      category: CATEGORY,
      targetKind: 'component_key',
      fieldKey: 'custom_prop',
      componentIdentifier,
      propertyKey: 'custom_prop',
      selectedValue: 'alpha',
      selectedCandidateId: null,
      confidenceScore: 0.6,
      aiConfirmSharedStatus: 'pending',
      userAcceptSharedStatus: null,
    });

    db.upsertListValue({
      fieldKey: 'connection',
      value: 'ZeroCand',
      normalizedValue: 'zerocand',
      source: 'manual',
      enumPolicy: 'closed',
      acceptedCandidateId: null,
      needsReview: true,
      overridden: false,
      sourceTimestamp: new Date().toISOString(),
    });
    upsertStrictKeyReviewState(db, CATEGORY, {
      category: CATEGORY,
      targetKind: 'enum_key',
      fieldKey: 'connection',
      enumValueNorm: 'zerocand',
      selectedValue: 'ZeroCand',
      selectedCandidateId: null,
      confidenceScore: 0.6,
      aiConfirmSharedStatus: 'pending',
      userAcceptSharedStatus: null,
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Spec Factory', { timeout: 20_000 });
    const categorySelectReloaded = page.locator('aside select').first();
    await waitForCondition(async () => (await categorySelectReloaded.locator(`option[value="${CATEGORY}"]`).count()) > 0, 20_000, 150, 'category_option_visible_after_reload');
    await categorySelectReloaded.selectOption(CATEGORY);

    await page.getByRole('link', { name: 'Review Grid' }).click();
    await page.waitForSelector(`[data-product-id="${PRODUCT_A}"][data-field-key="weight"]`, { timeout: 20_000 });
    await clickGridCell(page, PRODUCT_A, 'weight');
    assert.equal(await page.getByRole('button', { name: 'Confirm Item' }).count(), 0);
    const zeroCandidateGridPayload = await apiJson(baseUrl, 'GET', `/review/${CATEGORY}/candidates/${PRODUCT_A}/weight`);
    assert.equal(zeroCandidateGridPayload?.keyReview?.primaryStatus, 'pending');

    await page.getByRole('link', { name: 'Review Components' }).click();
    await page.waitForSelector('text=Enum Lists', { timeout: 20_000 });
    await page.getByRole('button', { name: /^Sensor/ }).first().click();
    await clickAndWaitForDrawer(page, 'alpha');
    assert.equal(await page.getByRole('button', { name: 'Confirm Shared' }).count(), 0);
    const componentLaneState = getStrictKeyReviewState(db, CATEGORY, {
      category: CATEGORY,
      targetKind: 'component_key',
      fieldKey: 'custom_prop',
      componentIdentifier,
      propertyKey: 'custom_prop',
    });
    assert.equal(componentLaneState?.ai_confirm_shared_status, 'pending');
    assert.equal(componentLaneState?.user_accept_shared_status, null);

    const reviewDoc = JSON.parse(
      await fs.readFile(path.join(config.helperFilesRoot, CATEGORY, '_suggestions', 'component_review.json'), 'utf8'),
    );
    const r35000 = reviewDoc.items.find((item) => item.review_id === 'rv-cmp-35000');
    const r26000 = reviewDoc.items.find((item) => item.review_id === 'rv-cmp-26000');
    const r24 = reviewDoc.items.find((item) => item.review_id === 'rv-enum-24');
    const rWireless = reviewDoc.items.find((item) => item.review_id === 'rv-enum-wireless');
    assert.equal(r35000?.status, 'pending_ai');
    assert.equal(r26000?.status, 'pending_ai');
    assert.equal(r24?.status, 'pending_ai');
    assert.equal(rWireless?.status, 'pending_ai');
  } catch (err) {
    throw new Error(`${err.message}\nserver_logs:\n${logs.join('')}`);
  } finally {
    try { await page?.close?.(); } catch { /* best-effort */ }
    try { await context?.close?.(); } catch { /* best-effort */ }
    try { await browser?.close?.(); } catch { /* best-effort */ }
    await stopProcess(child);
    try { db?.close?.(); } catch { /* best-effort */ }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

