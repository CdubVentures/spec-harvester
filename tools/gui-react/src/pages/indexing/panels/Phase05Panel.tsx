import { Tip } from '../../../components/common/Tip';
import {
  ActivityGauge,
  formatNumber,
  formatDateTime,
  formatLatencyMs,
} from '../helpers';
import type { IndexLabDynamicFetchDashboardHostRow, IndexLabDynamicFetchDashboardResponse } from '../types';

interface SchedulerFallbackRow {
  ts: string;
  kind: string;
  from_mode?: string;
  to_mode?: string;
  outcome?: string;
  attempt?: number | string;
  url?: string;
}

interface StructuredSnippetRow {
  ts: string;
  source_surface?: string;
  key_path?: string;
  value_preview?: string;
  target_match_score?: number;
  target_match_passed?: boolean;
  url?: string;
}

interface ArticleDomainLeaderboardRow {
  host: string;
  samples: number;
  readabilityHits: number;
  fallbackHits: number;
  lowQualityCount: number;
  avgScore: number;
  avgChars: number;
  parseP95Ms: number;
  topMode?: string;
  topPolicyHost?: string;
  policyOverrideCount: number;
}

interface ArticlePreviewJob {
  url?: string;
  article_method?: string;
  article_quality_score?: number;
  article_char_count?: number;
  article_low_quality?: boolean;
  article_title?: string;
  article_fallback_reason?: string;
  article_preview?: string;
  article_excerpt?: string;
}

interface Phase05Runtime {
  activeInflight: number;
  peakInflight: number;
  started: number;
  completed: number;
  failed: number;
  httpCount: number;
  browserCount: number;
  otherCount: number;
  fetchP95Ms: number;
  parseP95Ms: number;
  articleSamples: number;
  articleReadability: number;
  articleFallback: number;
  articleAvgScore: number;
  articleAvgChars: number;
  articleLowQuality: number;
  structuredJsonLd: number;
  structuredMicrodata: number;
  structuredOpengraph: number;
  structuredCandidates: number;
  structuredRejected: number;
  structuredErrors: number;
  pdfDocsParsed: number;
  pdfPairsTotal: number;
  pdfKvPairs: number;
  pdfTablePairs: number;
  pdfPagesScanned: number;
  pdfErrors: number;
  scannedPdfDocsDetected: number;
  scannedPdfOcrDocsAttempted: number;
  scannedPdfOcrDocsSucceeded: number;
  scannedPdfOcrPairs: number;
  scannedPdfOcrKvPairs: number;
  scannedPdfOcrTablePairs: number;
  scannedPdfOcrLowConfPairs: number;
  scannedPdfOcrConfidenceAvg: number;
  scannedPdfOcrErrors: number;
  hostsActive: Array<{ host: string; inflight: number }>;
  schedulerFallbackStarted: number;
  schedulerFallbackSucceeded: number;
  schedulerFallbackExhausted: number;
  schedulerHostWaits: number;
  schedulerTicks: number;
  schedulerFallbackFeed: SchedulerFallbackRow[];
  structuredSnippetRows: StructuredSnippetRow[];
  skippedCooldown: number;
  skippedBlockedBudget: number;
  skippedRetryLater: number;
}

interface Phase05PanelProps {
  collapsed: boolean;
  onToggle: () => void;
  selectedIndexLabRunId: string;
  phase5StatusLabel: string;
  phase5Activity: { currentPerMin: number; peakPerMin: number };
  processRunning: boolean;
  phase5Runtime: Phase05Runtime;
  phase5ArticleDomainLeaderboard: ArticleDomainLeaderboardRow[];
  phase5ArticlePreviewJob: ArticlePreviewJob | null;
  dynamicFetchDashboardSummary: {
    hostCount: number;
    generatedAt: string | null;
    requests: number;
    retries: number;
    screenshots: number;
    networkRows: number;
    graphqlRows: number;
    summaryOnly: boolean;
  };
  dynamicFetchDashboardHosts: IndexLabDynamicFetchDashboardHostRow[];
  indexlabDynamicFetchDashboardResp: IndexLabDynamicFetchDashboardResponse | null | undefined;
  fetchConcurrency: string;
  perHostMinDelayMs: string;
  dynamicCrawleeEnabled: boolean;
  dynamicFetchRetryBudget: string;
  dynamicFetchRetryBackoffMs: string;
  scannedPdfOcrEnabled: boolean;
  scannedPdfOcrPromoteCandidates: boolean;
  scannedPdfOcrBackend: string;
  scannedPdfOcrMaxPages: string;
  scannedPdfOcrMaxPairs: string;
  scannedPdfOcrMinCharsPerPage: string;
  scannedPdfOcrMinLinesPerPage: string;
  scannedPdfOcrMinConfidence: string;
}

export function Phase05Panel({
  collapsed,
  onToggle,
  selectedIndexLabRunId,
  phase5StatusLabel,
  phase5Activity,
  processRunning,
  phase5Runtime,
  phase5ArticleDomainLeaderboard,
  phase5ArticlePreviewJob,
  dynamicFetchDashboardSummary,
  dynamicFetchDashboardHosts,
  indexlabDynamicFetchDashboardResp,
  fetchConcurrency,
  perHostMinDelayMs,
  dynamicCrawleeEnabled,
  dynamicFetchRetryBudget,
  dynamicFetchRetryBackoffMs,
  scannedPdfOcrEnabled,
  scannedPdfOcrPromoteCandidates,
  scannedPdfOcrBackend,
  scannedPdfOcrMaxPages,
  scannedPdfOcrMaxPairs,
  scannedPdfOcrMinCharsPerPage,
  scannedPdfOcrMinLinesPerPage,
  scannedPdfOcrMinConfidence,
}: Phase05PanelProps) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 49 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
          <button
            onClick={onToggle}
            className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            title={collapsed ? 'Open panel' : 'Close panel'}
          >
            {collapsed ? '+' : '-'}
          </button>
          <span>Parallel Fetch & Parse (Phase 05)</span>
          <Tip text="Starter Phase 05 visibility: in-flight fetch parallelism, fetch completion mix (HTTP/browser), and active host load." />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            run {selectedIndexLabRunId || '-'} | {phase5StatusLabel}
          </div>
          <ActivityGauge
            label="phase 05 activity"
            currentPerMin={phase5Activity.currentPerMin}
            peakPerMin={phase5Activity.peakPerMin}
            active={processRunning}
          />
        </div>
      </div>
      {!collapsed ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 xl:grid-cols-10 gap-2 text-xs">
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">in-flight now<Tip text="Current number of fetch jobs that are running right now." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.activeInflight)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">peak in-flight<Tip text="Highest concurrent in-flight fetch count seen during this run view." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.peakInflight)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">fetch started<Tip text="Total fetch-start events emitted so far." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.started)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">fetch completed<Tip text="Fetch jobs that completed successfully regardless of downstream parse/index state." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.completed)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">fetch failed<Tip text="Fetch jobs that ended in an explicit failure event." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.failed)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">http finished<Tip text="Completed fetches using HTTP transport." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.httpCount)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">browser finished<Tip text="Completed fetches using browser automation/rendering path." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.browserCount)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">other/unknown<Tip text="Completed fetches where transport mode is missing or non-standard." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.otherCount)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">p95 fetch<Tip text="95th percentile fetch duration (network + transfer), from fetch completion events." /></div>
              <div className="font-semibold">{formatLatencyMs(phase5Runtime.fetchP95Ms)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">p95 parse<Tip text="95th percentile parse/extraction duration captured on processed sources." /></div>
              <div className="font-semibold">{formatLatencyMs(phase5Runtime.parseP95Ms)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">article sampled<Tip text="Parse events that carried article extraction telemetry (method/quality/chars)." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.articleSamples)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">readability hits<Tip text="Count of parse events where article extractor method was Readability." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.articleReadability)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">fallback hits<Tip text="Count of parse events where fallback/heuristic article extraction was used." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.articleFallback)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">avg article score<Tip text="Average article quality score from extraction telemetry (0-100)." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.articleAvgScore, 1)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">low-quality article<Tip text="Article extraction rows flagged as low quality by score/length guard." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.articleLowQuality)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">json-ld rows<Tip text="Phase 05 structured metadata rows detected in JSON-LD blocks across processed URLs." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.structuredJsonLd)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">microdata rows<Tip text="Phase 05 structured metadata rows detected in Microdata surfaces." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.structuredMicrodata)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">opengraph keys<Tip text="Phase 05 OpenGraph key count from structured sidecar extraction." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.structuredOpengraph)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">structured cands<Tip text="Structured candidates accepted by identity gate and forwarded into deterministic extraction lane." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.structuredCandidates)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">structured rejected<Tip text="Structured candidates rejected by target identity gate (multi-product or mismatch)." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.structuredRejected)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">structured errors<Tip text="Sidecar extraction errors captured fail-open; parsing continues without blocking run." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.structuredErrors)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">pdf docs parsed<Tip text="Phase 06 text-PDF docs successfully parsed from manufacturer/manual links." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.pdfDocsParsed)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">pdf pairs<Tip text="Total normalized PDF key/value assertions extracted (kv + table)." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.pdfPairsTotal)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">pdf kv pairs<Tip text="Line/key-value style assertions extracted from text PDF surfaces." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.pdfKvPairs)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">pdf table pairs<Tip text="Table-grid assertions extracted from structured PDF tables." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.pdfTablePairs)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">pdf pages scanned<Tip text="Total PDF pages scanned by parser backends for processed docs." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.pdfPagesScanned)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">pdf errors<Tip text="PDF parser/router errors emitted while keeping runtime fail-open." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.pdfErrors)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">scanned docs<Tip text="Phase 07 scanned/image-only PDFs detected during parse routing." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.scannedPdfDocsDetected)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">ocr attempted<Tip text="Scanned PDFs where OCR worker path was attempted." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.scannedPdfOcrDocsAttempted)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">ocr succeeded<Tip text="Scanned PDFs that produced at least one OCR key/value pair." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.scannedPdfOcrDocsSucceeded)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">ocr pairs<Tip text="Total OCR-derived pairs from scanned PDF surfaces (kv + table)." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.scannedPdfOcrPairs)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">ocr kv/table<Tip text="OCR pair split by key-value and table-derived rows." /></div>
              <div className="font-semibold">
                {formatNumber(phase5Runtime.scannedPdfOcrKvPairs)}/{formatNumber(phase5Runtime.scannedPdfOcrTablePairs)}
              </div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">ocr low conf<Tip text="OCR pairs flagged below confidence threshold for caution/review." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.scannedPdfOcrLowConfPairs)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">ocr conf avg<Tip text="Average OCR confidence reported across scanned PDF OCR attempts." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.scannedPdfOcrConfidenceAvg, 3)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">ocr errors<Tip text="Scanned PDF OCR errors captured fail-open while extraction continues." /></div>
              <div className="font-semibold">{formatNumber(phase5Runtime.scannedPdfOcrErrors)}</div>
            </div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
            <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
              Active Hosts ({formatNumber(phase5Runtime.hostsActive.length)} shown)
              <Tip text="Per-host in-flight concurrency snapshot from current runtime events." />
            </div>
            <table className="mt-2 min-w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-1 pr-3">host</th>
                  <th className="py-1 pr-3">in-flight</th>
                </tr>
              </thead>
              <tbody>
                {phase5Runtime.hostsActive.length === 0 ? (
                  <tr>
                    <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={2}>no active hosts</td>
                  </tr>
                ) : (
                  phase5Runtime.hostsActive.map((row) => (
                    <tr key={`phase5-host:${row.host}`} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3 font-mono">{row.host}</td>
                      <td className="py-1 pr-3">{formatNumber(row.inflight)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2 space-y-2">
            <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
              Scheduler & Fallback
              <Tip text="Concurrent fetch scheduler activity. Shows fallback attempts when a fetcher mode (crawlee/playwright/http) fails and the scheduler tries an alternate mode. Only active when FETCH_SCHEDULER_ENABLED=true." />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">fallback started<Tip text="Fetcher mode fallback attempts initiated after a fetch error (403, timeout, 5xx, network error)." /></div>
                <div className="font-semibold">{formatNumber(phase5Runtime.schedulerFallbackStarted)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">fallback ok<Tip text="Fallback attempts that succeeded with an alternate fetcher mode." /></div>
                <div className="font-semibold text-green-600 dark:text-green-400">{formatNumber(phase5Runtime.schedulerFallbackSucceeded)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">fallback exhausted<Tip text="URLs where all fetcher modes were tried and none succeeded. The URL is marked as failed." /></div>
                <div className="font-semibold text-red-600 dark:text-red-400">{formatNumber(phase5Runtime.schedulerFallbackExhausted)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">host waits<Tip text="Times the scheduler paused before fetching to respect per-host minimum delay (prevents rate-limiting)." /></div>
                <div className="font-semibold">{formatNumber(phase5Runtime.schedulerHostWaits)}</div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="text-gray-500 dark:text-gray-400 flex items-center">ticks<Tip text="Scheduler processing ticks (one per completed fetch slot). Higher values = more concurrent throughput." /></div>
                <div className="font-semibold">{formatNumber(phase5Runtime.schedulerTicks)}</div>
              </div>
            </div>
            <table className="mt-1 min-w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      time
                      <Tip text="Timestamp when the scheduler fallback event was emitted." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      status
                      <Tip text="Fallback lifecycle stage: started (attempting alternate mode), succeeded (alternate mode worked), exhausted (all modes failed)." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      from
                      <Tip text="Fetcher mode that failed and triggered the fallback (crawlee, playwright, or http)." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      to
                      <Tip text="Alternate fetcher mode attempted as fallback." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      outcome
                      <Tip text="Error classification that triggered the fallback (e.g. blocked, server_error, network_timeout)." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      attempt
                      <Tip text="Retry attempt number for this URL (1 = first fallback, 2 = second fallback after first alternate also failed)." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      url
                      <Tip text="URL being fetched when the fallback was triggered." />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {phase5Runtime.schedulerFallbackFeed.length === 0 ? (
                  <tr>
                    <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={7}>no scheduler fallback events yet</td>
                  </tr>
                ) : (
                  phase5Runtime.schedulerFallbackFeed.map((row, idx) => (
                    <tr key={`sched-fb:${row.ts}:${row.kind}:${idx}`} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3">{formatDateTime(row.ts)}</td>
                      <td className={`py-1 pr-3 font-semibold ${
                        row.kind === 'succeeded' ? 'text-green-600 dark:text-green-400'
                          : row.kind === 'exhausted' ? 'text-red-600 dark:text-red-400'
                          : ''
                      }`}>{row.kind}</td>
                      <td className="py-1 pr-3 font-mono">{row.from_mode || '-'}</td>
                      <td className="py-1 pr-3 font-mono">{row.to_mode || '-'}</td>
                      <td className="py-1 pr-3">{row.outcome || '-'}</td>
                      <td className="py-1 pr-3">{row.attempt || '-'}</td>
                      <td className="py-1 pr-3 font-mono truncate max-w-[28rem]" title={row.url || ''}>{row.url || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
            <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
              Dynamic Fetch Dashboard ({formatNumber(dynamicFetchDashboardSummary.hostCount)} hosts)
              <Tip text="Persisted `analysis/dynamic_fetch_dashboard.json` proof with per-host attempts/retries/network/screenshot telemetry." />
            </div>
            <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              generated {formatDateTime(dynamicFetchDashboardSummary.generatedAt)}
              {' '}| requests {formatNumber(dynamicFetchDashboardSummary.requests)}
              {' '}| retries {formatNumber(dynamicFetchDashboardSummary.retries)}
              {' '}| screenshots {formatNumber(dynamicFetchDashboardSummary.screenshots)}
              {' '}| network rows {formatNumber(dynamicFetchDashboardSummary.networkRows)}
              {' '}| graphql rows {formatNumber(dynamicFetchDashboardSummary.graphqlRows)}
              {dynamicFetchDashboardSummary.summaryOnly ? ' | summary-only fallback' : ''}
            </div>
            {indexlabDynamicFetchDashboardResp?.key ? (
              <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate" title={String(indexlabDynamicFetchDashboardResp.key || '')}>
                key {String(indexlabDynamicFetchDashboardResp.key || '')}
              </div>
            ) : null}
            <table className="mt-2 min-w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      host
                      <Tip text="Hostname aggregated in dynamic_fetch_dashboard for this run." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      req
                      <Tip text="Total fetch requests attempted for this host." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      ok
                      <Tip text="Host requests that completed with successful outcomes." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      fail
                      <Tip text="Host requests that ended in failed outcomes." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      retry
                      <Tip text="Total retries consumed for this host across all requests." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      avg fetch
                      <Tip text="Average fetch/network duration per request for this host." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      avg parse
                      <Tip text="Average parse/extraction duration per request for this host." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      net rows
                      <Tip text="Captured network payload rows attributed to this host." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      graphql
                      <Tip text="Captured/replayed GraphQL payload rows for this host." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      screens
                      <Tip text="Screenshot captures successfully recorded for this host." />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {dynamicFetchDashboardHosts.length === 0 ? (
                  <tr>
                    <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={10}>
                      no dynamic dashboard rows yet
                    </td>
                  </tr>
                ) : (
                  dynamicFetchDashboardHosts.slice(0, 24).map((row) => (
                    <tr key={`dyn-host:${row.host || 'unknown'}`} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3 font-mono">{row.host || '-'}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.request_count || 0))}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.success_count || 0))}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.failure_count || 0))}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.retry_count_total || 0))}</td>
                      <td className="py-1 pr-3">{formatLatencyMs(Number(row.avg_fetch_ms || 0))}</td>
                      <td className="py-1 pr-3">{formatLatencyMs(Number(row.avg_parse_ms || 0))}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.network_payload_rows_total || 0))}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.graphql_replay_rows_total || 0))}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.screenshot_count || 0))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2 space-y-2">
            <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
              Structured Snippet Preview
              <Tip text="Recent structured metadata assertions forwarded from Phase 05 into extraction, with identity gate match signals." />
            </div>
            <table className="mt-1 min-w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      surface
                      <Tip text="Structured surface origin (microdata/opengraph/rdfa/microformat/json-ld)." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      key path
                      <Tip text="Flattened structured path used to derive a candidate field key." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      value
                      <Tip text="Preview of normalized assertion value from the structured node." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      match
                      <Tip text="Identity target-match score and pass/fail state for this structured node." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      url
                      <Tip text="Source URL where this structured assertion was captured." />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {phase5Runtime.structuredSnippetRows.length === 0 ? (
                  <tr>
                    <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={5}>no structured snippet rows yet</td>
                  </tr>
                ) : (
                  phase5Runtime.structuredSnippetRows.slice(0, 24).map((row, idx) => (
                    <tr key={`structured-snippet:${row.ts}:${row.key_path}:${idx}`} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3">{row.source_surface || '-'}</td>
                      <td className="py-1 pr-3 font-mono">{row.key_path || '-'}</td>
                      <td className="py-1 pr-3" title={row.value_preview || ''}>{row.value_preview || '-'}</td>
                      <td className="py-1 pr-3">
                        {formatNumber(Number(row.target_match_score || 0), 2)}
                        {' '}
                        {row.target_match_passed ? 'pass' : 'fail'}
                      </td>
                      <td className="py-1 pr-3 font-mono truncate max-w-[28rem]" title={row.url || ''}>{row.url || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2 space-y-2">
            <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
              Article Domain Quality Leaderboard
              <Tip text="Per-host article extraction quality (readability/fallback mix, low-quality rate, parse latency) for Phase 03 tuning." />
            </div>
            <table className="mt-1 min-w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      host
                      <Tip text="Hostname of article extraction rows in this run." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      samples
                      <Tip text="Number of URL rows with article extraction telemetry for this host." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      readability
                      <Tip text="Share of article rows using Readability extraction method." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      fallback
                      <Tip text="Share of article rows using heuristic fallback extraction." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      low q
                      <Tip text="Share of article rows flagged low-quality by score/length gates." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      avg score
                      <Tip text="Average article quality score (0-100) for this host." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      avg chars
                      <Tip text="Average extracted article character count for this host." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      p95 parse
                      <Tip text="95th percentile parse duration across this host's sampled rows." />
                    </span>
                  </th>
                  <th className="py-1 pr-3">
                    <span className="inline-flex items-center gap-1">
                      policy
                      <Tip text="Most common article-extractor policy mode and matched host override token." />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {phase5ArticleDomainLeaderboard.length === 0 ? (
                  <tr>
                    <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={9}>no article-domain rows yet</td>
                  </tr>
                ) : (
                  phase5ArticleDomainLeaderboard.map((row) => (
                    <tr key={`article-host:${row.host}`} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3 font-mono">{row.host}</td>
                      <td className="py-1 pr-3">{formatNumber(row.samples)}</td>
                      <td className="py-1 pr-3">{formatNumber((row.readabilityHits / Math.max(1, row.samples)) * 100, 0)}%</td>
                      <td className="py-1 pr-3">{formatNumber((row.fallbackHits / Math.max(1, row.samples)) * 100, 0)}%</td>
                      <td className="py-1 pr-3">{formatNumber((row.lowQualityCount / Math.max(1, row.samples)) * 100, 0)}%</td>
                      <td className="py-1 pr-3">{formatNumber(row.avgScore, 1)}</td>
                      <td className="py-1 pr-3">{formatNumber(row.avgChars, 0)}</td>
                      <td className="py-1 pr-3">{formatLatencyMs(row.parseP95Ms)}</td>
                      <td className="py-1 pr-3">
                        {row.topMode
                          ? `${row.topMode}${row.topPolicyHost ? ` @ ${row.topPolicyHost}` : ''}${row.policyOverrideCount > 0 ? ` (${row.policyOverrideCount})` : ''}`
                          : '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2 space-y-2">
            <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
              Article Preview (latest parsed URL)
              <Tip text="Shows the most recent article extraction preview captured from parse telemetry for quick quality checks." />
            </div>
            {phase5ArticlePreviewJob ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
                  <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                    <div className="text-gray-500 dark:text-gray-400">method</div>
                    <div className="font-semibold">{phase5ArticlePreviewJob.article_method || '-'}</div>
                  </div>
                  <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                    <div className="text-gray-500 dark:text-gray-400">score</div>
                    <div className="font-semibold">{formatNumber(Number(phase5ArticlePreviewJob.article_quality_score || 0), 1)}</div>
                  </div>
                  <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                    <div className="text-gray-500 dark:text-gray-400">chars</div>
                    <div className="font-semibold">{formatNumber(Number(phase5ArticlePreviewJob.article_char_count || 0))}</div>
                  </div>
                  <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                    <div className="text-gray-500 dark:text-gray-400">low-quality</div>
                    <div className="font-semibold">{phase5ArticlePreviewJob.article_low_quality ? 'yes' : 'no'}</div>
                  </div>
                  <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 md:col-span-2">
                    <div className="text-gray-500 dark:text-gray-400">url</div>
                    <div className="font-mono truncate" title={phase5ArticlePreviewJob.url || ''}>
                      {phase5ArticlePreviewJob.url || '-'}
                    </div>
                  </div>
                </div>
                <div className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs bg-gray-50 dark:bg-gray-900/30">
                  <div className="text-gray-500 dark:text-gray-400 mb-1">title</div>
                  <div className="font-medium text-gray-800 dark:text-gray-100">
                    {phase5ArticlePreviewJob.article_title || '-'}
                  </div>
                  {phase5ArticlePreviewJob.article_fallback_reason ? (
                    <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                      fallback: {phase5ArticlePreviewJob.article_fallback_reason}
                    </div>
                  ) : null}
                </div>
                <pre className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs whitespace-pre-wrap break-words max-h-56 overflow-auto bg-white dark:bg-gray-900/30">
                  {phase5ArticlePreviewJob.article_preview || phase5ArticlePreviewJob.article_excerpt || '(no extracted article preview text for this URL yet)'}
                </pre>
              </>
            ) : (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                no parsed article telemetry yet
              </div>
            )}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            phase 05 runtime knobs: concurrency {fetchConcurrency || '2'} | per-host delay {perHostMinDelayMs || '900'} ms | crawlee {dynamicCrawleeEnabled ? 'on' : 'off'} | retry {dynamicFetchRetryBudget || '1'} | backoff {dynamicFetchRetryBackoffMs || '500'} ms
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            phase 07 runtime knobs: ocr {scannedPdfOcrEnabled ? 'on' : 'off'} | promote {scannedPdfOcrPromoteCandidates ? 'on' : 'off'} | backend {scannedPdfOcrBackend} | max pages {scannedPdfOcrMaxPages || '4'} | max pairs {scannedPdfOcrMaxPairs || '800'} | min chars {scannedPdfOcrMinCharsPerPage || '30'} | min lines {scannedPdfOcrMinLinesPerPage || '2'} | min conf {scannedPdfOcrMinConfidence || '0.5'}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            phase 05 skip reasons: cooldown {formatNumber(phase5Runtime.skippedCooldown)} | blocked budget {formatNumber(phase5Runtime.skippedBlockedBudget)} | retry later {formatNumber(phase5Runtime.skippedRetryLater)}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            article extraction: sampled {formatNumber(phase5Runtime.articleSamples)} | avg score {formatNumber(phase5Runtime.articleAvgScore, 1)} | avg chars {formatNumber(phase5Runtime.articleAvgChars, 0)} | low-quality {formatNumber(phase5Runtime.articleLowQuality)}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            structured extraction: json-ld {formatNumber(phase5Runtime.structuredJsonLd)} | microdata {formatNumber(phase5Runtime.structuredMicrodata)} | opengraph {formatNumber(phase5Runtime.structuredOpengraph)} | accepted {formatNumber(phase5Runtime.structuredCandidates)} | rejected {formatNumber(phase5Runtime.structuredRejected)} | errors {formatNumber(phase5Runtime.structuredErrors)}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            pdf extraction: docs {formatNumber(phase5Runtime.pdfDocsParsed)} | pairs {formatNumber(phase5Runtime.pdfPairsTotal)} | kv {formatNumber(phase5Runtime.pdfKvPairs)} | table {formatNumber(phase5Runtime.pdfTablePairs)} | pages {formatNumber(phase5Runtime.pdfPagesScanned)} | errors {formatNumber(phase5Runtime.pdfErrors)}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            scanned pdf ocr: detected {formatNumber(phase5Runtime.scannedPdfDocsDetected)} | attempted {formatNumber(phase5Runtime.scannedPdfOcrDocsAttempted)} | succeeded {formatNumber(phase5Runtime.scannedPdfOcrDocsSucceeded)} | pairs {formatNumber(phase5Runtime.scannedPdfOcrPairs)} ({formatNumber(phase5Runtime.scannedPdfOcrKvPairs)}/{formatNumber(phase5Runtime.scannedPdfOcrTablePairs)}) | low-conf {formatNumber(phase5Runtime.scannedPdfOcrLowConfPairs)} | avg conf {formatNumber(phase5Runtime.scannedPdfOcrConfidenceAvg, 3)} | errors {formatNumber(phase5Runtime.scannedPdfOcrErrors)}
          </div>
        </>
      ) : null}
    </div>
  );
}
