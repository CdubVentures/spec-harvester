import { safeJsonParse } from '../utils/common.js';

export function extractLdJsonBlocks(html) {
  if (!html) {
    return [];
  }

  const blocks = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(regex)) {
    const raw = match[1].trim();
    if (!raw) {
      continue;
    }

    const parsed = safeJsonParse(raw, null);
    if (parsed === null) {
      continue;
    }

    if (Array.isArray(parsed)) {
      blocks.push(...parsed);
    } else {
      blocks.push(parsed);
    }
  }

  return blocks;
}
