export interface ReviewLayoutRow {
  excel_row: number | null;
  group: string;
  key: string;
  label: string;
  field_rule: {
    type: string;
    required: boolean;
    units: string | null;
    enum_name: string | null;
    component_type: string | null;
    enum_source: string | null;
  };
}

export interface ReviewLayout {
  category: string;
  excel: {
    workbook: string;
    workbook_path: string;
    sheet: string;
    key_range: string;
    brand_key_cell: string;
    model_key_cell: string;
  };
  rows: ReviewLayoutRow[];
}

export interface CandidateEvidence {
  url: string;
  retrieved_at: string;
  snippet_id: string;
  snippet_hash: string;
  quote: string;
  quote_span: number[] | null;
  snippet_text: string;
  source_id: string;
}

export interface ReviewCandidate {
  candidate_id: string;
  value: unknown;
  score: number;
  source_id: string;
  source: string;
  tier: number | null;
  method: string | null;
  evidence: CandidateEvidence;
  llm_extract_model?: string | null;
  llm_extract_provider?: string | null;
  llm_validate_model?: string | null;
  llm_validate_provider?: string | null;
}

export interface KeyReviewLaneState {
  id: number;
  selectedCandidateId?: string | null;
  primaryStatus: string | null;   // 'pending' | 'confirmed' | 'rejected' | 'not_run' | null
  primaryConfidence: number | null;
  sharedStatus: string | null;
  sharedConfidence: number | null;
  userAcceptPrimary: string | null;  // 'accepted' | null
  userAcceptShared: string | null;
  overridePrimary: boolean;
  overrideShared: boolean;
}

export interface FieldState {
  slot_id?: number | null;
  selected: {
    value: unknown;
    confidence: number;
    status: string;
    color: 'green' | 'yellow' | 'red' | 'gray';
  };
  needs_review: boolean;
  reason_codes: string[];
  candidate_count: number;
  candidates: ReviewCandidate[];
  overridden?: boolean;
  source?: string;
  source_timestamp?: string | null;
  method?: string;
  tier?: number | null;
  evidence_url?: string;
  evidence_quote?: string;
  accepted_candidate_id?: string | null;
  keyReview?: KeyReviewLaneState;
}

export interface ProductReviewPayload {
  product_id: string;
  category: string;
  identity: {
    id: number;
    identifier: string;
    brand: string;
    model: string;
    variant: string;
  };
  fields: Record<string, FieldState>;
  metrics: {
    confidence: number;
    coverage: number;
    flags: number;
    missing: number;
    has_run: boolean;
    updated_at: string;
  };
  hasRun?: boolean;
}

// ── Review Grid Overhaul types ───────────────────────────────────

export type CellMode = 'viewing' | 'selected' | 'editing';
export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';

export interface BrandFilter {
  mode: 'all' | 'none' | 'custom';
  selected: Set<string>;
}

export interface RunMetrics {
  confidence: number;
  coverage: number;
  flags: number;
  missing: number;
  count: number;
}

export interface ProductsIndexResponse {
  products: ProductReviewPayload[];
  brands: string[];
  total: number;
  metrics_run?: RunMetrics;
}

export interface CandidateResponse {
  product_id: string;
  field: string;
  candidates: ReviewCandidate[];
  candidate_count: number;
  keyReview?: KeyReviewLaneState | null;
}
