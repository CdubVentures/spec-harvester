import { Tip } from '../../../components/common/Tip';
import { formatNumber, formatDateTime, normalizeToken } from '../helpers';
import type {
  IndexLabSearchProfileResponse,
  IndexLabSearchProfileQueryRow,
} from '../types';

interface QueryRejectRow {
  query?: string;
  source?: string;
  reason: string;
  stage?: string;
  detail?: string;
}

interface AliasRejectRow {
  alias?: string;
  source?: string;
  reason?: string;
  stage?: string;
}

interface QueryRejectBreakdown {
  ordered: QueryRejectRow[];
  safety: QueryRejectRow[];
  pruned: QueryRejectRow[];
}

interface SearchProfilePanelProps {
  collapsed: boolean;
  onToggle: () => void;
  indexlabSearchProfile: IndexLabSearchProfileResponse | null;
  indexlabSearchProfileRows: IndexLabSearchProfileQueryRow[];
  indexlabSearchProfileVariantGuardTerms: string[];
  indexlabSearchProfileQueryRejectBreakdown: QueryRejectBreakdown;
  indexlabSearchProfileAliasRejectRows: AliasRejectRow[];
}

export function SearchProfilePanel({
  collapsed,
  onToggle,
  indexlabSearchProfile,
  indexlabSearchProfileRows,
  indexlabSearchProfileVariantGuardTerms,
  indexlabSearchProfileQueryRejectBreakdown,
  indexlabSearchProfileAliasRejectRows,
}: SearchProfilePanelProps) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 46 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
          <button
            onClick={onToggle}
            className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            title={collapsed ? 'Open panel' : 'Close panel'}
          >
            {collapsed ? '+' : '-'}
          </button>
          <span>Search Profile (Phase 02)</span>
          <Tip text="Deterministic aliases and field-targeted query templates with hint provenance." />
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {indexlabSearchProfile?.status || 'not generated'}
        </div>
      </div>
      {!collapsed && indexlabSearchProfile ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">aliases</div>
              <div className="font-semibold">{formatNumber((indexlabSearchProfile.identity_aliases || []).length)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">focus fields</div>
              <div className="font-semibold">{formatNumber((indexlabSearchProfile.focus_fields || []).length)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">queries</div>
              <div className="font-semibold">
                {formatNumber(indexlabSearchProfile.selected_query_count || indexlabSearchProfileRows.length)}
              </div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400">generated</div>
              <div className="font-semibold">{formatDateTime(indexlabSearchProfile.generated_at || null)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">
                variant guards
                <Tip text="Identity/model guard terms used by pre-execution query validation." />
              </div>
              <div className="font-semibold">{formatNumber(indexlabSearchProfileVariantGuardTerms.length)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">
                query rejects
                <Tip text="Total dropped query candidates (pruned + safety guard rejects) before execution." />
              </div>
              <div className="font-semibold">
                {formatNumber(indexlabSearchProfileQueryRejectBreakdown.ordered.length)}
              </div>
            </div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            llm query planner {indexlabSearchProfile.llm_query_planning ? 'enabled' : 'off'}
            {indexlabSearchProfile.llm_query_model ? ` (${indexlabSearchProfile.llm_query_model})` : ''}
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs">
            <div className="text-gray-500 dark:text-gray-400">identity aliases</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {(indexlabSearchProfile.identity_aliases || []).length === 0 ? (
                <span className="text-gray-500 dark:text-gray-400">no aliases</span>
              ) : (
                (indexlabSearchProfile.identity_aliases || []).slice(0, 16).map((row) => (
                  <span key={row.alias} className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                    {row.alias}
                  </span>
                ))
              )}
            </div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs">
            <div className="text-gray-500 dark:text-gray-400 flex items-center">
              variant guard terms
              <Tip text="Canonical identity/model tokens used to hard-reject off-model discovery queries." />
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {indexlabSearchProfileVariantGuardTerms.length === 0 ? (
                <span className="text-gray-500 dark:text-gray-400">no guard terms</span>
              ) : (
                indexlabSearchProfileVariantGuardTerms.map((term) => (
                  <span key={`variant-guard:${term}`} className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    {term}
                  </span>
                ))
              )}
            </div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs">
            <div className="text-gray-500 dark:text-gray-400 flex items-center">
              query guard summary
              <Tip text="Pre-execution guard enforces brand/model/digit checks before provider search dispatch." />
            </div>
            <div className="mt-1 flex flex-wrap gap-2">
              <span>
                accepted {formatNumber(Number(indexlabSearchProfile.query_guard?.accepted_query_count || indexlabSearchProfile.selected_query_count || 0))}
              </span>
              <span>
                rejected {formatNumber(indexlabSearchProfileQueryRejectBreakdown.ordered.length)}
              </span>
              <span>
                required digit groups {(indexlabSearchProfile.query_guard?.required_digit_groups || []).length > 0 ? (indexlabSearchProfile.query_guard?.required_digit_groups || []).join(', ') : '-'}
              </span>
            </div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
            <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">
              Query Plan ({formatNumber(indexlabSearchProfileRows.length)} rows)
            </div>
            <table className="mt-2 min-w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-1 pr-3">query</th>
                  <th className="py-1 pr-3">hint source</th>
                  <th className="py-1 pr-3">target fields</th>
                  <th className="py-1 pr-3">doc hint</th>
                  <th className="py-1 pr-3">hits</th>
                </tr>
              </thead>
              <tbody>
                {indexlabSearchProfileRows.length === 0 && (
                  <tr>
                    <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={5}>no query rows yet</td>
                  </tr>
                )}
                {indexlabSearchProfileRows.slice(0, 40).map((row) => (
                  <tr key={row.query} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-1 pr-3 font-mono truncate max-w-[42rem]" title={row.query}>{row.query}</td>
                    <td className="py-1 pr-3">{row.hint_source || '-'}</td>
                    <td className="py-1 pr-3">
                      {(row.target_fields || []).length > 0 ? (row.target_fields || []).slice(0, 4).join(', ') : '-'}
                    </td>
                    <td className="py-1 pr-3">{row.doc_hint || '-'}</td>
                    <td className="py-1 pr-3">{formatNumber(Number(row.result_count || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                Query Drop Log ({formatNumber(indexlabSearchProfileQueryRejectBreakdown.ordered.length)})
                <Tip text="Dropped query audit split into Safety Rejected (guard) vs Pruned (dedupe/cap). Safety rows are shown first." />
              </div>
              <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 flex flex-wrap gap-2">
                <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  safety rejected {formatNumber(indexlabSearchProfileQueryRejectBreakdown.safety.length)}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  pruned (expected) {formatNumber(indexlabSearchProfileQueryRejectBreakdown.pruned.length)}
                </span>
              </div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">query</th>
                    <th className="py-1 pr-3">source</th>
                    <th className="py-1 pr-3">reason</th>
                    <th className="py-1 pr-3">stage</th>
                  </tr>
                </thead>
                <tbody>
                  {indexlabSearchProfileQueryRejectBreakdown.ordered.length === 0 && (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={4}>no query rejects</td>
                    </tr>
                  )}
                  {indexlabSearchProfileQueryRejectBreakdown.ordered.slice(0, 40).map((row, idx) => {
                    const reason = normalizeToken(row.reason);
                    const stage = normalizeToken(row.stage);
                    const isSafety = (
                      stage === 'pre_execution_guard'
                      || reason.startsWith('missing_brand_token')
                      || reason.startsWith('missing_required_digit_group')
                      || reason.startsWith('foreign_model_token')
                    );
                    return (
                      <tr key={`query-reject:${row.query || row.reason || idx}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono truncate max-w-[34rem]" title={row.query || row.detail || '-'}>
                          {row.query || '-'}
                        </td>
                        <td className="py-1 pr-3">{row.source || '-'}</td>
                        <td className="py-1 pr-3">
                          <span className={`px-1.5 py-0.5 rounded ${
                            isSafety
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                          }`}>
                            {row.reason || '-'}
                          </span>
                        </td>
                        <td className="py-1 pr-3">{row.stage || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                Alias Reject Log ({formatNumber(indexlabSearchProfileAliasRejectRows.length)})
                <Tip text="Dropped deterministic alias audit (duplicate/empty/cap) for Phase 02 explainability." />
              </div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">alias</th>
                    <th className="py-1 pr-3">source</th>
                    <th className="py-1 pr-3">reason</th>
                    <th className="py-1 pr-3">stage</th>
                  </tr>
                </thead>
                <tbody>
                  {indexlabSearchProfileAliasRejectRows.length === 0 && (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={4}>no alias rejects</td>
                    </tr>
                  )}
                  {indexlabSearchProfileAliasRejectRows.slice(0, 40).map((row, idx) => (
                    <tr key={`alias-reject:${row.alias || row.reason || idx}`} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3 font-mono">{row.alias || '-'}</td>
                      <td className="py-1 pr-3">{row.source || '-'}</td>
                      <td className="py-1 pr-3">{row.reason || '-'}</td>
                      <td className="py-1 pr-3">{row.stage || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : !collapsed ? (
        <div className="text-xs text-gray-500 dark:text-gray-400">no Search Profile payload yet for this run</div>
      ) : null}
    </div>
  );
}
