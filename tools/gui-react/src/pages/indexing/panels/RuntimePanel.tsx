import { Tip } from '../../../components/common/Tip';
import {
  ActivityGauge,
  formatNumber,
  formatDateTime,
  roleHelpText,
  providerFromModelToken,
} from '../helpers';
import type { SearxngStatusResponse } from '../types';

interface ConvergenceKnob {
  key: string;
  label: string;
  tip?: string;
  type: 'int' | 'float' | 'bool';
  min?: number;
  max?: number;
  step?: number;
}

interface ConvergenceKnobGroup {
  label: string;
  knobs: ConvergenceKnob[];
}

interface LlmRouteSnapshotRow {
  role: string;
  primaryModel: string;
  primaryProvider: string;
  fallbackModel: string;
  fallbackProvider: string;
}

interface RuntimePanelProps {
  collapsed: boolean;
  onToggle: () => void;
  isAll: boolean;
  busy: boolean;
  processRunning: boolean;
  runtimeActivity: { currentPerMin: number; peakPerMin: number };

  profile: 'fast' | 'standard' | 'thorough';
  onProfileChange: (value: 'fast' | 'standard' | 'thorough') => void;
  discoveryEnabled: boolean;
  onDiscoveryEnabledChange: (enabled: boolean, setSearchProvider: (v: string) => void) => void;
  searchProvider: string;
  onSearchProviderChange: (value: string) => void;

  fetchConcurrency: string;
  onFetchConcurrencyChange: (value: string) => void;
  perHostMinDelayMs: string;
  onPerHostMinDelayMsChange: (value: string) => void;

  scannedPdfOcrEnabled: boolean;
  onScannedPdfOcrEnabledChange: (value: boolean) => void;
  scannedPdfOcrPromoteCandidates: boolean;
  onScannedPdfOcrPromoteCandidatesChange: (value: boolean) => void;
  scannedPdfOcrBackend: 'auto' | 'tesseract' | 'none';
  onScannedPdfOcrBackendChange: (value: 'auto' | 'tesseract' | 'none') => void;
  scannedPdfOcrMaxPages: string;
  onScannedPdfOcrMaxPagesChange: (value: string) => void;
  scannedPdfOcrMaxPairs: string;
  onScannedPdfOcrMaxPairsChange: (value: string) => void;
  scannedPdfOcrMinCharsPerPage: string;
  onScannedPdfOcrMinCharsPerPageChange: (value: string) => void;
  scannedPdfOcrMinLinesPerPage: string;
  onScannedPdfOcrMinLinesPerPageChange: (value: string) => void;
  scannedPdfOcrMinConfidence: string;
  onScannedPdfOcrMinConfidenceChange: (value: string) => void;

  dynamicCrawleeEnabled: boolean;
  onDynamicCrawleeEnabledChange: (value: boolean) => void;
  crawleeHeadless: boolean;
  onCrawleeHeadlessChange: (value: boolean) => void;
  dynamicFetchRetryBudget: string;
  onDynamicFetchRetryBudgetChange: (value: string) => void;
  dynamicFetchRetryBackoffMs: string;
  onDynamicFetchRetryBackoffMsChange: (value: string) => void;
  crawleeRequestHandlerTimeoutSecs: string;
  onCrawleeRequestHandlerTimeoutSecsChange: (value: string) => void;
  dynamicFetchPolicyMapJson: string;
  onDynamicFetchPolicyMapJsonChange: (value: string) => void;

  phase2LlmEnabled: boolean;
  onPhase2LlmEnabledChange: (value: boolean) => void;
  phase2LlmModel: string;
  onPhase2LlmModelChange: (model: string) => void;
  llmTokensPlan: number;
  onLlmTokensPlanChange: (value: number) => void;
  phase3LlmTriageEnabled: boolean;
  onPhase3LlmTriageEnabledChange: (value: boolean) => void;
  phase3LlmModel: string;
  onPhase3LlmModelChange: (model: string) => void;
  llmTokensTriage: number;
  onLlmTokensTriageChange: (value: number) => void;

  llmModelFast: string;
  onLlmModelFastChange: (model: string) => void;
  llmTokensFast: number;
  onLlmTokensFastChange: (value: number) => void;
  llmModelReasoning: string;
  onLlmModelReasoningChange: (model: string) => void;
  llmTokensReasoning: number;
  onLlmTokensReasoningChange: (value: number) => void;
  llmModelExtract: string;
  onLlmModelExtractChange: (model: string) => void;
  llmTokensExtract: number;
  onLlmTokensExtractChange: (value: number) => void;
  llmModelValidate: string;
  onLlmModelValidateChange: (model: string) => void;
  llmTokensValidate: number;
  onLlmTokensValidateChange: (value: number) => void;
  llmModelWrite: string;
  onLlmModelWriteChange: (model: string) => void;
  llmTokensWrite: number;
  onLlmTokensWriteChange: (value: number) => void;

  llmFallbackEnabled: boolean;
  onLlmFallbackEnabledChange: (value: boolean) => void;
  llmFallbackPlanModel: string;
  onLlmFallbackPlanModelChange: (model: string) => void;
  llmTokensPlanFallback: number;
  onLlmTokensPlanFallbackChange: (value: number) => void;
  llmFallbackExtractModel: string;
  onLlmFallbackExtractModelChange: (model: string) => void;
  llmTokensExtractFallback: number;
  onLlmTokensExtractFallbackChange: (value: number) => void;
  llmFallbackValidateModel: string;
  onLlmFallbackValidateModelChange: (model: string) => void;
  llmTokensValidateFallback: number;
  onLlmTokensValidateFallbackChange: (value: number) => void;
  llmFallbackWriteModel: string;
  onLlmFallbackWriteModelChange: (model: string) => void;
  llmTokensWriteFallback: number;
  onLlmTokensWriteFallbackChange: (value: number) => void;

  llmModelOptions: string[];
  llmTokenPresetOptions: number[];
  resolveModelTokenDefaults: (model: string) => { default_output_tokens: number; max_output_tokens: number };
  clampTokenForModel: (model: string, value: number) => number;
  llmRouteSnapshotRows: LlmRouteSnapshotRow[];

  resumeMode: 'auto' | 'force_resume' | 'start_over';
  onResumeModeChange: (value: 'auto' | 'force_resume' | 'start_over') => void;
  resumeWindowHours: string;
  onResumeWindowHoursChange: (value: string) => void;
  reextractAfterHours: string;
  onReextractAfterHoursChange: (value: string) => void;
  reextractIndexed: boolean;
  onReextractIndexedChange: (value: boolean) => void;

  convergenceKnobGroups: ConvergenceKnobGroup[];
  convergenceSettings: Record<string, number | boolean>;
  convergenceDirty: boolean;
  onConvergenceKnobUpdate: (key: string, value: number | boolean) => void;
  onConvergenceReload: () => void;
  onConvergenceSave: () => void;
  convergenceSaving: boolean;

  searxngStatus: SearxngStatusResponse | null | undefined;
  searxngStatusErrorMessage: string;
  onStartSearxng: () => void;

  stopForceKill: boolean;
  onStopForceKillChange: (value: boolean) => void;
  onStopProcess: (opts: { force: boolean }) => void;
  stopPending: boolean;
  selectedIndexLabRunId: string;
  onClearSelectedRunView: () => void;
  onReplaySelectedRunView: () => void;
}

export function RuntimePanel({
  collapsed,
  onToggle,
  isAll,
  busy,
  processRunning,
  runtimeActivity,
  profile,
  onProfileChange,
  discoveryEnabled,
  onDiscoveryEnabledChange,
  searchProvider,
  onSearchProviderChange,
  fetchConcurrency,
  onFetchConcurrencyChange,
  perHostMinDelayMs,
  onPerHostMinDelayMsChange,
  scannedPdfOcrEnabled,
  onScannedPdfOcrEnabledChange,
  scannedPdfOcrPromoteCandidates,
  onScannedPdfOcrPromoteCandidatesChange,
  scannedPdfOcrBackend,
  onScannedPdfOcrBackendChange,
  scannedPdfOcrMaxPages,
  onScannedPdfOcrMaxPagesChange,
  scannedPdfOcrMaxPairs,
  onScannedPdfOcrMaxPairsChange,
  scannedPdfOcrMinCharsPerPage,
  onScannedPdfOcrMinCharsPerPageChange,
  scannedPdfOcrMinLinesPerPage,
  onScannedPdfOcrMinLinesPerPageChange,
  scannedPdfOcrMinConfidence,
  onScannedPdfOcrMinConfidenceChange,
  dynamicCrawleeEnabled,
  onDynamicCrawleeEnabledChange,
  crawleeHeadless,
  onCrawleeHeadlessChange,
  dynamicFetchRetryBudget,
  onDynamicFetchRetryBudgetChange,
  dynamicFetchRetryBackoffMs,
  onDynamicFetchRetryBackoffMsChange,
  crawleeRequestHandlerTimeoutSecs,
  onCrawleeRequestHandlerTimeoutSecsChange,
  dynamicFetchPolicyMapJson,
  onDynamicFetchPolicyMapJsonChange,
  phase2LlmEnabled,
  onPhase2LlmEnabledChange,
  phase2LlmModel,
  onPhase2LlmModelChange,
  llmTokensPlan,
  onLlmTokensPlanChange,
  phase3LlmTriageEnabled,
  onPhase3LlmTriageEnabledChange,
  phase3LlmModel,
  onPhase3LlmModelChange,
  llmTokensTriage,
  onLlmTokensTriageChange,
  llmModelFast,
  onLlmModelFastChange,
  llmTokensFast,
  onLlmTokensFastChange,
  llmModelReasoning,
  onLlmModelReasoningChange,
  llmTokensReasoning,
  onLlmTokensReasoningChange,
  llmModelExtract,
  onLlmModelExtractChange,
  llmTokensExtract,
  onLlmTokensExtractChange,
  llmModelValidate,
  onLlmModelValidateChange,
  llmTokensValidate,
  onLlmTokensValidateChange,
  llmModelWrite,
  onLlmModelWriteChange,
  llmTokensWrite,
  onLlmTokensWriteChange,
  llmFallbackEnabled,
  onLlmFallbackEnabledChange,
  llmFallbackPlanModel,
  onLlmFallbackPlanModelChange,
  llmTokensPlanFallback,
  onLlmTokensPlanFallbackChange,
  llmFallbackExtractModel,
  onLlmFallbackExtractModelChange,
  llmTokensExtractFallback,
  onLlmTokensExtractFallbackChange,
  llmFallbackValidateModel,
  onLlmFallbackValidateModelChange,
  llmTokensValidateFallback,
  onLlmTokensValidateFallbackChange,
  llmFallbackWriteModel,
  onLlmFallbackWriteModelChange,
  llmTokensWriteFallback,
  onLlmTokensWriteFallbackChange,
  llmModelOptions,
  llmTokenPresetOptions,
  resolveModelTokenDefaults,
  clampTokenForModel,
  llmRouteSnapshotRows,
  resumeMode,
  onResumeModeChange,
  resumeWindowHours,
  onResumeWindowHoursChange,
  reextractAfterHours,
  onReextractAfterHoursChange,
  reextractIndexed,
  onReextractIndexedChange,
  convergenceKnobGroups,
  convergenceSettings,
  convergenceDirty,
  onConvergenceKnobUpdate,
  onConvergenceReload,
  onConvergenceSave,
  convergenceSaving,
  searxngStatus,
  searxngStatusErrorMessage,
  onStartSearxng,
  stopForceKill,
  onStopForceKillChange,
  onStopProcess,
  stopPending,
  selectedIndexLabRunId,
  onClearSelectedRunView,
  onReplaySelectedRunView,
}: RuntimePanelProps) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 30 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
          <button
            onClick={onToggle}
            className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            title={collapsed ? 'Open panel' : 'Close panel'}
          >
            {collapsed ? '+' : '-'}
          </button>
          <span>Runtime Settings</span>
          <Tip text="Profile controls run depth/cost. Resume mode controls whether prior state is reused or ignored." />
        </div>
        <ActivityGauge
          label="runtime activity"
          currentPerMin={runtimeActivity.currentPerMin}
          peakPerMin={runtimeActivity.peakPerMin}
          active={processRunning}
        />
      </div>
      {!collapsed ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <details className="group md:col-span-2 rounded border border-slate-200 dark:border-slate-600">
          <summary className="flex w-full cursor-pointer list-none items-center rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-700/40 dark:text-slate-200 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center">
              <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 text-[10px] leading-none text-slate-600 dark:border-slate-500 dark:text-slate-200">
                <span className="group-open:hidden">+</span>
                <span className="hidden group-open:inline">-</span>
              </span>
              <span>Run Setup and Discovery</span>
              <Tip text="Core run profile and provider-discovery toggles for this run." />
            </span>
          </summary>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 px-2 pb-2">
        <div className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
            run profile
            <Tip text="Run intensity profile: fast for speed, standard balanced, thorough for maximum coverage." />
          </div>
          <select
            value={profile}
            onChange={(e) => onProfileChange(e.target.value as 'fast' | 'standard' | 'thorough')}
            disabled={isAll || busy}
            className="mt-1 w-full px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Run intensity profile."
          >
            <option value="fast">run profile: fast</option>
            <option value="standard">run profile: standard</option>
            <option value="thorough">run profile: thorough</option>
          </select>
        </div>
        <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            checked={discoveryEnabled}
            onChange={(e) => {
              onDiscoveryEnabledChange(e.target.checked, onSearchProviderChange);
            }}
            disabled={isAll || busy}
          />
          provider discovery
          <Tip text="Enable search-provider discovery for this run. Disable to skip provider search expansion." />
        </label>
        <div className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
            search provider
            <Tip text="Search engine used for discovery when provider discovery is enabled." />
          </div>
          <select
            value={searchProvider}
            onChange={(e) => onSearchProviderChange(e.target.value)}
            disabled={isAll || busy || !discoveryEnabled}
            className="mt-1 w-full px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Search provider used when discovery is enabled."
          >
            <option value="none">search provider: none</option>
            <option value="duckduckgo">search provider: duckduckgo</option>
            <option value="searxng">search provider: searxng</option>
            <option value="bing">search provider: bing</option>
            <option value="google">search provider: google</option>
            <option value="dual">search provider: dual</option>
          </select>
        </div>
          </div>
        </details>
        <details className="group md:col-span-2 rounded border border-slate-200 dark:border-slate-600">
          <summary className="flex w-full cursor-pointer list-none items-center rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-700/40 dark:text-slate-200 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center">
              <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 text-[10px] leading-none text-slate-600 dark:border-slate-500 dark:text-slate-200">
                <span className="group-open:hidden">+</span>
                <span className="hidden group-open:inline">-</span>
              </span>
              <span>Fetch Throughput</span>
              <Tip text="Controls how many URLs run in parallel and how quickly each host is revisited." />
            </span>
          </summary>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 px-2 pb-2">
        <div className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
            fetch concurrency
            <Tip text="Global fetch concurrency target. Higher values increase throughput but can raise block/error rates." />
          </div>
          <input
            type="number"
            min={1}
            max={64}
            value={fetchConcurrency}
            onChange={(e) => onFetchConcurrencyChange(e.target.value)}
            disabled={isAll || busy}
            className="mt-1 w-full px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Global fetch concurrency target (CONCURRENCY env override for this run)."
            placeholder="fetch concurrency"
          />
        </div>
        <div className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
            per-host delay (ms)
            <Tip text="Minimum delay between requests to the same host. Higher values reduce host pressure and anti-bot risk." />
          </div>
          <input
            type="number"
            min={0}
            max={120000}
            step={50}
            value={perHostMinDelayMs}
            onChange={(e) => onPerHostMinDelayMsChange(e.target.value)}
            disabled={isAll || busy}
            className="mt-1 w-full px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            title="Minimum delay per host in milliseconds (PER_HOST_MIN_DELAY_MS override for this run)."
            placeholder="per-host delay ms"
          />
        </div>
          </div>
        </details>
        <details className="group md:col-span-2 rounded border border-slate-200 dark:border-slate-600">
          <summary className="flex w-full cursor-pointer list-none items-center rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-700/40 dark:text-slate-200 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center">
              <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 text-[10px] leading-none text-slate-600 dark:border-slate-500 dark:text-slate-200">
                <span className="group-open:hidden">+</span>
                <span className="hidden group-open:inline">-</span>
              </span>
              <span>Dynamic Rendering and Scanned PDF OCR</span>
              <Tip text="Dynamic JS-render controls plus OCR fallback controls for scanned PDF sources." />
            </span>
          </summary>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 px-2 pb-2">
        <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={scannedPdfOcrEnabled} onChange={(e) => onScannedPdfOcrEnabledChange(e.target.checked)} disabled={isAll || busy} />
          scanned pdf ocr enabled
          <Tip text="Enable OCR fallback for scanned/image-only PDFs. Recommended on for broad coverage." />
        </label>
        <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={scannedPdfOcrPromoteCandidates} onChange={(e) => onScannedPdfOcrPromoteCandidatesChange(e.target.checked)} disabled={isAll || busy || !scannedPdfOcrEnabled} />
          promote ocr candidates
          <Tip text="When enabled, OCR rows become field candidates and can win scoring/consensus lanes." />
        </label>
        <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
          <span>ocr backend</span>
          <Tip text="OCR engine selection. auto uses best available backend, tesseract forces deterministic fallback path." />
          <select value={scannedPdfOcrBackend} onChange={(e) => onScannedPdfOcrBackendChange(e.target.value as 'auto' | 'tesseract' | 'none')} disabled={isAll || busy || !scannedPdfOcrEnabled} className="ml-auto w-32 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="SCANNED_PDF_OCR_BACKEND for this run.">
            <option value="auto">auto</option>
            <option value="tesseract">tesseract</option>
            <option value="none">none</option>
          </select>
        </label>
        <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
          <span>ocr max pages</span>
          <Tip text="Maximum PDF pages scanned by OCR per document. Lower values improve throughput." />
          <input type="number" min={1} max={100} value={scannedPdfOcrMaxPages} onChange={(e) => onScannedPdfOcrMaxPagesChange(e.target.value)} disabled={isAll || busy || !scannedPdfOcrEnabled} className="ml-auto w-24 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="SCANNED_PDF_OCR_MAX_PAGES for this run." />
        </label>
        <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
          <span>ocr max pairs</span>
          <Tip text="Cap on OCR-emitted key/value rows per PDF. Keeps downstream payloads bounded." />
          <input type="number" min={50} max={20000} value={scannedPdfOcrMaxPairs} onChange={(e) => onScannedPdfOcrMaxPairsChange(e.target.value)} disabled={isAll || busy || !scannedPdfOcrEnabled} className="ml-auto w-24 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="SCANNED_PDF_OCR_MAX_PAIRS for this run." />
        </label>
        <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
          <span>min chars/page</span>
          <Tip text="Scan detection threshold: lower values route fewer PDFs to OCR (higher throughput)." />
          <input type="number" min={1} max={500} value={scannedPdfOcrMinCharsPerPage} onChange={(e) => onScannedPdfOcrMinCharsPerPageChange(e.target.value)} disabled={isAll || busy || !scannedPdfOcrEnabled} className="ml-auto w-24 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="SCANNED_PDF_OCR_MIN_CHARS_PER_PAGE for this run." />
        </label>
        <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
          <span>min lines/page</span>
          <Tip text="Scan detection threshold by text lines per page. Lower values reduce OCR routing volume." />
          <input type="number" min={1} max={100} value={scannedPdfOcrMinLinesPerPage} onChange={(e) => onScannedPdfOcrMinLinesPerPageChange(e.target.value)} disabled={isAll || busy || !scannedPdfOcrEnabled} className="ml-auto w-24 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="SCANNED_PDF_OCR_MIN_LINES_PER_PAGE for this run." />
        </label>
        <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
          <span>min confidence</span>
          <Tip text="OCR confidence cutoff for low-confidence flags. Lower values increase recall; higher values increase precision." />
          <input type="number" min={0} max={1} step={0.01} value={scannedPdfOcrMinConfidence} onChange={(e) => onScannedPdfOcrMinConfidenceChange(e.target.value)} disabled={isAll || busy || !scannedPdfOcrEnabled} className="ml-auto w-24 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="SCANNED_PDF_OCR_MIN_CONFIDENCE for this run." />
        </label>
        <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={dynamicCrawleeEnabled} onChange={(e) => onDynamicCrawleeEnabledChange(e.target.checked)} disabled={isAll || busy} />
          crawlee enabled
          <Tip text="Enable Crawlee-powered dynamic rendering path. When profile=fast, HTTP fetcher can still be preferred for speed." />
        </label>
        <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={crawleeHeadless} onChange={(e) => onCrawleeHeadlessChange(e.target.checked)} disabled={isAll || busy || !dynamicCrawleeEnabled} />
          crawlee headless
          <Tip text="Run browser without visible window for stability/perf in automated runs." />
        </label>
        <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
          <span>retry budget</span>
          <Tip text="Max dynamic fetch retries per URL after initial failure before giving up." />
          <input type="number" min={0} max={5} value={dynamicFetchRetryBudget} onChange={(e) => onDynamicFetchRetryBudgetChange(e.target.value)} disabled={isAll || busy} className="ml-auto w-24 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="DYNAMIC_FETCH_RETRY_BUDGET for this run." />
        </label>
        <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
          <span>retry backoff ms</span>
          <Tip text="Wait time between retries for failed dynamic fetches to avoid hammering one host." />
          <input type="number" min={0} max={30000} step={50} value={dynamicFetchRetryBackoffMs} onChange={(e) => onDynamicFetchRetryBackoffMsChange(e.target.value)} disabled={isAll || busy} className="ml-auto w-24 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="DYNAMIC_FETCH_RETRY_BACKOFF_MS for this run." />
        </label>
        <label className="flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
          <span>handler timeout s</span>
          <Tip text="Per-request Crawlee handler timeout in seconds before aborting a stuck render." />
          <input type="number" min={0} max={300} value={crawleeRequestHandlerTimeoutSecs} onChange={(e) => onCrawleeRequestHandlerTimeoutSecsChange(e.target.value)} disabled={isAll || busy || !dynamicCrawleeEnabled} className="ml-auto w-24 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="CRAWLEE_REQUEST_HANDLER_TIMEOUT_SECS for this run." />
        </label>
        <label className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200 md:col-span-2">
          <div className="flex items-center gap-2 mb-1">
            <span>domain policy json (advanced)</span>
            <Tip text="Optional JSON object keyed by host. Override fetch mode/retries/throttle per domain for this run only." />
          </div>
          <textarea value={dynamicFetchPolicyMapJson} onChange={(e) => onDynamicFetchPolicyMapJsonChange(e.target.value)} disabled={isAll || busy} className="w-full h-20 px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600 font-mono" placeholder='{"example.com":{"prefer":"playwright","retry_budget":2,"per_host_delay_ms":600}}' title="DYNAMIC_FETCH_POLICY_MAP_JSON override for this run." />
        </label>
          </div>
        </details>
        <details className="group md:col-span-2 rounded border border-slate-200 dark:border-slate-600">
          <summary className="flex w-full cursor-pointer list-none items-center rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-700/40 dark:text-slate-200 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center">
              <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 text-[10px] leading-none text-slate-600 dark:border-slate-500 dark:text-slate-200">
                <span className="group-open:hidden">+</span>
                <span className="hidden group-open:inline">-</span>
              </span>
              <span>Planner and Triage LLM</span>
              <Tip text="Model and token controls for planner and triage lanes." />
            </span>
          </summary>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 px-2 pb-2">
        <label className="md:col-span-2 flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-xs text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={phase2LlmEnabled} onChange={(e) => onPhase2LlmEnabledChange(e.target.checked)} disabled={isAll || busy || !discoveryEnabled} />
          planner llm enabled
          <Tip text={`Force LLM query planning for SearchProfile generation. ${roleHelpText('plan')}`} />
        </label>
        <div className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">planner model<Tip text="Model used for SearchProfile planning." /></div>
          <select value={phase2LlmModel} onChange={(e) => onPhase2LlmModelChange(e.target.value)} disabled={isAll || busy || !discoveryEnabled || !phase2LlmEnabled} className="mt-1 w-full px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Model used for SearchProfile planning.">
            {llmModelOptions.map((model) => (<option key={`phase2:${model}`} value={model}>planner model: {model}</option>))}
          </select>
        </div>
        <div className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">planner max tokens<Tip text="Max output tokens for planner calls." /></div>
          <select value={llmTokensPlan} onChange={(e) => onLlmTokensPlanChange(clampTokenForModel(phase2LlmModel, Number.parseInt(e.target.value, 10) || llmTokensPlan))} disabled={isAll || busy || !discoveryEnabled || !phase2LlmEnabled} className="mt-1 w-full px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Max output tokens for planner calls.">
            {llmTokenPresetOptions.map((token) => { const cap = resolveModelTokenDefaults(phase2LlmModel).max_output_tokens; const disabled = token > cap; return (<option key={`phase2-token:${token}`} value={token} disabled={disabled}>planner tokens: {token}{disabled ? ' (model max)' : ''}</option>); })}
          </select>
        </div>
        <label className="md:col-span-2 flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-1.5 text-xs text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={phase3LlmTriageEnabled} onChange={(e) => onPhase3LlmTriageEnabledChange(e.target.checked)} disabled={isAll || busy || !discoveryEnabled} />
          triage llm enabled
          <Tip text="Force LLM SERP reranking before URL selection." />
        </label>
        <div className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">triage model<Tip text="Model used for SERP triage." /></div>
          <select value={phase3LlmModel} onChange={(e) => onPhase3LlmModelChange(e.target.value)} disabled={isAll || busy || !discoveryEnabled || !phase3LlmTriageEnabled} className="mt-1 w-full px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Model used for SERP triage.">
            {llmModelOptions.map((model) => (<option key={`phase3:${model}`} value={model}>triage model: {model}</option>))}
          </select>
        </div>
        <div className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">triage max tokens<Tip text="Max output tokens for triage calls." /></div>
          <select value={llmTokensTriage} onChange={(e) => onLlmTokensTriageChange(clampTokenForModel(phase3LlmModel, Number.parseInt(e.target.value, 10) || llmTokensTriage))} disabled={isAll || busy || !discoveryEnabled || !phase3LlmTriageEnabled} className="mt-1 w-full px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Max output tokens for triage calls.">
            {llmTokenPresetOptions.map((token) => { const cap = resolveModelTokenDefaults(phase3LlmModel).max_output_tokens; const disabled = token > cap; return (<option key={`phase3-token:${token}`} value={token} disabled={disabled}>triage tokens: {token}{disabled ? ' (model max)' : ''}</option>); })}
          </select>
        </div>
          </div>
        </details>
        <details className="group md:col-span-2 rounded border border-slate-200 dark:border-slate-600">
          <summary className="flex w-full cursor-pointer list-none items-center rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-700/40 dark:text-slate-200 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center">
              <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 text-[10px] leading-none text-slate-600 dark:border-slate-500 dark:text-slate-200">
                <span className="group-open:hidden">+</span>
                <span className="hidden group-open:inline">-</span>
              </span>
              <span>Role Routing</span>
              <Tip text="Primary route models and token caps used by each runtime role lane." />
            </span>
          </summary>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 px-2 pb-2">
        <div className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">fast pass model<Tip text="Model used by fast LLM passes when enabled." /></div>
          <select value={llmModelFast} onChange={(e) => onLlmModelFastChange(e.target.value)} disabled={isAll || busy} className="mt-1 w-full px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Model used by fast LLM passes when enabled.">
            {llmModelOptions.map((model) => (<option key={`fast:${model}`} value={model}>fast pass model: {model}</option>))}
          </select>
        </div>
        <div className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">fast pass max tokens<Tip text="Max output tokens for fast LLM passes." /></div>
          <select value={llmTokensFast} onChange={(e) => onLlmTokensFastChange(clampTokenForModel(llmModelFast, Number.parseInt(e.target.value, 10) || llmTokensFast))} disabled={isAll || busy} className="mt-1 w-full px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Max output tokens for fast LLM passes.">
            {llmTokenPresetOptions.map((token) => { const cap = resolveModelTokenDefaults(llmModelFast).max_output_tokens; const disabled = token > cap; return (<option key={`fast-token:${token}`} value={token} disabled={disabled}>fast tokens: {token}{disabled ? ' (model max)' : ''}</option>); })}
          </select>
        </div>
        <div className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">reasoning model<Tip text="Model used by deeper reasoning passes." /></div>
          <select value={llmModelReasoning} onChange={(e) => onLlmModelReasoningChange(e.target.value)} disabled={isAll || busy} className="mt-1 w-full px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Model used by deeper reasoning passes.">
            {llmModelOptions.map((model) => (<option key={`reasoning:${model}`} value={model}>reasoning model: {model}</option>))}
          </select>
        </div>
        <div className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">reasoning max tokens<Tip text="Max output tokens for reasoning passes." /></div>
          <select value={llmTokensReasoning} onChange={(e) => onLlmTokensReasoningChange(clampTokenForModel(llmModelReasoning, Number.parseInt(e.target.value, 10) || llmTokensReasoning))} disabled={isAll || busy} className="mt-1 w-full px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Max output tokens for reasoning passes.">
            {llmTokenPresetOptions.map((token) => { const cap = resolveModelTokenDefaults(llmModelReasoning).max_output_tokens; const disabled = token > cap; return (<option key={`reasoning-token:${token}`} value={token} disabled={disabled}>reasoning tokens: {token}{disabled ? ' (model max)' : ''}</option>); })}
          </select>
        </div>
        <div className="md:col-span-2 px-1 text-[11px] text-gray-700 dark:text-gray-200"><span className="inline-flex items-center font-semibold">extract role<Tip text={roleHelpText('extract')} /></span></div>
        <select value={llmModelExtract} onChange={(e) => onLlmModelExtractChange(e.target.value)} disabled={isAll || busy} className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Primary route model for extract role.">
          {llmModelOptions.map((model) => (<option key={`extract:${model}`} value={model}>extract role model: {model}</option>))}
        </select>
        <select value={llmTokensExtract} onChange={(e) => onLlmTokensExtractChange(clampTokenForModel(llmModelExtract, Number.parseInt(e.target.value, 10) || llmTokensExtract))} disabled={isAll || busy} className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Max output tokens for extract role calls.">
          {llmTokenPresetOptions.map((token) => { const cap = resolveModelTokenDefaults(llmModelExtract).max_output_tokens; const disabled = token > cap; return (<option key={`extract-token:${token}`} value={token} disabled={disabled}>extract tokens: {token}{disabled ? ' (model max)' : ''}</option>); })}
        </select>
        <div className="md:col-span-2 px-1 text-[11px] text-gray-700 dark:text-gray-200"><span className="inline-flex items-center font-semibold">validate role<Tip text={roleHelpText('validate')} /></span></div>
        <select value={llmModelValidate} onChange={(e) => onLlmModelValidateChange(e.target.value)} disabled={isAll || busy} className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Primary route model for validate role.">
          {llmModelOptions.map((model) => (<option key={`validate:${model}`} value={model}>validate role model: {model}</option>))}
        </select>
        <select value={llmTokensValidate} onChange={(e) => onLlmTokensValidateChange(clampTokenForModel(llmModelValidate, Number.parseInt(e.target.value, 10) || llmTokensValidate))} disabled={isAll || busy} className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Max output tokens for validate role calls.">
          {llmTokenPresetOptions.map((token) => { const cap = resolveModelTokenDefaults(llmModelValidate).max_output_tokens; const disabled = token > cap; return (<option key={`validate-token:${token}`} value={token} disabled={disabled}>validate tokens: {token}{disabled ? ' (model max)' : ''}</option>); })}
        </select>
        <div className="md:col-span-2 px-1 text-[11px] text-gray-700 dark:text-gray-200"><span className="inline-flex items-center font-semibold">write role<Tip text={roleHelpText('write')} /></span></div>
        <select value={llmModelWrite} onChange={(e) => onLlmModelWriteChange(e.target.value)} disabled={isAll || busy} className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Primary route model for write/summary role.">
          {llmModelOptions.map((model) => (<option key={`write:${model}`} value={model}>write role model: {model}</option>))}
        </select>
        <select value={llmTokensWrite} onChange={(e) => onLlmTokensWriteChange(clampTokenForModel(llmModelWrite, Number.parseInt(e.target.value, 10) || llmTokensWrite))} disabled={isAll || busy} className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Max output tokens for write role calls.">
          {llmTokenPresetOptions.map((token) => { const cap = resolveModelTokenDefaults(llmModelWrite).max_output_tokens; const disabled = token > cap; return (<option key={`write-token:${token}`} value={token} disabled={disabled}>write tokens: {token}{disabled ? ' (model max)' : ''}</option>); })}
        </select>
          </div>
        </details>
        <details className="group md:col-span-2 rounded border border-slate-200 dark:border-slate-600">
          <summary className="flex w-full cursor-pointer list-none items-center rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-700/40 dark:text-slate-200 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center">
              <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 text-[10px] leading-none text-slate-600 dark:border-slate-500 dark:text-slate-200">
                <span className="group-open:hidden">+</span>
                <span className="hidden group-open:inline">-</span>
              </span>
              <span>Fallback Routing</span>
              <Tip text="Fallback models used when primary role routes are unavailable or intentionally disabled." />
            </span>
          </summary>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 px-2 pb-2">
        <label className="md:col-span-2 w-full flex items-center gap-2 rounded border border-gray-300 dark:border-gray-600 px-2 py-2 text-xs text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={llmFallbackEnabled} onChange={(e) => onLlmFallbackEnabledChange(e.target.checked)} disabled={isAll || busy} />
          role fallbacks enabled
          <Tip text="When off, fallback model routes are disabled for this run." />
        </label>
        <div className="md:col-span-2 px-1 text-[11px] text-gray-700 dark:text-gray-200"><span className="inline-flex items-center font-semibold">plan fallback<Tip text="Fallback route for plan role when primary planner route is unavailable." /></span></div>
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-2">
        <select value={llmFallbackPlanModel} onChange={(e) => onLlmFallbackPlanModelChange(e.target.value)} disabled={isAll || busy || !llmFallbackEnabled} className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Fallback model for plan role.">
          <option value="">fallback plan: none</option>
          {llmModelOptions.map((model) => (<option key={`fplan:${model}`} value={model}>fallback plan: {model}</option>))}
        </select>
        <select value={llmTokensPlanFallback} onChange={(e) => onLlmTokensPlanFallbackChange(clampTokenForModel(llmFallbackPlanModel || phase2LlmModel, Number.parseInt(e.target.value, 10) || llmTokensPlanFallback))} disabled={isAll || busy || !llmFallbackEnabled} className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Fallback max output tokens for plan role.">
          {llmTokenPresetOptions.map((token) => { const cap = resolveModelTokenDefaults(llmFallbackPlanModel || phase2LlmModel).max_output_tokens; const disabled = token > cap; return (<option key={`fplan-token:${token}`} value={token} disabled={disabled}>fallback plan tokens: {token}{disabled ? ' (model max)' : ''}</option>); })}
        </select>
        </div>
        <div className="md:col-span-2 px-1 text-[11px] text-gray-700 dark:text-gray-200"><span className="inline-flex items-center font-semibold">extract fallback<Tip text="Fallback route for extract role when primary extraction route is unavailable." /></span></div>
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-2">
        <select value={llmFallbackExtractModel} onChange={(e) => onLlmFallbackExtractModelChange(e.target.value)} disabled={isAll || busy || !llmFallbackEnabled} className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Fallback model for extract role.">
          <option value="">fallback extract: none</option>
          {llmModelOptions.map((model) => (<option key={`fextract:${model}`} value={model}>fallback extract: {model}</option>))}
        </select>
        <select value={llmTokensExtractFallback} onChange={(e) => onLlmTokensExtractFallbackChange(clampTokenForModel(llmFallbackExtractModel || llmModelExtract, Number.parseInt(e.target.value, 10) || llmTokensExtractFallback))} disabled={isAll || busy || !llmFallbackEnabled} className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Fallback max output tokens for extract role.">
          {llmTokenPresetOptions.map((token) => { const cap = resolveModelTokenDefaults(llmFallbackExtractModel || llmModelExtract).max_output_tokens; const disabled = token > cap; return (<option key={`fextract-token:${token}`} value={token} disabled={disabled}>fallback extract tokens: {token}{disabled ? ' (model max)' : ''}</option>); })}
        </select>
        </div>
        <div className="md:col-span-2 px-1 text-[11px] text-gray-700 dark:text-gray-200"><span className="inline-flex items-center font-semibold">validate fallback<Tip text="Fallback route for validate role when primary validation route is unavailable." /></span></div>
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-2">
        <select value={llmFallbackValidateModel} onChange={(e) => onLlmFallbackValidateModelChange(e.target.value)} disabled={isAll || busy || !llmFallbackEnabled} className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Fallback model for validate role.">
          <option value="">fallback validate: none</option>
          {llmModelOptions.map((model) => (<option key={`fvalidate:${model}`} value={model}>fallback validate: {model}</option>))}
        </select>
        <select value={llmTokensValidateFallback} onChange={(e) => onLlmTokensValidateFallbackChange(clampTokenForModel(llmFallbackValidateModel || llmModelValidate, Number.parseInt(e.target.value, 10) || llmTokensValidateFallback))} disabled={isAll || busy || !llmFallbackEnabled} className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Fallback max output tokens for validate role.">
          {llmTokenPresetOptions.map((token) => { const cap = resolveModelTokenDefaults(llmFallbackValidateModel || llmModelValidate).max_output_tokens; const disabled = token > cap; return (<option key={`fvalidate-token:${token}`} value={token} disabled={disabled}>fallback validate tokens: {token}{disabled ? ' (model max)' : ''}</option>); })}
        </select>
        </div>
        <div className="md:col-span-2 px-1 text-[11px] text-gray-700 dark:text-gray-200"><span className="inline-flex items-center font-semibold">write fallback<Tip text="Fallback route for write role when primary write route is unavailable." /></span></div>
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-2">
        <select value={llmFallbackWriteModel} onChange={(e) => onLlmFallbackWriteModelChange(e.target.value)} disabled={isAll || busy || !llmFallbackEnabled} className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Fallback model for write role.">
          <option value="">fallback write: none</option>
          {llmModelOptions.map((model) => (<option key={`fwrite:${model}`} value={model}>fallback write: {model}</option>))}
        </select>
        <select value={llmTokensWriteFallback} onChange={(e) => onLlmTokensWriteFallbackChange(clampTokenForModel(llmFallbackWriteModel || llmModelWrite, Number.parseInt(e.target.value, 10) || llmTokensWriteFallback))} disabled={isAll || busy || !llmFallbackEnabled} className="px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Fallback max output tokens for write role.">
          {llmTokenPresetOptions.map((token) => { const cap = resolveModelTokenDefaults(llmFallbackWriteModel || llmModelWrite).max_output_tokens; const disabled = token > cap; return (<option key={`fwrite-token:${token}`} value={token} disabled={disabled}>fallback write tokens: {token}{disabled ? ' (model max)' : ''}</option>); })}
        </select>
        </div>
        <div className="md:col-span-2 text-[11px] text-gray-500 dark:text-gray-400">
          One run executes the full pipeline in order. Every LLM route can be tuned here (plan, fast, triage, reasoning, extract, validate, write, and fallbacks).
        </div>
          </div>
        </details>
        <details className="group md:col-span-2 rounded border border-slate-200 dark:border-slate-600">
          <summary className="flex w-full cursor-pointer list-none items-center rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-700/40 dark:text-slate-200 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center">
              <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 text-[10px] leading-none text-slate-600 dark:border-slate-500 dark:text-slate-200">
                <span className="group-open:hidden">+</span>
                <span className="hidden group-open:inline">-</span>
              </span>
              <span>Role Route Snapshot</span>
              <Tip text="Quick matrix of resolved primary and fallback routes by role." />
            </span>
          </summary>
          <div className="mt-2 rounded border border-gray-300 dark:border-gray-600 p-2 text-xs overflow-x-auto">
          <table className="mt-2 min-w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-1 pr-3"><span className="inline-flex items-center">role<Tip text="Runtime role lane name." /></span></th>
                <th className="py-1 pr-3"><span className="inline-flex items-center">primary<Tip text="Resolved primary provider/model route for the role." /></span></th>
                <th className="py-1 pr-3"><span className="inline-flex items-center">fallback<Tip text="Resolved fallback provider/model route for the role." /></span></th>
              </tr>
            </thead>
            <tbody>
              {llmRouteSnapshotRows.map((row) => (
                <tr key={`route-snapshot:${row.role}`} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-1 pr-3"><span className="inline-flex items-center">{row.role}{roleHelpText(row.role) ? <Tip text={roleHelpText(row.role)} /> : null}</span></td>
                  <td className="py-1 pr-3">{row.primaryModel ? `${row.primaryProvider || providerFromModelToken(row.primaryModel)} | ${row.primaryModel}` : '-'}</td>
                  <td className="py-1 pr-3">{row.fallbackModel ? `${row.fallbackProvider || providerFromModelToken(row.fallbackModel)} | ${row.fallbackModel}` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </details>
        <details className="group md:col-span-2 rounded border border-slate-200 dark:border-slate-600">
          <summary className="flex w-full cursor-pointer list-none items-center rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-700/40 dark:text-slate-200 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center">
              <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 text-[10px] leading-none text-slate-600 dark:border-slate-500 dark:text-slate-200">
                <span className="group-open:hidden">+</span>
                <span className="hidden group-open:inline">-</span>
              </span>
              <span>Resume and Re-Extract Policy</span>
              <Tip text="Controls state resume behavior and stale-source refresh timing." />
            </span>
          </summary>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 px-2 pb-2">
        <div className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">resume mode<Tip text="Auto resumes recent state, force resume always reuses prior state, and start over ignores prior run state." /></div>
          <select value={resumeMode} onChange={(e) => onResumeModeChange(e.target.value as 'auto' | 'force_resume' | 'start_over')} disabled={isAll || busy} className="mt-1 w-full px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Resume policy.">
            <option value="auto">auto</option>
            <option value="force_resume">force resume</option>
            <option value="start_over">start over</option>
          </select>
        </div>
        <div className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">resume window (hours)<Tip text="Maximum age of prior run state that can be resumed. Higher = reuse older progress." /></div>
          <input type="number" min={0} value={resumeWindowHours} onChange={(e) => onResumeWindowHoursChange(e.target.value)} disabled={isAll || busy} className="mt-1 w-full px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Resume validity window in hours." placeholder="48" />
          <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">example: 48 means resume only if saved state is newer than 48h.</div>
        </div>
        <div className="rounded border border-gray-300 dark:border-gray-600 px-2 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">re-extract age (hours)<Tip text="If enabled, successful indexed URLs older than this age are re-extracted for freshness." /></div>
            <label className="flex items-center gap-1 text-[11px] text-gray-600 dark:text-gray-300">
              <input type="checkbox" checked={reextractIndexed} onChange={(e) => onReextractIndexedChange(e.target.checked)} disabled={isAll || busy} />
              enable
            </label>
          </div>
          <input type="number" min={0} value={reextractAfterHours} onChange={(e) => onReextractAfterHoursChange(e.target.value)} disabled={isAll || busy || !reextractIndexed} className="mt-1 w-full px-2 py-2 text-sm border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600" title="Re-extract successful URLs after this many hours." placeholder="24" />
          <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">this refreshes stale indexed sources; it does not control search triage behavior.</div>
        </div>
          </div>
        </details>
        <details className="group md:col-span-2 rounded border border-slate-200 dark:border-slate-600">
          <summary className="flex w-full cursor-pointer list-none items-center rounded bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-700/40 dark:text-slate-200 [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center">
              <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 text-[10px] leading-none text-slate-600 dark:border-slate-500 dark:text-slate-200">
                <span className="group-open:hidden">+</span>
                <span className="hidden group-open:inline">-</span>
              </span>
              <span>Convergence Tuning</span>
              <Tip text="Pipeline convergence knobs: loop limits, NeedSet identity caps, consensus scoring weights, SERP triage, and retrieval settings. Changes apply to subsequent runs." />
            </span>
            {convergenceDirty && <span className="ml-2 text-[10px] text-amber-600 dark:text-amber-400">unsaved</span>}
          </summary>
          <div className="mt-2 px-2 pb-2 space-y-3">
            <div className="flex items-center justify-end gap-2">
              <button onClick={onConvergenceReload} className="px-2 py-1 text-[11px] border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200">Reload</button>
              <button onClick={onConvergenceSave} disabled={!convergenceDirty || convergenceSaving} className="px-2 py-1 text-[11px] bg-accent text-white rounded hover:bg-blue-700 disabled:opacity-50">{convergenceSaving ? 'Saving...' : 'Save'}</button>
            </div>
            {convergenceKnobGroups.map((group) => (
              <div key={group.label} className="rounded border border-gray-200 dark:border-gray-700 p-2">
                <div className="text-[11px] font-semibold text-gray-700 dark:text-gray-200 mb-2">{group.label}</div>
                <div className="space-y-2">
                  {group.knobs.map((knob) => {
                    if (knob.type === 'bool') {
                      return (
                        <label key={knob.key} className="flex items-center gap-2 text-[11px] text-gray-700 dark:text-gray-200">
                          <input type="checkbox" checked={Boolean(convergenceSettings[knob.key])} onChange={(e) => onConvergenceKnobUpdate(knob.key, e.target.checked)} />
                          {knob.label}
                          {'tip' in knob && knob.tip ? <Tip text={knob.tip} /> : null}
                        </label>
                      );
                    }
                    const numValue = typeof convergenceSettings[knob.key] === 'number' ? (convergenceSettings[knob.key] as number) : 0;
                    const step = 'step' in knob ? knob.step : 1;
                    return (
                      <div key={knob.key}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[11px] text-gray-500 dark:text-gray-400 inline-flex items-center">{knob.label}{'tip' in knob && knob.tip ? <Tip text={knob.tip} /> : null}</span>
                          <span className="text-[11px] font-mono text-gray-700 dark:text-gray-300">{knob.type === 'float' ? numValue.toFixed(2) : numValue}</span>
                        </div>
                        <input type="range" className="w-full" min={knob.min} max={knob.max} step={step} value={numValue} onChange={(e) => { const parsed = knob.type === 'float' ? Number.parseFloat(e.target.value) : Number.parseInt(e.target.value, 10); onConvergenceKnobUpdate(knob.key, Number.isFinite(parsed) ? parsed : 0); }} />
                        <div className="flex justify-between text-[10px] text-gray-400 mt-0"><span>{knob.min}</span><span>{knob.max}</span></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </details>
      </div>
      <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-2 text-xs">
        {searxngStatus?.running ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-gray-700 dark:text-gray-200 inline-flex items-center">
                searxng:
                <Tip text="Local SearXNG service status used when search provider is set to SearXNG." />
                <span className={`ml-1 font-semibold ${searxngStatus?.http_ready ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}`}>
                  {searxngStatus?.http_ready ? 'ready' : 'running (api not ready)'}
                </span>
                {searxngStatus?.http_status ? (<span className="ml-1 text-gray-500 dark:text-gray-400">http {searxngStatus.http_status}</span>) : null}
              </div>
              <div className="text-gray-500 dark:text-gray-400 text-right font-mono">
                {searxngStatus?.base_url || 'http://127.0.0.1:8080'}
                {searxngStatus?.ports ? ` | ${searxngStatus.ports}` : ''}
              </div>
            </div>
            {searxngStatusErrorMessage && !searxngStatus ? (<div className="mt-1 text-rose-600 dark:text-rose-300">searxng status error: {searxngStatusErrorMessage}</div>) : null}
            {!searxngStatus?.docker_available ? (<div className="mt-1 text-rose-600 dark:text-rose-300">docker not available</div>) : null}
            {searxngStatus?.docker_available && !searxngStatus?.compose_file_exists ? (<div className="mt-1 text-rose-600 dark:text-rose-300">compose file missing: {searxngStatus.compose_path}</div>) : null}
          </>
        ) : (
          <div className="flex items-center justify-end">
            <button onClick={onStartSearxng} disabled={busy || searxngStatus?.can_start === false} className="px-2 py-1 text-xs rounded bg-cyan-700 hover:bg-cyan-800 text-white disabled:opacity-40" title="Start local SearXNG Docker stack.">Start SearXNG</button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 items-start gap-2">
        <div className="space-y-1">
          <button onClick={() => onStopProcess({ force: stopForceKill })} disabled={stopPending} className="w-full h-10 inline-flex items-center justify-center px-3 text-sm rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-40" title={stopForceKill ? 'Force kill process tree if needed.' : 'Graceful stop request.'}>Stop Process</button>
          <label className="inline-flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={stopForceKill} onChange={(e) => onStopForceKillChange(e.target.checked)} disabled={stopPending} />
            force kill (hard stop)
            <Tip text="When enabled, Stop Process uses forced kill behavior if graceful stop hangs." />
          </label>
        </div>
        <button onClick={onClearSelectedRunView} disabled={isAll || busy || !selectedIndexLabRunId} className="w-full h-10 self-start inline-flex items-center justify-center px-3 text-sm rounded bg-gray-700 hover:bg-gray-800 text-white disabled:opacity-40" title="Clear only selected run containers from the current view.">Clear Selected View</button>
        <button onClick={onReplaySelectedRunView} disabled={isAll || busy || !selectedIndexLabRunId} className="w-full h-10 self-start inline-flex items-center justify-center px-3 text-sm rounded bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-40" title="Replay selected run from persisted events/artifacts.">Replay Selected Run</button>
          </div>
        </>
      ) : null}
    </div>
  );
}
