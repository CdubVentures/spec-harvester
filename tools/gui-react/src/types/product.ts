export interface RenameHistoryEntry {
  previous_slug: string;
  previous_model: string;
  previous_variant: string;
  renamed_at: string;
  migration_result: { migrated_count: number; failed_count: number };
}

export interface MigrationResult {
  ok: boolean;
  migrated_count: number;
  failed_count: number;
}

export interface CatalogRow {
  productId: string;
  id: number;
  identifier: string;
  brand: string;
  model: string;
  variant: string;
  status: string;
  hasFinal: boolean;
  validated: boolean;
  confidence: number;
  coverage: number;
  fieldsFilled: number;
  fieldsTotal: number;
  lastRun: string;
  inActive: boolean;
  rename_history?: RenameHistoryEntry[];
}

export interface ProductSummary {
  productId: string;
  category: string;
  confidence: number;
  coverage_overall: number;
  fields_total: number;
  fields_filled: number;
  fields_below_pass_target: string[];
  critical_fields_below_pass_target: string[];
  missing_required_fields: string[];
  generated_at: string;
  runId?: string;
  field_reasoning?: Record<string, unknown>;
  constraint_analysis?: {
    contradictions: Array<{
      code: string;
      severity: string;
      message: string;
      fields: string[];
    }>;
  };
  [key: string]: unknown;
}

export interface NormalizedProduct {
  identity: {
    brand: string;
    model: string;
    variant?: string;
  };
  fields: Record<string, unknown>;
}

export interface ProvenanceRow {
  value: unknown;
  confidence: number;
  pass_target?: number;
  approved_confirmations?: number;
  meets_pass_target?: boolean;
  evidence?: Array<{
    url: string;
    host: string;
    rootDomain: string;
    tier: number;
    tierName: string;
    method: string;
    keyPath: string;
    approvedDomain: boolean;
  }>;
}

export interface TrafficLight {
  color: 'green' | 'yellow' | 'red' | 'gray';
  field: string;
}

export interface QueueProduct {
  productId: string;
  status: string;
  priority: number;
  attempts: number;
  updated_at: string;
}

// ── Brand Types ─────────────────────────────────────────────────────

export interface BrandRenameHistoryEntry {
  previous_slug: string;
  previous_name: string;
  renamed_at: string;
}

export interface BrandImpactAnalysis {
  ok: boolean;
  slug: string;
  identifier: string;
  canonical_name: string;
  categories: string[];
  products_by_category: Record<string, number>;
  product_details: Record<string, string[]>;
  total_products: number;
}
