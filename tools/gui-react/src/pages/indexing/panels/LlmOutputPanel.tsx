import { Tip } from '../../../components/common/Tip';
import {
  formatNumber,
  formatDateTime,
  llmPhaseLabel,
  llmPhaseBadgeClasses,
  panelStateChipClasses,
  prettyJsonText,
} from '../helpers';
import type {
  IndexLabSearchProfileResponse,
  IndexLabLlmTraceRow,
  IndexLabLlmTracesResponse,
} from '../types';

interface LlmOutputCandidateRow {
  query: string;
  url: string;
  doc_kind: string;
  tier_name?: string;
  score: number;
  reason_codes: string[];
}

interface DocHintRow {
  doc_hint: string;
  queries: string[];
}

interface FieldQueryRow {
  field: string;
  queries: string[];
  isFocus: boolean;
}

interface Phase3Status {
  state: string;
  label: string;
  message: string;
}

interface LlmOutputPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  selectedIndexLabRunId: string;
  indexlabSearchProfile: IndexLabSearchProfileResponse | null;
  llmOutputSelectedCandidates: LlmOutputCandidateRow[];
  llmOutputRejectedCandidates: LlmOutputCandidateRow[];
  llmOutputDocHintRows: DocHintRow[];
  llmOutputFieldQueryRows: FieldQueryRow[];
  phase3Status: Phase3Status;
  indexlabLlmTracesResp: IndexLabLlmTracesResponse | null | undefined;
  llmTraceRows: IndexLabLlmTraceRow[];
  selectedLlmTrace: IndexLabLlmTraceRow | null;
  onTraceSelect: (id: string) => void;
}

export function LlmOutputPanel({
  collapsed,
  onToggle,
  selectedIndexLabRunId,
  indexlabSearchProfile,
  llmOutputSelectedCandidates,
  llmOutputRejectedCandidates,
  llmOutputDocHintRows,
  llmOutputFieldQueryRows,
  phase3Status,
  indexlabLlmTracesResp,
  llmTraceRows,
  selectedLlmTrace,
  onTraceSelect,
}: LlmOutputPanelProps) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 80 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
          <button
            onClick={onToggle}
            className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            title={collapsed ? 'Open panel' : 'Close panel'}
          >
            {collapsed ? '+' : '-'}
          </button>
          <span>LLM Output Review (All Phases)</span>
          <Tip text="Readable review of SearchProfile + SERP triage + raw traced LLM calls across all phases." />
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          run {selectedIndexLabRunId || '-'}
        </div>
      </div>
      {!collapsed ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">aliases</div>
              <div className="font-semibold">{formatNumber((indexlabSearchProfile?.identity_aliases || []).length)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">negative terms</div>
              <div className="font-semibold">{formatNumber((indexlabSearchProfile?.negative_terms || []).length)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">top K selected</div>
              <div className="font-semibold">{formatNumber(llmOutputSelectedCandidates.length)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">junk/wrong-model skips</div>
              <div className="font-semibold">{formatNumber(llmOutputRejectedCandidates.length)}</div>
            </div>
          </div>

          <div className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs">
            <div className="font-semibold text-gray-800 dark:text-gray-200">SearchProfile JSON (Phase 02)</div>
            <div className="mt-1 text-gray-500 dark:text-gray-400">
              Strict output review: identity aliases, negative terms, doc_hint templates, and field-target query variants.
            </div>
            <div className="mt-2">
              <div className="text-gray-500 dark:text-gray-400">identity aliases</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(indexlabSearchProfile?.identity_aliases || []).length === 0 ? (
                  <span className="text-gray-500 dark:text-gray-400">no aliases</span>
                ) : (
                  (indexlabSearchProfile?.identity_aliases || []).slice(0, 24).map((row) => (
                    <span key={`llm-out-alias:${row.alias}`} className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                      {row.alias}
                      {row.source ? ` (${row.source})` : ''}
                    </span>
                  ))
                )}
              </div>
            </div>
            <div className="mt-2">
              <div className="text-gray-500 dark:text-gray-400">negative terms</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(indexlabSearchProfile?.negative_terms || []).length === 0 ? (
                  <span className="text-gray-500 dark:text-gray-400">no negative terms</span>
                ) : (
                  (indexlabSearchProfile?.negative_terms || []).slice(0, 24).map((token) => (
                    <span key={`llm-out-neg:${token}`} className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                      {token}
                    </span>
                  ))
                )}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-1 xl:grid-cols-2 gap-2">
              <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
                <div className="font-semibold text-gray-800 dark:text-gray-200">doc_hint query templates</div>
                <table className="mt-2 min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-1 pr-3">doc hint</th>
                      <th className="py-1 pr-3">queries</th>
                    </tr>
                  </thead>
                  <tbody>
                    {llmOutputDocHintRows.length === 0 && (
                      <tr>
                        <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={2}>no doc_hint templates</td>
                      </tr>
                    )}
                    {llmOutputDocHintRows.slice(0, 20).map((row) => (
                      <tr key={`llm-out-doc:${row.doc_hint}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3">{row.doc_hint || '-'}</td>
                        <td className="py-1 pr-3">{(row.queries || []).slice(0, 3).join(' | ') || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
                <div className="font-semibold text-gray-800 dark:text-gray-200">field-target query variants</div>
                <table className="mt-2 min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-1 pr-3">field</th>
                      <th className="py-1 pr-3">queries</th>
                    </tr>
                  </thead>
                  <tbody>
                    {llmOutputFieldQueryRows.length === 0 && (
                      <tr>
                        <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={2}>no field-target query variants</td>
                      </tr>
                    )}
                    {llmOutputFieldQueryRows.slice(0, 24).map((row) => (
                      <tr key={`llm-out-field:${row.field}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono">
                          {row.field}
                          {row.isFocus ? (
                            <span className="ml-1 px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">focus</span>
                          ) : null}
                        </td>
                        <td className="py-1 pr-3">{row.queries.slice(0, 3).join(' | ') || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-gray-800 dark:text-gray-200">Phase 03 output review</div>
              <span className={`px-1.5 py-0.5 rounded text-xs ${panelStateChipClasses(
                phase3Status.state === 'live'
                  ? 'live'
                  : (phase3Status.state === 'ready' ? 'ready' : 'waiting')
              )}`}>
                {phase3Status.label}
              </span>
            </div>
            <div className="text-gray-500 dark:text-gray-400">
              {phase3Status.message}
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="font-semibold text-gray-800 dark:text-gray-200">Top K URLs to fetch</div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">url</th>
                    <th className="py-1 pr-3">query</th>
                    <th className="py-1 pr-3">doc kind</th>
                    <th className="py-1 pr-3">tier</th>
                    <th className="py-1 pr-3">score</th>
                    <th className="py-1 pr-3">reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {llmOutputSelectedCandidates.length === 0 && (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={6}>
                        no selected urls yet ({phase3Status.label})
                      </td>
                    </tr>
                  )}
                  {llmOutputSelectedCandidates.slice(0, 16).map((row) => (
                    <tr key={`llm-out-sel:${row.query}:${row.url}`} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3 font-mono truncate max-w-[28rem]" title={row.url}>{row.url}</td>
                      <td className="py-1 pr-3 font-mono truncate max-w-[20rem]" title={row.query}>{row.query}</td>
                      <td className="py-1 pr-3">{row.doc_kind || '-'}</td>
                      <td className="py-1 pr-3">{row.tier_name || '-'}</td>
                      <td className="py-1 pr-3">{formatNumber(row.score, 3)}</td>
                      <td className="py-1 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {row.reason_codes.slice(0, 4).map((reason) => (
                            <span key={`llm-out-sel-reason:${row.url}:${reason}`} className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                              {reason}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="font-semibold text-gray-800 dark:text-gray-200">Wrong model / junk skips</div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">url</th>
                    <th className="py-1 pr-3">query</th>
                    <th className="py-1 pr-3">doc kind</th>
                    <th className="py-1 pr-3">score</th>
                    <th className="py-1 pr-3">skip reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {llmOutputRejectedCandidates.length === 0 && (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={5}>
                        no junk/wrong-model skips yet ({phase3Status.label})
                      </td>
                    </tr>
                  )}
                  {llmOutputRejectedCandidates.slice(0, 20).map((row) => (
                    <tr key={`llm-out-rej:${row.query}:${row.url}`} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3 font-mono truncate max-w-[28rem]" title={row.url}>{row.url}</td>
                      <td className="py-1 pr-3 font-mono truncate max-w-[20rem]" title={row.query}>{row.query}</td>
                      <td className="py-1 pr-3">{row.doc_kind || '-'}</td>
                      <td className="py-1 pr-3">{formatNumber(row.score, 3)}</td>
                      <td className="py-1 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {row.reason_codes.slice(0, 4).map((reason) => (
                            <span key={`llm-out-rej-reason:${row.url}:${reason}`} className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                              {reason}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-gray-800 dark:text-gray-200">LLM call trace (all phases)</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {formatNumber(Number(indexlabLlmTracesResp?.count || llmTraceRows.length))} calls traced
                </div>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                      <th className="py-1 pr-3">time</th>
                      <th className="py-1 pr-3">phase</th>
                      <th className="py-1 pr-3">role</th>
                      <th className="py-1 pr-3">purpose</th>
                      <th className="py-1 pr-3">provider</th>
                      <th className="py-1 pr-3">model</th>
                      <th className="py-1 pr-3">status</th>
                      <th className="py-1 pr-3">tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {llmTraceRows.length === 0 && (
                      <tr>
                        <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={8}>
                          no llm traces yet for this run
                        </td>
                      </tr>
                    )}
                    {llmTraceRows.slice(0, 40).map((row) => {
                      const isSelected = selectedLlmTrace?.id === row.id;
                      const tokenCount = Number(row.usage?.total_tokens || 0);
                      return (
                        <tr
                          key={row.id}
                          className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                          onClick={() => onTraceSelect(row.id)}
                          title="Click to inspect prompt/response"
                        >
                          <td className="py-1 pr-3">{formatDateTime(row.ts || null)}</td>
                          <td className="py-1 pr-3">{llmPhaseLabel(String(row.phase || ''))}</td>
                          <td className="py-1 pr-3">{row.role || '-'}</td>
                          <td className="py-1 pr-3 font-mono truncate max-w-[18rem]" title={String(row.purpose || '')}>{row.purpose || '-'}</td>
                          <td className="py-1 pr-3">{row.provider || '-'}</td>
                          <td className="py-1 pr-3 font-mono truncate max-w-[16rem]" title={String(row.model || '')}>{row.model || '-'}</td>
                          <td className="py-1 pr-3">{row.status || '-'}</td>
                          <td className="py-1 pr-3">{formatNumber(tokenCount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="font-semibold text-gray-800 dark:text-gray-200">
                    Selected call details
                  </div>
                  {selectedLlmTrace ? (
                    <div className="text-gray-500 dark:text-gray-400">
                      {llmPhaseLabel(String(selectedLlmTrace.phase || ''))}
                      {selectedLlmTrace.purpose ? ` | ${selectedLlmTrace.purpose}` : ''}
                    </div>
                  ) : null}
                </div>
                {!selectedLlmTrace ? (
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">select a traced call to inspect its output</div>
                ) : (
                  <div className="mt-2 grid grid-cols-1 xl:grid-cols-2 gap-2 text-xs">
                    <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
                      <div className="font-semibold text-gray-800 dark:text-gray-200">prompt</div>
                      <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] max-h-64 overflow-y-auto text-gray-700 dark:text-gray-200">
                        {prettyJsonText(String(selectedLlmTrace.prompt_preview || '')) || '(no prompt trace)'}
                      </pre>
                    </div>
                    <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
                      <div className="font-semibold text-gray-800 dark:text-gray-200">response</div>
                      <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] max-h-64 overflow-y-auto text-gray-700 dark:text-gray-200">
                        {prettyJsonText(String(selectedLlmTrace.response_preview || '')) || '(no response trace)'}
                      </pre>
                      {selectedLlmTrace.error ? (
                        <div className="mt-2 rounded border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/20 p-2 text-rose-700 dark:text-rose-300">
                          {selectedLlmTrace.error}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
