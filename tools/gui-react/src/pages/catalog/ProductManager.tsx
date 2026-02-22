import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useUiStore } from '../../stores/uiStore';
import { useProductStore } from '../../stores/productStore';
import { DataTable } from '../../components/common/DataTable';
import { Spinner } from '../../components/common/Spinner';
import BulkPasteGrid, { type BulkGridRow } from '../../components/common/BulkPasteGrid';
import type { ColumnDef } from '@tanstack/react-table';

// ── Styles ─────────────────────────────────────────────────────────
const btnPrimary = 'px-4 py-2 text-sm bg-accent text-white rounded hover:bg-blue-600 disabled:opacity-50';
const btnSecondary = 'px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50';
const btnDanger = 'px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50';
const sectionCls = 'bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4';
const inputCls = 'px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 placeholder:text-gray-300 dark:placeholder:text-gray-500 placeholder:italic';
const labelCls = 'text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block';
const selectCls = 'px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700';

// ── Types ──────────────────────────────────────────────────────────
interface RenameHistoryEntry {
  previous_slug: string;
  previous_model: string;
  previous_variant: string;
  renamed_at: string;
  migration_result: { migrated_count: number; failed_count: number };
}

interface CatalogProduct {
  productId: string;
  id: number;
  identifier: string;
  brand: string;
  model: string;
  variant: string;
  status: string;
  seed_urls: string[];
  added_at: string;
  added_by: string;
  updated_at?: string;
  rename_history?: RenameHistoryEntry[];
}

interface Brand {
  slug: string;
  canonical_name: string;
  aliases: string[];
  categories: string[];
}

interface MutationResult {
  ok: boolean;
  error?: string;
  productId?: string;
  previousProductId?: string;
  product?: CatalogProduct;
  seeded?: number;
  skipped?: number;
  total?: number;
  fields_imported?: number;
  migration?: {
    ok: boolean;
    migrated_count: number;
    failed_count: number;
  };
}

type BulkPreviewStatus = 'ready' | 'already_exists' | 'duplicate_in_paste' | 'invalid';

interface BulkPreviewRow {
  rowNumber: number;
  raw: string;
  brand: string;
  model: string;
  variant: string;
  status: BulkPreviewStatus;
  reason: string;
  productId: string;
}

interface BulkImportResultRow {
  index: number;
  brand: string;
  model: string;
  variant: string;
  productId?: string;
  status: 'created' | 'skipped_existing' | 'skipped_duplicate' | 'invalid' | 'failed';
  reason?: string;
}

interface BulkImportResult {
  ok: boolean;
  error?: string;
  total?: number;
  created?: number;
  skipped_existing?: number;
  skipped_duplicate?: number;
  invalid?: number;
  failed?: number;
  total_catalog?: number;
  results?: BulkImportResultRow[];
}

const BULK_VARIANT_PLACEHOLDERS = new Set([
  '', 'unk', 'unknown', 'na', 'n/a', 'none', 'null', '-', 'default'
]);

function slugToken(value: string): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

function cleanVariantToken(variant: string): string {
  const trimmed = String(variant || '').trim();
  if (!trimmed) return '';
  return BULK_VARIANT_PLACEHOLDERS.has(trimmed.toLowerCase()) ? '' : trimmed;
}

function isFabricatedVariantToken(model: string, variant: string): boolean {
  const cleanedVariant = cleanVariantToken(variant);
  if (!cleanedVariant) return false;
  const modelSlug = slugToken(model);
  const variantSlug = slugToken(cleanedVariant);
  if (!modelSlug || !variantSlug) return false;
  if (modelSlug.includes(variantSlug)) return true;
  const modelTokens = new Set(modelSlug.split('-'));
  const variantTokens = variantSlug.split('-');
  return variantTokens.length > 0 && variantTokens.every((token) => modelTokens.has(token));
}

function normalizeVariantForPreview(model: string, variant: string): string {
  const cleanedVariant = cleanVariantToken(variant);
  if (!cleanedVariant) return '';
  if (isFabricatedVariantToken(model, cleanedVariant)) return '';
  return cleanedVariant;
}

function buildPreviewProductId(category: string, brand: string, model: string, variant: string): string {
  return [category, brand, model, variant]
    .map((value) => slugToken(value))
    .filter(Boolean)
    .join('-');
}

function parseBulkLine(rawLine: string): { model: string; variant: string } {
  const line = String(rawLine || '')
    .replace(/^\uFEFF/, '')
    .replace(/^\s*[-*•]\s*/, '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .trim();
  if (!line) return { model: '', variant: '' };

  // Primary mode: spreadsheet paste with 2 columns => Model<TAB>Variant
  if (line.includes('\t')) {
    const parts = line.split('\t').map((part) => part.trim());
    const model = String(parts[0] || '').trim();
    const variant = String(parts[1] || '').trim();
    return { model, variant };
  }

  // Secondary mode: allow quick manual delimiters, but still map to 2 columns only.
  const delimiters = ['|', ';', ','];
  for (const delimiter of delimiters) {
    if (!line.includes(delimiter)) continue;
    const parts = line.split(delimiter).map((part) => part.trim());
    const model = String(parts[0] || '').trim();
    const variant = String(parts[1] || '').trim();
    return { model, variant };
  }

  return { model: line, variant: '' };
}

function isHeaderRow(model: string, variant: string): boolean {
  const m = String(model || '').trim().toLowerCase();
  const v = String(variant || '').trim().toLowerCase();
  return (m === 'model' || m === 'models') && (v === 'variant' || v === 'varaint' || v === 'variants');
}

// ── Columns ────────────────────────────────────────────────────────
const columns: ColumnDef<CatalogProduct, unknown>[] = [
  {
    accessorKey: 'brand',
    header: 'Brand',
    cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
    size: 120,
  },
  {
    accessorKey: 'model',
    header: 'Model',
    size: 200,
  },
  {
    accessorKey: 'variant',
    header: 'Variant',
    cell: ({ getValue }) => {
      const v = getValue() as string;
      return v ? <span className="text-xs">{v}</span> : <span className="text-gray-400 text-xs italic">—</span>;
    },
    size: 100,
  },
  {
    accessorKey: 'id',
    header: 'ID#',
    size: 55,
    cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() as number}</span>,
  },
  {
    accessorKey: 'identifier',
    header: 'Identifier',
    size: 90,
    cell: ({ getValue }) => {
      const v = getValue() as string;
      return v ? <span className="font-mono text-xs" title={v}>{v.length > 6 ? v.slice(0, 6) + '...' : v}</span> : <span className="text-gray-400 text-xs italic">—</span>;
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ getValue }) => {
      const s = getValue() as string;
      const cls = s === 'active'
        ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
      return <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${cls}`}>{s}</span>;
    },
    size: 80,
  },
  {
    accessorKey: 'seed_urls',
    header: 'URLs',
    cell: ({ getValue }) => {
      const urls = getValue() as string[];
      return <span className="text-xs text-gray-500">{urls?.length || 0}</span>;
    },
    size: 50,
  },
];

function relativeTime(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Component ──────────────────────────────────────────────────────
export function ProductManager() {
  const category = useUiStore((s) => s.category);
  const queryClient = useQueryClient();
  const selectedProductId = useProductStore((s) => s.selectedProductId);
  const setSelectedProduct = useProductStore((s) => s.setSelectedProduct);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editPid, setEditPid] = useState<string | null>(null);
  const [formBrand, setFormBrand] = useState('');
  const [formModel, setFormModel] = useState('');
  const [formVariant, setFormVariant] = useState('');
  const [formSeedUrls, setFormSeedUrls] = useState('');
  const [formStatus, setFormStatus] = useState('active');
  // Track original values for change detection
  const [origModel, setOrigModel] = useState('');
  const [origVariant, setOrigVariant] = useState('');
  const [origStatus, setOrigStatus] = useState('active');
  const [origSeedUrls, setOrigSeedUrls] = useState('');
  // Confirmation state
  const [confirmAction, setConfirmAction] = useState<'rename' | 'delete' | 'save' | null>(null);
  const [confirmInput, setConfirmInput] = useState('');

  // Migration result banner
  const [migrationResult, setMigrationResult] = useState<MutationResult | null>(null);
  // Bulk paste modal state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBrand, setBulkBrand] = useState('');
  const [bulkGridRows, setBulkGridRows] = useState<BulkGridRow[]>([]);
  const [bulkResult, setBulkResult] = useState<BulkImportResult | null>(null);

  // ── Queries ────────────────────────────────────────────────────
  const { data: products = [], isLoading } = useQuery<CatalogProduct[]>({
    queryKey: ['catalog-products', category],
    queryFn: () => api.get<CatalogProduct[]>(`/catalog/${category}/products`),
  });

  const { data: brands = [] } = useQuery<Brand[]>({
    queryKey: ['brands', category],
    queryFn: () => api.get<Brand[]>(`/brands?category=${category}`),
  });

  // ── Mutations ──────────────────────────────────────────────────
  const addMut = useMutation({
    mutationFn: (body: { brand: string; model: string; variant: string; seedUrls: string[] }) =>
      api.post<MutationResult>(`/catalog/${category}/products`, body),
    onSuccess: () => { invalidate(); closeDrawer(); },
  });

  const updateMut = useMutation({
    mutationFn: ({ pid, patch }: { pid: string; patch: Record<string, unknown> }) =>
      api.put<MutationResult>(`/catalog/${category}/products/${pid}`, patch),
    onSuccess: (data) => {
      invalidate();
      // If this was a rename, update productStore if the old product was selected
      if (data?.previousProductId && data?.productId) {
        const currentPid = useProductStore.getState().selectedProductId;
        if (currentPid === data.previousProductId) {
          setSelectedProduct(data.productId);
        }
      }
      closeDrawer();
      if (data?.migration) {
        setMigrationResult(data);
        setTimeout(() => setMigrationResult(null), 8000);
      }
    },
  });

  const deleteMut = useMutation({
    mutationFn: (pid: string) => api.del<MutationResult>(`/catalog/${category}/products/${pid}`),
    onSuccess: (_data, pid) => {
      invalidate();
      closeDrawer();
      if (pid === selectedProductId) setSelectedProduct('');
    },
  });

  const bulkMut = useMutation({
    mutationFn: (payload: { brand: string; rows: Array<{ model: string; variant: string }> }) =>
      api.post<BulkImportResult>(`/catalog/${category}/products/bulk`, payload),
    onSuccess: (data) => {
      invalidate();
      setBulkResult(data);
      if ((data?.created ?? 0) > 0) {
        setTimeout(() => setBulkResult(null), 10000);
      }
    },
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['catalog-products', category] });
    queryClient.invalidateQueries({ queryKey: ['catalog', category] });
    queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
    queryClient.invalidateQueries({ queryKey: ['product', category] });
  }

  // ── Drawer helpers ─────────────────────────────────────────────
  function openAdd() {
    setEditPid(null);
    setFormBrand(brands.length > 0 ? brands[0].canonical_name : '');
    setFormModel('');
    setFormVariant('');
    setFormSeedUrls('');
    setFormStatus('active');
    setDrawerOpen(true);
  }

  function openEdit(product: CatalogProduct) {
    setEditPid(product.productId);
    setFormBrand(product.brand);
    setFormModel(product.model);
    setFormVariant(product.variant || '');
    setOrigModel(product.model);
    setOrigVariant(product.variant || '');
    const urls = (product.seed_urls || []).join('\n');
    setFormSeedUrls(urls);
    setOrigSeedUrls(urls);
    setFormStatus(product.status || 'active');
    setOrigStatus(product.status || 'active');
    setConfirmAction(null);
    setConfirmInput('');
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditPid(null);
    setConfirmAction(null);
    setConfirmInput('');
  }

  // ── Change detection ──────────────────────────────────────────
  const isRename = Boolean(editPid && (formModel !== origModel || formVariant !== origVariant));
  const isStatusChange = Boolean(editPid && formStatus !== origStatus);
  const isSeedUrlChange = Boolean(editPid && formSeedUrls !== origSeedUrls);
  const hasAnyChange = isRename || isStatusChange || isSeedUrlChange;

  // Compute the new slug for rename preview
  const newSlugPreview = isRename
    ? [category, formBrand, formModel, formVariant].filter(Boolean).map(s => s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '')).join('-')
    : editPid || '';

  // The confirmation phrase the user must type for rename
  const renameConfirmPhrase = newSlugPreview;
  // The confirmation phrase the user must type for delete
  const deleteConfirmPhrase = editPid || '';

  function handleSave() {
    // New product — no confirmation needed
    if (!editPid) {
      const seedUrls = formSeedUrls.split('\n').map((u) => u.trim()).filter(Boolean);
      addMut.mutate({ brand: formBrand, model: formModel, variant: formVariant, seedUrls });
      return;
    }
    // Rename requires type-to-confirm with new slug
    if (isRename && confirmAction !== 'rename') {
      setConfirmAction('rename');
      setConfirmInput('');
      return;
    }
    // Non-rename changes (status, seed URLs) require type-to-confirm with current slug
    if (!isRename && hasAnyChange && confirmAction !== 'save') {
      setConfirmAction('save');
      setConfirmInput('');
      return;
    }
    setConfirmAction(null);
    setConfirmInput('');
    const seedUrls = formSeedUrls.split('\n').map((u) => u.trim()).filter(Boolean);
    updateMut.mutate({
      pid: editPid,
      patch: { brand: formBrand, model: formModel, variant: formVariant, seed_urls: seedUrls, status: formStatus },
    });
  }

  function handleDelete() {
    if (confirmAction !== 'delete') {
      setConfirmAction('delete');
      setConfirmInput('');
      return;
    }
    if (editPid) {
      deleteMut.mutate(editPid);
    }
  }

  const isFormValid = formBrand.trim().length > 0 && formModel.trim().length > 0;
  const isSaving = addMut.isPending || updateMut.isPending;
  const saveError = addMut.error || updateMut.error;

  // Compute next available numeric ID from existing products
  const nextId = useMemo(() => {
    const usedIds = new Set<number>();
    for (const p of products) {
      if (p.id) usedIds.add(Number(p.id));
    }
    for (let i = 1; ; i++) {
      if (!usedIds.has(i)) return i;
    }
  }, [products]);

  // Brand names for the dropdown
  const brandNames = useMemo(() => {
    const set = new Set<string>();
    brands.forEach((b) => set.add(b.canonical_name));
    products.forEach((p) => set.add(p.brand));
    return [...set].sort();
  }, [brands, products]);

  const existingProductIds = useMemo(() => {
    return new Set(products.map((p) => String(p.productId || '').trim()).filter(Boolean));
  }, [products]);

  const bulkPreviewRows = useMemo<BulkPreviewRow[]>(() => {
    const brand = String(bulkBrand || '').trim();
    const rows: BulkPreviewRow[] = [];
    const seenInPaste = new Set<string>();
    const gridEntries = bulkGridRows.filter((r) => r.col1.trim() || r.col2.trim());

    for (let i = 0; i < gridEntries.length; i += 1) {
      const entry = gridEntries[i];
      const raw = `${entry.col1}\t${entry.col2}`.trim();
      const model = String(entry.col1 || '').trim();
      const variant = String(entry.col2 || '').trim();

      if (isHeaderRow(model, variant)) {
        rows.push({
          rowNumber: i + 1,
          raw,
          brand: '',
          model,
          variant,
          status: 'invalid',
          reason: 'Header row',
          productId: ''
        });
        continue;
      }

      if (!brand) {
        rows.push({
          rowNumber: i + 1,
          raw,
          brand: '',
          model,
          variant,
          status: 'invalid',
          reason: 'Select a brand',
          productId: ''
        });
        continue;
      }

      if (!model) {
        rows.push({
          rowNumber: i + 1,
          raw,
          brand,
          model: '',
          variant,
          status: 'invalid',
          reason: 'Model is required',
          productId: ''
        });
        continue;
      }

      const normalizedVariant = normalizeVariantForPreview(model, variant);
      const productId = buildPreviewProductId(category, brand, model, normalizedVariant);

      if (!productId) {
        rows.push({
          rowNumber: i + 1,
          raw,
          brand,
          model,
          variant,
          status: 'invalid',
          reason: 'Could not build slug',
          productId: ''
        });
        continue;
      }

      if (seenInPaste.has(productId)) {
        rows.push({
          rowNumber: i + 1,
          raw,
          brand,
          model,
          variant: normalizedVariant,
          status: 'duplicate_in_paste',
          reason: 'Duplicate within pasted list',
          productId
        });
        continue;
      }
      seenInPaste.add(productId);

      if (existingProductIds.has(productId)) {
        rows.push({
          rowNumber: i + 1,
          raw,
          brand,
          model,
          variant: normalizedVariant,
          status: 'already_exists',
          reason: 'Already in catalog',
          productId
        });
        continue;
      }

      rows.push({
        rowNumber: i + 1,
        raw,
        brand,
        model,
        variant: normalizedVariant,
        status: 'ready',
        reason: 'Ready',
        productId
      });
    }

    return rows;
  }, [bulkBrand, bulkGridRows, category, existingProductIds]);

  const bulkCounts = useMemo(() => {
    const counts = { ready: 0, existing: 0, duplicate: 0, invalid: 0 };
    for (const row of bulkPreviewRows) {
      if (row.status === 'ready') counts.ready += 1;
      else if (row.status === 'already_exists') counts.existing += 1;
      else if (row.status === 'duplicate_in_paste') counts.duplicate += 1;
      else counts.invalid += 1;
    }
    return counts;
  }, [bulkPreviewRows]);

  const bulkRowsToSubmit = useMemo(() => {
    return bulkPreviewRows
      .filter((row) => row.status === 'ready')
      .map((row) => ({ model: row.model, variant: row.variant }));
  }, [bulkPreviewRows]);

  const openBulkModal = useCallback(() => {
    setBulkBrand((current) => current || brandNames[0] || '');
    setBulkGridRows([]);
    setBulkOpen(true);
  }, [brandNames]);

  const closeBulkModal = useCallback(() => {
    if (bulkMut.isPending) return;
    setBulkOpen(false);
  }, [bulkMut.isPending]);

  const runBulkImport = useCallback(() => {
    const brand = String(bulkBrand || '').trim();
    if (!brand || bulkRowsToSubmit.length === 0) return;
    bulkMut.mutate({ brand, rows: bulkRowsToSubmit });
  }, [bulkBrand, bulkRowsToSubmit, bulkMut]);

  // ── Render ─────────────────────────────────────────────────────
  if (isLoading) return <Spinner />;

  return (
    <>
      <div className={`grid ${drawerOpen ? 'grid-cols-[1fr,380px]' : 'grid-cols-1'} gap-3`}>
      {/* Main panel */}
      <div className="space-y-3">
        {/* Header bar */}
        <div className={`${sectionCls} flex items-center justify-between`}>
          <div>
            <h3 className="text-sm font-semibold">Product Catalog — {category}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {products.length} product{products.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={openBulkModal}
              disabled={category === 'all'}
              title={category === 'all' ? 'Select a specific category for bulk import' : undefined}
              className={btnSecondary}
            >
              Bulk Paste
            </button>
            <button onClick={openAdd} className={btnPrimary}>+ Add Product</button>
          </div>
        </div>

        {/* Bulk import result banner */}
        {bulkResult && (
          <div className={`px-4 py-2 text-sm rounded ${
            (bulkResult.failed ?? 0) > 0 || !bulkResult.ok
              ? 'bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700'
              : 'bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700'
          }`}>
            Bulk import: added <strong>{bulkResult.created ?? 0}</strong>
            {', '}existing <strong>{bulkResult.skipped_existing ?? 0}</strong>
            {', '}duplicates <strong>{bulkResult.skipped_duplicate ?? 0}</strong>
            {', '}invalid <strong>{bulkResult.invalid ?? 0}</strong>
            {', '}failed <strong>{bulkResult.failed ?? 0}</strong>.
            {' '}Catalog total: <strong>{bulkResult.total_catalog ?? products.length}</strong>.
          </div>
        )}

        {/* Migration result banner */}
        {migrationResult?.migration && (
          <div className={`px-4 py-2 text-sm rounded ${migrationResult.migration.ok
            ? 'bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700'
            : 'bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700'
          }`}>
            Renamed successfully. Migrated <strong>{migrationResult.migration.migrated_count}</strong> artifact{migrationResult.migration.migrated_count !== 1 ? 's' : ''} to new slug.
            {migrationResult.migration.failed_count > 0 && (
              <span className="text-amber-700 dark:text-amber-300"> ({migrationResult.migration.failed_count} failed)</span>
            )}
          </div>
        )}

        {/* Product table */}
        <div className={sectionCls}>
          <DataTable
            data={products}
            columns={columns}
            searchable
            onRowClick={openEdit}
            maxHeight="max-h-[550px]"
          />
        </div>
      </div>

      {/* Drawer panel */}
      {drawerOpen && (
        <div className={`${sectionCls} space-y-4 self-start sticky top-4`}>
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">{editPid ? 'Edit Product' : 'Add Product'}</h4>
            <button onClick={closeDrawer} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
          </div>

          {/* Brand */}
          <div>
            <label className={labelCls}>Brand *</label>
            {editPid ? (
              <input type="text" value={formBrand} disabled className={`${inputCls} w-full opacity-60`} />
            ) : brandNames.length > 0 ? (
              <select
                value={formBrand}
                onChange={(e) => setFormBrand(e.target.value)}
                className={`${selectCls} w-full`}
              >
                <option value="">Select brand...</option>
                {brandNames.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={formBrand}
                onChange={(e) => setFormBrand(e.target.value)}
                placeholder="e.g. Razer"
                className={`${inputCls} w-full`}
              />
            )}
          </div>

          {/* Model */}
          <div>
            <label className={labelCls}>Model *</label>
            <input
              type="text"
              value={formModel}
              onChange={(e) => { setFormModel(e.target.value); setConfirmAction(null); setConfirmInput(''); }}
              placeholder="e.g. Viper V3 Pro"
              className={`${inputCls} w-full`}
            />
          </div>

          {/* Variant */}
          <div>
            <label className={labelCls}>Variant</label>
            <input
              type="text"
              value={formVariant}
              onChange={(e) => { setFormVariant(e.target.value); setConfirmAction(null); setConfirmInput(''); }}
              placeholder="e.g. Wireless (leave blank for base model)"
              className={`${inputCls} w-full`}
            />
          </div>

          {/* Status (edit only) */}
          {editPid && (
            <div>
              <label className={labelCls}>Status</label>
              <select
                value={formStatus}
                onChange={(e) => { setFormStatus(e.target.value); setConfirmAction(null); setConfirmInput(''); }}
                className={`${selectCls} w-full`}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          )}

          {/* Seed URLs */}
          <div>
            <label className={labelCls}>Seed URLs (one per line)</label>
            <textarea
              value={formSeedUrls}
              onChange={(e) => { setFormSeedUrls(e.target.value); setConfirmAction(null); setConfirmInput(''); }}
              placeholder={"https://example.com/product-page\nhttps://..."}
              rows={3}
              className={`${inputCls} w-full resize-y`}
            />
          </div>

          {/* Identity Preview */}
          <div className="bg-gray-50 dark:bg-gray-900/30 rounded p-2.5 border border-gray-200 dark:border-gray-700 space-y-1.5">
            <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Identity Preview</div>
            {editPid ? (
              <>
                {/* Slug — show diff on rename */}
                {isRename ? (
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-400 w-16">Slug</span>
                      <span className="font-mono text-red-600 dark:text-red-400 line-through truncate">{editPid}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="w-16" />
                      <span className="font-mono text-green-600 dark:text-green-400 truncate">{newSlugPreview}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400 w-16">Slug</span>
                    <span className="font-mono text-gray-600 dark:text-gray-300 truncate">{editPid}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-400 w-16">ID#</span>
                  <span className="font-mono text-gray-600 dark:text-gray-300">
                    {products.find(p => p.productId === editPid)?.id || '—'}
                  </span>
                  <span className="text-[10px] text-gray-400">(immutable)</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-400 w-16">Identifier</span>
                  <span className="font-mono text-gray-600 dark:text-gray-300">
                    {products.find(p => p.productId === editPid)?.identifier || '—'}
                  </span>
                  <span className="text-[10px] text-gray-400">(immutable)</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-400 w-16">Slug</span>
                  <span className="font-mono text-gray-600 dark:text-gray-300 truncate">
                    {formBrand && formModel
                      ? [category, formBrand, formModel, formVariant].filter(Boolean).map(s => s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '')).join('-')
                      : '(enter brand + model)'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-400 w-16">ID#</span>
                  <span className="font-mono text-blue-600 dark:text-blue-400 font-semibold">{nextId}</span>
                  <span className="text-[10px] text-gray-400">(auto)</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-400 w-16">Identifier</span>
                  <span className="font-mono text-blue-600 dark:text-blue-400">generated on save</span>
                  <span className="text-[10px] text-gray-400">(8-char hex)</span>
                </div>
              </>
            )}
          </div>

          {/* ── Downstream Dependencies Panel ────────────────────────── */}
          {editPid && (
            <div className={`rounded border text-xs ${
              isRename
                ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-800'
                : hasAnyChange
                  ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700'
                  : 'bg-gray-50 dark:bg-gray-900/30 border-gray-200 dark:border-gray-700'
            }`}>
              {/* Header bar */}
              <div className={`px-3 py-2 border-b flex items-center justify-between ${
                isRename ? 'border-red-200 dark:border-red-800'
                  : hasAnyChange ? 'border-amber-200 dark:border-amber-700'
                  : 'border-gray-200 dark:border-gray-700'
              }`}>
                <span className={`text-[10px] font-bold uppercase tracking-wide ${
                  isRename ? 'text-red-600 dark:text-red-400'
                    : hasAnyChange ? 'text-amber-600 dark:text-amber-400'
                    : 'text-gray-500 dark:text-gray-400'
                }`}>
                  {isRename ? 'Impact — Slug Rename' : hasAnyChange ? 'Downstream Impact' : 'Downstream Dependencies'}
                </span>
                <span className={`font-semibold tabular-nums ${
                  isRename ? 'text-red-700 dark:text-red-300'
                    : hasAnyChange ? 'text-amber-700 dark:text-amber-300'
                    : 'text-gray-600 dark:text-gray-400'
                }`}>
                  5 linked files
                </span>
              </div>

              <div className="px-3 py-2 space-y-2">
                {/* Rename-specific: slug diff */}
                {isRename && (
                  <div className="font-mono text-[11px]">
                    <span className="text-red-600 line-through">{editPid}</span>
                    {' → '}
                    <span className="text-green-700 dark:text-green-400">{newSlugPreview}</span>
                  </div>
                )}

                {/* Non-rename changes: summary */}
                {!isRename && hasAnyChange && (
                  <div className="space-y-0.5 text-amber-700 dark:text-amber-300 text-[11px]">
                    {isStatusChange && (
                      <div>
                        <p>Status: <span className="font-mono line-through text-red-500">{origStatus}</span> &rarr; <span className="font-mono text-green-600">{formStatus}</span></p>
                        {formStatus === 'inactive' && <p className="text-[10px] mt-0.5">Inactive products excluded from queue processing and pipeline runs.</p>}
                      </div>
                    )}
                    {isSeedUrlChange && (
                      <p>Seed URLs changed — next pipeline run uses updated URLs.</p>
                    )}
                  </div>
                )}

                {/* Expandable: affected files */}
                <details className="group" open={isRename}>
                  <summary className={`cursor-pointer select-none text-[11px] font-medium hover:opacity-80 ${
                    isRename ? 'text-red-700 dark:text-red-300' : 'text-gray-600 dark:text-gray-300'
                  }`}>
                    Affected files
                  </summary>
                  <div className={`mt-1 font-mono text-[10px] rounded p-1.5 space-y-0.5 overflow-x-auto ${
                    isRename
                      ? 'bg-red-100 dark:bg-red-900/40'
                      : 'bg-white/60 dark:bg-gray-800/60'
                  }`}>
                    {isRename ? (
                      <>
                        <div><span className="text-red-500">-</span> specs/inputs/{category}/products/<span className="text-red-600 font-bold">{editPid}</span>.json</div>
                        <div><span className="text-green-600">+</span> specs/inputs/{category}/products/<span className="text-green-600 font-bold">{newSlugPreview}</span>.json</div>
                        <div className={`border-t my-0.5 ${isRename ? 'border-red-200 dark:border-red-800' : 'border-gray-200 dark:border-gray-700'}`} />
                        <div><span className="text-red-500">-</span> */latest/, */runs/, */review/, */published/ under <span className="font-bold">{editPid}</span></div>
                        <div><span className="text-green-600">+</span> */latest/, */runs/, */review/, */published/ under <span className="font-bold">{newSlugPreview}</span></div>
                        <div className={`border-t my-0.5 border-red-200 dark:border-red-800`} />
                        <div><span className="text-red-500">-</span> _overrides/<span className="font-bold">{editPid}</span>.overrides.json</div>
                        <div><span className="text-green-600">+</span> _overrides/<span className="font-bold">{newSlugPreview}</span>.overrides.json</div>
                        <div className={`border-t my-0.5 border-red-200 dark:border-red-800`} />
                        <div><span className="text-red-500">-</span> _queue/{category}/state.json &rarr; products[<span className="font-bold">{editPid}</span>]</div>
                        <div><span className="text-green-600">+</span> _queue/{category}/state.json &rarr; products[<span className="font-bold">{newSlugPreview}</span>]</div>
                      </>
                    ) : (
                      <>
                        <div>specs/inputs/{category}/products/<span className="font-semibold">{editPid}</span>.json</div>
                        <div>*/latest/, */runs/, */review/ under <span className="font-semibold">{editPid}</span></div>
                        <div>*/published/<span className="font-semibold">{editPid}</span>/*</div>
                        <div>helper_files/{category}/_overrides/<span className="font-semibold">{editPid}</span>.overrides.json</div>
                        <div>_queue/{category}/state.json &rarr; products[<span className="font-semibold">{editPid}</span>]</div>
                      </>
                    )}
                  </div>
                </details>

                {/* Expandable: what happens on rename */}
                {isRename && (
                  <details className="group">
                    <summary className="cursor-pointer select-none text-[11px] font-medium text-red-700 dark:text-red-300 hover:opacity-80">
                      What will happen
                    </summary>
                    <ul className="mt-1 ml-3 list-disc space-y-0.5 text-red-700 dark:text-red-300 text-[11px]">
                      <li>All output artifacts, run history, and review state <strong>migrated automatically</strong></li>
                      <li>Override files moved to new slug</li>
                      <li>Queue entry updated to new slug</li>
                      <li>Rename logged in product history + category rename log</li>
                      <li>ID# and Identifier remain <strong>unchanged</strong> (immutable)</li>
                    </ul>
                    {isStatusChange && (
                      <p className="mt-1 text-[11px] text-red-700 dark:text-red-300">
                        Status: <span className="font-mono line-through text-red-500">{origStatus}</span> &rarr; <span className="font-mono text-green-600">{formStatus}</span>
                      </p>
                    )}
                  </details>
                )}

                {/* Hint when no changes */}
                {!hasAnyChange && (
                  <p className="text-[10px] text-gray-400 pt-0.5">Changing <strong>model</strong> or <strong>variant</strong> triggers a full slug rename and artifact migration. Changing <strong>status</strong> or <strong>seed URLs</strong> takes effect on next pipeline run.</p>
                )}
              </div>
            </div>
          )}

          {/* Rename history */}
          {editPid && (() => {
            const editProduct = products.find(p => p.productId === editPid);
            const history = editProduct?.rename_history;
            if (!history || history.length === 0) return null;
            return (
              <details className="group text-[10px] text-gray-400">
                <summary className="cursor-pointer select-none font-medium hover:text-gray-600 dark:hover:text-gray-300">
                  Rename History ({history.length})
                </summary>
                <div className="mt-1 space-y-0.5 ml-1">
                  {history.map((r, i) => (
                    <div key={i}>
                      <span className="font-mono">{r.previous_slug}</span>
                      <span className="ml-1">&rarr; renamed {relativeTime(r.renamed_at)}</span>
                      <span className="ml-1">({r.migration_result.migrated_count} files migrated)</span>
                    </div>
                  ))}
                </div>
              </details>
            );
          })()}

          {/* Rename type-to-confirm (GitHub-style) */}
          {confirmAction === 'rename' && (
            <div className="bg-red-50 dark:bg-red-900/30 border-2 border-red-400 dark:border-red-700 rounded p-3 space-y-2">
              <div className="text-sm font-bold text-red-800 dark:text-red-200">Confirm slug rename</div>
              <p className="text-xs text-red-700 dark:text-red-300">
                This will migrate <strong>all</strong> artifacts from the old slug to the new slug.
                This action rewrites every file path system-wide.
              </p>
              <p className="text-xs text-red-700 dark:text-red-300">
                To confirm, type the new slug below:
              </p>
              <div className="font-mono text-xs bg-red-100 dark:bg-red-900/50 rounded px-2 py-1 text-red-800 dark:text-red-200 select-all">
                {renameConfirmPhrase}
              </div>
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="Type the new slug to confirm"
                className="w-full px-2 py-1.5 text-sm font-mono border-2 border-red-300 dark:border-red-600 rounded bg-white dark:bg-gray-800 focus:border-red-500 focus:outline-none"
                autoFocus
              />
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSave}
                  disabled={confirmInput !== renameConfirmPhrase || isSaving}
                  className="px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSaving ? 'Migrating...' : 'I understand, rename this product'}
                </button>
                <button
                  onClick={() => { setConfirmAction(null); setConfirmInput(''); }}
                  className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Save type-to-confirm (GitHub-style) — for non-rename changes */}
          {confirmAction === 'save' && (
            <div className="bg-amber-50 dark:bg-amber-900/30 border-2 border-amber-400 dark:border-amber-700 rounded p-3 space-y-2">
              <div className="text-sm font-bold text-amber-800 dark:text-amber-200">Confirm changes</div>
              <div className="text-xs text-amber-700 dark:text-amber-300 space-y-1">
                <p>You are about to save changes to <strong>{editPid}</strong>:</p>
                <ul className="list-disc ml-3 space-y-0.5">
                  {isStatusChange && (
                    <li>Status: <span className="font-mono line-through text-red-500">{origStatus}</span> &rarr; <span className="font-mono text-green-600">{formStatus}</span>
                      {formStatus === 'inactive' && <span> — product will be excluded from queue and pipeline</span>}
                    </li>
                  )}
                  {isSeedUrlChange && (
                    <li>Seed URLs updated — next pipeline run will use new URLs</li>
                  )}
                </ul>
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                To confirm, type the product slug below:
              </p>
              <div className="font-mono text-xs bg-amber-100 dark:bg-amber-900/50 rounded px-2 py-1 text-amber-800 dark:text-amber-200 select-all">
                {editPid}
              </div>
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="Type the product slug to confirm"
                className="w-full px-2 py-1.5 text-sm font-mono border-2 border-amber-300 dark:border-amber-600 rounded bg-white dark:bg-gray-800 focus:border-amber-500 focus:outline-none"
                autoFocus
              />
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSave}
                  disabled={confirmInput !== editPid || isSaving}
                  className="px-3 py-1.5 text-xs font-semibold bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSaving ? 'Saving...' : 'Confirm save'}
                </button>
                <button
                  onClick={() => { setConfirmAction(null); setConfirmInput(''); }}
                  className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Delete type-to-confirm (GitHub-style) */}
          {confirmAction === 'delete' && (
            <div className="bg-red-50 dark:bg-red-900/30 border-2 border-red-400 dark:border-red-700 rounded p-3 space-y-2">
              <div className="text-sm font-bold text-red-800 dark:text-red-200">Confirm deletion</div>
              <div className="text-xs text-red-700 dark:text-red-300 space-y-1">
                <p>This will <strong>permanently delete</strong> this product from the catalog:</p>
                <ul className="list-disc ml-3 space-y-0.5">
                  <li>Catalog entry will be removed</li>
                  <li>Input file will be deleted</li>
                  <li>Queue entry will be orphaned</li>
                  <li>Output artifacts will remain on disk but become unlinked</li>
                </ul>
              </div>
              <p className="text-xs text-red-700 dark:text-red-300 mt-1">
                To confirm, type the product slug below:
              </p>
              <div className="font-mono text-xs bg-red-100 dark:bg-red-900/50 rounded px-2 py-1 text-red-800 dark:text-red-200 select-all">
                {deleteConfirmPhrase}
              </div>
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="Type the product slug to confirm"
                className="w-full px-2 py-1.5 text-sm font-mono border-2 border-red-300 dark:border-red-600 rounded bg-white dark:bg-gray-800 focus:border-red-500 focus:outline-none"
                autoFocus
              />
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { if (editPid) deleteMut.mutate(editPid); }}
                  disabled={confirmInput !== deleteConfirmPhrase || deleteMut.isPending}
                  className="px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deleteMut.isPending ? 'Deleting...' : 'I understand, delete this product'}
                </button>
                <button
                  onClick={() => { setConfirmAction(null); setConfirmInput(''); }}
                  className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {saveError && (
            <p className="text-xs text-red-600">{(saveError as Error).message}</p>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            {!confirmAction && (
              <>
                <button
                  onClick={handleSave}
                  disabled={!isFormValid || isSaving || (editPid ? !hasAnyChange : false)}
                  className={isRename ? btnDanger : btnPrimary}
                  title={editPid && !hasAnyChange ? 'No changes to save' : undefined}
                >
                  {isSaving ? 'Saving...' : editPid ? (isRename ? 'Rename & Migrate' : 'Save Changes') : 'Add Product'}
                </button>
                {editPid && (
                  <button
                    onClick={handleDelete}
                    disabled={deleteMut.isPending}
                    className={btnDanger}
                  >
                    {deleteMut.isPending ? 'Deleting...' : 'Delete'}
                  </button>
                )}
              </>
            )}
            <button onClick={closeDrawer} className={btnSecondary}>Cancel</button>
          </div>
        </div>
      )}
      </div>
      {bulkOpen && (
        <div className="fixed inset-0 z-40 bg-black/45 p-4 flex items-start md:items-center justify-center">
          <div className="w-full max-w-5xl max-h-[92vh] overflow-hidden bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold">Bulk Paste Models + Variants</h4>
                <p className="text-xs text-gray-500 mt-0.5">Type or paste <strong>Model</strong> and <strong>Variant</strong> columns (supports tab-separated paste from Excel/Sheets).</p>
              </div>
              <button
                onClick={closeBulkModal}
                disabled={bulkMut.isPending}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none disabled:opacity-40"
                aria-label="Close bulk import modal"
              >
                &times;
              </button>
            </div>

            <div className="p-4 space-y-3 overflow-auto">
              <div className="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-3 items-end">
                <div>
                  <label className={labelCls}>Brand *</label>
                  <select
                    value={bulkBrand}
                    onChange={(e) => setBulkBrand(e.target.value)}
                    className={`${selectCls} w-full`}
                    disabled={bulkMut.isPending}
                  >
                    <option value="">Select brand...</option>
                    {brandNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
                <div className="text-xs text-gray-500">
                  Type or paste from a spreadsheet. Variant can be blank.
                </div>
              </div>

              <div>
                <label className={labelCls}>Paste Rows</label>
                <BulkPasteGrid
                  col1Header="Model"
                  col2Header="Variant"
                  col1Placeholder="e.g. Viper V3 Pro"
                  col2Placeholder="e.g. White"
                  rows={bulkGridRows}
                  onChange={setBulkGridRows}
                  disabled={bulkMut.isPending}
                />
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-1 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">Ready: {bulkCounts.ready}</span>
                <span className="px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">Existing: {bulkCounts.existing}</span>
                <span className="px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">Duplicates: {bulkCounts.duplicate}</span>
                <span className="px-2 py-1 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">Invalid: {bulkCounts.invalid}</span>
                <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">Rows: {bulkPreviewRows.length}</span>
              </div>

              {bulkPreviewRows.length > 0 && (
              <div className="border border-gray-200 dark:border-gray-700 rounded overflow-auto max-h-[24vh]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900/70 border-b border-gray-200 dark:border-gray-700">
                    <tr>
                      <th className="text-left px-2 py-1.5 w-12">#</th>
                      <th className="text-left px-2 py-1.5">Model</th>
                      <th className="text-left px-2 py-1.5">Variant</th>
                      <th className="text-left px-2 py-1.5">Slug Preview</th>
                      <th className="text-left px-2 py-1.5 w-36">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkPreviewRows.map((row) => {
                      const statusCls = row.status === 'ready'
                        ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                        : row.status === 'already_exists'
                          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                          : row.status === 'duplicate_in_paste'
                            ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                            : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300';
                      return (
                        <tr key={`${row.rowNumber}-${row.productId}-${row.raw}`} className="border-b border-gray-100 dark:border-gray-700/50">
                          <td className="px-2 py-1.5 text-gray-500">{row.rowNumber}</td>
                          <td className="px-2 py-1.5">{row.model || <span className="italic text-gray-400">â€”</span>}</td>
                          <td className="px-2 py-1.5">{row.variant || <span className="italic text-gray-400">â€”</span>}</td>
                          <td className="px-2 py-1.5 font-mono text-[11px] text-gray-600 dark:text-gray-300">{row.productId || <span className="italic text-gray-400">â€”</span>}</td>
                          <td className="px-2 py-1.5">
                            <span className={`inline-block px-2 py-0.5 rounded-full ${statusCls}`}>{row.reason}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )}

              {bulkMut.error && (
                <div className="px-3 py-2 text-xs rounded bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300">
                  Bulk import failed: {(bulkMut.error as Error).message}
                </div>
              )}

              {bulkMut.data?.results && bulkMut.data.results.length > 0 && (
                <details className="text-xs border border-gray-200 dark:border-gray-700 rounded">
                  <summary className="cursor-pointer px-3 py-2 bg-gray-50 dark:bg-gray-900/60 font-medium">
                    Last run details ({bulkMut.data.results.length} rows)
                  </summary>
                  <div className="max-h-40 overflow-auto p-2 space-y-1">
                    {bulkMut.data.results.slice(0, 50).map((row, idx) => (
                      <div key={`${idx}-${row.index}-${row.productId || ''}`} className="font-mono text-[11px] text-gray-700 dark:text-gray-300">
                        {`[${row.index + 1}] ${row.model}${row.variant ? ` | ${row.variant}` : ''} -> ${row.status}${row.reason ? ` (${row.reason})` : ''}`}
                      </div>
                    ))}
                    {bulkMut.data.results.length > 50 && (
                      <div className="text-gray-500">Showing first 50 rows.</div>
                    )}
                  </div>
                </details>
              )}
            </div>

            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2">
              <div className="text-xs text-gray-500">
                Ready rows will be added as new products for <strong>{bulkBrand || 'selected brand'}</strong>.
              </div>
              <div className="flex gap-2">
                <button
                  onClick={closeBulkModal}
                  disabled={bulkMut.isPending}
                  className={btnSecondary}
                >
                  Close
                </button>
                <button
                  onClick={runBulkImport}
                  disabled={bulkMut.isPending || !bulkBrand.trim() || bulkRowsToSubmit.length === 0}
                  className={btnPrimary}
                >
                  {bulkMut.isPending ? 'Importing...' : `Import ${bulkRowsToSubmit.length} Ready Row${bulkRowsToSubmit.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
