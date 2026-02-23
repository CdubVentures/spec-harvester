import { Tip } from '../../components/common/Tip';
import type { PanelStateToken, TimedIndexLabEvent } from './types';

export function normalizeToken(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function getRefetchInterval(
  isRunning: boolean,
  isCollapsed: boolean,
  activeMs = 2000,
  idleMs = 10000
): number | false {
  if (isCollapsed) return false;
  return isRunning ? activeMs : idleMs;
}

export function truthyFlag(value: unknown) {
  if (typeof value === 'boolean') return value;
  const token = normalizeToken(value);
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

export function cleanVariant(value: string) {
  const text = String(value || '').trim();
  return text || '';
}

export function displayVariant(value: string) {
  const cleaned = cleanVariant(value);
  return cleaned || '(base / no variant)';
}

export function ambiguityLevelFromFamilyCount(count: number) {
  const safe = Math.max(0, Number.parseInt(String(count || 0), 10) || 0);
  if (safe >= 9) return 'extra_hard';
  if (safe >= 6) return 'very_hard';
  if (safe >= 4) return 'hard';
  if (safe >= 2) return 'medium';
  if (safe === 1) return 'easy';
  return 'unknown';
}

export function formatNumber(value: number, digits = 0) {
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  const digits = size >= 100 || idx === 0 ? 0 : 1;
  return `${formatNumber(size, digits)} ${units[idx]}`;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return String(value);
  return new Date(ms).toLocaleString();
}

export function providerFromModelToken(value: string) {
  const token = normalizeToken(value);
  if (!token) return 'openai';
  if (token.startsWith('gemini')) return 'gemini';
  if (token.startsWith('deepseek')) return 'deepseek';
  return 'openai';
}

export function stripThinkTags(raw: string) {
  return String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

export function extractJsonCandidate(raw: string) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    return text.slice(firstBracket, lastBracket + 1).trim();
  }
  return '';
}

export function extractBalancedJsonSegments(raw: string) {
  const text = String(raw || '').trim();
  if (!text) return [];
  const segments: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    const open = text[start];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaping = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaping) {
          escaping = false;
        } else if (ch === '\\') {
          escaping = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === open) {
        depth += 1;
        continue;
      }
      if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          segments.push(text.slice(start, i + 1).trim());
          break;
        }
      }
    }
  }
  return segments;
}

export function tryJsonParseCandidate(candidate: string): unknown | null {
  const token = String(candidate || '').trim();
  if (!token) return null;
  const variants = [token];
  const withoutTrailingCommas = token.replace(/,\s*([}\]])/g, '$1').trim();
  if (withoutTrailingCommas && withoutTrailingCommas !== token) {
    variants.push(withoutTrailingCommas);
  }
  for (const variant of variants) {
    try {
      return JSON.parse(variant);
    } catch {
      // continue
    }
  }
  return null;
}

export function parseJsonLikeText(value: string): unknown | null {
  const text = String(value || '').trim();
  if (!text) return null;

  const candidates: string[] = [];
  const push = (candidate: string) => {
    const token = String(candidate || '').trim();
    if (!token) return;
    if (!candidates.includes(token)) candidates.push(token);
  };

  const stripped = stripThinkTags(text);
  push(text);
  push(stripped);
  push(extractJsonCandidate(text));
  push(extractJsonCandidate(stripped));

  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null = null;
  while ((fenceMatch = fenceRegex.exec(stripped)) !== null) {
    push(String(fenceMatch[1] || '').trim());
  }

  for (const segment of extractBalancedJsonSegments(stripped)) {
    push(segment);
  }
  for (const segment of extractBalancedJsonSegments(text)) {
    push(segment);
  }

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const parsed = tryJsonParseCandidate(candidates[i]);
    if (parsed === null) continue;
    if (typeof parsed === 'string') {
      const nested = tryJsonParseCandidate(parsed);
      if (nested !== null) return nested;
    }
    return parsed;
  }

  return null;
}

export function prettyJsonText(value: string) {
  const text = String(value || '').trim();
  if (!text) return '';
  const parsed = parseJsonLikeText(text);
  if (parsed !== null) {
    try {
      return JSON.stringify(parsed, null, 2);
    } catch {
      // fall through
    }
  }
  return stripThinkTags(text) || text;
}

export function isJsonText(value: string) {
  return parseJsonLikeText(String(value || '')) !== null;
}

export function hostFromUrl(value: string) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    return new URL(text).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function looksLikeGraphqlUrl(value: string) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  return text.includes('/graphql') || text.includes('graphql?') || text.includes('operationname=');
}

export function looksLikeJsonUrl(value: string) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  return /\.json($|[?#])/i.test(text) || /[?&]format=json/i.test(text) || text.includes('/json');
}

export function looksLikePdfUrl(value: string) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  return /\.pdf($|[?#])/i.test(text);
}

export function llmPhaseLabel(phase: string) {
  const token = normalizeToken(phase);
  if (token === 'phase_02') return 'Phase 02';
  if (token === 'phase_03') return 'Phase 03';
  if (token === 'extract') return 'Extract';
  if (token === 'validate') return 'Validate';
  if (token === 'write') return 'Write';
  if (token === 'plan') return 'Plan';
  return 'Other';
}

export function classifyLlmPhase(purpose: string, routeRole: string) {
  const reason = normalizeToken(purpose);
  const role = normalizeToken(routeRole);
  if (role === 'extract') return 'extract';
  if (role === 'validate') return 'validate';
  if (role === 'write') return 'write';
  if (role === 'plan') return 'plan';
  if (reason.includes('discovery_planner') || reason.includes('search_profile') || reason.includes('searchprofile')) {
    return 'phase_02';
  }
  if (reason.includes('serp') || reason.includes('triage') || reason.includes('rerank') || reason.includes('discovery_query_plan')) {
    return 'phase_03';
  }
  if (reason.includes('extract')) return 'extract';
  if (reason.includes('validate') || reason.includes('verify')) return 'validate';
  if (reason.includes('write') || reason.includes('summary')) return 'write';
  if (reason.includes('planner') || reason.includes('plan')) return 'plan';
  return 'other';
}

export function llmPhaseBadgeClasses(phase: string) {
  const token = normalizeToken(phase);
  if (token === 'phase_02') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
  if (token === 'phase_03') return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300';
  if (token === 'extract') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
  if (token === 'validate') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  if (token === 'write') return 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300';
  if (token === 'plan') return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
}

export function panelStateChipClasses(state: PanelStateToken) {
  if (state === 'live') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
  if (state === 'ready') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
  return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
}

export function hostBudgetStateBadgeClasses(state: string) {
  const token = normalizeToken(state);
  if (token === 'blocked') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
  if (token === 'backoff') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  if (token === 'degraded') return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300';
  if (token === 'active') return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300';
  if (token === 'open') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
}

export function roleHelpText(role: string) {
  const token = normalizeToken(role);
  if (token === 'plan') return 'Builds search/discovery strategy and query plans before heavy fetch work.';
  if (token === 'extract') return 'Extracts candidate values from evidence snippets and structured artifacts.';
  if (token === 'validate') return 'Verifies extracted candidates against evidence and consistency gates.';
  if (token === 'write') return 'Builds summary/write outputs after extraction and validation.';
  return '';
}

export function formatDuration(ms: number) {
  const safeMs = Math.max(0, Number.isFinite(ms) ? ms : 0);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function percentileMs(values: number[], percentile = 95) {
  const clean = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (clean.length === 0) return 0;
  const rank = Math.max(0, Math.min(clean.length - 1, Math.ceil((percentile / 100) * clean.length) - 1));
  return clean[rank] || 0;
}

export function formatLatencyMs(value: number) {
  const safe = Math.max(0, Number(value) || 0);
  if (safe >= 1000) {
    return `${formatNumber(safe / 1000, 2)} s`;
  }
  return `${formatNumber(safe, 0)} ms`;
}

export function needsetRequiredLevelWeight(level: string) {
  const token = normalizeToken(level);
  if (token === 'identity') return 5;
  if (token === 'critical') return 4;
  if (token === 'required') return 3;
  if (token === 'expected') return 2;
  return 1;
}

export function needsetRequiredLevelBadge(level: string) {
  const token = normalizeToken(level);
  if (token === 'identity') return { short: 'I', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' };
  if (token === 'critical') return { short: 'C', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' };
  if (token === 'required') return { short: 'R', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' };
  return { short: 'O', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200' };
}

export function needsetReasonBadge(reason: string) {
  const token = normalizeToken(reason);
  if (token === 'missing') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
  if (token === 'tier_deficit' || token === 'tier_pref_unmet') return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300';
  if (token === 'min_refs_fail') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  if (token === 'conflict') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
  if (token === 'low_conf') return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300';
  if (token === 'identity_unlocked') return 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300';
  if (token === 'blocked_by_identity') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300';
  if (token === 'publish_gate_block') return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300';
  return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
}

export function NeedsetSparkline({ values }: { values: number[] }) {
  const points = values.filter((v) => Number.isFinite(v));
  if (points.length === 0) {
    return <div className="text-xs text-gray-500 dark:text-gray-400">no snapshots yet</div>;
  }
  if (points.length === 1) {
    return <div className="text-xs text-gray-500 dark:text-gray-400">size {formatNumber(points[0] || 0)}</div>;
  }
  const width = 180;
  const height = 36;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(1, max - min);
  const coords = points
    .map((value, idx) => {
      const x = (idx / Math.max(1, points.length - 1)) * width;
      const y = height - (((value - min) / range) * height);
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-9 w-44">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-blue-600 dark:text-blue-300"
        points={coords}
      />
    </svg>
  );
}

export function computeActivityStats(
  events: TimedIndexLabEvent[],
  nowMs: number,
  predicate: (event: TimedIndexLabEvent) => boolean
) {
  const oneMinuteMs = 60_000;
  const currentWindowMinutes = 2;
  const horizonMinutes = 10;
  let currentEvents = 0;
  const bucketCounts = new Array(horizonMinutes).fill(0);
  for (const event of events) {
    if (!predicate(event)) continue;
    const ageMs = nowMs - event.tsMs;
    if (ageMs < 0 || ageMs > horizonMinutes * oneMinuteMs) continue;
    if (ageMs <= currentWindowMinutes * oneMinuteMs) currentEvents += 1;
    const bucketIdx = Math.floor(ageMs / oneMinuteMs);
    if (bucketIdx >= 0 && bucketIdx < horizonMinutes) {
      bucketCounts[bucketIdx] += 1;
    }
  }
  const peak = Math.max(1, ...bucketCounts);
  return {
    currentPerMin: currentEvents / currentWindowMinutes,
    peakPerMin: peak
  };
}

export function ActivityGauge({
  label,
  currentPerMin,
  peakPerMin,
  active,
  tooltip
}: {
  label: string;
  currentPerMin: number;
  peakPerMin: number;
  active: boolean;
  tooltip?: string;
}) {
  const pct = Math.max(0, Math.min(100, (currentPerMin / Math.max(1, peakPerMin)) * 100));
  const displayPct = active && pct <= 0 ? 2 : pct;
  return (
    <div className="min-w-[12rem] rounded border border-gray-200 dark:border-gray-700 px-2 py-1">
      <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center">
          {label}
          {tooltip ? <Tip text={tooltip} /> : null}
        </span>
        <span className={active ? 'text-emerald-600 dark:text-emerald-300' : ''}>
          {formatNumber(currentPerMin, 1)}/min
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div
          className={`h-full rounded ${active ? 'bg-emerald-500' : 'bg-gray-400'}`}
          style={{ width: `${displayPct}%` }}
        />
      </div>
    </div>
  );
}
