import type { ReviewCandidate } from './review';

export type VariancePolicy = 'authoritative' | 'upper_bound' | 'lower_bound' | 'range' | 'override_allowed';

export interface LinkedProduct {
  product_id: string;
  field_key?: string;
  match_type?: string;
  match_score?: number | null;
}

export interface ComponentPropertyState {
  slot_id?: number | null;
  selected: {
    value: unknown;
    confidence: number;
    status: string;
    color: 'green' | 'yellow' | 'red' | 'gray' | 'purple';
  };
  needs_review: boolean;
  reason_codes: string[];
  source: string;
  source_timestamp?: string | null;
  variance_policy: VariancePolicy | null;
  constraints: string[];
  overridden: boolean;
  candidate_count: number;
  candidates: ReviewCandidate[];
  accepted_candidate_id?: string | null;
  enum_values?: string[] | null;
  enum_policy?: string | null;
}

export interface ComponentLinkTracked {
  selected: { value: string; confidence: number; status: string; color: 'green' | 'yellow' | 'red' | 'gray' };
  needs_review: boolean;
  reason_codes: string[];
  source: string;
  source_timestamp?: string | null;
  overridden: boolean;
}

export interface ComponentReviewItem {
  component_identity_id?: number | null;
  name: string;
  maker: string;
  discovered?: boolean;
  discovery_source?: string;
  aliases: string[];
  aliases_overridden: boolean;
  links: string[];
  name_tracked: ComponentPropertyState;
  maker_tracked: ComponentPropertyState;
  links_tracked: ComponentLinkTracked[];
  properties: Record<string, ComponentPropertyState>;
  linked_products?: LinkedProduct[];
  review_status: 'pending' | 'reviewed' | 'approved';
  metrics: { confidence: number; flags: number; property_count: number };
}

export interface ComponentReviewPayload {
  category: string;
  componentType: string;
  property_columns: string[];
  items: ComponentReviewItem[];
  metrics: { total: number; avg_confidence: number; flags: number };
}

export interface ComponentReviewLayout {
  category: string;
  types: Array<{ type: string; property_columns: string[]; item_count: number }>;
}

export interface EnumValueReviewItem {
  list_value_id?: number | null;
  enum_list_id?: number | null;
  value: string;
  source: 'reference' | 'workbook' | 'pipeline' | 'manual';
  source_timestamp?: string | null;
  confidence: number;
  color: 'green' | 'yellow' | 'red' | 'gray' | 'purple';
  needs_review: boolean;
  overridden?: boolean;
  candidates: ReviewCandidate[];
  linked_products?: LinkedProduct[];
  normalized_value?: string | null;
  enum_policy?: string | null;
  accepted_candidate_id?: string | null;
}

export interface EnumFieldReview {
  field: string;
  enum_list_id?: number | null;
  values: EnumValueReviewItem[];
  metrics: { total: number; flags: number };
}

export interface EnumReviewPayload {
  category: string;
  fields: EnumFieldReview[];
}

// ── AI Component Review Types ─────────────────────────────────────

export type ComponentMatchType = 'fuzzy_flagged' | 'new_component';
export type ComponentReviewStatus =
  | 'pending_ai'
  | 'accepted_alias'
  | 'pending_human'
  | 'approved_new'
  | 'rejected_ai'
  | 'dismissed';

export interface ComponentAIDecision {
  decision: 'same_component' | 'new_component' | 'reject';
  confidence: number;
  reasoning: string;
}

export interface ComponentReviewFlaggedItem {
  review_id: string;
  component_type: string;
  field_key: string;
  raw_query: string;
  matched_component: string | null;
  match_type: ComponentMatchType;
  name_score: number;
  property_score: number;
  combined_score: number;
  alternatives: Array<{ canonical_name: string; score: number }>;
  product_id: string | null;
  run_id?: string | null;
  status: ComponentReviewStatus;
  ai_decision?: ComponentAIDecision;
  ai_suggested_name?: string;
  ai_suggested_maker?: string;
  ai_reviewed_at?: string;
  created_at: string;
  product_attributes?: Record<string, unknown>;
  reasoning_note?: string;
}

export interface ComponentReviewDocument {
  version: number;
  category: string;
  items: ComponentReviewFlaggedItem[];
  updated_at: string;
}

export interface ComponentReviewBatchResult {
  processed: number;
  accepted_alias: number;
  pending_human: number;
  rejected: number;
}
