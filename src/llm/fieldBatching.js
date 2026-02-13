import { INSTRUMENTED_FIELDS } from '../constants.js';

function normalizeField(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeDifficulty(value) {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'hard' || token === 'instrumented' || token === 'easy' || token === 'medium') {
    return token;
  }
  return 'medium';
}

const GROUP_ORDER = [
  'identity',
  'physical',
  'sensor_performance',
  'switch_buttons',
  'connectivity',
  'lab_measured',
  'features_ergonomics',
  'misc'
];

const GROUP_FIELDS = {
  identity: new Set(['brand', 'model', 'variant', 'base_model', 'sku', 'mpn', 'gtin']),
  physical: new Set(['weight', 'lngth', 'width', 'height', 'material', 'coating', 'cable_length', 'color', 'colors']),
  sensor_performance: new Set(['sensor', 'dpi', 'ips', 'acceleration', 'polling_rate', 'tracking_speed', 'lift']),
  switch_buttons: new Set(['switch', 'switch_type', 'switch_brand', 'click_force', 'side_buttons', 'middle_buttons', 'dpi_button', 'main_buttons']),
  connectivity: new Set(['connection', 'connectivity', 'bluetooth', 'wireless_charging', 'computer_side_connector', 'mouse_side_connector', 'cable_type']),
  lab_measured: new Set(['click_latency', 'sensor_latency', 'shift_latency', 'lift_off_distance'])
};

function fieldGroup(field) {
  const normalized = normalizeField(field);
  if (!normalized) {
    return 'misc';
  }
  for (const [group, fields] of Object.entries(GROUP_FIELDS)) {
    if (fields.has(normalized)) {
      return group;
    }
  }
  if (INSTRUMENTED_FIELDS.has(normalized)) {
    return 'lab_measured';
  }
  return 'features_ergonomics';
}

function getRuleDifficulty(field, fieldRules = {}) {
  const key = normalizeField(field);
  const fromMap = fieldRules?.[key];
  if (!fromMap || typeof fromMap !== 'object') {
    return INSTRUMENTED_FIELDS.has(key) ? 'instrumented' : 'medium';
  }
  return normalizeDifficulty(fromMap.difficulty);
}

function compareBatches(a, b) {
  const ai = GROUP_ORDER.indexOf(a.id);
  const bi = GROUP_ORDER.indexOf(b.id);
  if (ai !== bi) {
    return ai - bi;
  }
  if (b.fields.length !== a.fields.length) {
    return b.fields.length - a.fields.length;
  }
  return a.id.localeCompare(b.id);
}

export function buildFieldBatches({
  targetFields = [],
  fieldRules = {},
  maxBatches = 7
}) {
  const limit = Math.max(1, Number.parseInt(String(maxBatches || 7), 10) || 7);
  const seen = new Set();
  const grouped = new Map();

  for (const rawField of targetFields || []) {
    const field = normalizeField(rawField);
    if (!field || seen.has(field)) {
      continue;
    }
    seen.add(field);
    const group = fieldGroup(field);
    if (!grouped.has(group)) {
      grouped.set(group, {
        id: group,
        fields: [],
        difficulty: {
          easy: 0,
          medium: 0,
          hard: 0,
          instrumented: 0
        }
      });
    }
    const bucket = grouped.get(group);
    const difficulty = getRuleDifficulty(field, fieldRules);
    bucket.fields.push(field);
    bucket.difficulty[difficulty] += 1;
  }

  let batches = [...grouped.values()].sort(compareBatches);
  if (batches.length > limit) {
    const keep = batches.slice(0, limit - 1);
    const spill = batches.slice(limit - 1);
    const merged = {
      id: 'misc',
      fields: [],
      difficulty: {
        easy: 0,
        medium: 0,
        hard: 0,
        instrumented: 0
      }
    };
    for (const row of spill) {
      merged.fields.push(...row.fields);
      merged.difficulty.easy += row.difficulty.easy;
      merged.difficulty.medium += row.difficulty.medium;
      merged.difficulty.hard += row.difficulty.hard;
      merged.difficulty.instrumented += row.difficulty.instrumented;
    }
    batches = [...keep, merged].sort(compareBatches);
  }

  return batches;
}

export function resolveBatchModel({
  batch,
  config = {}
}) {
  const fastModel = String(config.llmModelFast || config.llmModelPlan || config.llmModelExtract || '').trim();
  const reasoningModel = String(config.llmModelReasoning || config.llmModelExtract || fastModel).trim();
  const difficulty = batch?.difficulty || {};
  const fields = Array.isArray(batch?.fields) ? batch.fields.map((field) => normalizeField(field)) : [];
  const requiresReasoning =
    Number(difficulty.instrumented || 0) > 0 ||
    Number(difficulty.hard || 0) > 0 ||
    fields.some((field) => INSTRUMENTED_FIELDS.has(field)) ||
    fields.some((field) => field.includes('latency')) ||
    String(batch?.id || '').toLowerCase() === 'lab_measured';

  if (requiresReasoning) {
    return {
      model: reasoningModel || fastModel,
      reasoningMode: true,
      routeRole: 'extract',
      reason: 'extract_reasoning_batch'
    };
  }

  return {
    model: fastModel || reasoningModel,
    reasoningMode: false,
    routeRole: 'plan',
    reason: 'extract_fast_batch'
  };
}

