// ── Workbench helpers: nested accessors + row builder ────────────────
import { humanizeField } from '../../../utils/fieldNormalize';
import type { WorkbenchRow } from './workbenchTypes';

// ── Nested accessor helpers (shared with KeyNavigatorTab) ────────────
export function getN(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce(
    (o: unknown, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
    obj,
  );
}

export function strN(obj: Record<string, unknown>, path: string, fallback = ''): string {
  const v = getN(obj, path);
  return v != null ? String(v) : fallback;
}

export function numN(obj: Record<string, unknown>, path: string, fallback = 0): number {
  const v = getN(obj, path);
  return typeof v === 'number' ? v : (parseInt(String(v), 10) || fallback);
}

export function boolN(obj: Record<string, unknown>, path: string, fallback = false): boolean {
  const v = getN(obj, path);
  return typeof v === 'boolean' ? v : fallback;
}

export function arrN(obj: Record<string, unknown>, path: string): string[] {
  const v = getN(obj, path);
  return Array.isArray(v) ? v.map(String) : [];
}

// ── setNested: mutates a rule object at a dot-path ───────────────────
export function setNested(rule: Record<string, unknown>, dotPath: string, val: unknown): void {
  const p = dotPath.split('.');
  if (p.length === 1) { rule[p[0]] = val; return; }
  if (p.length === 2) {
    const parent = { ...((rule[p[0]] || {}) as Record<string, unknown>) };
    parent[p[1]] = val;
    rule[p[0]] = parent;
    return;
  }
  if (p.length === 3) {
    const p1 = { ...((rule[p[0]] || {}) as Record<string, unknown>) };
    const p2 = { ...((p1[p[1]] || {}) as Record<string, unknown>) };
    p2[p[2]] = val;
    p1[p[1]] = p2;
    rule[p[0]] = p1;
  }
}

// ── Compile message → field key mapper ───────────────────────────────
export function mapCompileMessages(
  guardrails: Record<string, unknown> | null | undefined,
): Record<string, { errors: string[]; warnings: string[] }> {
  const map: Record<string, { errors: string[]; warnings: string[] }> = {};
  if (!guardrails) return map;

  const errors = Array.isArray(guardrails.errors) ? (guardrails.errors as string[]) : [];
  const warnings = Array.isArray(guardrails.warnings) ? (guardrails.warnings as string[]) : [];

  function extractKey(msg: string): string | null {
    // Try patterns: "field_key", Field: field_key, [field_key], field "field_key"
    const m =
      msg.match(/["']([a-z][a-z0-9_]+)["']/) ||
      msg.match(/Field:\s*(\S+)/) ||
      msg.match(/\[([a-z][a-z0-9_]+)\]/) ||
      msg.match(/field\s+(\S+)/i);
    return m ? m[1] : null;
  }

  for (const msg of errors) {
    const key = extractKey(msg);
    if (key) {
      if (!map[key]) map[key] = { errors: [], warnings: [] };
      map[key].errors.push(msg);
    }
  }
  for (const msg of warnings) {
    const key = extractKey(msg);
    if (key) {
      if (!map[key]) map[key] = { errors: [], warnings: [] };
      map[key].warnings.push(msg);
    }
  }
  return map;
}

// ── Build workbench rows from rules ──────────────────────────────────
export function buildWorkbenchRows(
  fieldOrder: string[],
  rules: Record<string, Record<string, unknown>>,
  guardrails?: Record<string, unknown> | null,
  knownValues?: Record<string, string[]>,
): WorkbenchRow[] {
  const msgMap = mapCompileMessages(guardrails);
  const kv = knownValues || {};

  return fieldOrder.map((key) => {
    const r = rules[key] || {};
    const msgs = msgMap[key];
    const compileMessages = [
      ...(msgs?.errors || []),
      ...(msgs?.warnings || []),
    ];

    return {
      key,
      displayName: strN(r, 'ui.label', strN(r, 'display_name', humanizeField(key))),
      group: strN(r, 'ui.group', strN(r, 'group', 'ungrouped')),
      requiredLevel: strN(r, 'priority.required_level', strN(r, 'required_level', 'expected')),
      availability: strN(r, 'priority.availability', strN(r, 'availability', 'expected')),
      difficulty: strN(r, 'priority.difficulty', strN(r, 'difficulty', 'easy')),
      effort: numN(r, 'priority.effort', numN(r, 'effort', 3)),

      contractType: strN(r, 'contract.type', 'string'),
      contractShape: strN(r, 'contract.shape', 'scalar'),
      contractUnit: strN(r, 'contract.unit'),
      unknownToken: strN(r, 'contract.unknown_token', 'unk'),

      parseTemplate: strN(r, 'parse.template', strN(r, 'parse_template')),
      parseUnit: strN(r, 'parse.unit'),
      unitAccepts: arrN(r, 'parse.unit_accepts').join(', '),
      allowUnitless: boolN(r, 'parse.allow_unitless'),
      allowRanges: boolN(r, 'parse.allow_ranges'),
      strictUnitRequired: boolN(r, 'parse.strict_unit_required'),

      enumPolicy: strN(r, 'enum.policy', strN(r, 'enum_policy', 'open')),
      enumSource: strN(r, 'enum.source', strN(r, 'enum_source')),
      matchStrategy: strN(r, 'enum.match.strategy', 'alias'),
      knownValuesCount: (kv[key] || []).length,

      evidenceRequired: boolN(r, 'evidence.required', boolN(r, 'evidence_required', true)),
      minEvidenceRefs: numN(r, 'evidence.min_evidence_refs', numN(r, 'min_evidence_refs', 1)),
      tierPreference: arrN(r, 'evidence.tier_preference').join(', '),
      conflictPolicy: strN(r, 'evidence.conflict_policy', 'resolve_by_tier_else_unknown'),

      publishGate: boolN(r, 'priority.publish_gate', boolN(r, 'publish_gate')),
      blockPublishWhenUnk: boolN(r, 'priority.block_publish_when_unk', boolN(r, 'block_publish_when_unk')),

      aiMode: strN(r, 'ai_assist.mode'),
      aiModelStrategy: strN(r, 'ai_assist.model_strategy', 'auto'),
      aiMaxCalls: numN(r, 'ai_assist.max_calls', 0),
      aiReasoningNote: strN(r, 'ai_assist.reasoning_note'),

      queryTermsCount: arrN(r, 'search_hints.query_terms').length,
      domainHintsCount: arrN(r, 'search_hints.domain_hints').length,
      contentTypesCount: arrN(r, 'search_hints.preferred_content_types').length,

      componentType: strN(r, 'component.type'),

      uiInputControl: strN(r, 'ui.input_control', 'text'),
      uiOrder: numN(r, 'ui.order', 0),

      draftDirty: boolN(r, '_edited'),

      hasErrors: (msgs?.errors?.length || 0) > 0,
      hasWarnings: (msgs?.warnings?.length || 0) > 0,
      compileMessages,

      _rule: r,
    };
  });
}
