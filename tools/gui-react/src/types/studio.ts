export interface FieldRule {
  key?: string;
  label?: string;
  group?: string;
  required_level?: string;
  contract?: {
    type?: string;
    unit?: string;
  };
  enum_name?: string;
  ui?: {
    group?: string;
    label?: string;
    order?: number;
    aliases?: string[];
  };
  excel_hints?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface StudioPayload {
  category: string;
  fieldRules: Record<string, FieldRule>;
  fieldOrder: string[];
  uiFieldCatalog: Record<string, unknown> | null;
  guardrails?: Record<string, unknown>;
}

export interface WorkbookProduct {
  brand: string;
  model: string;
  variant: string;
  productId: string;
}

export interface WorkbookProductsResponse {
  products: WorkbookProduct[];
  brands: string[];
}

export interface WorkbookMap {
  version?: number;
  workbook_path?: string;
  sheet_roles?: Array<{ sheet: string; role: string }>;
  key_list?: {
    sheet?: string;
    source?: string;
    column?: string;
    row_start?: number;
    row_end?: number;
  };
  product_table?: {
    sheet?: string;
    layout?: string;
    id_row?: number;
    identifier_row?: number;
    brand_row?: number;
    model_row?: number;
    variant_row?: number;
    value_col_start?: string;
    value_col_end?: string;
    key_column?: string;
    sample_columns?: number;
  };
  tooltip_source?: {
    path?: string;
  };
  component_sheets?: unknown[];
  component_sources?: ComponentSource[];
  enum_lists?: EnumListEntry[];
  data_lists?: DataListEntry[];
  selected_keys?: string[];
  field_overrides?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface PriorityProfile {
  required_level?: string;
  availability?: string;
  difficulty?: string;
  effort?: number;
}

export interface AiAssistConfig {
  mode?: string | null;
  model_strategy?: string;
  max_calls?: number | null;
  max_tokens?: number | null;
  reasoning_note?: string;
}

export interface ComponentSource {
  sheet: string;
  component_type: string;
  type?: string;
  header_row: number;
  first_data_row: number;
  start_row?: number;
  stop_after_blank_primary?: number;
  auto_derive_aliases?: boolean;
  roles?: {
    primary_identifier?: string;
    maker?: string;
    aliases?: string[];
    links?: string[];
    properties?: Array<{
      field_key?: string;
      column: string;
      column_header?: string;
      mode?: 'auto' | 'manual';
      variance_policy?: 'authoritative' | 'upper_bound' | 'lower_bound' | 'range' | 'override_allowed';
      tolerance?: number | null;
      constraints?: string[];
      // Legacy fields (backward compat):
      key?: string;
      type?: string;
      unit?: string;
      manual_header?: string;
      manual_type?: string;
      manual_unit?: string;
    }>;
  };
  priority?: PriorityProfile;
  ai_assist?: AiAssistConfig;
  [k: string]: unknown;
}

export interface PreviewRow {
  row: number;
  cells: Record<string, string>;
}

export interface SheetPreview {
  name: string;
  sheet_path?: string;
  non_empty_cells: number;
  max_row: number;
  max_col: number;
  dominant_column?: string;
  dominant_column_count?: number;
  detected_roles?: string[];
  preview?: {
    columns: string[];
    rows: PreviewRow[];
  };
}

export interface IntrospectResult {
  sheets: SheetPreview[];
  suggestedMap?: WorkbookMap | null;
  error?: string;
}

export interface WorkbookMapResponse {
  file_path: string;
  map: WorkbookMap;
  error?: string;
}

export interface TooltipBankResponse {
  entries: Record<string, unknown>;
  files: string[];
  configuredPath: string;
}

export interface DraftsResponse {
  fieldRulesDraft: Record<string, unknown> | null;
  uiFieldCatalogDraft: Record<string, unknown> | null;
}

export interface ArtifactEntry {
  name: string;
  size: number;
  updated: string;
}

export interface KnownValuesResponse {
  category?: string;
  fields: Record<string, string[]>;
}

export interface EnumListEntry {
  field: string;
  sheet: string;
  value_column: string;
  header_row: number;
  row_start: number;
  row_end: number;
  normalize?: string;
  delimiter?: string;
  priority?: PriorityProfile;
  ai_assist?: AiAssistConfig;
}

export interface DataListEntry {
  field: string;
  mode: 'workbook' | 'scratch';
  // Workbook mode:
  sheet: string;
  value_column: string;
  header_row: number;
  row_start: number;
  row_end: number;
  normalize: string;
  delimiter: string;
  // Scratch mode + manual additions:
  manual_values: string[];
  priority?: PriorityProfile;
  ai_assist?: AiAssistConfig;
}

export interface ComponentDbItem {
  name: string;
  maker: string;
  aliases: string[];
}

export type ComponentDbResponse = Record<string, ComponentDbItem[]>;

export interface WorkbookContextKeyRow {
  row: number;
  group: string;
  key: string;
  label: string;
}

export interface WorkbookContextProduct {
  column: string;
  id: number | string;
  identifier: string;
  brand: string;
  model: string;
  variant: string;
  productId: string;
  inCatalog: boolean;
  hasOutput: boolean;
}

export interface WorkbookContextMapSummary {
  workbook_path: string;
  product_sheet: string;
  layout: string;
  brand_row: number;
  model_row: number;
  variant_row: number;
  key_sheet: string;
  key_column: string;
  key_row_start: number;
  key_row_end: number;
  value_col_start: string;
  tooltip_source: string;
  tooltip_file_count: number;
  component_sources_count: number;
  enum_lists_count: number;
}

export interface WorkbookContextComponentSummary {
  count: number;
  sampleNames: string[];
  sampleAliases: string[][];
  makers: string[];
  sourceSheet: string;
  nameColumn: string;
  makerColumn: string;
  aliasColumns: string[];
  linkColumns: string[];
}

export interface WorkbookContextResponse {
  mapSummary: WorkbookContextMapSummary | null;
  keys: WorkbookContextKeyRow[];
  products: WorkbookContextProduct[];
  enums: Record<string, string[]>;
  componentSummary: Record<string, WorkbookContextComponentSummary>;
  observedValues: Record<string, string[]>;
  draftEnumAdditions: Record<string, string[]>;
  generatedFieldKeys: string[];
  error?: string;
}
