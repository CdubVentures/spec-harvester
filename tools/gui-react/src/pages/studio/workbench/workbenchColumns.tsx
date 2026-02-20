// ── Column defs, presets, cell renderers for the workbench table ──────
import type { ColumnDef } from '@tanstack/react-table';
import type { WorkbenchRow, ColumnPreset } from './workbenchTypes';

// ── Parse template options ───────────────────────────────────────────
const PARSE_TEMPLATE_OPTIONS = [
  '', 'text_field', 'number_with_unit', 'boolean_yes_no_unk',
  'component_reference', 'date_field', 'url_field',
  'list_of_numbers_with_unit', 'list_numbers_or_ranges_with_unit',
  'list_of_tokens_delimited', 'token_list', 'text_block',
];

const REQUIRED_LEVEL_OPTIONS = [
  'identity', 'required', 'critical', 'expected', 'optional', 'editorial', 'commerce',
];

const ENUM_POLICY_OPTIONS = ['open', 'closed', 'open_prefer_known'];

const AI_MODE_OPTIONS = ['', 'off', 'advisory', 'planner', 'judge'];
const AI_MODEL_STRATEGY_OPTIONS = ['auto', 'force_fast', 'force_deep'];

// ── AI Mode badge colors ────────────────────────────────────────────
const aiModeBadge: Record<string, string> = {
  off: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  advisory: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  planner: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  judge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
};

function AiModeBadge({ value }: { value: string }) {
  if (!value) return <span className="text-gray-300 text-xs italic">auto</span>;
  return (
    <span className={`px-1.5 py-0.5 text-[11px] rounded font-medium ${aiModeBadge[value] || aiModeBadge.off}`}>
      {value}
    </span>
  );
}

// ── Badge colors ─────────────────────────────────────────────────────
const reqBadge: Record<string, string> = {
  identity: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  required: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  expected: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  optional: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  editorial: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  commerce: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

// ── Cell Renderers ───────────────────────────────────────────────────

function FieldNameCell({ row }: { row: WorkbenchRow }) {
  return (
    <div className="leading-tight">
      <div className="flex items-center gap-1">
        <span className="text-sm font-medium truncate">{row.displayName}</span>
        {row.draftDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" title="Modified" />}
      </div>
      <div className="text-[10px] text-gray-400 font-mono truncate">{row.key}</div>
    </div>
  );
}

function CompileStatusDot({ row }: { row: WorkbenchRow }) {
  if (row.hasErrors) {
    return (
      <span title={row.compileMessages.join('\n')} className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />
    );
  }
  if (row.hasWarnings) {
    return (
      <span title={row.compileMessages.join('\n')} className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-500" />
    );
  }
  return <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />;
}

function BooleanBadge({ value }: { value: boolean }) {
  return (
    <span className={`px-1.5 py-0.5 text-[11px] rounded font-medium ${
      value
        ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
        : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
    }`}>
      {value ? 'Yes' : 'No'}
    </span>
  );
}

function RequiredBadge({ value }: { value: string }) {
  return (
    <span className={`px-1.5 py-0.5 text-[11px] rounded font-medium ${reqBadge[value] || reqBadge.optional}`}>
      {value}
    </span>
  );
}

// ── Inline editable cell wrappers ────────────────────────────────────
export function InlineSelectCell({
  value,
  options,
  editingCell,
  cellId,
  onStartEdit,
  onCommit,
  renderValue,
}: {
  value: string;
  options: string[];
  editingCell: { key: string; column: string } | null;
  cellId: { key: string; column: string };
  onStartEdit: (id: { key: string; column: string }) => void;
  onCommit: (val: string) => void;
  renderValue?: (val: string) => React.ReactNode;
}) {
  const isEditing = editingCell?.key === cellId.key && editingCell?.column === cellId.column;
  if (isEditing) {
    return (
      <select
        autoFocus
        className="px-1 py-0.5 text-xs border border-accent rounded bg-white dark:bg-gray-700 w-full"
        value={value}
        onChange={(e) => onCommit(e.target.value)}
        onBlur={() => onCommit(value)}
      >
        {options.map((o) => <option key={o} value={o}>{o || '(none)'}</option>)}
      </select>
    );
  }
  return (
    <button
      className="text-left w-full hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-1 py-0.5 text-xs cursor-pointer"
      onClick={(e) => { e.stopPropagation(); onStartEdit(cellId); }}
    >
      {renderValue ? renderValue(value) : value || '\u2014'}
    </button>
  );
}

export function InlineBooleanCell({
  value,
  onToggle,
}: {
  value: boolean;
  onToggle: () => void;
}) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onToggle(); }} className="cursor-pointer">
      <BooleanBadge value={value} />
    </button>
  );
}

// ── Column definitions factory ───────────────────────────────────────
export function buildColumns(
  editingCell: { key: string; column: string } | null,
  onStartEdit: (id: { key: string; column: string }) => void,
  onInlineCommit: (key: string, column: string, value: unknown) => void,
  rowSelection: Record<string, boolean>,
  onToggleRow: (key: string) => void,
  onToggleAll: () => void,
  allSelected: boolean,
): ColumnDef<WorkbenchRow, unknown>[] {
  return [
    // Select checkbox
    {
      id: 'select',
      size: 36,
      header: () => (
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onToggleAll}
          className="rounded border-gray-300"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={!!rowSelection[row.original.key]}
          onChange={() => onToggleRow(row.original.key)}
          onClick={(e) => e.stopPropagation()}
          className="rounded border-gray-300"
        />
      ),
    },

    // Status dot
    {
      id: 'status',
      header: '',
      size: 32,
      cell: ({ row }) => <CompileStatusDot row={row.original} />,
    },

    // Group (always pinned)
    {
      accessorKey: 'group',
      header: 'Group',
      size: 110,
      cell: ({ getValue }) => (
        <span className="text-xs text-gray-500 truncate">{getValue() as string}</span>
      ),
    },

    // Display name (always pinned, shows dirty dot)
    {
      accessorKey: 'displayName',
      header: 'Field',
      size: 170,
      cell: ({ row }) => <FieldNameCell row={row.original} />,
    },

    // Required level (inline editable)
    {
      accessorKey: 'requiredLevel',
      header: 'Required',
      size: 100,
      cell: ({ row }) => (
        <InlineSelectCell
          value={row.original.requiredLevel}
          options={REQUIRED_LEVEL_OPTIONS}
          editingCell={editingCell}
          cellId={{ key: row.original.key, column: 'requiredLevel' }}
          onStartEdit={onStartEdit}
          onCommit={(v) => onInlineCommit(row.original.key, 'requiredLevel', v)}
          renderValue={(v) => <RequiredBadge value={v} />}
        />
      ),
    },

    // Availability
    { accessorKey: 'availability', header: 'Availability', size: 100 },

    // Difficulty
    { accessorKey: 'difficulty', header: 'Difficulty', size: 90 },

    // Effort
    { accessorKey: 'effort', header: 'Effort', size: 60 },

    // Contract type
    {
      accessorKey: 'contractType',
      header: 'Type',
      size: 80,
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() as string}</span>,
    },

    // Contract shape
    {
      accessorKey: 'contractShape',
      header: 'Shape',
      size: 75,
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() as string}</span>,
    },

    // Contract unit
    {
      accessorKey: 'contractUnit',
      header: 'Unit',
      size: 60,
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return v ? <span className="font-mono text-xs">{v}</span> : <span className="text-gray-300">\u2014</span>;
      },
    },

    // Unknown token
    {
      accessorKey: 'unknownToken',
      header: 'Unk Token',
      size: 75,
      cell: ({ getValue }) => <span className="font-mono text-xs text-gray-500">{getValue() as string}</span>,
    },

    // Parse template (inline editable)
    {
      accessorKey: 'parseTemplate',
      header: 'Parse Template',
      size: 160,
      cell: ({ row }) => (
        <InlineSelectCell
          value={row.original.parseTemplate}
          options={PARSE_TEMPLATE_OPTIONS}
          editingCell={editingCell}
          cellId={{ key: row.original.key, column: 'parseTemplate' }}
          onStartEdit={onStartEdit}
          onCommit={(v) => onInlineCommit(row.original.key, 'parseTemplate', v)}
        />
      ),
    },

    // Parse unit
    {
      accessorKey: 'parseUnit',
      header: 'Parse Unit',
      size: 80,
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return v ? <span className="font-mono text-xs">{v}</span> : <span className="text-gray-300">\u2014</span>;
      },
    },

    // Unit accepts
    {
      accessorKey: 'unitAccepts',
      header: 'Unit Accepts',
      size: 140,
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return v ? <span className="text-xs text-gray-500 truncate">{v}</span> : <span className="text-gray-300">\u2014</span>;
      },
    },

    // Allow unitless
    {
      accessorKey: 'allowUnitless',
      header: 'Unitless',
      size: 70,
      cell: ({ getValue }) => <BooleanBadge value={getValue() as boolean} />,
    },

    // Allow ranges
    {
      accessorKey: 'allowRanges',
      header: 'Ranges',
      size: 70,
      cell: ({ getValue }) => <BooleanBadge value={getValue() as boolean} />,
    },

    // Strict unit required
    {
      accessorKey: 'strictUnitRequired',
      header: 'Strict Unit',
      size: 80,
      cell: ({ getValue }) => <BooleanBadge value={getValue() as boolean} />,
    },

    // Enum policy (inline editable)
    {
      accessorKey: 'enumPolicy',
      header: 'Enum Policy',
      size: 120,
      cell: ({ row }) => (
        <InlineSelectCell
          value={row.original.enumPolicy}
          options={ENUM_POLICY_OPTIONS}
          editingCell={editingCell}
          cellId={{ key: row.original.key, column: 'enumPolicy' }}
          onStartEdit={onStartEdit}
          onCommit={(v) => onInlineCommit(row.original.key, 'enumPolicy', v)}
        />
      ),
    },

    // Enum source
    {
      accessorKey: 'enumSource',
      header: 'Enum Source',
      size: 140,
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return v ? <span className="font-mono text-xs truncate">{v}</span> : <span className="text-gray-300">\u2014</span>;
      },
    },

    // Match strategy
    {
      accessorKey: 'matchStrategy',
      header: 'Match',
      size: 70,
      cell: ({ getValue }) => <span className="text-xs">{getValue() as string}</span>,
    },

    // Known values count
    {
      accessorKey: 'knownValuesCount',
      header: 'KV Count',
      size: 70,
      cell: ({ getValue }) => {
        const n = getValue() as number;
        return n > 0
          ? <span className="text-xs font-medium text-blue-600 dark:text-blue-400">{n}</span>
          : <span className="text-gray-300">0</span>;
      },
    },

    // Evidence required
    {
      accessorKey: 'evidenceRequired',
      header: 'Evidence',
      size: 70,
      cell: ({ getValue }) => <BooleanBadge value={getValue() as boolean} />,
    },

    // Min evidence refs
    { accessorKey: 'minEvidenceRefs', header: 'Min Refs', size: 65 },

    // Tier preference
    {
      accessorKey: 'tierPreference',
      header: 'Tiers',
      size: 120,
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return v ? <span className="text-xs text-gray-500 truncate">{v}</span> : <span className="text-gray-300">\u2014</span>;
      },
    },

    // Conflict policy
    {
      accessorKey: 'conflictPolicy',
      header: 'Conflict',
      size: 130,
      cell: ({ getValue }) => <span className="text-xs font-mono truncate">{getValue() as string}</span>,
    },

    // Publish gate (inline toggle)
    {
      accessorKey: 'publishGate',
      header: 'Pub Gate',
      size: 75,
      cell: ({ row }) => (
        <InlineBooleanCell
          value={row.original.publishGate}
          onToggle={() => onInlineCommit(row.original.key, 'publishGate', !row.original.publishGate)}
        />
      ),
    },

    // Block publish when unk
    {
      accessorKey: 'blockPublishWhenUnk',
      header: 'Block Unk',
      size: 80,
      cell: ({ getValue }) => <BooleanBadge value={getValue() as boolean} />,
    },

    // AI Mode (inline editable)
    {
      accessorKey: 'aiMode',
      header: 'AI Mode',
      size: 95,
      cell: ({ row }) => (
        <InlineSelectCell
          value={row.original.aiMode}
          options={AI_MODE_OPTIONS}
          editingCell={editingCell}
          cellId={{ key: row.original.key, column: 'aiMode' }}
          onStartEdit={onStartEdit}
          onCommit={(v) => onInlineCommit(row.original.key, 'aiMode', v)}
          renderValue={(v) => <AiModeBadge value={v} />}
        />
      ),
    },

    // AI Model Strategy
    {
      accessorKey: 'aiModelStrategy',
      header: 'AI Model',
      size: 100,
      cell: ({ row }) => (
        <InlineSelectCell
          value={row.original.aiModelStrategy}
          options={AI_MODEL_STRATEGY_OPTIONS}
          editingCell={editingCell}
          cellId={{ key: row.original.key, column: 'aiModelStrategy' }}
          onStartEdit={onStartEdit}
          onCommit={(v) => onInlineCommit(row.original.key, 'aiModelStrategy', v)}
        />
      ),
    },

    // AI Max Calls
    {
      accessorKey: 'aiMaxCalls',
      header: 'AI Calls',
      size: 65,
      cell: ({ getValue }) => {
        const n = getValue() as number;
        return n > 0
          ? <span className="text-xs font-medium">{n}</span>
          : <span className="text-gray-300 text-xs italic">auto</span>;
      },
    },

    // Query terms count
    { accessorKey: 'queryTermsCount', header: 'Q Terms', size: 65 },

    // Domain hints count
    { accessorKey: 'domainHintsCount', header: 'D Hints', size: 65 },

    // Content types count
    { accessorKey: 'contentTypesCount', header: 'C Types', size: 65 },

    // Component type
    {
      accessorKey: 'componentType',
      header: 'Component',
      size: 90,
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return v ? (
          <span className="px-1.5 py-0.5 text-[11px] rounded font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
            {v}
          </span>
        ) : <span className="text-gray-300">\u2014</span>;
      },
    },

    // UI input control
    {
      accessorKey: 'uiInputControl',
      header: 'Input',
      size: 90,
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() as string}</span>,
    },

    // UI order
    { accessorKey: 'uiOrder', header: 'Order', size: 55 },

    // Draft dirty indicator
    {
      accessorKey: 'draftDirty',
      header: 'Dirty',
      size: 50,
      cell: ({ getValue }) => (getValue() as boolean)
        ? <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" title="Modified" />
        : <span className="text-gray-300">\u2014</span>,
    },
  ];
}

// ── Column preset maps ───────────────────────────────────────────────
const ALWAYS_VISIBLE = ['select', 'status', 'group', 'displayName'];

const PRESET_COLUMNS: Record<ColumnPreset, string[]> = {
  minimal: [
    ...ALWAYS_VISIBLE,
    'requiredLevel', 'contractType', 'parseTemplate', 'enumPolicy', 'publishGate',
  ],
  contract: [
    ...ALWAYS_VISIBLE,
    'requiredLevel', 'contractType', 'contractShape', 'contractUnit', 'unknownToken',
    'availability', 'difficulty', 'effort', 'publishGate', 'blockPublishWhenUnk',
    'aiMode', 'aiMaxCalls',
  ],
  parsing: [
    ...ALWAYS_VISIBLE,
    'parseTemplate', 'parseUnit', 'unitAccepts', 'allowUnitless', 'allowRanges', 'strictUnitRequired',
  ],
  enums: [
    ...ALWAYS_VISIBLE,
    'enumPolicy', 'enumSource', 'matchStrategy', 'knownValuesCount', 'parseTemplate',
  ],
  evidence: [
    ...ALWAYS_VISIBLE,
    'evidenceRequired', 'minEvidenceRefs', 'tierPreference', 'conflictPolicy',
    'publishGate', 'blockPublishWhenUnk',
  ],
  search: [
    ...ALWAYS_VISIBLE,
    'queryTermsCount', 'domainHintsCount', 'contentTypesCount', 'componentType',
  ],
  debug: [
    ...ALWAYS_VISIBLE,
    'requiredLevel', 'contractType', 'parseTemplate', 'enumPolicy', 'enumSource',
    'componentType', 'uiInputControl', 'uiOrder', 'conflictPolicy', 'draftDirty',
    'aiMode', 'aiModelStrategy', 'aiMaxCalls',
  ],
  all: [], // empty = show all
};

export function getPresetVisibility(preset: ColumnPreset): Record<string, boolean> | undefined {
  if (preset === 'all') return undefined; // show everything
  const visible = new Set(PRESET_COLUMNS[preset]);
  const vis: Record<string, boolean> = {};
  for (const { id } of ALL_COLUMN_IDS_WITH_LABELS) {
    vis[id] = visible.has(id);
  }
  // Always visible columns are always true
  for (const id of ALWAYS_VISIBLE) {
    vis[id] = true;
  }
  return vis;
}

export const ALL_COLUMN_IDS_WITH_LABELS: { id: string; label: string }[] = [
  { id: 'requiredLevel', label: 'Required Level' },
  { id: 'availability', label: 'Availability' },
  { id: 'difficulty', label: 'Difficulty' },
  { id: 'effort', label: 'Effort' },
  { id: 'contractType', label: 'Type' },
  { id: 'contractShape', label: 'Shape' },
  { id: 'contractUnit', label: 'Unit' },
  { id: 'unknownToken', label: 'Unk Token' },
  { id: 'parseTemplate', label: 'Parse Template' },
  { id: 'parseUnit', label: 'Parse Unit' },
  { id: 'unitAccepts', label: 'Unit Accepts' },
  { id: 'allowUnitless', label: 'Allow Unitless' },
  { id: 'allowRanges', label: 'Allow Ranges' },
  { id: 'strictUnitRequired', label: 'Strict Unit' },
  { id: 'enumPolicy', label: 'Enum Policy' },
  { id: 'enumSource', label: 'Enum Source' },
  { id: 'matchStrategy', label: 'Match Strategy' },
  { id: 'knownValuesCount', label: 'KV Count' },
  { id: 'evidenceRequired', label: 'Evidence Req' },
  { id: 'minEvidenceRefs', label: 'Min Refs' },
  { id: 'tierPreference', label: 'Tiers' },
  { id: 'conflictPolicy', label: 'Conflict Policy' },
  { id: 'publishGate', label: 'Pub Gate' },
  { id: 'blockPublishWhenUnk', label: 'Block Unk' },
  { id: 'aiMode', label: 'AI Mode' },
  { id: 'aiModelStrategy', label: 'AI Model' },
  { id: 'aiMaxCalls', label: 'AI Calls' },
  { id: 'queryTermsCount', label: 'Query Terms' },
  { id: 'domainHintsCount', label: 'Domain Hints' },
  { id: 'contentTypesCount', label: 'Content Types' },
  { id: 'componentType', label: 'Component' },
  { id: 'uiInputControl', label: 'Input Control' },
  { id: 'uiOrder', label: 'Order' },
  { id: 'draftDirty', label: 'Dirty' },
];

export const PRESET_LABELS: { id: ColumnPreset; label: string }[] = [
  { id: 'minimal', label: 'Minimal' },
  { id: 'contract', label: 'Contract' },
  { id: 'parsing', label: 'Parsing' },
  { id: 'enums', label: 'Enums' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'search', label: 'Search' },
  { id: 'debug', label: 'Debug' },
  { id: 'all', label: 'All' },
];
