// ── Studio constants: option arrays, tooltip text, shared styles ────

// ── Shared style classes ────────────────────────────────────────────
export const selectCls = 'px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700';
export const inputCls = 'px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 placeholder:text-gray-300 dark:placeholder:text-gray-500 placeholder:italic';
export const labelCls = 'text-xs font-medium text-gray-500 dark:text-gray-400 mb-1';

// ── Dropdown option arrays ──────────────────────────────────────────
export const UNITS = ['g', 'gf', 'mm', 'Hz', 'dpi', 'ips', 'ms', 'h', 'usd', 'year', 'none'];
export const UNKNOWN_TOKENS = ['unk', 'null', 'N/A', 'none'];
export const GROUPS = [
  'general', 'connectivity', 'construction', 'controls', 'dimensions',
  'electronics', 'encoder', 'ergonomics', 'sensor_performance', 'switches',
];
export const COMPONENT_TYPES = ['sensor', 'switch', 'encoder', 'material'];
export const NORMALIZE_MODES = [
  { value: 'lower_trim', label: 'Lowercase + Trim' },
  { value: 'raw', label: 'Raw (as-is)' },
  { value: 'lower', label: 'Lowercase only' },
];
export const PREFIXES = ['$', 'EUR', 'GBP', '#'];
export const SUFFIXES = [...UNITS, '%', 'x'];

// ── Tag-picker suggestion arrays ────────────────────────────────────
export const DOMAIN_HINT_SUGGESTIONS = [
  'manufacturer', 'rtings.com', 'techpowerup.com', 'support', 'manual', 'pdf', 'datasheet',
];
export const CONTENT_TYPE_SUGGESTIONS = [
  'spec_sheet', 'datasheet', 'review', 'manual', 'pdf', 'product_page', 'support', 'forum',
];
export const UNIT_ACCEPTS_SUGGESTIONS = [
  'g', 'grams', 'gram', 'gr', 'mm', 'millimeters', 'Hz', 'hertz', 'dpi', 'ips', 'ms', 'milliseconds', 'h', 'hours',
];
// ── Tier definitions for TierPicker ─────────────────────────────────
export const TIER_DEFS = [
  { id: 'tier1', label: 'Tier 1 \u2013 Manufacturer (OEM specs)' },
  { id: 'tier2', label: 'Tier 2 \u2013 Lab / Independent tests' },
  { id: 'tier3', label: 'Tier 3 \u2013 Retailer (store listings)' },
  { id: 'tier4', label: 'Tier 4 \u2013 Community (forums/reviews)' },
  { id: 'tier5', label: 'Tier 5 \u2013 Aggregator (comparison sites)' },
] as const;

// ── Tooltip text for every studio input ─────────────────────────────
export const STUDIO_TIPS: Record<string, string> = {
  // Tab 1: Mapping Studio
  tooltip_bank_file: 'Path to a JS/JSON/MD file with tooltip text for field keys. Auto-discovered if matching hbs_tooltips*.',
  tooltip_section_tooltip_bank: 'Tooltips source controls the shared tooltip reference file used for field guidance.',
  tooltip_section_component_sources: 'Component Source Mapping stores component identity aliases, links, and attributes used for matching.',
  tooltip_section_enums: 'Enum lists define canonical values for fields and drive enum validation and suggestions.',
  component_type: 'Type of component this sheet describes (sensor, switch, encoder, material). Used as the component reference key.',
  comp_field_key: 'Select a field key to bind this component attribute to. Type, unit, parse template, and evidence rules are inherited from the field key definition.',
  comp_variance_policy: 'How the component DB value relates to the product spec value.\n\n'
    + 'authoritative \u2014 Component value IS the product value (default).\n'
    + 'upper_bound \u2014 Component gives the maximum possible value.\n'
    + 'lower_bound \u2014 Component gives the minimum value.\n'
    + 'range \u2014 Component provides reference range (\u00b1tolerance).',
  comp_override_allowed: 'When checked, products are allowed to have different values for this property without triggering review flags.\n\n'
    + 'Matching: Property comparison still runs during component identification but with reduced confidence (0.60 vs 0.85).\n'
    + 'Review Grid: Variance enforcement is skipped entirely \u2014 no violation flags, no review needed.\n'
    + 'Cascade: When this component property changes, propagation to linked products is lowest priority.\n\n'
    + 'Use this for properties that can legitimately vary per product implementation, '
    + 'e.g. a sensor supports 30K DPI but the product firmware limits it to 26K.',
  comp_tolerance: 'Numeric tolerance for upper_bound/lower_bound policies. E.g. tolerance=5 means \u00b15 from the component value.',
  comp_constraints: 'Cross-field validation rules. E.g. "component_release_date <= product_release_date" ensures the component existed before the product.',

  // Enums
  data_list_field: 'Enum bucket name (e.g. "form_factor"). Becomes the data_lists.{name} reference used by enum sources.',
  data_list_normalize: 'How to normalize enum values. Lowercase + Trim is recommended.',
  data_list_manual_values: 'Enum values for this field. Used during extraction and validation.',

  // Tab 2: Key Navigator - Contract
  key_section_contract: 'Contract defines the field data type, shape, unit, and numeric formatting applied during parsing and reporting.',
  data_type: 'Fundamental data type. string: text, number: decimal, integer: whole, boolean: yes/no, date, url, enum: from a fixed set, component_ref: links to component DB.',
  shape: 'Value cardinality. scalar: single value, list: array, structured: nested object, key_value: dictionary.',
  contract_unit: 'Measurement unit for numeric fields (g, mm, Hz, dpi, ms). Blank for non-numeric.',
  unknown_token: 'Placeholder value when data can\'t be determined. Appears in output for unavailable data.',
  rounding_decimals: 'Decimal places for rounding numeric values. 0 = integer. Only affects number/integer types.',
  rounding_mode: 'nearest: standard rounding, floor: always down, ceil: always up.',
  require_unknown_reason: 'If checked, setting a value to the unknown token requires an explanation of why the data is unavailable.',

  // Tab 2: Key Navigator - Priority
  key_section_priority: 'Priority, availability, difficulty, and effort settings drive extraction urgency and scheduling of this field.',
  required_level: 'Field importance. identity: product ID, required/critical: essential, expected: should exist, optional: nice-to-have, editorial: narrative, commerce: pricing.',
  availability: 'How often this data exists. always: every product, expected: most, sometimes: ~half, rare: few, editorial_only: reviews only.',
  difficulty: 'Extraction difficulty. easy: directly stated, medium: some inference, hard: buried/inconsistent, instrumented: needs physical measurement.',
  effort: 'Relative extraction effort. 1 = trivial lookup, 10 = multi-source synthesis. Affects pipeline scheduling.',
  publish_gate: 'If checked, this field MUST have a non-unknown value before the product spec can be published.',
  block_publish_when_unk: 'If checked, products with this field set to the unknown token cannot be published.',

  // Tab 2: Key Navigator - Parse
  key_section_parse: 'Parse rules control how source text is interpreted and converted into this field\'s stored value.',
  parse_template: 'Parse Template defines the output type/shape (boolean/number/list/url/component). Boolean templates auto-lock enums to Yes/No. Component_reference templates auto-set alias matching. All other templates leave enum fully configurable.',
  parse_unit: 'Default unit assumed when source text has no explicit unit. E.g. \'g\' so \'80\' becomes \'80 g\'. Only shown for number-based templates.',
  unit_accepts: 'Unit variations the parser recognizes. E.g. for grams: g, grams, gram, gr. Only shown for number-based templates.',
  allow_unitless: 'Accept numbers without a unit. The Parse Unit is assumed.',
  allow_ranges: 'Accept range values like \'60-80 g\' or \'100~200 mm\'.',
  strict_unit_required: 'Values MUST include a unit suffix. Rejects bare numbers. Overrides Allow unitless.',

  // Tab 2: Key Navigator - Enum
  key_section_enum: 'Enum policy and enum source define accepted vocabulary, matching behavior, and suggestions for this field.',
  enum_policy: 'Enum Policy controls vocabulary matching after parsing. closed: requires a known list, rejects unknowns. open_prefer_known: prefers known values but accepts new evidence-backed values and queues them as suggestions. open: accepts any value (valid for all field types including number, url, date). For boolean fields, this is auto-locked to closed/yes_no.',
  enum_source: 'Enum value list source. Use data_lists.{name} for enum lists (e.g. data_lists.shape), component_db.{type} for component names (e.g. component_db.sensor), or yes_no for boolean enums.',
  match_strategy: 'alias: match known aliases and name variants. exact: exact string match only. fuzzy: similarity scoring with configurable threshold.',
  fuzzy_threshold: 'Similarity score (0.0-1.0) for fuzzy matching. 0.92 = 92% similar required. Higher = stricter.',

  // Tab 2: Key Navigator - Enum (expanded)
  enum_value_source: 'Where enum values come from. Manual: type values directly. Enum: link to an existing enum list from the Mapping Studio (data_lists.*).',
  enum_detected_values: 'Values currently in the known_values list for this field. Blue = from canonical source. Amber = discovered during pipeline runs (not yet in canonical list).',
  enum_add_values: 'Manually add known values. Only available when Enum Policy is open or open_prefer_known, or when editing the canonical allowlist in closed mode. New values found by the pipeline appear separately and can be promoted.',
  enum_component_values: 'Entity names from the component database. Shows all components of this type with their maker and aliases.',

  // Tab 2: Key Navigator - Evidence
  key_section_evidence: 'Evidence settings determine proof requirements and confidence thresholds for accepting values for this field.',
  evidence_required: 'If checked, every value must cite at least one source reference (URL + snippet).',
  min_evidence_refs: 'Minimum distinct source references needed to accept a value. Higher = more confident but more unknowns.',
  conflict_policy: 'resolve_by_tier_else_unknown: use tier ranking, fall back to unknown. prefer_highest_tier: always trust best tier. prefer_most_recent: newest source. flag_for_review: mark for manual review.',
  tier_preference: 'Source trust ordering. Tier 1 (Manufacturer): OEM specs. Tier 2 (Lab): independent tests. Tier 3 (Retailer): store listings. Tier 4 (Community): forums/reviews. Tier 5 (Aggregator): comparison sites.',

  // Tab 2: Key Navigator - UI & Display
  key_section_ui: 'UI controls determine how the field is displayed and edited in generated product views.',
  ui_label: 'Human-readable display name shown in UI and reports (e.g. \'Weight\' instead of \'weight_grams\').',
  ui_group: 'Category for organizing fields in the sidebar and reports. Fields with the same group appear together.',
  input_control: 'UI widget for manual editing. text: free text, number: spinner, select: dropdown, checkbox: toggle, token_list: tag input, text_list: multiline, date: date picker.',
  display_mode: 'When to show this field. all: always, summary: compact views only, detailed: expanded views only.',
  ui_suffix: 'Text after the value in display (e.g. \'g\' for \'80 g\'). Usually matches the unit.',
  ui_prefix: 'Text before the value (e.g. \'$\' for \'$59.99\').',
  display_decimals: 'Decimal places for display rendering. Does not affect stored precision.',
  ui_order: 'Sort position within its group. Lower = first. Same order = alphabetical.',
  tooltip_guidance: 'Markdown tooltip shown when users hover this field in the final spec output. Describe meaning and interpretation.',
  aliases: 'Alternative names for this field key. Used for fuzzy matching across sources with different naming.',

  // Tab 2: Key Navigator - Search Hints
  key_section_search: 'Search hints bias crawling and extraction by prioritizing domains, content types, and query terms.',
  domain_hints: 'Preferred website domains/types. E.g. \'manufacturer\' for OEM sites, or specific domains like \'rtings.com\'.',
  content_types: 'Content types most likely to have this data. E.g. spec_sheet, datasheet, review, manual, pdf.',
  query_terms: 'Extra search terms for this field. E.g. for polling_rate: \'report rate\', \'USB poll rate\'.',

  // Tab 2: Key Navigator - Component
  key_section_components: 'Component settings control matching and inference from component databases.',
  key_section_constraints: 'Cross-field constraints enforce logical relationships and consistency checks between this field and others.',
  component_db: 'Links this field to a component database (sensor, switch, encoder, material). Pipeline looks up component data alongside product data.',
  comp_match_fuzzy_threshold: 'Minimum string similarity (0-1) for a component name to be considered a fuzzy match candidate. Default 0.75 means 75% character similarity required. Lower = more candidates but more false matches.',
  comp_match_name_weight: 'How much the name similarity score counts in the combined matching score (0-1). Default 0.4 = 40% from name. The rest comes from property_weight. Higher = name matters more than property comparison.',
  comp_match_property_weight: 'How much property value comparison counts in the combined matching score (0-1). Default 0.6 = 60% from properties. Uses the property_keys list to compare extracted product values against known component DB values.',
  comp_match_auto_accept_score: 'Combined score threshold (0-1) for auto-accepting a component match without human review. Default 0.95. Matches above this are confirmed automatically. Lower = more auto-accepts but higher risk of wrong matches.',
  comp_match_flag_review_score: 'Combined score threshold (0-1) for flagging a match for human/AI review. Default 0.65. Between this and auto_accept_score = provisional match queued for review. Below this = rejected (or new component if allow_new_components is on).',
  comp_match_property_keys: 'Which product field keys to compare against component DB properties during matching. E.g. for a sensor: dpi, ips, acceleration. The engine compares extracted values against known component values using variance-aware numeric comparison.',
  comp_allow_new: 'If enabled, the pipeline can suggest new components not in the database when no fuzzy match meets the flag_review_score threshold. Suggestions are flagged for review. If disabled, unmatched values are rejected.',
  comp_require_identity_evidence: 'If enabled, component identity matching requires supporting evidence from at least one source. Prevents phantom component assignments from noisy extraction.',

  // Tab 2: Key Navigator - AI Assist
  ai_mode: 'Controls how aggressively the LLM extracts this field.\n\n'
    + 'off — No LLM. Deterministic extraction only (pattern matching, component DB lookup). No API cost.\n'
    + 'advisory — gpt-5-low only. Single extraction pass, no verification, no escalation. Cheapest LLM option.\n'
    + 'planner — Starts with gpt-5-low. If conflicts or low confidence, escalates to gpt-5.2-high (reasoning). Balanced cost/quality.\n'
    + 'judge — gpt-5.2-high (reasoning) from the start. Full conflict resolution, evidence audit, multi-source verification. Highest quality but most expensive.\n\n'
    + 'Auto-derive: identity/required/critical → judge, expected+hard → planner, expected+easy/medium → advisory, optional → off.',
  ai_model_strategy: 'Override which model tier is used, regardless of mode.\n\n'
    + 'auto — Let the mode decide: advisory uses fast model, judge uses reasoning model, planner escalates as needed.\n'
    + 'force_fast — Always use gpt-5-low, even in judge mode. Saves cost but reduces accuracy on complex fields.\n'
    + 'force_deep — Always use gpt-5.2-high (reasoning), even in advisory mode. Best accuracy but higher cost.',
  ai_max_calls: 'Maximum LLM API calls for this field across ALL extraction rounds. Once exhausted, the field stops getting LLM attention.\n\n'
    + 'Auto-derive from effort: effort 1-3 → 1 call, effort 4-6 → 2 calls, effort 7-10 → 3 calls.\n'
    + 'Higher values = more chances to extract but more cost. Max 10.',
  ai_max_tokens: 'Maximum output tokens per LLM call for this field. Controls how much reasoning/output the model can produce.\n\n'
    + 'Auto-derive from AI mode:\n'
    + '• off → 0 (no LLM calls)\n'
    + '• advisory → 4,096 tokens (fast extraction)\n'
    + '• planner → 8,192 tokens (escalation headroom)\n'
    + '• judge → 16,384 tokens (full reasoning)\n\n'
    + 'When multiple fields are in one batch, the highest max_tokens across all fields is used for the API call.\n'
    + 'Global ceiling: LLM_REASONING_BUDGET (env) for reasoning calls, LLM_MAX_TOKENS for fast calls.',
  ai_reasoning_note: 'Extraction guidance injected directly into the LLM prompt for this field. The AI reads this note when deciding how to extract the value.\n\n'
    + 'When empty, guidance is auto-generated from field properties (data type, difficulty, evidence requirements, enum policy, component type).\n\n'
    + 'Examples:\n'
    + '• "Check manufacturer spec sheets first, this value is often in PDF datasheets not web pages"\n'
    + '• "This is a calculated field: polling rate = 1000/response_time_ms"\n'
    + '• "Multiple conflicting values are common — prefer tier 1 manufacturer specs over reviews"\n\n'
    + 'Write a custom note to override the auto-generated guidance.',

  // Tab 3: Field Rules Workbench
  field_contract_table: 'Read-only overview of all field contracts. Edit fields in the Key Navigator tab.',

  // Tab 4: Compile & Reports
  run_compile: 'Generates all pipeline artifacts from current configuration. Check Indexing Lab process output for progress.',
  compile_errors: 'Fatal issues preventing artifact generation. Must be resolved.',
  compile_warnings: 'Non-fatal issues. Review and fix when possible.',
  generated_artifacts: 'Files from the last successful compile. These drive the extraction pipeline.',
  guardrails_report: 'Automated validation checking field rules for consistency and completeness.',
};
