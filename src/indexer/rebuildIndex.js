import path from 'node:path';
import { toPosixKey } from '../s3/storage.js';

function productIdFromKey(key) {
  const name = path.posix.basename(key);
  return name.replace(/\.json$/i, '');
}

export async function rebuildCategoryIndex({ storage, config, category }) {
  const inputKeys = await storage.listInputKeys(category);
  const rows = [];

  for (const key of inputKeys) {
    const productId = productIdFromKey(key.replace(/\\/g, '/'));
    const latestSummaryKey = toPosixKey(
      config.s3OutputPrefix,
      category,
      productId,
      'latest',
      'summary.json'
    );

    const latestSummary = await storage.readJsonOrNull(latestSummaryKey);

    rows.push({
      productId,
      inputKey: key,
      latestSummaryKey,
      validated: latestSummary?.validated ?? null,
      reason: latestSummary?.reason ?? null,
      runId: latestSummary?.runId ?? null,
      confidence: latestSummary?.confidence ?? null,
      completeness_required_percent: latestSummary?.completeness_required_percent ?? null,
      coverage_overall_percent: latestSummary?.coverage_overall_percent ?? null,
      updated_at: latestSummary?.generated_at ?? null
    });
  }

  const index = {
    category,
    generated_at: new Date().toISOString(),
    total_products: rows.length,
    items: rows
  };

  const indexKey = toPosixKey(config.s3OutputPrefix, category, '_index', 'latest.json');
  await storage.writeObject(indexKey, Buffer.from(JSON.stringify(index, null, 2), 'utf8'), {
    contentType: 'application/json'
  });

  return {
    indexKey,
    totalProducts: rows.length,
    items: rows
  };
}
