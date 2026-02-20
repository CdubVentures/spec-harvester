import { randomBytes } from 'node:crypto';

/**
 * Generate a unique identifier: 8-char hex string (4 bytes = ~4 billion possibilities).
 */
export function generateIdentifier() {
  return randomBytes(4).toString('hex');
}

/**
 * Get the next available numeric ID from existing catalog.
 */
export function nextAvailableId(catalog) {
  const usedIds = new Set();
  for (const entry of Object.values(catalog.products || {})) {
    if (entry.id) usedIds.add(Number(entry.id));
  }
  for (let i = 1; ; i++) {
    if (!usedIds.has(i)) return i;
  }
}
