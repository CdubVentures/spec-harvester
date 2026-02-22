import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { createStorage } from '../../src/s3/storage.js';

export const PRODUCT_A = 'mouse-razer-viper-v3-pro';
export const PRODUCT_B = 'mouse-pulsar-x2-v3';

export const FIELD_RULES_FIELDS = {
  weight: { required_level: 'required', contract: { type: 'number', unit: 'g', shape: 'scalar', range: { min: 20, max: 300 } }, variance_policy: null, constraints: [] },
  dpi: { required_level: 'required', contract: { type: 'integer', unit: 'dpi', shape: 'scalar', range: { min: 50, max: 100000 } }, variance_policy: 'upper_bound', constraints: [] },
  sensor: { required_level: 'required', contract: { type: 'string', shape: 'scalar' }, component: { type: 'sensor', source: 'component_db.sensor' }, variance_policy: null, constraints: [] },
  connection: { required_level: 'required', contract: { type: 'string', shape: 'scalar' }, enum: { policy: 'closed' }, enum_name: 'connection', variance_policy: null, constraints: [] },
  dpi_max: { required_level: 'expected', contract: { type: 'number', unit: 'dpi', shape: 'scalar' }, variance_policy: 'upper_bound', constraints: [] },
  ips: { required_level: 'expected', contract: { type: 'number', unit: 'ips', shape: 'scalar' }, variance_policy: 'upper_bound', constraints: [] },
  acceleration: { required_level: 'expected', contract: { type: 'number', unit: 'g', shape: 'scalar' }, variance_policy: 'upper_bound', constraints: [] },
};

export const SENSOR_ITEMS = [
  {
    name: 'PAW3950',
    maker: 'PixArt',
    aliases: ['3950', 'PixArt 3950'],
    links: ['https://pixart.com/paw3950'],
    properties: { dpi_max: '35000', ips: '750', acceleration: '50' },
  },
];

export const KNOWN_VALUE_ENUMS = {
  connection: { policy: 'closed', values: ['2.4GHz', 'Wireless', 'Wired'] },
};

export function makeStorage(tempRoot) {
  return createStorage({
    localMode: true,
    localInputRoot: path.join(tempRoot, 'fixtures'),
    localOutputRoot: path.join(tempRoot, 'out'),
    s3InputPrefix: 'specs/inputs',
    s3OutputPrefix: 'specs/outputs',
  });
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function seedFieldRules(helperRoot, category) {
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

export async function seedComponentDb(helperRoot, category) {
  await writeJson(path.join(helperRoot, category, '_generated', 'component_db', 'sensor.json'), {
    component_type: 'sensor',
    items: SENSOR_ITEMS,
  });
}

export async function seedKnownValues(helperRoot, category) {
  await writeJson(path.join(helperRoot, category, '_generated', 'known_values.json'), {
    category,
    fields: {
      connection: KNOWN_VALUE_ENUMS.connection.values,
    },
  });
}

export async function seedWorkbookMap(helperRoot, category) {
  await writeJson(path.join(helperRoot, category, '_control_plane', 'workbook_map.json'), {
    manual_enum_values: {},
    manual_enum_timestamps: {},
  });
}

export async function seedLatestArtifacts(storage, category, productId, product) {
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

export function buildFieldRulesForSeed() {
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

export function replaceCandidateRow(db, {
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

export function findFreePort() {
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

export async function waitForServerReady(baseUrl, child, timeoutMs = 20_000) {
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

export async function apiJson(baseUrl, method, apiPath, body = undefined) {
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

export async function apiRawJson(baseUrl, method, apiPath, body = undefined) {
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

export function findEnumValue(payload, field, value) {
  const fieldRow = (payload?.fields || []).find((entry) => String(entry?.field || '') === field);
  if (!fieldRow) return null;
  return (fieldRow.values || []).find((entry) => String(entry?.value || '') === value) || null;
}

export function getItemFieldStateId(db, category, productId, fieldKey) {
  const row = db.db.prepare(
    `SELECT id
     FROM item_field_state
     WHERE category = ? AND product_id = ? AND field_key = ?
     LIMIT 1`
  ).get(category, productId, fieldKey);
  return row?.id ?? null;
}

export function getComponentIdentityId(db, category, componentType, name, maker = '') {
  const row = db.db.prepare(
    `SELECT id
     FROM component_identity
     WHERE category = ? AND component_type = ? AND canonical_name = ? AND maker = ?
     LIMIT 1`
  ).get(category, componentType, name, maker);
  return row?.id ?? null;
}

export function getComponentValueId(db, category, componentType, name, maker = '', propertyKey) {
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

export function getEnumSlotIds(db, category, fieldKey, value) {
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

export function parseComponentIdentifier(componentIdentifier) {
  const parts = String(componentIdentifier || '').split('::');
  if (parts.length < 2) return null;
  const componentType = String(parts.shift() || '').trim();
  const componentMaker = String(parts.pop() || '').trim();
  const componentName = String(parts.join('::') || '').trim();
  if (!componentType || !componentName) return null;
  return { componentType, componentName, componentMaker };
}

export function resolveStrictKeyReviewSlotIds(db, category, row = {}) {
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

export function upsertStrictKeyReviewState(db, category, row) {
  return db.upsertKeyReviewState(resolveStrictKeyReviewSlotIds(db, category, row));
}

export function getStrictKeyReviewState(db, category, row) {
  return db.getKeyReviewState(resolveStrictKeyReviewSlotIds(db, category, row));
}

export async function stopProcess(child) {
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
