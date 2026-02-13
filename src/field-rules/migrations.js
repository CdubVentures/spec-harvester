import semver from 'semver';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeFieldKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function stableFieldMap(rules = {}) {
  const fields = isObject(rules?.fields) ? rules.fields : {};
  const out = {};
  for (const [rawKey, row] of Object.entries(fields)) {
    const key = normalizeFieldKey(rawKey);
    if (!key || !isObject(row)) {
      continue;
    }
    out[key] = row;
  }
  return out;
}

function parseVersion(version = '') {
  const token = String(version || '').trim();
  if (!token) {
    return '1.0.0';
  }
  const cleaned = semver.coerce(token);
  return cleaned ? cleaned.version : '1.0.0';
}

function migrationDocToKeyMapInternal(doc = {}) {
  const keyMap = {};
  if (isObject(doc.key_map)) {
    for (const [fromRaw, toRaw] of Object.entries(doc.key_map)) {
      const from = normalizeFieldKey(fromRaw);
      const to = normalizeFieldKey(toRaw);
      if (!from || !to || from === to || String(fromRaw || '').startsWith('_')) {
        continue;
      }
      keyMap[from] = to;
    }
  }
  for (const row of toArray(doc.migrations)) {
    if (String(row?.type || '').trim().toLowerCase() !== 'rename') {
      continue;
    }
    const from = normalizeFieldKey(row?.from);
    const to = normalizeFieldKey(row?.to);
    if (!from || !to || from === to) {
      continue;
    }
    keyMap[from] = to;
  }
  return keyMap;
}

function classifyBreakingChange(previousRule = {}, nextRule = {}) {
  const prevType = String(previousRule?.contract?.type || previousRule?.type || '').trim().toLowerCase();
  const nextType = String(nextRule?.contract?.type || nextRule?.type || '').trim().toLowerCase();
  const prevShape = String(previousRule?.contract?.shape || previousRule?.shape || '').trim().toLowerCase();
  const nextShape = String(nextRule?.contract?.shape || nextRule?.shape || '').trim().toLowerCase();
  const prevEnumPolicy = String(previousRule?.enum_policy || previousRule?.enum?.policy || '').trim().toLowerCase();
  const nextEnumPolicy = String(nextRule?.enum_policy || nextRule?.enum?.policy || '').trim().toLowerCase();

  if (prevType && nextType && prevType !== nextType) {
    return `type changed (${prevType} -> ${nextType})`;
  }
  if (prevShape && nextShape && prevShape !== nextShape) {
    return `shape changed (${prevShape} -> ${nextShape})`;
  }
  if (prevEnumPolicy && nextEnumPolicy && prevEnumPolicy !== nextEnumPolicy) {
    return `enum_policy changed (${prevEnumPolicy} -> ${nextEnumPolicy})`;
  }
  return '';
}

export function classifyFieldRulesVersionChange({
  previousRules = {},
  nextRules = {},
  previousVersion = ''
} = {}) {
  const previousFields = stableFieldMap(previousRules);
  const nextFields = stableFieldMap(nextRules);
  const previousKeys = new Set(Object.keys(previousFields));
  const nextKeys = new Set(Object.keys(nextFields));

  const removed = [...previousKeys].filter((key) => !nextKeys.has(key)).sort((a, b) => a.localeCompare(b));
  const added = [...nextKeys].filter((key) => !previousKeys.has(key)).sort((a, b) => a.localeCompare(b));
  const changed = [];
  for (const key of [...previousKeys].sort((a, b) => a.localeCompare(b))) {
    if (!nextKeys.has(key)) {
      continue;
    }
    const reason = classifyBreakingChange(previousFields[key], nextFields[key]);
    if (reason) {
      changed.push({
        field: key,
        reason
      });
    }
  }

  let bump = 'patch';
  if (removed.length > 0 || changed.length > 0) {
    bump = 'major';
  } else if (added.length > 0) {
    bump = 'minor';
  }
  const prevVersion = parseVersion(previousVersion || previousRules?.version || nextRules?.previous_version || '');
  const nextVersion = semver.inc(prevVersion, bump) || prevVersion;

  return {
    previous_version: prevVersion,
    next_version: nextVersion,
    bump,
    summary: {
      added_count: added.length,
      removed_count: removed.length,
      changed_count: changed.length
    },
    added_fields: added,
    removed_fields: removed,
    changed_fields: changed
  };
}

function asMigrationDoc(input = {}) {
  if (Array.isArray(input?.migrations)) {
    return {
      version: parseVersion(input.version || '1.0.0'),
      previous_version: parseVersion(input.previous_version || input.version || '1.0.0'),
      bump: String(input.bump || 'patch'),
      summary: isObject(input.summary) ? input.summary : {},
      migrations: input.migrations,
      key_map: migrationDocToKeyMapInternal(input)
    };
  }
  const keyMap = isObject(input?.key_map) ? input.key_map : (isObject(input) ? input : {});
  const migrations = [];
  for (const [fromRaw, toRaw] of Object.entries(keyMap)) {
    if (String(fromRaw || '').startsWith('_')) {
      continue;
    }
    if (typeof toRaw !== 'string') {
      continue;
    }
    const from = normalizeFieldKey(fromRaw);
    const to = normalizeFieldKey(toRaw);
    if (!from || !to || from === to) {
      continue;
    }
    migrations.push({
      type: 'rename',
      from,
      to,
      reason: 'auto-generated from key map'
    });
  }
  return {
    version: parseVersion(input?.version || '1.0.0'),
    previous_version: parseVersion(input?.previous_version || input?.version || '1.0.0'),
    bump: String(input?.bump || 'patch'),
    summary: isObject(input?.summary) ? input.summary : {},
    migrations,
    key_map: migrationDocToKeyMapInternal({ key_map: keyMap, migrations })
  };
}

export function buildMigrationPlan({
  previousRules = {},
  nextRules = {},
  keyMigrations = {},
  previousVersion = '',
  nextVersion = ''
} = {}) {
  const version = classifyFieldRulesVersionChange({
    previousRules,
    nextRules,
    previousVersion
  });
  const migrationDoc = asMigrationDoc(keyMigrations);
  const resolvedNextVersion = parseVersion(nextVersion || version.next_version);
  return {
    version: resolvedNextVersion,
    previous_version: version.previous_version,
    bump: version.bump,
    summary: version.summary,
    migrations: migrationDoc.migrations,
    key_map: migrationDoc.key_map
  };
}

export function migrationDocToKeyMap(migrationInput = {}) {
  const doc = asMigrationDoc(migrationInput);
  return {
    ...doc.key_map
  };
}

export function applyKeyMigrations(record = {}, migrationInput = {}) {
  const sourceRecord = isObject(record) ? { ...record } : {};
  const migrationDoc = asMigrationDoc(migrationInput);
  const migrations = Array.isArray(migrationDoc.migrations) ? migrationDoc.migrations : [];
  const out = { ...sourceRecord };

  for (const row of migrations) {
    const type = String(row?.type || '').trim().toLowerCase();
    if (type === 'rename') {
      const from = normalizeFieldKey(row?.from);
      const to = normalizeFieldKey(row?.to);
      if (!from || !to || from === to || !Object.prototype.hasOwnProperty.call(out, from)) {
        continue;
      }
      out[to] = out[from];
      delete out[from];
      continue;
    }
    if (type === 'merge') {
      const fromList = Array.isArray(row?.from) ? row.from.map((value) => normalizeFieldKey(value)).filter(Boolean) : [];
      const to = normalizeFieldKey(row?.to);
      if (!to || fromList.length === 0) {
        continue;
      }
      const mergedValues = [];
      for (const key of fromList) {
        if (!Object.prototype.hasOwnProperty.call(out, key)) {
          continue;
        }
        mergedValues.push(out[key]);
        delete out[key];
      }
      if (mergedValues.length > 0 && !Object.prototype.hasOwnProperty.call(out, to)) {
        out[to] = mergedValues.length === 1 ? mergedValues[0] : mergedValues;
      }
      continue;
    }
    if (type === 'split') {
      const from = normalizeFieldKey(row?.from);
      const toList = Array.isArray(row?.to) ? row.to.map((value) => normalizeFieldKey(value)).filter(Boolean) : [];
      if (!from || toList.length === 0 || !Object.prototype.hasOwnProperty.call(out, from)) {
        continue;
      }
      const source = out[from];
      delete out[from];
      for (const key of toList) {
        if (!Object.prototype.hasOwnProperty.call(out, key)) {
          out[key] = source;
        }
      }
      continue;
    }
    if (type === 'deprecate') {
      const field = normalizeFieldKey(row?.field);
      if (!field || !Object.prototype.hasOwnProperty.call(out, field)) {
        continue;
      }
      if (!isObject(out._deprecated)) {
        out._deprecated = {};
      }
      out._deprecated[field] = out[field];
      delete out[field];
    }
  }
  return out;
}
