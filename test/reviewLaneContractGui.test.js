import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { createStorage } from '../src/s3/storage.js';
import { SpecDb } from '../src/db/specDb.js';
import { seedSpecDb } from '../src/db/seed.js';
import { buildComponentIdentifier } from '../src/utils/componentIdentifier.js';

const CATEGORY = 'mouse_contract_lane_matrix_gui';
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

function replaceCandidateRow(db, {
  candidateId,
  category,
  productId,
  fieldKey,
  value,
  score = 0.9,
  isComponentField = false,
  isListField = false,
  componentType = null,
}) {
  db.db.prepare('DELETE FROM candidate_reviews WHERE candidate_id = ?').run(candidateId);
  db.db.prepare('DELETE FROM candidates WHERE candidate_id = ?').run(candidateId);
  db.insertCandidate({
    candidate_id: candidateId,
    category,
    product_id: productId,
    field_key: fieldKey,
    value,
    normalized_value: String(value ?? '').trim().toLowerCase(),
    score,
    rank: 1,
    source_host: 'contract.test',
    source_root_domain: 'contract.test',
    source_method: 'llm',
    source_tier: 2,
    approved_domain: false,
    snippet_text: 'contract lane test candidate',
    quote: 'contract lane test candidate',
    evidence_url: 'https://contract.test',
    evidence_retrieved_at: new Date().toISOString(),
    is_component_field: isComponentField,
    component_type: componentType,
    is_list_field: isListField,
    extracted_at: new Date().toISOString(),
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

async function waitForServerReady(baseUrl, child, timeoutMs = 30_000) {
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
    await new Promise((resolve) => setTimeout(resolve, 200));
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

function getItemFieldStateId(db, category, productId, fieldKey) {
  const row = db.db.prepare(
    `SELECT id
     FROM item_field_state
     WHERE category = ? AND product_id = ? AND field_key = ?
     LIMIT 1`
  ).get(category, productId, fieldKey);
  return row?.id ?? null;
}

function getComponentIdentityId(db, category, componentType, name, maker = '') {
  const row = db.db.prepare(
    `SELECT id
     FROM component_identity
     WHERE category = ? AND component_type = ? AND canonical_name = ? AND maker = ?
     LIMIT 1`
  ).get(category, componentType, name, maker);
  return row?.id ?? null;
}

function getComponentValueId(db, category, componentType, name, maker = '', propertyKey) {
  const row = db.db.prepare(
    `SELECT id
     FROM component_values
     WHERE category = ?
       AND component_type = ?
       AND component_name = ?
       AND component_maker = ?
       AND property_key = ?
     LIMIT 1`
  ).get(category, componentType, name, maker, propertyKey);
  return row?.id ?? null;
}

function getEnumSlotIds(db, category, fieldKey, value) {
  const row = db.db.prepare(
    `SELECT id, list_id
     FROM list_values
     WHERE category = ? AND field_key = ? AND value = ?
     LIMIT 1`
  ).get(category, fieldKey, value);
  return {
    listValueId: row?.id ?? null,
    enumListId: row?.list_id ?? null,
  };
}

function parseComponentIdentifier(componentIdentifier) {
  const parts = String(componentIdentifier || '').split('::');
  if (parts.length < 2) return null;
  const componentType = String(parts.shift() || '').trim();
  const componentMaker = String(parts.pop() || '').trim();
  const componentName = String(parts.join('::') || '').trim();
  if (!componentType || !componentName) return null;
  return { componentType, componentName, componentMaker };
}

function resolveStrictKeyReviewSlotIds(db, category, row = {}) {
  const resolved = { ...row };
  const targetKind = String(resolved.targetKind || resolved.target_kind || '').trim();
  const fieldKey = String(resolved.fieldKey || resolved.field_key || '').trim();

  if (targetKind === 'grid_key') {
    resolved.itemFieldStateId = resolved.itemFieldStateId
      ?? resolved.item_field_state_id
      ?? getItemFieldStateId(db, category, resolved.itemIdentifier || resolved.item_identifier, fieldKey);
    return resolved;
  }

  if (targetKind === 'enum_key') {
    let listValueId = resolved.listValueId ?? resolved.list_value_id ?? null;
    let enumListId = resolved.enumListId ?? resolved.enum_list_id ?? null;
    if (!listValueId && fieldKey) {
      const selectedValue = String(resolved.selectedValue ?? resolved.selected_value ?? '').trim();
      if (selectedValue) {
        const slot = getEnumSlotIds(db, category, fieldKey, selectedValue);
        listValueId = slot.listValueId;
        enumListId = slot.enumListId;
      }
      if (!listValueId) {
        const enumNorm = String(resolved.enumValueNorm ?? resolved.enum_value_norm ?? '').trim().toLowerCase();
        if (enumNorm) {
          const rowByNorm = db.db.prepare(
            `SELECT id, list_id
             FROM list_values
             WHERE category = ? AND field_key = ? AND normalized_value = ?
             LIMIT 1`
          ).get(category, fieldKey, enumNorm);
          listValueId = rowByNorm?.id ?? null;
          enumListId = rowByNorm?.list_id ?? enumListId;
        }
      }
    }
    resolved.listValueId = listValueId;
    resolved.enumListId = enumListId;
    return resolved;
  }

  if (targetKind === 'component_key') {
    const propertyKey = String(resolved.propertyKey || resolved.property_key || '').trim();
    const isIdentityProperty = ['__name', '__maker', '__links', '__aliases'].includes(propertyKey);
    const parsed = parseComponentIdentifier(resolved.componentIdentifier || resolved.component_identifier);
    if (isIdentityProperty) {
      resolved.componentIdentityId = resolved.componentIdentityId
        ?? resolved.component_identity_id
        ?? (parsed ? getComponentIdentityId(db, category, parsed.componentType, parsed.componentName, parsed.componentMaker) : null);
      return resolved;
    }
    resolved.componentValueId = resolved.componentValueId
      ?? resolved.component_value_id
      ?? (parsed ? getComponentValueId(db, category, parsed.componentType, parsed.componentName, parsed.componentMaker, propertyKey) : null);
    return resolved;
  }

  return resolved;
}

function upsertStrictKeyReviewState(db, category, row) {
  return db.upsertKeyReviewState(resolveStrictKeyReviewSlotIds(db, category, row));
}

function getStrictKeyReviewState(db, category, row) {
  return db.getKeyReviewState(resolveStrictKeyReviewSlotIds(db, category, row));
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
    await page.waitForSelector('text=Connection', { timeout: 20_000 });
    await page.getByRole('button', { name: /Connection/ }).first().click();
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

