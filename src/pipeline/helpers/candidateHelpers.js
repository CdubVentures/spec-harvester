const METHOD_PRIORITY = {
  network_json: 5,
  adapter_api: 5,
  spec_table_match: 5,
  parse_template: 4.5,
  json_ld: 4,
  embedded_state: 4,
  ldjson: 3,
  pdf_table: 3,
  pdf: 3,
  dom: 2,
  component_db_inference: 2,
  llm_extract: 1
};

function parseFirstNumber(value) {
  const text = String(value || '');
  const match = text.match(/-?\d+(\.\d+)?/);
  if (!match) {
    return null;
  }
  const num = Number.parseFloat(match[0]);
  return Number.isFinite(num) ? num : null;
}

function hasKnownFieldValue(value) {
  const token = String(value || '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'null' && token !== 'undefined' && token !== 'n/a';
}

export { METHOD_PRIORITY, parseFirstNumber, hasKnownFieldValue };

export function plausibilityBoost(field, value) {
  const num = parseFirstNumber(value);
  if (num === null) {
    return 0;
  }

  if (field === 'weight') {
    return num >= 20 && num <= 250 ? 2 : -6;
  }
  if (field === 'lngth' || field === 'width' || field === 'height') {
    return num >= 20 && num <= 200 ? 2 : -6;
  }
  if (field === 'dpi') {
    return num >= 100 && num <= 100000 ? 2 : -6;
  }
  if (field === 'polling_rate') {
    return num >= 125 && num <= 10000 ? 2 : -6;
  }
  if (field === 'ips') {
    return num >= 50 && num <= 1000 ? 2 : -4;
  }
  if (field === 'acceleration') {
    return num >= 10 && num <= 200 ? 2 : -4;
  }

  return 0;
}

export function candidateScore(candidate) {
  const methodScore = METHOD_PRIORITY[candidate.method] || 0;
  const keyPath = String(candidate.keyPath || '').toLowerCase();
  const field = String(candidate.field || '');
  const numeric = parseFirstNumber(candidate.value);
  let score = methodScore * 10;
  if (field && keyPath.includes(field.toLowerCase())) {
    score += 2;
  }
  if (numeric !== null) {
    if (field === 'dpi') {
      score += Math.min(6, numeric / 8000);
    } else if (field === 'polling_rate') {
      score += Math.min(6, numeric / 1000);
    } else if (field === 'ips' || field === 'acceleration') {
      score += Math.min(3, numeric / 300);
    }
  }
  score += plausibilityBoost(field, candidate.value);
  return score;
}

export function buildCandidateFieldMap(fieldCandidates) {
  const map = {};
  const scoreByField = {};
  for (const row of fieldCandidates || []) {
    if (String(row.value || '').trim().toLowerCase() === 'unk') {
      continue;
    }
    const score = candidateScore(row);
    if (!Object.prototype.hasOwnProperty.call(scoreByField, row.field) || score > scoreByField[row.field]) {
      scoreByField[row.field] = score;
      map[row.field] = row.value;
    }
  }
  return map;
}

export function dedupeCandidates(candidates) {
  const seen = new Set();
  const out = [];
  for (const candidate of candidates || []) {
    const key = `${candidate.field}|${candidate.value}|${candidate.method}|${candidate.keyPath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

export function collectContributionFields({
  fieldOrder,
  normalized,
  provenance
}) {
  const llmFields = [];
  const componentFields = [];
  for (const field of fieldOrder || []) {
    if (!hasKnownFieldValue(normalized?.fields?.[field])) {
      continue;
    }
    const evidence = Array.isArray(provenance?.[field]?.evidence)
      ? provenance[field].evidence
      : [];
    if (evidence.some((row) => String(row?.method || '').toLowerCase().includes('llm'))) {
      llmFields.push(field);
    }
    if (evidence.some((row) => String(row?.method || '').toLowerCase() === 'component_db')) {
      componentFields.push(field);
    }
  }
  return {
    llmFields: [...new Set(llmFields)],
    componentFields: [...new Set(componentFields)]
  };
}
