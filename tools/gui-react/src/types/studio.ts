export interface FieldRule {
  key?: string;
  label?: string;
  group?: string;
  required_level?: string;
  contract?: {
    type?: string;
    unit?: string;
    shape?: string;
  };
  parse?: {
    template?: string;
    [k: string]: unknown;
  };
  constraints?: string[];
  enum_name?: string;
  ui?: {
    group?: string;
    label?: string;
    order?: number;
    aliases?: string[];
  };
  [k: string]: unknown;
}

export interface StudioPayload {
  category: string;
  fieldRules: Record<string, FieldRule>;
  fieldOrder: string[];
  uiFieldCatalog: Record<string, unknown> | null;
  guardrails?: Record<string, unknown>;
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

export interface ComponentSourceProperty {
  field_key?: string;
  variance_policy?: 'authoritative' | 'upper_bound' | 'lower_bound' | 'range' | 'override_allowed';
  tolerance?: number | null;
  constraints?: string[];
  [k: string]: unknown;
}

export interface ComponentSource {
  type?: string;
  component_type?: string;
  roles?: {
    maker?: string;
    aliases?: string[];
    links?: string[];
    properties?: ComponentSourceProperty[];
  };
  priority?: PriorityProfile;
  ai_assist?: AiAssistConfig;
  [k: string]: unknown;
}

export interface EnumEntry {
  field: string;
  normalize?: string;
  values?: string[];
  delimiter?: string;
  manual_values?: string[];
  priority?: PriorityProfile;
  ai_assist?: AiAssistConfig;
  [k: string]: unknown;
}

export interface StudioConfig {
  version?: number;
  tooltip_source?: {
    path?: string;
  };
  component_sources?: ComponentSource[];
  enum_lists?: EnumEntry[];
  selected_keys?: string[];
  field_overrides?: Record<string, unknown>;
  manual_enum_values?: Record<string, string[]>;
  expectations?: Record<string, unknown>;
  identity?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface WorkbookMapResponse {
  file_path: string;
  map: StudioConfig;
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

export interface ComponentDbItem {
  name: string;
  maker: string;
  aliases: string[];
}

export type ComponentDbResponse = Record<string, ComponentDbItem[]>;
