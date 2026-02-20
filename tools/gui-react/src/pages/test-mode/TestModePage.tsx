import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { wsManager } from '../../api/ws';
import { Spinner } from '../../components/common/Spinner';
import { useUiStore } from '../../stores/uiStore';

// ── Types ───────────────────────────────────────────────────────────

interface TestCase {
  id: number;
  name: string;
  description: string;
  category?: string;
  productId?: string;
}

interface GenerateResult {
  ok: boolean;
  products: string[];
  testCases: TestCase[];
}

interface RunResultItem {
  productId: string;
  status: string;
  testCase?: TestCase;
  confidence?: number;
  coverage?: number;
  completeness?: number;
  validated?: boolean;
  trafficLight?: { green?: number; yellow?: number; red?: number };
  constraintConflicts?: number;
  missingRequired?: string[];
  curationSuggestions?: number;
  runtimeFailures?: number;
  durationMs?: number;
  error?: string;
}

interface ValidationCheck {
  productId: string;
  testCase: string;
  testCaseId?: number;
  check: string;
  pass: boolean;
  detail: string;
}

interface ValidationResult {
  results: ValidationCheck[];
  summary: { passed: number; failed: number; total: number };
}

interface MatrixRow {
  id: string;
  cells: Record<string, string | number | boolean>;
  testNumbers: number[];
  expectedBehavior: string;
  validationStatus?: 'pass' | 'fail' | 'pending';
}

interface CoverageMatrix {
  title: string;
  columns: Array<{ key: string; label: string; width?: string }>;
  rows: MatrixRow[];
  summary: Record<string, string | number>;
}

interface ScenarioDef {
  id: number;
  name: string;
  category: string;
  desc: string;
  aiCalls?: string;
}

interface ContractSummary {
  fieldCount: number;
  fieldsByType: Record<string, number>;
  fieldsByShape: Record<string, number>;
  enumPolicies: Record<string, number>;
  parseTemplates: Record<string, number>;
  componentTypes: Array<{ type: string; itemCount: number; aliasCount: number; propKeys: string[]; varianceKeys: string[]; hasConstraints: boolean }>;
  requiredFields: string[];
  criticalFields: string[];
  rangeConstraints: Record<string, { min: number; max: number }>;
  crossValidationRules: string[];
  knownValuesCatalogs: string[];
  testProductCount: number;
  listFieldCount: number;
  componentRefFieldCount: number;
}

interface ContractResponse {
  ok: boolean;
  summary: ContractSummary;
  matrices: {
    fieldRules: CoverageMatrix;
    components: CoverageMatrix;
    listsEnums: CoverageMatrix;
  };
  scenarioDefs?: ScenarioDef[];
}

interface ImportProgress {
  step: string;
  status: 'copying' | 'done' | 'error';
  file?: string;
  detail?: string;
  summary?: { fields: number; components: number; componentItems: number; enums: number; rules: number };
}

// ── Styles ──────────────────────────────────────────────────────────

const btnCls = 'px-3 py-1.5 text-sm rounded disabled:opacity-50 transition-colors';
const btnPrimary = `${btnCls} bg-accent text-white hover:bg-blue-600`;
const btnDanger = `${btnCls} bg-red-600 text-white hover:bg-red-700`;
const btnSecondary = `${btnCls} bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600`;
const cardCls = 'border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800';

// ── Scenario category colors ────────────────────────────────────────
const categoryColors: Record<string, string> = {
  Coverage: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  Components: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  Enums: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  Constraints: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  'Edge Cases': 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
};

// ── Matrix Table Component ──────────────────────────────────────────

function MatrixTable({ matrix, validationResult, collapsed, onToggle }: {
  matrix: CoverageMatrix;
  validationResult: ValidationResult | null;
  collapsed: boolean;
  onToggle: () => void;
}) {
  // Update validation status from results
  const rowsWithStatus = matrix.rows.map(row => {
    if (!validationResult) return row;
    const relevant = validationResult.results.filter(r =>
      row.testNumbers.some(t => r.testCaseId === t)
    );
    if (relevant.length === 0) return row;
    const allPass = relevant.every(r => r.pass);
    const anyFail = relevant.some(r => !r.pass);
    return { ...row, validationStatus: anyFail ? 'fail' as const : allPass ? 'pass' as const : 'pending' as const };
  });

  const passCount = rowsWithStatus.filter(r => r.validationStatus === 'pass').length;
  const failCount = rowsWithStatus.filter(r => r.validationStatus === 'fail').length;

  return (
    <div className={cardCls}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-gray-400">{collapsed ? '+' : '-'}</span>
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{matrix.title}</span>
          <span className="text-[10px] text-gray-400">{matrix.rows.length} rows</span>
          {validationResult && (
            <span className="text-[10px]">
              {passCount > 0 && <span className="text-green-600 mr-1">{passCount} pass</span>}
              {failCount > 0 && <span className="text-red-600">{failCount} fail</span>}
            </span>
          )}
        </div>
        <div className="flex gap-2 text-[10px] text-gray-400">
          {Object.entries(matrix.summary).map(([k, v]) => (
            <span key={k} className="font-mono">{k}: {v}</span>
          ))}
        </div>
      </button>

      {!collapsed && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-200 dark:border-gray-700">
                {validationResult && <th className="pb-1.5 pr-2 w-6"></th>}
                {matrix.columns.map(col => (
                  <th key={col.key} className="pb-1.5 pr-2 whitespace-nowrap" style={{ minWidth: col.width }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowsWithStatus.map(row => (
                <tr key={row.id} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  {validationResult && (
                    <td className="py-1 pr-2">
                      {row.validationStatus === 'pass' && <span className="text-green-500 font-bold">P</span>}
                      {row.validationStatus === 'fail' && <span className="text-red-500 font-bold">F</span>}
                      {row.validationStatus === 'pending' && <span className="text-gray-300">-</span>}
                    </td>
                  )}
                  {matrix.columns.map(col => (
                    <td key={col.key} className="py-1 pr-2 font-mono text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {col.key === 'testNumbers' || col.key === 'testScenario'
                        ? String(row.cells[col.key] ?? row.testNumbers?.join(', ') ?? '-')
                        : col.key === 'expectedBehavior'
                          ? <span className="whitespace-normal max-w-[250px] inline-block">{row.expectedBehavior}</span>
                          : String(row.cells[col.key] ?? '-')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Import Progress Panel ───────────────────────────────────────────

function ImportProgressPanel({ steps }: { steps: ImportProgress[] }) {
  if (steps.length === 0) return null;

  const complete = steps.find(s => s.step === 'complete');

  return (
    <div className={cardCls}>
      <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">
        {complete ? 'Import Complete' : 'Importing Field Rules Studio Contract...'}
      </div>
      <div className="space-y-1">
        {steps.filter(s => s.step !== 'complete').map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            {s.status === 'done' ? (
              <span className="text-green-500 font-bold w-4 text-center">ok</span>
            ) : s.status === 'error' ? (
              <span className="text-red-500 font-bold w-4 text-center">!</span>
            ) : (
              <Spinner className="h-3 w-3" />
            )}
            <span className="font-mono text-gray-600 dark:text-gray-400">{s.step}</span>
            {s.detail && <span className="text-gray-400">({s.detail})</span>}
          </div>
        ))}
      </div>
      {complete?.summary && (
        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
          {complete.summary.fields} fields, {complete.summary.components} component DBs ({complete.summary.componentItems} items), {complete.summary.enums} enum catalogs, {complete.summary.rules} cross-validation rules
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export function TestModePage() {
  const LS_KEY = 'test-mode-state';
  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
  }
  const saved = loadSaved();

  const [sourceCategory, setSourceCategory] = useState(saved.sourceCategory || 'mouse');
  const [testCategory, setTestCategory] = useState(saved.testCategory || '');
  const [generatedProducts, setGeneratedProducts] = useState<TestCase[]>(saved.generatedProducts || []);
  const [runResults, setRunResults] = useState<RunResultItem[]>(saved.runResults || []);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(saved.validationResult || null);
  const [importSteps, setImportSteps] = useState<ImportProgress[]>([]);
  const [matrixCollapsed, setMatrixCollapsed] = useState<Record<string, boolean>>({
    fieldRules: true,
    components: true,
    listsEnums: true
  });
  const [aiReview, setAiReview] = useState(false);
  const [sourcesPerScenario, setSourcesPerScenario] = useState<number>(saved.sourcesPerScenario ?? 0);
  const [sharedFieldRatioPercent, setSharedFieldRatioPercent] = useState<number>(saved.sharedFieldRatioPercent ?? 100);
  const [sameValueDuplicatePercent, setSameValueDuplicatePercent] = useState<number>(saved.sameValueDuplicatePercent ?? 35);
  const [crossItemSourceReuse, setCrossItemSourceReuse] = useState<boolean>(saved.crossItemSourceReuse ?? true);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const importStepsRef = useRef<ImportProgress[]>([]);

  // Persist key state to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        sourceCategory,
        testCategory,
        generatedProducts,
        runResults,
        validationResult,
        sourcesPerScenario,
        sharedFieldRatioPercent,
        sameValueDuplicatePercent,
        crossItemSourceReuse,
      }));
    } catch { /* localStorage full or disabled */ }
  }, [
    sourceCategory,
    testCategory,
    generatedProducts,
    runResults,
    validationResult,
    sourcesPerScenario,
    sharedFieldRatioPercent,
    sameValueDuplicatePercent,
    crossItemSourceReuse,
  ]);

  const setGlobalCategory = useUiStore((s) => s.setCategory);

  // Fetch real categories for the source dropdown (separate key to avoid cache collision with AppShell)
  const { data: categories = [] } = useQuery({
    queryKey: ['categories-real'],
    queryFn: () => api.get<string[]>('/categories'),
  });

  const queryClient = useQueryClient();
  const generationConfig = {
    sourcesPerScenario: Number.isFinite(sourcesPerScenario) ? Math.max(0, Math.min(5, sourcesPerScenario)) : 0,
    sharedFieldRatioPercent: Number.isFinite(sharedFieldRatioPercent) ? Math.max(0, Math.min(100, sharedFieldRatioPercent)) : 100,
    sameValueDuplicatePercent: Number.isFinite(sameValueDuplicatePercent) ? Math.max(0, Math.min(100, sameValueDuplicatePercent)) : 35,
    crossItemSourceReuse,
  };

  // On mount, verify and restore state from backend (handles cold reload / stale localStorage)
  useEffect(() => {
    if (statusLoaded) return;
    const cat = saved.sourceCategory || sourceCategory;
    api.get<{ ok: boolean; exists: boolean; testCategory: string; testCases: TestCase[]; runResults: RunResultItem[] }>(
      `/test-mode/status?sourceCategory=${cat}`
    ).then((data) => {
      if (data.exists && data.testCategory) {
        setTestCategory(data.testCategory);
        setGlobalCategory(data.testCategory);
        if (data.testCases.length > 0) setGeneratedProducts(data.testCases);
        if (data.runResults.length > 0) setRunResults(data.runResults);
      } else if (saved.testCategory) {
        // Backend says it doesn't exist — clear stale localStorage state
        setTestCategory('');
        setGeneratedProducts([]);
        setRunResults([]);
        setValidationResult(null);
      }
      setStatusLoaded(true);
    }).catch(() => setStatusLoaded(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch contract summary when test category exists
  const { data: contractData } = useQuery({
    queryKey: ['contract-summary', testCategory],
    queryFn: () => api.get<ContractResponse>(`/test-mode/contract-summary?category=${testCategory}`),
    enabled: Boolean(testCategory),
  });

  // WebSocket listener for import progress
  useEffect(() => {
    wsManager.connect();
    const unsub = wsManager.onMessage((channel, data) => {
      if (channel === 'test-import-progress') {
        const progress = data as ImportProgress;
        // Upsert by step name so 'done' replaces 'copying' instead of duplicating
        const existing = importStepsRef.current;
        const idx = existing.findIndex(s => s.step === progress.step);
        if (idx >= 0) {
          existing[idx] = progress;
          importStepsRef.current = [...existing];
        } else {
          importStepsRef.current = [...existing, progress];
        }
        setImportSteps([...importStepsRef.current]);
      }
    });
    return unsub;
  }, []);

  // ── Mutations ───────────────────────────────────────────────────

  const createMut = useMutation({
    mutationFn: () => {
      importStepsRef.current = [];
      setImportSteps([]);
      return api.post<{ ok: boolean; category: string; contractSummary?: ContractSummary }>('/test-mode/create', { sourceCategory });
    },
    onSuccess: (data) => {
      setTestCategory(data.category);
      setGeneratedProducts([]);
      setRunResults([]);
      setValidationResult(null);
      queryClient.invalidateQueries({ queryKey: ['contract-summary'] });
      // Auto-switch global dropdown to the test category & refresh category list
      setGlobalCategory(data.category);
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });

  const generateMut = useMutation({
    mutationFn: () => api.post<GenerateResult>('/test-mode/generate-products', { category: testCategory }),
    onSuccess: (data) => {
      setGeneratedProducts(data.testCases || []);
      setRunResults([]);
      setValidationResult(null);
    },
  });

  const runAllMut = useMutation({
    mutationFn: () => api.post<{ ok: boolean; results: RunResultItem[] }>('/test-mode/run', {
      category: testCategory,
      aiReview,
      generation: generationConfig,
    }),
    onSuccess: (data) => setRunResults(data.results || []),
  });

  const runOneMut = useMutation({
    mutationFn: (productId: string) =>
      api.post<{ ok: boolean; results: RunResultItem[] }>('/test-mode/run', {
        category: testCategory,
        productId,
        aiReview,
        generation: generationConfig,
      }),
    onSuccess: (data) => {
      const newResults = data.results || [];
      setRunResults((prev) => {
        const updated = [...prev];
        for (const r of newResults) {
          const idx = updated.findIndex((u) => u.productId === r.productId);
          if (idx >= 0) updated[idx] = r;
          else updated.push(r);
        }
        return updated;
      });
    },
  });

  const validateMut = useMutation({
    mutationFn: () => api.post<ValidationResult>('/test-mode/validate', { category: testCategory }),
    onSuccess: (data) => setValidationResult(data),
  });

  const deleteMut = useMutation({
    mutationFn: () => api.del<{ ok: boolean }>(`/test-mode/${testCategory}`),
    onSuccess: () => {
      // Switch back to the source category before clearing state
      setGlobalCategory(sourceCategory);
      setTestCategory('');
      setGeneratedProducts([]);
      setRunResults([]);
      setValidationResult(null);
      setImportSteps([]);
      importStepsRef.current = [];
      setMatrixCollapsed({ fieldRules: true, components: true, listsEnums: true });
      try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
      queryClient.invalidateQueries({ queryKey: ['contract-summary'] });
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });

  const isRunning = createMut.isPending || generateMut.isPending || runAllMut.isPending || runOneMut.isPending || validateMut.isPending;

  // ── Workflow state ─────────────────────────────────────────────
  const step1Done = Boolean(testCategory);
  const step2Done = generatedProducts.length > 0;
  const step3Done = runResults.length > 0;
  const step4Done = Boolean(validationResult);

  // Compute disable reasons for tooltips
  function runAllTooltip(): string {
    if (isRunning) return 'Another operation is in progress — wait for it to finish.';
    if (!testCategory) return 'Step 1 required: click "Create" to import the field rules contract first.';
    if (generatedProducts.length === 0) return 'Step 2 required: click "Generate Products" to create the test scenario product files first.';
    return `Run all ${generatedProducts.length} test scenarios through the full pipeline: deterministic source data per scenario (no LLM), then consensus + normalization + component resolution + enum matching + constraint solving + variance policies + component constraints + validation + traffic light + export.${aiReview ? ' AI Review enabled: will also run LLM review on flagged component matches.' : ''}`;
  }

  function validateTooltip(): string {
    if (isRunning) return 'Another operation is in progress — wait for it to finish.';
    if (!testCategory) return 'Step 1 required: click "Create" to import the field rules contract first.';
    if (generatedProducts.length === 0) return 'Step 2 required: click "Generate Products" first.';
    if (runResults.length === 0) return 'Step 3 required: click "Run All" first — there are no pipeline results to validate yet.';
    return 'Validate pipeline output against per-scenario contract expectations. Reads the persisted artifacts (normalized.json, summary.json, suggestion files) for each test product and runs assertion checks per scenario: field population, confidence scores, component suggestions (new + alias), enum suggestions (new + similar + closed rejection), variance policy scoring, component constraint violations (e.g., sensor_date <= release_date), range violations, cross-validation, missing required fields, consensus resolution, and list dedup.';
  }

  // ── Helpers ─────────────────────────────────────────────────────

  function getRunResult(testCaseId: number): RunResultItem | undefined {
    return runResults.find((r) => r.testCase?.id === testCaseId);
  }

  function statusBadge(result?: RunResultItem) {
    if (!result) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500">pending</span>;
    if (result.status === 'error') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-300">error</span>;
    return <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-300">complete</span>;
  }

  function pct(v?: number) {
    return v != null ? `${(v * 100).toFixed(1)}%` : '-';
  }

  const toggleMatrix = useCallback((key: string) => {
    setMatrixCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Group test cases by category
  const groupedProducts = generatedProducts.reduce<Record<string, TestCase[]>>((acc, tc) => {
    const cat = tc.category || 'Other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(tc);
    return acc;
  }, {});

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Test Mode v2</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Contract-driven pipeline validation — scenarios auto-generated from the field rules contract (universal, any category).
        </p>
      </div>

      {/* ── Workflow Steps ──────────────────────────────────────── */}
      <div className={`${cardCls} space-y-3`}>
        {/* Step indicator */}
        <div className="flex items-center gap-1 text-[10px] font-medium">
          <span className={`px-2 py-0.5 rounded-full ${step1Done ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'}`}>
            1. Import{step1Done ? ' done' : ''}
          </span>
          <span className="text-gray-300 dark:text-gray-600">&rarr;</span>
          <span className={`px-2 py-0.5 rounded-full ${step2Done ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : step1Done ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'}`}>
            2. Generate{step2Done ? ' done' : ''}
          </span>
          <span className="text-gray-300 dark:text-gray-600">&rarr;</span>
          <span className={`px-2 py-0.5 rounded-full ${step3Done ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : step2Done ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'}`}>
            3. Run{step3Done ? ' done' : ''}
          </span>
          <span className="text-gray-300 dark:text-gray-600">&rarr;</span>
          <span className={`px-2 py-0.5 rounded-full ${step4Done ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : step3Done ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'}`}>
            4. Validate{step4Done ? ' done' : ''}
          </span>
          {testCategory && (
            <span className="ml-auto text-xs font-mono text-gray-400">{testCategory}</span>
          )}
        </div>

        {/* Buttons row */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Source Category</label>
            <select
              value={sourceCategory}
              onChange={(e) => setSourceCategory(e.target.value)}
              className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="relative group">
            <button
              onClick={() => createMut.mutate()}
              disabled={isRunning}
              className={btnPrimary}
              title="Step 1 — Import: Copies the selected category's field rules contract (field_rules.json, known_values.json, cross_validation_rules.json, component DBs) into a test category. This creates an isolated sandbox so tests don't affect production data."
            >
              {createMut.isPending ? <Spinner className="h-4 w-4 inline mr-1" /> : null}
              1. Create
            </button>
          </div>

          <div className="relative group">
            <button
              onClick={() => generateMut.mutate()}
              disabled={isRunning || !testCategory}
              className={btnPrimary}
              title={!testCategory
                ? 'Disabled: click "Create" first to import the contract.'
                : 'Step 2 — Generate: Creates test product JSON files, one per contract-derived scenario (happy path, new components, alias matching, enum validation, range violations, cross-validation, component constraints, variance policies, missing fields, consensus, list dedup). Scenario count is auto-derived from the contract. No LLM calls yet.'
              }
            >
              {generateMut.isPending ? <Spinner className="h-4 w-4 inline mr-1" /> : null}
              2. Generate
            </button>
          </div>

          <div className="relative group">
            <button
              onClick={() => runAllMut.mutate()}
              disabled={isRunning || !testCategory || generatedProducts.length === 0}
              className={btnPrimary}
              title={runAllTooltip()}
            >
              {runAllMut.isPending ? <Spinner className="h-4 w-4 inline mr-1" /> : null}
              3. Run All
            </button>
          </div>

          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer select-none" title="When enabled, runs LLM-based AI review on flagged component matches after the pipeline completes. Off by default (deterministic mode only).">
            <input
              type="checkbox"
              checked={aiReview}
              onChange={(e) => setAiReview(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            AI Review
          </label>

          <div className="flex items-end gap-2">
            <label className="text-xs text-gray-500 dark:text-gray-400">
              Sources/Scenario
              <input
                type="number"
                min={0}
                max={5}
                step={1}
                value={sourcesPerScenario}
                onChange={(e) => setSourcesPerScenario(Number.parseInt(e.target.value || '0', 10) || 0)}
                className="block mt-1 w-20 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                title="0 = use scenario default source count. 1-5 overrides for all scenarios."
              />
            </label>
            <label className="text-xs text-gray-500 dark:text-gray-400">
              Shared %
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={sharedFieldRatioPercent}
                onChange={(e) => setSharedFieldRatioPercent(Number.parseInt(e.target.value || '0', 10) || 0)}
                className="block mt-1 w-20 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                title="Percent of fields in non-primary sources that match source 1 values."
              />
            </label>
            <label className="text-xs text-gray-500 dark:text-gray-400">
              Duplicate %
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={sameValueDuplicatePercent}
                onChange={(e) => setSameValueDuplicatePercent(Number.parseInt(e.target.value || '0', 10) || 0)}
                className="block mt-1 w-20 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
                title="Additional probability of forcing same-value duplicates across sources."
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer select-none mb-1" title="Reuse the same host identities across products. Disable to generate per-item host IDs.">
              <input
                type="checkbox"
                checked={crossItemSourceReuse}
                onChange={(e) => setCrossItemSourceReuse(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              Reuse Hosts
            </label>
          </div>

          <div className="relative group">
            <button
              onClick={() => validateMut.mutate()}
              disabled={isRunning || !testCategory || runResults.length === 0}
              className={btnSecondary}
              title={validateTooltip()}
            >
              {validateMut.isPending ? <Spinner className="h-4 w-4 inline mr-1" /> : null}
              4. Validate
            </button>
          </div>

          <button
            onClick={() => { if (confirm(`Wipe all test data for ${testCategory}? This deletes all artifacts and resets to step 1.`)) deleteMut.mutate(); }}
            disabled={isRunning || !testCategory}
            className={btnDanger}
            title={!testCategory
              ? 'No test category to wipe.'
              : `Wipe All — delete "${testCategory}" and all its artifacts, reset UI state back to step 1, and switch back to ${sourceCategory}.`
            }
          >
            Wipe All
          </button>
        </div>

        {/* Current step explanation */}
        <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
          {!step1Done && (
            <span>Select a source category and click <strong>Create</strong> to import its field rules contract into an isolated test sandbox.</span>
          )}
          {step1Done && !step2Done && (
            <span>Contract imported. Click <strong>Generate</strong> to create test product files — one per contract-derived scenario (new components, alias matching, enum rejection, range violations, cross-validation, component constraints, variance policies, consensus, etc.).</span>
          )}
          {step2Done && !step3Done && (
            <span>{generatedProducts.length} test products ready. Click <strong>Run All</strong> to execute each through the full pipeline (deterministic source data per scenario, then consensus + normalization + runtime gate + variance scoring + constraint checking + export). Enable "AI Review" to also run LLM review on flagged component matches.</span>
          )}
          {step3Done && !step4Done && (
            <span>{runResults.filter(r => r.status === 'complete').length}/{generatedProducts.length} scenarios complete. Click <strong>Validate</strong> to run contract assertion checks against the persisted artifacts — covering component suggestions, enum matching, variance policies, constraint violations, range checks, and more (or re-run individual scenarios below).</span>
          )}
          {step4Done && (
            <span>Validation complete: <span className="text-green-600 font-medium">{validationResult!.summary.passed} passed</span>, <span className="text-red-600 font-medium">{validationResult!.summary.failed} failed</span> out of {validationResult!.summary.total} checks. Review the matrices and results below.</span>
          )}
        </div>
      </div>

      {/* ── Error display ──────────────────────────────────────── */}
      {(createMut.error || generateMut.error || runAllMut.error || validateMut.error || deleteMut.error) && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3 text-sm text-red-700 dark:text-red-300">
          {(createMut.error || generateMut.error || runAllMut.error || validateMut.error || deleteMut.error)?.message}
        </div>
      )}

      {/* ── Import Progress ────────────────────────────────────── */}
      {importSteps.length > 0 && <ImportProgressPanel steps={importSteps} />}

      {/* ── Coverage Matrices ──────────────────────────────────── */}
      {contractData?.matrices && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Coverage Matrices
            {contractData.summary && (
              <span className="ml-2 text-xs font-normal text-gray-400">
                {contractData.summary.fieldCount} fields, {contractData.summary.componentTypes?.length || 0} component types, {contractData.summary.knownValuesCatalogs?.length || 0} enum catalogs
              </span>
            )}
          </h2>

          <MatrixTable
            matrix={contractData.matrices.fieldRules}
            validationResult={validationResult}
            collapsed={matrixCollapsed.fieldRules}
            onToggle={() => toggleMatrix('fieldRules')}
          />
          <MatrixTable
            matrix={contractData.matrices.components}
            validationResult={validationResult}
            collapsed={matrixCollapsed.components}
            onToggle={() => toggleMatrix('components')}
          />
          <MatrixTable
            matrix={contractData.matrices.listsEnums}
            validationResult={validationResult}
            collapsed={matrixCollapsed.listsEnums}
            onToggle={() => toggleMatrix('listsEnums')}
          />
        </div>
      )}

      {/* ── Test Cases Grid ────────────────────────────────────── */}
      {generatedProducts.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Test Scenarios ({generatedProducts.length})
            {runResults.length > 0 && (
              <span className="ml-2 text-xs font-normal text-gray-400">
                {runResults.filter(r => r.status === 'complete').length}/{generatedProducts.length} complete
              </span>
            )}
          </h2>

          {Object.entries(groupedProducts).map(([cat, tests]) => (
            <div key={cat} className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${categoryColors[cat] || categoryColors['Edge Cases']}`}>
                  {cat}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {tests.map((tc) => {
                  const result = getRunResult(tc.id);
                  const scenarioChecks = validationResult?.results.filter(r => r.testCaseId === tc.id) || [];
                  const passChecks = scenarioChecks.filter(c => c.pass).length;
                  const failChecks = scenarioChecks.filter(c => !c.pass).length;

                  return (
                    <div key={tc.id} className={`${cardCls} ${result?.status === 'error' ? 'border-red-300 dark:border-red-700' : ''}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                          #{tc.id} {tc.name.replace(/_/g, ' ')}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {scenarioChecks.length > 0 && (
                            <span className="text-[10px]">
                              <span className="text-green-600">{passChecks}</span>/<span className={failChecks > 0 ? 'text-red-600' : 'text-gray-400'}>{passChecks + failChecks}</span>
                            </span>
                          )}
                          {statusBadge(result)}
                        </div>
                      </div>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">{tc.description}</p>

                      {result && result.status === 'complete' && (
                        <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-[10px] mb-2">
                          <div>
                            <span className="text-gray-400 block">Conf</span>
                            <span className="font-mono">{pct(result.confidence)}</span>
                          </div>
                          <div>
                            <span className="text-gray-400 block">Cov</span>
                            <span className="font-mono">{pct(result.coverage)}</span>
                          </div>
                          <div>
                            <span className="text-gray-400 block">Traffic</span>
                            <span className="font-mono">
                              <span className="text-green-600">{result.trafficLight?.green ?? 0}</span>{'/'}
                              <span className="text-yellow-600">{result.trafficLight?.yellow ?? 0}</span>{'/'}
                              <span className="text-red-600">{result.trafficLight?.red ?? 0}</span>
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-400 block">Conflicts</span>
                            <span className="font-mono">{result.constraintConflicts ?? 0}</span>
                          </div>
                          <div>
                            <span className="text-gray-400 block">Missing</span>
                            <span className="font-mono">{result.missingRequired?.length ?? 0}</span>
                          </div>
                          <div>
                            <span className="text-gray-400 block">Time</span>
                            <span className="font-mono">{result.durationMs ? `${(result.durationMs / 1000).toFixed(1)}s` : '-'}</span>
                          </div>
                        </div>
                      )}

                      {result?.error && (
                        <p className="text-[10px] text-red-500 dark:text-red-400 mb-2 truncate" title={result.error}>
                          {result.error}
                        </p>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={() => runOneMut.mutate(result?.productId || tc.productId || '')}
                          disabled={isRunning || !(result?.productId || tc.productId)}
                          className={`${btnCls} text-[10px] bg-accent/10 text-accent hover:bg-accent/20`}
                        >
                          {runOneMut.isPending ? '...' : 'Run'}
                        </button>
                        {result?.status === 'complete' && (
                          <>
                            <a
                              href={`#/review?category=${testCategory}`}
                              className={`${btnCls} text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200`}
                            >
                              Review
                            </a>
                            <a
                              href={`#/review-components?category=${testCategory}`}
                              className={`${btnCls} text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200`}
                            >
                              Components
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Validation Results ──────────────────────────────────── */}
      {validationResult && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Validation Results
            <span className="ml-2 text-xs font-normal">
              <span className="text-green-600">{validationResult.summary.passed} passed</span>
              {' / '}
              <span className="text-red-600">{validationResult.summary.failed} failed</span>
              {' / '}
              {validationResult.summary.total} total
            </span>
          </h2>
          <div className={cardCls}>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="pb-2 pr-3">Product</th>
                  <th className="pb-2 pr-3">Test Case</th>
                  <th className="pb-2 pr-3">Check</th>
                  <th className="pb-2 pr-3">Pass</th>
                  <th className="pb-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {validationResult.results.map((check, i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-1.5 pr-3 font-mono text-[10px] text-gray-500 truncate max-w-[120px]" title={check.productId}>
                      {check.productId.split('-').slice(-2).join('-')}
                    </td>
                    <td className="py-1.5 pr-3">{check.testCase}</td>
                    <td className="py-1.5 pr-3 font-mono">{check.check}</td>
                    <td className="py-1.5 pr-3">
                      {check.pass ? (
                        <span className="text-green-600 font-bold">PASS</span>
                      ) : (
                        <span className="text-red-600 font-bold">FAIL</span>
                      )}
                    </td>
                    <td className="py-1.5 text-gray-400 truncate max-w-[200px]" title={check.detail}>
                      {check.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
