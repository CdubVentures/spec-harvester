import type { ReactNode } from 'react';
import { trafficColor, trafficTextColor } from '../../utils/colors';
import { pct } from '../../utils/formatting';
import { hasKnownValue } from '../../utils/fieldNormalize';
import { CellTooltip, type CellTooltipState } from '../../pages/review/CellTooltip';
import { FlagIcon } from './FlagIcon';

export interface ReviewValueCellState extends CellTooltipState {
  selected: CellTooltipState['selected'] & {
    value: unknown;
  };
  overridden?: boolean;
}

interface ReviewValueCellProps {
  state?: ReviewValueCellState | null;
  hasRun?: boolean;
  selected?: boolean;
  className?: string;
  valueClassName?: string;
  unknownLabel?: string;
  showConfidence?: boolean;
  showOverrideBadge?: boolean;
  flagCount?: number;
  valueMaxChars?: number;
  emptyWhenNoRun?: ReactNode;
  emptyWhenMissing?: ReactNode;
  pendingAI?: boolean;
  pendingAIPrimary?: boolean;
  pendingAIShared?: boolean;
}

function joinClassNames(parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function ReviewValueCell({
  state,
  hasRun = true,
  selected = false,
  className,
  valueClassName,
  unknownLabel = 'unk',
  showConfidence = false,
  showOverrideBadge = false,
  flagCount = 0,
  valueMaxChars = 40,
  emptyWhenNoRun = null,
  emptyWhenMissing = null,
  pendingAI = false,
  pendingAIPrimary = false,
  pendingAIShared = false,
}: ReviewValueCellProps) {
  // Two-lane pending flags; legacy pendingAI maps to shared for backward compat
  const hasPrimary = pendingAIPrimary;
  const hasShared = pendingAIShared || (pendingAI && !pendingAIPrimary && !pendingAIShared);
  const hasAnyPending = hasPrimary || hasShared;
  if (hasRun === false) {
    return <>{emptyWhenNoRun}</>;
  }
  if (!state || !state.selected) {
    return <>{emptyWhenMissing}</>;
  }

  const color = state.selected.color;
  const known = hasKnownValue(state.selected.value);
  const rawText = known ? String(state.selected.value) : unknownLabel;
  const displayText = known && valueMaxChars > 0
    ? rawText.slice(0, valueMaxChars)
    : rawText;

  return (
    <div
      className={joinClassNames([
        'flex items-center gap-1.5 min-w-0',
        selected && 'ring-2 ring-accent ring-inset rounded px-0.5',
        className,
      ])}
    >
      {/* Tooltip trigger wraps the dot + confidence for a bigger hover target */}
      <CellTooltip state={state}>
        <span className="inline-flex items-center gap-1 cursor-help rounded-full px-0.5 py-0.5 -my-0.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors flex-shrink-0">
          <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${hasShared ? 'bg-purple-500' : hasPrimary ? 'bg-orange-500' : trafficColor(color)}`} />
          {showConfidence && known && (
            <span className="text-[9px] text-gray-400 flex-shrink-0 tabular-nums">
              {pct(state.selected.confidence)}
            </span>
          )}
        </span>
      </CellTooltip>
      {showConfidence && known && (
        <span className="text-gray-300 dark:text-gray-600 flex-shrink-0 text-[8px] leading-none">·</span>
      )}
      <span
        className={joinClassNames([
          'truncate text-[11px]',
          hasShared ? 'text-purple-700 dark:text-purple-300' : hasPrimary ? 'text-orange-700 dark:text-orange-300' : known ? trafficTextColor(color) : 'text-gray-400',
          valueClassName,
        ])}
        title={rawText}
      >
        {displayText}
      </span>
      {showOverrideBadge && Boolean(state.overridden) && (
        <span className="text-[9px] text-orange-500 font-bold flex-shrink-0" title="Overridden">
          OVR
        </span>
      )}
      {hasPrimary && (
        <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 shrink-0" title="Item AI review pending">AI</span>
      )}
      {hasShared && (
        <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 shrink-0" title="Shared AI review pending">AI</span>
      )}
      {flagCount > 0 && (
        <span className="inline-flex items-center gap-0.5 text-[9px] text-amber-600 dark:text-amber-400 flex-shrink-0" title={`${flagCount} flag${flagCount > 1 ? 's' : ''}`}>
          <FlagIcon className="w-2.5 h-2.5" />
          <span>{flagCount}</span>
        </span>
      )}
    </div>
  );
}
