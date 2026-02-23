// ── System Consumer Mapping ──────────────────────────────────────────
// Static mapping of field rule properties to downstream system consumers.
// Badge configs, field-to-system map, and helpers for consumer override logic.

export type DownstreamSystem = 'indexlab' | 'seed' | 'review';

export const SYSTEM_BADGE_CONFIGS: Record<DownstreamSystem, {
  label: string;
  title: string;
  cls: string;
  clsDim: string;
}> = {
  indexlab: {
    label: 'IDX',
    title: 'Indexing Lab',
    cls: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
    clsDim: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600 line-through',
  },
  seed: {
    label: 'SEED',
    title: 'Seed Pipeline',
    cls: 'bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300',
    clsDim: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600 line-through',
  },
  review: {
    label: 'REV',
    title: 'LLM Review',
    cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    clsDim: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600 line-through',
  },
};

type SystemSet = DownstreamSystem[];

const IDX: SystemSet = ['indexlab'];
const IDX_REV: SystemSet = ['indexlab', 'review'];
const IDX_SEED_REV: SystemSet = ['indexlab', 'seed', 'review'];
const SEED_IDX_REV: SystemSet = ['seed', 'indexlab', 'review'];
const REV: SystemSet = ['review'];

export const FIELD_SYSTEM_MAP: Record<string, SystemSet> = {
  // Contract
  'contract.type':               IDX_SEED_REV,
  'contract.shape':              IDX_SEED_REV,
  'contract.unit':               IDX_REV,
  'contract.unknown_token':      IDX,
  'contract.rounding.decimals':  IDX,
  'contract.rounding.mode':      IDX,

  // Priority
  'priority.required_level':        IDX_REV,
  'priority.availability':          IDX,
  'priority.difficulty':            IDX,
  'priority.effort':                IDX,
  'priority.publish_gate':          IDX_REV,
  'priority.block_publish_when_unk': IDX_REV,

  // AI Assist
  'ai_assist.mode':             IDX_REV,
  'ai_assist.model_strategy':   IDX,
  'ai_assist.max_calls':        IDX,
  'ai_assist.max_tokens':       IDX,
  'ai_assist.reasoning_note':   IDX,

  // Parse
  'parse.template':             IDX_REV,
  'parse.unit':                 IDX,
  'parse.unit_accepts':         IDX,
  'parse.allow_unitless':       IDX,
  'parse.allow_ranges':         IDX,
  'parse.strict_unit_required': IDX,

  // Enum
  'enum.policy':                SEED_IDX_REV,
  'enum.source':                SEED_IDX_REV,
  'enum.match.strategy':        REV,
  'enum.match.fuzzy_threshold': REV,

  // Evidence
  'evidence.required':           IDX_REV,
  'evidence.min_evidence_refs':  IDX_REV,
  'evidence.conflict_policy':    IDX_REV,
  'evidence.tier_preference':    IDX,

  // Search
  'search_hints.domain_hints':            IDX,
  'search_hints.preferred_content_types': IDX,
  'search_hints.query_terms':             IDX,

  // Deps
  'component.type':                    SEED_IDX_REV,
  'component.match.fuzzy_threshold':   REV,
  'component.match.name_weight':       REV,
  'component.match.auto_accept_score': REV,
  'component.match.flag_review_score': REV,
  'component.match.property_weight':   REV,
  'aliases':                           SEED_IDX_REV,

  // Tooltip
  'ui.tooltip_md': IDX_REV,
};

export function getFieldSystems(fieldPath: string): DownstreamSystem[] {
  return FIELD_SYSTEM_MAP[fieldPath] || [];
}

export function isConsumerEnabled(
  rule: Record<string, unknown>,
  fieldPath: string,
  system: DownstreamSystem,
): boolean {
  const consumers = rule.consumers as Record<string, Record<string, boolean>> | undefined;
  if (!consumers) return true;
  const overrides = consumers[fieldPath];
  if (!overrides) return true;
  return overrides[system] !== false;
}
