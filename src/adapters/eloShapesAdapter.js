import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { extractTablePairs, mapPairsToFieldCandidates, extractIdentityFromPairs } from './tableParsing.js';
import { gzipBuffer, normalizeWhitespace } from '../utils/common.js';
import { toPosixKey } from '../s3/storage.js';

function hostMatches(source) {
  return source.host === 'eloshapes.com' || source.host.endsWith('.eloshapes.com');
}

function runCommand(command, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let done = false;

    const timer = setTimeout(() => {
      if (done) {
        return;
      }
      done = true;
      child.kill('SIGKILL');
      reject(new Error(`Command timeout: ${command} ${args.join(' ')}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Command failed (${code}): ${stderr || stdout}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function redactSecret(value, secret) {
  if (!secret) {
    return value;
  }
  return String(value || '').split(secret).join('[redacted]');
}

export function sanitizeEloErrorMessage(message, config) {
  return redactSecret(message, config.eloSupabaseAnonKey || '');
}

function flattenObject(value, prefix = '', out = []) {
  if (value === null || value === undefined) {
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenObject(item, `${prefix}[${index}]`, out));
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${key}` : key;
      flattenObject(inner, next, out);
    }
    return out;
  }
  out.push({ path: prefix, value });
  return out;
}

function mapRowsToCandidates(rows) {
  const fieldCandidates = [];
  const identityCandidates = {};

  const aliasMap = [
    { regex: /brand|manufacturer/i, field: 'brand', identity: true },
    { regex: /model|name/i, field: 'model', identity: true },
    { regex: /sku|part/i, field: 'sku', identity: true },
    { regex: /weight/i, field: 'weight' },
    { regex: /length/i, field: 'lngth' },
    { regex: /width/i, field: 'width' },
    { regex: /height/i, field: 'height' },
    { regex: /sensor\.?brand/i, field: 'sensor_brand' },
    { regex: /sensor/i, field: 'sensor' },
    { regex: /polling/i, field: 'polling_rate' },
    { regex: /dpi/i, field: 'dpi' },
    { regex: /ips/i, field: 'ips' },
    { regex: /acceleration/i, field: 'acceleration' },
    { regex: /switch\.?brand/i, field: 'switch_brand' },
    { regex: /switch/i, field: 'switch' },
    { regex: /side\.?buttons/i, field: 'side_buttons' },
    { regex: /middle\.?buttons/i, field: 'middle_buttons' }
  ];

  for (const row of rows || []) {
    const flattened = flattenObject(row);
    for (const entry of flattened) {
      const key = entry.path;
      const value = normalizeWhitespace(entry.value);
      if (!value) {
        continue;
      }

      const mapping = aliasMap.find((item) => item.regex.test(key));
      if (!mapping) {
        continue;
      }

      if (mapping.identity) {
        identityCandidates[mapping.field] = value;
      } else {
        fieldCandidates.push({
          field: mapping.field,
          value,
          method: 'adapter_api',
          keyPath: `eloshapes.${key}`
        });
      }
    }
  }

  return { fieldCandidates, identityCandidates };
}

export const eloShapesAdapter = {
  name: 'eloshapes',

  seedUrls({ job }) {
    const query = encodeURIComponent(
      [job.identityLock?.brand || '', job.identityLock?.model || '', job.identityLock?.variant || '']
        .join(' ')
        .trim()
    );
    if (!query) {
      return [];
    }
    return [`https://eloshapes.com/search?q=${query}`];
  },

  supportsHost({ source }) {
    return hostMatches(source);
  },

  async extractFromPage({ pageData }) {
    const pairs = extractTablePairs(pageData.html || '');
    return {
      fieldCandidates: mapPairsToFieldCandidates(pairs, 'html_table'),
      identityCandidates: extractIdentityFromPairs(pairs),
      additionalUrls: [],
      pdfDocs: []
    };
  },

  async runDedicatedFetch({ config, job, runId, storage }) {
    if (!config.eloSupabaseAnonKey || !config.eloSupabaseEndpoint) {
      return null;
    }

    const outPath = path.join(os.tmpdir(), `eloshapes-${runId}.json`);
    const scriptPath = path.resolve('scripts', 'eloshapes_fetch.py');

    try {
      await runCommand('python', [
        scriptPath,
        '--endpoint',
        config.eloSupabaseEndpoint,
        '--anon-key',
        config.eloSupabaseAnonKey,
        '--brand',
        job.identityLock?.brand || '',
        '--model',
        job.identityLock?.model || '',
        '--variant',
        job.identityLock?.variant || '',
        '--out',
        outPath
      ]);
    } catch (error) {
      return {
        syntheticSources: [],
        adapterArtifacts: [
          {
            name: 'eloshapes',
            runId,
            payload: {
              ok: false,
              error: sanitizeEloErrorMessage(error.message, config)
            }
          }
        ]
      };
    }

    let payload;
    try {
      payload = JSON.parse(await fs.readFile(outPath, 'utf8'));
    } catch {
      return null;
    }

    const rows = payload?.rows || [];

    const today = new Date().toISOString().slice(0, 10);
    const cacheKey = toPosixKey(
      config.s3OutputPrefix,
      '_cache',
      'eloshapes',
      today,
      'mouse.json.gz'
    );

    await storage.writeObject(cacheKey, gzipBuffer(JSON.stringify(payload)), {
      contentType: 'application/json',
      contentEncoding: 'gzip'
    });

    if (!rows.length) {
      return {
        syntheticSources: [],
        adapterArtifacts: [
          {
            name: 'eloshapes',
            runId,
            payload: {
              ...payload,
              cacheKey
            }
          }
        ]
      };
    }

    const mapped = mapRowsToCandidates(rows);
    const syntheticSource = {
      url: 'adapter://eloshapes/supabase',
      host: 'eloshapes.com',
      rootDomain: 'eloshapes.com',
      tier: 2,
      tierName: 'database',
      role: 'review',
      approvedDomain: true,
      status: 200,
      title: 'EloShapes Supabase',
      identityCandidates: mapped.identityCandidates,
      fieldCandidates: mapped.fieldCandidates,
      adapter: 'eloshapes',
      ts: new Date().toISOString()
    };

    return {
      syntheticSources: [syntheticSource],
      adapterArtifacts: [
        {
          name: 'eloshapes',
          runId,
          payload: {
            ...payload,
            cacheKey
          }
        }
      ]
    };
  }
};
