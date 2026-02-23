import path from 'node:path';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeFields(compiledFields, draftFields) {
  if (!draftFields) return compiledFields;
  const allKeys = Object.keys({ ...compiledFields, ...draftFields });
  return Object.fromEntries(allKeys.map((k) => {
    const compiled = isObject(compiledFields[k]) ? compiledFields[k] : {};
    const draft = isObject(draftFields[k]) ? draftFields[k] : {};
    const compiledUi = isObject(compiled.ui) ? compiled.ui : {};
    const draftUi = isObject(draft.ui) ? draft.ui : {};
    return [k, { ...compiled, ...draft, ui: { ...compiledUi, ...draftUi } }];
  }));
}

function buildLabelsFromFields(mergedFields, fieldOrder) {
  const labels = {};
  for (const field of fieldOrder) {
    const rule = isObject(mergedFields[field]) ? mergedFields[field] : {};
    const ui = isObject(rule.ui) ? rule.ui : {};
    labels[field] = String(ui.label || rule.label || field);
  }
  return labels;
}

export function createSessionCache({ loadCategoryConfig, readJsonIfExists, writeFile, mkdir, helperRoot }) {
  const cache = new Map();

  function draftPath(category) {
    return path.join(helperRoot, category, '_control_plane', 'field_rules_draft.json');
  }

  function manifestPath(category) {
    return path.join(helperRoot, category, '_generated', 'manifest.json');
  }

  async function loadAndMerge(category) {
    const catConfig = await loadCategoryConfig(category).catch(() => ({}));
    const compiledFields = catConfig?.fieldRules?.fields || {};
    const compiledOrder = catConfig?.fieldOrder || Object.keys(compiledFields);

    const manifest = await readJsonIfExists(manifestPath(category));
    const compiledAt = manifest?.generated_at || null;

    const draft = await readJsonIfExists(draftPath(category));
    const draftFields = draft?.fields && typeof draft.fields === 'object' ? draft.fields : null;
    const draftFieldOrder = Array.isArray(draft?.fieldOrder) ? draft.fieldOrder : null;
    const draftSavedAt = draft?.draft_saved_at || null;

    const mergedFields = draftFields ? deepMergeFields(compiledFields, draftFields) : compiledFields;
    const mergedFieldOrder = draftFieldOrder || compiledOrder;
    const cleanFieldOrder = mergedFieldOrder.filter((k) => !String(k).startsWith('__grp::'));
    const labels = buildLabelsFromFields(mergedFields, cleanFieldOrder);

    const compileStale = Boolean(draftSavedAt && (!compiledAt || new Date(draftSavedAt) > new Date(compiledAt)));

    return { mergedFields, mergedFieldOrder, cleanFieldOrder, draftFields, draftFieldOrder, labels, compiledAt, draftSavedAt, compileStale };
  }

  async function getSessionRules(category) {
    if (cache.has(category)) return cache.get(category);
    const entry = await loadAndMerge(category);
    cache.set(category, entry);
    return entry;
  }

  async function updateSessionRules(category, { fields, fieldOrder }) {
    const existing = await readJsonIfExists(draftPath(category)) || {};
    const merged = {
      ...existing,
      ...(fields ? { fields: { ...(existing.fields || {}), ...fields } } : {}),
      ...(fieldOrder ? { fieldOrder } : {}),
      draft_saved_at: new Date().toISOString(),
    };

    const controlPlane = path.join(helperRoot, category, '_control_plane');
    await mkdir(controlPlane, { recursive: true });
    await writeFile(draftPath(category), JSON.stringify(merged, null, 2));

    cache.delete(category);
    const entry = await loadAndMerge(category);
    cache.set(category, entry);
    return entry;
  }

  function invalidateSessionCache(category) {
    if (category) {
      cache.delete(category);
    } else {
      cache.clear();
    }
  }

  return { getSessionRules, updateSessionRules, invalidateSessionCache };
}
