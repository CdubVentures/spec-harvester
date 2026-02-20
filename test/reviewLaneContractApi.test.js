import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createStorage } from '../src/s3/storage.js';
import { SpecDb } from '../src/db/specDb.js';
import { seedSpecDb } from '../src/db/seed.js';
import { buildComponentIdentifier } from '../src/utils/componentIdentifier.js';

const CATEGORY = 'mouse_contract_lane_matrix';
const PRODUCT_A = 'mouse-razer-viper-v3-pro';
const PRODUCT_B = 'mouse-pulsar-x2-v3';

const FIELD_RULES_FIELDS = {
  weight: { required_level: 'required', contract: { type: 'number', unit: 'g', shape: 'scalar', range: { min: 20, max: 300 } } },
  dpi: { required_level: 'required', contract: { type: 'integer', unit: 'dpi', shape: 'scalar', range: { min: 50, max: 100000 } } },
  sensor: { required_level: 'required', contract: { type: 'string', shape: 'scalar' }, component: { type: 'sensor', source: 'component_db.sensor' } },
  connection: { required_level: 'required', contract: { type: 'string', shape: 'scalar' }, enum: { policy: 'closed' }, enum_name: 'connection' },
};

const SENSOR_ITEMS = [
  {
    name: 'PAW3950',
    maker: 'PixArt',
    aliases: ['3950', 'PixArt 3950'],
    links: ['https://pixart.com/paw3950'],
    properties: { dpi_max: '35000', ips: '750', acceleration: '50' },
  },
];

const KNOWN_VALUE_ENUMS = {
  connection: { policy: 'closed', values: ['2.4GHz', 'Wireless', 'Wired'] },
};

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
        { candidate_id: 'shared-candidate', value: '49', score: 0.8, host: 'mirror.example', source_host: 'mirror.example', source_method: 'scrape', method: 'scrape', source_tier: 2, tier: 2 },
        { candidate_id: 'same-field-dup', value: '49', score: 0.74, host: 'source-a.example', source_host: 'source-a.example', source_method: 'scrape', method: 'scrape', source_tier: 3, tier: 3 },
        { candidate_id: 'same-field-dup', value: '49', score: 0.7, host: 'source-b.example', source_host: 'source-b.example', source_method: 'llm', method: 'llm', source_tier: 3, tier: 3 },
      ],
      dpi: [
        { candidate_id: 'p1-dpi-1', value: '35000', score: 0.97, host: 'razer.com', source_host: 'razer.com', source_method: 'dom', method: 'dom', source_tier: 1, tier: 1 },
        { candidate_id: 'shared-candidate', value: '35000', score: 0.75, host: 'mirror.example', source_host: 'mirror.example', source_method: 'scrape', method: 'scrape', source_tier: 2, tier: 2 },
      ],
      sensor: [{ candidate_id: 'p1-sensor-1', value: 'PAW3950', score: 0.98, host: 'razer.com', source_host: 'razer.com', source_method: 'dom', method: 'dom', source_tier: 1, tier: 1 }],
      connection: [
        { candidate_id: 'p1-conn-1', value: '2.4GHz', score: 0.98, host: 'razer.com', source_host: 'razer.com', source_method: 'dom', method: 'dom', source_tier: 1, tier: 1 },
        { candidate_id: 'p1-conn-2', value: 'Wireless', score: 0.65, host: 'forum.example', source_host: 'forum.example', source_method: 'llm', method: 'llm', source_tier: 3, tier: 3 },
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
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function seedFieldRules(helperRoot, category) {
  const generatedRoot = path.join(helperRoot, category, '_generated');
  await writeJson(path.join(generatedRoot, 'field_rules.json'), { category, fields: FIELD_RULES_FIELDS });
  await writeJson(path.join(generatedRoot, 'known_values.json'), { category, fields: {} });
  await writeJson(path.join(generatedRoot, 'parse_templates.json'), { category, templates: {} });
  await writeJson(path.join(generatedRoot, 'cross_validation_rules.json'), { category, rules: [] });
  await writeJson(path.join(generatedRoot, 'key_migrations.json'), {
    version: '1.0.0',
    previous_version: '1.0.0',
    bump: 'patch',
    summary: { added_count: 0, removed_count: 0, changed_count: 0 },
    key_map: {},
    migrations: [],
  });
  await writeJson(path.join(generatedRoot, 'ui_field_catalog.json'), {
    category,
    fields: Object.keys(FIELD_RULES_FIELDS).map((key) => ({ key, group: 'specs' })),
  });
}

async function seedComponentDb(helperRoot, category) {
  await writeJson(path.join(helperRoot, category, '_generated', 'component_db', 'sensor.json'), {
    component_type: 'sensor',
    items: SENSOR_ITEMS,
  });
}

async function seedKnownValues(helperRoot, category) {
  await writeJson(path.join(helperRoot, category, '_generated', 'known_values.json'), {
    category,
    fields: {
      connection: KNOWN_VALUE_ENUMS.connection.values,
    },
  });
}

async function seedWorkbookMap(helperRoot, category) {
  await writeJson(path.join(helperRoot, category, '_control_plane', 'workbook_map.json'), {
    manual_enum_values: {},
    manual_enum_timestamps: {},
  });
}

async function seedLatestArtifacts(storage, category, productId, product) {
  const latestBase = storage.resolveOutputKey(category, productId, 'latest');
  await storage.writeObject(
    `${latestBase}/normalized.json`,
    Buffer.from(JSON.stringify({ identity: product.identity, fields: product.fields }, null, 2), 'utf8'),
    { contentType: 'application/json' },
  );
  await storage.writeObject(
    `${latestBase}/provenance.json`,
    Buffer.from(JSON.stringify(product.provenance, null, 2), 'utf8'),
    { contentType: 'application/json' },
  );
  await storage.writeObject(
    `${latestBase}/summary.json`,
    Buffer.from(JSON.stringify({
      confidence: 0.9,
      coverage_overall_percent: 100,
      missing_required_fields: [],
      fields_below_pass_target: [],
      critical_fields_below_pass_target: [],
      field_reasoning: {},
    }, null, 2), 'utf8'),
    { contentType: 'application/json' },
  );
  await storage.writeObject(
    `${latestBase}/candidates.json`,
    Buffer.from(JSON.stringify(product.candidates, null, 2), 'utf8'),
    { contentType: 'application/json' },
  );
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
        matched_component: 'PAW3950',
        match_type: 'exact',
        status: 'pending_ai',
        product_id: PRODUCT_A,
        created_at: '2026-02-18T00:00:00.000Z',
        product_attributes: { dpi_max: '35000', sensor_brand: 'PixArt' },
      },
      {
        review_id: 'rv-cmp-26000',
        category,
        component_type: 'sensor',
        field_key: 'sensor',
        raw_query: 'PAW3950',
        matched_component: 'PAW3950',
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

function buildFieldRulesForSeed() {
  const entries = {};
  const index = new Map();
  for (const item of SENSOR_ITEMS) {
    entries[item.name] = { ...item, canonical_name: item.name };
    index.set(item.name.toLowerCase(), entries[item.name]);
    index.set(item.name.toLowerCase().replace(/\s+/g, ''), entries[item.name]);
    for (const alias of item.aliases || []) {
      index.set(String(alias).toLowerCase(), entries[item.name]);
      index.set(String(alias).toLowerCase().replace(/\s+/g, ''), entries[item.name]);
    }
  }
  return {
    rules: { fields: FIELD_RULES_FIELDS },
    componentDBs: { sensor: { entries, __index: index } },
    knownValues: { enums: KNOWN_VALUE_ENUMS },
  };
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

async function waitForServerReady(baseUrl, child, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`gui_server_exited_early:${child.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/v1/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('gui_server_health_timeout');
}

async function apiJson(baseUrl, method, apiPath, body = undefined) {
  const res = await fetch(`${baseUrl}/api/v1${apiPath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${apiPath} -> ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function findEnumValue(payload, field, value) {
  const fieldRow = (payload?.fields || []).find((entry) => String(entry?.field || '') === field);
  if (!fieldRow) return null;
  return (fieldRow.values || []).find((entry) => String(entry?.value || '') === value) || null;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, 3_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

test('lane contract matrix: grid + component + enum endpoints stay decoupled and propagate correctly', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'review-lane-contract-api-'));
  const storage = makeStorage(tempRoot);
  const config = {
    helperFilesRoot: path.join(tempRoot, 'helper_files'),
    localOutputRoot: path.join(tempRoot, 'out'),
    specDbDir: path.join(tempRoot, '.specfactory_tmp'),
  };

  let child = null;
  let db = null;
  const logs = [];

  try {
    await seedFieldRules(config.helperFilesRoot, CATEGORY);
    await seedComponentDb(config.helperFilesRoot, CATEGORY);
    await seedKnownValues(config.helperFilesRoot, CATEGORY);
    await seedWorkbookMap(config.helperFilesRoot, CATEGORY);
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

    const componentIdentifier = buildComponentIdentifier('sensor', 'PAW3950', 'PixArt');
    db.upsertKeyReviewState({
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
    db.upsertKeyReviewState({
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
    db.upsertKeyReviewState({
      category: CATEGORY,
      targetKind: 'grid_key',
      itemIdentifier: PRODUCT_A,
      fieldKey: 'sensor',
      selectedValue: 'PAW3950',
      selectedCandidateId: 'global_sensor_candidate',
      confidenceScore: 0.98,
      aiConfirmSharedStatus: 'pending',
      userAcceptSharedStatus: null,
    });
    db.upsertKeyReviewState({
      category: CATEGORY,
      targetKind: 'grid_key',
      itemIdentifier: PRODUCT_B,
      fieldKey: 'sensor',
      selectedValue: 'PAW3950',
      selectedCandidateId: 'global_sensor_candidate',
      confidenceScore: 0.96,
      aiConfirmSharedStatus: 'pending',
      userAcceptSharedStatus: null,
    });
    db.upsertKeyReviewState({
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
    db.upsertKeyReviewState({
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
    db.upsertKeyReviewState({
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
    db.upsertKeyReviewState({
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
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => logs.push(String(chunk)));
    child.stderr.on('data', (chunk) => logs.push(String(chunk)));
    await waitForServerReady(baseUrl, child);

    await t.test('source candidate ids are unique per product+field context', async () => {
      const rows = db.db.prepare(
        `SELECT candidate_id, field_key
         FROM candidates
         WHERE category = ? AND product_id = ? AND candidate_id LIKE ?
         ORDER BY field_key, candidate_id`
      ).all(CATEGORY, PRODUCT_A, '%shared-candidate%');
      assert.equal(rows.length, 2);
      assert.notEqual(rows[0].candidate_id, rows[1].candidate_id);
      assert.equal(rows[0].candidate_id.includes('::weight::') || rows[1].candidate_id.includes('::weight::'), true);
      assert.equal(rows[0].candidate_id.includes('::dpi::') || rows[1].candidate_id.includes('::dpi::'), true);

      const sameFieldRows = db.db.prepare(
        `SELECT candidate_id, field_key
         FROM candidates
         WHERE category = ? AND product_id = ? AND candidate_id LIKE ?
         ORDER BY candidate_id`
      ).all(CATEGORY, PRODUCT_A, '%same-field-dup%');
      assert.equal(sameFieldRows.length, 2);
      assert.equal(sameFieldRows.every((row) => row.field_key === 'weight'), true);
      assert.notEqual(sameFieldRows[0].candidate_id, sameFieldRows[1].candidate_id);
      assert.equal(sameFieldRows.some((row) => row.candidate_id.includes('::dup_')), true);
    });

    await t.test('grid item confirm only confirms item lane', async () => {
      await apiJson(baseUrl, 'POST', `/review/${CATEGORY}/key-review-confirm`, {
        productId: PRODUCT_A,
        field: 'weight',
        lane: 'primary',
        candidateId: 'p1-weight-1',
        candidateValue: '49',
        candidateConfidence: 0.95,
      });

      const state = db.getKeyReviewState({
        category: CATEGORY,
        targetKind: 'grid_key',
        itemIdentifier: PRODUCT_A,
        fieldKey: 'weight',
      });
      assert.equal(state.ai_confirm_primary_status, 'confirmed');
      assert.equal(state.user_accept_primary_status, null);

      const payload = await apiJson(baseUrl, 'GET', `/review/${CATEGORY}/candidates/${PRODUCT_A}/weight`);
      assert.equal(payload.keyReview.primaryStatus, 'confirmed');
      assert.equal(payload.keyReview.userAcceptPrimary, null);
    });

    await t.test('grid item accept only accepts item lane', async () => {
      await apiJson(baseUrl, 'POST', `/review/${CATEGORY}/key-review-accept`, {
        productId: PRODUCT_A,
        field: 'dpi',
        lane: 'primary',
        candidateId: 'p1-dpi-1',
        candidateValue: '35000',
        candidateConfidence: 0.97,
      });

      const state = db.getKeyReviewState({
        category: CATEGORY,
        targetKind: 'grid_key',
        itemIdentifier: PRODUCT_A,
        fieldKey: 'dpi',
      });
      assert.equal(state.user_accept_primary_status, 'accepted');
      assert.equal(state.ai_confirm_primary_status, 'pending');

      const payload = await apiJson(baseUrl, 'GET', `/review/${CATEGORY}/candidates/${PRODUCT_A}/dpi`);
      assert.equal(payload.keyReview.userAcceptPrimary, 'accepted');
      assert.equal(payload.keyReview.primaryStatus, 'pending');
    });

    await t.test('grid shared confirm is context-local (no cross-context propagation)', async () => {
      await apiJson(baseUrl, 'POST', `/review/${CATEGORY}/key-review-confirm`, {
        productId: PRODUCT_A,
        field: 'sensor',
        lane: 'shared',
        candidateId: 'global_sensor_candidate',
        candidateValue: 'PAW3950',
        candidateConfidence: 0.98,
      });

      const p1 = db.getKeyReviewState({
        category: CATEGORY,
        targetKind: 'grid_key',
        itemIdentifier: PRODUCT_A,
        fieldKey: 'sensor',
      });
      const p2 = db.getKeyReviewState({
        category: CATEGORY,
        targetKind: 'grid_key',
        itemIdentifier: PRODUCT_B,
        fieldKey: 'sensor',
      });
      assert.equal(p1.ai_confirm_shared_status, 'confirmed');
      assert.equal(p2.ai_confirm_shared_status, 'pending');
      assert.equal(p1.user_accept_shared_status, null);
      assert.equal(p2.user_accept_shared_status, null);

      const sensorA = await apiJson(baseUrl, 'GET', `/review/${CATEGORY}/candidates/${PRODUCT_A}/sensor`);
      const sensorB = await apiJson(baseUrl, 'GET', `/review/${CATEGORY}/candidates/${PRODUCT_B}/sensor`);
      assert.equal(sensorA.keyReview.sharedStatus, 'confirmed');
      assert.equal(sensorB.keyReview.sharedStatus, 'pending');

      const componentState = db.getKeyReviewState({
        category: CATEGORY,
        targetKind: 'component_key',
        fieldKey: 'dpi_max',
        componentIdentifier,
        propertyKey: 'dpi_max',
      });
      assert.equal(componentState.ai_confirm_shared_status, 'pending');
    });

    await t.test('grid shared accept propagates and creates/updates enum key context', async () => {
      await apiJson(baseUrl, 'POST', `/review/${CATEGORY}/key-review-accept`, {
        productId: PRODUCT_A,
        field: 'connection',
        lane: 'shared',
        candidateId: 'global_connection_candidate',
        candidateValue: '2.4GHz',
        candidateConfidence: 0.98,
      });

      const p1 = db.getKeyReviewState({
        category: CATEGORY,
        targetKind: 'grid_key',
        itemIdentifier: PRODUCT_A,
        fieldKey: 'connection',
      });
      const p2 = db.getKeyReviewState({
        category: CATEGORY,
        targetKind: 'grid_key',
        itemIdentifier: PRODUCT_B,
        fieldKey: 'connection',
      });
      const enumState = db.getKeyReviewState({
        category: CATEGORY,
        targetKind: 'enum_key',
        fieldKey: 'connection',
        enumValueNorm: '2.4ghz',
      });
      assert.equal(p1.user_accept_shared_status, 'accepted');
      assert.equal(p2.user_accept_shared_status, 'accepted');
      assert.equal(p1.ai_confirm_shared_status, 'pending');
      assert.equal(enumState.user_accept_shared_status, 'accepted');
      assert.equal(enumState.ai_confirm_shared_status, 'pending');

      const connectionA = await apiJson(baseUrl, 'GET', `/review/${CATEGORY}/candidates/${PRODUCT_A}/connection`);
      const connectionB = await apiJson(baseUrl, 'GET', `/review/${CATEGORY}/candidates/${PRODUCT_B}/connection`);
      assert.equal(connectionA.keyReview.userAcceptShared, 'accepted');
      assert.equal(connectionB.keyReview.userAcceptShared, 'accepted');

      const enumPayload = await apiJson(baseUrl, 'GET', `/review-components/${CATEGORY}/enums`);
      const value = findEnumValue(enumPayload, 'connection', '2.4GHz');
      assert.ok(value, 'connection value 2.4GHz should exist in enum payload');
      assert.equal(value.accepted_candidate_id, 'global_connection_candidate');
    });

    await t.test('component accept and confirm remain decoupled and confirm is candidate scoped', async () => {
      db.db.prepare(
        `UPDATE key_review_state
         SET ai_confirm_shared_status = 'pending',
             ai_confirm_shared_confidence = NULL,
             ai_confirm_shared_at = NULL,
             ai_confirm_shared_error = NULL,
             updated_at = datetime('now')
         WHERE category = ?
           AND target_kind = 'component_key'
           AND component_identifier = ?
           AND property_key = 'dpi_max'`
      ).run(CATEGORY, componentIdentifier);

      await apiJson(baseUrl, 'POST', `/review-components/${CATEGORY}/component-override`, {
        componentType: 'sensor',
        name: 'PAW3950',
        maker: 'PixArt',
        property: 'dpi_max',
        value: '35000',
        candidateId: 'cmp_dpi_35000',
        candidateSource: 'pipeline',
      });

      const afterAccept = db.getKeyReviewState({
        category: CATEGORY,
        targetKind: 'component_key',
        fieldKey: 'dpi_max',
        componentIdentifier,
        propertyKey: 'dpi_max',
      });
      assert.equal(afterAccept.user_accept_shared_status, 'accepted');
      assert.equal(afterAccept.ai_confirm_shared_status, 'pending');
      const componentPayloadAfterAccept = await apiJson(baseUrl, 'GET', `/review-components/${CATEGORY}/components?type=sensor`);
      const componentRowAfterAccept = (componentPayloadAfterAccept.items || []).find((item) => item.name === 'PAW3950' && item.maker === 'PixArt');
      assert.equal(Boolean(componentRowAfterAccept?.properties?.dpi_max?.needs_review), false);

      await apiJson(baseUrl, 'POST', `/review-components/${CATEGORY}/component-key-review-confirm`, {
        componentType: 'sensor',
        name: 'PAW3950',
        maker: 'PixArt',
        property: 'dpi_max',
        candidateId: 'cmp_dpi_35000',
        candidateValue: '35000',
        candidateConfidence: 0.9,
      });

      const afterConfirm = db.getKeyReviewState({
        category: CATEGORY,
        targetKind: 'component_key',
        fieldKey: 'dpi_max',
        componentIdentifier,
        propertyKey: 'dpi_max',
      });
      assert.equal(afterConfirm.ai_confirm_shared_status, 'confirmed');
      assert.equal(afterConfirm.user_accept_shared_status, 'accepted');

      const reviewDoc = JSON.parse(
        await fs.readFile(path.join(config.helperFilesRoot, CATEGORY, '_suggestions', 'component_review.json'), 'utf8'),
      );
      const r35000 = reviewDoc.items.find((item) => item.review_id === 'rv-cmp-35000');
      const r26000 = reviewDoc.items.find((item) => item.review_id === 'rv-cmp-26000');
      assert.equal(r35000?.status, 'pending_ai');
      assert.equal(r26000?.status, 'pending_ai');

      const payload = await apiJson(baseUrl, 'GET', `/review-components/${CATEGORY}/components?type=sensor`);
      const row = (payload.items || []).find((item) => item.name === 'PAW3950' && item.maker === 'PixArt');
      assert.equal(row?.properties?.dpi_max?.accepted_candidate_id, 'cmp_dpi_35000');
      assert.equal(Boolean(row?.properties?.dpi_max?.needs_review), false);
    });

    await t.test('component authoritative update cascades to linked items and re-flags constraints', async () => {
      const componentValueRow = db.db.prepare(
        `SELECT component_maker
         FROM component_values
         WHERE category = ?
           AND component_type = 'sensor'
           AND component_name = 'PAW3950'
           AND property_key = 'dpi_max'
         LIMIT 1`
      ).get(CATEGORY);
      const resolvedMaker = String(componentValueRow?.component_maker || '');
      db.db.prepare(
        `UPDATE component_values
         SET variance_policy = ?, constraints = ?
         WHERE category = ?
           AND component_type = 'sensor'
           AND component_name = 'PAW3950'
           AND component_maker = ?
           AND property_key = 'dpi_max'`
      ).run('authoritative', JSON.stringify(['dpi <= dpi_max']), CATEGORY, resolvedMaker);

      await apiJson(baseUrl, 'POST', `/review-components/${CATEGORY}/component-override`, {
        componentType: 'sensor',
        name: 'PAW3950',
        maker: resolvedMaker,
        property: 'dpi_max',
        value: '25000',
        candidateId: 'cmp_dpi_25000',
        candidateSource: 'pipeline',
      });

      const propagated = db.db.prepare(
        `SELECT product_id, value, needs_ai_review
         FROM item_field_state
         WHERE category = ? AND field_key = 'dpi_max'
         ORDER BY product_id`
      ).all(CATEGORY);
      assert.equal(propagated.length, 2);
      const byProduct = new Map(propagated.map((row) => [row.product_id, row]));
      assert.equal(String(byProduct.get(PRODUCT_A)?.value || ''), '25000');
      assert.equal(String(byProduct.get(PRODUCT_B)?.value || ''), '25000');
      assert.equal(Number(byProduct.get(PRODUCT_A)?.needs_ai_review || 0), 1);
      assert.equal(Number(byProduct.get(PRODUCT_B)?.needs_ai_review || 0), 1);
    });

    await t.test('enum accept and confirm remain decoupled and confirm is value scoped', async () => {
      await apiJson(baseUrl, 'POST', `/review-components/${CATEGORY}/enum-override`, {
        field: 'connection',
        value: '2.4GHz',
        action: 'accept',
        candidateId: 'global_connection_candidate',
      });

      const afterAccept = db.getKeyReviewState({
        category: CATEGORY,
        targetKind: 'enum_key',
        fieldKey: 'connection',
        enumValueNorm: '2.4ghz',
      });
      assert.equal(afterAccept.user_accept_shared_status, 'accepted');
      assert.equal(afterAccept.ai_confirm_shared_status, 'pending');
      const enumPayloadAfterAccept = await apiJson(baseUrl, 'GET', `/review-components/${CATEGORY}/enums`);
      const enumValueAfterAccept = findEnumValue(enumPayloadAfterAccept, 'connection', '2.4GHz');
      assert.ok(enumValueAfterAccept, 'connection value 2.4GHz should exist after accept');
      assert.equal(enumValueAfterAccept.needs_review, false);

      await apiJson(baseUrl, 'POST', `/review-components/${CATEGORY}/enum-override`, {
        field: 'connection',
        value: '2.4GHz',
        action: 'confirm',
        candidateId: 'global_connection_candidate',
      });

      const afterConfirm = db.getKeyReviewState({
        category: CATEGORY,
        targetKind: 'enum_key',
        fieldKey: 'connection',
        enumValueNorm: '2.4ghz',
      });
      assert.equal(afterConfirm.ai_confirm_shared_status, 'confirmed');
      assert.equal(afterConfirm.user_accept_shared_status, 'accepted');

      const reviewDoc = JSON.parse(
        await fs.readFile(path.join(config.helperFilesRoot, CATEGORY, '_suggestions', 'component_review.json'), 'utf8'),
      );
      const r24 = reviewDoc.items.find((item) => item.review_id === 'rv-enum-24');
      const rWireless = reviewDoc.items.find((item) => item.review_id === 'rv-enum-wireless');
      assert.equal(r24?.status, 'pending_ai');
      assert.equal(rWireless?.status, 'pending_ai');

      const gridA = db.getKeyReviewState({
        category: CATEGORY,
        targetKind: 'grid_key',
        itemIdentifier: PRODUCT_A,
        fieldKey: 'connection',
      });
      const gridB = db.getKeyReviewState({
        category: CATEGORY,
        targetKind: 'grid_key',
        itemIdentifier: PRODUCT_B,
        fieldKey: 'connection',
      });
      assert.equal(gridA?.ai_confirm_shared_status, 'pending');
      assert.equal(gridB?.ai_confirm_shared_status, 'pending');

      const enumPayload = await apiJson(baseUrl, 'GET', `/review-components/${CATEGORY}/enums`);
      const value = findEnumValue(enumPayload, 'connection', '2.4GHz');
      assert.ok(value, 'connection value 2.4GHz should exist after enum actions');
      assert.equal(value.accepted_candidate_id, 'global_connection_candidate');
      assert.equal(value.needs_review, false);
    });

    await t.test('enum accept with oldValue renames and propagates to linked items', async () => {
      await apiJson(baseUrl, 'POST', `/review-components/${CATEGORY}/enum-override`, {
        field: 'connection',
        value: 'Wireless',
        oldValue: '2.4GHz',
        action: 'accept',
        candidateId: 'global_connection_candidate',
      });

      const renamedRows = db.db.prepare(
        `SELECT product_id, value
         FROM item_field_state
         WHERE category = ? AND field_key = 'connection'
         ORDER BY product_id`
      ).all(CATEGORY);
      assert.equal(renamedRows.length, 2);
      assert.equal(String(renamedRows[0].value || ''), 'Wireless');
      assert.equal(String(renamedRows[1].value || ''), 'Wireless');

      const enumState = db.getKeyReviewState({
        category: CATEGORY,
        targetKind: 'enum_key',
        fieldKey: 'connection',
        enumValueNorm: 'wireless',
      });
      assert.equal(enumState?.user_accept_shared_status, 'accepted');
      assert.equal(enumState?.ai_confirm_shared_status, 'pending');

      const enumPayload = await apiJson(baseUrl, 'GET', `/review-components/${CATEGORY}/enums`);
      const oldValue = findEnumValue(enumPayload, 'connection', '2.4GHz');
      const newValue = findEnumValue(enumPayload, 'connection', 'Wireless');
      assert.equal(oldValue, null);
      assert.ok(newValue, 'connection value Wireless should exist after rename accept');
      assert.equal(newValue.needs_review, false);
    });

    await t.test('confirm endpoints work for pending lanes with zero candidates (grid/component/enum)', async () => {
      // Grid: remove all candidates for a pending primary lane and confirm without candidate id.
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

      const weightBefore = await apiJson(baseUrl, 'GET', `/review/${CATEGORY}/candidates/${PRODUCT_A}/weight`);
      assert.equal(Array.isArray(weightBefore?.candidates), true);
      assert.equal(weightBefore?.keyReview?.primaryStatus, 'pending');

      await apiJson(baseUrl, 'POST', `/review/${CATEGORY}/key-review-confirm`, {
        productId: PRODUCT_A,
        field: 'weight',
        lane: 'primary',
      });
      const weightAfter = db.getKeyReviewState({
        category: CATEGORY,
        targetKind: 'grid_key',
        itemIdentifier: PRODUCT_A,
        fieldKey: 'weight',
      });
      assert.equal(weightAfter?.ai_confirm_primary_status, 'confirmed');
      assert.equal(weightAfter?.user_accept_primary_status, null);

      // Component: pending shared lane with no candidates.
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
      db.upsertKeyReviewState({
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

      const componentPayloadBefore = await apiJson(baseUrl, 'GET', `/review-components/${CATEGORY}/components?type=sensor`);
      const componentRowBefore = (componentPayloadBefore.items || []).find((item) => item.name === 'PAW3950' && item.maker === 'PixArt');
      assert.ok(componentRowBefore, 'component row should exist');
      assert.equal(Array.isArray(componentRowBefore?.properties?.custom_prop?.candidates), true);
      assert.equal(componentRowBefore?.properties?.custom_prop?.candidates?.length || 0, 0);
      assert.equal(Boolean(componentRowBefore?.properties?.custom_prop?.needs_review), true);

      await apiJson(baseUrl, 'POST', `/review-components/${CATEGORY}/component-key-review-confirm`, {
        componentType: 'sensor',
        name: 'PAW3950',
        maker: 'PixArt',
        property: 'custom_prop',
        candidateValue: 'alpha',
      });
      const componentStateAfter = db.getKeyReviewState({
        category: CATEGORY,
        targetKind: 'component_key',
        fieldKey: 'custom_prop',
        componentIdentifier,
        propertyKey: 'custom_prop',
      });
      assert.equal(componentStateAfter?.ai_confirm_shared_status, 'confirmed');
      assert.equal(componentStateAfter?.user_accept_shared_status, null);

      const componentPayloadAfter = await apiJson(baseUrl, 'GET', `/review-components/${CATEGORY}/components?type=sensor`);
      const componentRowAfter = (componentPayloadAfter.items || []).find((item) => item.name === 'PAW3950' && item.maker === 'PixArt');
      assert.equal(Boolean(componentRowAfter?.properties?.custom_prop?.needs_review), false);

      // Enum: pending shared lane with no candidates.
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
      db.upsertKeyReviewState({
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

      const enumPayloadBefore = await apiJson(baseUrl, 'GET', `/review-components/${CATEGORY}/enums`);
      const zeroBefore = findEnumValue(enumPayloadBefore, 'connection', 'ZeroCand');
      assert.ok(zeroBefore, 'enum value ZeroCand should exist');
      assert.equal(Array.isArray(zeroBefore?.candidates), true);
      assert.equal(zeroBefore?.candidates?.length || 0, 0);
      assert.equal(Boolean(zeroBefore?.needs_review), true);

      await apiJson(baseUrl, 'POST', `/review-components/${CATEGORY}/enum-override`, {
        field: 'connection',
        value: 'ZeroCand',
        action: 'confirm',
      });
      const zeroAfterState = db.getKeyReviewState({
        category: CATEGORY,
        targetKind: 'enum_key',
        fieldKey: 'connection',
        enumValueNorm: 'zerocand',
      });
      assert.equal(zeroAfterState?.ai_confirm_shared_status, 'confirmed');
      assert.equal(zeroAfterState?.user_accept_shared_status, null);

      const enumPayloadAfter = await apiJson(baseUrl, 'GET', `/review-components/${CATEGORY}/enums`);
      const zeroAfter = findEnumValue(enumPayloadAfter, 'connection', 'ZeroCand');
      assert.ok(zeroAfter, 'enum value ZeroCand should still exist');
      assert.equal(Boolean(zeroAfter?.needs_review), false);
    });
  } catch (err) {
    throw new Error(`${err.message}\nserver_logs:\n${logs.join('')}`);
  } finally {
    await stopProcess(child);
    try { db?.close?.(); } catch { /* best-effort */ }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
