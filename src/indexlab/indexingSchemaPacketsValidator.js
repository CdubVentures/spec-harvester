import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const SCHEMA_FILES = {
  source_packet: '12-source-indexing-extraction-schema.v1.json',
  item_packet: '13-item-indexing-extraction-schema.v1.json',
  run_meta_packet: '14-run-meta-schema.v1.json'
};

const validatorCache = new Map();

function normalizeSchemaRoot(schemaRoot = '') {
  const token = String(schemaRoot || '').trim();
  if (token) return path.resolve(token);
  return path.resolve(process.cwd(), 'implementation', 'ai-indexing-plans', 'parsing-managament');
}

function schemaErrorToText(error = {}) {
  const pathToken = String(error.instancePath || '').trim() || '$';
  const message = String(error.message || 'schema validation error').trim();
  const keyword = String(error.keyword || '').trim();
  return keyword ? `${pathToken}: ${message} (${keyword})` : `${pathToken}: ${message}`;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function compileValidators(schemaRoot) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false
  });
  addFormats(ajv);

  const loaded = {};
  for (const [key, fileName] of Object.entries(SCHEMA_FILES)) {
    const schemaPath = path.join(schemaRoot, fileName);
    loaded[key] = await readJson(schemaPath);
  }

  return {
    schema_root: schemaRoot,
    validate_source_packet: ajv.compile(loaded.source_packet),
    validate_item_packet: ajv.compile(loaded.item_packet),
    validate_run_meta_packet: ajv.compile(loaded.run_meta_packet)
  };
}

async function getValidators(schemaRoot = '') {
  const resolvedRoot = normalizeSchemaRoot(schemaRoot);
  const cacheKey = resolvedRoot.toLowerCase();
  if (!validatorCache.has(cacheKey)) {
    validatorCache.set(cacheKey, compileValidators(resolvedRoot));
  }
  return validatorCache.get(cacheKey);
}

function collectErrors(validateFn, packetType, packetIndex = null) {
  const rows = Array.isArray(validateFn?.errors) ? validateFn.errors : [];
  return rows.map((error) => ({
    packet_type: packetType,
    packet_index: packetIndex,
    message: schemaErrorToText(error)
  }));
}

export async function validateIndexingSchemaPackets({
  sourceCollection = null,
  itemPacket = null,
  runMetaPacket = null,
  schemaRoot = ''
} = {}) {
  const validators = await getValidators(schemaRoot);
  const errors = [];

  const sourcePackets = Array.isArray(sourceCollection?.packets)
    ? sourceCollection.packets
    : [];
  for (let i = 0; i < sourcePackets.length; i += 1) {
    const row = sourcePackets[i];
    const valid = Boolean(validators.validate_source_packet(row));
    if (!valid) {
      errors.push(...collectErrors(validators.validate_source_packet, 'source_packet', i));
    }
  }

  if (itemPacket !== null && itemPacket !== undefined) {
    const valid = Boolean(validators.validate_item_packet(itemPacket));
    if (!valid) {
      errors.push(...collectErrors(validators.validate_item_packet, 'item_packet', null));
    }
  } else {
    errors.push({
      packet_type: 'item_packet',
      packet_index: null,
      message: '$: item packet missing (required)'
    });
  }

  if (runMetaPacket !== null && runMetaPacket !== undefined) {
    const valid = Boolean(validators.validate_run_meta_packet(runMetaPacket));
    if (!valid) {
      errors.push(...collectErrors(validators.validate_run_meta_packet, 'run_meta_packet', null));
    }
  } else {
    errors.push({
      packet_type: 'run_meta_packet',
      packet_index: null,
      message: '$: run meta packet missing (required)'
    });
  }

  return {
    valid: errors.length === 0,
    schema_root: validators.schema_root,
    source_packet_count: sourcePackets.length,
    error_count: errors.length,
    errors
  };
}
