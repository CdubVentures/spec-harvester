export function validateNewKeyTs(key: string, existingKeys: string[]): string | null {
  if (!key || key.trim().length === 0) return 'Key must not be empty';
  const trimmed = key.trim();
  if (trimmed.length > 64) return 'Key must be 64 characters or fewer';
  if (trimmed.startsWith('__')) return 'Keys starting with __ are reserved for system slots';
  if (!/^[a-z][a-z0-9_]*$/.test(trimmed)) return 'Key must be lowercase, start with a letter, and contain only letters, numbers, and underscores';
  if (existingKeys.map((k) => k.toLowerCase()).includes(trimmed.toLowerCase())) return 'A key with this name already exists';
  return null;
}

export function rewriteConstraintsTs(constraints: string[], oldKey: string, newKey: string): string[] {
  if (!Array.isArray(constraints)) return [];
  const operators = ['<=', '>=', '!=', '==', '<', '>'];
  return constraints.map((expr) => {
    if (!expr || typeof expr !== 'string') return expr;
    const trimmed = expr.trim();
    const reqMatch = trimmed.match(/^(.+?)\s+requires\s+(.+)$/);
    if (reqMatch) {
      const left = reqMatch[1].trim();
      const right = reqMatch[2].trim();
      return `${left === oldKey ? newKey : left} requires ${right === oldKey ? newKey : right}`;
    }
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
  });
}

export function constraintRefsKey(expr: string, key: string): boolean {
  if (!expr || typeof expr !== 'string') return false;
  const trimmed = expr.trim();
  const reqMatch = trimmed.match(/^(.+?)\s+requires\s+(.+)$/);
  if (reqMatch) return reqMatch[1].trim() === key || reqMatch[2].trim() === key;
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

type RuleMap = Record<string, Record<string, unknown>>;

function getGroupTs(rule: Record<string, unknown> | undefined): string {
  if (!rule || typeof rule !== 'object') return 'ungrouped';
  const ui = rule.ui as Record<string, unknown> | undefined;
  if (ui && typeof ui === 'object' && ui.group) return String(ui.group);
  return String(rule.group || 'ungrouped');
}

export function deriveGroupsTs(fieldOrder: string[], _ruleMap: RuleMap): [string, string[]][] {
  const groups: [string, string[]][] = [];
  let currentGroup: string | null = null;
  let currentKeys: string[] = [];

  for (const item of fieldOrder) {
    if (item.startsWith('__grp::')) {
      if (currentGroup !== null || currentKeys.length > 0) {
        groups.push([currentGroup || 'ungrouped', currentKeys]);
      }
      currentGroup = item.slice(7);
      currentKeys = [];
      continue;
    }
    currentKeys.push(item);
  }

  if (currentGroup !== null || currentKeys.length > 0) {
    groups.push([currentGroup || 'ungrouped', currentKeys]);
  }

  return groups;
}

export function reorderFieldOrder(fieldOrder: string[], activeItem: string, overItem: string): string[] {
  if (activeItem === overItem) return fieldOrder;
  const activeIdx = fieldOrder.indexOf(activeItem);
  const overIdx = fieldOrder.indexOf(overItem);
  if (activeIdx < 0 || overIdx < 0) return fieldOrder;
  const next = [...fieldOrder];
  next.splice(overIdx, 0, next.splice(activeIdx, 1)[0]);
  return next;
}

export function syncGroupsFromOrder(fieldOrder: string[], ruleMap: RuleMap): RuleMap {
  let currentGroup = 'ungrouped';
  const updated: RuleMap = { ...ruleMap };
  for (const item of fieldOrder) {
    if (item.startsWith('__grp::')) {
      currentGroup = item.slice(7);
      continue;
    }
    const rule = updated[item];
    if (!rule) continue;
    const existingGroup = getGroupTs(rule);
    if (existingGroup !== currentGroup) {
      const ui = { ...((rule.ui || {}) as Record<string, unknown>), group: currentGroup };
      updated[item] = { ...rule, ui, group: currentGroup, _edited: true };
    }
  }
  return updated;
}

export function validateNewGroupTs(name: string, existingGroups: string[]): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Group name must not be empty';
  if (trimmed.length > 64) return 'Group name must be 64 characters or fewer';
  if (existingGroups.some(g => g.toLowerCase() === trimmed.toLowerCase())) return 'A group with this name already exists';
  return null;
}

export interface BulkKeyRow {
  rowNumber: number;
  raw: string;
  key: string;
  label: string;
  status: 'ready' | 'duplicate_existing' | 'duplicate_in_paste' | 'invalid';
  reason: string;
}

export function parseBulkKeyLine(rawLine: string): { key: string; label: string } {
  const cleaned = rawLine.replace(/^\uFEFF/, '').replace(/^[-*\u2022\d.)\s]+/, '').trim();
  if (!cleaned) return { key: '', label: '' };
  const delimiters = ['\t', '|', ';'];
  for (const d of delimiters) {
    const idx = cleaned.indexOf(d);
    if (idx > 0) {
      return { key: cleaned.slice(0, idx).trim(), label: cleaned.slice(idx + 1).trim() };
    }
  }
  return { key: cleaned, label: '' };
}

function isHeaderRow(key: string, label: string): boolean {
  const k = key.toLowerCase();
  const l = label.toLowerCase();
  return (k === 'key' || k === 'keys' || k === 'field' || k === 'field_key')
    && (l === 'label' || l === 'labels' || l === 'name' || l === 'display' || l === '');
}

export function validateBulkRows(
  lines: string[],
  existingKeys: string[],
  existingLabels: string[],
): BulkKeyRow[] {
  const existingKeySet = new Set(existingKeys.map(k => k.toLowerCase()));
  const existingLabelSet = new Set(existingLabels.map(l => l.toLowerCase()));
  const seenKeys = new Set<string>();
  const seenLabels = new Set<string>();

  return lines.map((raw, idx) => {
    const { key: rawKey, label: rawLabel } = parseBulkKeyLine(raw);
    const row: BulkKeyRow = { rowNumber: idx + 1, raw, key: rawKey, label: rawLabel, status: 'ready', reason: 'Ready' };

    if (!rawKey) {
      row.status = 'invalid';
      row.reason = 'Key is empty';
      return row;
    }

    if (isHeaderRow(rawKey, rawLabel)) {
      row.status = 'invalid';
      row.reason = 'Header row';
      return row;
    }

    const keyErr = validateNewKeyTs(rawKey, []);
    if (keyErr && keyErr !== 'A key with this name already exists') {
      row.status = 'invalid';
      row.reason = keyErr;
      return row;
    }

    const keyLower = rawKey.toLowerCase();
    if (existingKeySet.has(keyLower)) {
      row.status = 'duplicate_existing';
      row.reason = 'Key already exists';
      return row;
    }

    if (seenKeys.has(keyLower)) {
      row.status = 'duplicate_in_paste';
      row.reason = 'Duplicate within paste';
      return row;
    }

    const effectiveLabel = rawLabel || rawKey.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const labelLower = effectiveLabel.toLowerCase();
    if (existingLabelSet.has(labelLower) || seenLabels.has(labelLower)) {
      row.status = 'invalid';
      row.reason = 'Label already exists';
      return row;
    }

    row.label = effectiveLabel;
    seenKeys.add(keyLower);
    seenLabels.add(labelLower);
    return row;
  });
}
