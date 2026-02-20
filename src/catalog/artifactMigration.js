/**
 * Artifact Migration — moves all storage artifacts when a product is renamed.
 *
 * When a product's slug changes (model/variant rename), all existing data stored
 * under the old slug must be moved to the new slug. The identifier proves product
 * continuity across renames.
 *
 * Migrated artifact prefixes:
 *   1. {outputPrefix}/{cat}/{pid}/latest/*
 *   2. {outputPrefix}/{cat}/{pid}/runs/{runId}/*
 *   3. final/{cat}/{pid}/review/*
 *   4. {outputPrefix}/{cat}/{pid}/review/*  (legacy)
 *   5. {cat}/published/{pid}/*
 *   6. helper_files/{cat}/_overrides/{pid}.overrides.json  (local filesystem)
 *   7. _queue/{cat}/state.json → products[pid]  (dict entry swap)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { migrateQueueEntry } from '../queue/queueState.js';

function nowIso() {
  return new Date().toISOString();
}

/**
 * Migrate all storage artifacts from oldProductId to newProductId.
 *
 * @param {object} opts
 * @param {object} opts.storage       — storage instance (LocalStorage, S3Storage, DualMirroredStorage)
 * @param {object} opts.config        — app config (for helperFilesRoot)
 * @param {string} opts.category      — product category
 * @param {string} opts.oldProductId  — current slug (source)
 * @param {string} opts.newProductId  — new slug (destination)
 * @param {string} opts.identifier    — immutable product identifier (for logging)
 * @returns {{ ok, migrated_count, failed_count, migrated_keys, failed_keys, queue_migrated, override_migrated, duration_ms }}
 */
export async function migrateProductArtifacts({ storage, config, category, oldProductId, newProductId, identifier }) {
  const start = Date.now();
  const migrated_keys = [];
  const failed_keys = [];

  const outputPrefix = storage.outputPrefix || 'specs/outputs';

  // Define prefix pairs: [oldPrefix, newPrefix]
  const prefixPairs = [
    // Latest artifacts
    [`${outputPrefix}/${category}/${oldProductId}/latest`, `${outputPrefix}/${category}/${newProductId}/latest`],
    // Per-run artifacts
    [`${outputPrefix}/${category}/${oldProductId}/runs`, `${outputPrefix}/${category}/${newProductId}/runs`],
    // Review artifacts (modern: final/{cat}/{pid}/review)
    [`final/${category}/${oldProductId}/review`, `final/${category}/${newProductId}/review`],
    // Review artifacts (legacy: {outputPrefix}/{cat}/{pid}/review)
    [`${outputPrefix}/${category}/${oldProductId}/review`, `${outputPrefix}/${category}/${newProductId}/review`],
    // Published specs: {cat}/published/{pid}
    [`${category}/published/${oldProductId}`, `${category}/published/${newProductId}`],
    // Final output artifacts: {outputPrefix}/{cat}/{pid}/final
    [`${outputPrefix}/${category}/${oldProductId}/final`, `${outputPrefix}/${category}/${newProductId}/final`],
    // Final artifacts (non-prefixed): final/{cat}/{pid} (excluding review, handled above)
    [`final/${category}/${oldProductId}`, `final/${category}/${newProductId}`],
  ];

  // Migrate storage keys
  for (const [oldPrefix, newPrefix] of prefixPairs) {
    let keys;
    try {
      keys = await storage.listKeys(oldPrefix);
    } catch {
      continue;
    }

    if (!keys || keys.length === 0) continue;

    for (const key of keys) {
      const newKey = key.replace(oldPrefix, newPrefix);
      if (newKey === key) continue; // safety: skip if no change

      try {
        // Read content as buffer to handle both JSON and binary (.gz) files
        let content;
        if (storage.readBuffer) {
          content = await storage.readBuffer(key);
        } else {
          content = await storage.readText(key);
        }

        // If it's a JSON file, try to patch product_id / productId references
        if (key.endsWith('.json') && content) {
          try {
            const text = Buffer.isBuffer(content) ? content.toString('utf8') : content;
            const parsed = JSON.parse(text);
            let patched = false;

            if (parsed.product_id === oldProductId) {
              parsed.product_id = newProductId;
              patched = true;
            }
            if (parsed.productId === oldProductId) {
              parsed.productId = newProductId;
              patched = true;
            }

            if (patched) {
              content = Buffer.from(JSON.stringify(parsed, null, 2), 'utf8');
            }
          } catch {
            // Not valid JSON or parse error — write as-is
          }
        }

        await storage.writeObject(newKey, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'));
        await storage.deleteObject(key);
        migrated_keys.push(key);
      } catch (err) {
        failed_keys.push({ key, error: err.message || String(err) });
      }
    }
  }

  // Migrate override file (local filesystem)
  let override_migrated = false;
  try {
    const helperRoot = path.resolve(config?.helperFilesRoot || 'helper_files');
    const oldOverridePath = path.join(helperRoot, category, '_overrides', `${oldProductId}.overrides.json`);
    const newOverridePath = path.join(helperRoot, category, '_overrides', `${newProductId}.overrides.json`);

    const overrideContent = await fs.readFile(oldOverridePath, 'utf8').catch(() => null);
    if (overrideContent) {
      try {
        const parsed = JSON.parse(overrideContent);
        if (parsed.product_id === oldProductId) {
          parsed.product_id = newProductId;
        }
        await fs.mkdir(path.dirname(newOverridePath), { recursive: true });
        await fs.writeFile(newOverridePath, JSON.stringify(parsed, null, 2), 'utf8');
      } catch {
        // If JSON parse fails, copy as-is
        await fs.mkdir(path.dirname(newOverridePath), { recursive: true });
        await fs.writeFile(newOverridePath, overrideContent, 'utf8');
      }
      await fs.unlink(oldOverridePath).catch(() => {});
      override_migrated = true;
      migrated_keys.push(`override:${oldOverridePath}`);
    }
  } catch {
    // Override file doesn't exist or migration failed — not critical
  }

  // Migrate queue entry
  let queue_migrated = false;
  try {
    queue_migrated = await migrateQueueEntry({ storage, category, oldProductId, newProductId });
  } catch {
    // Queue migration failure is non-fatal
  }

  const duration_ms = Date.now() - start;

  return {
    ok: failed_keys.length === 0,
    migrated_count: migrated_keys.length,
    failed_count: failed_keys.length,
    migrated_keys,
    failed_keys,
    queue_migrated,
    override_migrated,
    duration_ms
  };
}

/**
 * Append an entry to the per-category rename log.
 * Stored at: helper_files/{cat}/_control_plane/rename_log.json
 *
 * @param {object} config   — app config
 * @param {string} category — product category
 * @param {object} entry    — rename log entry
 */
export async function appendRenameLog(config, category, entry) {
  const helperRoot = path.resolve(config?.helperFilesRoot || 'helper_files');
  const logPath = path.join(helperRoot, category, '_control_plane', 'rename_log.json');

  let log;
  try {
    const text = await fs.readFile(logPath, 'utf8');
    log = JSON.parse(text);
    if (!log || !Array.isArray(log.entries)) {
      log = { _doc: 'Log of all product renames. Append-only.', entries: [] };
    }
  } catch {
    log = { _doc: 'Log of all product renames. Append-only.', entries: [] };
  }

  log.entries.push({
    ...entry,
    renamed_at: entry.renamed_at || nowIso()
  });

  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, JSON.stringify(log, null, 2), 'utf8');
}
