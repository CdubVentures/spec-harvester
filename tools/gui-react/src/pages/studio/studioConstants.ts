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
export const ENUM_SOURCES = [
  'yes_no',
  'data_lists.coating', 'data_lists.connection', 'data_lists.connectivity',
  'data_lists.feet_material', 'data_lists.form_factor', 'data_lists.front_flare',
  'data_lists.hump', 'data_lists.lighting', 'data_lists.mcu',
  'data_lists.sensor_type', 'data_lists.shape', 'data_lists.switch_type',
  'component_db.encoder', 'component_db.material', 'component_db.sensor', 'component_db.switch',
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
export const AZ_COLUMNS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

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
  workbook_file: 'Path to the Excel workbook (.xlsx/.xlsm) containing your product spec data. Relative to the helper_files directory.',
  key_sheet: 'Worksheet containing field key names in a single column. These become the spec attributes the pipeline extracts.',
  key_column: 'Column letter in the key sheet that lists field key names.',
  first_key_row: 'Row number where the first field key appears. Rows above are headers.',
  last_key_row: 'Last row with a field key. Set to 0 to auto-detect (stops at first blank cell).',
  sampling_sheet: 'Worksheet with product data columns. In matrix layout, each column is one product.',
  layout: 'How product data is arranged. Matrix: one product per column. Row Table: one product per row. None: no product table.',
  value_start_column: 'First column containing product data values (after the key column).',
  brand_row: 'Row number containing brand names for product identification.',
  model_row: 'Row number containing model names. Used with brand to identify products.',
  variant_row: 'Row for variant identifiers (color, size). Set to 0 if no variants.',
  id_row: 'Row containing numeric product IDs (sequential integers). Set to 0 if not present. In scratch mode, auto-set to row 2.',
  identifier_row: 'Row containing unique product identifiers (8-char hex strings). Set to 0 if not present. In scratch mode, auto-set to row 3.',
  value_end_column: 'Last column with product data. Leave empty to auto-detect.',
  tooltip_bank_file: 'Path to a JS/JSON/MD file with tooltip text for field keys. Auto-discovered if matching hbs_tooltips*.',
  scratch_mode: 'Scratch mode: building a component source from scratch (no workbook loaded). Header row is locked to 1, data row to 2. All role columns are visible. Columns auto-assign A, B, C, etc.',
  component_type: 'Type of component this sheet describes (sensor, switch, encoder, material). Used as the component reference key.',
  comp_sheet: 'Worksheet containing this component\'s data table.',
  header_row: 'Row number with column headers for the component table.',
  first_data_row: 'First row of actual component data (row after headers).',
  stop_after_blank_primary: 'Number of consecutive blank rows in the primary column before the reader stops. Prevents reading past the end of data.',
  primary_identifier: 'Column with the unique name for each component (e.g. sensor model name). Required.',
  auto_derive_aliases: 'Automatically generate name variants from the primary identifier (acronyms, shortened forms).',
  maker_column: 'Column with the manufacturer/brand for each component.',
  aliases_columns: 'Columns with alternative names for components. Each column provides one name variant.',
  reference_url_columns: 'Columns with URLs to datasheets, spec pages, or documentation.',
  // Component Attribute Mapping
  comp_field_key: 'Select a field key to bind this component attribute to. Type, unit, parse template, and evidence rules are inherited from the field key definition.',
  comp_column: 'Excel column containing this attribute\'s values. In Auto mode, the system matches the field key name against sheet headers.',
  comp_variance_policy: 'How the component DB value relates to the product spec value.\n\n'
    + 'authoritative \u2014 Component value IS the product value (default).\n'
    + 'upper_bound \u2014 Component gives the maximum possible value.\n'
    + 'lower_bound \u2014 Component gives the minimum value.\n'
    + 'range \u2014 Component provides reference range (\u00b1tolerance).\n'
    + 'override_allowed \u2014 Component is default, product can override.',
  comp_tolerance: 'Numeric tolerance for upper_bound/lower_bound policies. E.g. tolerance=5 means \u00b15 from the component value.',
  comp_constraints: 'Cross-field validation rules. E.g. "component_release_date <= product_release_date" ensures the component existed before the product.',
  comp_mode: 'Auto: system matches field key to sheet header automatically (99% path).\nManual: create a new header + choose output column placement.',

  // Data Lists
  data_list_field: 'Enum bucket name (e.g. "form_factor"). Becomes the data_lists.{name} reference used by enum sources.',
  data_list_mode: 'Workbook: import values from an Excel column. Scratch: define values manually without a workbook column.',
  data_list_sheet: 'Worksheet containing the enum values in a column.',
  data_list_column: 'Column letter containing the enum values.',
  data_list_normalize: 'How to normalize values read from the workbook. Lowercase + Trim is recommended.',
  data_list_delimiter: 'Optional delimiter to split cell values (e.g. "," or ";"). Leave empty if each cell contains one value.',
  data_list_manual_values: 'Manually defined values. In workbook mode, these are merged with workbook values during compile.',
  data_list_compiled_values: 'Values from the last compile. Blue = from workbook/canonical source. Green = manual additions. Compile to refresh.',

  // Tab 2: Key Navigator - Contract
  data_type: 'Fundamental data type. string: text, number: decimal, integer: whole, boolean: yes/no, date, url, enum: from a fixed set, component_ref: links to component DB.',
  shape: 'Value cardinality. scalar: single value, list: array, structured: nested object, key_value: dictionary.',
  contract_unit: 'Measurement unit for numeric fields (g, mm, Hz, dpi, ms). Blank for non-numeric.',
  unknown_token: 'Placeholder value when data can\'t be determined. Appears in output for unavailable data.',
  rounding_decimals: 'Decimal places for rounding numeric values. 0 = integer. Only affects number/integer types.',
  rounding_mode: 'nearest: standard rounding, floor: always down, ceil: always up.',
  require_unknown_reason: 'If checked, setting a value to the unknown token requires an explanation of why the data is unavailable.',

  // Tab 2: Key Navigator - Priority
  required_level: 'Field importance. identity: product ID, required/critical: essential, expected: should exist, optional: nice-to-have, editorial: narrative, commerce: pricing.',
  availability: 'How often this data exists. always: every product, expected: most, sometimes: ~half, rare: few, editorial_only: reviews only.',
  difficulty: 'Extraction difficulty. easy: directly stated, medium: some inference, hard: buried/inconsistent, instrumented: needs physical measurement.',
  effort: 'Relative extraction effort. 1 = trivial lookup, 10 = multi-source synthesis. Affects pipeline scheduling.',
  publish_gate: 'If checked, this field MUST have a non-unknown value before the product spec can be published.',
  block_publish_when_unk: 'If checked, products with this field set to the unknown token cannot be published.',

  // Tab 2: Key Navigator - Parse
  parse_template: 'Parse Template defines the output type/shape (boolean/number/list/url/component). This controls which Enum options are valid. Boolean templates lock enums to Yes/No. Number/URL/date templates disable enums. Text/token_list templates enable full enum configuration. Component_reference templates enable the Component DB tab.',
  parse_unit: 'Default unit assumed when source text has no explicit unit. E.g. \'g\' so \'80\' becomes \'80 g\'. Only shown for number-based templates.',
  unit_accepts: 'Unit variations the parser recognizes. E.g. for grams: g, grams, gram, gr. Only shown for number-based templates.',
  allow_unitless: 'Accept numbers without a unit. The Parse Unit is assumed.',
  allow_ranges: 'Accept range values like \'60-80 g\' or \'100~200 mm\'.',
  strict_unit_required: 'Values MUST include a unit suffix. Rejects bare numbers. Overrides Allow unitless.',

  // Tab 2: Key Navigator - Enum
  enum_policy: 'Enum Policy controls vocabulary matching after parsing. closed: requires a known list, rejects unknowns. open_prefer_known: prefers known values but accepts new evidence-backed values and queues them as suggestions. open: accepts any value. For boolean fields, this is locked to yes/no. For number/url/date fields, enums are disabled.',
  enum_source: 'Enum value list source. Use data_lists.{name} for workbook-defined lists (e.g. data_lists.shape), component_db.{type} for component names (e.g. component_db.sensor), or yes_no for boolean enums.',
  match_strategy: 'alias: match known aliases and name variants. exact: exact string match only. fuzzy: similarity scoring with configurable threshold.',
  fuzzy_threshold: 'Similarity score (0.0-1.0) for fuzzy matching. 0.92 = 92% similar required. Higher = stricter.',

  // Tab 2: Key Navigator - Enum (expanded)
  enum_value_source: 'Where enum values come from. Workbook Sheet: pull values from an Excel column header. Manual: type values directly (enabled when policy is open/open_prefer_known). Component DB: use entity names from the component database (sensor, switch, encoder, material).',
  enum_detected_values: 'Values currently in the known_values list for this field. Blue = from workbook/canonical source. Amber = discovered during pipeline runs (not yet in canonical list).',
  enum_add_values: 'Manually add known values. Only available when Enum Policy is open or open_prefer_known, or when editing the canonical allowlist in closed mode. New values found by the pipeline appear separately and can be promoted.',
  enum_observed_values: 'Values observed during pipeline runs that are NOT in the canonical list. These can be promoted to manual values or mapped as aliases.',
  enum_component_values: 'Entity names from the component database. Shows all components of this type with their maker and aliases.',

  // Tab 2: Key Navigator - Evidence
  evidence_required: 'If checked, every value must cite at least one source reference (URL + snippet).',
  min_evidence_refs: 'Minimum distinct source references needed to accept a value. Higher = more confident but more unknowns.',
  conflict_policy: 'resolve_by_tier_else_unknown: use tier ranking, fall back to unknown. prefer_highest_tier: always trust best tier. prefer_most_recent: newest source. flag_for_review: mark for manual review.',
  tier_preference: 'Source trust ordering. Tier 1 (Manufacturer): OEM specs. Tier 2 (Lab): independent tests. Tier 3 (Retailer): store listings. Tier 4 (Community): forums/reviews. Tier 5 (Aggregator): comparison sites.',

  // Tab 2: Key Navigator - UI & Display
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
  domain_hints: 'Preferred website domains/types. E.g. \'manufacturer\' for OEM sites, or specific domains like \'rtings.com\'.',
  content_types: 'Content types most likely to have this data. E.g. spec_sheet, datasheet, review, manual, pdf.',
  query_terms: 'Extra search terms for this field. E.g. for polling_rate: \'report rate\', \'USB poll rate\'.',

  // Tab 2: Key Navigator - Component
  component_db: 'Links this field to a component database (sensor, switch, encoder, material). Pipeline looks up component data alongside product data.',

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
  workbench_preset: 'Column presets show different subsets of the ~30 field properties. Use Minimal for a quick overview, or All to see everything.',
  workbench_inline_edit: 'Click a Required Level, Parse Template, or Enum Policy cell to edit inline. Publish Gate toggles on click.',
  workbench_bulk_edit: 'Select multiple rows with checkboxes, then use the floating bar to apply changes to all selected fields at once.',
  workbench_compile_status: 'Green = no issues. Yellow = warnings. Red = errors. Hover for details. Run Compile to refresh.',

  // Tab 4: Workbook Context
  workbook_map_config: 'Current workbook mapping. Edit in Mapping Studio tab.',
  sheet_previews: 'Live sheet data from the configured workbook.',
  product_catalog: 'Products from the workbook product table.',
  ui_field_catalog: 'Generated UI configuration from field rules.',

  // Tab 5: Compile & Reports
  run_compile: 'Generates all pipeline artifacts from current configuration. Check Indexing Lab process output for progress.',
  compile_errors: 'Fatal issues preventing artifact generation. Must be resolved.',
  compile_warnings: 'Non-fatal issues. Review and fix when possible.',
  generated_artifacts: 'Files from the last successful compile. These drive the extraction pipeline.',
  guardrails_report: 'Automated validation checking field rules for consistency and completeness.',
};
