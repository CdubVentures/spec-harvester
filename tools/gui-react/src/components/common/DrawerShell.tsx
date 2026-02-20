import { useState, type ReactNode } from 'react';
import { trafficColor, trafficTextColor, sourceBadgeClass, SOURCE_BADGE_FALLBACK } from '../../utils/colors';
import { pct } from '../../utils/formatting';

interface DrawerShellProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}

interface Badge {
  label: string;
  className: string;
}

interface DrawerSectionProps {
  title?: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function DrawerShell({ title, subtitle, onClose, width, children }: DrawerShellProps) {
  return (
    <div
      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-y-auto max-h-[calc(100vh-280px)] min-w-0"
      style={width ? { width } : undefined}
    >
      <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-2 flex justify-between items-center z-10">
        <div>
          <h3 className="font-semibold text-sm">{title}</h3>
          {subtitle && <p className="text-[10px] text-gray-400">{subtitle}</p>}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
      </div>
      <div className="p-4 space-y-4">
        {children}
      </div>
    </div>
  );
}

export function DrawerSection({ title, meta, children, className, bodyClassName }: DrawerSectionProps) {
  return (
    <section className={className}>
      {(title || meta) && (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title ? <p className="text-xs font-medium text-gray-500">{title}</p> : <span />}
          {meta}
        </div>
      )}
      <div className={bodyClassName || 'space-y-2'}>{children}</div>
    </section>
  );
}

export function DrawerCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`border border-gray-200 dark:border-gray-700 rounded p-2 space-y-1.5 ${className || ''}`}>
      {children}
    </div>
  );
}

export function DrawerActionStack({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2 ${className || ''}`}>
      {children}
    </div>
  );
}

const valueSourceBadge = sourceBadgeClass;

interface DrawerValueRowProps {
  color: string;
  value: string;
  confidence: number;
  source?: string;
  sourceTimestamp?: string | null;
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso.slice(0, 16);
  }
}

export function DrawerValueRow({ color, value, confidence, source, sourceTimestamp }: DrawerValueRowProps) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        <span className={`inline-block w-3 h-3 rounded-full ${trafficColor(color)}`} />
        <span className={`font-mono text-sm font-semibold ${trafficTextColor(color)}`}>
          {value}
        </span>
        {source && (
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${valueSourceBadge[source] || SOURCE_BADGE_FALLBACK}`}>
            {source}
          </span>
        )}
        <span className="text-xs text-gray-400 ml-auto">
          {pct(confidence)}
        </span>
      </div>
      {sourceTimestamp && (
        <div className="text-[9px] text-gray-400 pl-5">
          set {formatTimestamp(sourceTimestamp)}
        </div>
      )}
    </div>
  );
}

export function DrawerBadges({ badges }: { badges: Badge[] }) {
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((badge, index) => (
        <span key={`${badge.label}-${index}`} className={`px-2 py-0.5 rounded text-[10px] ${badge.className}`}>
          {badge.label}
        </span>
      ))}
    </div>
  );
}

const drawerSourceBadgeClass = sourceBadgeClass;

export function DrawerSourceRow({ source, url }: { source?: string; url?: string }) {
  if (!source && !url) return null;
  return (
    <div className="flex items-center gap-2 text-[10px]">
      {source && (
        <span className={`px-1.5 py-0.5 rounded font-medium ${drawerSourceBadgeClass[source] || SOURCE_BADGE_FALLBACK}`}>
          {source}
        </span>
      )}
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="text-accent hover:underline truncate">
          {url}
        </a>
      )}
    </div>
  );
}

interface DrawerManualOverrideProps {
  onApply: (value: string) => void;
  isPending: boolean;
  placeholder?: string;
  label?: string;
}

export function DrawerManualOverride({
  onApply,
  isPending,
  placeholder = 'Enter new value...',
  label = 'Manual Override',
}: DrawerManualOverrideProps) {
  const [value, setValue] = useState('');

  function apply() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onApply(trimmed);
    setValue('');
  }

  return (
    <DrawerActionStack>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
          placeholder={placeholder}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              apply();
            }
          }}
        />
        <button
          onClick={apply}
          disabled={!value.trim() || isPending}
          className="px-3 py-1 text-sm bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
        >
          Apply
        </button>
      </div>
    </DrawerActionStack>
  );
}