export async function predictSourceUrls({
  product,
  knownSources,
  config,
  callLlmFn,
  headFn
}) {
  if (!config.llmEnabled || !callLlmFn) return [];

  const sources = toArray(knownSources);
  if (sources.length === 0) return [];

  let predictions;
  try {
    predictions = await callLlmFn({
      product,
      sources,
      config
    });
  } catch {
    return [];
  }

  const rawPredictions = toArray(predictions);
  if (rawPredictions.length === 0) return [];

  const validated = [];
  for (const pred of rawPredictions) {
    const url = String(pred?.url || '').trim();
    if (!url) continue;

    if (headFn) {
      try {
        const response = await headFn(url);
        const status = Number(response?.status || 0);
        if (status >= 400) continue;
      } catch {
        continue;
      }
    }

    validated.push({
      url,
      source_host: String(pred.source_host || '').trim(),
      predicted_tier: pred.predicted_tier ?? 2,
      confidence: pred.confidence ?? 0.5
    });
  }

  return validated;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}
