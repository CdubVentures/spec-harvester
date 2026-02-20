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
        { candidate_id: 'collision_primary_candidate', value: '49', score: 0.71, host: 'collision.example', source_host: 'collision.example', source_method: 'llm', method: 'llm', source_tier: 3, tier: 3 },
        { candidate_id: 'weight-unk-candidate', value: 'unk', score: 0.1, host: 'unknown.example', source_host: 'unknown.example', source_method: 'llm', method: 'llm', source_tier: 3, tier: 3 },
      ],
      dpi: [
        { candidate_id: 'p1-dpi-1', value: '35000', score: 0.97, host: 'razer.com', source_host: 'razer.com', source_method: 'dom', method: 'dom', source_tier: 1, tier: 1 },
        { candidate_id: 'shared-candidate', value: '35000', score: 0.75, host: 'mirror.example', source_host: 'mirror.example', source_method: 'scrape', method: 'scrape', source_tier: 2, tier: 2 },
      ],
      sensor: [
        { candidate_id: 'p1-sensor-1', value: 'PAW3950', score: 0.98, host: 'razer.com', source_host: 'razer.com', source_method: 'dom', method: 'dom', source_tier: 1, tier: 1 },
        { candidate_id: 'global_sensor_candidate', value: 'PAW3950', score: 0.92, host: 'aggregate.example', source_host: 'aggregate.example', source_method: 'llm', method: 'llm', source_tier: 2, tier: 2 },
      ],
      connection: [
        { candidate_id: 'p1-conn-1', value: '2.4GHz', score: 0.98, host: 'razer.com', source_host: 'razer.com', source_method: 'dom', method: 'dom', source_tier: 1, tier: 1 },
        { candidate_id: 'p1-conn-2', value: 'Wireless', score: 0.65, host: 'forum.example', source_host: 'forum.example', source_method: 'llm', method: 'llm', source_tier: 3, tier: 3 },
        { candidate_id: 'global_connection_candidate', value: '2.4GHz', score: 0.9, host: 'aggregate.example', source_host: 'aggregate.example', source_method: 'llm', method: 'llm', source_tier: 2, tier: 2 },
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

async function apiRawJson(baseUrl, method, apiPath, body = undefined) {
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
  return {
    ok: res.ok,
    status: res.status,
    data,
  };
}

function findEnumValue(payload, field, value) {
  const fieldRow = (payload?.fields || []).find((entry) => String(entry?.field || '') === field);
  if (!fieldRow) return null;
  return (fieldRow.values || []).find((entry) => String(entry?.value || '') === value) || null;
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
      fieldKey: 'sensor',
      selectedValue: 'PAW3950',
      selectedCandidateId: 'global_sensor_candidate',
      confidenceScore: 0.98,
      aiConfirmSharedStatus: 'pending',
      userAcceptSharedStatus: null,
    });
    upsertStrictKeyReviewState(db, CATEGORY, {
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

    await t.test('component review GET does not mutate synthetic candidates on read', async () => {
      const reviewPath = path.join(config.helperFilesRoot, CATEGORY, '_suggestions', 'component_review.json');
      const reviewDoc = JSON.parse(await fs.readFile(reviewPath, 'utf8'));
      reviewDoc.items.push({
        review_id: 'rv-cmp-unknown-like',
        category: CATEGORY,
        component_type: 'sensor',
        field_key: 'sensor',
        raw_query: 'PAW3950',
        matched_component: 'PAW3950',
        match_type: 'exact',
        status: 'pending_ai',
        product_id: PRODUCT_A,
        created_at: '2026-02-18T00:00:04.000Z',
        product_attributes: { sku: 'unk', dpi_max: '35500' },
      });
      await fs.writeFile(reviewPath, `${JSON.stringify(reviewDoc, null, 2)}\n`, 'utf8');

      const syntheticBefore = db.db.prepare(
        `SELECT COUNT(*) AS c
         FROM candidates
         WHERE category = ? AND candidate_id LIKE 'pl-cr_%'`
      ).get(CATEGORY)?.c || 0;
      const assertionsBefore = db.db.prepare(
        `SELECT COUNT(*) AS c
         FROM source_assertions
         WHERE assertion_id LIKE 'pl-cr_%'`
      ).get()?.c || 0;
      const pipelineSourcesBefore = db.db.prepare(
        `SELECT COUNT(*) AS c
         FROM source_registry
         WHERE category = ? AND source_host = 'pipeline'`
      ).get(CATEGORY)?.c || 0;

      await apiJson(baseUrl, 'GET', `/review-components/${CATEGORY}/components?type=sensor`);

      const syntheticRowsAfter = db.db.prepare(
        `SELECT candidate_id, value
         FROM candidates
         WHERE category = ? AND candidate_id LIKE 'pl-cr_%'`
      ).all(CATEGORY);
      assert.equal(syntheticRowsAfter.length, syntheticBefore, 'component review GET must not insert synthetic candidates');
      assert.equal(
        syntheticRowsAfter.some((row) => String(row.value || '').trim().toLowerCase() === 'unk'),
        false,
      );

      const assertionsAfter = db.db.prepare(
        `SELECT COUNT(*) AS c
         FROM source_assertions
         WHERE assertion_id LIKE 'pl-cr_%'`
      ).get()?.c || 0;
      assert.equal(assertionsAfter, assertionsBefore, 'component review GET must not insert source assertions');

      const pipelineSourcesAfter = db.db.prepare(
        `SELECT COUNT(*) AS c
         FROM source_registry
         WHERE category = ? AND source_host = 'pipeline'`
      ).get(CATEGORY)?.c || 0;
      assert.equal(pipelineSourcesAfter, pipelineSourcesBefore, 'component review GET must not insert source registry rows');
    });

    await t.test('grid primary accept with candidate-id collision stays slot-scoped', async () => {
      const collisionCandidateId = 'collision_primary_candidate';
      db.db.prepare(
        `UPDATE key_review_state
         SET selected_candidate_id = ?,
             selected_value = '49',
             ai_confirm_primary_status = 'pending',
             ai_confirm_primary_confidence = NULL,
             ai_confirm_primary_at = NULL,
             ai_confirm_primary_error = NULL,
             user_accept_primary_status = NULL,
             updated_at = datetime('now')
         WHERE category = ?
           AND target_kind = 'grid_key'
           AND item_identifier = ?
           AND field_key = 'weight'`
      ).run(collisionCandidateId, CATEGORY, PRODUCT_A);
      db.db.prepare(
        `UPDATE key_review_state
         SET selected_candidate_id = ?,
             selected_value = '35000',
             ai_confirm_primary_status = 'pending',
             ai_confirm_primary_confidence = NULL,
             ai_confirm_primary_at = NULL,
             ai_confirm_primary_error = NULL,
             user_accept_primary_status = NULL,
             updated_at = datetime('now')
         WHERE category = ?
           AND target_kind = 'grid_key'
           AND item_identifier = ?
           AND field_key = 'dpi'`
      ).run(collisionCandidateId, CATEGORY, PRODUCT_A);

      const weightSlotId = getItemFieldStateId(db, CATEGORY, PRODUCT_A, 'weight');
      assert.ok(weightSlotId, 'weight item slot id should exist');
      await apiJson(baseUrl, 'POST', `/review/${CATEGORY}/key-review-accept`, {
        itemFieldStateId: weightSlotId,
        lane: 'primary',
        candidateId: collisionCandidateId,
      });

      const weightState = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'grid_key',
        itemIdentifier: PRODUCT_A,
        fieldKey: 'weight',
      });
      const dpiState = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'grid_key',
        itemIdentifier: PRODUCT_A,
        fieldKey: 'dpi',
      });
      assert.equal(weightState.user_accept_primary_status, 'accepted');
      assert.equal(dpiState.user_accept_primary_status, null);
      assert.equal(dpiState.ai_confirm_primary_status, 'pending');

      db.db.prepare(
        `UPDATE key_review_state
         SET selected_candidate_id = 'p1-weight-1',
             selected_value = '49',
             ai_confirm_primary_status = 'pending',
             ai_confirm_primary_confidence = NULL,
             ai_confirm_primary_at = NULL,
             ai_confirm_primary_error = NULL,
             user_accept_primary_status = NULL,
             updated_at = datetime('now')
         WHERE category = ?
           AND target_kind = 'grid_key'
           AND item_identifier = ?
           AND field_key = 'weight'`
      ).run(CATEGORY, PRODUCT_A);
      db.db.prepare(
        `UPDATE key_review_state
         SET selected_candidate_id = 'p1-dpi-1',
             selected_value = '35000',
             ai_confirm_primary_status = 'pending',
             ai_confirm_primary_confidence = NULL,
             ai_confirm_primary_at = NULL,
             ai_confirm_primary_error = NULL,
             user_accept_primary_status = NULL,
             updated_at = datetime('now')
         WHERE category = ?
           AND target_kind = 'grid_key'
           AND item_identifier = ?
           AND field_key = 'dpi'`
      ).run(CATEGORY, PRODUCT_A);
    });

    await t.test('component shared accept with candidate-id collision does not mutate enum slot state', async () => {
      const collisionCandidateId = 'collision_shared_candidate';
      db.db.prepare(
        `UPDATE key_review_state
         SET selected_candidate_id = ?,
             selected_value = '35000',
             ai_confirm_shared_status = 'pending',
             ai_confirm_shared_confidence = NULL,
             ai_confirm_shared_at = NULL,
             ai_confirm_shared_error = NULL,
             user_accept_shared_status = NULL,
             updated_at = datetime('now')
         WHERE category = ?
           AND target_kind = 'component_key'
           AND component_identifier = ?
           AND property_key = 'dpi_max'`
      ).run(collisionCandidateId, CATEGORY, componentIdentifier);
      db.db.prepare(
        `UPDATE key_review_state
         SET selected_candidate_id = ?,
             selected_value = '2.4GHz',
             ai_confirm_shared_status = 'pending',
             ai_confirm_shared_confidence = NULL,
             ai_confirm_shared_at = NULL,
             ai_confirm_shared_error = NULL,
             user_accept_shared_status = NULL,
             updated_at = datetime('now')
         WHERE category = ?
           AND target_kind = 'enum_key'
           AND field_key = 'connection'
           AND enum_value_norm = '2.4ghz'`
      ).run(collisionCandidateId, CATEGORY);

      const componentIdentityId = getComponentIdentityId(db, CATEGORY, 'sensor', 'PAW3950', 'PixArt');
      const componentValueId = getComponentValueId(db, CATEGORY, 'sensor', 'PAW3950', 'PixArt', 'dpi_max');
      assert.ok(componentIdentityId, 'component identity id should exist');
      assert.ok(componentValueId, 'component value slot id should exist');
      await apiJson(baseUrl, 'POST', `/review-components/${CATEGORY}/component-override`, {
        componentIdentityId,
        componentValueId,
        value: '35000',
        candidateId: collisionCandidateId,
        candidateSource: 'pipeline',
      });

      const componentState = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'component_key',
        fieldKey: 'dpi_max',
        componentIdentifier,
        propertyKey: 'dpi_max',
      });
      const enumState = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'enum_key',
        fieldKey: 'connection',
        enumValueNorm: '2.4ghz',
      });
      assert.equal(componentState.user_accept_shared_status, 'accepted');
      assert.equal(componentState.ai_confirm_shared_status, 'pending');
      assert.equal(enumState.user_accept_shared_status, null);
      assert.equal(enumState.ai_confirm_shared_status, 'pending');

      db.db.prepare(
        `UPDATE key_review_state
         SET selected_candidate_id = 'cmp_dpi_35000',
             selected_value = '35000',
             ai_confirm_shared_status = 'pending',
             ai_confirm_shared_confidence = NULL,
             ai_confirm_shared_at = NULL,
             ai_confirm_shared_error = NULL,
             user_accept_shared_status = NULL,
             updated_at = datetime('now')
         WHERE category = ?
           AND target_kind = 'component_key'
           AND component_identifier = ?
           AND property_key = 'dpi_max'`
      ).run(CATEGORY, componentIdentifier);
      db.db.prepare(
        `UPDATE key_review_state
         SET selected_candidate_id = 'global_connection_candidate',
             selected_value = '2.4GHz',
             ai_confirm_shared_status = 'pending',
             ai_confirm_shared_confidence = NULL,
             ai_confirm_shared_at = NULL,
             ai_confirm_shared_error = NULL,
             user_accept_shared_status = NULL,
             updated_at = datetime('now')
         WHERE category = ?
           AND target_kind = 'enum_key'
           AND field_key = 'connection'
           AND enum_value_norm = '2.4ghz'`
      ).run(CATEGORY);
    });

    await t.test('grid item confirm only confirms item lane', async () => {
      const weightSlotId = getItemFieldStateId(db, CATEGORY, PRODUCT_A, 'weight');
      assert.ok(weightSlotId, 'weight item slot id should exist');
      const weightCandidatesBefore = await apiJson(baseUrl, 'GET', `/review/${CATEGORY}/candidates/${PRODUCT_A}/weight`);
      const weightCandidateId = String(
        (weightCandidatesBefore.candidates || []).find((candidate) => String(candidate?.candidate_id || '').includes('p1-weight-1'))?.candidate_id || ''
      ).trim();
      assert.ok(weightCandidateId, 'expected exact candidate id for p1-weight-1');
      await apiJson(baseUrl, 'POST', `/review/${CATEGORY}/key-review-confirm`, {
        itemFieldStateId: weightSlotId,
        lane: 'primary',
        candidateId: weightCandidateId,
        candidateValue: '49',
        candidateConfidence: 0.95,
      });

      const state = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'grid_key',
        itemIdentifier: PRODUCT_A,
        fieldKey: 'weight',
      });
      // Candidate-scoped confirm: lane stays pending until all candidates are reviewed.
      assert.equal(state.ai_confirm_primary_status, 'pending');
      assert.equal(state.user_accept_primary_status, null);

      const payload = await apiJson(baseUrl, 'GET', `/review/${CATEGORY}/candidates/${PRODUCT_A}/weight`);
      assert.equal(payload.keyReview.primaryStatus, 'pending');
      assert.equal(payload.keyReview.userAcceptPrimary, null);
      const confirmedCandidate = (payload.candidates || []).find((c) => String(c?.candidate_id || '').includes('p1-weight-1'));
      assert.ok(confirmedCandidate, 'confirmed candidate should be present in payload');
      assert.equal(String(confirmedCandidate.primary_review_status || ''), 'accepted');
    });

    await t.test('grid item accept only accepts item lane', async () => {
      const dpiSlotId = getItemFieldStateId(db, CATEGORY, PRODUCT_A, 'dpi');
      assert.ok(dpiSlotId, 'dpi item slot id should exist');
      const dpiCandidatesBefore = await apiJson(baseUrl, 'GET', `/review/${CATEGORY}/candidates/${PRODUCT_A}/dpi`);
      const dpiCandidateId = String(
        (dpiCandidatesBefore.candidates || []).find((candidate) => String(candidate?.candidate_id || '').includes('p1-dpi-1'))?.candidate_id || ''
      ).trim();
      assert.ok(dpiCandidateId, 'expected exact candidate id for p1-dpi-1');
      await apiJson(baseUrl, 'POST', `/review/${CATEGORY}/key-review-accept`, {
        itemFieldStateId: dpiSlotId,
        lane: 'primary',
        candidateId: dpiCandidateId,
        candidateValue: '35000',
        candidateConfidence: 0.97,
      });

      const state = getStrictKeyReviewState(db, CATEGORY, {
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

    await t.test('grid candidates endpoint synthesizes selected candidate id when lane points to missing candidate row', async () => {
      db.db.prepare(
        `UPDATE key_review_state
         SET selected_candidate_id = 'ghost_weight_candidate',
             selected_value = '49',
             confidence_score = 0.95,
             updated_at = datetime('now')
         WHERE category = ?
           AND target_kind = 'grid_key'
           AND item_identifier = ?
           AND field_key = 'weight'`
      ).run(CATEGORY, PRODUCT_A);

      const payload = await apiJson(baseUrl, 'GET', `/review/${CATEGORY}/candidates/${PRODUCT_A}/weight`);
      assert.equal(payload.keyReview?.selectedCandidateId, 'ghost_weight_candidate');
      assert.equal(
        payload.candidates.some((candidate) => candidate.candidate_id === 'ghost_weight_candidate'),
        true,
      );
    });

    await t.test('grid shared confirm is context-local (no cross-context propagation)', async () => {
      const sensorSlotId = getItemFieldStateId(db, CATEGORY, PRODUCT_A, 'sensor');
      assert.ok(sensorSlotId, 'sensor item slot id should exist');
      await apiJson(baseUrl, 'POST', `/review/${CATEGORY}/key-review-confirm`, {
        itemFieldStateId: sensorSlotId,
        lane: 'shared',
        candidateId: 'global_sensor_candidate',
        candidateValue: 'PAW3950',
        candidateConfidence: 0.98,
      });

      const p1 = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'grid_key',
        itemIdentifier: PRODUCT_A,
        fieldKey: 'sensor',
      });
      const p2 = getStrictKeyReviewState(db, CATEGORY, {
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

      const componentState = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'component_key',
        fieldKey: 'dpi_max',
        componentIdentifier,
        propertyKey: 'dpi_max',
      });
      assert.equal(componentState.ai_confirm_shared_status, 'pending');
    });

    await t.test('grid shared accept is slot-scoped (no peer grid/enum mutation)', async () => {
      db.db.prepare(
        `UPDATE key_review_state
         SET selected_candidate_id = 'global_connection_candidate',
             selected_value = '2.4GHz',
             ai_confirm_shared_status = 'pending',
             ai_confirm_shared_confidence = NULL,
             ai_confirm_shared_at = NULL,
             ai_confirm_shared_error = NULL,
             user_accept_shared_status = NULL,
             updated_at = datetime('now')
         WHERE category = ?
           AND target_kind = 'grid_key'
           AND field_key = 'connection'
           AND item_identifier IN (?, ?)`
      ).run(CATEGORY, PRODUCT_A, PRODUCT_B);
      db.db.prepare(
        `UPDATE key_review_state
         SET selected_candidate_id = 'global_connection_candidate',
             selected_value = '2.4GHz',
             ai_confirm_shared_status = 'pending',
             ai_confirm_shared_confidence = NULL,
             ai_confirm_shared_at = NULL,
             ai_confirm_shared_error = NULL,
             user_accept_shared_status = NULL,
             updated_at = datetime('now')
         WHERE category = ?
           AND target_kind = 'enum_key'
           AND field_key = 'connection'
           AND enum_value_norm = '2.4ghz'`
      ).run(CATEGORY);
      const enumPayloadBefore = await apiJson(baseUrl, 'GET', `/review-components/${CATEGORY}/enums`);
      const enumValueBefore = findEnumValue(enumPayloadBefore, 'connection', '2.4GHz');
      const enumAcceptedBefore = enumValueBefore?.accepted_candidate_id ?? null;

      const connectionSlotId = getItemFieldStateId(db, CATEGORY, PRODUCT_A, 'connection');
      assert.ok(connectionSlotId, 'connection item slot id should exist');
      await apiJson(baseUrl, 'POST', `/review/${CATEGORY}/key-review-accept`, {
        itemFieldStateId: connectionSlotId,
        lane: 'shared',
        candidateId: 'global_connection_candidate',
        candidateValue: '2.4GHz',
        candidateConfidence: 0.98,
      });

      const p1 = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'grid_key',
        itemIdentifier: PRODUCT_A,
        fieldKey: 'connection',
      });
      const p2 = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'grid_key',
        itemIdentifier: PRODUCT_B,
        fieldKey: 'connection',
      });
      const enumState = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'enum_key',
        fieldKey: 'connection',
        enumValueNorm: '2.4ghz',
      });
      assert.equal(p1.user_accept_shared_status, 'accepted');
      assert.equal(p2.user_accept_shared_status, null);
      assert.equal(p1.ai_confirm_shared_status, 'pending');
      assert.equal(enumState.user_accept_shared_status, null);
      assert.equal(enumState.ai_confirm_shared_status, 'pending');

      const connectionA = await apiJson(baseUrl, 'GET', `/review/${CATEGORY}/candidates/${PRODUCT_A}/connection`);
      const connectionB = await apiJson(baseUrl, 'GET', `/review/${CATEGORY}/candidates/${PRODUCT_B}/connection`);
      assert.equal(connectionA.keyReview.userAcceptShared, 'accepted');
      assert.equal(connectionB.keyReview.userAcceptShared, null);

      const enumPayload = await apiJson(baseUrl, 'GET', `/review-components/${CATEGORY}/enums`);
      const value = findEnumValue(enumPayload, 'connection', '2.4GHz');
      assert.ok(value, 'connection value 2.4GHz should exist in enum payload');
      assert.equal(value.accepted_candidate_id ?? null, enumAcceptedBefore);
    });

    await t.test('grid lane endpoints reject non-grid key_review_state ids', async () => {
      const componentStateId = db.db.prepare(
        `SELECT id
         FROM key_review_state
         WHERE category = ?
           AND target_kind = 'component_key'
         LIMIT 1`
      ).get(CATEGORY)?.id;
      const enumStateId = db.db.prepare(
        `SELECT id
         FROM key_review_state
         WHERE category = ?
           AND target_kind = 'enum_key'
         LIMIT 1`
      ).get(CATEGORY)?.id;
      assert.ok(componentStateId, 'component key review state id should exist');
      assert.ok(enumStateId, 'enum key review state id should exist');

      const componentAccept = await apiRawJson(baseUrl, 'POST', `/review/${CATEGORY}/key-review-accept`, {
        id: componentStateId,
        lane: 'shared',
      });
      assert.equal(componentAccept.status, 400);
      assert.equal(componentAccept.data?.error, 'lane_context_mismatch');

      const enumConfirm = await apiRawJson(baseUrl, 'POST', `/review/${CATEGORY}/key-review-confirm`, {
        id: enumStateId,
        lane: 'shared',
      });
      assert.equal(enumConfirm.status, 400);
      assert.equal(enumConfirm.data?.error, 'lane_context_mismatch');
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

      const componentIdentityId = getComponentIdentityId(db, CATEGORY, 'sensor', 'PAW3950', 'PixArt');
      const componentValueId = getComponentValueId(db, CATEGORY, 'sensor', 'PAW3950', 'PixArt', 'dpi_max');
      assert.ok(componentIdentityId, 'component identity id should exist');
      assert.ok(componentValueId, 'component value slot id should exist');
      await apiJson(baseUrl, 'POST', `/review-components/${CATEGORY}/component-override`, {
        componentIdentityId,
        componentValueId,
        value: '35000',
        candidateId: 'cmp_dpi_35000',
        candidateSource: 'pipeline',
      });

      const afterAccept = getStrictKeyReviewState(db, CATEGORY, {
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
      assert.equal(Boolean(componentRowAfterAccept?.properties?.dpi_max?.needs_review), true);
      const dpiCandidatesAfterAccept = componentRowAfterAccept?.properties?.dpi_max?.candidates || [];
      const acceptedDpiCandidateAfterAccept = dpiCandidatesAfterAccept.find(
        (candidate) => String(candidate?.candidate_id || '').trim() === 'cmp_dpi_35000'
      );
      assert.ok(acceptedDpiCandidateAfterAccept, 'accepted candidate should remain present after component accept');
      assert.equal(
        String(acceptedDpiCandidateAfterAccept?.shared_review_status || '').trim().toLowerCase(),
        'pending',
        'component accept must not auto-resolve AI confirm status for the candidate'
      );

      await apiJson(baseUrl, 'POST', `/review-components/${CATEGORY}/component-key-review-confirm`, {
        componentIdentityId,
        componentValueId,
        candidateId: 'cmp_dpi_35000',
        candidateValue: '35000',
        candidateConfidence: 0.9,
      });

      const afterConfirm = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'component_key',
        fieldKey: 'dpi_max',
        componentIdentifier,
        propertyKey: 'dpi_max',
      });
      assert.equal(afterConfirm.ai_confirm_shared_status, 'pending');
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
      assert.equal(Boolean(row?.properties?.dpi_max?.needs_review), true);
      const dpiCandidates = row?.properties?.dpi_max?.candidates || [];
      const acceptedDpiCandidateAfterConfirm = dpiCandidates.find(
        (candidate) => String(candidate?.candidate_id || '').trim() === 'cmp_dpi_35000'
      );
      assert.equal(
        String(acceptedDpiCandidateAfterConfirm?.shared_review_status || '').trim().toLowerCase(),
        'accepted',
        'component confirm should resolve the confirmed candidate'
      );
      const stillPending = dpiCandidates.filter((candidate) => String(candidate?.shared_review_status || '').trim().toLowerCase() === 'pending');
      assert.equal(stillPending.length > 0, true);
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

      const componentIdentityId = getComponentIdentityId(db, CATEGORY, 'sensor', 'PAW3950', resolvedMaker);
      const componentValueId = getComponentValueId(db, CATEGORY, 'sensor', 'PAW3950', resolvedMaker, 'dpi_max');
      assert.ok(componentIdentityId, 'component identity id should exist');
      assert.ok(componentValueId, 'component value slot id should exist');
      await apiJson(baseUrl, 'POST', `/review-components/${CATEGORY}/component-override`, {
        componentIdentityId,
        componentValueId,
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

    await t.test('enum accept and confirm remain decoupled and confirm is candidate scoped', async () => {
      const enumSlot = getEnumSlotIds(db, CATEGORY, 'connection', '2.4GHz');
      assert.ok(enumSlot.listValueId, 'enum value slot id should exist');
      assert.ok(enumSlot.enumListId, 'enum list id should exist');
      await apiJson(baseUrl, 'POST', `/review-components/${CATEGORY}/enum-override`, {
        listValueId: enumSlot.listValueId,
        enumListId: enumSlot.enumListId,
        action: 'accept',
        candidateId: 'global_connection_candidate',
      });

      const afterAccept = getStrictKeyReviewState(db, CATEGORY, {
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
      assert.equal(enumValueAfterAccept.needs_review, true);
      const acceptedEnumCandidateAfterAccept = (enumValueAfterAccept.candidates || []).find(
        (candidate) => String(candidate?.candidate_id || '').trim() === 'global_connection_candidate'
      );
      assert.ok(acceptedEnumCandidateAfterAccept, 'accepted enum candidate should remain present after accept');
      assert.equal(
        String(acceptedEnumCandidateAfterAccept?.shared_review_status || '').trim().toLowerCase(),
        'pending',
        'enum accept must not auto-resolve AI confirm status for the candidate'
      );

      await apiJson(baseUrl, 'POST', `/review-components/${CATEGORY}/enum-override`, {
        listValueId: enumSlot.listValueId,
        enumListId: enumSlot.enumListId,
        action: 'confirm',
        candidateId: 'global_connection_candidate',
      });

      const afterConfirm = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'enum_key',
        fieldKey: 'connection',
        enumValueNorm: '2.4ghz',
      });
      assert.equal(afterConfirm.ai_confirm_shared_status, 'pending');
      assert.equal(afterConfirm.user_accept_shared_status, 'accepted');

      const reviewDoc = JSON.parse(
        await fs.readFile(path.join(config.helperFilesRoot, CATEGORY, '_suggestions', 'component_review.json'), 'utf8'),
      );
      const r24 = reviewDoc.items.find((item) => item.review_id === 'rv-enum-24');
      const rWireless = reviewDoc.items.find((item) => item.review_id === 'rv-enum-wireless');
      assert.equal(r24?.status, 'pending_ai');
      assert.equal(rWireless?.status, 'pending_ai');

      const gridA = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'grid_key',
        itemIdentifier: PRODUCT_A,
        fieldKey: 'connection',
      });
      const gridB = getStrictKeyReviewState(db, CATEGORY, {
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
      const confirmedEnumCandidate = (value.candidates || []).find(
        (candidate) => String(candidate?.candidate_id || '').trim() === 'global_connection_candidate'
      );
      assert.equal(
        String(confirmedEnumCandidate?.shared_review_status || '').trim().toLowerCase(),
        'accepted',
        'enum confirm should resolve the confirmed candidate'
      );
      assert.equal(value.needs_review, true);
    });

    await t.test('enum accept with oldValue renames and propagates to linked items', async () => {
      const enumSlot = getEnumSlotIds(db, CATEGORY, 'connection', '2.4GHz');
      assert.ok(enumSlot.listValueId, 'enum source value slot id should exist');
      assert.ok(enumSlot.enumListId, 'enum list id should exist');
      await apiJson(baseUrl, 'POST', `/review-components/${CATEGORY}/enum-override`, {
        listValueId: enumSlot.listValueId,
        enumListId: enumSlot.enumListId,
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

      const enumState = getStrictKeyReviewState(db, CATEGORY, {
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
      assert.equal(newValue.needs_review, true);
    });

    await t.test('confirm endpoints require candidate ids for pending lanes with zero candidates (grid/component/enum)', async () => {
      // Grid: remove all candidates for a pending primary lane and confirm without candidate id.
      db.db.prepare(
        `DELETE FROM candidate_reviews
         WHERE candidate_id IN (
           SELECT candidate_id
           FROM candidates
           WHERE category = ? AND product_id = ? AND field_key = ?
         )`
      ).run(CATEGORY, PRODUCT_A, 'weight');
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

      const weightSlotId = getItemFieldStateId(db, CATEGORY, PRODUCT_A, 'weight');
      assert.ok(weightSlotId, 'weight item slot id should exist');
      const gridConfirmNoCandidate = await apiRawJson(baseUrl, 'POST', `/review/${CATEGORY}/key-review-confirm`, {
        itemFieldStateId: weightSlotId,
        lane: 'primary',
      });
      assert.equal(gridConfirmNoCandidate.status, 400);
      assert.equal(gridConfirmNoCandidate.data?.error, 'candidate_id_required');
      const weightAfter = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'grid_key',
        itemIdentifier: PRODUCT_A,
        fieldKey: 'weight',
      });
      assert.equal(weightAfter?.ai_confirm_primary_status, 'pending');
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

      const componentPayloadBefore = await apiJson(baseUrl, 'GET', `/review-components/${CATEGORY}/components?type=sensor`);
      const componentRowBefore = (componentPayloadBefore.items || []).find((item) => item.name === 'PAW3950' && item.maker === 'PixArt');
      assert.ok(componentRowBefore, 'component row should exist');
      assert.equal(Array.isArray(componentRowBefore?.properties?.custom_prop?.candidates), true);
      assert.equal(componentRowBefore?.properties?.custom_prop?.candidates?.length || 0, 0);
      assert.equal(Boolean(componentRowBefore?.properties?.custom_prop?.needs_review), true);

      const componentConfirmNoCandidate = await apiRawJson(baseUrl, 'POST', `/review-components/${CATEGORY}/component-key-review-confirm`, {
        componentIdentityId: getComponentIdentityId(db, CATEGORY, 'sensor', 'PAW3950', 'PixArt'),
        componentValueId: getComponentValueId(db, CATEGORY, 'sensor', 'PAW3950', 'PixArt', 'custom_prop'),
        candidateValue: 'alpha',
      });
      assert.equal(componentConfirmNoCandidate.status, 400);
      assert.equal(componentConfirmNoCandidate.data?.error, 'candidate_id_required');
      const componentStateAfter = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'component_key',
        fieldKey: 'custom_prop',
        componentIdentifier,
        propertyKey: 'custom_prop',
      });
      assert.equal(componentStateAfter?.ai_confirm_shared_status, 'pending');
      assert.equal(componentStateAfter?.user_accept_shared_status, null);

      const componentPayloadAfter = await apiJson(baseUrl, 'GET', `/review-components/${CATEGORY}/components?type=sensor`);
      const componentRowAfter = (componentPayloadAfter.items || []).find((item) => item.name === 'PAW3950' && item.maker === 'PixArt');
      assert.equal(Boolean(componentRowAfter?.properties?.custom_prop?.needs_review), true);

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

      const enumPayloadBefore = await apiJson(baseUrl, 'GET', `/review-components/${CATEGORY}/enums`);
      const zeroBefore = findEnumValue(enumPayloadBefore, 'connection', 'ZeroCand');
      assert.ok(zeroBefore, 'enum value ZeroCand should exist');
      assert.equal(Array.isArray(zeroBefore?.candidates), true);
      assert.equal(zeroBefore?.candidates?.length || 0, 0);
      assert.equal(Boolean(zeroBefore?.needs_review), true);

      const zeroCandSlot = getEnumSlotIds(db, CATEGORY, 'connection', 'ZeroCand');
      assert.ok(zeroCandSlot.listValueId, 'ZeroCand enum slot id should exist');
      assert.ok(zeroCandSlot.enumListId, 'ZeroCand enum list id should exist');
      const enumConfirmNoCandidate = await apiRawJson(baseUrl, 'POST', `/review-components/${CATEGORY}/enum-override`, {
        listValueId: zeroCandSlot.listValueId,
        enumListId: zeroCandSlot.enumListId,
        action: 'confirm',
      });
      assert.equal(enumConfirmNoCandidate.status, 400);
      assert.equal(enumConfirmNoCandidate.data?.error, 'candidate_id_required');
      const zeroAfterState = getStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'enum_key',
        fieldKey: 'connection',
        enumValueNorm: 'zerocand',
      });
      assert.equal(zeroAfterState?.ai_confirm_shared_status, 'pending');
      assert.equal(zeroAfterState?.user_accept_shared_status, null);

      const enumPayloadAfter = await apiJson(baseUrl, 'GET', `/review-components/${CATEGORY}/enums`);
      const zeroAfter = findEnumValue(enumPayloadAfter, 'connection', 'ZeroCand');
      assert.ok(zeroAfter, 'enum value ZeroCand should still exist');
      assert.equal(Boolean(zeroAfter?.needs_review), true);
    });

    await t.test('unknown selected values cannot be accepted/confirmed across grid/component/enum lanes', async () => {
      db.db.prepare(`
        UPDATE key_review_state
        SET selected_candidate_id = NULL,
            selected_value = 'unk',
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

      const weightSlotId = getItemFieldStateId(db, CATEGORY, PRODUCT_A, 'weight');
      assert.ok(weightSlotId, 'weight item slot id should exist');
      const gridConfirmUnknown = await apiRawJson(baseUrl, 'POST', `/review/${CATEGORY}/key-review-confirm`, {
        itemFieldStateId: weightSlotId,
        lane: 'primary',
      });
      assert.equal(gridConfirmUnknown.status, 400);
      assert.equal(gridConfirmUnknown.data?.error, 'candidate_id_required');

      const gridAcceptUnknown = await apiRawJson(baseUrl, 'POST', `/review/${CATEGORY}/key-review-accept`, {
        itemFieldStateId: weightSlotId,
        lane: 'primary',
      });
      assert.equal(gridAcceptUnknown.status, 400);
      assert.equal(gridAcceptUnknown.data?.error, 'candidate_id_required');

      const componentIdentityId = getComponentIdentityId(db, CATEGORY, 'sensor', 'PAW3950', 'PixArt');
      const dpiMaxSlotId = getComponentValueId(db, CATEGORY, 'sensor', 'PAW3950', 'PixArt', 'dpi_max');
      assert.ok(componentIdentityId, 'component identity id should exist');
      assert.ok(dpiMaxSlotId, 'dpi_max slot id should exist');
      const componentUnknownAccept = await apiRawJson(baseUrl, 'POST', `/review-components/${CATEGORY}/component-override`, {
        componentIdentityId,
        componentValueId: dpiMaxSlotId,
        value: 'unk',
        candidateId: 'cmp_dpi_unknown',
        candidateSource: 'pipeline',
      });
      assert.equal(componentUnknownAccept.status, 400);
      assert.equal(componentUnknownAccept.data?.error, 'unknown_value_not_actionable');

      db.upsertComponentValue({
        componentType: 'sensor',
        componentName: 'PAW3950',
        componentMaker: 'PixArt',
        propertyKey: 'unk_only_prop',
        value: 'unk',
        confidence: 0.4,
        variancePolicy: null,
        source: 'pipeline',
        acceptedCandidateId: null,
        needsReview: true,
        overridden: false,
        constraints: [],
      });
      upsertStrictKeyReviewState(db, CATEGORY, {
        category: CATEGORY,
        targetKind: 'component_key',
        fieldKey: 'unk_only_prop',
        componentIdentifier,
        propertyKey: 'unk_only_prop',
        selectedValue: 'unk',
        selectedCandidateId: null,
        confidenceScore: 0.4,
        aiConfirmSharedStatus: 'pending',
        userAcceptSharedStatus: null,
      });

      const unkOnlySlotId = getComponentValueId(db, CATEGORY, 'sensor', 'PAW3950', 'PixArt', 'unk_only_prop');
      assert.ok(unkOnlySlotId, 'unk_only_prop slot id should exist');
      const componentConfirmUnknown = await apiRawJson(baseUrl, 'POST', `/review-components/${CATEGORY}/component-key-review-confirm`, {
        componentIdentityId,
        componentValueId: unkOnlySlotId,
      });
      assert.equal(componentConfirmUnknown.status, 400);
      assert.equal(componentConfirmUnknown.data?.error, 'candidate_id_required');

      db.upsertListValue({
        fieldKey: 'connection',
        value: 'unk',
        normalizedValue: 'unk',
        source: 'pipeline',
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
        enumValueNorm: 'unk',
        selectedValue: 'unk',
        selectedCandidateId: null,
        confidenceScore: 0.2,
        aiConfirmSharedStatus: 'pending',
        userAcceptSharedStatus: null,
      });
      const unkEnumSlot = getEnumSlotIds(db, CATEGORY, 'connection', 'unk');
      assert.ok(unkEnumSlot.listValueId, 'unk enum value slot id should exist');
      assert.ok(unkEnumSlot.enumListId, 'unk enum list id should exist');
      const enumConfirmUnknown = await apiRawJson(baseUrl, 'POST', `/review-components/${CATEGORY}/enum-override`, {
        listValueId: unkEnumSlot.listValueId,
        enumListId: unkEnumSlot.enumListId,
        action: 'confirm',
        candidateId: 'global_connection_candidate',
      });
      assert.equal(enumConfirmUnknown.status, 400);
      assert.equal(enumConfirmUnknown.data?.error, 'unknown_value_not_actionable');

      const enumAcceptUnknown = await apiRawJson(baseUrl, 'POST', `/review-components/${CATEGORY}/enum-override`, {
        listValueId: unkEnumSlot.listValueId,
        enumListId: unkEnumSlot.enumListId,
        action: 'accept',
        candidateId: 'global_connection_candidate',
      });
      assert.equal(enumAcceptUnknown.status, 400);
      assert.equal(enumAcceptUnknown.data?.error, 'unknown_value_not_actionable');
    });
  } catch (err) {
    throw new Error(`${err.message}\nserver_logs:\n${logs.join('')}`);
  } finally {
    await stopProcess(child);
    try { db?.close?.(); } catch { /* best-effort */ }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

