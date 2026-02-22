import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';

type ConvergenceSettings = Record<string, number | boolean>;

interface SourceStrategyRow {
  id: number;
  host: string;
  display_name: string;
  source_type: string;
  default_tier: number;
  discovery_method: string;
  search_pattern: string | null;
  priority: number;
  enabled: number;
  category_scope: string | null;
  notes: string | null;
}

const KNOB_GROUPS = [
  {
    label: 'Convergence Loop',
    knobs: [
      { key: 'convergenceMaxRounds', label: 'Max Rounds', type: 'int', min: 1, max: 12 },
      { key: 'convergenceNoProgressLimit', label: 'No-Progress Streak Limit', type: 'int', min: 1, max: 6 },
      { key: 'convergenceMaxLowQualityRounds', label: 'Max Low-Quality Rounds', type: 'int', min: 1, max: 6 },
      { key: 'convergenceLowQualityConfidence', label: 'Low Quality Confidence Threshold', type: 'float', min: 0, max: 1, step: 0.05 },
      { key: 'convergenceMaxDispatchQueries', label: 'Max Dispatch Queries/Round', type: 'int', min: 5, max: 50 },
      { key: 'convergenceMaxTargetFields', label: 'Max Target Fields/Round', type: 'int', min: 5, max: 80 },
    ],
  },
  {
    label: 'NeedSet Identity Caps',
    knobs: [
      { key: 'needsetCapIdentityLocked', label: 'Locked', type: 'float', min: 0.5, max: 1, step: 0.05 },
      { key: 'needsetCapIdentityProvisional', label: 'Provisional', type: 'float', min: 0.5, max: 0.9, step: 0.01 },
      { key: 'needsetCapIdentityConflict', label: 'Conflict', type: 'float', min: 0.2, max: 0.6, step: 0.01 },
      { key: 'needsetCapIdentityUnlocked', label: 'Unlocked', type: 'float', min: 0.3, max: 0.8, step: 0.01 },
    ],
  },
  {
    label: 'Consensus Scoring — LLM Weights',
    knobs: [
      { key: 'consensusLlmWeightTier1', label: 'LLM Tier 1 (Manufacturer)', type: 'float', min: 0.3, max: 0.9, step: 0.05 },
      { key: 'consensusLlmWeightTier2', label: 'LLM Tier 2 (Lab Review)', type: 'float', min: 0.2, max: 0.7, step: 0.05 },
      { key: 'consensusLlmWeightTier3', label: 'LLM Tier 3 (Retail)', type: 'float', min: 0.1, max: 0.4, step: 0.05 },
      { key: 'consensusLlmWeightTier4', label: 'LLM Tier 4 (Unverified)', type: 'float', min: 0.05, max: 0.3, step: 0.05 },
    ],
  },
  {
    label: 'Consensus Scoring — Tier Weights',
    knobs: [
      { key: 'consensusTier1Weight', label: 'Tier 1 Weight', type: 'float', min: 0.8, max: 1, step: 0.05 },
      { key: 'consensusTier2Weight', label: 'Tier 2 Weight', type: 'float', min: 0.5, max: 0.9, step: 0.05 },
      { key: 'consensusTier3Weight', label: 'Tier 3 Weight', type: 'float', min: 0.2, max: 0.6, step: 0.05 },
      { key: 'consensusTier4Weight', label: 'Tier 4 Weight', type: 'float', min: 0.1, max: 0.4, step: 0.05 },
    ],
  },
  {
    label: 'SERP Triage',
    knobs: [
      { key: 'serpTriageMinScore', label: 'Min Score Threshold', type: 'int', min: 1, max: 10 },
      { key: 'serpTriageMaxUrls', label: 'Max URLs After Triage', type: 'int', min: 5, max: 30 },
      { key: 'serpTriageEnabled', label: 'Triage Enabled', type: 'bool' },
    ],
  },
  {
    label: 'Retrieval',
    knobs: [
      { key: 'retrievalMaxHitsPerField', label: 'Max Hits Per Field', type: 'int', min: 5, max: 50 },
      { key: 'retrievalMaxPrimeSources', label: 'Max Prime Sources', type: 'int', min: 3, max: 20 },
      { key: 'retrievalIdentityFilterEnabled', label: 'Identity Filter Enabled', type: 'bool' },
    ],
  },
] as const;

const cardCls = 'bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4';
const inputCls = 'px-2 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 w-full';

function KnobInput({
  knob,
  value,
  onChange,
}: {
  knob: (typeof KNOB_GROUPS)[number]['knobs'][number];
  value: number | boolean | undefined;
  onChange: (v: number | boolean) => void;
}) {
  if (knob.type === 'bool') {
    return (
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{knob.label}</span>
      </label>
    );
  }

  const numValue = typeof value === 'number' ? value : 0;
  const step = 'step' in knob ? knob.step : 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-gray-500">{knob.label}</span>
        <span className="text-[11px] font-mono text-gray-700 dark:text-gray-300">
          {knob.type === 'float' ? numValue.toFixed(2) : numValue}
        </span>
      </div>
      <input
        type="range"
        className="w-full"
        min={knob.min}
        max={knob.max}
        step={step}
        value={numValue}
        onChange={(e) => {
          const parsed = knob.type === 'float'
            ? Number.parseFloat(e.target.value)
            : Number.parseInt(e.target.value, 10);
          onChange(Number.isFinite(parsed) ? parsed : 0);
        }}
      />
      <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
        <span>{knob.min}</span>
        <span>{knob.max}</span>
      </div>
    </div>
  );
}

function SourceStrategyTable() {
  const queryClient = useQueryClient();
  const { data: rows, isLoading } = useQuery({
    queryKey: ['source-strategy'],
    queryFn: () => api.get<SourceStrategyRow[]>('/source-strategy'),
  });

  const toggleMut = useMutation({
    mutationFn: (row: SourceStrategyRow) =>
      api.put<SourceStrategyRow>(`/source-strategy/${row.id}`, { enabled: row.enabled ? 0 : 1 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['source-strategy'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.del(`/source-strategy/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['source-strategy'] }),
  });

  if (isLoading) return <p className="text-xs text-gray-500">Loading sources...</p>;
  if (!rows || rows.length === 0) return <p className="text-xs text-gray-500">No source strategies configured.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500">
            <th className="py-2 px-2">Host</th>
            <th className="py-2 px-2">Name</th>
            <th className="py-2 px-2">Type</th>
            <th className="py-2 px-2">Tier</th>
            <th className="py-2 px-2">Method</th>
            <th className="py-2 px-2">Priority</th>
            <th className="py-2 px-2">Enabled</th>
            <th className="py-2 px-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
              <td className="py-1.5 px-2 font-mono">{row.host}</td>
              <td className="py-1.5 px-2">{row.display_name}</td>
              <td className="py-1.5 px-2">
                <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-[10px]">{row.source_type}</span>
              </td>
              <td className="py-1.5 px-2">{row.default_tier}</td>
              <td className="py-1.5 px-2">{row.discovery_method}</td>
              <td className="py-1.5 px-2">{row.priority}</td>
              <td className="py-1.5 px-2">
                <button
                  onClick={() => toggleMut.mutate(row)}
                  className={`px-2 py-0.5 rounded text-[10px] border ${
                    row.enabled
                      ? 'border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800'
                      : 'border-gray-300 text-gray-500 bg-gray-50 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600'
                  }`}
                >
                  {row.enabled ? 'ON' : 'OFF'}
                </button>
              </td>
              <td className="py-1.5 px-2">
                <button
                  onClick={() => { if (confirm(`Delete ${row.host}?`)) deleteMut.mutate(row.id); }}
                  className="text-[10px] text-red-500 hover:text-red-700"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PipelineSettingsPage() {
  const [settings, setSettings] = useState<ConvergenceSettings>({});
  const [dirty, setDirty] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['convergence-settings'],
    queryFn: () => api.get<ConvergenceSettings>('/convergence-settings'),
  });

  useEffect(() => {
    if (data) {
      setSettings(data);
      setDirty(false);
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: (payload: ConvergenceSettings) =>
      api.put<{ ok: boolean; applied: ConvergenceSettings }>('/convergence-settings', payload),
    onSuccess: () => {
      setDirty(false);
      refetch();
    },
  });

  function updateKnob(key: string, value: number | boolean) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  return (
    <div className="space-y-4">
      <div className={cardCls}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Pipeline Settings</h2>
            <p className="text-xs text-gray-500 mt-1">
              Convergence loop, consensus scoring, SERP triage, and retrieval knobs.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Reload
            </button>
            <button
              onClick={() => saveMut.mutate(settings)}
              disabled={!dirty || saveMut.isPending}
              className="px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saveMut.isPending ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
        {dirty && <p className="text-[11px] text-amber-600 mt-2">Unsaved changes</p>}
      </div>

      {isLoading ? (
        <p className="text-xs text-gray-500">Loading settings...</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {KNOB_GROUPS.map((group) => (
            <div key={group.label} className={cardCls}>
              <h3 className="text-xs font-semibold mb-3">{group.label}</h3>
              <div className="space-y-3">
                {group.knobs.map((knob) => (
                  <KnobInput
                    key={knob.key}
                    knob={knob}
                    value={settings[knob.key] as number | boolean | undefined}
                    onChange={(v) => updateKnob(knob.key, v)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={cardCls}>
        <h3 className="text-xs font-semibold mb-3">Source Strategy</h3>
        <p className="text-[11px] text-gray-500 mb-3">
          Configurable source table — replaces hardcoded adapters. LLM predicts URLs for enabled sources.
        </p>
        <SourceStrategyTable />
      </div>
    </div>
  );
}
