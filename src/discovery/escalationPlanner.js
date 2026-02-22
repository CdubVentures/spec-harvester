export async function planEscalationQueries({
  missingFields,
  product,
  previousQueries,
  config,
  callLlmFn
}) {
  if (!config.llmEnabled || !callLlmFn) return [];

  const fields = toArray(missingFields);
  if (fields.length === 0) return [];

  try {
    const result = await callLlmFn({
      missingFields: fields,
      product,
      previousQueries: toArray(previousQueries),
      config
    });
    return toArray(result).map((item) => ({
      query: String(item?.query || '').trim(),
      target_fields: toArray(item?.target_fields).map((f) => String(f || '').trim()).filter(Boolean),
      expected_source_type: String(item?.expected_source_type || '').trim()
    })).filter((item) => item.query);
  } catch {
    return [];
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}
