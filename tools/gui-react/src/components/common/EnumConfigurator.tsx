import { useState, useEffect } from 'react';
import { Tip } from './Tip';
import { TagPicker } from './TagPicker';
import { selectCls, inputCls, labelCls, STUDIO_TIPS } from '../../pages/studio/studioConstants';
import type { EnumEntry } from '../../types/studio';

// ── Types ────────────────────────────────────────────────────────────
interface EnumConfiguratorProps {
  fieldKey: string;
  rule: Record<string, unknown>;
  knownValues: Record<string, string[]>;
  enumLists: EnumEntry[];
  parseTemplate: string;
  onUpdate: (path: string, value: unknown) => void;
  renderLabelSuffix?: (fieldPath: string) => React.ReactNode;
}

type SourceTab = 'manual' | 'enum';

// ── Helpers ──────────────────────────────────────────────────────────
function getN(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((o: unknown, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}
function strN(obj: Record<string, unknown>, path: string, fallback = ''): string {
  const v = getN(obj, path);
  return v != null ? String(v) : fallback;
}
function numN(obj: Record<string, unknown>, path: string, fallback = 0): number {
  const v = getN(obj, path);
  return typeof v === 'number' ? v : (parseInt(String(v), 10) || fallback);
}
function arrN(obj: Record<string, unknown>, path: string): string[] {
  const v = getN(obj, path);
  return Array.isArray(v) ? v.map(String) : [];
}

function detectSourceTab(source: string): SourceTab {
  if (source.startsWith('data_lists.')) return 'enum';
  return 'manual';
}

// ── Chip styles ──────────────────────────────────────────────────────
const chipBase = 'inline-flex items-center px-2 py-0.5 text-xs rounded-full font-medium';
const chipBlue = `${chipBase} bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300`;
const chipGreen = `${chipBase} bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300`;

// ── Tab styles ───────────────────────────────────────────────────────
const tabBase = 'px-3 py-1.5 text-xs font-medium rounded-t relative';
const tabActive = `${tabBase} font-semibold border border-b-0 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 -mb-px z-10`;
const tabInactive = `${tabBase} text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer`;

const dotActive = 'absolute -top-1 -right-1 w-2 h-2 rounded-full';
const dotManual = `${dotActive} bg-amber-500`;
const dotEnum = `${dotActive} bg-purple-500`;

// ── Component ────────────────────────────────────────────────────────
export function EnumConfigurator({
  fieldKey,
  rule,
  knownValues,
  enumLists,
  parseTemplate,
  onUpdate,
  renderLabelSuffix,
}: EnumConfiguratorProps) {
  const currentSource = strN(rule, 'enum.source', strN(rule, 'enum_source'));
  const currentPolicy = strN(rule, 'enum.policy', strN(rule, 'enum_policy', 'open'));
  const matchStrategy = strN(rule, 'enum.match.strategy', 'alias');

  const isBoolean = parseTemplate === 'boolean_yes_no_unk';

  // State
  const [activeTab, setActiveTab] = useState<SourceTab>(() => detectSourceTab(currentSource));

  // Reset state when fieldKey changes
  useEffect(() => {
    const source = strN(rule, 'enum.source', strN(rule, 'enum_source'));
    setActiveTab(detectSourceTab(source));
  }, [fieldKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Known values for this field
  const fieldKnownValues = knownValues[fieldKey] || [];
  const additionalValues = arrN(rule, 'enum.additional_values');

  const hasManual = currentSource === 'yes_no' || additionalValues.length > 0;
  const hasEnum = currentSource.startsWith('data_lists.');

  // Derive selected enum list name from source
  const selectedEnumList = currentSource.startsWith('data_lists.')
    ? currentSource.replace('data_lists.', '')
    : '';
  const selectedListEntry = enumLists.find((e) => e.field === selectedEnumList);

  // ── Boolean info banner ────────────────────────────────────────────
  // Boolean template auto-couples to closed/yes_no but the section remains visible

  function handleAdditionalValuesChange(values: string[]) {
    onUpdate('enum.additional_values', values);
  }

  function handleEnumListSelect(listName: string) {
    if (listName) {
      onUpdate('enum.source', `data_lists.${listName}`);
    } else {
      onUpdate('enum.source', '');
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Boolean info banner ─────────────────────────────────── */}
      {isBoolean ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <svg className="w-4 h-4 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span className="text-xs text-blue-600 dark:text-blue-400">Boolean template auto-locks enum to closed/yes_no</span>
        </div>
      ) : null}

      {/* ── Row 1: Policy + Match Settings ──────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className={`${labelCls} flex items-center`}><span>Enum Policy<Tip text={STUDIO_TIPS.enum_policy} /></span>{renderLabelSuffix?.('enum.policy')}</div>
          <select
            className={`${selectCls} w-full`}
            value={currentPolicy}
            onChange={(e) => onUpdate('enum.policy', e.target.value)}
          >
            <option value="open">open</option>
            <option value="closed">closed</option>
            <option value="open_prefer_known">open_prefer_known</option>
          </select>
        </div>
        <div>
          <div className={`${labelCls} flex items-center`}><span>Match Strategy<Tip text={STUDIO_TIPS.match_strategy} /></span>{renderLabelSuffix?.('enum.match.strategy')}</div>
          <select
            className={`${selectCls} w-full`}
            value={matchStrategy}
            onChange={(e) => onUpdate('enum.match.strategy', e.target.value)}
          >
            <option value="alias">alias</option>
            <option value="exact">exact</option>
            <option value="fuzzy">fuzzy</option>
          </select>
        </div>
        {matchStrategy === 'fuzzy' ? (
          <div>
            <div className={`${labelCls} flex items-center`}><span>Fuzzy Threshold<Tip text={STUDIO_TIPS.fuzzy_threshold} /></span>{renderLabelSuffix?.('enum.match.fuzzy_threshold')}</div>
            <input
              className={`${inputCls} w-full`}
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={numN(rule, 'enum.match.fuzzy_threshold', 0.92)}
              onChange={(e) => onUpdate('enum.match.fuzzy_threshold', parseFloat(e.target.value) || 0.92)}
            />
          </div>
        ) : (
          <div />
        )}
      </div>

      {/* ── Row 2: Value Source Tabs ─────────────────────────────── */}
      <div>
        <div className={`${labelCls} flex items-center`}><span>Value Source<Tip text={STUDIO_TIPS.enum_value_source} /></span>{renderLabelSuffix?.('enum.source')}</div>
        <div className="flex items-end gap-0.5 border-b border-gray-200 dark:border-gray-700">
          <button
            className={activeTab === 'manual' ? tabActive : tabInactive}
            onClick={() => setActiveTab('manual')}
          >
            Manual Values
            {hasManual ? <span className={dotManual} /> : null}
          </button>
          <button
            className={activeTab === 'enum' ? tabActive : tabInactive}
            onClick={() => setActiveTab('enum')}
          >
            Enum
            {hasEnum ? <span className={dotEnum} /> : null}
          </button>
        </div>

        <div className="border border-t-0 border-gray-200 dark:border-gray-700 rounded-b p-3 bg-white dark:bg-gray-800">
          {/* ── Manual Values ────────────────────────── */}
          {activeTab === 'manual' ? (
            <div className="space-y-3">
              {currentSource === 'yes_no' ? (
                <div className="text-xs text-gray-500 mb-1">
                  Source: <span className="font-mono text-accent">yes_no</span> (boolean enum)
                </div>
              ) : null}

              {/* Manual value entry */}
              <div>
                <div className={labelCls}>
                  Add Values
                  <Tip text={STUDIO_TIPS.enum_add_values} />
                </div>
                <TagPicker
                  values={additionalValues}
                  onChange={handleAdditionalValuesChange}
                  suggestions={fieldKnownValues}
                  placeholder="Type to add values..."
                />
              </div>

              {additionalValues.length > 0 ? (
                <div>
                  <div className="text-xs text-gray-500 mb-1">User-added values ({additionalValues.length}):</div>
                  <div className="flex flex-wrap gap-1">
                    {additionalValues.map((v) => (
                      <span key={v} className={chipGreen}>
                        {v}
                        <span className="ml-1 text-[10px] opacity-70">user-added</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ── Enum List Picker ─────────────────────────── */}
          {activeTab === 'enum' ? (
            <div className="space-y-3">
              <div>
                <div className={labelCls}>Enum List</div>
                <select
                  className={`${selectCls} w-full`}
                  value={selectedEnumList}
                  onChange={(e) => handleEnumListSelect(e.target.value)}
                >
                  <option value="">(none)</option>
                  {enumLists.map((el) => (
                    <option key={el.field} value={el.field}>
                      {el.field} ({(el.values || []).length} values)
                    </option>
                  ))}
                </select>
              </div>
              {selectedEnumList ? (
                <div className="text-xs text-gray-500">
                  Source: <span className="font-mono text-accent">data_lists.{selectedEnumList}</span>
                </div>
              ) : null}

              {/* Show values from the selected enum list */}
              {selectedListEntry && (selectedListEntry.values || []).length > 0 ? (
                <div>
                  <div className={labelCls}>
                    Enum Values ({(selectedListEntry.values || []).length})
                  </div>
                  <div className="max-h-48 overflow-y-auto flex flex-wrap gap-1">
                    {(selectedListEntry.values || []).map((v) => (
                      <span key={v} className={chipBlue}>{v}</span>
                    ))}
                  </div>
                </div>
              ) : selectedEnumList ? (
                <div className="text-xs text-gray-400 italic">No values in this enum list.</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        {fieldKnownValues.length > 0 ? (
          <div>
            <div className={labelCls}>
              Known Values ({fieldKnownValues.length})
              <Tip text={STUDIO_TIPS.enum_detected_values} />
            </div>
            <div className="flex flex-wrap gap-1">
              {fieldKnownValues.map((v) => (
                <span key={v} className={chipBlue}>{v}</span>
              ))}
            </div>
          </div>
        ) : null}

        {/* Tier 2: Manual additions (user-added in Studio) — show outside of manual tab too */}
        {additionalValues.length > 0 && activeTab !== 'manual' ? (
          <div>
            <div className={labelCls}>Manual Additions ({additionalValues.length})</div>
            <div className="flex flex-wrap gap-1">
              {additionalValues.map((v) => (
                <span key={v} className={chipGreen}>
                  {v}
                  <span className="ml-1 text-[10px] opacity-70">user-added</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* Open policy note */}
        {(currentPolicy === 'open' || currentPolicy === 'open_prefer_known') && fieldKnownValues.length > 0 ? (
          <p className="text-xs text-gray-400 italic">
            New values may be added during pipeline runs.
          </p>
        ) : null}
      </div>
    </div>
  );
}
