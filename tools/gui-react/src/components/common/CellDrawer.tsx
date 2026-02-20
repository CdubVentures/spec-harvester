import type { ReactNode } from 'react';
import { pct } from '../../utils/formatting';
import { Spinner } from './Spinner';
import {
  DrawerShell,
  DrawerSection,
  DrawerCard,
  DrawerValueRow,
  DrawerBadges,
  DrawerManualOverride,
  DrawerActionStack,
} from './DrawerShell';
import type { ReviewCandidate } from '../../types/review';

// ── Shared sub-components ───────────────────────────────────────────

function extractHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${k}:${stableSerialize(v)}`).join(',')}}`;
  }
  return String(value ?? '');
}

function normalizeComparable(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim().toLowerCase();
  return stableSerialize(value).trim().toLowerCase();
}

function SourceBadge({ candidate }: { candidate: ReviewCandidate }) {
  const tier = candidate.tier;
  const tierLabel = tier != null ? `T${tier}` : '';
  const tierColor = tier === 1
    ? 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300'
    : tier === 2
      ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300';

  return (
    <div className="flex gap-1 items-center flex-wrap">
      {tierLabel && (
        <span className={`px-1.5 py-0 text-[9px] rounded ${tierColor}`}>{tierLabel}</span>
      )}
      {candidate.source && (
        <span className="text-[9px] text-gray-400">{candidate.source}</span>
      )}
      {candidate.method && (
        <span className="text-[9px] text-gray-400">via {candidate.method}</span>
      )}
    </div>
  );
}

function EvidenceSnippet({ candidate }: { candidate: ReviewCandidate }) {
  const evidence = candidate.evidence;
  if (!evidence) return null;

  const snippetText = evidence.snippet_text || '';
  const quote = evidence.quote || '';
  const span = evidence.quote_span;
  const host = evidence.url ? extractHost(evidence.url) : '';

  let highlighted: ReactNode = snippetText;
  if (span && span.length === 2 && snippetText) {
    const [start, end] = span;
    const before = snippetText.slice(0, start);
    const match = snippetText.slice(start, end);
    const after = snippetText.slice(end);
    highlighted = (
      <>
        <span className="text-gray-500">{before}</span>
        <mark className="bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 px-0.5 rounded">{match}</mark>
        <span className="text-gray-500">{after}</span>
      </>
    );
  } else if (quote && snippetText) {
    const index = snippetText.indexOf(quote);
    if (index >= 0) {
      const before = snippetText.slice(0, index);
      const after = snippetText.slice(index + quote.length);
      highlighted = (
        <>
          <span className="text-gray-500">{before}</span>
          <mark className="bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 px-0.5 rounded">{quote}</mark>
          <span className="text-gray-500">{after}</span>
        </>
      );
    }
  }

  return (
    <div className="space-y-1.5 border border-gray-200 dark:border-gray-700 rounded p-2 bg-gray-50 dark:bg-gray-900">
      {evidence.url && (
        <div className="flex items-center gap-1.5">
          {host && <span className="text-[10px] text-gray-500 shrink-0">{host}</span>}
          <a
            href={evidence.url}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline text-[11px] truncate"
            title={evidence.url}
          >
            {evidence.url}
          </a>
        </div>
      )}
      {snippetText && (
        <div className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
          {highlighted}
        </div>
      )}
      {!snippetText && quote && (
        <div className="text-[11px] leading-relaxed italic text-gray-600 dark:text-gray-400">
          &ldquo;{quote}&rdquo;
        </div>
      )}
      <div className="flex gap-3 text-[9px] text-gray-400">
        {evidence.snippet_id && <span>snippet: {evidence.snippet_id.slice(0, 8)}</span>}
        {evidence.retrieved_at && <span>{evidence.retrieved_at.slice(0, 10)}</span>}
      </div>
    </div>
  );
}

// ── CellDrawer Props ────────────────────────────────────────────────

export interface CellDrawerProps {
  title: string;
  subtitle: string;
  onClose: () => void;

  // Section 1: Current accepted value
  currentValue: {
    value: string;
    confidence: number;
    color: 'green' | 'yellow' | 'red' | 'gray' | 'purple';
    source?: string;
    sourceTimestamp?: string | null;
    overridden?: boolean;
    acceptedCandidateId?: string | null;
  };
  sharedAcceptedCandidateId?: string | null;
  badges: Array<{ label: string; className: string }>;
  isCurrentAccepted?: boolean;
  onAcceptCurrent?: () => void;

  // Section 2: Manual override
  onManualOverride: (value: string) => void;
  manualOverrideLabel?: string;
  manualOverridePlaceholder?: string;
  isPending: boolean;

  // Section 3: Candidates
  candidates: ReviewCandidate[];
  candidatesLoading?: boolean;
  onAcceptCandidate?: (candidateId: string, candidate: ReviewCandidate) => void;
  onConfirmCandidate?: (candidateId: string, candidate: ReviewCandidate) => void;
  onRunAIReview?: () => void;
  aiReviewPending?: boolean;

  // Section 4: Surface-specific slots
  extraActions?: ReactNode;
  extraSections?: ReactNode;

  // Pending AI confirmation — legacy single-lane
  pendingAIConfirmation?: boolean;

  // Two-lane pending AI
  pendingAIPrimary?: boolean;
  pendingAIShared?: boolean;
  pendingPrimaryCandidateId?: string | null;
  pendingSharedCandidateId?: string | null;
  pendingPrimaryCandidateIds?: string[];
  pendingSharedCandidateIds?: string[];
  onConfirmPrimary?: () => void;
  onConfirmShared?: () => void;
  onConfirmPrimaryCandidate?: (candidateId: string, candidate: ReviewCandidate) => void;
  onConfirmSharedCandidate?: (candidateId: string, candidate: ReviewCandidate) => void;
  onAcceptPrimary?: () => void;
  onAcceptShared?: () => void;
  onAcceptPrimaryCandidate?: (candidateId: string, candidate: ReviewCandidate) => void;
  onAcceptSharedCandidate?: (candidateId: string, candidate: ReviewCandidate) => void;
  candidateUiContext?: 'grid' | 'shared';
}

export function CellDrawer({
  title,
  subtitle,
  onClose,
  currentValue,
  sharedAcceptedCandidateId,
  badges,
  isCurrentAccepted,
  onAcceptCurrent,
  onManualOverride,
  manualOverrideLabel,
  manualOverridePlaceholder,
  isPending,
  candidates,
  candidatesLoading,
  onAcceptCandidate,
  onConfirmCandidate,
  onRunAIReview,
  aiReviewPending,
  extraActions,
  extraSections,
  pendingAIConfirmation,
  pendingAIPrimary,
  pendingAIShared,
  pendingPrimaryCandidateId,
  pendingSharedCandidateId,
  pendingPrimaryCandidateIds,
  pendingSharedCandidateIds,
  onConfirmPrimary,
  onConfirmShared,
  onConfirmPrimaryCandidate,
  onConfirmSharedCandidate,
  onAcceptPrimary,
  onAcceptShared,
  onAcceptPrimaryCandidate,
  onAcceptSharedCandidate,
  candidateUiContext = 'grid',
}: CellDrawerProps) {
  const pendingPrimaryIdSet = new Set(
    (Array.isArray(pendingPrimaryCandidateIds) && pendingPrimaryCandidateIds.length > 0
      ? pendingPrimaryCandidateIds
      : (pendingPrimaryCandidateId ? [pendingPrimaryCandidateId] : [])
    )
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  );
  const pendingSharedIdSet = new Set(
    (Array.isArray(pendingSharedCandidateIds) && pendingSharedCandidateIds.length > 0
      ? pendingSharedCandidateIds
      : (pendingSharedCandidateId ? [pendingSharedCandidateId] : [])
    )
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  );
  const isGridContext = candidateUiContext === 'grid';

  // Merge legacy single-lane into two-lane flags, favoring candidate-id sets when provided.
  const hasPrimary = pendingPrimaryIdSet.size > 0 ? true : Boolean(pendingAIPrimary);
  const hasShared = pendingSharedIdSet.size > 0
    ? true
    : (isGridContext
        ? Boolean(pendingAIShared)
        : Boolean(pendingAIShared ?? pendingAIConfirmation));
  const hasAnyPending = hasPrimary || hasShared;
  const hasCandidateRows = candidates.length > 0;
  const showPrimaryFallbackAction = !currentValue.overridden
    && !candidatesLoading
    && !hasCandidateRows
    && hasPrimary
    && Boolean(onConfirmPrimary);
  const showSharedFallbackAction = !currentValue.overridden
    && !candidatesLoading
    && !hasCandidateRows
    && hasShared
    && Boolean(onConfirmShared);
  const confirmSharedButtonClass = 'bg-purple-600 hover:bg-purple-700';
  const confirmPrimaryBannerClass = candidateUiContext === 'grid'
    ? 'text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20'
    : 'text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20';
  const confirmSharedBannerClass = 'text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20';
  const confirmPrimaryBadgeClass = candidateUiContext === 'grid'
    ? 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300'
    : 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300';
  const confirmSharedBadgeClass = 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300';
  const acceptButtonClass = candidateUiContext === 'grid'
    ? 'bg-accent hover:bg-blue-600'
    : 'bg-violet-600 hover:bg-violet-700';
  const acceptCandidateTitle = candidateUiContext === 'grid'
    ? 'Accept this candidate as the grid item value.'
    : 'Accept this candidate as the shared value (component/list/enum).';
  const acceptCurrentTitle = candidateUiContext === 'grid'
    ? 'Accept the current selected grid item value.'
    : 'Accept the current shared value.';
  const confirmPrimaryTitle = 'AI Confirm item-level review without changing the selected value.';
  const confirmSharedTitle = 'AI Confirm shared review (component/list/enum) without changing the selected value.';
  // Normalize current value for matching
  const selectedValueToken = normalizeComparable(currentValue.value);

  // The "active accepted" candidate: only ONE candidate has the "Accepted" badge.
  // Only set when NOT overridden (manual override deselects all).
  const acceptedCandidateId = (() => {
    if (currentValue.overridden) return null;  // manual override = no active accepted
    return currentValue.acceptedCandidateId || null;
  })();
  const acceptedCandidateIdToken = String(acceptedCandidateId || '').trim();
  const sharedAcceptedCandidateIdToken = String(sharedAcceptedCandidateId || '').trim();
  const hasAcceptedIdInCandidates = Boolean(acceptedCandidateIdToken)
    && candidates.some((c) => String(c?.candidate_id || '').trim() === acceptedCandidateIdToken);
  const hasPrimaryTargetInCandidates = pendingPrimaryIdSet.size > 0
    && candidates.some((c) => pendingPrimaryIdSet.has(String(c?.candidate_id || '').trim()));
  const hasSharedTargetInCandidates = pendingSharedIdSet.size > 0
    && candidates.some((c) => pendingSharedIdSet.has(String(c?.candidate_id || '').trim()));
  const matchingValueIndices = selectedValueToken
    ? candidates
      .map((c, idx) => ({ idx, token: normalizeComparable(c?.value) }))
      .filter((entry) => entry.token && entry.token === selectedValueToken)
      .map((entry) => entry.idx)
    : [];
  const fallbackAcceptedIndex = (!acceptedCandidateIdToken && matchingValueIndices.length === 1)
    ? matchingValueIndices[0]
    : -1;

  return (
    <DrawerShell title={title} subtitle={subtitle} onClose={onClose}>
      {/* Section 1: Current Value */}
      <DrawerSection title="Current Value">
        <DrawerValueRow
          color={currentValue.color}
          value={currentValue.value}
          confidence={currentValue.confidence}
          source={currentValue.source}
          sourceTimestamp={currentValue.sourceTimestamp}
        />
        <DrawerBadges badges={badges} />
        {currentValue.overridden && (
          <div className="mt-1 px-2 py-1 text-[11px] text-center text-blue-600 dark:text-blue-400 font-medium border border-blue-200 dark:border-blue-800 rounded bg-blue-50 dark:bg-blue-900/20">
            Overridden (manual)
          </div>
        )}
        {!currentValue.overridden && isCurrentAccepted && !hasAnyPending && (
          <div className="mt-1 px-2 py-1 text-[11px] text-center text-green-600 dark:text-green-400 font-medium border border-green-200 dark:border-green-800 rounded bg-green-50 dark:bg-green-900/20">
            Accepted
          </div>
        )}
        {/* Two-lane AI status banners */}
        {!currentValue.overridden && hasPrimary && (
          <div className={`mt-1 px-2 py-1 text-[11px] font-medium border rounded ${confirmPrimaryBannerClass}`}>
            Item AI Review: Pending (candidate-scoped)
          </div>
        )}
        {!currentValue.overridden && hasShared && (
          <div className={`mt-1 px-2 py-1 text-[11px] font-medium border rounded ${confirmSharedBannerClass}`}>
            Shared AI Review: Pending (candidate-scoped)
          </div>
        )}
        {showPrimaryFallbackAction && (
          <button
            onClick={onConfirmPrimary}
            disabled={isPending}
            title={confirmPrimaryTitle}
            className="mt-1 w-full px-2 py-1.5 text-[11px] bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
          >
            {candidateUiContext === 'grid' ? 'Confirm Item' : 'Confirm'}
          </button>
        )}
        {showSharedFallbackAction && (
          <button
            onClick={onConfirmShared}
            disabled={isPending}
            title={confirmSharedTitle}
            className={`mt-1 w-full px-2 py-1.5 text-[11px] text-white rounded disabled:opacity-50 ${confirmSharedButtonClass}`}
          >
            Confirm Shared
          </button>
        )}
        {!isCurrentAccepted && !currentValue.overridden && onAcceptCurrent && (
          <button
            onClick={onAcceptCurrent}
            disabled={isPending}
            title={acceptCurrentTitle}
            className="mt-1 w-full px-2 py-1.5 text-[11px] bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            Accept
          </button>
        )}
      </DrawerSection>

      {/* Section 2: Manual Override */}
      <DrawerManualOverride
        onApply={onManualOverride}
        isPending={isPending}
        label={manualOverrideLabel}
        placeholder={manualOverridePlaceholder}
      />

      {/* Section 3: Candidates */}
      {(candidates.length > 0 || candidatesLoading || onRunAIReview) && (
        <DrawerSection title={`Candidates (${candidatesLoading ? '...' : candidates.length})`}>
          {onRunAIReview && (
            <button
              onClick={onRunAIReview}
              disabled={aiReviewPending}
              className="w-full mb-2 px-2 py-1.5 text-[11px] font-medium rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {aiReviewPending ? 'Running AI Review...' : 'Run AI Review'}
            </button>
          )}
          {candidatesLoading ? (
            <div className="flex justify-center py-4">
              <Spinner className="h-5 w-5" />
            </div>
          ) : (
            <div className="space-y-2">
              {candidates.length === 0 && (
                <div className="text-[11px] text-gray-500 dark:text-gray-400 px-1 py-2">
                  No candidates available for this value yet.
                </div>
              )}
              {candidates.map((candidate, index) => {
                const candidateId = String(candidate.candidate_id || '').trim();
                const candidateValueToken = normalizeComparable(candidate.value);
                const isValueMatch = Boolean(selectedValueToken) && Boolean(candidateValueToken) && candidateValueToken === selectedValueToken;
                const isActiveAccepted = (
                  Boolean(acceptedCandidateIdToken)
                  && candidateId === acceptedCandidateIdToken
                ) || (!hasAcceptedIdInCandidates && fallbackAcceptedIndex === index);
                const isSharedAccepted = Boolean(sharedAcceptedCandidateIdToken)
                  && candidateId === sharedAcceptedCandidateIdToken;
                const isPrimaryTarget = hasPrimary
                  && (pendingPrimaryIdSet.size > 0 ? pendingPrimaryIdSet.has(candidateId) : false);
                const isSharedTarget = hasShared
                  && (pendingSharedIdSet.size > 0 ? pendingSharedIdSet.has(candidateId) : false);
                const showSharedBadge = isSharedTarget && !(candidateUiContext === 'grid' && isPrimaryTarget);
                const showPrimaryAction = hasPrimary && (
                  pendingPrimaryIdSet.size === 0
                  || isPrimaryTarget
                  || !hasPrimaryTargetInCandidates
                );
                const showSharedAction = !isGridContext && hasShared && (
                  pendingSharedIdSet.size === 0
                  || isSharedTarget
                  || !hasSharedTargetInCandidates
                );
                const showPrimaryAcceptAction = isGridContext
                  ? Boolean(onAcceptPrimaryCandidate || onAcceptPrimary || onAcceptCandidate)
                  : Boolean(onAcceptCandidate);
                const showSharedAcceptAction = false;
                const acceptThisCandidateDisabled = isPending;
                const acceptThisCandidateTitle = acceptCandidateTitle;

                const handleAcceptPrimary = () => {
                  if (onAcceptPrimaryCandidate) {
                    onAcceptPrimaryCandidate(candidate.candidate_id, candidate);
                    return;
                  }
                  if (onAcceptCandidate) {
                    onAcceptCandidate(candidate.candidate_id, candidate);
                    return;
                  }
                  if (onAcceptPrimary) {
                    onAcceptPrimary();
                  }
                };

                const handleAcceptShared = () => {
                  if (onAcceptSharedCandidate) {
                    onAcceptSharedCandidate(candidate.candidate_id, candidate);
                    return;
                  }
                  if (onAcceptShared) {
                    onAcceptShared();
                  }
                };

                const handleConfirmPrimary = () => {
                  if (onConfirmPrimaryCandidate) {
                    onConfirmPrimaryCandidate(candidate.candidate_id, candidate);
                    return;
                  }
                  if (onConfirmPrimary) {
                    onConfirmPrimary();
                    return;
                  }
                  if (onConfirmCandidate) {
                    onConfirmCandidate(candidate.candidate_id, candidate);
                  }
                };

                const handleConfirmShared = () => {
                  if (onConfirmSharedCandidate) {
                    onConfirmSharedCandidate(candidate.candidate_id, candidate);
                    return;
                  }
                  if (onConfirmShared) {
                    onConfirmShared();
                    return;
                  }
                  if (onConfirmCandidate) {
                    onConfirmCandidate(candidate.candidate_id, candidate);
                  }
                };

                // Candidate background rule:
                // 1) Green when candidate matches accepted/selected value (and for active accepted fallback).
                // 2) Otherwise pending-lane hue (item/shared) when this candidate is lane-targeted.
                // 3) Otherwise neutral (no tint).
                const isAcceptedValueCandidate = isValueMatch || (isActiveAccepted && !selectedValueToken);
                const pendingTintClass = (() => {
                  if (isGridContext && hasPrimary) {
                    return 'border-orange-300 dark:border-orange-700 bg-orange-50/50 dark:bg-orange-900/10';
                  }
                  if (hasShared) {
                    return 'border-purple-300 dark:border-purple-700 bg-purple-50/50 dark:bg-purple-900/10';
                  }
                  return undefined;
                })();
                const cardClass = isAcceptedValueCandidate
                  ? (isActiveAccepted
                      ? 'border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/20'
                      : 'border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/10')
                  : pendingTintClass;

                const valueClass = isAcceptedValueCandidate
                  ? (isActiveAccepted ? 'text-green-700 dark:text-green-300 font-bold' : 'text-green-600 dark:text-green-400')
                  : (isGridContext && hasPrimary)
                    ? 'text-orange-700 dark:text-orange-300'
                    : (hasShared)
                      ? 'text-purple-700 dark:text-purple-300'
                      : '';

                return (
                  <DrawerCard key={candidateId ? `${candidateId}::${index}` : `candidate::${index}`} className={cardClass}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] bg-gray-200 dark:bg-gray-700 rounded px-1.5 py-0.5 font-mono">
                        {index + 1}
                      </span>
                      <span className={`font-mono text-sm flex-1 truncate ${valueClass}`} title={String(candidate.value)}>
                        {String(candidate.value)}
                      </span>
                      <span className="text-xs text-gray-400">{pct(candidate.score)}</span>
                      {isActiveAccepted && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-100 dark:bg-green-800 text-green-700 dark:text-green-200">
                          Accepted
                        </span>
                      )}
                      {!isGridContext && isSharedAccepted && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300">
                          Accepted Shared
                        </span>
                      )}
                      {isPrimaryTarget && (
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${confirmPrimaryBadgeClass}`}>
                          AI Item
                        </span>
                      )}
                      {showSharedBadge && (
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${confirmSharedBadgeClass}`}>
                          AI Shared Pending
                        </span>
                      )}
                    </div>

                    <SourceBadge candidate={candidate} />
                    {(candidate.llm_extract_model || candidate.llm_validate_model) && (
                      <div className="flex gap-1 items-center flex-wrap mt-0.5">
                        {candidate.llm_extract_model && (
                          <span className="px-1 py-0 text-[8px] rounded bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300">
                            src: {candidate.llm_extract_model}
                          </span>
                        )}
                        {candidate.llm_validate_model && (
                          <span className="px-1 py-0 text-[8px] rounded bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300">
                            rev: {candidate.llm_validate_model}
                          </span>
                        )}
                      </div>
                    )}
                    <EvidenceSnippet candidate={candidate} />

                    {(() => {
                      const actionCount =
                        (showPrimaryAcceptAction ? 1 : 0)
                        + (showSharedAcceptAction ? 1 : 0)
                        + (showPrimaryAction ? 1 : 0)
                        + (showSharedAction ? 1 : 0);
                      if (actionCount === 0) return null;
                      const widthClass = actionCount === 1
                        ? 'w-full'
                        : actionCount === 2
                          ? 'w-1/2'
                          : actionCount === 3
                            ? 'w-1/3'
                            : 'w-1/4';

                      return (
                        <div className="flex gap-1.5 mt-1">
                          {showPrimaryAcceptAction && (
                            <button
                              onClick={handleAcceptPrimary}
                              disabled={acceptThisCandidateDisabled}
                              title={acceptThisCandidateTitle}
                              aria-pressed={isActiveAccepted}
                              className={`${widthClass} px-2 py-1 text-[11px] text-white rounded disabled:opacity-50 ${isActiveAccepted ? 'bg-green-700 hover:bg-green-700 ring-2 ring-green-300/70 shadow-inner translate-y-px' : acceptButtonClass}`}
                            >
                              {candidateUiContext === 'grid' ? 'Accept Item' : 'Accept'}
                            </button>
                          )}
                          {showSharedAcceptAction && (
                            <button
                              onClick={handleAcceptShared}
                              disabled={acceptThisCandidateDisabled}
                              title="Accept this candidate as the shared value."
                              className={`${widthClass} px-2 py-1 text-[11px] text-white rounded disabled:opacity-50 ${isSharedAccepted ? 'bg-violet-800 hover:bg-violet-800 ring-2 ring-violet-300/70 shadow-inner translate-y-px' : 'bg-violet-600 hover:bg-violet-700'}`}
                            >
                              Accept Shared
                            </button>
                          )}
                          {showPrimaryAction && (
                            <button
                              onClick={handleConfirmPrimary}
                              disabled={isPending}
                              title={confirmPrimaryTitle}
                              className={`${widthClass} px-2 py-1 text-[11px] bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50`}
                            >
                              {candidateUiContext === 'grid' ? 'Confirm Item' : 'Confirm'}
                            </button>
                          )}
                          {showSharedAction && (
                            <button
                              onClick={handleConfirmShared}
                              disabled={isPending}
                              title={confirmSharedTitle}
                              className={`${widthClass} px-2 py-1 text-[11px] text-white rounded disabled:opacity-50 ${confirmSharedButtonClass}`}
                            >
                              Confirm
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </DrawerCard>
                );
              })}
            </div>
          )}
        </DrawerSection>
      )}

      {/* Section 4: Extra actions slot */}
      {extraActions && (
        <DrawerActionStack>{extraActions}</DrawerActionStack>
      )}

      {/* Section 5: Extra sections slot */}
      {extraSections}
    </DrawerShell>
  );
}
