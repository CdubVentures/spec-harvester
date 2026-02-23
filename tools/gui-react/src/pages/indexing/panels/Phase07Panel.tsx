import { Tip } from '../../../components/common/Tip';
import { ActivityGauge, formatNumber } from '../helpers';
import type { IndexLabPhase07FieldRow } from '../types';

interface Phase07PanelProps {
  collapsed: boolean;
  onToggle: () => void;
  selectedIndexLabRunId: string;
  phase7StatusLabel: string;
  phase7Activity: { currentPerMin: number; peakPerMin: number };
  processRunning: boolean;
  phase7Summary: {
    attempted: number;
    withHits: number;
    satisfied: number;
    unsatisfied: number;
    refsSelected: number;
    distinctSources: number;
    avgHitsPerField: number;
    evidencePoolSize: number;
  };
  phase7FieldRows: IndexLabPhase07FieldRow[];
  phase7PrimeRows: Array<{
    field_key: string;
    score: number;
    url: string;
    host: string;
    tier: string;
    doc_kind: string;
    snippet_id: string;
    quote_preview: string;
    reason_badges: string[];
  }>;
  phase7HitRows: Array<{
    field_key: string;
    score: number;
    url: string;
    host: string;
    tier: string;
    doc_kind: string;
    selected: boolean;
    quote_preview: string;
  }>;
}

export function Phase07Panel({
  collapsed,
  onToggle,
  selectedIndexLabRunId,
  phase7StatusLabel,
  phase7Activity,
  processRunning,
  phase7Summary,
  phase7FieldRows,
  phase7PrimeRows,
  phase7HitRows,
}: Phase07PanelProps) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 52 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
          <button
            onClick={onToggle}
            className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            title={collapsed ? 'Open panel' : 'Close panel'}
          >
            {collapsed ? '+' : '-'}
          </button>
          <span>Tier Retrieval & Prime Sources (Phase 07)</span>
          <Tip text="Per-field tier-aware internal retrieval hits plus selected prime sources proving min_refs and distinct-source policy outcomes." />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            run {selectedIndexLabRunId || '-'} | {phase7StatusLabel}
          </div>
          <ActivityGauge
            label="phase 07 activity"
            currentPerMin={phase7Activity.currentPerMin}
            peakPerMin={phase7Activity.peakPerMin}
            active={processRunning}
          />
        </div>
      </div>
      {!collapsed ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 text-xs">
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">fields attempted<Tip text="NeedSet fields evaluated in Phase 07 retrieval/prime-source build." /></div>
              <div className="font-semibold">{formatNumber(phase7Summary.attempted)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">fields w/ hits<Tip text="Fields with at least one ranked retrieval hit." /></div>
              <div className="font-semibold">{formatNumber(phase7Summary.withHits)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">min refs satisfied<Tip text="Fields whose selected prime sources meet the min_refs policy." /></div>
              <div className="font-semibold">{formatNumber(phase7Summary.satisfied)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">unsatisfied<Tip text="Fields still below min_refs or distinct-source requirements." /></div>
              <div className="font-semibold">{formatNumber(phase7Summary.unsatisfied)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">refs selected<Tip text="Total prime-source references selected across fields." /></div>
              <div className="font-semibold">{formatNumber(phase7Summary.refsSelected)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">distinct sources<Tip text="Sum of distinct source keys selected in prime-source packs." /></div>
              <div className="font-semibold">{formatNumber(phase7Summary.distinctSources)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">avg hits/field<Tip text="Average retrieval hits retained per field after ranking and caps." /></div>
              <div className="font-semibold">{formatNumber(phase7Summary.avgHitsPerField, 2)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">evidence pool<Tip text="Distinct provenance evidence rows available to the retriever for this run." /></div>
              <div className="font-semibold">{formatNumber(phase7Summary.evidencePoolSize)}</div>
            </div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
            <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
              Field Retrieval Summary ({formatNumber(phase7FieldRows.length)} rows)
              <Tip text="Per-field retrieval stats, selected refs, and policy pass/fail for Phase 07." />
            </div>
            <table className="mt-2 min-w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-1 pr-3">field</th>
                  <th className="py-1 pr-3">need</th>
                  <th className="py-1 pr-3">hits</th>
                  <th className="py-1 pr-3">refs selected</th>
                  <th className="py-1 pr-3">distinct src</th>
                  <th className="py-1 pr-3">tier pref</th>
                  <th className="py-1 pr-3">state</th>
                  <th className="py-1 pr-3">query</th>
                </tr>
              </thead>
              <tbody>
                {phase7FieldRows.length === 0 ? (
                  <tr>
                    <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={8}>no phase 07 rows yet</td>
                  </tr>
                ) : (
                  phase7FieldRows.slice(0, 40).map((row) => (
                    <tr key={`phase7-field:${row.field_key}`} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3 font-mono">{row.field_key || '-'}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.need_score || 0), 3)}</td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.hits_count || 0))}</td>
                      <td className="py-1 pr-3">
                        {formatNumber(Number(row.refs_selected || 0))}/{formatNumber(Number(row.min_refs_required || 1))}
                      </td>
                      <td className="py-1 pr-3">
                        {formatNumber(Number(row.distinct_sources_selected || 0))}
                        {row.distinct_sources_required ? <span className="text-[10px] text-amber-600 dark:text-amber-300"> req</span> : null}
                      </td>
                      <td className="py-1 pr-3">{(row.tier_preference || []).map((value) => `t${value}`).join('>') || '-'}</td>
                      <td className="py-1 pr-3">
                        <span className={`px-1.5 py-0.5 rounded ${
                          row.min_refs_satisfied
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        }`}>
                          {row.min_refs_satisfied ? 'satisfied' : 'deficit'}
                        </span>
                      </td>
                      <td className="py-1 pr-3 font-mono truncate max-w-[26rem]" title={row.retrieval_query || ''}>
                        {row.retrieval_query || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                Prime Sources Selected ({formatNumber(phase7PrimeRows.length)} rows)
                <Tip text="Selected prime-source snippets with reasons used to satisfy evidence policy per field." />
              </div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">field</th>
                    <th className="py-1 pr-3">tier</th>
                    <th className="py-1 pr-3">doc</th>
                    <th className="py-1 pr-3">score</th>
                    <th className="py-1 pr-3">source</th>
                    <th className="py-1 pr-3">reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {phase7PrimeRows.length === 0 ? (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={6}>no prime sources selected yet</td>
                    </tr>
                  ) : (
                    phase7PrimeRows.slice(0, 36).map((row, idx) => (
                      <tr key={`phase7-prime:${row.field_key}:${row.snippet_id || idx}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono">{row.field_key}</td>
                        <td className="py-1 pr-3">{row.tier || '-'}</td>
                        <td className="py-1 pr-3">{row.doc_kind || '-'}</td>
                        <td className="py-1 pr-3">{formatNumber(row.score, 3)}</td>
                        <td className="py-1 pr-3 font-mono truncate max-w-[16rem]" title={row.url || row.host}>{row.host || row.url || '-'}</td>
                        <td className="py-1 pr-3">
                          <div className="flex flex-wrap gap-1">
                            {row.reason_badges.slice(0, 4).map((reason) => (
                              <span key={`phase7-prime-reason:${row.field_key}:${reason}:${idx}`} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
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
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                Top Retrieval Hits ({formatNumber(phase7HitRows.length)} rows)
                <Tip text="Top ranked retrieval hits per field; selected rows indicate hits promoted into prime sources." />
              </div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">field</th>
                    <th className="py-1 pr-3">selected</th>
                    <th className="py-1 pr-3">tier</th>
                    <th className="py-1 pr-3">doc</th>
                    <th className="py-1 pr-3">score</th>
                    <th className="py-1 pr-3">quote</th>
                  </tr>
                </thead>
                <tbody>
                  {phase7HitRows.length === 0 ? (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={6}>no retrieval hits yet</td>
                    </tr>
                  ) : (
                    phase7HitRows.slice(0, 44).map((row, idx) => (
                      <tr key={`phase7-hit:${row.field_key}:${row.url}:${idx}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono">{row.field_key}</td>
                        <td className="py-1 pr-3">
                          <span className={`px-1.5 py-0.5 rounded ${
                            row.selected
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                          }`}>
                            {row.selected ? 'yes' : 'no'}
                          </span>
                        </td>
                        <td className="py-1 pr-3">{row.tier || '-'}</td>
                        <td className="py-1 pr-3">{row.doc_kind || '-'}</td>
                        <td className="py-1 pr-3">{formatNumber(row.score, 3)}</td>
                        <td className="py-1 pr-3">
                          <div className="truncate max-w-[26rem]" title={row.quote_preview || row.url}>
                            {row.quote_preview || row.url || '-'}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
