import { Tip } from '../../../components/common/Tip';
import { formatNumber, formatDateTime } from '../helpers';
import type { IndexLabSerpExplorerResponse, IndexLabSerpQueryRow } from '../types';

interface SerpExplorerPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  indexlabSerpExplorer: IndexLabSerpExplorerResponse | null;
  indexlabSerpRows: IndexLabSerpQueryRow[];
  phase3StatusLabel: string;
}

export function SerpExplorerPanel({
  collapsed,
  onToggle,
  indexlabSerpExplorer,
  indexlabSerpRows,
  phase3StatusLabel,
}: SerpExplorerPanelProps) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 47 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
          <button
            onClick={onToggle}
            className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            title={collapsed ? 'Open panel' : 'Close panel'}
          >
            {collapsed ? '+' : '-'}
          </button>
          <span>SERP Explorer (Phase 03)</span>
          <Tip text="Per-query candidate URLs with tier/doc_kind tags and triage decision proof." />
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {indexlabSerpExplorer
            ? `${indexlabSerpExplorer.provider || 'unknown'}${indexlabSerpExplorer.summary_only ? ' | summary fallback' : ''}`
            : 'not generated'}
        </div>
      </div>
      {!collapsed && indexlabSerpExplorer ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">candidates checked</div>
              <div className="font-semibold">{formatNumber(Number(indexlabSerpExplorer.candidates_checked || 0))}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">urls triaged</div>
              <div className="font-semibold">{formatNumber(Number(indexlabSerpExplorer.urls_triaged || 0))}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">urls selected</div>
              <div className="font-semibold">{formatNumber(Number(indexlabSerpExplorer.urls_selected || 0))}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">duplicates removed</div>
              <div className="font-semibold">{formatNumber(Number(indexlabSerpExplorer.duplicates_removed || 0))}</div>
            </div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            generated {formatDateTime(indexlabSerpExplorer.generated_at || null)}
            {' '}| queries {formatNumber(indexlabSerpRows.length)}
            {' '}| llm triage {indexlabSerpExplorer.llm_triage_enabled ? 'enabled' : 'off'}
            {indexlabSerpExplorer.llm_triage_model ? ` (${indexlabSerpExplorer.llm_triage_model})` : ''}
          </div>
          <div className="space-y-2">
            {indexlabSerpRows.length === 0 ? (
              <div className="text-xs text-gray-500 dark:text-gray-400">no SERP rows yet</div>
            ) : (
              indexlabSerpRows.slice(0, 16).map((row) => (
                <div key={row.query} className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
                  <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 font-mono truncate" title={row.query}>
                    {row.query}
                  </div>
                  <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    hint {row.hint_source || '-'} | doc {row.doc_hint || '-'} | targets {(row.target_fields || []).join(', ') || '-'} | selected {formatNumber(Number(row.selected_count || 0))}/{formatNumber(Number(row.candidate_count || 0))}
                  </div>
                  <table className="mt-2 min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                        <th className="py-1 pr-3">url</th>
                        <th className="py-1 pr-3">tier</th>
                        <th className="py-1 pr-3">doc kind</th>
                        <th className="py-1 pr-3">score</th>
                        <th className="py-1 pr-3">decision</th>
                        <th className="py-1 pr-3">reasons</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(row.candidates || []).length === 0 ? (
                        <tr>
                          <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={6}>no candidates</td>
                        </tr>
                      ) : (
                        (row.candidates || []).slice(0, 12).map((candidate) => (
                          <tr key={`${row.query}:${candidate.url}`} className="border-b border-gray-100 dark:border-gray-800">
                            <td className="py-1 pr-3 font-mono truncate max-w-[32rem]" title={candidate.url}>
                              {candidate.url}
                            </td>
                            <td className="py-1 pr-3">
                              {candidate.tier_name || (Number.isFinite(Number(candidate.tier)) ? `tier ${candidate.tier}` : '-')}
                            </td>
                            <td className="py-1 pr-3">{candidate.doc_kind || '-'}</td>
                            <td className="py-1 pr-3">{formatNumber(Number(candidate.triage_score || 0), 3)}</td>
                            <td className="py-1 pr-3">
                              <span className={`px-1.5 py-0.5 rounded ${
                                candidate.decision === 'selected'
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                  : candidate.decision === 'rejected'
                                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                                    : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                              }`}>
                                {candidate.decision || 'pending'}
                              </span>
                            </td>
                            <td className="py-1 pr-3">
                              <div className="flex flex-wrap gap-1">
                                {(candidate.reason_codes || []).slice(0, 4).map((reason) => (
                                  <span key={`${candidate.url}:${reason}`} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                    {reason}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </div>
        </>
      ) : !collapsed ? (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          no SERP payload yet for this run ({phase3StatusLabel}).
        </div>
      ) : null}
    </div>
  );
}
