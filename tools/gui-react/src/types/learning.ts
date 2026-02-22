export interface LearningUpdate {
  field: string;
  value: string;
  confidence: number;
  refs_found: number;
  tier_history: number[];
  accepted: boolean;
  reason: string | null;
  source_run_id: string;
}

export interface LearningSuggestion {
  field: string;
  value: string;
  evidence_refs: Array<{ url: string; tier: number }>;
  acceptance_stats: Record<string, number>;
  source_run_id: string | null;
}

export interface LearningFeedResponse {
  run_id: string;
  updates: LearningUpdate[];
  suggestions: {
    search_hints: LearningSuggestion[];
    anchors: LearningSuggestion[];
    known_values: LearningSuggestion[];
  };
  gate_summary: {
    total: number;
    accepted: number;
    rejected: number;
    rejection_reasons: Record<string, number>;
  };
}
