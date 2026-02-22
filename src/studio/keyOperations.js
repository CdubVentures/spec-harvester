const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_KEY_LENGTH = 64;

function validateNewKey(key, existingKeys) {
  if (!key || typeof key !== 'string' || key.trim().length === 0) return 'Key must not be empty';
  const trimmed = key.trim();
  if (trimmed.length > MAX_KEY_LENGTH) return `Key must be ${MAX_KEY_LENGTH} characters or fewer`;
  if (trimmed.startsWith('__')) return 'Keys starting with __ are reserved for system slots';
  if (!KEY_PATTERN.test(trimmed)) return 'Key must be lowercase, start with a letter, and contain only letters, numbers, and underscores';
  const lowerExisting = (existingKeys || []).map((k) => k.toLowerCase());
  if (lowerExisting.includes(trimmed.toLowerCase())) return 'A key with this name already exists';
  return null;
}

function humanizeKey(key) {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function applyAddKey(fieldOrder, rules, newKey, opts = {}) {
  const { afterKey, group } = opts;
  const nextOrder = [...fieldOrder];
  if (afterKey) {
    const idx = nextOrder.indexOf(afterKey);
    nextOrder.splice(idx >= 0 ? idx + 1 : nextOrder.length, 0, newKey);
  } else {
    nextOrder.push(newKey);
  }
  const nextRules = { ...rules };
  nextRules[newKey] = {
    label: humanizeKey(newKey),
    group: group || 'ungrouped',
    constraints: [],
    _edited: true,
  };
  return { fieldOrder: nextOrder, rules: nextRules };
}

function rewriteConstraints(constraints, oldKey, newKey) {
  if (!Array.isArray(constraints)) return [];
  return constraints.map((expr) => rewriteSingleConstraint(expr, oldKey, newKey));
}

function rewriteSingleConstraint(expr, oldKey, newKey) {
  if (!expr || typeof expr !== 'string') return expr;
  const trimmed = expr.trim();

  const requiresMatch = trimmed.match(/^(.+?)\s+requires\s+(.+)$/);
  if (requiresMatch) {
    const left = requiresMatch[1].trim();
    const right = requiresMatch[2].trim();
    return `${left === oldKey ? newKey : left} requires ${right === oldKey ? newKey : right}`;
  }

  const operators = ['<=', '>=', '!=', '==', '<', '>'];
  for (const op of operators) {
    const idx = trimmed.indexOf(op);
    if (idx > 0) {
      const left = trimmed.slice(0, idx).trim();
      const right = trimmed.slice(idx + op.length).trim();
      if (left && right) {
        return `${left === oldKey ? newKey : left} ${op} ${right === oldKey ? newKey : right}`;
      }
    }
  }
  return expr;
}

function rewriteAllRulesConstraints(rules, oldKey, newKey) {
  const next = {};
  for (const [k, rule] of Object.entries(rules)) {
    if (!rule || typeof rule !== 'object') { next[k] = rule; continue; }
    const constraints = Array.isArray(rule.constraints)
      ? rewriteConstraints(rule.constraints, oldKey, newKey)
      : rule.constraints;
    next[k] = constraints !== rule.constraints ? { ...rule, constraints } : { ...rule };
  }
  return next;
}

function constraintReferencesKey(expr, key) {
  if (!expr || typeof expr !== 'string') return false;
  const trimmed = expr.trim();

  const requiresMatch = trimmed.match(/^(.+?)\s+requires\s+(.+)$/);
  if (requiresMatch) {
    return requiresMatch[1].trim() === key || requiresMatch[2].trim() === key;
  }

  const operators = ['<=', '>=', '!=', '==', '<', '>'];
  for (const op of operators) {
    const idx = trimmed.indexOf(op);
    if (idx > 0) {
      const left = trimmed.slice(0, idx).trim();
      const right = trimmed.slice(idx + op.length).trim();
      if (left && right) return left === key || right === key;
    }
  }
  return false;
}

function applyDeleteKey(fieldOrder, rules, key) {
  const nextOrder = fieldOrder.filter((k) => k !== key);
  const nextRules = {};
  for (const [k, rule] of Object.entries(rules)) {
    if (k === key) continue;
    if (!rule || typeof rule !== 'object') { nextRules[k] = rule; continue; }
    const constraints = Array.isArray(rule.constraints)
      ? rule.constraints.filter((c) => !constraintReferencesKey(c, key))
      : rule.constraints;
    nextRules[k] = { ...rule, constraints };
  }
  return { fieldOrder: nextOrder, rules: nextRules };
}

function applyRenameKey(fieldOrder, rules, oldKey, newKey) {
  const nextOrder = fieldOrder.map((k) => (k === oldKey ? newKey : k));
  const renamedRules = rewriteAllRulesConstraints(rules, oldKey, newKey);
  const nextRules = {};
  for (const [k, rule] of Object.entries(renamedRules)) {
    if (k === oldKey) {
      const updated = { ...rule };
      if (updated.label && updated.label.toLowerCase() === oldKey.toLowerCase()) {
        updated.label = humanizeKey(newKey);
      }
      nextRules[newKey] = updated;
    } else {
      nextRules[k] = rule;
    }
  }
  return { fieldOrder: nextOrder, rules: nextRules, rename: [oldKey, newKey] };
}

function getGroup(rule) {
  if (!rule || typeof rule !== 'object') return 'ungrouped';
  const ui = rule.ui;
  if (ui && typeof ui === 'object' && ui.group) return String(ui.group);
  return String(rule.group || 'ungrouped');
}

function deriveGroups(fieldOrder, ruleMap) {
  const seen = [];
  const map = {};
  for (const key of fieldOrder) {
    const rule = ruleMap[key];
    if (!rule) continue;
    const group = getGroup(rule);
    if (!map[group]) {
      map[group] = [];
      seen.push(group);
    }
    map[group].push(key);
  }
  return seen.map((g) => [g, map[g]]);
}

function reorderKey(fieldOrder, ruleMap, activeKey, overKey) {
  if (activeKey === overKey) return fieldOrder;
  const activeIdx = fieldOrder.indexOf(activeKey);
  const overIdx = fieldOrder.indexOf(overKey);
  if (activeIdx < 0 || overIdx < 0) return fieldOrder;
  const next = fieldOrder.filter((k) => k !== activeKey);
  const insertIdx = next.indexOf(overKey);
  next.splice(insertIdx + 1, 0, activeKey);
  return next;
}

function reorderGroup(fieldOrder, ruleMap, activeGroup, overGroup) {
  if (activeGroup === overGroup) return fieldOrder;
  const groups = deriveGroups(fieldOrder, ruleMap);
  const activeEntry = groups.find(([g]) => g === activeGroup);
  const overEntry = groups.find(([g]) => g === overGroup);
  if (!activeEntry || !overEntry) return fieldOrder;
  const reordered = groups.filter(([g]) => g !== activeGroup);
  const overIdx = reordered.findIndex(([g]) => g === overGroup);
  reordered.splice(overIdx, 0, activeEntry);
  return reordered.flatMap(([, keys]) => keys);
}

export {
  validateNewKey,
  applyAddKey,
  applyDeleteKey,
  applyRenameKey,
  rewriteConstraints,
  humanizeKey,
  deriveGroups,
  reorderKey,
  reorderGroup,
};
