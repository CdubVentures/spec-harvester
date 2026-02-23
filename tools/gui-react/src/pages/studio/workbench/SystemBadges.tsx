// ── SystemBadges: clickable consumer toggle badges per field ─────────
import {
  type DownstreamSystem,
  SYSTEM_BADGE_CONFIGS,
  getFieldSystems,
  isConsumerEnabled,
} from './systemMapping';

interface Props {
  fieldPath: string;
  rule: Record<string, unknown>;
  onToggle: (fieldPath: string, system: DownstreamSystem, enabled: boolean) => void;
}

const enabledInline: Record<DownstreamSystem, React.CSSProperties> = {
  indexlab: { background: '#cffafe', color: '#0e7490', border: '1px solid #a5f3fc' },
  seed:    { background: '#ecfccb', color: '#4d7c0f', border: '1px solid #d9f99d' },
  review:  { background: '#ffe4e6', color: '#be123c', border: '1px solid #fecdd3' },
};

const disabledInline: React.CSSProperties = {
  background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb',
  textDecoration: 'line-through',
};

export function SystemBadges({ fieldPath, rule, onToggle }: Props) {
  const systems = getFieldSystems(fieldPath);
  if (systems.length === 0) return null;

  return (
    <span className="inline-flex gap-0.5 ml-auto shrink-0">
      {systems.map((sys) => {
        const cfg = SYSTEM_BADGE_CONFIGS[sys];
        const enabled = isConsumerEnabled(rule, fieldPath, sys);
        return (
          <button
            key={sys}
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(fieldPath, sys, !enabled); }}
            style={{
              fontSize: '9px',
              lineHeight: '14px',
              padding: '0 4px',
              borderRadius: '3px',
              fontWeight: 600,
              cursor: 'pointer',
              userSelect: 'none',
              ...(enabled ? enabledInline[sys] : disabledInline),
            }}
            className={`${enabled ? cfg.cls : cfg.clsDim}`}
            title={`${cfg.title} — ${enabled ? 'enabled (click to disable)' : 'disabled (click to enable)'}`}
          >
            {cfg.label}
          </button>
        );
      })}
    </span>
  );
}
