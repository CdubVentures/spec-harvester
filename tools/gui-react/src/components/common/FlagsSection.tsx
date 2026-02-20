import { useState } from 'react';
import { FlagIcon } from './FlagIcon';
import { DrawerSection, DrawerCard } from './DrawerShell';
import { getFlagInfo } from '../../utils/flagDescriptions';
import { humanizeField } from '../../utils/fieldNormalize';

interface FlagsSectionProps {
  reasonCodes: string[];
}

export function FlagsSection({ reasonCodes }: FlagsSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (reasonCodes.length === 0) return null;

  return (
    <DrawerSection
      title={`Flags (${reasonCodes.length})`}
      meta={
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 font-mono w-5 h-5 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          {expanded ? '−' : '+'}
        </button>
      }
    >
      {expanded ? (
        <div className="space-y-2">
          {reasonCodes.map((code) => {
            const info = getFlagInfo(code);
            return (
              <DrawerCard key={code} className="border-l-2 border-l-amber-400">
                <div className="flex items-center gap-1.5">
                  <FlagIcon className="w-3 h-3 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                  <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{info.label}</span>
                </div>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">{info.description}</p>
                <p className="text-[11px] text-blue-600 dark:text-blue-400">{info.recommendation}</p>
              </DrawerCard>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {reasonCodes.map((code) => {
            const info = getFlagInfo(code);
            return (
              <span
                key={code}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] rounded"
              >
                <FlagIcon className="w-2.5 h-2.5" />
                {info.label}
              </span>
            );
          })}
        </div>
      )}
    </DrawerSection>
  );
}

interface FlagsOverviewSectionProps {
  flaggedProperties: Array<{ key: string; reasonCodes: string[] }>;
}

export function FlagsOverviewSection({ flaggedProperties }: FlagsOverviewSectionProps) {
  const [expanded, setExpanded] = useState(false);

  if (flaggedProperties.length === 0) return null;

  const totalFlags = flaggedProperties.reduce((sum, p) => sum + p.reasonCodes.length, 0);

  return (
    <DrawerSection
      title={`Flags (${totalFlags} across ${flaggedProperties.length} properties)`}
      meta={
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 font-mono w-5 h-5 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          {expanded ? '−' : '+'}
        </button>
      }
    >
      {expanded ? (
        <div className="space-y-2">
          {flaggedProperties.map(({ key, reasonCodes }) => (
            <DrawerCard key={key} className="border-l-2 border-l-amber-400">
              <div className="flex items-center gap-1.5 mb-1">
                <FlagIcon className="w-3 h-3 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{humanizeField(key)}</span>
              </div>
              {reasonCodes.map((code) => {
                const info = getFlagInfo(code);
                return (
                  <div key={code} className="pl-4 text-[11px]">
                    <span className="text-amber-700 dark:text-amber-300 font-medium">{info.label}</span>
                    <span className="text-gray-400 mx-1">—</span>
                    <span className="text-gray-500 dark:text-gray-400">{info.description}</span>
                  </div>
                );
              })}
            </DrawerCard>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {flaggedProperties.map(({ key, reasonCodes }) => (
            <span
              key={key}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-[10px] rounded"
            >
              <FlagIcon className="w-2.5 h-2.5" />
              {humanizeField(key)}: {reasonCodes.map((c) => getFlagInfo(c).label).join(', ')}
            </span>
          ))}
        </div>
      )}
    </DrawerSection>
  );
}
