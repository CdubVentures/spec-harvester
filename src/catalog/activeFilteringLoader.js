/**
 * Shared loader for activeFiltering.json.
 *
 * Resolution order:
 * 1. Local cache at helper_files/{cat}/activeFiltering.json
 * 2. S3 data bucket (eggamer-data) via AWS SDK at cache/data/hubs/{cat}/activeFiltering.json
 *
 * Remote data is always cached locally after fetch.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const DATA_BUCKET = process.env.S3_DATA_BUCKET || 'eggamer-data';
const REGION = process.env.AWS_REGION || 'us-east-2';

let _s3;
function getS3() {
  if (!_s3) _s3 = new S3Client({ region: REGION });
  return _s3;
}

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Load activeFiltering for a category.
 * Checks local cache first, then fetches from S3 data bucket.
 * @param {object} opts
 * @param {string} opts.helperFilesRoot - e.g. 'helper_files'
 * @param {string} opts.category
 * @returns {Promise<Array|null>} The activeFiltering array, or null if not found.
 */
export async function loadActiveFilteringData({ helperFilesRoot, category }) {
  const root = helperFilesRoot || 'helper_files';
  const localPath = path.resolve(root, category, 'activeFiltering.json');

  // 1. Try local cache
  try {
    const text = await fs.readFile(localPath, 'utf8');
    const data = JSON.parse(text);
    if (Array.isArray(data)) return data;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  // 2. Fetch from S3 data bucket
  const s3Key = `cache/data/hubs/${category}/activeFiltering.json`;
  try {
    const s3 = getS3();
    const resp = await s3.send(new GetObjectCommand({ Bucket: DATA_BUCKET, Key: s3Key }));
    const text = await streamToString(resp.Body);
    const data = JSON.parse(text);
    if (!Array.isArray(data)) return null;

    // Cache locally
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, JSON.stringify(data, null, 2), 'utf8');

    return data;
  } catch (err) {
    // NoSuchKey = file doesn't exist in S3 for this category
    if (err.name === 'NoSuchKey' || err.Code === 'NoSuchKey') return null;
    // Credential errors should surface clearly
    if (err.name === 'CredentialsProviderError' || err.name === 'AccessDenied') {
      console.error(`[activeFilteringLoader] S3 auth error for ${s3Key}:`, err.message);
      return null;
    }
    // Other errors (network, etc.)
    console.error(`[activeFilteringLoader] S3 fetch error for ${s3Key}:`, err.message);
    return null;
  }
}

/**
 * Discover categories from S3 data bucket.
 * Lists prefixes under cache/data/hubs/ to find all categories with activeFiltering.
 * Merges with local helper_files dirs.
 */
export async function discoverCategories({ helperFilesRoot, knownCategories = [] }) {
  const root = helperFilesRoot || 'helper_files';
  const rootPath = path.resolve(root);
  const cats = new Set(knownCategories);

  // Local dirs
  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('_')) {
        cats.add(e.name);
      }
    }
  } catch {}

  // S3 prefix listing
  try {
    const s3 = getS3();
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: DATA_BUCKET,
      Prefix: 'cache/data/hubs/',
      Delimiter: '/'
    }));
    if (resp.CommonPrefixes) {
      for (const cp of resp.CommonPrefixes) {
        // cp.Prefix = "cache/data/hubs/mouse/"
        const cat = cp.Prefix.replace('cache/data/hubs/', '').replace(/\/$/, '');
        if (cat && !cat.startsWith('_')) cats.add(cat);
      }
    }
  } catch (err) {
    console.error('[activeFilteringLoader] S3 category discovery error:', err.message);
  }

  return [...cats].sort();
}
