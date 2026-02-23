export function readLearningHintsFromStores({
  stores,
  category,
  focusFields = []
}) {
  const anchorsByField = {};
  const knownUrls = {};
  const componentValues = {};

  for (const field of focusFields) {
    const rawAnchors = stores.fieldAnchors.queryWithDecay({ field, category });
    anchorsByField[field] = rawAnchors.map((row) => ({
      phrase: row.phrase,
      sourceUrl: row.source_url,
      decayStatus: row.decay_status
    }));

    const rawUrls = stores.urlMemory.queryWithDecay({ field, category });
    knownUrls[field] = rawUrls.map((row) => ({
      url: row.url,
      usedCount: row.used_count,
      decayStatus: row.decay_status
    }));

    const rawLexicon = stores.componentLexicon.queryWithDecay({ field, category });
    componentValues[field] = rawLexicon.map((row) => ({
      value: row.value,
      decayStatus: row.decay_status
    }));
  }

  const allFields = focusFields.length > 0 ? focusFields : [];
  const domainYieldMap = new Map();

  for (const field of allFields) {
    const yieldRows = stores.domainFieldYield._db.prepare(
      `SELECT * FROM domain_field_yield WHERE field = ? AND category = ?`
    ).all(field, category);

    for (const row of yieldRows) {
      const existing = domainYieldMap.get(row.domain) || { domain: row.domain, totalSeen: 0, totalUsed: 0, fields: [] };
      existing.totalSeen += row.seen_count;
      existing.totalUsed += row.used_count;
      existing.fields.push({ field: row.field, seen: row.seen_count, used: row.used_count });
      domainYieldMap.set(row.domain, existing);
    }
  }

  const domainYields = [...domainYieldMap.values()]
    .map((d) => ({
      ...d,
      yieldRatio: d.totalSeen > 0 ? d.totalUsed / d.totalSeen : 0
    }))
    .sort((a, b) => b.totalUsed - a.totalUsed);

  const highYieldDomains = domainYields
    .filter((d) => d.totalSeen >= 3 && d.yieldRatio >= 0.5);

  return {
    anchorsByField,
    knownUrls,
    componentValues,
    domainYields,
    highYieldDomains
  };
}
