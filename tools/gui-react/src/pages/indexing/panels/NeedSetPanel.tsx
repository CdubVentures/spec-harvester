import { Tip } from '../../../components/common/Tip';
import {
  ActivityGauge,
  formatNumber,
  formatDateTime,
  needsetRequiredLevelBadge,
  needsetReasonBadge,
  NeedsetSparkline,
} from '../helpers';
import type {
  IndexLabNeedSetResponse,
  IndexLabNeedSetRow,
} from '../types';

type NeedsetSortKey = 'need_score' | 'field_key' | 'required_level' | 'confidence' | 'best_tier_seen' | 'refs';

interface IdentityStateShape {
  status: string;
  confidence: number | null;
  maxMatch: number | null;
  extractionGateOpen: boolean;
  familyModelCount: number;
  ambiguityLevel: string;
  ambiguityLabel: string;
  publishable: boolean;
  gateValidated: boolean;
  blockers: string[];
  reasonCodes: string[];
  pageCount: number;
}

interface IdentityAuditRow {
  source_id: string;
  url: string;
  decision: string;
  confidence: number | null;
  reason_codes: string[];
  ts: string;
}

interface NeedSetPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  indexlabNeedset: IndexLabNeedSetResponse | null;
  indexlabNeedsetRows: IndexLabNeedSetRow[];
  indexlabNeedsetIdentityState: IdentityStateShape;
  indexlabNeedsetSparklineValues: number[];
  indexlabNeedsetIdentityAuditRows: IdentityAuditRow[];
  onSortChange: (key: NeedsetSortKey) => void;
  needsetActivity: { currentPerMin: number; peakPerMin: number };
  processRunning: boolean;
}

export function NeedSetPanel({
  collapsed,
  onToggle,
  indexlabNeedset,
  indexlabNeedsetRows,
  indexlabNeedsetIdentityState,
  indexlabNeedsetSparklineValues,
  indexlabNeedsetIdentityAuditRows,
  onSortChange,
  needsetActivity,
  processRunning,
}: NeedSetPanelProps) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 space-y-3" style={{ order: 45 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center text-sm font-semibold text-gray-900 dark:text-gray-100">
          <button
            onClick={onToggle}
            className="inline-flex items-center justify-center w-5 h-5 mr-1 text-[10px] rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            title={collapsed ? 'Open panel' : 'Close panel'}
          >
            {collapsed ? '+' : '-'}
          </button>
          <span>NeedSet (Phase 01)</span>
          <Tip text="Field-level deficits with tier/confidence/evidence reasons and priority score." />
        </div>
        <ActivityGauge
          label="needset activity"
          currentPerMin={needsetActivity.currentPerMin}
          peakPerMin={needsetActivity.peakPerMin}
          active={processRunning}
          tooltip="Rate of NeedSet recompute/index-related activity events."
        />
      </div>
      {!collapsed ? (
        <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
          <div className="text-gray-500 dark:text-gray-400 flex items-center">needset size<Tip text="Count of fields currently in deficit and needing more work." /></div>
          <div className="font-semibold">{formatNumber(Number(indexlabNeedset?.needset_size || 0))}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
          <div className="text-gray-500 dark:text-gray-400 flex items-center">total fields<Tip text="Total tracked fields in the contract snapshot for this run." /></div>
          <div className="font-semibold">{formatNumber(Number(indexlabNeedset?.total_fields || 0))}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
          <div className="text-gray-500 dark:text-gray-400 flex items-center">rows<Tip text="Visible NeedSet rows after sorting and runtime merge." /></div>
          <div className="font-semibold">{formatNumber(indexlabNeedsetRows.length)}</div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
          <div className="text-gray-500 dark:text-gray-400 flex items-center">generated<Tip text="Timestamp when the latest NeedSet payload was generated." /></div>
          <div className="font-semibold">{formatDateTime(indexlabNeedset?.generated_at || null)}</div>
        </div>
      </div>

      <div className="rounded border border-gray-200 dark:border-gray-700 p-2 text-xs">
        <div className="font-semibold text-gray-800 dark:text-gray-200 flex items-center">
          identity lock state
          <Tip text="Phase 01: identity evidence lock for this NeedSet snapshot (locked/provisional/unlocked/conflict)." />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className={`px-2 py-0.5 rounded ${
            indexlabNeedsetIdentityState.status === 'locked'
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
              : indexlabNeedsetIdentityState.status === 'provisional'
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                : indexlabNeedsetIdentityState.status === 'conflict'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  : 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
          }`}>
            {indexlabNeedsetIdentityState.status}
          </span>
          <span className="inline-flex items-center gap-1">
            confidence {indexlabNeedsetIdentityState.confidence === null ? '-' : formatNumber(Number(indexlabNeedsetIdentityState.confidence || 0), 3)}
            <Tip text="Aggregate identity confidence from accepted identity evidence for this run snapshot." />
          </span>
          <span className="inline-flex items-center gap-1">
            best match {indexlabNeedsetIdentityState.maxMatch === null ? '-' : formatNumber(Number(indexlabNeedsetIdentityState.maxMatch || 0), 3)}
            <Tip text="Highest single-source identity-match score seen in the identity audit rows." />
          </span>
          <span className="inline-flex items-center gap-1">
            gate {indexlabNeedsetIdentityState.gateValidated ? 'validated' : 'not-validated'}
            <Tip text="Identity gate validation status required before publish can pass." />
          </span>
          <span className="inline-flex items-center gap-1">
            extraction {indexlabNeedsetIdentityState.extractionGateOpen ? 'open' : 'gated'}
            <Tip text="Extraction gate for required/critical fields. Open allows provisional extraction even before final publish lock." />
          </span>
          <span className="inline-flex items-center gap-1">
            ambiguity {indexlabNeedsetIdentityState.ambiguityLabel || indexlabNeedsetIdentityState.ambiguityLevel} ({formatNumber(indexlabNeedsetIdentityState.familyModelCount || 0)})
            <Tip text="Brand+model family size from catalog. Higher counts imply more sibling variants and stricter identity ambiguity handling." />
          </span>
          <span className="inline-flex items-center gap-1">
            publish {indexlabNeedsetIdentityState.publishable ? 'allowed' : 'blocked'}
            <Tip text="Publish gate state for this run based on identity + confidence/evidence checks." />
          </span>
          <span className="inline-flex items-center gap-1">
            pages {formatNumber(indexlabNeedsetIdentityState.pageCount || 0)}
            <Tip text="Count of fetched pages currently contributing to identity evidence scoring." />
          </span>
        </div>
        {(indexlabNeedsetIdentityState.blockers || []).length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {(indexlabNeedsetIdentityState.blockers || []).slice(0, 8).map((reason) => (
              <span key={`needset-lock-blocker:${reason}`} className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                blocker {reason}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
        <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center">needset size over time<Tip text="Sparkline of NeedSet size snapshots through the run." /></div>
        <NeedsetSparkline values={indexlabNeedsetSparklineValues} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
        <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
          <div className="font-semibold text-gray-800 dark:text-gray-200 flex items-center">reason counts<Tip text="Why fields are still in NeedSet (missing, low_conf, tier_pref_unmet, blocked_by_identity, publish_gate_block, etc.)." /></div>
          <div className="mt-1 flex flex-wrap gap-1">
            {Object.entries(indexlabNeedset?.reason_counts || {}).length === 0 && (
              <span className="text-gray-500 dark:text-gray-400">no reason counts</span>
            )}
            {Object.entries(indexlabNeedset?.reason_counts || {}).map(([reason, count]) => (
              <span
                key={reason}
                className={`px-2 py-0.5 rounded ${needsetReasonBadge(reason)}`}
              >
                {reason} {formatNumber(Number(count || 0))}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded border border-gray-200 dark:border-gray-700 p-2">
          <div className="font-semibold text-gray-800 dark:text-gray-200 flex items-center">required level counts<Tip text="NeedSet rows grouped by required level: identity, critical, required, optional." /></div>
          <div className="mt-1 flex flex-wrap gap-1">
            {Object.entries(indexlabNeedset?.required_level_counts || {}).length === 0 && (
              <span className="text-gray-500 dark:text-gray-400">no required-level counts</span>
            )}
            {Object.entries(indexlabNeedset?.required_level_counts || {}).map(([level, count]) => {
              const badge = needsetRequiredLevelBadge(level);
              return (
                <span key={level} className={`px-2 py-0.5 rounded ${badge.cls}`}>
                  {level} {formatNumber(Number(count || 0))}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
        <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 flex items-center">
          identity audit rows ({formatNumber(indexlabNeedsetIdentityAuditRows.length)} shown)
          <Tip text="Source-level identity decisions linked to NeedSet lock state for Phase 01 auditability." />
        </div>
        <table className="mt-2 min-w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="py-1 pr-3">
                <div className="inline-flex items-center">
                  <span>source</span>
                  <Tip text="Domain/source evaluated by identity audit for product match confidence." />
                </div>
              </th>
              <th className="py-1 pr-3">
                <div className="inline-flex items-center">
                  <span>decision</span>
                  <Tip text="Identity decision for this source row (accepted/rejected/review)." />
                </div>
              </th>
              <th className="py-1 pr-3">
                <div className="inline-flex items-center">
                  <span>confidence</span>
                  <Tip text="Row-level identity confidence score used by lock/gate calculations." />
                </div>
              </th>
              <th className="py-1 pr-3">
                <div className="inline-flex items-center">
                  <span>reason codes</span>
                  <Tip text="Identity-rule outcomes that explain the decision for this source row." />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {indexlabNeedsetIdentityAuditRows.length === 0 && (
              <tr>
                <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={4}>no identity audit rows yet</td>
              </tr>
            )}
            {indexlabNeedsetIdentityAuditRows.map((row, idx) => (
              <tr key={`needset-audit:${row.source_id || row.url || idx}`} className="border-b border-gray-100 dark:border-gray-800">
                <td className="py-1 pr-3 font-mono truncate max-w-[26rem]" title={row.url || row.source_id}>
                  {row.source_id || row.url || '-'}
                </td>
                <td className="py-1 pr-3">{row.decision || '-'}</td>
                <td className="py-1 pr-3">{row.confidence === null ? '-' : formatNumber(Number(row.confidence || 0), 3)}</td>
                <td className="py-1 pr-3">
                  {(row.reason_codes || []).length > 0 ? (row.reason_codes || []).slice(0, 6).join(', ') : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded border border-gray-200 dark:border-gray-700 p-2 overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="py-1 pr-3">
                <div className="inline-flex items-center">
                  <button onClick={() => onSortChange('field_key')} className="hover:underline">field</button>
                  <Tip text="Canonical field key from the contract." />
                </div>
              </th>
              <th className="py-1 pr-3">
                <div className="inline-flex items-center">
                  <button onClick={() => onSortChange('required_level')} className="hover:underline">required</button>
                  <Tip text="Contract priority level for this field." />
                </div>
              </th>
              <th className="py-1 pr-3">
                <div className="inline-flex items-center">
                  <button onClick={() => onSortChange('need_score')} className="hover:underline">need score</button>
                  <Tip text="Priority score used to decide what to search/fetch next." />
                </div>
              </th>
              <th className="py-1 pr-3">
                <div className="inline-flex items-center">
                  <button onClick={() => onSortChange('confidence')} className="hover:underline">confidence</button>
                  <Tip text="Current best confidence for the field value." />
                </div>
              </th>
              <th className="py-1 pr-3">
                <div className="inline-flex items-center">
                  <button onClick={() => onSortChange('best_tier_seen')} className="hover:underline">best tier</button>
                  <Tip text="Highest source quality tier seen for this field so far." />
                </div>
              </th>
              <th className="py-1 pr-3">
                <div className="inline-flex items-center">
                  <button onClick={() => onSortChange('refs')} className="hover:underline">refs</button>
                  <Tip text="Evidence refs found vs required minimum refs." />
                </div>
              </th>
              <th className="py-1 pr-3">
                <div className="inline-flex items-center">
                  <span>blocked by</span>
                  <Tip text="Identity/publish gating blocks currently applied to this field." />
                </div>
              </th>
              <th className="py-1 pr-3">
                <div className="inline-flex items-center">
                  <span>id match</span>
                  <Tip text="Best identity-match score available to this NeedSet snapshot." />
                </div>
              </th>
              <th className="py-1 pr-3">
                <div className="inline-flex items-center">
                  <span>reasons</span>
                  <Tip text="Reason tags explaining why the field is still in NeedSet." />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {indexlabNeedsetRows.length === 0 && (
              <tr>
                <td className="py-2 text-gray-500 dark:text-gray-400" colSpan={9}>no NeedSet rows yet</td>
              </tr>
            )}
            {indexlabNeedsetRows.map((row) => {
              const reqBadge = needsetRequiredLevelBadge(row.required_level);
              const refsGap = (Number(row.refs_found) || 0) - (Number(row.min_refs) || 0);
              const effectiveConfidence = Number.isFinite(Number(row.effective_confidence))
                ? Number(row.effective_confidence)
                : (Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : null);
              return (
                <tr key={row.field_key} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-1 pr-3 font-mono">{row.field_key}</td>
                  <td className="py-1 pr-3">
                    <span className={`px-1.5 py-0.5 rounded ${reqBadge.cls}`}>
                      {reqBadge.short} {row.required_level || 'optional'}
                    </span>
                  </td>
                  <td className="py-1 pr-3">{formatNumber(Number(row.need_score || 0), 3)}</td>
                  <td className="py-1 pr-3">
                    {effectiveConfidence === null ? '-' : formatNumber(effectiveConfidence, 3)}
                    {row.confidence_capped ? (
                      <span className="ml-1 inline-flex items-center gap-1">
                        <span className="px-1 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                          capped
                        </span>
                        <Tip text="Confidence was capped due to identity uncertainty or publish-gate policy." />
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1 pr-3">{row.best_tier_seen === null ? '-' : formatNumber(Number(row.best_tier_seen || 0))}</td>
                  <td className="py-1 pr-3">
                    {formatNumber(Number(row.refs_found || 0))}/{formatNumber(Number(row.min_refs || 0))}
                    <span className={`ml-1 ${refsGap >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
                      ({refsGap >= 0 ? '+' : ''}{formatNumber(refsGap)})
                    </span>
                  </td>
                  <td className="py-1 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {(row.blocked_by || []).length === 0 ? <span>-</span> : null}
                      {(row.blocked_by || []).map((reason) => (
                        <span key={`${row.field_key}:blocked:${reason}`} className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                          {reason}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-1 pr-3">
                    {row.best_identity_match === null || row.best_identity_match === undefined
                      ? '-'
                      : formatNumber(Number(row.best_identity_match || 0), 3)}
                    {row.quarantined ? (
                      <span className="ml-1 inline-flex items-center gap-1">
                        <span className="px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                          quarantine
                        </span>
                        <Tip text="Field value is quarantined from publish output until identity gate is validated." />
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {(row.reasons || []).map((reason) => (
                        <span key={`${row.field_key}:${reason}`} className={`px-1.5 py-0.5 rounded ${needsetReasonBadge(reason)}`}>
                          {reason}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
        </>
      ) : null}
    </div>
  );
}
