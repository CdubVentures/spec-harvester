export async function classifyDomains({
  domains,
  category,
  config,
  callLlmFn,
  storage
}) {
  const results = new Map();
  const uncached = [];

  for (const domain of toArray(domains)) {
    const key = normalizeDomain(domain);
    if (!key) continue;
    const cached = storage.getDomainClassification(key);
    if (cached) {
      results.set(key, {
        safe: Boolean(cached.safe),
        classification: cached.classification || 'unknown',
        reason: cached.reason || ''
      });
    } else {
      uncached.push(key);
    }
  }

  if (uncached.length === 0 || !config.llmEnabled || !callLlmFn) {
    for (const domain of uncached) {
      results.set(domain, { safe: true, classification: 'unknown', reason: 'no_llm' });
    }
    return results;
  }

  try {
    const batches = chunk(uncached, 30);
    for (const batch of batches) {
      const classifications = await callLlmFn({
        domains: batch,
        category,
        config
      });
      for (const item of toArray(classifications)) {
        const domain = normalizeDomain(item.domain);
        if (!domain) continue;
        const safe = item.classification !== 'adult_content' && item.classification !== 'malware';
        const entry = {
          safe,
          classification: item.classification || 'unknown',
          reason: String(item.reason || '').trim()
        };
        results.set(domain, entry);
        storage.upsertDomainClassification({
          domain,
          classification: entry.classification,
          safe: safe ? 1 : 0,
          reason: entry.reason
        });
      }
    }
  } catch {
    for (const domain of uncached) {
      if (!results.has(domain)) {
        results.set(domain, { safe: true, classification: 'unknown', reason: 'llm_error' });
      }
    }
  }

  return results;
}

function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '');
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
