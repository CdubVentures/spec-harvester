import { Tip } from '../../../components/common/Tip';
import { ActivityGauge, formatNumber, formatDateTime } from '../helpers';
import type { IndexLabRunSummary } from '../types';

interface RecentJob {
  url: string;
  status: string;
  fetcher_kind?: string;
  fetch_attempts: number;
  fetch_retry_count: number;
  fetch_policy_host?: string;
  fetch_policy_override?: boolean;
  static_dom_mode?: string;
  static_dom_accepted?: number;
  static_dom_rejected?: number;
  structured_json_ld_count?: number;
  structured_microdata_count?: number;
  structured_opengraph_count?: number;
  structured_candidates?: number;
  structured_rejected_candidates?: number;
  pdf_docs_parsed?: number;
  pdf_backend_selected?: string;
  pdf_pairs_total?: number;
  pdf_kv_pairs?: number;
  pdf_table_pairs?: number;
  pdf_error_count?: number;
  scanned_pdf_docs_detected?: number;
  scanned_pdf_ocr_docs_attempted?: number;
  scanned_pdf_ocr_docs_succeeded?: number;
  scanned_pdf_ocr_backend_selected?: string;
  scanned_pdf_ocr_pairs?: number;
  scanned_pdf_ocr_kv_pairs?: number;
  scanned_pdf_ocr_table_pairs?: number;
  scanned_pdf_ocr_low_conf_pairs?: number;
  scanned_pdf_ocr_error_count?: number;
  article_policy_mode?: string;
  article_policy_host?: string;
  article_policy_override?: boolean;
  status_code?: number;
  ms?: number;
  parse_ms?: number;
  article_method?: string;
  article_quality_score?: number;
  article_low_quality?: boolean;
  started_at?: string;
  finished_at?: string;
}

interface IndexLabRunRow {
  run_id: string;
  status?: string;
  product_id?: string;
}

interface SelectedRunRow {
  run_id: string;
  product_id?: string;
  started_at?: string;
  ended_at?: string;
  identity_lock_status?: string;
  dedupe_mode?: string;
  phase_cursor?: string;
  status?: string;
}

interface IndexlabSummaryShape {
  counters: Record<string, number>;
  stageWindows: Record<string, { started_at?: string; ended_at?: string }>;
  recentJobs: RecentJob[];
}

interface EventStreamPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  selectedIndexLabRunId: string;
  onRunIdChange: (runId: string) => void;
  indexlabRuns: IndexLabRunRow[];
  selectedIndexLabRun: SelectedRunRow | null;
  selectedRunLiveDuration: string;
  selectedRunIdentityFingerprintShort: string;
  selectedRunStartupSummary: string;
  runViewCleared: boolean;
  indexlabSummary: IndexlabSummaryShape;
  eventStreamActivity: { currentPerMin: number; peakPerMin: number };
  processRunning: boolean;
}

export function EventStreamPanel({
  collapsed,
  onToggle,
  selectedIndexLabRunId,
  onRunIdChange,
  indexlabRuns,
  selectedIndexLabRun,
  selectedRunLiveDuration,
  selectedRunIdentityFingerprintShort,
  selectedRunStartupSummary,
  runViewCleared,
  indexlabSummary,
  eventStreamActivity,
  processRunning,
}: EventStreamPanelProps) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 40 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
          <button
            onClick={onToggle}
            className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            title={collapsed ? 'Open panel' : 'Close panel'}
          >
            {collapsed ? '+' : '-'}
          </button>
          <span>IndexLab Event Stream</span>
          <Tip text="Phase proof: stage timeline and URL fetch outcomes from run events." />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={selectedIndexLabRunId}
            onChange={(e) => onRunIdChange(e.target.value)}
            className="px-2 py-1 text-xs border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
          >
            <option value="">select run</option>
            {indexlabRuns.map((row) => (
              <option key={row.run_id} value={row.run_id}>
                {row.run_id} | {row.status || 'unknown'} {row.product_id ? `| ${row.product_id}` : ''}
              </option>
            ))}
          </select>
          <ActivityGauge
            label="stream activity"
            currentPerMin={eventStreamActivity.currentPerMin}
            peakPerMin={eventStreamActivity.peakPerMin}
            active={processRunning}
          />
        </div>
      </div>
      {!collapsed ? (
        <>

      {selectedIndexLabRun ? (
        <div className="text-xs text-gray-600 dark:text-gray-300 rounded border border-gray-200 dark:border-gray-700 p-2">
          run: <span className="font-mono">{selectedIndexLabRun.run_id}</span>
          {selectedIndexLabRun.product_id ? <span className="font-mono"> | product {selectedIndexLabRun.product_id}</span> : null}
          {selectedIndexLabRun.started_at ? <span> | started {formatDateTime(selectedIndexLabRun.started_at)}</span> : null}
          {selectedIndexLabRun.ended_at ? <span> | ended {formatDateTime(selectedIndexLabRun.ended_at)}</span> : null}
          {selectedIndexLabRun.started_at ? <span> | runtime {selectedRunLiveDuration}</span> : null}
          {selectedIndexLabRun.identity_lock_status ? <span> | lock {selectedIndexLabRun.identity_lock_status}</span> : null}
          {selectedIndexLabRun.dedupe_mode ? <span> | dedupe {selectedIndexLabRun.dedupe_mode}</span> : null}
          {selectedIndexLabRun.phase_cursor ? <span> | cursor {selectedIndexLabRun.phase_cursor}</span> : null}
          {selectedRunIdentityFingerprintShort ? <span> | fp {selectedRunIdentityFingerprintShort}</span> : null}
          <span> | status {selectedIndexLabRun.status || 'unknown'}</span>
          <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{selectedRunStartupSummary}</div>
          {runViewCleared ? (
            <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-300">
              selected run view is cleared; click Replay Selected Run to repopulate from persisted artifacts.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-xs text-gray-500 dark:text-gray-400">no indexlab run selected</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-12 gap-2">
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
          <div className="text-gray-500 dark:text-gray-400">checked</div>
          <div className="font-semibold">{formatNumber(indexlabSummary.counters.pages_checked)}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
          <div className="text-gray-500 dark:text-gray-400">fetched ok</div>
          <div className="font-semibold">{formatNumber(indexlabSummary.counters.fetched_ok)}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
          <div className="text-gray-500 dark:text-gray-400">404</div>
          <div className="font-semibold">{formatNumber(indexlabSummary.counters.fetched_404)}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
          <div className="text-gray-500 dark:text-gray-400">blocked</div>
          <div className="font-semibold">{formatNumber(indexlabSummary.counters.fetched_blocked)}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
          <div className="text-gray-500 dark:text-gray-400">fetch errors</div>
          <div className="font-semibold">{formatNumber(indexlabSummary.counters.fetched_error)}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
          <div className="text-gray-500 dark:text-gray-400">parsed</div>
          <div className="font-semibold">{formatNumber(indexlabSummary.counters.parse_completed)}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
          <div className="text-gray-500 dark:text-gray-400">indexed</div>
          <div className="font-semibold">{formatNumber(indexlabSummary.counters.indexed_docs)}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
          <div className="text-gray-500 dark:text-gray-400">fields filled</div>
          <div className="font-semibold">{formatNumber(indexlabSummary.counters.fields_filled)}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
          <div className="text-gray-500 dark:text-gray-400">json-ld</div>
          <div className="font-semibold">{formatNumber(indexlabSummary.counters.structured_json_ld || 0)}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
          <div className="text-gray-500 dark:text-gray-400">microdata</div>
          <div className="font-semibold">{formatNumber(indexlabSummary.counters.structured_microdata || 0)}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
          <div className="text-gray-500 dark:text-gray-400">opengraph</div>
          <div className="font-semibold">{formatNumber(indexlabSummary.counters.structured_opengraph || 0)}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
          <div className="text-gray-500 dark:text-gray-400">struct cands</div>
          <div className="font-semibold">{formatNumber(indexlabSummary.counters.structured_candidates || 0)}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
          <div className="text-gray-500 dark:text-gray-400">pdf docs</div>
          <div className="font-semibold">{formatNumber(indexlabSummary.counters.pdf_docs_parsed || 0)}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
          <div className="text-gray-500 dark:text-gray-400">pdf pairs</div>
          <div className="font-semibold">{formatNumber(indexlabSummary.counters.pdf_pairs_total || 0)}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
          <div className="text-gray-500 dark:text-gray-400">scanned docs</div>
          <div className="font-semibold">{formatNumber(indexlabSummary.counters.scanned_pdf_docs_detected || 0)}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs">
          <div className="text-gray-500 dark:text-gray-400">scanned ocr pairs</div>
          <div className="font-semibold">{formatNumber(indexlabSummary.counters.scanned_pdf_ocr_pairs || 0)}</div>
        </div>
      </div>

      <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
        <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">Stage Timeline</div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 text-xs">
          {(['search', 'fetch', 'parse', 'index'] as const).map((stage) => {
            const row = indexlabSummary.stageWindows[stage];
            const hasStart = Boolean(row.started_at);
            const hasEnd = Boolean(row.ended_at);
            return (
              <div key={stage} className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
                <div className="font-semibold">{stage}</div>
                <div className="text-gray-500 dark:text-gray-400">
                  {hasStart ? `start ${formatDateTime(row.started_at)}` : 'start -'}
                </div>
                <div className="text-gray-500 dark:text-gray-400">
                  {hasEnd ? `end ${formatDateTime(row.ended_at)}` : (hasStart ? 'running' : 'not started')}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
        <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">
          Recent URL Jobs ({formatNumber(indexlabSummary.recentJobs.length)} shown)
        </div>
        <table className="mt-2 min-w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">url<Tip text="Source URL represented by this job row." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">status<Tip text="Final fetch outcome class for this URL row (ok/404/blocked/error)." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">fetcher<Tip text="Transport/execution path used for fetch (http/playwright/crawlee/etc)." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">tries<Tip text="Total attempts used to fetch this URL (initial + retries)." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">retry<Tip text="Retry count used after the initial fetch attempt." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">policy<Tip text="Matched dynamic fetch policy host and whether an override was applied." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">static dom<Tip text="Static DOM parser mode and accepted/rejected candidate counts for this URL." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">json-ld<Tip text="Structured JSON-LD nodes detected for this URL during parse." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">microdata<Tip text="Structured Microdata nodes detected for this URL during parse." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">opengraph<Tip text="OpenGraph key count detected for this URL during parse." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">struct cands<Tip text="Structured candidates accepted by identity gate for this URL." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">pdf docs<Tip text="Phase 06 text-PDF documents parsed for this URL row." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">pdf backend<Tip text="Selected PDF parser backend for this URL (pdfplumber/pymupdf/camelot)." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">pdf pairs<Tip text="Extracted normalized PDF pairs for this URL (kv + table)." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">scanned docs<Tip text="Scanned/image-only PDF docs detected and OCR attempted/succeeded for this URL." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">scanned backend<Tip text="OCR backend selected for scanned PDF handling on this URL." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">scanned pairs<Tip text="OCR-derived pairs for scanned PDFs (total with kv/table split, low-confidence and error counts)." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">article policy<Tip text="Article extractor policy mode and matched domain override used for this URL." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">http<Tip text="HTTP status code observed for this URL fetch." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">fetch ms<Tip text="Network/fetch duration in milliseconds for the URL job." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">parse ms<Tip text="Parse/extraction duration for the URL job when parse_finished is emitted." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">article<Tip text="Main article extraction method used for this URL (readability/fallback)." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">article q<Tip text="Article extraction quality score (0-100)." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">low<Tip text="Whether article extraction marked this URL as low quality." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">started<Tip text="Timestamp when fetch for this URL started." /></span></th>
              <th className="py-1 pr-3"><span className="inline-flex items-center gap-1">finished<Tip text="Timestamp when this URL job reached its latest completion state." /></span></th>
            </tr>
          </thead>
          <tbody>
            {indexlabSummary.recentJobs.length === 0 && (
              <tr>
                <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={26}>no url jobs yet</td>
              </tr>
            )}
            {indexlabSummary.recentJobs.map((row) => (
              <tr key={row.url} className="border-b border-gray-100 dark:border-gray-800">
                <td className="py-1 pr-3 font-mono truncate max-w-[32rem]" title={row.url}>{row.url}</td>
                <td className="py-1 pr-3">{row.status}</td>
                <td className="py-1 pr-3">{row.fetcher_kind || '-'}</td>
                <td className="py-1 pr-3">{row.fetch_attempts > 0 ? row.fetch_attempts : '-'}</td>
                <td className="py-1 pr-3">{row.fetch_retry_count > 0 ? row.fetch_retry_count : '0'}</td>
                <td className="py-1 pr-3">
                  {row.fetch_policy_host
                    ? `${row.fetch_policy_host}${row.fetch_policy_override ? ' (override)' : ''}`
                    : (row.fetch_policy_override ? 'override' : '-')}
                </td>
                <td className="py-1 pr-3">
                  {row.static_dom_mode
                    ? `${row.static_dom_mode} ${row.static_dom_accepted}/${row.static_dom_rejected}`
                    : '-'}
                </td>
                <td className="py-1 pr-3">{formatNumber(Number(row.structured_json_ld_count || 0))}</td>
                <td className="py-1 pr-3">{formatNumber(Number(row.structured_microdata_count || 0))}</td>
                <td className="py-1 pr-3">{formatNumber(Number(row.structured_opengraph_count || 0))}</td>
                <td className="py-1 pr-3">
                  {formatNumber(Number(row.structured_candidates || 0))}
                  {Number(row.structured_rejected_candidates || 0) > 0 ? ` / ${formatNumber(Number(row.structured_rejected_candidates || 0))} rej` : ''}
                </td>
                <td className="py-1 pr-3">{formatNumber(Number(row.pdf_docs_parsed || 0))}</td>
                <td className="py-1 pr-3 font-mono">{row.pdf_backend_selected || '-'}</td>
                <td className="py-1 pr-3">
                  {formatNumber(Number(row.pdf_pairs_total || 0))}
                  {Number(row.pdf_kv_pairs || 0) > 0 || Number(row.pdf_table_pairs || 0) > 0
                    ? ` (${formatNumber(Number(row.pdf_kv_pairs || 0))}/${formatNumber(Number(row.pdf_table_pairs || 0))})`
                    : ''}
                  {Number(row.pdf_error_count || 0) > 0 ? ` !${formatNumber(Number(row.pdf_error_count || 0))}` : ''}
                </td>
                <td className="py-1 pr-3">
                  {formatNumber(Number(row.scanned_pdf_docs_detected || 0))}
                  {Number(row.scanned_pdf_ocr_docs_attempted || 0) > 0 || Number(row.scanned_pdf_ocr_docs_succeeded || 0) > 0
                    ? ` (${formatNumber(Number(row.scanned_pdf_ocr_docs_attempted || 0))}/${formatNumber(Number(row.scanned_pdf_ocr_docs_succeeded || 0))})`
                    : ''}
                </td>
                <td className="py-1 pr-3 font-mono">{row.scanned_pdf_ocr_backend_selected || '-'}</td>
                <td className="py-1 pr-3">
                  {formatNumber(Number(row.scanned_pdf_ocr_pairs || 0))}
                  {Number(row.scanned_pdf_ocr_kv_pairs || 0) > 0 || Number(row.scanned_pdf_ocr_table_pairs || 0) > 0
                    ? ` (${formatNumber(Number(row.scanned_pdf_ocr_kv_pairs || 0))}/${formatNumber(Number(row.scanned_pdf_ocr_table_pairs || 0))})`
                    : ''}
                  {Number(row.scanned_pdf_ocr_low_conf_pairs || 0) > 0 ? ` low:${formatNumber(Number(row.scanned_pdf_ocr_low_conf_pairs || 0))}` : ''}
                  {Number(row.scanned_pdf_ocr_error_count || 0) > 0 ? ` !${formatNumber(Number(row.scanned_pdf_ocr_error_count || 0))}` : ''}
                </td>
                <td className="py-1 pr-3">
                  {row.article_policy_mode
                    ? `${row.article_policy_mode}${row.article_policy_host ? ` @ ${row.article_policy_host}` : ''}${row.article_policy_override ? ' (override)' : ''}`
                    : '-'}
                </td>
                <td className="py-1 pr-3">{row.status_code || '-'}</td>
                <td className="py-1 pr-3">{row.ms || '-'}</td>
                <td className="py-1 pr-3">{row.parse_ms || '-'}</td>
                <td className="py-1 pr-3">{row.article_method || '-'}</td>
                <td className="py-1 pr-3">{Number.isFinite(Number(row.article_quality_score)) ? formatNumber(Number(row.article_quality_score || 0), 1) : '-'}</td>
                <td className="py-1 pr-3">
                  {row.article_low_quality ? (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">yes</span>
                  ) : 'no'}
                </td>
                <td className="py-1 pr-3">{formatDateTime(row.started_at)}</td>
                <td className="py-1 pr-3">{formatDateTime(row.finished_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
        </>
      ) : null}
    </div>
  );
}
