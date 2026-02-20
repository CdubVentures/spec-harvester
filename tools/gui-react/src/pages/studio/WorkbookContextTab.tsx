import { useState, useMemo } from 'react';
import { DataTable } from '../../components/common/DataTable';
import { JsonViewer } from '../../components/common/JsonViewer';
import { Spinner } from '../../components/common/Spinner';
import type { ColumnDef } from '@tanstack/react-table';
import type {
  WorkbookContextResponse,
  WorkbookContextKeyRow,
  WorkbookContextProduct,
  WorkbookMap,
  ComponentDbResponse,
} from '../../types/studio';

// ── Styles ───────────────────────────────────────────────────────────
const sectionCls = 'bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4';
const btnPrimary = 'px-4 py-2 text-sm bg-accent text-white rounded hover:bg-blue-600 disabled:opacity-50';
const statBadge = 'px-2 py-0.5 rounded text-xs font-medium';

// ── Badge helpers ────────────────────────────────────────────────────
function GreenCheck({ title }: { title?: string }) {
  return <span className="text-green-500" title={title || 'Yes'}>&#10003;</span>;
}
function Badge({ color, children }: { color: 'amber' | 'red' | 'gray' | 'green' | 'blue'; children: React.ReactNode }) {
  const colors = {
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    red: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    gray: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    green: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  };
  return <span className={`${statBadge} ${colors[color]}`}>{children}</span>;
}

// ── Column defs: Keys ────────────────────────────────────────────────
interface KeyRowDisplay extends WorkbookContextKeyRow {
  inFR: boolean;
  inGenerated: boolean;
  warnings: string[];
}

const keyColumns: ColumnDef<KeyRowDisplay, unknown>[] = [
  { accessorKey: 'row', header: 'Row #', size: 60 },
  { accessorKey: 'group', header: 'Group', size: 140 },
  {
    accessorKey: 'key',
    header: 'Key',
    size: 200,
    cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() as string}</span>,
  },
  {
    accessorKey: 'inFR',
    header: 'In FR',
    size: 60,
    cell: ({ getValue }) => (getValue() ? <GreenCheck title="In field_rules" /> : null),
  },
  {
    accessorKey: 'inGenerated',
    header: 'Generated',
    size: 70,
    cell: ({ getValue }) => (getValue() ? <GreenCheck title="In generated field_rules.json" /> : null),
  },
  {
    accessorKey: 'warnings',
    header: 'Warnings',
    size: 220,
    cell: ({ getValue }) => {
      const warnings = getValue() as string[];
      if (!warnings.length) return null;
      return (
        <div className="flex flex-wrap gap-1">
          {warnings.map((w, i) => (
            <Badge key={i} color={w === 'blank' ? 'red' : w === 'duplicate' ? 'amber' : 'gray'}>{w}</Badge>
          ))}
        </div>
      );
    },
  },
];

// ── Column defs: Products ────────────────────────────────────────────
interface ProductDisplay extends WorkbookContextProduct {
  warnings: string[];
}

const productColumns: ColumnDef<ProductDisplay, unknown>[] = [
  {
    accessorKey: 'column',
    header: 'Col',
    size: 55,
    cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() as string}</span>,
  },
  { accessorKey: 'brand', header: 'Brand', size: 120 },
  { accessorKey: 'model', header: 'Model', size: 150 },
  { accessorKey: 'variant', header: 'Variant', size: 100 },
  {
    accessorKey: 'id',
    header: 'ID#',
    size: 55,
    cell: ({ getValue }) => {
      const v = getValue() as string | number;
      return v ? <span className="font-mono text-xs">{v}</span> : null;
    },
  },
  {
    accessorKey: 'identifier',
    header: 'Identifier',
    size: 90,
    cell: ({ getValue }) => {
      const v = getValue() as string;
      return v ? <span className="font-mono text-xs" title={v}>{v.length > 6 ? v.slice(0, 6) + '...' : v}</span> : null;
    },
  },
  {
    accessorKey: 'productId',
    header: 'Product ID',
    size: 200,
    cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() as string}</span>,
  },
  {
    id: 'badges',
    header: 'Status',
    size: 130,
    cell: ({ row }) => {
      const p = row.original;
      return (
        <div className="flex flex-wrap gap-1">
          {p.inCatalog && <Badge color="green">in catalog</Badge>}
          {p.hasOutput && <Badge color="blue">has output</Badge>}
        </div>
      );
    },
  },
  {
    accessorKey: 'warnings',
    header: 'Warnings',
    size: 140,
    cell: ({ getValue }) => {
      const warnings = getValue() as string[];
      if (!warnings.length) return null;
      return (
        <div className="flex flex-wrap gap-1">
          {warnings.map((w, i) => (
            <Badge key={i} color="amber">{w}</Badge>
          ))}
        </div>
      );
    },
  },
];

// ── Props ────────────────────────────────────────────────────────────
interface Props {
  contextData: WorkbookContextResponse | undefined;
  isLoading: boolean;
  fieldRulesKeys: string[];
  knownValues: Record<string, string[]>;
  componentDb: ComponentDbResponse;
  wbMap: WorkbookMap;
  onEditMapping: () => void;
}

// ── Component ────────────────────────────────────────────────────────
export function WorkbookContextTab({
  contextData,
  isLoading,
  fieldRulesKeys,
  knownValues,
  componentDb,
  wbMap,
  onEditMapping,
}: Props) {
  const [devMode, setDevMode] = useState(false);
  const [selectedEnum, setSelectedEnum] = useState('');

  // ── Key rows with warnings + generated artifact mismatch ───────────
  const generatedFieldKeys = contextData?.generatedFieldKeys || [];
  const generatedSet = useMemo(() => new Set(generatedFieldKeys), [generatedFieldKeys]);

  const keyRowsDisplay = useMemo<KeyRowDisplay[]>(() => {
    if (!contextData?.keys?.length) return [];
    const frSet = new Set(fieldRulesKeys);
    const hasFR = frSet.size > 0;
    const hasGenerated = generatedSet.size > 0;
    const seenKeys = new Map<string, number>();
    for (const k of contextData.keys) {
      seenKeys.set(k.key, (seenKeys.get(k.key) || 0) + 1);
    }
    return contextData.keys.map((k) => {
      const warnings: string[] = [];
      if (!k.key) warnings.push('blank');
      if (k.key && (seenKeys.get(k.key) || 0) > 1) warnings.push('duplicate');
      if (hasFR && k.key && !frSet.has(k.key)) warnings.push('not in FR');
      if (hasGenerated && k.key && !generatedSet.has(k.key)) warnings.push('not in generated');
      return {
        ...k,
        inFR: hasFR && frSet.has(k.key),
        inGenerated: hasGenerated && generatedSet.has(k.key),
        warnings,
      };
    });
  }, [contextData?.keys, fieldRulesKeys, generatedSet]);

  // Keys in generated but NOT in workbook (artifact mismatch)
  const generatedOnlyKeys = useMemo(() => {
    if (!generatedSet.size || !contextData?.keys?.length) return [];
    const wbKeySet = new Set(contextData.keys.map((k) => k.key));
    return [...generatedSet].filter((k) => !wbKeySet.has(k)).sort();
  }, [generatedSet, contextData?.keys]);

  const keyWarningCount = useMemo(
    () => keyRowsDisplay.filter((r) => r.warnings.length > 0).length,
    [keyRowsDisplay],
  );
  const keyInFRCount = useMemo(
    () => keyRowsDisplay.filter((r) => r.inFR).length,
    [keyRowsDisplay],
  );

  // ── Product rows with warnings ─────────────────────────────────────
  const productRowsDisplay = useMemo<ProductDisplay[]>(() => {
    if (!contextData?.products?.length) return [];
    const comboCounts = new Map<string, number>();
    for (const p of contextData.products) {
      const combo = `${p.brand}|${p.model}|${p.variant}`;
      comboCounts.set(combo, (comboCounts.get(combo) || 0) + 1);
    }
    return contextData.products.map((p) => {
      const combo = `${p.brand}|${p.model}|${p.variant}`;
      const warnings: string[] = [];
      if ((comboCounts.get(combo) || 0) > 1) warnings.push('duplicate combo');
      return { ...p, warnings };
    });
  }, [contextData?.products]);

  const uniqueBrandCount = useMemo(() => {
    if (!contextData?.products?.length) return 0;
    return new Set(contextData.products.map((p) => p.brand).filter(Boolean)).size;
  }, [contextData?.products]);

  const productDuplicateCount = useMemo(
    () => productRowsDisplay.filter((r) => r.warnings.length > 0).length,
    [productRowsDisplay],
  );

  const inCatalogCount = useMemo(
    () => (contextData?.products || []).filter((p) => p.inCatalog).length,
    [contextData?.products],
  );

  const hasOutputCount = useMemo(
    () => (contextData?.products || []).filter((p) => p.hasOutput).length,
    [contextData?.products],
  );

  // ── Enum: 3-section split ──────────────────────────────────────────
  const allEnumFields = useMemo(() => {
    const fieldSet = new Set<string>();
    for (const f of Object.keys(contextData?.enums || {})) fieldSet.add(f);
    for (const f of Object.keys(contextData?.draftEnumAdditions || {})) fieldSet.add(f);
    for (const f of Object.keys(contextData?.observedValues || {})) fieldSet.add(f);
    return [...fieldSet].sort();
  }, [contextData?.enums, contextData?.draftEnumAdditions, contextData?.observedValues]);

  const enumSections = useMemo(() => {
    if (!selectedEnum) return { canonical: [], manual: [], observed: [] };
    const canonical = contextData?.enums?.[selectedEnum] || [];
    const manual = contextData?.draftEnumAdditions?.[selectedEnum] || [];
    const observed = contextData?.observedValues?.[selectedEnum] || [];
    // Remove from observed anything already in canonical or manual
    const canonicalSet = new Set(canonical.map((v) => v.toLowerCase()));
    const manualSet = new Set(manual.map((v) => v.toLowerCase()));
    const filteredObserved = observed.filter(
      (v) => !canonicalSet.has(v.toLowerCase()) && !manualSet.has(v.toLowerCase()),
    );
    return { canonical, manual, observed: filteredObserved };
  }, [selectedEnum, contextData?.enums, contextData?.draftEnumAdditions, contextData?.observedValues]);

  // ── Loading / error states ─────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-gray-500">
        <Spinner className="h-4 w-4" /> Loading workbook context...
      </div>
    );
  }

  if (contextData?.error) {
    return (
      <div className={sectionCls}>
        <p className="text-sm text-amber-600 dark:text-amber-400">
          {contextData.error === 'no_workbook_path'
            ? 'No workbook path configured. Set it in the Mapping Studio tab.'
            : `Error: ${contextData.error}`}
        </p>
        <button onClick={onEditMapping} className={`${btnPrimary} mt-3`}>
          Edit Mapping &rarr;
        </button>
      </div>
    );
  }

  if (!contextData?.mapSummary) {
    return (
      <div className={sectionCls}>
        <p className="text-sm text-gray-400">No workbook context data available. Configure a workbook path in the Mapping Studio tab.</p>
        <button onClick={onEditMapping} className={`${btnPrimary} mt-3`}>
          Edit Mapping &rarr;
        </button>
      </div>
    );
  }

  const ms = contextData.mapSummary;

  return (
    <div className="space-y-6">
      {/* ── Panel A: Map Summary ─────────────────────────────────── */}
      <div className={sectionCls}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Map Summary</h3>
          <button onClick={onEditMapping} className="text-xs text-accent hover:underline">
            Edit Mapping &rarr;
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="col-span-2 md:col-span-4">
            <span className="text-gray-500">Workbook:</span>{' '}
            <span className="font-mono text-xs break-all">{ms.workbook_path}</span>
          </div>
          <div><span className="text-gray-500">Product sheet:</span> <span className="font-mono">{ms.product_sheet || '\u2014'}</span></div>
          <div><span className="text-gray-500">Layout:</span> {ms.layout}</div>
          <div><span className="text-gray-500">Brand/Model/Variant rows:</span> {ms.brand_row}/{ms.model_row}/{ms.variant_row}</div>
          <div><span className="text-gray-500">Key sheet:</span> <span className="font-mono">{ms.key_sheet || '\u2014'}</span></div>
          <div><span className="text-gray-500">Key column:</span> <span className="font-mono">{ms.key_column || '\u2014'}</span></div>
          <div><span className="text-gray-500">Key range:</span> <span className="font-mono">{ms.key_column}{ms.key_row_start}\u2013{ms.key_column}{ms.key_row_end || '(end)'}</span></div>
          <div><span className="text-gray-500">Value start col:</span> <span className="font-mono">{ms.value_col_start || '\u2014'}</span></div>
          <div><span className="text-gray-500">Tooltip source:</span> {ms.tooltip_source || '\u2014'}</div>
          <div><span className="text-gray-500">Component sources:</span> {ms.component_sources_count}</div>
          <div><span className="text-gray-500">Enum lists:</span> {ms.enum_lists_count}</div>
        </div>
      </div>

      {/* ── Panel B: Key List Preview ────────────────────────────── */}
      <div className={sectionCls}>
        <h3 className="text-sm font-semibold mb-2">Key List Preview</h3>
        <div className="flex flex-wrap gap-4 text-xs mb-3">
          <span>Total: <strong>{contextData.keys.length}</strong> keys</span>
          {fieldRulesKeys.length > 0 && (
            <span>In field_rules: <strong>{keyInFRCount}</strong></span>
          )}
          {generatedSet.size > 0 && (
            <span>In generated: <strong>{keyRowsDisplay.filter((r) => r.inGenerated).length}</strong></span>
          )}
          {keyWarningCount > 0 && (
            <span className="text-amber-600">Warnings: <strong>{keyWarningCount}</strong></span>
          )}
        </div>
        {keyRowsDisplay.length > 0 ? (
          <DataTable data={keyRowsDisplay} columns={keyColumns} searchable maxHeight="max-h-96" />
        ) : (
          <p className="text-xs text-gray-400">No keys extracted. Check key list configuration.</p>
        )}
        {generatedOnlyKeys.length > 0 && (
          <div className="mt-3 p-2 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-200 dark:border-amber-800">
            <div className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-1">
              {generatedOnlyKeys.length} keys in generated field_rules.json but NOT in workbook:
            </div>
            <div className="text-xs font-mono text-amber-600 dark:text-amber-400">
              {generatedOnlyKeys.join(', ')}
            </div>
          </div>
        )}
      </div>

      {/* ── Panel C: Product Columns Preview ──────────────────── */}
      <div className={sectionCls}>
        <h3 className="text-sm font-semibold mb-2">Product Columns Preview</h3>
        <div className="flex flex-wrap gap-4 text-xs mb-3">
          <span>Total: <strong>{contextData.products.length}</strong> products</span>
          <span>Unique brands: <strong>{uniqueBrandCount}</strong></span>
          {inCatalogCount > 0 && (
            <span className="text-green-600">In catalog: <strong>{inCatalogCount}</strong></span>
          )}
          {hasOutputCount > 0 && (
            <span className="text-blue-600">Has output: <strong>{hasOutputCount}</strong></span>
          )}
          {productDuplicateCount > 0 && (
            <span className="text-amber-600">Duplicates: <strong>{productDuplicateCount}</strong></span>
          )}
        </div>
        {productRowsDisplay.length > 0 ? (
          <DataTable data={productRowsDisplay} columns={productColumns} searchable maxHeight="max-h-96" />
        ) : (
          <p className="text-xs text-gray-400">No product columns extracted. Check product table configuration.</p>
        )}
      </div>

      {/* ── Panel D: Enum + Component Preview ─────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Enum sub-panel */}
        <div className={sectionCls}>
          <h3 className="text-sm font-semibold mb-2">Enum Lists</h3>
          <div className="text-xs text-gray-500 mb-2">{allEnumFields.length} enum fields</div>
          {allEnumFields.length > 0 ? (
            <>
              <select
                className="mb-2 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 w-full"
                value={selectedEnum}
                onChange={(e) => setSelectedEnum(e.target.value)}
              >
                <option value="">Select a field...</option>
                {allEnumFields.map((f) => {
                  const cCount = (contextData.enums[f] || []).length;
                  const oCount = (contextData.observedValues?.[f] || []).length;
                  return (
                    <option key={f} value={f}>
                      {f} ({cCount} canonical{oCount ? `, ${oCount} observed` : ''})
                    </option>
                  );
                })}
              </select>
              {selectedEnum && (
                <div className="max-h-64 overflow-auto border border-gray-200 dark:border-gray-700 rounded">
                  {/* Section 1: Canonical (from workbook) */}
                  {enumSections.canonical.length > 0 && (
                    <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                      <div className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">
                        Canonical <span className="text-gray-400">({enumSections.canonical.length})</span>
                      </div>
                      <ul className="text-xs space-y-0.5">
                        {enumSections.canonical.map((v, i) => (
                          <li key={i} className="font-mono">{v}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {/* Section 2: Manual additions (from draft) */}
                  {enumSections.manual.length > 0 && (
                    <div className="p-2 border-b border-gray-200 dark:border-gray-700 bg-blue-50/50 dark:bg-blue-900/10">
                      <div className="text-xs font-medium text-blue-600 dark:text-blue-300 mb-1">
                        Manual Additions <span className="text-gray-400">({enumSections.manual.length})</span>
                      </div>
                      <ul className="text-xs space-y-0.5">
                        {enumSections.manual.map((v, i) => (
                          <li key={i} className="font-mono text-blue-700 dark:text-blue-300">{v}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {/* Section 3: Observed from runs */}
                  {enumSections.observed.length > 0 && (
                    <div className="p-2 bg-gray-50/50 dark:bg-gray-900/30">
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                        Observed from Runs <span className="text-gray-400">({enumSections.observed.length})</span>
                      </div>
                      <ul className="text-xs space-y-0.5">
                        {enumSections.observed.map((v, i) => (
                          <li key={i} className="font-mono text-gray-500">{v}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {enumSections.canonical.length === 0 && enumSections.manual.length === 0 && enumSections.observed.length === 0 && (
                    <div className="p-2 text-xs text-gray-400">No values found for this field.</div>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-gray-400">No enum lists configured.</p>
          )}
        </div>

        {/* Component sub-panel */}
        <div className={sectionCls}>
          <h3 className="text-sm font-semibold mb-2">Component Databases</h3>
          {Object.keys(contextData.componentSummary).length > 0 ? (
            <div className="space-y-3">
              {Object.entries(contextData.componentSummary).map(([type, summary]) => (
                <details key={type} className="border border-gray-200 dark:border-gray-700 rounded p-2" open>
                  <summary className="text-xs font-medium cursor-pointer">
                    {type} <span className="text-gray-400">({summary.count} entries)</span>
                  </summary>
                  <div className="mt-2 text-xs space-y-2">
                    {/* Source config */}
                    {summary.sourceSheet && (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-gray-500">
                        <span>Sheet: <span className="font-mono">{summary.sourceSheet}</span></span>
                        <span>Name col: <span className="font-mono">{summary.nameColumn}</span></span>
                        {summary.makerColumn && <span>Maker col: <span className="font-mono">{summary.makerColumn}</span></span>}
                        {summary.aliasColumns.length > 0 && <span>Alias cols: <span className="font-mono">{summary.aliasColumns.join(', ')}</span></span>}
                        {summary.linkColumns.length > 0 && <span>Link cols: <span className="font-mono">{summary.linkColumns.join(', ')}</span></span>}
                      </div>
                    )}
                    {/* Sample entries with aliases */}
                    <div>
                      <span className="text-gray-500">Sample entries:</span>
                      <ul className="ml-2 mt-0.5 space-y-0.5">
                        {summary.sampleNames.map((n, i) => {
                          const aliases = summary.sampleAliases?.[i] || [];
                          return (
                            <li key={i}>
                              <span className="font-mono">{n}</span>
                              {aliases.length > 0 && (
                                <span className="text-gray-400 ml-1">
                                  (aliases: {aliases.join(', ')})
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    {/* Makers */}
                    {summary.makers.length > 0 && (
                      <div>
                        <span className="text-gray-500">Makers ({summary.makers.length}):</span>{' '}
                        <span className="text-gray-600 dark:text-gray-300">{summary.makers.join(', ')}</span>
                      </div>
                    )}
                    {/* Post-compile cross-reference */}
                    {componentDb[type] && (
                      <div className="text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-1 mt-1">
                        Post-compile DB: {componentDb[type].length} entries
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">No component sources configured.</p>
          )}
        </div>
      </div>

      {/* ── Developer Mode Toggle ──────────────────────────────── */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
        <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={devMode}
            onChange={(e) => setDevMode(e.target.checked)}
            className="rounded"
          />
          Show raw JSON
        </label>
      </div>
      {devMode && (
        <div className="space-y-3">
          <details>
            <summary className="text-xs text-gray-400 cursor-pointer">Full workbook map JSON</summary>
            <div className="mt-2"><JsonViewer data={wbMap} maxDepth={3} /></div>
          </details>
          <details>
            <summary className="text-xs text-gray-400 cursor-pointer">Full context response JSON</summary>
            <div className="mt-2"><JsonViewer data={contextData} maxDepth={3} /></div>
          </details>
        </div>
      )}
    </div>
  );
}
