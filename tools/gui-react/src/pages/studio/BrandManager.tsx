import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useUiStore } from '../../stores/uiStore';
import { DataTable } from '../../components/common/DataTable';
import { Spinner } from '../../components/common/Spinner';
import { inputCls, labelCls } from './studioConstants';
import type { ColumnDef } from '@tanstack/react-table';
import type { BrandImpactAnalysis } from '../../types/product';

// ── Styles ─────────────────────────────────────────────────────────
const btnPrimary = 'px-4 py-2 text-sm bg-accent text-white rounded hover:bg-blue-600 disabled:opacity-50';
const btnSecondary = 'px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50';
const btnDanger = 'px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50';
const sectionCls = 'bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4';
const chipCls = 'inline-block px-2 py-0.5 text-xs rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 mr-1 mb-1';

// ── Types ──────────────────────────────────────────────────────────
interface Brand {
  slug: string;
  canonical_name: string;
  identifier?: string;
  aliases: string[];
  categories: string[];
  website: string;
  added_at: string;
  added_by: string;
  updated_at?: string;
  rename_history?: Array<{ previous_slug: string; previous_name: string; renamed_at: string }>;
}

interface BrandMutationResult {
  ok: boolean;
  error?: string;
  slug?: string;
  brand?: Brand;
  seeded?: number;
  skipped?: number;
  total_brands?: number;
  categories_scanned?: number;
  // Rename-specific fields
  oldSlug?: string;
  newSlug?: string;
  identifier?: string;
  oldName?: string;
  newName?: string;
  cascaded_products?: number;
  cascade_failures?: number;
}

type BrandBulkPreviewStatus = 'ready' | 'already_exists' | 'duplicate_in_paste' | 'invalid';

interface BrandBulkPreviewRow {
  rowNumber: number;
  raw: string;
  name: string;
  slug: string;
  status: BrandBulkPreviewStatus;
  reason: string;
}

interface BrandBulkImportResultRow {
  index: number;
  name: string;
  slug: string;
  status: 'created' | 'skipped_existing' | 'skipped_duplicate' | 'invalid' | 'failed';
  reason?: string;
}

interface BrandBulkImportResult {
  ok: boolean;
  error?: string;
  total?: number;
  created?: number;
  skipped_existing?: number;
  skipped_duplicate?: number;
  invalid?: number;
  failed?: number;
  total_brands?: number;
  results?: BrandBulkImportResultRow[];
}

// ── Client-side slugify (matches server) ──────────────────────────
function slugify(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseBulkBrandLine(rawLine: string): string {
  const line = String(rawLine || '')
    .replace(/^\uFEFF/, '')
    .replace(/^\s*[-*•]\s*/, '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .trim();
  if (!line) return '';
  if (line.includes('\t')) {
    return String(line.split('\t')[0] || '').trim();
  }
  return line;
}

function isBrandHeaderRow(name: string): boolean {
  const token = String(name || '').trim().toLowerCase();
  return token === 'brand' || token === 'brands' || token === 'brand name' || token === 'name';
}

// ── Columns ────────────────────────────────────────────────────────
const columns: ColumnDef<Brand, unknown>[] = [
  {
    accessorKey: 'canonical_name',
    header: 'Brand Name',
    cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
  },
  {
    accessorKey: 'identifier',
    header: 'ID',
    cell: ({ getValue }) => {
      const id = getValue() as string | undefined;
      if (!id) return <span className="text-gray-400 italic text-xs">-</span>;
      return <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{id}</span>;
    },
  },
  {
    accessorKey: 'aliases',
    header: 'Aliases',
    cell: ({ getValue }) => {
      const aliases = getValue() as string[];
      if (!aliases?.length) return <span className="text-gray-400 italic text-xs">none</span>;
      return <div className="flex flex-wrap">{aliases.map((a) => <span key={a} className={chipCls}>{a}</span>)}</div>;
    },
  },
  {
    accessorKey: 'categories',
    header: 'Categories',
    cell: ({ getValue }) => {
      const cats = getValue() as string[];
      return <div className="flex flex-wrap">{cats.map((c) => <span key={c} className={chipCls}>{c}</span>)}</div>;
    },
  },
  {
    accessorKey: 'website',
    header: 'Website',
    cell: ({ getValue }) => {
      const url = getValue() as string;
      if (!url) return <span className="text-gray-400 italic text-xs">-</span>;
      return <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline text-xs truncate max-w-[200px] block">{url}</a>;
    },
  },
];

// ── Component ──────────────────────────────────────────────────────
export function BrandManager() {
  const categories = useUiStore((s) => s.categories);
  const selectedCategory = useUiStore((s) => s.category);
  const queryClient = useQueryClient();

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editSlug, setEditSlug] = useState<string | null>(null);
  const [editIdentifier, setEditIdentifier] = useState<string>('');
  const [formName, setFormName] = useState('');
  const [formAliases, setFormAliases] = useState('');
  const [formCategories, setFormCategories] = useState<string[]>([]);
  const [formWebsite, setFormWebsite] = useState('');

  // Original values for change detection
  const [origName, setOrigName] = useState('');
  const [origAliases, setOrigAliases] = useState('');
  const [origCategories, setOrigCategories] = useState<string[]>([]);
  const [origWebsite, setOrigWebsite] = useState('');

  // Confirmation state
  const [confirmAction, setConfirmAction] = useState<'rename' | 'delete' | 'save' | null>(null);
  const [confirmInput, setConfirmInput] = useState('');

  // Result banners
  const [renameResult, setRenameResult] = useState<BrandMutationResult | null>(null);
  const [bulkResult, setBulkResult] = useState<BrandBulkImportResult | null>(null);

  // Bulk single-column modal state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkText, setBulkText] = useState('');

  // ── Queries ────────────────────────────────────────────────────
  const { data: brands = [], isLoading } = useQuery<Brand[]>({
    queryKey: ['brands', selectedCategory],
    queryFn: () => api.get<Brand[]>(
      selectedCategory && selectedCategory !== 'all'
        ? `/brands?category=${selectedCategory}`
        : '/brands'
    ),
  });

  // Unfiltered registry list for accurate bulk duplicate preview
  const { data: allBrands = [] } = useQuery<Brand[]>({
    queryKey: ['brands', '_all_bulk'],
    queryFn: () => api.get<Brand[]>('/brands'),
  });

  // Impact analysis for current brand being edited
  const { data: impactData } = useQuery<BrandImpactAnalysis>({
    queryKey: ['brand-impact', editSlug],
    queryFn: () => api.get<BrandImpactAnalysis>(`/brands/${editSlug}/impact`),
    enabled: !!editSlug,
  });

  // ── Change detection ───────────────────────────────────────────
  const newSlugPreview = slugify(formName);
  const isRename = Boolean(editSlug && formName.trim() !== origName);
  const isSlugChange = Boolean(isRename && newSlugPreview !== editSlug);
  const isAliasChange = Boolean(editSlug && formAliases !== origAliases);
  const isCategoryChange = Boolean(editSlug && JSON.stringify([...formCategories].sort()) !== JSON.stringify([...origCategories].sort()));
  const isWebsiteChange = Boolean(editSlug && formWebsite !== origWebsite);
  const hasAnyChange = isRename || isAliasChange || isCategoryChange || isWebsiteChange;

  // ── Query invalidation helper ──────────────────────────────────
  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['brands'] });
    queryClient.invalidateQueries({ queryKey: ['brand-impact'] });
    // Invalidate product catalog queries since brand renames change product slugs
    queryClient.invalidateQueries({ queryKey: ['catalog-products'] });
    queryClient.invalidateQueries({ queryKey: ['catalog'] });
    queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex'] });
    queryClient.invalidateQueries({ queryKey: ['product'] });
  }

  // ── Mutations ──────────────────────────────────────────────────
  const addMut = useMutation({
    mutationFn: (body: { name: string; aliases: string[]; categories: string[]; website: string }) =>
      api.post<BrandMutationResult>('/brands', body),
    onSuccess: () => { invalidate(); closeDrawer(); },
  });

  const updateMut = useMutation({
    mutationFn: ({ slug, patch }: { slug: string; patch: Record<string, unknown> }) =>
      api.put<BrandMutationResult>(`/brands/${slug}`, patch),
    onSuccess: (data) => {
      invalidate();
      closeDrawer();
      // Show rename result banner if products were cascaded
      if (data?.cascaded_products !== undefined) {
        setRenameResult(data);
        setTimeout(() => setRenameResult(null), 10000);
      }
    },
  });

  const deleteMut = useMutation({
    mutationFn: (slug: string) => api.del<BrandMutationResult>(`/brands/${slug}`),
    onSuccess: () => { invalidate(); closeDrawer(); },
  });

  const bulkMut = useMutation({
    mutationFn: (payload: { category: string; names: string[] }) =>
      api.post<BrandBulkImportResult>('/brands/bulk', payload),
    onSuccess: (data) => {
      invalidate();
      setBulkResult(data);
      setTimeout(() => setBulkResult(null), 10000);
    },
  });

  // ── Drawer helpers ─────────────────────────────────────────────
  function openAdd() {
    setEditSlug(null);
    setEditIdentifier('');
    setFormName('');
    setFormAliases('');
    setFormCategories([]);
    setFormWebsite('');
    setOrigName('');
    setOrigAliases('');
    setOrigCategories([]);
    setOrigWebsite('');
    setConfirmAction(null);
    setConfirmInput('');
    setDrawerOpen(true);
  }

  function openEdit(brand: Brand) {
    setEditSlug(brand.slug);
    setEditIdentifier(brand.identifier || '');
    setFormName(brand.canonical_name);
    const aliasStr = brand.aliases.join(', ');
    setFormAliases(aliasStr);
    setFormCategories([...brand.categories]);
    setFormWebsite(brand.website || '');
    setOrigName(brand.canonical_name);
    setOrigAliases(aliasStr);
    setOrigCategories([...brand.categories]);
    setOrigWebsite(brand.website || '');
    setConfirmAction(null);
    setConfirmInput('');
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditSlug(null);
    setEditIdentifier('');
    setConfirmAction(null);
    setConfirmInput('');
  }

  function resetConfirm() {
    setConfirmAction(null);
    setConfirmInput('');
  }

  function handleSave() {
    const aliases = formAliases.split(',').map((a) => a.trim()).filter(Boolean);

    if (!editSlug) {
      // New brand — no confirmation needed
      addMut.mutate({ name: formName, aliases, categories: formCategories, website: formWebsite });
      return;
    }

    // Rename requires type-to-confirm with new slug
    if (isRename && confirmAction !== 'rename') {
      setConfirmAction('rename');
      setConfirmInput('');
      return;
    }

    // Non-rename changes require type-to-confirm with current slug
    if (!isRename && hasAnyChange && confirmAction !== 'save') {
      setConfirmAction('save');
      setConfirmInput('');
      return;
    }

    // Confirmation already shown — execute
    resetConfirm();
    updateMut.mutate({
      slug: editSlug,
      patch: { name: formName, aliases, categories: formCategories, website: formWebsite },
    });
  }

  function handleDelete() {
    if (!editSlug) return;
    if (confirmAction !== 'delete') {
      setConfirmAction('delete');
      setConfirmInput('');
      return;
    }
    resetConfirm();
    deleteMut.mutate(editSlug);
  }

  function toggleCategory(cat: string) {
    setFormCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
    resetConfirm();
  }

  const isFormValid = formName.trim().length > 0 && formCategories.length > 0;
  const isSaving = addMut.isPending || updateMut.isPending;
  const saveError = addMut.error || updateMut.error;

  // Confirmation phrases
  const renameConfirmPhrase = newSlugPreview;
  const deleteConfirmPhrase = editSlug || '';
  const saveConfirmPhrase = editSlug || '';

  // ── Available categories ───────────────────────────────────────
  const allCategories = useMemo(() => {
    const set = new Set<string>(categories);
    brands.forEach((b) => b.categories.forEach((c) => set.add(c)));
    return [...set].filter((cat) => cat && cat !== 'all').sort();
  }, [categories, brands]);

  const existingBrandSlugs = useMemo(() => {
    return new Set(allBrands.map((brand) => String(brand.slug || '').trim()).filter(Boolean));
  }, [allBrands]);

  const bulkPreviewRows = useMemo<BrandBulkPreviewRow[]>(() => {
    const rows: BrandBulkPreviewRow[] = [];
    const seenInPaste = new Set<string>();
    const lines = String(bulkText || '').split(/\r?\n/g);

    for (let i = 0; i < lines.length; i += 1) {
      const raw = String(lines[i] || '').trim();
      if (!raw) continue;

      const name = parseBulkBrandLine(raw);
      if (!name) {
        rows.push({
          rowNumber: i + 1,
          raw,
          name: '',
          slug: '',
          status: 'invalid',
          reason: 'Brand name required'
        });
        continue;
      }

      if (isBrandHeaderRow(name)) {
        rows.push({
          rowNumber: i + 1,
          raw,
          name,
          slug: '',
          status: 'invalid',
          reason: 'Header row'
        });
        continue;
      }

      const slug = slugify(name);
      if (!slug) {
        rows.push({
          rowNumber: i + 1,
          raw,
          name,
          slug: '',
          status: 'invalid',
          reason: 'Invalid brand name'
        });
        continue;
      }

      if (seenInPaste.has(slug)) {
        rows.push({
          rowNumber: i + 1,
          raw,
          name,
          slug,
          status: 'duplicate_in_paste',
          reason: 'Duplicate in pasted list'
        });
        continue;
      }
      seenInPaste.add(slug);

      if (existingBrandSlugs.has(slug)) {
        rows.push({
          rowNumber: i + 1,
          raw,
          name,
          slug,
          status: 'already_exists',
          reason: 'Already in registry'
        });
        continue;
      }

      rows.push({
        rowNumber: i + 1,
        raw,
        name,
        slug,
        status: 'ready',
        reason: 'Ready'
      });
    }

    return rows;
  }, [bulkText, existingBrandSlugs]);

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

  const bulkNamesToSubmit = useMemo(() => {
    return bulkPreviewRows
      .filter((row) => row.status === 'ready')
      .map((row) => row.name);
  }, [bulkPreviewRows]);

  function openBulkModal() {
    const defaultCategory = selectedCategory && selectedCategory !== 'all'
      ? selectedCategory
      : (allCategories[0] || '');
    setBulkCategory(defaultCategory);
    setBulkText('');
    setBulkOpen(true);
  }

  function closeBulkModal() {
    if (bulkMut.isPending) return;
    setBulkOpen(false);
  }

  function runBulkImport() {
    const category = String(bulkCategory || '').trim();
    if (!category || bulkNamesToSubmit.length === 0) return;
    bulkMut.mutate({ category, names: bulkNamesToSubmit });
  }

  // ── Impact summary helper ─────────────────────────────────────
  const totalProducts = impactData?.total_products ?? 0;
  const productsByCategory = impactData?.products_by_category ?? {};

  // ── Render ─────────────────────────────────────────────────────
  if (isLoading) return <Spinner />;

  return (
    <>
      <div className={`grid ${drawerOpen ? 'grid-cols-[1fr,400px]' : 'grid-cols-1'} gap-3`}>
      {/* Main panel */}
      <div className="space-y-3">
        {/* Header bar */}
        <div className={`${sectionCls} flex items-center justify-between`}>
          <div>
            <h3 className="text-sm font-semibold">Brand Registry</h3>
            <p className="text-xs text-gray-500 mt-0.5">{brands.length} brand{brands.length !== 1 ? 's' : ''} across all categories</p>
          </div>
          <div className="flex gap-2">
            <button onClick={openBulkModal} className={btnSecondary}>Bulk Paste</button>
            <button onClick={openAdd} className={btnPrimary}>+ Add Brand</button>
          </div>
        </div>

        {/* Rename result banner */}
        {renameResult && (
          <div className={`px-4 py-2 text-sm rounded ${
            renameResult.ok
              ? 'bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700'
              : 'bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700'
          }`}>
            Brand renamed: <strong>{renameResult.oldName}</strong> &rarr; <strong>{renameResult.newName}</strong>.
            {' '}Cascaded to <strong>{renameResult.cascaded_products}</strong> product{renameResult.cascaded_products !== 1 ? 's' : ''} (slugs rebuilt, artifacts migrated).
            {(renameResult.cascade_failures ?? 0) > 0 && (
              <span className="text-amber-700 dark:text-amber-300"> ({renameResult.cascade_failures} failed)</span>
            )}
            {' '}Identifier <span className="font-mono text-xs">{renameResult.identifier}</span> unchanged.
          </div>
        )}

        {/* Bulk import result banner */}
        {bulkResult && (
          <div className={`px-4 py-2 text-sm rounded ${
            (bulkResult.failed ?? 0) > 0 || !bulkResult.ok
              ? 'bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700'
              : 'bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700'
          }`}>
            Bulk brands: added <strong>{bulkResult.created ?? 0}</strong>
            {', '}existing <strong>{bulkResult.skipped_existing ?? 0}</strong>
            {', '}duplicates <strong>{bulkResult.skipped_duplicate ?? 0}</strong>
            {', '}invalid <strong>{bulkResult.invalid ?? 0}</strong>
            {', '}failed <strong>{bulkResult.failed ?? 0}</strong>.
            {' '}Total brands: <strong>{bulkResult.total_brands ?? allBrands.length}</strong>.
          </div>
        )}

        {/* Brand table */}
        <div className={sectionCls}>
          <DataTable
            data={brands}
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
            <h4 className="text-sm font-semibold">{editSlug ? 'Edit Brand' : 'Add Brand'}</h4>
            <button onClick={closeDrawer} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
          </div>

          {/* Name */}
          <div>
            <label className={labelCls}>Brand Name *</label>
            <input
              type="text"
              value={formName}
              onChange={(e) => { setFormName(e.target.value); resetConfirm(); }}
              placeholder="e.g. SteelSeries"
              className={`${inputCls} w-full`}
            />
            {editSlug && (
              <div className="mt-1 space-y-0.5">
                <p className="text-xs text-gray-400">
                  Slug: <span className="font-mono">{isSlugChange ? newSlugPreview : editSlug}</span>
                  {isSlugChange && <span className="text-amber-500 ml-1">(was: {editSlug})</span>}
                </p>
                {editIdentifier && (
                  <p className="text-xs text-gray-400">
                    Identifier: <span className="font-mono">{editIdentifier}</span>
                    <span className="text-gray-500 ml-1">(immutable)</span>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Aliases */}
          <div>
            <label className={labelCls}>Aliases (comma-separated)</label>
            <input
              type="text"
              value={formAliases}
              onChange={(e) => { setFormAliases(e.target.value); resetConfirm(); }}
              placeholder="e.g. SS, SteelSeries GG"
              className={`${inputCls} w-full`}
            />
          </div>

          {/* Categories */}
          <div>
            <label className={labelCls}>Categories *</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {allCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    formCategories.includes(cat)
                      ? 'bg-accent text-white border-accent'
                      : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-accent'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Website */}
          <div>
            <label className={labelCls}>Website</label>
            <input
              type="url"
              value={formWebsite}
              onChange={(e) => { setFormWebsite(e.target.value); resetConfirm(); }}
              placeholder="https://..."
              className={`${inputCls} w-full`}
            />
          </div>

          {/* ── Downstream Dependencies Panel ────────────────────────── */}
          {editSlug && (
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
                  {isRename ? 'Impact — Brand Rename' : hasAnyChange ? 'Downstream Impact' : 'Downstream Dependencies'}
                </span>
                <span className={`font-semibold tabular-nums ${
                  isRename ? 'text-red-700 dark:text-red-300'
                    : hasAnyChange ? 'text-amber-700 dark:text-amber-300'
                    : 'text-gray-600 dark:text-gray-400'
                }`}>
                  {totalProducts} product{totalProducts !== 1 ? 's' : ''} · {Object.keys(productsByCategory).length} categor{Object.keys(productsByCategory).length !== 1 ? 'ies' : 'y'}
                </span>
              </div>

              <div className="px-3 py-2 space-y-2">
                {/* Rename-specific: slug diff + what happens */}
                {isRename && (
                  <>
                    <div className="font-mono text-[11px]">
                      <span className="text-red-600 line-through">{editSlug}</span>
                      {' → '}
                      <span className="text-green-700 dark:text-green-400">{newSlugPreview}</span>
                    </div>
                    <details className="group">
                      <summary className="cursor-pointer select-none text-[11px] font-medium text-red-700 dark:text-red-300 hover:text-red-900 dark:hover:text-red-100">
                        What will happen
                      </summary>
                      <ul className="mt-1 ml-3 list-disc space-y-0.5 text-red-700 dark:text-red-300 text-[11px]">
                        <li>All product slugs under this brand rebuilt</li>
                        <li>All artifacts migrated per product (inputs, outputs, overrides, queue, published)</li>
                        <li>Old name &ldquo;{origName}&rdquo; added to aliases</li>
                        <li>Brand identifier <span className="font-mono">{editIdentifier}</span> unchanged</li>
                      </ul>
                    </details>
                  </>
                )}

                {/* Non-rename changes: summary */}
                {!isRename && hasAnyChange && (
                  <div className="space-y-0.5 text-amber-700 dark:text-amber-300 text-[11px]">
                    {isAliasChange && <p>Alias list will be updated</p>}
                    {isCategoryChange && <p>Category assignments will change</p>}
                    {isWebsiteChange && <p>Website URL will be updated</p>}
                    <p className="text-amber-600 dark:text-amber-400">No product slugs affected. Brand identifier unchanged.</p>
                  </div>
                )}

                {/* Per-category expandable file list — always shown */}
                {Object.entries(productsByCategory).map(([cat, count]) => {
                  const details = (impactData?.product_details ?? {})[cat] ?? [];
                  return (
                    <details key={cat} className="group">
                      <summary className="cursor-pointer select-none flex items-center gap-2 hover:opacity-80">
                        <span className={`font-medium ${isRename ? 'text-red-700 dark:text-red-300' : 'text-gray-600 dark:text-gray-300'}`}>{cat}</span>
                        <span className={`tabular-nums ${isRename ? 'text-red-500 dark:text-red-400' : 'text-gray-400'}`}>({count})</span>
                      </summary>
                      {details.length > 0 ? (
                        <div className="mt-1 ml-1 font-mono text-[10px] bg-white/60 dark:bg-gray-800/60 rounded p-1.5 max-h-[160px] overflow-y-auto space-y-px">
                          {details.map(pid => (
                            <div key={pid} className={isRename ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}>
                              {isRename && <span className="text-red-400 mr-1">~</span>}
                              specs/inputs/{cat}/products/<span className="font-semibold">{pid}</span>.json
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-1 ml-1 text-[10px] text-gray-400 italic">Loading product list...</p>
                      )}
                    </details>
                  );
                })}

                {/* Hint when no changes */}
                {!hasAnyChange && totalProducts > 0 && (
                  <p className="text-[10px] text-gray-400 pt-0.5">Renaming this brand will rebuild all product slugs above and migrate their artifacts.</p>
                )}
              </div>
            </div>
          )}

          {/* ── Rename Confirm Panel (red) ─────────────────────────── */}
          {confirmAction === 'rename' && (
            <div className="bg-red-50 dark:bg-red-900/30 border-2 border-red-400 dark:border-red-700 rounded p-3 space-y-2">
              <div className="text-sm font-bold text-red-800 dark:text-red-200">Confirm Brand Rename</div>
              <p className="text-xs text-red-700 dark:text-red-300">
                This will rename <strong>{origName}</strong> to <strong>{formName.trim()}</strong>,
                rebuild all product slugs under this brand, and migrate all artifacts.
                {totalProducts > 0 && <> <strong>{totalProducts}</strong> product{totalProducts !== 1 ? 's' : ''} will be affected.</>}
              </p>
              <p className="text-xs text-red-700 dark:text-red-300">To confirm, type the new brand slug below:</p>
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
                  {isSaving ? 'Renaming...' : 'I understand, rename this brand'}
                </button>
                <button onClick={resetConfirm} className={btnSecondary}>Cancel</button>
              </div>
            </div>
          )}

          {/* ── Save Confirm Panel (amber) ─────────────────────────── */}
          {confirmAction === 'save' && (
            <div className="bg-amber-50 dark:bg-amber-900/30 border-2 border-amber-400 dark:border-amber-700 rounded p-3 space-y-2">
              <div className="text-sm font-bold text-amber-800 dark:text-amber-200">Confirm Changes</div>
              <p className="text-xs text-amber-700 dark:text-amber-300">
                You are updating metadata for <strong>{formName.trim()}</strong>.
                {isAliasChange && ' Alias list will change.'}
                {isCategoryChange && ' Category assignments will change.'}
                {isWebsiteChange && ' Website URL will change.'}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300">To confirm, type the brand slug below:</p>
              <div className="font-mono text-xs bg-amber-100 dark:bg-amber-900/50 rounded px-2 py-1 text-amber-800 dark:text-amber-200 select-all">
                {saveConfirmPhrase}
              </div>
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="Type the slug to confirm"
                className="w-full px-2 py-1.5 text-sm font-mono border-2 border-amber-300 dark:border-amber-600 rounded bg-white dark:bg-gray-800 focus:border-amber-500 focus:outline-none"
                autoFocus
              />
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleSave}
                  disabled={confirmInput !== saveConfirmPhrase || isSaving}
                  className="px-3 py-1.5 text-xs font-semibold bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSaving ? 'Saving...' : 'Confirm save'}
                </button>
                <button onClick={resetConfirm} className={btnSecondary}>Cancel</button>
              </div>
            </div>
          )}

          {/* ── Delete Confirm Panel (red) ─────────────────────────── */}
          {confirmAction === 'delete' && (
            <div className="bg-red-50 dark:bg-red-900/30 border-2 border-red-400 dark:border-red-700 rounded p-3 space-y-2">
              <div className="text-sm font-bold text-red-800 dark:text-red-200">Confirm Delete</div>
              <p className="text-xs text-red-700 dark:text-red-300">
                Deleting <strong>{formName.trim()}</strong> will remove it from the brand registry.
                {totalProducts > 0 && (
                  <> <strong>{totalProducts}</strong> product{totalProducts !== 1 ? 's' : ''} will become orphaned
                    ({Object.entries(productsByCategory).map(([cat, count]) => `${cat}: ${count}`).join(', ')}).</>
                )}
              </p>
              <p className="text-xs text-red-700 dark:text-red-300">To confirm, type the brand slug below:</p>
              <div className="font-mono text-xs bg-red-100 dark:bg-red-900/50 rounded px-2 py-1 text-red-800 dark:text-red-200 select-all">
                {deleteConfirmPhrase}
              </div>
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="Type the slug to confirm"
                className="w-full px-2 py-1.5 text-sm font-mono border-2 border-red-300 dark:border-red-600 rounded bg-white dark:bg-gray-800 focus:border-red-500 focus:outline-none"
                autoFocus
              />
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { resetConfirm(); if (editSlug) deleteMut.mutate(editSlug); }}
                  disabled={confirmInput !== deleteConfirmPhrase || deleteMut.isPending}
                  className="px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deleteMut.isPending ? 'Deleting...' : 'I understand, delete this brand'}
                </button>
                <button onClick={resetConfirm} className={btnSecondary}>Cancel</button>
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
                  disabled={!isFormValid || isSaving || (editSlug ? !hasAnyChange : false)}
                  className={isRename ? btnDanger : btnPrimary}
                >
                  {isSaving ? 'Saving...' : editSlug ? (isRename ? 'Rename & Migrate' : 'Save Changes') : 'Add Brand'}
                </button>
                {editSlug && (
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
          <div className="w-full max-w-4xl max-h-[92vh] overflow-hidden bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold">Bulk Paste Brands</h4>
                <p className="text-xs text-gray-500 mt-0.5">Paste a single column of brand names, one per line.</p>
              </div>
              <button
                onClick={closeBulkModal}
                disabled={bulkMut.isPending}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none disabled:opacity-40"
                aria-label="Close bulk brand modal"
              >
                &times;
              </button>
            </div>

            <div className="p-4 space-y-3 overflow-auto">
              <div className="grid grid-cols-1 md:grid-cols-[220px,1fr] gap-3 items-end">
                <div>
                  <label className={labelCls}>Category *</label>
                  <select
                    value={bulkCategory}
                    onChange={(e) => setBulkCategory(e.target.value)}
                    disabled={bulkMut.isPending}
                    className={`${inputCls} w-full`}
                  >
                    <option value="">Select category...</option>
                    {allCategories.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div className="text-xs text-gray-500">
                  Existing brands are skipped and category membership is merged when needed.
                </div>
              </div>

              <div>
                <label className={labelCls}>Brand Names (Single Column)</label>
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={'Razer\nLogitech\nSteelSeries'}
                  rows={10}
                  disabled={bulkMut.isPending}
                  className={`${inputCls} w-full resize-y font-mono text-xs leading-5`}
                />
              </div>

              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-1 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">Ready: {bulkCounts.ready}</span>
                <span className="px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">Existing: {bulkCounts.existing}</span>
                <span className="px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">Duplicates: {bulkCounts.duplicate}</span>
                <span className="px-2 py-1 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">Invalid: {bulkCounts.invalid}</span>
                <span className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">Rows: {bulkPreviewRows.length}</span>
              </div>

              <div className="border border-gray-200 dark:border-gray-700 rounded overflow-auto max-h-[34vh]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900/70 border-b border-gray-200 dark:border-gray-700">
                    <tr>
                      <th className="text-left px-2 py-1.5 w-12">#</th>
                      <th className="text-left px-2 py-1.5">Brand</th>
                      <th className="text-left px-2 py-1.5">Slug</th>
                      <th className="text-left px-2 py-1.5 w-40">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkPreviewRows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-2 py-3 text-gray-500 text-center">Paste brands to preview import results.</td>
                      </tr>
                    )}
                    {bulkPreviewRows.map((row) => {
                      const statusCls = row.status === 'ready'
                        ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                        : row.status === 'already_exists'
                          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                          : row.status === 'duplicate_in_paste'
                            ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                            : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300';
                      return (
                        <tr key={`${row.rowNumber}-${row.slug}-${row.raw}`} className="border-b border-gray-100 dark:border-gray-700/50">
                          <td className="px-2 py-1.5 text-gray-500">{row.rowNumber}</td>
                          <td className="px-2 py-1.5">{row.name || <span className="italic text-gray-400">-</span>}</td>
                          <td className="px-2 py-1.5 font-mono text-[11px] text-gray-600 dark:text-gray-300">{row.slug || <span className="italic text-gray-400">-</span>}</td>
                          <td className="px-2 py-1.5">
                            <span className={`inline-block px-2 py-0.5 rounded-full ${statusCls}`}>{row.reason}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {bulkMut.error && (
                <div className="px-3 py-2 text-xs rounded bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300">
                  Bulk brand import failed: {(bulkMut.error as Error).message}
                </div>
              )}

              {bulkMut.data?.results && bulkMut.data.results.length > 0 && (
                <details className="text-xs border border-gray-200 dark:border-gray-700 rounded">
                  <summary className="cursor-pointer px-3 py-2 bg-gray-50 dark:bg-gray-900/60 font-medium">
                    Last run details ({bulkMut.data.results.length} rows)
                  </summary>
                  <div className="max-h-40 overflow-auto p-2 space-y-1">
                    {bulkMut.data.results.slice(0, 50).map((row, idx) => (
                      <div key={`${idx}-${row.index}-${row.slug || ''}`} className="font-mono text-[11px] text-gray-700 dark:text-gray-300">
                        {`[${row.index + 1}] ${row.name} -> ${row.status}${row.reason ? ` (${row.reason})` : ''}`}
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
                Ready brands will be added under <strong>{bulkCategory || 'selected category'}</strong>.
              </div>
              <div className="flex gap-2">
                <button onClick={closeBulkModal} disabled={bulkMut.isPending} className={btnSecondary}>
                  Close
                </button>
                <button
                  onClick={runBulkImport}
                  disabled={bulkMut.isPending || !bulkCategory.trim() || bulkNamesToSubmit.length === 0}
                  className={btnPrimary}
                >
                  {bulkMut.isPending ? 'Importing...' : `Import ${bulkNamesToSubmit.length} Ready Brand${bulkNamesToSubmit.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
