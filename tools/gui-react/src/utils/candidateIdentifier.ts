function normalizeToken(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function serializePart(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hashParts(parts: unknown[]): string {
  const input = parts.map((part) => serializePart(part)).join('\u001f');
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function tokenPart(value: unknown, fallback = 'na'): string {
  const token = normalizeToken(serializePart(value));
  if (!token) {
    return fallback;
  }
  return token.length > 48 ? token.slice(0, 48) : token;
}

export function buildCandidateId(prefix: unknown, parts: unknown[] = []): string {
  const safePrefix = tokenPart(prefix, 'cand');
  const tokens = Array.isArray(parts)
    ? parts.map((part) => tokenPart(part)).filter(Boolean)
    : [tokenPart(parts)];
  const hash = hashParts([safePrefix, ...parts]);
  return [safePrefix, ...tokens, hash].join('_');
}

export function buildSyntheticGridCandidateId(args: { productId: string; fieldKey: string; value: string }): string {
  return buildCandidateId('pl_grid', [args.productId, args.fieldKey, args.value]);
}

export function buildSyntheticGridAttributeCandidateId(args: { productId: string; fieldKey: string; attributeKey: string; value: string }): string {
  return buildCandidateId('pl_grid_attr', [args.productId, args.fieldKey, args.attributeKey, args.value]);
}

export function buildSyntheticComponentCandidateId(args: { componentType: string; componentName: string; propertyKey: string; value: string }): string {
  return buildCandidateId('pl_comp', [args.componentType, args.componentName, args.propertyKey, args.value]);
}

export function buildPipelineEnumCandidateId(args: { fieldKey: string; value: string }): string {
  return buildCandidateId('pl_enum', [args.fieldKey, args.value]);
}

export function buildScopedItemCandidateId(args: {
  productId: string;
  fieldKey: string;
  rawCandidateId?: string;
  value?: string;
  sourceHost?: string;
  sourceMethod?: string;
  index?: number;
  runId?: string;
}): string {
  const pid = String(args.productId || '').trim();
  const field = String(args.fieldKey || '').trim() || 'field';
  const raw = String(args.rawCandidateId || '').trim();
  const scopedPrefix = pid ? `${pid}::${field}::` : `${field}::`;

  if (raw) {
    if (raw.startsWith(scopedPrefix)) return raw;
    if (pid && raw.startsWith(`${pid}::`)) {
      const tail = raw.slice(`${pid}::`.length);
      return tail.startsWith(`${field}::`) ? raw : `${scopedPrefix}${tail}`;
    }
    return `${scopedPrefix}${raw}`;
  }

  return buildCandidateId('item_source', [
    pid,
    field,
    String(args.value || ''),
    String(args.sourceHost || ''),
    String(args.sourceMethod || ''),
    Number.isFinite(Number(args.index)) ? Number(args.index) : 0,
    String(args.runId || ''),
  ]);
}
