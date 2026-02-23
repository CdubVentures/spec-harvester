import * as Tooltip from '@radix-ui/react-tooltip';
import { pct } from '../../utils/formatting';
import { trafficColor, sourceBadgeDarkClass, SOURCE_BADGE_DARK_FALLBACK } from '../../utils/colors';

/**
 * Generic state interface that both FieldState (review grid) and
 * ComponentPropertyState (component review) satisfy structurally.
 */
export interface CellTooltipState {
  selected: {
    confidence: number;
    color: 'green' | 'yellow' | 'red' | 'gray' | 'purple';
  };
  needs_review: boolean;
  reason_codes: string[];
  source?: string;
  source_timestamp?: string | null;
  method?: string;
  tier?: number | null;
  evidence_url?: string;
  evidence_quote?: string;
  overridden?: boolean;
  candidate_count?: number;
  variance_policy?: string | null;
  candidates?: Array<{
    source?: string;
    method?: string | null;
    tier?: number | null;
    score?: number;
    evidence?: {
      url?: string;
      quote?: string;
    };
  }>;
}

interface CellTooltipProps {
  state: CellTooltipState;
  children: React.ReactNode;
}

function extractHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const sourceBadgeStyle = sourceBadgeDarkClass;

const tierBadgeStyle: Record<number, string> = {
  1: 'bg-green-700/60 text-green-200',
  2: 'bg-blue-700/60 text-blue-200',
  3: 'bg-gray-700/60 text-gray-300',
};

function humanizeMethod(method: string): string {
  return method
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CellTooltip({ state, children }: CellTooltipProps) {
  const conf = state.selected.confidence;
  const color = state.selected.color;
  const topCandidate = state.candidates?.[0];

  // Resolve source info — prefer direct fields, fall back to top candidate
  const directSource = state.source;
  const evidenceUrl = state.evidence_url || topCandidate?.evidence?.url || '';
  const hostSource = evidenceUrl ? extractHost(evidenceUrl) : '';
  const quote = state.evidence_quote || topCandidate?.evidence?.quote || '';
  const method = state.method || topCandidate?.method || '';
  const tier = state.tier ?? topCandidate?.tier ?? null;
  const candidateCount = state.candidate_count ?? state.candidates?.length ?? 0;

  return (
    <Tooltip.Root delayDuration={150}>
      <Tooltip.Trigger asChild>
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="z-50 max-w-[340px] min-w-[180px] px-3 py-2.5 text-[11px] leading-relaxed text-white bg-gray-900 dark:bg-gray-950 rounded-lg shadow-xl border border-gray-700/50"
          sideOffset={6}
          side="top"
        >
          {/* Row 1: Confidence + status badges */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${trafficColor(color)}`} />
            <span className="font-bold text-[12px]">{pct(conf)}</span>
            {tier != null && tier > 0 && (
              <span className={`px-1.5 py-0 rounded text-[9px] font-semibold ${tierBadgeStyle[tier] || 'bg-gray-700 text-gray-300'}`}>
                T{tier}
              </span>
            )}
            {/* Show source badge — but skip "override" when overridden is true to avoid duplicate */}
            {directSource && !(directSource === 'override' && state.overridden) && (
              <span className={`px-1.5 py-0 rounded text-[9px] font-medium ${sourceBadgeStyle[directSource] || SOURCE_BADGE_DARK_FALLBACK}`}>
                {directSource}
              </span>
            )}
            {Boolean(state.overridden) && (
              <span className="px-1.5 py-0 rounded text-[9px] font-semibold bg-orange-700/60 text-orange-200">
                overridden
              </span>
            )}
            {state.needs_review && (
              <span className="px-1.5 py-0 rounded text-[9px] font-medium bg-yellow-700/60 text-yellow-200">
                review
              </span>
            )}
          </div>

          {/* Row 2: Source host + method */}
          {(hostSource || method) && (
            <div className="flex items-center gap-2 text-gray-400 mb-1">
              {hostSource && (
                <span className="font-medium text-gray-300">{hostSource}</span>
              )}
              {hostSource && method && (
                <span className="text-gray-600">via</span>
              )}
              {method && (
                <span className="text-gray-400">{humanizeMethod(method)}</span>
              )}
            </div>
          )}

          {/* Row 2b: Source name when no host (e.g. "reference" or custom source) */}
          {!hostSource && directSource && !['reference', 'override', 'manual', 'unknown'].includes(directSource) && (
            <div className="text-gray-400 mb-1">
              Source: <span className="text-gray-300">{directSource}</span>
            </div>
          )}

          {/* Row 2c: Source timestamp */}
          {state.source_timestamp && (
            <div className="text-[9px] text-gray-500 mb-1">
              set {new Date(state.source_timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}

          {/* Row 3: Evidence URL */}
          {evidenceUrl && (
            <a
              href={evidenceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-blue-300 hover:text-blue-200 underline truncate block mb-1 text-[10px]"
              onClick={(e) => e.stopPropagation()}
            >
              {evidenceUrl.length > 70 ? evidenceUrl.slice(0, 70) + '...' : evidenceUrl}
            </a>
          )}

          {/* Row 4: Evidence quote */}
          {quote && (
            <div className="text-gray-300 line-clamp-3 italic text-[10px] mb-1 border-l-2 border-gray-700 pl-2">
              &ldquo;{quote.slice(0, 180)}{quote.length > 180 ? '...' : ''}&rdquo;
            </div>
          )}

          {/* Row 5: Meta row — candidate count, variance policy */}
          {(candidateCount > 0 || state.variance_policy) && (
            <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-1">
              {candidateCount > 0 && (
                <span>{candidateCount} candidate{candidateCount !== 1 ? 's' : ''}</span>
              )}
              {state.variance_policy && (
                <span className="px-1 py-0 rounded bg-gray-800 text-gray-400 text-[9px]">
                  {state.variance_policy}
                </span>
              )}
            </div>
          )}

          {/* Row 6: Reason codes */}
          {state.reason_codes.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {state.reason_codes.slice(0, 4).map((rc) => (
                <span key={rc} className="px-1.5 py-0.5 text-[9px] bg-gray-800 text-gray-400 rounded">
                  {rc.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}

          <Tooltip.Arrow className="fill-gray-900 dark:fill-gray-950" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
