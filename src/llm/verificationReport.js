import { nowIso } from '../utils/common.js';

export async function appendLlmVerificationReport({
  storage,
  category = 'unknown',
  entry
}) {
  if (!storage || !entry) {
    return null;
  }
  const day = String(entry.ts || nowIso()).slice(0, 10);
  const key = storage.resolveOutputKey('_reports', 'llm_verify', `${day}.json`);
  const current = await storage.readJsonOrNull(key);
  const payload = current && typeof current === 'object'
    ? current
    : {
      date: day,
      updated_at: nowIso(),
      category,
      entries: []
    };
  payload.updated_at = nowIso();
  payload.category = category;
  payload.entries = Array.isArray(payload.entries) ? payload.entries : [];
  payload.entries.push(entry);
  payload.entries = payload.entries.slice(-2000);
  await storage.writeObject(
    key,
    Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  return key;
}
