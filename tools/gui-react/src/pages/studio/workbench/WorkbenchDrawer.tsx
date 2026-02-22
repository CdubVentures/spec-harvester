// ── WorkbenchDrawer: right-side detail panel with 7 tabs ─────────────
import { useState } from 'react';
import { Tip } from '../../../components/common/Tip';
import { ComboSelect } from '../../../components/common/ComboSelect';
import { TagPicker } from '../../../components/common/TagPicker';
import { TierPicker } from '../../../components/common/TierPicker';
import { EnumConfigurator } from '../../../components/common/EnumConfigurator';
import { JsonViewer } from '../../../components/common/JsonViewer';
import { humanizeField } from '../../../utils/fieldNormalize';
import { strN, numN, boolN, arrN } from './workbenchHelpers';
import {
  selectCls, inputCls, labelCls,
  UNITS, UNKNOWN_TOKENS, COMPONENT_TYPES,
  DOMAIN_HINT_SUGGESTIONS, CONTENT_TYPE_SUGGESTIONS, UNIT_ACCEPTS_SUGGESTIONS,
  STUDIO_TIPS,
} from '../studioConstants';
import { useFieldRulesStore } from '../useFieldRulesStore';
import type { DrawerTab } from './workbenchTypes';
import type { EnumEntry, ComponentDbResponse, ComponentSource, ComponentSourceProperty } from '../../../types/studio';

interface Props {
  fieldKey: string;
  rule: Record<string, unknown>;
  fieldOrder: string[];
  knownValues: Record<string, string[]>;
  enumLists: EnumEntry[];
  componentDb: ComponentDbResponse;
  componentSources: ComponentSource[];
  onClose: () => void;
  onNavigate: (key: string) => void;
}

const DRAWER_TABS: { id: DrawerTab; label: string }[] = [
  { id: 'contract', label: 'Contract' },
  { id: 'parse', label: 'Parse' },
  { id: 'enum', label: 'Enum' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'search', label: 'Search' },
  { id: 'deps', label: 'Deps' },
  { id: 'preview', label: 'Preview' },
];

export function WorkbenchDrawer({
  fieldKey,
  rule,
  fieldOrder,
  knownValues,
  enumLists,
  componentDb,
  componentSources,
  onClose,
  onNavigate,
}: Props) {
  const [activeTab, setActiveTab] = useState<DrawerTab>('contract');
  const { updateField } = useFieldRulesStore();

  const update = (path: string, value: unknown) => updateField(fieldKey, path, value);

  // Navigation
  const idx = fieldOrder.indexOf(fieldKey);
  const prevKey = idx > 0 ? fieldOrder[idx - 1] : null;
  const nextKey = idx < fieldOrder.length - 1 ? fieldOrder[idx + 1] : null;

  // Required level badge
  const reqLevel = strN(rule, 'priority.required_level', strN(rule, 'required_level', 'expected'));
  const reqColors: Record<string, string> = {
    identity: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
    required: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    expected: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    optional: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  };

  return (
    <div className="border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 340px)' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => prevKey && onNavigate(prevKey)}
              disabled={!prevKey}
              className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-sm"
              title="Previous field"
            >
              &#9664;
            </button>
            <button
              onClick={() => nextKey && onNavigate(nextKey)}
              disabled={!nextKey}
              className="text-gray-400 hover:text-gray-600 disabled:opacity-30 text-sm"
              title="Next field"
            >
              &#9654;
            </button>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            title="Close"
          >
            &#10005;
          </button>
        </div>
        <div>
          <h3 className="text-sm font-semibold">{humanizeField(fieldKey)}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-gray-400 font-mono">{fieldKey}</span>
            <span className={`px-1.5 py-0.5 text-[10px] rounded font-medium ${reqColors[reqLevel] || reqColors.optional}`}>
              {reqLevel}
            </span>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-0.5 mt-3 -mb-px">
          {DRAWER_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-2 py-1 text-[11px] font-medium rounded-t border-b-2 ${
                activeTab === tab.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="p-4 space-y-3">
        {activeTab === 'contract' && (
          <ContractTab fieldKey={fieldKey} rule={rule} onUpdate={update} />
        )}
        {activeTab === 'parse' && (
          <ParseTab rule={rule} onUpdate={update} />
        )}
        {activeTab === 'enum' && (
          <EnumTab
            fieldKey={fieldKey}
            rule={rule}
            knownValues={knownValues}
            enumLists={enumLists}
            onUpdate={update}
          />
        )}
        {activeTab === 'evidence' && (
          <EvidenceTab rule={rule} onUpdate={update} />
        )}
        {activeTab === 'search' && (
          <SearchTab rule={rule} onUpdate={update} />
        )}
        {activeTab === 'deps' && (
          <DepsTab rule={rule} fieldKey={fieldKey} onUpdate={update} componentSources={componentSources} knownValues={knownValues} />
        )}
        {activeTab === 'preview' && (
          <PreviewTab
            fieldKey={fieldKey}
            rule={rule}
            knownValues={knownValues}
            componentDb={componentDb}
            enumLists={enumLists}
          />
        )}
      </div>
    </div>
  );
}

// ── Contract Tab ─────────────────────────────────────────────────────
function ContractTab({ fieldKey, rule, onUpdate }: { fieldKey: string; rule: Record<string, unknown>; onUpdate: (path: string, val: unknown) => void }) {
  const tooltipMd = strN(rule, 'ui.tooltip_md');

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className={labelCls}>Data Type<Tip text={STUDIO_TIPS.data_type} /></div>
          <select className={`${selectCls} w-full`} value={strN(rule, 'contract.type', 'string')} onChange={(e) => onUpdate('contract.type', e.target.value)}>
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="integer">integer</option>
            <option value="boolean">boolean</option>
            <option value="date">date</option>
            <option value="url">url</option>
            <option value="enum">enum</option>
          </select>
        </div>
        <div>
          <div className={labelCls}>Shape<Tip text={STUDIO_TIPS.shape} /></div>
          <select className={`${selectCls} w-full`} value={strN(rule, 'contract.shape', 'scalar')} onChange={(e) => onUpdate('contract.shape', e.target.value)}>
            <option value="scalar">scalar</option>
            <option value="list">list</option>
            <option value="structured">structured</option>
            <option value="key_value">key_value</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className={labelCls}>Unit<Tip text={STUDIO_TIPS.contract_unit} /></div>
          <ComboSelect value={strN(rule, 'contract.unit')} onChange={(v) => onUpdate('contract.unit', v || null)} options={UNITS} placeholder="e.g. g, mm" />
        </div>
        <div>
          <div className={labelCls}>Unknown Token<Tip text={STUDIO_TIPS.unknown_token} /></div>
          <ComboSelect value={strN(rule, 'contract.unknown_token', 'unk')} onChange={(v) => onUpdate('contract.unknown_token', v)} options={UNKNOWN_TOKENS} placeholder="unk" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className={labelCls}>Rounding<Tip text={STUDIO_TIPS.rounding_decimals} /></div>
          <input className={`${inputCls} w-full`} type="number" min={0} max={6} value={numN(rule, 'contract.rounding.decimals', 0)} onChange={(e) => onUpdate('contract.rounding.decimals', parseInt(e.target.value, 10) || 0)} />
        </div>
        <div>
          <div className={labelCls}>Rounding Mode<Tip text={STUDIO_TIPS.rounding_mode} /></div>
          <select className={`${selectCls} w-full`} value={strN(rule, 'contract.rounding.mode', 'nearest')} onChange={(e) => onUpdate('contract.rounding.mode', e.target.value)}>
            <option value="nearest">nearest</option>
            <option value="floor">floor</option>
            <option value="ceil">ceil</option>
          </select>
        </div>
      </div>

      <h4 className="text-xs font-semibold text-gray-500 mt-4">Priority & Effort</h4>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className={labelCls}>Required Level<Tip text={STUDIO_TIPS.required_level} /></div>
          <select className={`${selectCls} w-full`} value={strN(rule, 'priority.required_level', strN(rule, 'required_level', 'expected'))} onChange={(e) => onUpdate('priority.required_level', e.target.value)}>
            <option value="identity">identity</option>
            <option value="required">required</option>
            <option value="critical">critical</option>
            <option value="expected">expected</option>
            <option value="optional">optional</option>
            <option value="editorial">editorial</option>
            <option value="commerce">commerce</option>
          </select>
        </div>
        <div>
          <div className={labelCls}>Availability<Tip text={STUDIO_TIPS.availability} /></div>
          <select className={`${selectCls} w-full`} value={strN(rule, 'priority.availability', strN(rule, 'availability', 'expected'))} onChange={(e) => onUpdate('priority.availability', e.target.value)}>
            <option value="always">always</option>
            <option value="expected">expected</option>
            <option value="sometimes">sometimes</option>
            <option value="rare">rare</option>
            <option value="editorial_only">editorial_only</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className={labelCls}>Difficulty<Tip text={STUDIO_TIPS.difficulty} /></div>
          <select className={`${selectCls} w-full`} value={strN(rule, 'priority.difficulty', strN(rule, 'difficulty', 'easy'))} onChange={(e) => onUpdate('priority.difficulty', e.target.value)}>
            <option value="easy">easy</option>
            <option value="medium">medium</option>
            <option value="hard">hard</option>
            <option value="instrumented">instrumented</option>
          </select>
        </div>
        <div>
          <div className={labelCls}>Effort (1-10)<Tip text={STUDIO_TIPS.effort} /></div>
          <input className={`${inputCls} w-full`} type="number" min={1} max={10} value={numN(rule, 'priority.effort', numN(rule, 'effort', 3))} onChange={(e) => onUpdate('priority.effort', parseInt(e.target.value, 10) || 1)} />
        </div>
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={boolN(rule, 'priority.publish_gate', boolN(rule, 'publish_gate'))} onChange={(e) => onUpdate('priority.publish_gate', e.target.checked)} className="rounded border-gray-300" />
          Publish Gate<Tip text={STUDIO_TIPS.publish_gate} />
        </label>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={boolN(rule, 'priority.block_publish_when_unk', boolN(rule, 'block_publish_when_unk'))} onChange={(e) => onUpdate('priority.block_publish_when_unk', e.target.checked)} className="rounded border-gray-300" />
          Block when unk<Tip text={STUDIO_TIPS.block_publish_when_unk} />
        </label>
      </div>

      {/* AI Assist */}
      <h4 className="text-xs font-semibold text-gray-500 mt-4">AI Assist</h4>
      {(() => {
        const explicitMode = strN(rule, 'ai_assist.mode');
        const strategy = strN(rule, 'ai_assist.model_strategy', 'auto');
        const explicitCalls = numN(rule, 'ai_assist.max_calls', 0);
        const rl = strN(rule, 'priority.required_level', strN(rule, 'required_level', 'expected'));
        const diff = strN(rule, 'priority.difficulty', strN(rule, 'difficulty', 'easy'));
        const effort = numN(rule, 'priority.effort', numN(rule, 'effort', 3));

        let derivedMode = 'off';
        if (['identity', 'required', 'critical'].includes(rl)) derivedMode = 'judge';
        else if (rl === 'expected' && diff === 'hard') derivedMode = 'planner';
        else if (rl === 'expected') derivedMode = 'advisory';
        const effectiveMode = explicitMode || derivedMode;

        const derivedCalls = effort <= 3 ? 1 : effort <= 6 ? 2 : 3;
        const effectiveCalls = explicitCalls > 0 ? Math.min(explicitCalls, 10) : derivedCalls;

        const modeToModel: Record<string, { model: string; reasoning: boolean }> = {
          off: { model: 'none', reasoning: false },
          advisory: { model: 'gpt-5-low', reasoning: false },
          planner: { model: 'gpt-5-low \u2192 gpt-5.2-high', reasoning: false },
          judge: { model: 'gpt-5.2-high', reasoning: true },
        };
        let effectiveModel = modeToModel[effectiveMode] || modeToModel.off;
        if (strategy === 'force_fast') effectiveModel = { model: 'gpt-5-low (forced)', reasoning: false };
        else if (strategy === 'force_deep') effectiveModel = { model: 'gpt-5.2-high (forced)', reasoning: true };

        return (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className={labelCls}>Mode<Tip text={STUDIO_TIPS.ai_mode} /></div>
                <select className={`${selectCls} w-full`} value={explicitMode} onChange={(e) => onUpdate('ai_assist.mode', e.target.value || null)}>
                  <option value="">auto ({derivedMode})</option>
                  <option value="off">off — no LLM</option>
                  <option value="advisory">advisory — gpt-5-low</option>
                  <option value="planner">planner — 5-low→5.2-high</option>
                  <option value="judge">judge — gpt-5.2-high</option>
                </select>
              </div>
              <div>
                <div className={labelCls}>Model Strategy<Tip text={STUDIO_TIPS.ai_model_strategy} /></div>
                <select className={`${selectCls} w-full`} value={strategy} onChange={(e) => onUpdate('ai_assist.model_strategy', e.target.value)}>
                  <option value="auto">auto — mode decides</option>
                  <option value="force_fast">force_fast — gpt-5-low</option>
                  <option value="force_deep">force_deep — gpt-5.2-high</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className={labelCls}>Max Calls<Tip text={STUDIO_TIPS.ai_max_calls} /></div>
                <input className={`${inputCls} w-full`} type="number" min={1} max={10} value={explicitCalls || ''} onChange={(e) => onUpdate('ai_assist.max_calls', parseInt(e.target.value, 10) || null)} placeholder={`auto (${derivedCalls})`} />
              </div>
              <div>
                <div className={labelCls}>Max Tokens<Tip text={STUDIO_TIPS.ai_max_tokens} /></div>
                <input className={`${inputCls} w-full`} type="number" min={256} max={65536} step={1024} value={numN(rule, 'ai_assist.max_tokens', 0) || ''} onChange={(e) => onUpdate('ai_assist.max_tokens', parseInt(e.target.value, 10) || null)} placeholder={`auto (${effectiveMode === 'off' ? '0' : effectiveMode === 'advisory' ? '4096' : effectiveMode === 'planner' ? '8192' : '16384'})`} />
              </div>
            </div>

            {/* Effective resolution summary */}
            <div className="text-[11px] bg-gray-50 dark:bg-gray-800/50 rounded p-2 border border-gray-200 dark:border-gray-700 space-y-1">
              <div className="text-[10px] font-semibold text-gray-400 mb-1">Effective Config</div>
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400 w-12">Mode:</span>
                <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${
                  effectiveMode === 'judge' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                  : effectiveMode === 'planner' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                  : effectiveMode === 'advisory' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                }`}>{effectiveMode}</span>
                {!explicitMode && <span className="text-gray-400 italic text-[10px]">({rl}{diff !== 'easy' ? `+${diff}` : ''})</span>}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400 w-12">Model:</span>
                <span className="text-gray-600 dark:text-gray-300 font-mono text-[10px]">{effectiveModel.model}</span>
                {effectiveModel.reasoning && <span className="text-[9px] px-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium">REASONING</span>}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400 w-12">Budget:</span>
                <span className="text-gray-600 dark:text-gray-300">{effectiveMode === 'off' ? '0' : effectiveCalls} call{effectiveCalls !== 1 ? 's' : ''}</span>
                {!explicitCalls && effectiveMode !== 'off' && <span className="text-gray-400 italic text-[10px]">(effort {effort})</span>}
              </div>
            </div>

            {(() => {
              const explicitNote = strN(rule, 'ai_assist.reasoning_note');
              const type = strN(rule, 'contract.data_type', strN(rule, 'data_type', 'string'));
              const shape = strN(rule, 'contract.shape', strN(rule, 'shape', 'scalar'));
              const unit = strN(rule, 'contract.unit', strN(rule, 'unit'));
              const enumPolicy = strN(rule, 'enum.policy', strN(rule, 'enum_policy', 'open'));
              const enumSource = strN(rule, 'enum.source', strN(rule, 'enum_source'));
              const evidenceReq = boolN(rule, 'evidence.evidence_required', boolN(rule, 'evidence_required'));
              const minRefs = numN(rule, 'evidence.min_evidence_refs', numN(rule, 'min_evidence_refs', 1));
              const parseTemplate = strN(rule, 'parse.template', strN(rule, 'parse_template'));
              const componentType = strN(rule, 'component.type', strN(rule, 'component_type'));

              const gp: string[] = [];
              if (rl === 'identity') gp.push('Identity field \u2014 must exactly match the product.');
              if (componentType || parseTemplate === 'component_reference') {
                const ct = componentType || enumSource.replace('component_db.', '');
                gp.push(`Component ref (${ct}). Match to known names/aliases.`);
              }
              if (type === 'boolean' || parseTemplate?.startsWith('boolean_')) {
                gp.push('Boolean \u2014 determine yes or no from explicit evidence.');
              } else if ((type === 'number' || type === 'integer') && unit) {
                gp.push(`Numeric \u2014 extract exact value in ${unit}.`);
              } else if (type === 'url') {
                gp.push('URL \u2014 extract full, valid URL.');
              } else if (type === 'date' || fieldKey.includes('date')) {
                gp.push('Date \u2014 extract actual date from official sources.');
              } else if (type === 'string' && !componentType && !parseTemplate?.startsWith('boolean_')) {
                gp.push('Text \u2014 extract exact value as stated.');
              }
              if (shape === 'list') gp.push('Multiple values \u2014 extract all distinct.');
              if (enumPolicy === 'closed' && enumSource) gp.push(`Closed enum \u2014 must match ${enumSource}.`);
              if (diff === 'hard') gp.push('Often inconsistent \u2014 prefer manufacturer spec sheets.');
              else if (diff === 'instrumented') gp.push('Lab-measured \u2014 only from independent tests.');
              if (evidenceReq && minRefs >= 2) gp.push(`Requires ${minRefs}+ independent refs.`);
              if (rl === 'required' || rl === 'critical') gp.push('High-priority \u2014 blocked if unknown.');
              if (gp.length === 0) gp.push('Extract from most authoritative source.');
              const autoNote = gp.join(' ');
              const hasExplicit = explicitNote.length > 0;

              return (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={labelCls.replace(' mb-1', '')}>Extraction Guidance<Tip text={STUDIO_TIPS.ai_reasoning_note} /></span>
                    {!hasExplicit && <span className="text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500 italic font-medium">Auto</span>}
                  </div>
                  <textarea
                    className={`${inputCls} w-full`}
                    rows={2}
                    value={explicitNote}
                    onChange={(e) => onUpdate('ai_assist.reasoning_note', e.target.value)}
                    placeholder={`Auto: ${autoNote}`}
                  />
                  {hasExplicit && (
                    <button
                      className="text-[10px] text-blue-500 hover:text-blue-700 mt-0.5"
                      onClick={() => onUpdate('ai_assist.reasoning_note', '')}
                    >
                      Clear &amp; revert to auto
                    </button>
                  )}
                </div>
              );
            })()}
          </>
        );
      })()}

      {/* Tooltip / description preview */}
      <h4 className="text-xs font-semibold text-gray-500 mt-4">Description & Tooltip</h4>
      <div>
        <div className={labelCls}>Tooltip / Guidance<Tip text={STUDIO_TIPS.tooltip_guidance} /></div>
        <textarea
          className={`${inputCls} w-full`}
          rows={3}
          value={tooltipMd}
          onChange={(e) => onUpdate('ui.tooltip_md', e.target.value)}
          placeholder="Describe how this field should be interpreted..."
        />
      </div>
      {tooltipMd && (
        <div className="text-xs bg-gray-50 dark:bg-gray-800/50 rounded p-2 border border-gray-200 dark:border-gray-700">
          <div className="text-[10px] text-gray-400 mb-1 font-medium">Preview:</div>
          <div className="text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{tooltipMd}</div>
        </div>
      )}
    </div>
  );
}

// ── Parse Tab ────────────────────────────────────────────────────────
function ParseTab({ rule, onUpdate }: { rule: Record<string, unknown>; onUpdate: (path: string, val: unknown) => void }) {
  const pt = strN(rule, 'parse.template', strN(rule, 'parse_template'));
  const showUnits = ['number_with_unit', 'list_of_numbers_with_unit', 'list_numbers_or_ranges_with_unit'].includes(pt);

  return (
    <div className="space-y-3">
      <div>
        <div className={labelCls}>Parse Template<Tip text={STUDIO_TIPS.parse_template} /></div>
        <select className={`${selectCls} w-full`} value={pt} onChange={(e) => onUpdate('parse.template', e.target.value)}>
          <option value="">none</option>
          <option value="text_field">text_field</option>
          <option value="number_with_unit">number_with_unit</option>
          <option value="boolean_yes_no_unk">boolean_yes_no_unk</option>
          <option value="component_reference">component_reference</option>
          <option value="date_field">date_field</option>
          <option value="url_field">url_field</option>
          <option value="list_of_numbers_with_unit">list_of_numbers_with_unit</option>
          <option value="list_numbers_or_ranges_with_unit">list_numbers_or_ranges_with_unit</option>
          <option value="list_of_tokens_delimited">list_of_tokens_delimited</option>
          <option value="token_list">token_list</option>
          <option value="text_block">text_block</option>
        </select>
      </div>

      {/* Output type derived from template */}
      {pt && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 font-medium">Output type:</span>
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-mono">
            {pt === 'boolean_yes_no_unk' ? 'boolean'
              : pt === 'number_with_unit' || pt === 'list_of_numbers_with_unit' || pt === 'list_numbers_or_ranges_with_unit' ? 'number'
              : pt === 'url_field' ? 'url'
              : pt === 'date_field' ? 'date'
              : pt === 'list_of_tokens_delimited' || pt === 'token_list' ? 'list'
              : pt === 'component_reference' ? 'component_ref'
              : 'string'}
          </span>
        </div>
      )}

      {showUnits && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className={labelCls}>Parse Unit<Tip text={STUDIO_TIPS.parse_unit} /></div>
              <ComboSelect value={strN(rule, 'parse.unit')} onChange={(v) => onUpdate('parse.unit', v)} options={UNITS} placeholder="e.g. g" />
            </div>
            <div>
              <div className={labelCls}>Unit Accepts<Tip text={STUDIO_TIPS.unit_accepts} /></div>
              <TagPicker values={arrN(rule, 'parse.unit_accepts')} onChange={(v) => onUpdate('parse.unit_accepts', v)} suggestions={UNIT_ACCEPTS_SUGGESTIONS} placeholder="g, grams..." />
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={boolN(rule, 'parse.allow_unitless')} onChange={(e) => onUpdate('parse.allow_unitless', e.target.checked)} className="rounded border-gray-300" />
              Allow unitless<Tip text={STUDIO_TIPS.allow_unitless} />
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={boolN(rule, 'parse.allow_ranges')} onChange={(e) => onUpdate('parse.allow_ranges', e.target.checked)} className="rounded border-gray-300" />
              Allow ranges<Tip text={STUDIO_TIPS.allow_ranges} />
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={boolN(rule, 'parse.strict_unit_required')} onChange={(e) => onUpdate('parse.strict_unit_required', e.target.checked)} className="rounded border-gray-300" />
              Strict unit<Tip text={STUDIO_TIPS.strict_unit_required} />
            </label>
          </div>
        </>
      )}
      {!showUnits && pt && (
        <div className="text-xs text-gray-400 italic">
          Unit settings hidden &mdash; {pt.replace(/_/g, ' ')} template does not use units.
        </div>
      )}
    </div>
  );
}

// ── Enum Tab ─────────────────────────────────────────────────────────
function EnumTab({
  fieldKey,
  rule,
  knownValues,
  enumLists,
  onUpdate,
}: {
  fieldKey: string;
  rule: Record<string, unknown>;
  knownValues: Record<string, string[]>;
  enumLists: EnumEntry[];
  onUpdate: (path: string, val: unknown) => void;
}) {
  const parseTemplate = strN(rule, 'parse.template', strN(rule, 'parse_template'));
  return (
    <EnumConfigurator
      fieldKey={fieldKey}
      rule={rule}
      knownValues={knownValues}
      enumLists={enumLists}
      parseTemplate={parseTemplate}
      onUpdate={onUpdate}
    />
  );
}

// ── Evidence Tab ─────────────────────────────────────────────────────
function EvidenceTab({ rule, onUpdate }: { rule: Record<string, unknown>; onUpdate: (path: string, val: unknown) => void }) {
  const pubGate = boolN(rule, 'priority.publish_gate', boolN(rule, 'publish_gate'));
  const blockUnk = boolN(rule, 'priority.block_publish_when_unk', boolN(rule, 'block_publish_when_unk'));
  const evReq = boolN(rule, 'evidence.required', boolN(rule, 'evidence_required', true));
  const minRefs = numN(rule, 'evidence.min_evidence_refs', numN(rule, 'min_evidence_refs', 1));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={evReq} onChange={(e) => onUpdate('evidence.required', e.target.checked)} className="rounded border-gray-300" />
          Evidence Required<Tip text={STUDIO_TIPS.evidence_required} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className={labelCls}>Min Evidence Refs<Tip text={STUDIO_TIPS.min_evidence_refs} /></div>
          <input className={`${inputCls} w-full`} type="number" min={0} max={10} value={minRefs} onChange={(e) => onUpdate('evidence.min_evidence_refs', parseInt(e.target.value, 10) || 0)} />
        </div>
        <div>
          <div className={labelCls}>Conflict Policy<Tip text={STUDIO_TIPS.conflict_policy} /></div>
          <select className={`${selectCls} w-full`} value={strN(rule, 'evidence.conflict_policy', 'resolve_by_tier_else_unknown')} onChange={(e) => onUpdate('evidence.conflict_policy', e.target.value)}>
            <option value="resolve_by_tier_else_unknown">resolve_by_tier_else_unknown</option>
            <option value="prefer_highest_tier">prefer_highest_tier</option>
            <option value="prefer_most_recent">prefer_most_recent</option>
            <option value="flag_for_review">flag_for_review</option>
          </select>
        </div>
      </div>
      <div>
        <div className={labelCls}>Tier Preference<Tip text={STUDIO_TIPS.tier_preference} /></div>
        <TierPicker
          value={arrN(rule, 'evidence.tier_preference').length > 0 ? arrN(rule, 'evidence.tier_preference') : ['tier1', 'tier2', 'tier3']}
          onChange={(v) => onUpdate('evidence.tier_preference', v)}
        />
      </div>

      {/* Publish failure summary */}
      <h4 className="text-xs font-semibold text-gray-500 mt-4">What would fail publish</h4>
      <div className="text-xs bg-gray-50 dark:bg-gray-800/50 rounded p-2 border border-gray-200 dark:border-gray-700 space-y-1">
        {pubGate && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
            <span>Publish Gate is ON &mdash; value must be non-unknown to publish</span>
          </div>
        )}
        {blockUnk && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
            <span>Block when UNK &mdash; unknown token blocks publish</span>
          </div>
        )}
        {evReq && minRefs > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0" />
            <span>Evidence required &mdash; at least {minRefs} source ref{minRefs > 1 ? 's' : ''} needed</span>
          </div>
        )}
        {!pubGate && !blockUnk && !(evReq && minRefs > 0) && (
          <div className="text-gray-400 italic">No publish-blocking rules configured</div>
        )}
      </div>
    </div>
  );
}

// ── Search Tab ───────────────────────────────────────────────────────
function SearchTab({ rule, onUpdate }: { rule: Record<string, unknown>; onUpdate: (path: string, val: unknown) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <div className={labelCls}>Domain Hints<Tip text={STUDIO_TIPS.domain_hints} /></div>
        <TagPicker values={arrN(rule, 'search_hints.domain_hints')} onChange={(v) => onUpdate('search_hints.domain_hints', v)} suggestions={DOMAIN_HINT_SUGGESTIONS} placeholder="manufacturer, rtings.com..." />
      </div>
      <div>
        <div className={labelCls}>Content Types<Tip text={STUDIO_TIPS.content_types} /></div>
        <TagPicker values={arrN(rule, 'search_hints.preferred_content_types')} onChange={(v) => onUpdate('search_hints.preferred_content_types', v)} suggestions={CONTENT_TYPE_SUGGESTIONS} placeholder="spec_sheet, datasheet..." />
      </div>
      <div>
        <div className={labelCls}>Query Terms<Tip text={STUDIO_TIPS.query_terms} /></div>
        <TagPicker values={arrN(rule, 'search_hints.query_terms')} onChange={(v) => onUpdate('search_hints.query_terms', v)} placeholder="alternative search terms" />
      </div>
    </div>
  );
}

// ── Deps (Component) Tab ─────────────────────────────────────────────
function DepsTab({ rule, fieldKey: _fieldKey, onUpdate, componentSources, knownValues }: { rule: Record<string, unknown>; fieldKey: string; onUpdate: (path: string, val: unknown) => void; componentSources: ComponentSource[]; knownValues: Record<string, string[]> }) {
  const { editedRules } = useFieldRulesStore();
  return (
    <div className="space-y-3">
      <div>
        <div className={labelCls}>Component DB<Tip text={STUDIO_TIPS.component_db} /></div>
        <select
          className={`${selectCls} w-full`}
          value={strN(rule, 'component.type')}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) {
              onUpdate('component', null);
              if (strN(rule, 'parse.template') === 'component_reference') {
                onUpdate('parse.template', 'text_field');
              }
            } else {
              onUpdate('component', {
                type: v,
                source: `component_db.${v}`,
                allow_new_components: true,
                require_identity_evidence: true,
              });
              onUpdate('parse.template', 'component_reference');
              onUpdate('enum.source', `component_db.${v}`);
              onUpdate('enum.policy', 'open_prefer_known');
              onUpdate('enum.match.strategy', 'alias');
              onUpdate('ui.input_control', 'component_picker');
            }
          }}
        >
          <option value="">(none)</option>
          {COMPONENT_TYPES.map((ct) => (
            <option key={ct} value={ct}>{ct}</option>
          ))}
        </select>
      </div>
      {strN(rule, 'component.type') && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 font-medium">
              component_reference
            </span>
            <span className="text-gray-400">
              Parse: <span className="font-mono">{strN(rule, 'parse.template')}</span>
              {' | '}Enum: <span className="font-mono">{strN(rule, 'enum.source')}</span>
            </span>
          </div>
          {/* ── Match Settings ─────────────────────── */}
          <details className="border border-gray-200 dark:border-gray-700 rounded">
            <summary className="px-2 py-1 text-xs font-semibold cursor-pointer bg-gray-50 dark:bg-gray-700/50">Match Settings</summary>
            <div className="p-2 space-y-2">
              {/* Name Matching */}
              <div className="text-[11px] font-medium text-gray-400 mb-1">Name Matching</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className={labelCls}>Fuzzy Threshold<Tip text={STUDIO_TIPS.comp_match_fuzzy_threshold} /></div>
                  <input type="number" min={0} max={1} step={0.05} className={`${selectCls} w-full`}
                    value={numN(rule, 'component.match.fuzzy_threshold', 0.75)}
                    onChange={(e) => onUpdate('component.match.fuzzy_threshold', parseFloat(e.target.value) || 0.75)} />
                </div>
                <div>
                  <div className={labelCls}>Name Weight<Tip text={STUDIO_TIPS.comp_match_name_weight} /></div>
                  <input type="number" min={0} max={1} step={0.05} className={`${selectCls} w-full`}
                    value={numN(rule, 'component.match.name_weight', 0.4)}
                    onChange={(e) => onUpdate('component.match.name_weight', parseFloat(e.target.value) || 0.4)} />
                </div>
                <div>
                  <div className={labelCls}>Auto-Accept<Tip text={STUDIO_TIPS.comp_match_auto_accept_score} /></div>
                  <input type="number" min={0} max={1} step={0.05} className={`${selectCls} w-full`}
                    value={numN(rule, 'component.match.auto_accept_score', 0.95)}
                    onChange={(e) => onUpdate('component.match.auto_accept_score', parseFloat(e.target.value) || 0.95)} />
                </div>
                <div>
                  <div className={labelCls}>Flag Review<Tip text={STUDIO_TIPS.comp_match_flag_review_score} /></div>
                  <input type="number" min={0} max={1} step={0.05} className={`${selectCls} w-full`}
                    value={numN(rule, 'component.match.flag_review_score', 0.65)}
                    onChange={(e) => onUpdate('component.match.flag_review_score', parseFloat(e.target.value) || 0.65)} />
                </div>
              </div>
              {/* Property Matching */}
              <div className="text-[11px] font-medium text-gray-400 mb-1 mt-2">Property Matching</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className={labelCls}>Prop Weight<Tip text={STUDIO_TIPS.comp_match_property_weight} /></div>
                  <input type="number" min={0} max={1} step={0.05} className={`${selectCls} w-full`}
                    value={numN(rule, 'component.match.property_weight', 0.6)}
                    onChange={(e) => onUpdate('component.match.property_weight', parseFloat(e.target.value) || 0.6)} />
                </div>
                <div className="col-span-2">
                  <div className={labelCls}>Property Keys<Tip text={STUDIO_TIPS.comp_match_property_keys} /></div>
                  {(() => {
                    const compType = strN(rule, 'component.type');
                    const compSource = componentSources.find(
                      s => (s.component_type || s.type) === compType
                    );
                    const derivedProps = (compSource?.roles?.properties || []).filter(p => p.field_key);
                    const NUMERIC_ONLY_VP = ['upper_bound', 'lower_bound', 'range'];
                    return (
                      <div className="space-y-1">
                        {derivedProps.map(p => {
                          const raw = p.variance_policy || 'authoritative';
                          const fieldRule = editedRules[p.field_key || ''] as Record<string, unknown> | undefined;
                          const enumSrc = fieldRule ? strN(fieldRule, 'enum.source') : '';
                          const contractType = fieldRule ? strN(fieldRule, 'contract.type') : '';
                          const parseTemplate = fieldRule ? strN(fieldRule, 'parse.template') : '';
                          const isBool = contractType === 'boolean';
                          const hasEnum = !!enumSrc;
                          const isComponentDb = hasEnum && enumSrc.startsWith('component_db');
                          const isExtEnum = hasEnum && !isComponentDb;
                          const isLocked = contractType !== 'number' || isBool || hasEnum;
                          const vp = isLocked && NUMERIC_ONLY_VP.includes(raw) ? 'authoritative' : raw;
                          const fieldValues = knownValues[p.field_key || ''] || [];
                          const lockReason = isBool
                            ? 'Boolean field — locked to authoritative'
                            : isComponentDb
                              ? `enum.db (${enumSrc.replace(/^component_db\./, '')}) — locked to authoritative`
                              : isExtEnum
                                ? `Enum (${enumSrc.replace(/^(known_values|data_lists)\./, '')}) — locked to authoritative`
                                : contractType !== 'number' && fieldValues.length > 0
                                  ? `Manual values (${fieldValues.length}) — locked to authoritative`
                                  : isLocked
                                    ? 'String property — locked to authoritative'
                                    : '';
                          return (
                            <div key={p.field_key} className="flex items-start gap-1.5 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-[11px]">
                              <span className="font-medium text-blue-700 dark:text-blue-300 shrink-0">{p.field_key}</span>
                              <span
                                className={`text-[9px] px-1 rounded shrink-0 ${vp === 'override_allowed' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' : isLocked ? 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500' : 'bg-blue-100 text-blue-600 dark:bg-blue-800 dark:text-blue-300'}`}
                                title={lockReason || (vp === 'override_allowed' ? 'Products can override this value without triggering review' : `Variance: ${vp}`)}
                              >{vp === 'override_allowed' ? 'override' : vp}</span>
                              {parseTemplate ? <span className="text-[9px] px-1 rounded bg-gray-50 text-gray-400 dark:bg-gray-800 dark:text-gray-500 shrink-0">{parseTemplate}</span> : null}
                              {isBool ? <span className="text-[9px] px-1 rounded bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 shrink-0">boolean: yes / no</span> : null}
                              {isComponentDb ? <span className="text-[9px] px-1 rounded bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400 shrink-0 truncate max-w-[120px]" title={enumSrc}>enum.db: {enumSrc.replace(/^component_db\./, '')}</span> : null}
                              {isExtEnum ? <span className="text-[9px] px-1 rounded bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400 shrink-0 truncate max-w-[120px]" title={enumSrc}>enum: {enumSrc.replace(/^(known_values|data_lists)\./, '')}</span> : null}
                              {!isBool && !hasEnum && isLocked && fieldValues.length > 0 && fieldValues.length <= 6 ? (
                                <div className="flex flex-wrap gap-0.5">
                                  <span className="text-[9px] text-gray-400 mr-0.5">manual:</span>
                                  {fieldValues.map(v => <span key={v} className="text-[9px] px-1 rounded bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">{v}</span>)}
                                </div>
                              ) : null}
                              {!isBool && !hasEnum && isLocked && fieldValues.length > 6 ? (
                                <span className="text-[9px] text-gray-400" title={fieldValues.join(', ')}>manual: {fieldValues.length} values</span>
                              ) : null}
                            </div>
                          );
                        })}
                        {derivedProps.length === 0 ? (
                          <span className="text-xs text-gray-400 italic">No properties mapped — add in Mapping Studio</span>
                        ) : null}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </details>
        </>
      )}
      <div>
        <div className={labelCls}>Aliases<Tip text={STUDIO_TIPS.aliases} /></div>
        <TagPicker values={arrN(rule, 'aliases')} onChange={(v) => onUpdate('aliases', v)} placeholder="alternative names for this key" />
      </div>
    </div>
  );
}

// ── Preview Tab ──────────────────────────────────────────────────────
function PreviewTab({
  fieldKey,
  rule,
  knownValues,
  componentDb,
  enumLists,
}: {
  fieldKey: string;
  rule: Record<string, unknown>;
  knownValues: Record<string, string[]>;
  componentDb: ComponentDbResponse;
  enumLists: EnumEntry[];
}) {
  const kv = knownValues[fieldKey] || [];
  const compType = strN(rule, 'component.type');
  const compEntities = compType && componentDb[compType] ? componentDb[compType] : [];
  const enumSource = strN(rule, 'enum.source', strN(rule, 'enum_source'));

  return (
    <div className="space-y-3">
      {/* Source summary */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="text-gray-400 font-medium">Source:</span>
        {enumSource ? (
          <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-mono">
            {enumSource}
          </span>
        ) : (
          <span className="text-gray-400 italic">none</span>
        )}
      </div>

      {/* Known values */}
      <div>
        <div className={labelCls}>Known Values ({kv.length})</div>
        {kv.length > 0 ? (
          <div className="flex flex-wrap gap-1 mt-1 max-h-32 overflow-y-auto">
            {kv.slice(0, 80).map((v) => (
              <span key={v} className="px-1.5 py-0.5 text-[11px] rounded bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-mono">
                {v}
              </span>
            ))}
            {kv.length > 80 && <span className="text-xs text-gray-400">+{kv.length - 80} more</span>}
          </div>
        ) : (
          <span className="text-xs text-gray-400 italic">No known values</span>
        )}
      </div>

      {/* Component DB entities */}
      {compType && (
        <div>
          <div className={labelCls}>Component DB: {compType} ({compEntities.length})</div>
          {compEntities.length > 0 ? (
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500">
                    <th className="text-left py-0.5">Name</th>
                    <th className="text-left py-0.5">Maker</th>
                    <th className="text-left py-0.5">Aliases</th>
                  </tr>
                </thead>
                <tbody>
                  {compEntities.slice(0, 40).map((e, i) => (
                    <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="py-0.5 font-mono">{e.name}</td>
                      <td className="py-0.5 text-gray-500">{e.maker || '\u2014'}</td>
                      <td className="py-0.5 text-gray-400 text-[10px] truncate max-w-[120px]">
                        {e.aliases?.length > 0 ? e.aliases.join(', ') : '\u2014'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {compEntities.length > 40 && <span className="text-xs text-gray-400">+{compEntities.length - 40} more</span>}
            </div>
          ) : (
            <span className="text-xs text-gray-400 italic">No entities</span>
          )}
        </div>
      )}

      {/* Raw rule JSON */}
      <details>
        <summary className="text-xs text-gray-400 cursor-pointer">Full Rule JSON</summary>
        <div className="mt-2"><JsonViewer data={rule} maxDepth={3} /></div>
      </details>
    </div>
  );
}
