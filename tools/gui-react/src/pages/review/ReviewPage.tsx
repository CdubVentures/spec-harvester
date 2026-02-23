import { useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useHotkeys } from 'react-hotkeys-hook';
import { api } from '../../api/client';
import { useUiStore } from '../../stores/uiStore';
import { useReviewStore } from '../../stores/reviewStore';
import type { SortMode } from '../../stores/reviewStore';
import { ReviewMatrix } from './ReviewMatrix';
import { CellDrawer } from '../../components/common/CellDrawer';
import { FlagsSection } from '../../components/common/FlagsSection';
import { BrandFilterBar } from './BrandFilterBar';
import { MetricRow } from '../../components/common/MetricRow';
import { Spinner } from '../../components/common/Spinner';
import { pct } from '../../utils/formatting';
import { hasKnownValue } from '../../utils/fieldNormalize';
import { useFieldLabels } from '../../hooks/useFieldLabels';
import { useDebouncedCallback } from '../../hooks/useDebounce';
import type { ReviewLayout, ProductReviewPayload, ProductsIndexResponse, CandidateResponse, ReviewCandidate } from '../../types/review';
import type { CatalogRow } from '../../types/product';
import type { KeyReviewLaneState } from '../../types/review';

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'brand', label: 'Brand' },
  { value: 'recent', label: 'Recent' },
  { value: 'confidence', label: 'Confidence' },
  { value: 'flags', label: 'Flags' },
];

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function candidateSourceLabel(candidate: ReviewCandidate | null | undefined): string {
  if (!candidate) return '';
  const explicitSource = String(candidate.source || '').trim();
  if (explicitSource) return explicitSource;
  const sourceId = String(candidate.source_id || '').trim().toLowerCase();
  if (sourceId === 'pipeline') return 'Pipeline';
  if (sourceId === 'reference') return 'Reference';
  if (sourceId === 'user') return 'user';
  if (sourceId) return sourceId;
  const evidenceUrl = String(candidate.evidence?.url || '').trim();
  return evidenceUrl ? hostFromUrl(evidenceUrl) : '';
}

function toPositiveId(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const id = Math.trunc(n);
  return id > 0 ? id : null;
}

export function ReviewPage() {
  const category = useUiStore((s) => s.category);
  const { getLabel } = useFieldLabels(category);
  const {
    activeCell, drawerOpen, openDrawer, closeDrawer,
    setFlaggedCells, nextFlagged, prevFlagged,
    selectedProductId, selectedField,
    cellMode, editingValue, originalEditingValue, saveStatus,
    selectCell, startEditing, cancelEditing, setEditingValue, commitEditing, setSaveStatus,
    brandFilter, setAvailableBrands,
    sortMode, setSortMode, showOnlyFlagged, setShowOnlyFlagged,
  } = useReviewStore();
  const queryClient = useQueryClient();
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: layout } = useQuery({
    queryKey: ['reviewLayout', category],
    queryFn: () => api.get<ReviewLayout>(`/review/${category}/layout`),
  });

  // Products index — ALL products without candidates, sorted by brand
  const { data: indexData, isLoading } = useQuery({
    queryKey: ['reviewProductsIndex', category],
    queryFn: () => api.get<ProductsIndexResponse>(`/review/${category}/products-index`),
  });

  const { data: catalogRows } = useQuery({
    queryKey: ['catalog-review', category],
    queryFn: () => api.get<CatalogRow[]>(`/catalog/${category}/products`),
    enabled: category !== 'all',
  });

  // Candidates query for the active drawer cell
  const { data: candidateData, isLoading: candidatesLoading } = useQuery({
    queryKey: ['candidates', category, selectedProductId, selectedField],
    queryFn: () => api.get<CandidateResponse>(`/review/${category}/candidates/${selectedProductId}/${selectedField}`),
    staleTime: 60_000,
    enabled: drawerOpen && !!selectedProductId && !!selectedField,
  });

  // Sync available brands from index response
  useEffect(() => {
    if (indexData?.brands) {
      setAvailableBrands(indexData.brands);
    }
  }, [indexData?.brands, setAvailableBrands]);

  // Auto-clear "saved" status after 2 seconds
  useEffect(() => {
    if (saveStatus === 'saved') {
      savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
      return () => {
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      };
    }
  }, [saveStatus, setSaveStatus]);

  // Client-side brand filtering + flagged filter + sorting
  const products = useMemo(() => {
    if (!indexData?.products) return [];
    let filtered = indexData.products;

    // Brand filter
    if (brandFilter.mode === 'none') return [];
    if (brandFilter.mode === 'custom') {
      filtered = filtered.filter((p) => {
        const brand = (p.identity?.brand || '').trim();
        return brandFilter.selected.has(brand);
      });
    }

    // Flagged-only filter
    if (showOnlyFlagged) {
      filtered = filtered.filter((p) => p.metrics.flags > 0);
    }

    // Sort
    const sorted = [...filtered];
    switch (sortMode) {
      case 'recent':
        sorted.sort((a, b) => {
          const tA = new Date(a.metrics.updated_at || 0).getTime();
          const tB = new Date(b.metrics.updated_at || 0).getTime();
          return tB - tA;
        });
        break;
      case 'confidence':
        sorted.sort((a, b) => a.metrics.confidence - b.metrics.confidence);
        break;
      case 'flags':
        sorted.sort((a, b) => b.metrics.flags - a.metrics.flags);
        break;
      case 'brand':
      default:
        sorted.sort((a, b) => {
          const brandA = String(a.identity?.brand || '').toLowerCase();
          const brandB = String(b.identity?.brand || '').toLowerCase();
          if (brandA !== brandB) return brandA.localeCompare(brandB);
          const modelA = String(a.identity?.model || '').toLowerCase();
          const modelB = String(b.identity?.model || '').toLowerCase();
          return modelA.localeCompare(modelB);
        });
        break;
    }
    return sorted;
  }, [indexData?.products, brandFilter, sortMode, showOnlyFlagged]);

  // Build flagged cells list
  useEffect(() => {
    if (!layout || !products.length) return;
    const flagged: { productId: string; field: string }[] = [];
    for (const p of products) {
      for (const row of layout.rows) {
        const state = p.fields[row.key];
        if (state?.needs_review) {
          flagged.push({ productId: p.product_id, field: row.key });
        }
      }
    }
    setFlaggedCells(flagged);
  }, [layout, products, setFlaggedCells]);

  // Single click = select + edit + open drawer.
  // Uses getState() / getQueryData() to avoid stale closure deps that would cause
  // unnecessary ReviewMatrix re-renders (and potential virtualizer remounts).
  const handleCellClick = useCallback((productId: string, field: string) => {
    const { activeCell: currentCell, cellMode: currentMode } = useReviewStore.getState();
    if (currentCell?.productId === productId && currentCell?.field === field && currentMode === 'editing') {
      return;
    }
    selectCell(productId, field);
    openDrawer(productId, field);
    // Read current value from the query cache directly (no dep on indexData)
    const cached = queryClient.getQueryData<ProductsIndexResponse>(['reviewProductsIndex', category]);
    const product = cached?.products?.find(p => p.product_id === productId);
    const currentValue = product?.fields[field]?.selected.value;
    startEditing(currentValue != null ? String(currentValue) : '');
  }, [selectCell, openDrawer, startEditing, queryClient, category]);

  // Start editing from keydown (typing in selected cell)
  const handleStartEditing = useCallback((productId: string, field: string, initialValue: string) => {
    selectCell(productId, field);
    startEditing(initialValue);
  }, [selectCell, startEditing]);

  // Override mutation
  const overrideMut = useMutation({
    mutationFn: (body: {
      productId: string;
      field: string;
      itemFieldStateId?: number | null;
      candidateId?: string;
      value?: string;
      candidateSource?: string;
      candidateMethod?: string;
      candidateTier?: number | null;
      candidateConfidence?: number;
      candidateEvidence?: ReviewCandidate['evidence'];
    }) =>
      api.post(`/review/${category}/override`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
      queryClient.invalidateQueries({ queryKey: ['catalog', category] });
      queryClient.invalidateQueries({ queryKey: ['product', category] });
    },
  });

  // Manual override mutation (for inline edits)
  const manualOverrideMut = useMutation({
    mutationFn: (body: { productId: string; field: string; value: string; itemFieldStateId?: number | null }) =>
      api.post(`/review/${category}/manual-override`, body),
    onSuccess: () => {
      setSaveStatus('saved');
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
      queryClient.invalidateQueries({ queryKey: ['catalog', category] });
      queryClient.invalidateQueries({ queryKey: ['product', category] });
    },
    onError: () => {
      setSaveStatus('error');
    },
  });

  const finalizeMut = useMutation({
    mutationFn: (productId: string) => api.post(`/review/${category}/finalize`, { productId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
      queryClient.invalidateQueries({ queryKey: ['catalog', category] });
      queryClient.invalidateQueries({ queryKey: ['product', category] });
    },
  });

  const runGridAiReviewMut = useMutation({
    mutationFn: () =>
      api.post(`/review-components/${category}/run-component-review-batch`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['componentReview', category] });
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
      queryClient.invalidateQueries({ queryKey: ['candidates', category] });
    },
  });

  // Two-lane key review mutations
  type KeyReviewLaneMutation = {
    lane: 'primary' | 'shared';
    id?: number;
    itemFieldStateId?: number;
    productId?: string;
    field?: string;
    candidateId?: string;
    candidateValue?: string;
    candidateConfidence?: number;
  };

  const confirmKeyReviewMut = useMutation({
    mutationFn: (body: KeyReviewLaneMutation) =>
      api.post(`/review/${category}/key-review-confirm`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
      queryClient.invalidateQueries({ queryKey: ['candidates', category] });
      queryClient.invalidateQueries({ queryKey: ['componentReview', category] });
      queryClient.invalidateQueries({ queryKey: ['componentReviewData', category] });
      queryClient.invalidateQueries({ queryKey: ['enumReviewData', category] });
    },
  });

  const acceptKeyReviewMut = useMutation({
    mutationFn: (body: KeyReviewLaneMutation) =>
      api.post(`/review/${category}/key-review-accept`, body),
    onMutate: (body) => {
      if (!body) return;
      const lane = body.lane === 'shared' ? 'shared' : 'primary';
      const productId = String(body.productId || selectedProductId || '').trim();
      const field = String(body.field || selectedField || '').trim();
      if (!productId || !field) return;
      queryClient.setQueryData<ProductsIndexResponse>(
        ['reviewProductsIndex', category],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            products: old.products.map((p) => {
              if (p.product_id !== productId) return p;
              const existing = p.fields[field];
              if (!existing) return p;
              const keyReview = (existing.keyReview || {}) as Partial<KeyReviewLaneState>;
              return {
                ...p,
                fields: {
                  ...p.fields,
                  [field]: {
                    ...existing,
                    keyReview: {
                      ...keyReview,
                      selectedCandidateId: body.candidateId ?? keyReview.selectedCandidateId ?? null,
                      ...(lane === 'primary'
                        ? { userAcceptPrimary: 'accepted' }
                        : { userAcceptShared: 'accepted' }),
                    } as KeyReviewLaneState,
                  },
                },
              };
            }),
          };
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
      queryClient.invalidateQueries({ queryKey: ['candidates', category] });
      queryClient.invalidateQueries({ queryKey: ['componentReview', category] });
      queryClient.invalidateQueries({ queryKey: ['componentReviewData', category] });
      queryClient.invalidateQueries({ queryKey: ['enumReviewData', category] });
    },
  });

  // Optimistically update the products-index cache so the grid reflects changes instantly.
  // Accepts optional source metadata to preserve provenance from candidates or mark as 'user'.
  const optimisticUpdateField = useCallback((
    productId: string,
    field: string,
    value: string,
    sourceMeta?: { source?: string; method?: string; tier?: number | null; acceptedCandidateId?: string | null },
    keyReviewMeta?: Partial<KeyReviewLaneState>,
  ) => {
    // Only show OVR badge for manual entry, not for candidate acceptance
    const isManualOverride = sourceMeta?.method === 'manual_override';
    const now = new Date().toISOString();
    queryClient.setQueryData<ProductsIndexResponse>(
      ['reviewProductsIndex', category],
      (old) => {
        if (!old) return old;
        return {
          ...old,
          products: old.products.map((p) => {
            if (p.product_id !== productId) return p;
            const existing = p.fields[field] || { candidate_count: 0, candidates: [] };
            const existingKeyReview = (existing.keyReview || {}) as Partial<KeyReviewLaneState>;
            return {
              ...p,
              fields: {
                ...p.fields,
                [field]: {
                  ...existing,
                  selected: {
                    value,
                    confidence: 1.0,
                    status: 'ok',
                    color: 'green' as const,
                  },
                  needs_review: false,
                  reason_codes: [],
                  overridden: isManualOverride,
                  source_timestamp: now,
                  // Update source metadata if provided, otherwise preserve existing
                  ...(sourceMeta?.source !== undefined ? { source: sourceMeta.source } : {}),
                  ...(sourceMeta?.method !== undefined ? { method: sourceMeta.method } : {}),
                  ...(sourceMeta?.tier !== undefined ? { tier: sourceMeta.tier } : {}),
                  ...(sourceMeta?.acceptedCandidateId !== undefined ? { accepted_candidate_id: sourceMeta.acceptedCandidateId } : {}),
                  ...(keyReviewMeta ? { keyReview: { ...existingKeyReview, ...keyReviewMeta } as KeyReviewLaneState } : {}),
                },
              },
            };
          }),
        };
      },
    );
  }, [queryClient, category]);

  // Core save logic — shared by debounced autosave and immediate commit
  const saveEdit = useCallback((productId: string, field: string, value: string, originalValue: string) => {
    if (value === originalValue) return;
    const cached = queryClient.getQueryData<ProductsIndexResponse>(['reviewProductsIndex', category]);
    const slotId = toPositiveId(
      cached?.products?.find((p) => p.product_id === productId)?.fields?.[field]?.slot_id ?? null,
    );
    if (!slotId) {
      setSaveStatus('error');
      return;
    }

    // Inline text edits are always manual overrides.
    optimisticUpdateField(
      productId,
      field,
      value,
      { source: 'user', method: 'manual_override', acceptedCandidateId: null },
      { selectedCandidateId: null, userAcceptPrimary: 'accepted', primaryStatus: null },
    );
    setSaveStatus('saving');
    manualOverrideMut.mutate({ productId, field, value, itemFieldStateId: slotId });
  }, [manualOverrideMut, setSaveStatus, optimisticUpdateField, queryClient, category]);

  // Debounced autosave for inline editing (fires while user is still typing)
  const debouncedSave = useDebouncedCallback(saveEdit, 1500);

  // Stable commit/cancel callbacks for ReviewMatrix (use getState to avoid closure deps)
  const handleCommitEditing = useCallback(() => {
    debouncedSave.cancel();
    const { activeCell: cell, editingValue: val, originalEditingValue: orig } = useReviewStore.getState();
    if (cell) saveEdit(cell.productId, cell.field, val, orig);
    commitEditing();
  }, [debouncedSave, saveEdit, commitEditing]);

  const handleCancelEditing = useCallback(() => {
    debouncedSave.cancel();
    cancelEditing();
  }, [debouncedSave, cancelEditing]);

  // Trigger autosave when editingValue changes
  useEffect(() => {
    if (cellMode === 'editing' && saveStatus === 'unsaved' && activeCell) {
      debouncedSave.fn(activeCell.productId, activeCell.field, editingValue, originalEditingValue);
    }
  }, [cellMode, saveStatus, editingValue, originalEditingValue, activeCell, debouncedSave]);

  // Approve all greens for a product
  const approveAllGreens = useCallback(() => {
    if (!products.length || !layout) return;
    for (const p of products) {
      for (const row of layout.rows) {
        const state = p.fields[row.key];
        const slotId = toPositiveId(state?.slot_id);
        if (state?.selected.color === 'green' && state.needs_review && slotId) {
          overrideMut.mutate({
            productId: p.product_id,
            field: row.key,
            itemFieldStateId: slotId,
            candidateId: state.candidates[0]?.candidate_id,
            value: state.candidates[0]?.value != null ? String(state.candidates[0]?.value) : undefined,
          });
        }
      }
    }
  }, [products, layout, overrideMut]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────

  // Tab: if editing → commit + move next; otherwise → next flagged
  useHotkeys('tab', (e) => {
    e.preventDefault();
    if (cellMode === 'editing') {
      debouncedSave.cancel();
      if (activeCell) saveEdit(activeCell.productId, activeCell.field, editingValue, originalEditingValue);
      commitEditing();
    }
    nextFlagged();
  }, { enableOnFormTags: true }, [cellMode, activeCell, editingValue, originalEditingValue, nextFlagged, commitEditing, debouncedSave, saveEdit]);

  useHotkeys('shift+tab', (e) => { e.preventDefault(); prevFlagged(); }, { enableOnFormTags: false }, [prevFlagged]);

  // Escape: if editing → cancel edit; if drawer open → close drawer
  useHotkeys('escape', () => {
    if (cellMode === 'editing') {
      debouncedSave.cancel();
      cancelEditing();
    } else if (drawerOpen) {
      closeDrawer();
    }
  }, { enableOnFormTags: true }, [cellMode, drawerOpen, cancelEditing, closeDrawer, debouncedSave]);

  // Space: open drawer for selected cell (if not already open)
  useHotkeys('space', (e) => {
    if (activeCell && !drawerOpen && cellMode !== 'editing') {
      e.preventDefault();
      openDrawer(activeCell.productId, activeCell.field);
    }
  }, { enableOnFormTags: false }, [activeCell, drawerOpen, cellMode, openDrawer]);

  // F2: enter edit mode for selected cell
  useHotkeys('f2', (e) => {
    if (activeCell && cellMode === 'selected') {
      e.preventDefault();
      const product = products.find(p => p.product_id === activeCell.productId);
      const currentValue = product?.fields[activeCell.field]?.selected.value;
      startEditing(currentValue != null ? String(currentValue) : '');
    }
  }, { enableOnFormTags: false }, [activeCell, cellMode, products, startEditing]);

  // Enter: if editing → commit; if selected → approve top candidate
  useHotkeys('enter', () => {
    if (cellMode === 'editing') {
      debouncedSave.cancel();
      if (activeCell) saveEdit(activeCell.productId, activeCell.field, editingValue, originalEditingValue);
      commitEditing();
      return;
    }
    if (!activeCell || !products.length) return;
    const product = products.find(p => p.product_id === activeCell.productId);
    if (!product) return;
    const state = product.fields[activeCell.field];
    if (!state || state.candidates.length === 0) return;
    const slotId = toPositiveId(state.slot_id);
    if (!slotId) return;
    const topCand = state.candidates[0];
    optimisticUpdateField(
      activeCell.productId,
      activeCell.field,
      String(topCand.value ?? ''),
      { source: topCand.source || '', method: topCand.method || undefined, tier: topCand.tier },
      { selectedCandidateId: topCand.candidate_id, userAcceptPrimary: 'accepted' },
    );
    overrideMut.mutate({
      productId: activeCell.productId,
      field: activeCell.field,
      itemFieldStateId: slotId,
      candidateId: topCand.candidate_id,
      value: String(topCand.value ?? ''),
      candidateSource: topCand.source_id || topCand.source || '',
      candidateMethod: topCand.method || undefined,
      candidateTier: topCand.tier,
      candidateConfidence: Number(topCand.score ?? 0),
      candidateEvidence: topCand.evidence,
    });
  }, { enableOnFormTags: true }, [cellMode, activeCell, editingValue, originalEditingValue, products, overrideMut, commitEditing, debouncedSave, saveEdit, optimisticUpdateField]);

  useHotkeys('ctrl+a', (e) => { e.preventDefault(); approveAllGreens(); }, [approveAllGreens]);

  // Ctrl+S: save any pending edit
  useHotkeys('ctrl+s', (e) => {
    e.preventDefault();
    if (cellMode === 'editing') {
      debouncedSave.cancel();
      if (activeCell) saveEdit(activeCell.productId, activeCell.field, editingValue, originalEditingValue);
      commitEditing();
    } else if (selectedProductId) {
      finalizeMut.mutate(selectedProductId);
    }
  }, { enableOnFormTags: true }, [cellMode, activeCell, editingValue, originalEditingValue, selectedProductId, finalizeMut, commitEditing, debouncedSave, saveEdit]);

  // E: open evidence URL for active cell's top candidate
  useHotkeys('e', () => {
    if (cellMode === 'editing') return;
    if (!activeCell || !products.length) return;
    const product = products.find(p => p.product_id === activeCell.productId);
    if (!product) return;
    const state = product.fields[activeCell.field];
    const url = state?.candidates[0]?.evidence?.url;
    if (url) window.open(url, '_blank');
  }, { enableOnFormTags: false }, [activeCell, products, cellMode]);

  // 1-9 candidate shortcuts
  useHotkeys('1,2,3,4,5,6,7,8,9', (e) => {
    if (cellMode === 'editing') return;
    if (!activeCell || !products.length) return;
    const idx = parseInt(e.key) - 1;
    const product = products.find(p => p.product_id === activeCell.productId);
    if (!product) return;
    const state = product.fields[activeCell.field];
    if (!state || idx >= state.candidates.length) return;
    const slotId = toPositiveId(state.slot_id);
    if (!slotId) return;
    const cand = state.candidates[idx];
    optimisticUpdateField(
      activeCell.productId,
      activeCell.field,
      String(cand.value ?? ''),
      { source: cand.source || '', method: cand.method || undefined, tier: cand.tier },
      { selectedCandidateId: cand.candidate_id, userAcceptPrimary: 'accepted' },
    );
    overrideMut.mutate({
      productId: activeCell.productId,
      field: activeCell.field,
      itemFieldStateId: slotId,
      candidateId: cand.candidate_id,
      value: String(cand.value ?? ''),
      candidateSource: cand.source_id || cand.source || '',
      candidateMethod: cand.method || undefined,
      candidateTier: cand.tier,
      candidateConfidence: Number(cand.score ?? 0),
      candidateEvidence: cand.evidence,
    });
  }, { enableOnFormTags: false }, [activeCell, products, overrideMut, cellMode, optimisticUpdateField]);

  // Finalize All mutation
  const finalizeAllMut = useMutation({
    mutationFn: () => api.post(`/review/${category}/finalize-all`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
      queryClient.invalidateQueries({ queryKey: ['catalog', category] });
      queryClient.invalidateQueries({ queryKey: ['product', category] });
    },
  });

  // Aggregate metrics — use run-only metrics from server if available
  const metrics = useMemo(() => {
    if (!indexData) return null;
    const mr = indexData.metrics_run;
    if (mr && mr.count > 0) {
      return { confidence: mr.confidence, coverage: mr.coverage, flags: mr.flags, missing: mr.missing, count: mr.count };
    }
    // Fallback: compute from filtered products
    if (!products.length) return null;
    const totalConf = products.reduce((s, p) => s + p.metrics.confidence, 0) / products.length;
    const totalCov = products.reduce((s, p) => s + p.metrics.coverage, 0) / products.length;
    const totalFlags = products.reduce((s, p) => s + p.metrics.flags, 0);
    const totalMissing = products.reduce((s, p) => s + (p.metrics.missing || 0), 0);
    return { confidence: totalConf, coverage: totalCov, flags: totalFlags, missing: totalMissing, count: products.length };
  }, [indexData, products]);

  // Active product for drawer
  const activeProduct = products.find(p => p.product_id === selectedProductId);
  const activeFieldState = activeProduct?.fields[selectedField];

  if (category === 'all') {
    return <p className="text-gray-500 mt-8 text-center">Select a specific category from the sidebar to review products.</p>;
  }
  if (isLoading) return <Spinner className="h-8 w-8 mx-auto mt-12" />;
  if (!layout || !indexData || indexData.total === 0) {
    const hasCatalog = catalogRows && catalogRows.length > 0;
    return (
      <p className="text-gray-500 mt-8 text-center">
        {hasCatalog
          ? 'No review data yet. Run products from Indexing Lab first.'
          : 'No products in catalog. Add products from the Catalog tab before reviewing.'}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* Top bar: metrics + actions */}
      <div className="flex items-center justify-between">
        {metrics && (
          <MetricRow
            metrics={[
              { label: 'Products', value: `${metrics.count}/${indexData.total}` },
              { label: 'Avg Confidence', value: pct(metrics.confidence) },
              { label: 'Avg Coverage', value: pct(metrics.coverage) },
              { label: 'Flags', value: metrics.flags },
              { label: 'Missing', value: metrics.missing },
            ]}
          />
        )}
        <div className="flex gap-2 items-center">
          {/* Sort dropdown */}
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="px-2 py-1 text-[10px] border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>Sort: {opt.label}</option>
            ))}
          </select>

          {/* Flagged Only toggle */}
          <button
            onClick={() => setShowOnlyFlagged(!showOnlyFlagged)}
            className={`px-2 py-1 text-[10px] rounded border ${
              showOnlyFlagged
                ? 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-400 text-yellow-700 dark:text-yellow-300'
                : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400'
            }`}
          >
            Flagged Only
          </button>

          {saveStatus === 'saving' && <span className="text-[10px] text-blue-500">Saving...</span>}
          {saveStatus === 'saved' && <span className="text-[10px] text-green-500">Saved</span>}
          {saveStatus === 'error' && <span className="text-[10px] text-red-500">Save failed</span>}
          <button
            onClick={approveAllGreens}
            className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700"
            title="Ctrl+A: Approve all green cells"
          >
            Approve Greens
          </button>
          {selectedProductId && (
            <button
              onClick={() => finalizeMut.mutate(selectedProductId)}
              disabled={finalizeMut.isPending}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Finalize {activeProduct?.identity.brand} {activeProduct?.identity.model}
            </button>
          )}
          <button
            onClick={() => finalizeAllMut.mutate()}
            disabled={finalizeAllMut.isPending}
            className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
          >
            {finalizeAllMut.isPending ? 'Finalizing...' : 'Finalize All'}
          </button>
        </div>
      </div>

      {/* Brand filter bar */}
      <BrandFilterBar brands={indexData.brands} products={indexData.products} />

      {/* Keyboard hint */}
      <div className="text-[10px] text-gray-400 flex flex-wrap gap-x-4 gap-y-0.5">
        <span>Click: edit + drawer</span>
        <span>F2/type: edit</span>
        <span>Tab/Shift+Tab: flags</span>
        <span>Enter: approve/commit</span>
        <span>1-9: candidate</span>
        <span>E: evidence URL</span>
        <span>Ctrl+A: approve greens</span>
        <span>Ctrl+S: save/finalize</span>
        <span>Space: drawer</span>
        <span>Esc: cancel/close</span>
      </div>

      {/* Main content: matrix + drawer */}
      <div className={`grid ${drawerOpen ? 'grid-cols-[1fr,420px]' : 'grid-cols-1'} gap-3`}>
        <ReviewMatrix
          layout={layout}
          products={products}
          onCellClick={handleCellClick}
          activeCell={activeCell}
          cellMode={cellMode}
          editingValue={editingValue}
          onEditingValueChange={setEditingValue}
          onCommitEditing={handleCommitEditing}
          onCancelEditing={handleCancelEditing}
          onStartEditing={handleStartEditing}
        />

        {drawerOpen && activeProduct && activeFieldState && (() => {
          const drawerCandidates = candidateData?.candidates ?? activeFieldState.candidates ?? [];
          const currentSource = activeFieldState.source
            || candidateSourceLabel(drawerCandidates.find((candidate) => candidateSourceLabel(candidate)) ?? drawerCandidates[0]);
          const selectedValueStr = String(activeFieldState.selected.value ?? '').trim().toLowerCase();
          const hasValue = hasKnownValue(activeFieldState.selected.value);
          const activeSlotId = toPositiveId(activeFieldState.slot_id);
          const canMutateActiveSlot = Boolean(activeSlotId);
          const kr = activeFieldState.keyReview ?? candidateData?.keyReview ?? null;
          const actionableCandidates = drawerCandidates.filter((candidate) => {
            const candidateId = String(candidate?.candidate_id || '').trim();
            return Boolean(candidateId) && hasKnownValue(candidate?.value);
          });
          const isAccepted = hasValue
            && !activeFieldState.needs_review
            && !activeFieldState.overridden
            && (
              Boolean(activeFieldState.accepted_candidate_id)
              || String(kr?.userAcceptPrimary || '').trim().toLowerCase() === 'accepted'
              || activeFieldState.source === 'reference'
              || activeFieldState.source === 'manual'
              || activeFieldState.source === 'user'
            );
          const canAcceptCurrent = hasValue && !isAccepted && canMutateActiveSlot;
          // Grid intentionally stays item-lane only (no shared-lane overlays/actions in this surface).
          const hasPendingAIShared = false;
          const enrichedCandidates = drawerCandidates;
          const pendingPrimaryCandidateIds = (() => {
            const pendingIds = actionableCandidates
              .filter((candidate) => !candidate?.is_synthetic_selected)
              .filter((candidate) => {
                const status = String(candidate?.primary_review_status || '').trim().toLowerCase();
                return !status || status === 'pending';
              })
              .map((candidate) => String(candidate?.candidate_id || '').trim())
              .filter(Boolean);
            return [...new Set(pendingIds)];
          })();
          const hasPendingAIPrimary = pendingPrimaryCandidateIds.length > 0;
          const pendingSharedCandidateIds: string[] = [];
          const pendingPrimaryCandidateId = pendingPrimaryCandidateIds[0] || null;
          const pendingSharedCandidateId = null;

          return (
            <CellDrawer
              title={getLabel(selectedField)}
              subtitle={`${activeProduct.identity.brand} ${activeProduct.identity.model}${activeProduct.identity.id ? ` #${activeProduct.identity.id}` : ''}`}
              onClose={closeDrawer}
              currentValue={{
                value: activeFieldState.selected.value != null ? String(activeFieldState.selected.value) : '',
                confidence: activeFieldState.selected.confidence,
                color: activeFieldState.selected.color,
                source: currentSource,
                sourceTimestamp: activeFieldState.source_timestamp,
                overridden: activeFieldState.overridden,
                acceptedCandidateId: activeFieldState.accepted_candidate_id ?? null,
              }}
              sharedAcceptedCandidateId={null}
              badges={activeFieldState.reason_codes.map((code) => ({
                label: code,
                className: 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200',
              }))}
              isCurrentAccepted={isAccepted}
              onAcceptCurrent={canAcceptCurrent ? () => {
                const enrichedMatch = enrichedCandidates.find(
                  (c: ReviewCandidate) => String(c.value ?? '').trim().toLowerCase() === selectedValueStr,
                );
                if (enrichedMatch) {
                  optimisticUpdateField(
                    selectedProductId,
                    selectedField,
                    String(enrichedMatch.value ?? ''),
                    {
                      source: enrichedMatch.source || '',
                      method: enrichedMatch.method || undefined,
                      tier: enrichedMatch.tier,
                      acceptedCandidateId: enrichedMatch.candidate_id,
                    },
                    { selectedCandidateId: enrichedMatch.candidate_id, userAcceptPrimary: 'accepted' },
                  );
                  overrideMut.mutate({
                    productId: selectedProductId,
                    field: selectedField,
                    itemFieldStateId: activeSlotId ?? undefined,
                    candidateId: enrichedMatch.candidate_id,
                    value: String(enrichedMatch.value ?? ''),
                    candidateSource: enrichedMatch.source_id || enrichedMatch.source || '',
                    candidateMethod: enrichedMatch.method || undefined,
                    candidateTier: enrichedMatch.tier,
                    candidateConfidence: Number(enrichedMatch.score ?? 0),
                    candidateEvidence: enrichedMatch.evidence,
                  });
                } else {
                  optimisticUpdateField(
                    selectedProductId,
                    selectedField,
                    String(activeFieldState.selected.value),
                    { source: 'user', method: 'manual_override', acceptedCandidateId: null },
                    { selectedCandidateId: null, userAcceptPrimary: 'accepted', primaryStatus: null },
                  );
                  manualOverrideMut.mutate({
                    productId: selectedProductId,
                    field: selectedField,
                    itemFieldStateId: activeSlotId ?? undefined,
                    value: String(activeFieldState.selected.value),
                  });
                }
              } : undefined}
              onManualOverride={(value) => {
                if (!canMutateActiveSlot) return;
                optimisticUpdateField(
                  selectedProductId,
                  selectedField,
                  value,
                  { source: 'user', method: 'manual_override', acceptedCandidateId: null },
                  { selectedCandidateId: null, userAcceptPrimary: 'accepted', primaryStatus: null },
                );
                manualOverrideMut.mutate({
                  productId: selectedProductId,
                  field: selectedField,
                  itemFieldStateId: activeSlotId ?? undefined,
                  value,
                });
              }}
              pendingAIPrimary={hasPendingAIPrimary}
              pendingAIShared={hasPendingAIShared}
              pendingPrimaryCandidateId={pendingPrimaryCandidateId}
              pendingSharedCandidateId={pendingSharedCandidateId}
              pendingPrimaryCandidateIds={pendingPrimaryCandidateIds}
              pendingSharedCandidateIds={pendingSharedCandidateIds}
              candidateUiContext="grid"
              onConfirmPrimary={hasPendingAIPrimary && canMutateActiveSlot ? () => confirmKeyReviewMut.mutate(
                kr?.id
                  ? {
                    id: kr.id,
                    lane: 'primary',
                    itemFieldStateId: activeSlotId ?? undefined,
                  }
                  : {
                    lane: 'primary',
                    productId: selectedProductId,
                    field: selectedField,
                    itemFieldStateId: activeSlotId ?? undefined,
                  }
              ) : undefined}
              onConfirmPrimaryCandidate={hasPendingAIPrimary && canMutateActiveSlot ? (candidateId, candidate) => confirmKeyReviewMut.mutate(
                kr?.id
                  ? {
                    id: kr.id,
                    lane: 'primary',
                    itemFieldStateId: activeSlotId ?? undefined,
                    candidateId,
                    candidateValue: String(candidate.value ?? ''),
                    candidateConfidence: Number(candidate.score ?? 0),
                  }
                  : {
                    lane: 'primary',
                    productId: selectedProductId,
                    field: selectedField,
                    itemFieldStateId: activeSlotId ?? undefined,
                    candidateId,
                    candidateValue: String(candidate.value ?? ''),
                    candidateConfidence: Number(candidate.score ?? 0),
                  }
              ) : undefined}
              onAcceptPrimaryCandidate={canMutateActiveSlot ? (candidateId, candidate) => {
                optimisticUpdateField(
                  selectedProductId,
                  selectedField,
                  String(candidate.value ?? ''),
                  {
                    source: candidate.source || '',
                    method: candidate.method || undefined,
                    tier: candidate.tier,
                    acceptedCandidateId: candidateId,
                  },
                  { selectedCandidateId: candidateId, userAcceptPrimary: 'accepted' },
                );
                overrideMut.mutate({
                  productId: selectedProductId,
                  field: selectedField,
                  itemFieldStateId: activeSlotId ?? undefined,
                  candidateId,
                  value: String(candidate.value ?? ''),
                  candidateSource: candidate.source_id || candidate.source || '',
                  candidateMethod: candidate.method || undefined,
                  candidateTier: candidate.tier,
                  candidateConfidence: Number(candidate.score ?? 0),
                  candidateEvidence: candidate.evidence,
                });
              } : undefined}
              onAcceptPrimary={hasPendingAIPrimary && canMutateActiveSlot ? () => acceptKeyReviewMut.mutate(
                kr?.id
                  ? { id: kr.id, lane: 'primary', itemFieldStateId: activeSlotId ?? undefined }
                  : {
                    lane: 'primary',
                    productId: selectedProductId,
                    field: selectedField,
                    itemFieldStateId: activeSlotId ?? undefined,
                  }
              ) : undefined}
              isPending={overrideMut.isPending || manualOverrideMut.isPending || confirmKeyReviewMut.isPending || acceptKeyReviewMut.isPending}
              candidates={enrichedCandidates}
              candidatesLoading={candidatesLoading}
              onAcceptCandidate={canMutateActiveSlot ? (candidateId, candidate) => {
                optimisticUpdateField(
                  selectedProductId,
                  selectedField,
                  String(candidate.value ?? ''),
                  {
                    source: candidate.source || '',
                    method: candidate.method || undefined,
                    tier: candidate.tier,
                    acceptedCandidateId: candidateId,
                  },
                  { selectedCandidateId: candidateId, userAcceptPrimary: 'accepted' },
                );
                overrideMut.mutate({
                  productId: selectedProductId,
                  field: selectedField,
                  itemFieldStateId: activeSlotId ?? undefined,
                  candidateId,
                  value: String(candidate.value ?? ''),
                  candidateSource: candidate.source_id || candidate.source || '',
                  candidateMethod: candidate.method || undefined,
                  candidateTier: candidate.tier,
                  candidateConfidence: Number(candidate.score ?? 0),
                    candidateEvidence: candidate.evidence,
                });
              } : undefined}
              onRunAIReview={() => runGridAiReviewMut.mutate()}
              aiReviewPending={runGridAiReviewMut.isPending}
              extraSections={
                <>
                  {activeFieldState.reason_codes?.length > 0 && <FlagsSection reasonCodes={activeFieldState.reason_codes} />}
                </>
              }
            />
          );
        })()}
      </div>
    </div>
  );
}
