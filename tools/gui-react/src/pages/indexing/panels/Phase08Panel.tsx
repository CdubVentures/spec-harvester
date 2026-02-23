import { Tip } from '../../../components/common/Tip';
import { ActivityGauge, formatNumber } from '../helpers';
import type { IndexLabPhase08BatchRow, IndexLabPhase08FieldContextRow, IndexLabPhase08PrimeRow } from '../types';

interface Phase08PanelProps {
  collapsed: boolean;
  onToggle: () => void;
  selectedIndexLabRunId: string;
  phase8StatusLabel: string;
  phase8Activity: { currentPerMin: number; peakPerMin: number };
  processRunning: boolean;
  phase8Summary: {
    batchCount: number;
    batchErrorCount: number;
    schemaFailRate: number;
    rawCandidateCount: number;
    acceptedCandidateCount: number;
    danglingRefCount: number;
    danglingRefRate: number;
    policyViolationCount: number;
    policyViolationRate: number;
    minRefsSatisfied: number;
    minRefsTotal: number;
    minRefsSatisfiedRate: number;
    validatorContextFields: number;
    validatorPrimeRows: number;
  };
  phase8Batches: IndexLabPhase08BatchRow[];
  phase8FieldContextRows: IndexLabPhase08FieldContextRow[];
  phase8PrimeRows: IndexLabPhase08PrimeRow[];
}

export function Phase08Panel({
  collapsed,
  onToggle,
  selectedIndexLabRunId,
  phase8StatusLabel,
  phase8Activity,
  processRunning,
  phase8Summary,
  phase8Batches,
  phase8FieldContextRows,
  phase8PrimeRows,
}: Phase08PanelProps) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 53 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
          <button
            onClick={onToggle}
            className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            title={collapsed ? 'Open panel' : 'Close panel'}
          >
            {collapsed ? '+' : '-'}
          </button>
          <span>Extraction Context Matrix (Phase 08)</span>
          <Tip text="Batch-level extraction context wiring proof: policy-aware prompt assembly, snippet reference integrity, and min-refs compliance rates." />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            run {selectedIndexLabRunId || '-'} | {phase8StatusLabel}
          </div>
          <ActivityGauge
            label="phase 08 activity"
            currentPerMin={phase8Activity.currentPerMin}
            peakPerMin={phase8Activity.peakPerMin}
            active={processRunning}
          />
        </div>
      </div>
      {!collapsed ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2 text-xs">
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">batches<Tip text="Total extraction batches executed or skipped in this run." /></div>
              <div className="font-semibold">{formatNumber(phase8Summary.batchCount)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">batch errors<Tip text="Batches that failed before producing valid structured extraction output." /></div>
              <div className="font-semibold">{formatNumber(phase8Summary.batchErrorCount)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">schema fail rate<Tip text="Failed batch ratio across all Phase 08 extraction batches." /></div>
              <div className="font-semibold">{formatNumber(phase8Summary.schemaFailRate * 100, 2)}%</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">raw candidates<Tip text="Candidate rows returned before evidence/policy filtering." /></div>
              <div className="font-semibold">{formatNumber(phase8Summary.rawCandidateCount)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">accepted<Tip text="Candidate rows accepted after schema and evidence reference checks." /></div>
              <div className="font-semibold">{formatNumber(phase8Summary.acceptedCandidateCount)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">dangling refs<Tip text="Candidates dropped because evidence refs did not resolve to provided snippet ids." /></div>
              <div className="font-semibold">{formatNumber(phase8Summary.danglingRefCount)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">policy violations<Tip text="Rows dropped by missing refs, dangling refs, or evidence verifier failures." /></div>
              <div className="font-semibold">{formatNumber(phase8Summary.policyViolationCount)}</div>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
              <div className="text-gray-500 dark:text-gray-400 flex items-center">min refs satisfied<Tip text="Accepted candidate rows meeting field-level min_evidence_refs thresholds." /></div>
              <div className="font-semibold">
                {formatNumber(phase8Summary.minRefsSatisfied)}/{formatNumber(phase8Summary.minRefsTotal)}
              </div>
            </div>
          </div>
          <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
            <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
              Extraction Batches ({formatNumber(phase8Batches.length)} rows)
              <Tip text="Batch-by-batch extraction outcomes showing context usage, candidate filtering, and policy pass counters." />
            </div>
            <table className="mt-2 min-w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-1 pr-3">batch</th>
                  <th className="py-1 pr-3">status</th>
                  <th className="py-1 pr-3">model</th>
                  <th className="py-1 pr-3">counts</th>
                  <th className="py-1 pr-3">drops</th>
                  <th className="py-1 pr-3">min refs</th>
                  <th className="py-1 pr-3">ms</th>
                  <th className="py-1 pr-3">source</th>
                </tr>
              </thead>
              <tbody>
                {phase8Batches.length === 0 ? (
                  <tr>
                    <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={8}>no phase 08 batch rows yet</td>
                  </tr>
                ) : (
                  phase8Batches.slice(0, 80).map((row, idx) => (
                    <tr key={`phase8-batch:${row.batch_id || idx}:${idx}`} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3 font-mono">{row.batch_id || '-'}</td>
                      <td className="py-1 pr-3">
                        <span className={`px-1.5 py-0.5 rounded ${
                          String(row.status || '').includes('failed')
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
                            : (String(row.status || '').includes('completed')
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200')
                        }`}>
                          {row.status || '-'}
                        </span>
                      </td>
                      <td className="py-1 pr-3 font-mono truncate max-w-[12rem]" title={row.model || ''}>{row.model || '-'}</td>
                      <td className="py-1 pr-3">
                        f:{formatNumber(Number(row.target_field_count || 0))}
                        {' '}s:{formatNumber(Number(row.snippet_count || 0))}
                        {' '}a:{formatNumber(Number(row.accepted_candidate_count || 0))}
                      </td>
                      <td className="py-1 pr-3">
                        miss:{formatNumber(Number(row.dropped_missing_refs || 0))}
                        {' '}dang:{formatNumber(Number(row.dropped_invalid_refs || 0))}
                      </td>
                      <td className="py-1 pr-3">
                        {formatNumber(Number(row.min_refs_satisfied_count || 0))}/{formatNumber(Number(row.min_refs_total || 0))}
                      </td>
                      <td className="py-1 pr-3">{formatNumber(Number(row.elapsed_ms || 0))}</td>
                      <td className="py-1 pr-3 font-mono truncate max-w-[14rem]" title={row.source_url || row.source_host || ''}>{row.source_host || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                Field Contexts ({formatNumber(phase8FieldContextRows.length)} rows)
                <Tip text="Prompt-time field context matrix: required level, parse template intent, and evidence policy per field." />
              </div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">field</th>
                    <th className="py-1 pr-3">level</th>
                    <th className="py-1 pr-3">difficulty</th>
                    <th className="py-1 pr-3">ai</th>
                    <th className="py-1 pr-3">parse</th>
                    <th className="py-1 pr-3">policy</th>
                  </tr>
                </thead>
                <tbody>
                  {phase8FieldContextRows.length === 0 ? (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={6}>no field context rows yet</td>
                    </tr>
                  ) : (
                    phase8FieldContextRows.slice(0, 60).map((row) => (
                      <tr key={`phase8-fieldctx:${row.field_key || '-'}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono">{row.field_key || '-'}</td>
                        <td className="py-1 pr-3">{row.required_level || '-'}</td>
                        <td className="py-1 pr-3">{row.difficulty || '-'}</td>
                        <td className="py-1 pr-3">{row.ai_mode || '-'}</td>
                        <td className="py-1 pr-3 font-mono">{row.parse_template_intent?.template_id || '-'}</td>
                        <td className="py-1 pr-3">
                          min:{formatNumber(Number(row.evidence_policy?.min_evidence_refs || 1))}
                          {row.evidence_policy?.distinct_sources_required ? ' | distinct' : ''}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
                Prime Snippet Pack ({formatNumber(phase8PrimeRows.length)} rows)
                <Tip text="Prime snippet rows attached through Phase 08 context for extraction and validator review." />
              </div>
              <table className="mt-2 min-w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="py-1 pr-3">field</th>
                    <th className="py-1 pr-3">snippet</th>
                    <th className="py-1 pr-3">source</th>
                    <th className="py-1 pr-3">quote</th>
                  </tr>
                </thead>
                <tbody>
                  {phase8PrimeRows.length === 0 ? (
                    <tr>
                      <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={4}>no prime snippet rows yet</td>
                    </tr>
                  ) : (
                    phase8PrimeRows.slice(0, 60).map((row, idx) => (
                      <tr key={`phase8-prime:${row.field_key || ''}:${row.snippet_id || idx}`} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-1 pr-3 font-mono">{row.field_key || '-'}</td>
                        <td className="py-1 pr-3 font-mono">{row.snippet_id || '-'}</td>
                        <td className="py-1 pr-3 font-mono truncate max-w-[14rem]" title={row.url || row.source_id || ''}>
                          {row.source_id || row.url || '-'}
                        </td>
                        <td className="py-1 pr-3">
                          <div className="truncate max-w-[24rem]" title={row.quote_preview || ''}>
                            {row.quote_preview || '-'}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            validator context fields: {formatNumber(phase8Summary.validatorContextFields)} | validator prime rows: {formatNumber(phase8Summary.validatorPrimeRows)}
          </div>
        </>
      ) : null}
    </div>
  );
}
