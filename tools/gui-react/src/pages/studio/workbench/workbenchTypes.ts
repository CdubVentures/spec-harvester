// ── Workbench types ──────────────────────────────────────────────────

export interface WorkbenchRow {
  // Identity (always visible)
  key: string;
  displayName: string;
  group: string;
  requiredLevel: string;
  availability: string;
  difficulty: string;
  effort: number;

  // Contract
  contractType: string;
  contractShape: string;
  contractUnit: string;
  unknownToken: string;

  // Parse
  parseTemplate: string;
  parseUnit: string;
  unitAccepts: string;
  allowUnitless: boolean;
  allowRanges: boolean;
  strictUnitRequired: boolean;

  // Enum
  enumPolicy: string;
  enumSource: string;
  matchStrategy: string;
  knownValuesCount: number;

  // Evidence
  evidenceRequired: boolean;
  minEvidenceRefs: number;
  tierPreference: string;
  conflictPolicy: string;

  // Priority / Publishing
  publishGate: boolean;
  blockPublishWhenUnk: boolean;

  // AI Assist
  aiMode: string;
  aiModelStrategy: string;
  aiMaxCalls: number;
  aiReasoningNote: string;

  // Search
  queryTermsCount: number;
  domainHintsCount: number;
  contentTypesCount: number;

  // Component
  componentType: string;

  // UI
  uiInputControl: string;
  uiOrder: number;

  // Metadata
  draftDirty: boolean;

  // Compile status
  hasErrors: boolean;
  hasWarnings: boolean;
  compileMessages: string[];

  // Internal refs
  _rule: Record<string, unknown>;
}

export type ColumnPreset = 'minimal' | 'contract' | 'parsing' | 'enums' | 'evidence' | 'search' | 'debug' | 'all';

export type DrawerTab = 'contract' | 'parse' | 'enum' | 'evidence' | 'search' | 'deps' | 'preview';
