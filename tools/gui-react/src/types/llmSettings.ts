export type LlmScope = 'field' | 'component' | 'list';

export interface LlmRouteRow {
  id?: number;
  category?: string;
  scope: LlmScope;
  route_key: string;
  required_level: string;
  difficulty: string;
  availability: string;
  effort: number;
  effort_band: string;
  single_source_data: boolean;
  all_source_data: boolean;
  enable_websearch: boolean;
  model_ladder_today: string;
  all_sources_confidence_repatch: boolean;
  max_tokens: number;
  studio_key_navigation_sent_in_extract_review: boolean;
  studio_contract_rules_sent_in_extract_review: boolean;
  studio_extraction_guidance_sent_in_extract_review: boolean;
  studio_tooltip_or_description_sent_when_present: boolean;
  studio_enum_options_sent_when_present: boolean;
  studio_component_variance_constraints_sent_in_component_review: boolean;
  studio_parse_template_sent_direct_in_extract_review: boolean;
  studio_ai_mode_difficulty_effort_sent_direct_in_extract_review: boolean;
  studio_required_level_sent_in_extract_review: boolean;
  studio_component_entity_set_sent_when_component_field: boolean;
  studio_evidence_policy_sent_direct_in_extract_review: boolean;
  studio_variance_policy_sent_in_component_review: boolean;
  studio_constraints_sent_in_component_review: boolean;
  studio_send_booleans_prompted_to_model: boolean;
  scalar_linked_send: string;
  component_values_send: string;
  list_values_send: string;
  llm_output_min_evidence_refs_required: number;
  insufficient_evidence_action: string;
}

export interface LlmRouteResponse {
  category: string;
  scope: string | null;
  rows: LlmRouteRow[];
}
