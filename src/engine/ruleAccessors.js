import { canonicalUnitToken } from './normalization-functions.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeToken(value) {
  return String(value ?? '').trim().toLowerCase();
}

// --- Priority accessors ---

export function ruleRequiredLevel(rule = {}) {
  const priority = isObject(rule.priority) ? rule.priority : {};
  return normalizeToken(priority.required_level || rule.required_level || 'optional') || 'optional';
}

export function ruleAvailability(rule = {}) {
  const priority = isObject(rule.priority) ? rule.priority : {};
  return normalizeToken(priority.availability || rule.availability || 'sometimes') || 'sometimes';
}

export function ruleDifficulty(rule = {}) {
  const priority = isObject(rule.priority) ? rule.priority : {};
  return normalizeToken(priority.difficulty || rule.difficulty || 'medium') || 'medium';
}

export function ruleEffort(rule = {}) {
  const priority = isObject(rule.priority) ? rule.priority : {};
  const raw = Number.parseFloat(String(priority.effort || rule.effort || ''));
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  const difficulty = ruleDifficulty(rule);
  if (difficulty === 'hard') return 8;
  if (difficulty === 'medium') return 5;
  if (difficulty === 'easy') return 2;
  return 3;
}

export function rulePublishGate(rule = {}) {
  const priority = isObject(rule.priority) ? rule.priority : {};
  if (priority.publish_gate !== undefined) return Boolean(priority.publish_gate);
  if (rule.publish_gate !== undefined) return Boolean(rule.publish_gate);
  return false;
}

export function ruleBlockPublishUnk(rule = {}) {
  const priority = isObject(rule.priority) ? rule.priority : {};
  if (priority.block_publish_when_unk !== undefined) return Boolean(priority.block_publish_when_unk);
  if (rule.block_publish_when_unk !== undefined) return Boolean(rule.block_publish_when_unk);
  return false;
}

// --- Contract accessors ---

export function ruleType(rule = {}) {
  const contract = isObject(rule.contract) ? rule.contract : {};
  return normalizeToken(contract.type || rule.data_type || rule.type || 'string') || 'string';
}

export function ruleShape(rule = {}) {
  const contract = isObject(rule.contract) ? rule.contract : {};
  return normalizeToken(contract.shape || rule.output_shape || rule.shape || 'scalar') || 'scalar';
}

export function ruleUnit(rule = {}) {
  const contract = isObject(rule.contract) ? rule.contract : {};
  return canonicalUnitToken(contract.unit || rule.unit || '');
}

export function ruleRange(rule = {}) {
  const contract = isObject(rule.contract) ? rule.contract : {};
  const range = isObject(contract.range) ? contract.range : {};
  return {
    min: range.min ?? null,
    max: range.max ?? null
  };
}

export function ruleListRules(rule = {}) {
  const contract = isObject(rule.contract) ? rule.contract : {};
  return contract.list_rules || rule.list_rules || null;
}

export function ruleRounding(rule = {}) {
  const contract = isObject(rule.contract) ? rule.contract : {};
  const rounding = isObject(contract.rounding) ? contract.rounding : {};
  return {
    decimals: Number.isFinite(Number(rounding.decimals)) ? Number(rounding.decimals) : 0,
    mode: normalizeToken(rounding.mode || 'nearest') || 'nearest'
  };
}

// --- Enum accessors ---

export function ruleEnumPolicy(rule = {}) {
  const enumBlock = isObject(rule.enum) ? rule.enum : {};
  return normalizeToken(enumBlock.policy || rule.enum_policy || 'open') || 'open';
}

export function ruleEnumSource(rule = {}) {
  const enumBlock = isObject(rule.enum) ? rule.enum : {};
  return enumBlock.source || rule.enum_source || null;
}

export function ruleEnumFuzzyThreshold(rule = {}) {
  const enumBlock = isObject(rule.enum) ? rule.enum : {};
  const match = isObject(enumBlock.match) ? enumBlock.match : {};
  const raw = Number(match.fuzzy_threshold ?? rule.enum_fuzzy_threshold ?? 0.75);
  return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.75;
}

// --- Evidence accessors ---

export function ruleEvidenceRequired(rule = {}) {
  const evidence = isObject(rule.evidence) ? rule.evidence : {};
  if (evidence.required !== undefined) return Boolean(evidence.required);
  if (rule.evidence_required !== undefined) return Boolean(rule.evidence_required);
  return false;
}

export function ruleMinEvidenceRefs(rule = {}) {
  const evidence = isObject(rule.evidence) ? rule.evidence : {};
  const raw = Number.parseInt(String(evidence.min_evidence_refs ?? rule.min_evidence_refs ?? 1), 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

// --- AI Assist accessors ---

const VALID_AI_MODES = new Set(['off', 'advisory', 'planner', 'judge']);

export function ruleAiMode(rule = {}) {
  const ai = isObject(rule.ai_assist) ? rule.ai_assist : {};
  const explicit = normalizeToken(ai.mode || '');
  if (explicit && VALID_AI_MODES.has(explicit)) return explicit;
  // Auto-derive from priority + difficulty
  const level = ruleRequiredLevel(rule);
  const diff = ruleDifficulty(rule);
  if (level === 'identity' || level === 'required' || level === 'critical') return 'judge';
  if (level === 'expected' && diff === 'hard') return 'planner';
  if (level === 'expected') return 'advisory';
  return 'off';
}

export function ruleAiModelStrategy(rule = {}) {
  const ai = isObject(rule.ai_assist) ? rule.ai_assist : {};
  return normalizeToken(ai.model_strategy || 'auto') || 'auto';
}

export function ruleAiMaxCalls(rule = {}) {
  const ai = isObject(rule.ai_assist) ? rule.ai_assist : {};
  const raw = Number.parseInt(String(ai.max_calls ?? ''), 10);
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw, 10);
  // Auto-derive from effort
  const effort = ruleEffort(rule);
  if (effort <= 3) return 1;
  if (effort <= 6) return 2;
  return 3;
}

export function ruleAiMaxTokens(rule = {}) {
  const ai = isObject(rule.ai_assist) ? rule.ai_assist : {};
  const raw = Number.parseInt(String(ai.max_tokens ?? ''), 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  // Auto-derive from AI mode
  const mode = ruleAiMode(rule);
  if (mode === 'off') return 0;
  if (mode === 'advisory') return 4096;
  if (mode === 'planner') return 8192;
  return 16384; // judge
}

export function ruleAiReasoningNote(rule = {}) {
  const ai = isObject(rule.ai_assist) ? rule.ai_assist : {};
  return String(ai.reasoning_note || '').trim();
}

/**
 * Auto-generate extraction guidance when no explicit reasoning_note exists.
 * Builds a concise, actionable note from the field's contract properties.
 * Never tells the AI to "slack off" — always guides toward accurate extraction.
 */
export function autoGenerateExtractionGuidance(rule = {}, fieldKey = '') {
  // If user wrote an explicit note, use it as-is
  const explicit = ruleAiReasoningNote(rule);
  if (explicit) return explicit;

  const parts = [];
  const level = ruleRequiredLevel(rule);
  const diff = ruleDifficulty(rule);
  const type = ruleType(rule);
  const shape = ruleShape(rule);
  const unit = ruleUnit(rule);
  const enumPolicy = ruleEnumPolicy(rule);
  const enumSource = ruleEnumSource(rule);
  const evidenceReq = ruleEvidenceRequired(rule);
  const minRefs = ruleMinEvidenceRefs(rule);
  const parseTemplate = ruleParseTemplate(rule);
  const componentBlock = isObject(rule.component) ? rule.component : {};
  const componentType = normalizeToken(componentBlock.type || '');

  // ── Identity fields: strict matching
  if (level === 'identity') {
    parts.push('Identity field — must exactly match the product. Do not infer or guess. Cross-reference multiple sources to confirm.');
  }

  // ── Component reference fields
  if (componentType || parseTemplate === 'component_reference') {
    const cType = componentType || (enumSource || '').replace('component_db.', '');
    parts.push(`Component reference (${cType}). Match to known component names and aliases in the database. If the exact component is not listed, provide the full name exactly as stated in the source.`);
  }

  // ── Data type guidance
  if (type === 'boolean' || parseTemplate === 'boolean' || parseTemplate.startsWith('boolean_')) {
    parts.push('Boolean field — determine yes or no from explicit evidence. If the feature is not mentioned, it likely means no, but confirm before assuming.');
  } else if ((type === 'number' || type === 'integer') && unit) {
    parts.push(`Numeric field — extract the exact value in ${unit}. Convert from other units if needed. If a range is given (e.g. "60-80"), extract the primary/default value.`);
  } else if (type === 'url') {
    parts.push('URL field — extract the full, valid URL. Prefer manufacturer or official sources.');
  } else if (type === 'date' || fieldKey.includes('date')) {
    parts.push('Date field — extract the actual date, not approximate. Prefer official announcement or first-availability dates from manufacturer sources. Distinguish announcements from ship dates.');
  } else if (type === 'string' && !componentType && !parseTemplate.startsWith('boolean_')) {
    // Generic string field — provide baseline guidance
    parts.push('Text field — extract the exact value as stated in the source. Do not paraphrase or abbreviate.');
  }

  // ── List/multi-value fields
  if (shape === 'list') {
    parts.push('This field accepts multiple values. Extract all distinct values found across sources. Do not merge variants or approximate — list each value separately.');
  }

  // ── Enum-constrained fields
  if (enumPolicy === 'closed' && enumSource) {
    parts.push(`Closed enum — value must match one of the known options from ${enumSource}. Do not invent new values.`);
  } else if (enumPolicy === 'open_prefer_known' && enumSource) {
    parts.push(`Prefer known values from ${enumSource}, but accept new values if backed by clear evidence.`);
  }

  // ── Difficulty-specific guidance
  if (diff === 'hard') {
    parts.push('This value is often inconsistent across sources or buried in technical documents. Check manufacturer spec sheets, datasheets, and PDFs first. If sources conflict, prefer the manufacturer\'s official specification.');
  } else if (diff === 'instrumented') {
    parts.push('This is a lab-measured value. Only accept values from independent test labs or reviews that explicitly state measurement methodology.');
  }

  // ── Evidence requirements
  if (evidenceReq && minRefs >= 2) {
    parts.push(`Requires ${minRefs}+ independent source references. Cross-verify across multiple sources before accepting.`);
  }

  // ── Required/critical fields: emphasize thoroughness
  if (level === 'required' || level === 'critical') {
    if (!parts.some((p) => p.includes('Identity'))) {
      parts.push('High-priority field — extract carefully from the most authoritative source available. Publication is blocked if this field is unknown.');
    }
  }

  // ── Baseline: if nothing matched, provide universal extraction guidance
  if (parts.length === 0) {
    parts.push('Extract from the most authoritative available source. Prefer manufacturer spec sheets and official product pages over third-party summaries.');
  }

  return parts.join(' ');
}

/**
 * Resolve AI mode with component inheritance.
 * If a field has a component.type (e.g., sensor, switch), it's a component "owner".
 * If a field has NO explicit ai_assist and its enum.source references component_db,
 * inherit AI mode from the owner field of that component type.
 *
 * @param {string} fieldKey - The field key to resolve
 * @param {object} allFieldRules - Map of all field rules (fieldKey → rule)
 * @returns {string} Resolved AI mode
 */
export function resolveAiModeWithInheritance(fieldKey, allFieldRules = {}) {
  const rule = allFieldRules[fieldKey] || {};
  // If field has explicit ai_assist.mode, use it directly
  const ai = isObject(rule.ai_assist) ? rule.ai_assist : {};
  const explicit = normalizeToken(ai.mode || '');
  if (explicit && VALID_AI_MODES.has(explicit)) return explicit;

  // Check if this field references a component DB via enum.source
  const enumBlock = isObject(rule.enum) ? rule.enum : {};
  const source = normalizeToken(enumBlock.source || '');
  const componentBlock = isObject(rule.component) ? rule.component : {};
  const componentType = normalizeToken(componentBlock.type || '');

  // If field IS the component owner, just use standard derivation
  if (componentType) return ruleAiMode(rule);

  // If field references component_db, find the owner field and inherit
  if (source.startsWith('component_db.')) {
    const dbType = source.replace('component_db.', '');
    for (const [key, candidateRule] of Object.entries(allFieldRules)) {
      if (!isObject(candidateRule)) continue;
      const candidateComponent = isObject(candidateRule.component) ? candidateRule.component : {};
      if (normalizeToken(candidateComponent.type || '') === dbType) {
        return ruleAiMode(candidateRule);
      }
    }
  }

  // No inheritance — fall back to standard derivation
  return ruleAiMode(rule);
}

// --- Parse accessors ---

export function ruleParseTemplate(rule = {}) {
  const parse = isObject(rule.parse) ? rule.parse : {};
  return parse.template || rule.parse_template || '';
}
