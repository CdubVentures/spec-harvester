import { useState } from 'react';
import { useMutation, useQuery, type QueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { trafficColor, trafficTextColor, sourceBadgeClass, SOURCE_BADGE_FALLBACK } from '../../utils/colors';
import { humanizeField } from '../../utils/fieldNormalize';
import { pct } from '../../utils/formatting';
import { buildSyntheticComponentCandidateId } from '../../utils/candidateIdentifier';
import {
  DrawerShell,
  DrawerSection,
  DrawerCard,
  DrawerValueRow,
  DrawerBadges,
  DrawerManualOverride,
} from '../../components/common/DrawerShell';
import { CellDrawer } from '../../components/common/CellDrawer';
import { FlagsSection, FlagsOverviewSection } from '../../components/common/FlagsSection';
import { PendingAIReviewSection } from '../../components/common/PendingAIReviewSection';
import { LinkedProductsList } from '../../components/common/LinkedProductsList';
import type { ComponentReviewItem, ComponentPropertyState, ComponentReviewPayload, ComponentReviewFlaggedItem } from '../../types/componentReview';

interface ComponentImpactResult {
  affected_products: Array<{ productId: string; field: string; value: string; match_type: string }>;
  total: number;
}

interface ComponentReviewDrawerProps {
  item: ComponentReviewItem;
  componentType: string;
  category: string;
  onClose: () => void;
  queryClient: QueryClient;
  focusedProperty?: string;
  rowIndex?: number;
  pendingReviewItems?: ComponentReviewFlaggedItem[];
  isSynthetic?: boolean;
}

const varianceBadge: Record<string, string> = {
  authoritative: 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300',
  upper_bound: 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300',
  lower_bound: 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300',
  range: 'bg-cyan-100 dark:bg-cyan-900/50 text-cyan-700 dark:text-cyan-300',
  override_allowed: 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300',
};

function buildPropertyBadges(state: ComponentPropertyState): Array<{ label: string; className: string }> {
  const badges: Array<{ label: string; className: string }> = [];

  // Show source badge — skip 'user' when overridden to avoid redundancy with 'overridden' badge
  if (state.source && state.source !== 'unknown' && !(state.source === 'user' && state.overridden)) {
    badges.push({ label: state.source, className: sourceBadgeClass[state.source] || SOURCE_BADGE_FALLBACK });
  }

  if (state.variance_policy) {
    badges.push({
      label: state.variance_policy,
      className: varianceBadge[state.variance_policy] || 'bg-gray-100 text-gray-600',
    });
  }

  if (state.overridden) {
    badges.push({ label: 'overridden', className: 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300' });
  }

  for (const constraint of state.constraints) {
    badges.push({ label: constraint, className: 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300' });
  }

  for (const reasonCode of state.reason_codes) {
    if (reasonCode === 'manual_override' && state.overridden) continue;
    badges.push({ label: reasonCode, className: 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200' });
  }

  return badges;
}

function PropertyCard({
  propKey,
  state,
  onOverride,
  isPending,
}: {
  propKey: string;
  state: ComponentPropertyState;
  onOverride: (value: string) => void;
  isPending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const badges = buildPropertyBadges(state);

  return (
    <DrawerCard>
      <div className="flex items-center gap-2">
        <span className={`inline-block w-3 h-3 rounded-full flex-shrink-0 ${trafficColor(state.selected.color)}`} />
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 flex-shrink-0">
          {humanizeField(propKey)}
        </span>
        <span
          className={`font-mono text-sm font-semibold flex-1 truncate ${trafficTextColor(state.selected.color)}`}
          title={String(state.selected.value ?? '')}
        >
          {state.selected.value !== null && state.selected.value !== undefined ? String(state.selected.value) : 'unk'}
        </span>
        <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
          {pct(state.selected.confidence)} conf
        </span>
      </div>

      <DrawerBadges badges={badges} />

      {!editing ? (
        <button
          onClick={() => {
            setEditing(true);
            setEditValue(String(state.selected.value ?? ''));
          }}
          className="text-[10px] text-accent hover:underline"
        >
          Override
        </button>
      ) : (
        <div className="flex gap-2 mt-1">
          <input
            type="text"
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
            autoFocus
            placeholder="Enter new value..."
            onKeyDown={(event) => {
              if (event.key === 'Enter' && editValue) {
                onOverride(editValue);
                setEditing(false);
              }
              if (event.key === 'Escape') setEditing(false);
            }}
          />
          <button
            onClick={() => {
              onOverride(editValue);
              setEditing(false);
            }}
            disabled={!editValue || isPending}
            className="px-3 py-1 text-sm bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      )}
    </DrawerCard>
  );
}

function IdentityOverrideRow({
  label,
  value,
  tracked,
  property,
  onOverride,
  isPending,
}: {
  label: string;
  value: string;
  tracked?: ComponentPropertyState;
  property: string;
  onOverride: (property: string, value: string) => void;
  isPending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-gray-500 dark:text-gray-400 w-12 flex-shrink-0">{label}</span>
      {editing ? (
        <div className="flex gap-1 flex-1 min-w-0">
          <input
            type="text"
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="flex-1 px-1.5 py-0.5 text-[11px] border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 min-w-0"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && editValue.trim()) {
                onOverride(property, editValue.trim());
                setEditing(false);
              }
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <button
            onClick={() => { onOverride(property, editValue.trim()); setEditing(false); }}
            disabled={!editValue.trim() || isPending}
            className="px-2 py-0.5 text-[10px] bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="text-gray-400 hover:text-gray-600 text-sm"
          >
            ×
          </button>
        </div>
      ) : (
        <>
          <span className="font-medium truncate min-w-0">{value || '—'}</span>
          {tracked?.overridden && (
            <span className="text-[9px] text-orange-500 font-bold flex-shrink-0">OVR</span>
          )}
          {tracked && (
            <span className="text-[9px] text-gray-400 flex-shrink-0">{tracked.source}</span>
          )}
          <button
            onClick={() => { setEditValue(value); setEditing(true); }}
            className="text-accent hover:underline text-[10px] ml-auto flex-shrink-0"
          >
            Edit
          </button>
        </>
      )}
    </div>
  );
}

function AliasEditor({
  aliases,
  overridden,
  onSave,
  isPending,
}: {
  aliases: string[];
  overridden: boolean;
  onSave: (items: string[]) => void;
  isPending: boolean;
}) {
  const [items, setItems] = useState(aliases);
  const [newAlias, setNewAlias] = useState('');
  const dirty = JSON.stringify(items) !== JSON.stringify(aliases);

  const addAlias = () => {
    const trimmed = newAlias.trim();
    if (trimmed && !items.includes(trimmed)) {
      setItems([...items, trimmed]);
    }
    setNewAlias('');
  };
  const removeAlias = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const editAlias = (idx: number, val: string) => {
    const copy = [...items];
    copy[idx] = val;
    setItems(copy);
  };

  return (
    <DrawerSection
      title="Aliases"
      meta={overridden ? <span className="text-[9px] text-orange-500 font-bold">OVR</span> : undefined}
    >
      <div className="space-y-1">
        {items.map((alias, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              value={alias}
              onChange={(e) => editAlias(i, e.target.value)}
              className="flex-1 px-1.5 py-0.5 text-[11px] border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 min-w-0"
            />
            <button
              onClick={() => removeAlias(i)}
              className="text-red-400 hover:text-red-600 text-xs flex-shrink-0"
              title="Remove alias"
            >
              ×
            </button>
          </div>
        ))}
        <div className="flex gap-1">
          <input
            value={newAlias}
            onChange={(e) => setNewAlias(e.target.value)}
            placeholder="Add alias..."
            className="flex-1 px-1.5 py-0.5 text-[11px] border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 min-w-0"
            onKeyDown={(e) => { if (e.key === 'Enter') addAlias(); }}
          />
          <button
            onClick={addAlias}
            disabled={!newAlias.trim()}
            className="px-2 py-0.5 text-[11px] text-accent hover:underline disabled:opacity-50 flex-shrink-0"
          >
            +
          </button>
        </div>
        {dirty && (
          <button
            onClick={() => onSave(items)}
            disabled={isPending}
            className="px-3 py-1 text-[11px] bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
          >
            Save Aliases
          </button>
        )}
      </div>
    </DrawerSection>
  );
}

function LinksEditor({
  links,
  tracked,
  onSave,
  isPending,
}: {
  links: string[];
  tracked: Array<{ overridden: boolean; source: string }>;
  onSave: (items: string[]) => void;
  isPending: boolean;
}) {
  const [items, setItems] = useState(links);
  const [newLink, setNewLink] = useState('');
  const dirty = JSON.stringify(items) !== JSON.stringify(links);
  const anyOverridden = tracked.some((t) => t.overridden);

  const addLink = () => {
    const trimmed = newLink.trim();
    if (trimmed && !items.includes(trimmed)) {
      setItems([...items, trimmed]);
    }
    setNewLink('');
  };
  const removeLink = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const editLink = (idx: number, val: string) => {
    const copy = [...items];
    copy[idx] = val;
    setItems(copy);
  };

  return (
    <DrawerSection
      title="Links"
      meta={anyOverridden ? <span className="text-[9px] text-orange-500 font-bold">OVR</span> : undefined}
    >
      <div className="space-y-1">
        {items.map((url, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              value={url}
              onChange={(e) => editLink(i, e.target.value)}
              className="flex-1 px-1.5 py-0.5 text-[11px] border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 min-w-0"
            />
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-accent text-[10px] flex-shrink-0"
              title="Open link"
            >
              ↗
            </a>
            <button
              onClick={() => removeLink(i)}
              className="text-red-400 hover:text-red-600 text-xs flex-shrink-0"
              title="Remove link"
            >
              ×
            </button>
          </div>
        ))}
        <div className="flex gap-1">
          <input
            value={newLink}
            onChange={(e) => setNewLink(e.target.value)}
            placeholder="Add link..."
            className="flex-1 px-1.5 py-0.5 text-[11px] border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 min-w-0"
            onKeyDown={(e) => { if (e.key === 'Enter') addLink(); }}
          />
          <button
            onClick={addLink}
            disabled={!newLink.trim()}
            className="px-2 py-0.5 text-[11px] text-accent hover:underline disabled:opacity-50 flex-shrink-0"
          >
            +
          </button>
        </div>
        {dirty && (
          <button
            onClick={() => onSave(items)}
            disabled={isPending}
            className="px-3 py-1 text-[11px] bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
          >
            Save Links
          </button>
        )}
      </div>
    </DrawerSection>
  );
}

function confidenceColor(confidence: number, reasonCodes: string[] = []): string {
  if (confidence <= 0) return 'gray';
  if (
    confidence < 0.6 ||
    reasonCodes.includes('constraint_conflict') ||
    reasonCodes.includes('critical_field_below_pass_target') ||
    reasonCodes.includes('below_pass_target')
  ) return 'red';
  if (confidence < 0.85) return 'yellow';
  return 'green';
}

/** Optimistically apply a manual override — source='user', overridden=true */
function applyDrawerManualOverride(
  payload: ComponentReviewPayload,
  name: string,
  maker: string,
  property: string,
  value: string | string[],
  rowIndex?: number,
): ComponentReviewPayload {
  const now = new Date().toISOString();
  return {
    ...payload,
    items: payload.items.map((item, i) => {
      // Prefer exact rowIndex to avoid updating duplicate name+maker rows
      if (rowIndex != null && rowIndex >= 0) {
        if (i !== rowIndex) return item;
      } else {
        if (item.name !== name || item.maker !== maker) return item;
      }
      const strVal = String(Array.isArray(value) ? value[0] || '' : value);
      const greenSelected = { value: strVal, confidence: 1.0, status: 'override', color: 'green' as const };

      if (property === '__name') {
        return { ...item, name: strVal, name_tracked: { ...item.name_tracked, selected: greenSelected, source: 'user', source_timestamp: now, overridden: true, needs_review: false, reason_codes: ['manual_override'], accepted_candidate_id: null } };
      }
      if (property === '__maker') {
        return { ...item, maker: strVal, maker_tracked: { ...item.maker_tracked, selected: greenSelected, source: 'user', source_timestamp: now, overridden: true, needs_review: false, reason_codes: ['manual_override'], accepted_candidate_id: null } };
      }
      if (property === '__aliases') {
        return { ...item, aliases: Array.isArray(value) ? value.map(String) : [strVal], aliases_overridden: true };
      }
      if (property === '__links') {
        const newLinks = Array.isArray(value) ? value.map(String) : [strVal];
        return {
          ...item,
          links: newLinks,
          links_tracked: newLinks.map((url) => ({
            selected: { value: url, confidence: 1.0, status: 'override', color: 'green' as const },
            needs_review: false,
            reason_codes: ['manual_override'] as string[],
            source: 'user',
            source_timestamp: now,
            overridden: true,
          })),
        };
      }

      const prop = item.properties[property];
      if (!prop) return item;
      return {
        ...item,
        properties: {
          ...item.properties,
          [property]: { ...prop, selected: { value, confidence: 1.0, status: 'override', color: 'green' as const }, source: 'user', source_timestamp: now, overridden: true, needs_review: false, reason_codes: ['manual_override'], accepted_candidate_id: null },
        },
      };
    }),
  };
}

/** Optimistically apply a candidate acceptance — preserve candidate source, overridden=false */
function applyDrawerCandidateAccept(
  payload: ComponentReviewPayload,
  name: string,
  maker: string,
  property: string,
  value: string,
  candidateId: string | null = null,
  rowIndex?: number,
): ComponentReviewPayload {
  const now = new Date().toISOString();
  return {
    ...payload,
    items: payload.items.map((item, i) => {
      if (rowIndex != null && rowIndex >= 0) {
        if (i !== rowIndex) return item;
      } else {
        if (item.name !== name || item.maker !== maker) return item;
      }
      const greenSelected = { value, confidence: 1.0, status: 'accepted', color: 'green' as const };

      if (property === '__name') {
        return {
          ...item,
          name: value,
          name_tracked: {
            ...item.name_tracked,
            selected: greenSelected,
            source: item.name_tracked.source || 'pipeline',
            source_timestamp: now,
            overridden: false,
            // Accept must not implicitly confirm shared AI.
            needs_review: item.name_tracked.needs_review,
            reason_codes: item.name_tracked.reason_codes,
            accepted_candidate_id: candidateId,
          },
        };
      }
      if (property === '__maker') {
        return {
          ...item,
          maker: value,
          maker_tracked: {
            ...item.maker_tracked,
            selected: greenSelected,
            source: item.maker_tracked.source || 'pipeline',
            source_timestamp: now,
            overridden: false,
            // Accept must not implicitly confirm shared AI.
            needs_review: item.maker_tracked.needs_review,
            reason_codes: item.maker_tracked.reason_codes,
            accepted_candidate_id: candidateId,
          },
        };
      }

      const prop = item.properties[property];
      if (!prop) return item;
      return {
        ...item,
        properties: {
          ...item.properties,
          [property]: {
            ...prop,
            selected: greenSelected,
            source: prop.source || 'pipeline',
            source_timestamp: now,
            overridden: false,
            // Accept must not implicitly confirm shared AI.
            needs_review: prop.needs_review,
            reason_codes: prop.reason_codes,
            accepted_candidate_id: candidateId,
          },
        },
      };
    }),
  };
}

export function ComponentReviewDrawer({
  item,
  componentType,
  category,
  onClose,
  queryClient,
  focusedProperty,
  rowIndex,
  pendingReviewItems = [],
  isSynthetic = false,
}: ComponentReviewDrawerProps) {
  // Mutation: approve individual review items (approve_new / dismiss)
  const reviewActionMut = useMutation({
    mutationFn: (body: { review_id: string; action: string; merge_target?: string }) =>
      api.post(`/review-components/${category}/component-review-action`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['componentReview', category] });
      queryClient.invalidateQueries({ queryKey: ['componentReviewData', category] });
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
    },
  });

  const overrideMut = useMutation({
    mutationFn: (body: {
      componentType: string;
      name: string;
      maker: string;
      property: string;
      value: string | string[];
      componentIdentityId?: number;
      componentValueId?: number;
    }) =>
      api.post(`/review-components/${category}/component-override`, body),
    onMutate: async (body) => {
      const queryKey = ['componentReviewData', category, componentType];
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<ComponentReviewPayload>(queryKey, (old) =>
        old ? applyDrawerManualOverride(old, body.name, body.maker, body.property, body.value, rowIndex) : old,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['componentReviewData', category, componentType] });
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
      queryClient.invalidateQueries({ queryKey: ['product', category] });
      queryClient.invalidateQueries({ queryKey: ['componentImpact'] });
    },
  });

  // Separate mutation for candidate acceptance — uses applyDrawerCandidateAccept (overridden=false)
  // so the optimistic update doesn't get overwritten by overrideMut's onMutate.
  const candidateAcceptMut = useMutation({
    mutationFn: (body: {
      componentType: string;
      name: string;
      maker: string;
      property: string;
      value: string;
      candidateId?: string;
      candidateSource?: string;
      componentIdentityId?: number;
      componentValueId?: number;
    }) =>
      api.post(`/review-components/${category}/component-override`, body),
    onMutate: async (body) => {
      const queryKey = ['componentReviewData', category, componentType];
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<ComponentReviewPayload>(queryKey, (old) =>
        old ? applyDrawerCandidateAccept(old, body.name, body.maker, body.property, body.value, body.candidateId ?? null, rowIndex) : old,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['componentReviewData', category, componentType] });
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
      queryClient.invalidateQueries({ queryKey: ['product', category] });
      queryClient.invalidateQueries({ queryKey: ['componentImpact'] });
    },
  });

  const confirmSharedLaneMut = useMutation({
    mutationFn: (body: {
      componentType: string;
      name: string;
      maker: string;
      property: string;
      candidateId?: string;
      candidateValue?: string;
      candidateConfidence?: number;
      componentIdentityId?: number;
      componentValueId?: number;
    }) => api.post(`/review-components/${category}/component-key-review-confirm`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['componentReviewData', category, componentType] });
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
    },
  });

  // Fetch impact data (how many products reference this component)
  const impactQuery = useQuery({
    queryKey: ['componentImpact', category, componentType, item.name],
    queryFn: () => api.get<ComponentImpactResult>(`/review-components/${category}/component-impact?type=${encodeURIComponent(componentType)}&name=${encodeURIComponent(item.name)}`),
    staleTime: 60_000,
  });

  // Build shared impact section (used by both name/maker and property focused views)
  const impactSection = impactQuery.data && impactQuery.data.total > 0 ? (
    <DrawerSection title="Affected Products">
      <div className="text-[10px] text-gray-500">
        {impactQuery.data.total} product{impactQuery.data.total !== 1 ? 's' : ''} use this component
      </div>
      <div className="max-h-[120px] overflow-y-auto space-y-0.5">
        {(impactQuery.data.affected_products || []).slice(0, 20).map((p) => (
          <div key={p.productId} className="text-[10px] text-gray-400 truncate">{p.productId}</div>
        ))}
      </div>
    </DrawerSection>
  ) : null;

  function getMutationIds(property: string): { componentIdentityId?: number; componentValueId?: number } {
    const componentIdentityId = item.component_identity_id ?? undefined;
    const componentValueId = property.startsWith('__')
      ? undefined
      : (item.properties?.[property]?.slot_id ?? undefined);
    return { componentIdentityId, componentValueId };
  }

  function splitCandidateValueParts(rawValue: unknown): string[] {
    if (Array.isArray(rawValue)) {
      const nested = rawValue.flatMap((entry) => splitCandidateValueParts(entry));
      return [...new Set(nested)];
    }
    const text = String(rawValue ?? '').trim();
    if (!text) return [];
    const parts = text.includes(',')
      ? text.split(',').map((part) => part.trim()).filter(Boolean)
      : [text];
    return [...new Set(parts)];
  }

  function matchesCandidateValue(rawValue: unknown, candidateNorm: string): boolean {
    return splitCandidateValueParts(rawValue).some(
      (part) => part.toLowerCase() === candidateNorm,
    );
  }

  // Build pipeline candidates from pendingReviewItems' product_attributes for a given property key.
  // Ensures flagged cells always have at least one candidate when pending review items exist.
  function enrichCandidatesFromReviewItems(
    existingCandidates: import('../../types/review').ReviewCandidate[],
    property: string,
  ): import('../../types/review').ReviewCandidate[] {
    if (pendingReviewItems.length === 0) return existingCandidates;
    // Collect existing candidate_ids to avoid duplicates
    const existingIds = new Set(existingCandidates.map((c) => c.candidate_id));
    const existingValues = new Set(existingCandidates.map((c) => String(c.value ?? '').trim().toLowerCase()));
    // Build consolidated pipeline candidates from review items
    const byValue = new Map<string, { value: string; products: string[]; latest: string }>();
    for (const ri of pendingReviewItems) {
      const attrs = ri.product_attributes || {};
      // For __name, use raw_query or matched_component; for __maker, use {componentType}_brand.
      // Properties may be arrays/comma-delimited strings, so split into candidate tokens.
      let rawValue: unknown;
      if (property === '__name') {
        rawValue = ri.matched_component || ri.raw_query;
      } else if (property === '__maker') {
        rawValue = attrs[`${componentType}_brand`] || attrs['brand'];
      } else {
        rawValue = attrs[property];
      }
      const valueParts = splitCandidateValueParts(rawValue);
      for (const valStr of valueParts) {
        const valNorm = valStr.toLowerCase();
        if (!valNorm || existingValues.has(valNorm)) continue;
        if (!byValue.has(valNorm)) {
          byValue.set(valNorm, { value: valStr, products: [], latest: '' });
        }
        const entry = byValue.get(valNorm)!;
        entry.products.push(ri.product_id || 'unknown');
        if (!entry.latest || (ri.created_at && ri.created_at > entry.latest)) entry.latest = ri.created_at;
      }
    }
    const syntheticCandidates: import('../../types/review').ReviewCandidate[] = [];
    for (const meta of byValue.values()) {
      const val = meta.value;
      const cid = buildSyntheticComponentCandidateId({
        componentType,
        componentName: item.name,
        propertyKey: property,
        value: val,
      });
      if (existingIds.has(cid)) continue;
      const count = meta.products.length;
      syntheticCandidates.push({
        candidate_id: cid,
        value: val,
        score: 0.5,
        source_id: 'pipeline',
        source: `Pipeline (${count} product${count !== 1 ? 's' : ''})`,
        tier: null,
        method: 'product_extraction',
        evidence: {
          url: '',
          retrieved_at: meta.latest || '',
          snippet_id: '',
          snippet_hash: '',
          quote: `Extracted from ${meta.products.slice(0, 3).join(', ')}${count > 3 ? ` +${count - 3} more` : ''}`,
          quote_span: null,
          snippet_text: 'Pipeline extraction from product runs',
          source_id: 'pipeline',
        },
      });
    }
    return [...existingCandidates, ...syntheticCandidates];
  }

  function resolveReviewItemsForCandidate(
    candidate: import('../../types/review').ReviewCandidate,
    property: string,
  ): ComponentReviewFlaggedItem[] {
    if (pendingReviewItems.length === 0) return [];
    const candidateNorm = String(candidate?.value ?? '').trim().toLowerCase();
    if (!candidateNorm) return [];
    const scoped = pendingReviewItems.filter((ri) => {
      const attrs = (ri.product_attributes || {}) as Record<string, unknown>;
      let val: unknown;
      if (property === '__name') {
        val = ri.matched_component || ri.raw_query;
      } else if (property === '__maker') {
        val = attrs[`${componentType}_brand`] || attrs['brand'];
      } else {
        val = attrs[property];
      }
      return matchesCandidateValue(val, candidateNorm);
    });
    return scoped;
  }

  // Handle __name/__maker in focused mode via CellDrawer
  if (focusedProperty === '__name' || focusedProperty === '__maker') {
    const state = focusedProperty === '__name' ? item.name_tracked : item.maker_tracked;
    const subtitle = `${item.name} | ${item.maker || componentType}`;
    const badges = buildPropertyBadges(state);
    const hasValue = state.selected.value != null && String(state.selected.value).trim() !== '';
    const isAccepted = hasValue
      && !state.needs_review
      && !state.overridden
      && (
        Boolean(state.accepted_candidate_id)
        || state.source === 'workbook'
        || state.source === 'manual'
        || state.source === 'user'
        || state.selected.color === 'green'
      );
    const candidates = enrichCandidatesFromReviewItems(state.candidates, focusedProperty);
    const hasSharedPending = Boolean(state.needs_review);
    const pendingSharedCandidateIds = hasSharedPending
      ? candidates
        .filter((candidate) => resolveReviewItemsForCandidate(candidate, focusedProperty).length > 0)
        .map((candidate) => candidate.candidate_id)
      : [];
    if (hasSharedPending && pendingSharedCandidateIds.length === 0) {
      const fallbackAcceptedId = String(state.accepted_candidate_id || '').trim();
      if (fallbackAcceptedId && candidates.some((candidate) => String(candidate?.candidate_id || '').trim() === fallbackAcceptedId)) {
        pendingSharedCandidateIds.push(fallbackAcceptedId);
      }
      if (pendingSharedCandidateIds.length === 0) {
        const firstCandidateId = String(candidates[0]?.candidate_id || '').trim();
        if (firstCandidateId) pendingSharedCandidateIds.push(firstCandidateId);
      }
    }

    return (
      <CellDrawer
        title={focusedProperty === '__name' ? 'Name' : 'Maker'}
        subtitle={subtitle}
        onClose={onClose}
        currentValue={{
          value: hasValue ? String(state.selected.value) : '',
          confidence: state.selected.confidence,
          color: state.selected.color,
          source: state.source,
          sourceTimestamp: state.source_timestamp,
          overridden: state.overridden,
          acceptedCandidateId: state.accepted_candidate_id ?? null,
        }}
        badges={badges}
        isCurrentAccepted={isAccepted}
        pendingAIConfirmation={hasSharedPending}
        pendingSharedCandidateIds={pendingSharedCandidateIds}
        candidateUiContext="shared"
        onManualOverride={(value) => overrideMut.mutate({
          componentType,
          name: item.name,
          maker: item.maker,
          property: focusedProperty,
          value,
          ...getMutationIds(focusedProperty),
        })}
        isPending={overrideMut.isPending || candidateAcceptMut.isPending || confirmSharedLaneMut.isPending || reviewActionMut.isPending}
        candidates={candidates}
        onAcceptCandidate={(candidateId, candidate) => {
          candidateAcceptMut.mutate({
            componentType,
            name: item.name,
            maker: item.maker,
            property: focusedProperty,
            value: String(candidate.value ?? ''),
            candidateId,
            candidateSource: candidate.source_id || candidate.source || '',
            ...getMutationIds(focusedProperty),
          });
        }}
        onConfirmShared={hasSharedPending ? () => {
          confirmSharedLaneMut.mutate({
            componentType,
            name: item.name,
            maker: item.maker,
            property: focusedProperty,
            candidateId: state.accepted_candidate_id || undefined,
            candidateValue: hasValue ? String(state.selected.value) : undefined,
            candidateConfidence: Number(state.selected.confidence ?? 0),
            ...getMutationIds(focusedProperty),
          });
        } : undefined}
        extraSections={
          <>
            {pendingReviewItems.length > 0 && <PendingAIReviewSection items={pendingReviewItems} category={category} queryClient={queryClient} />}
            {state.reason_codes?.length > 0 && <FlagsSection reasonCodes={state.reason_codes} />}
            {item.linked_products && item.linked_products.length > 0 && (
              <LinkedProductsList
                products={item.linked_products}
                headerLabel="Match Type"
                maxHeight={180}
                defaultExpanded
              />
            )}
            {impactSection}
          </>
        }
      />
    );
  }

  if (focusedProperty && item.properties[focusedProperty]) {
    const state = item.properties[focusedProperty];
    const subtitle = `${item.name} | ${item.maker || componentType}`;
    const badges = buildPropertyBadges(state);
    const hasValue = state.selected.value != null && String(state.selected.value).trim() !== '';
    const isAccepted = hasValue
      && !state.needs_review
      && !state.overridden
      && (
        Boolean(state.accepted_candidate_id)
        || state.source === 'workbook'
        || state.source === 'manual'
        || state.source === 'user'
        || state.selected.color === 'green'
      );
    const candidates = enrichCandidatesFromReviewItems(state.candidates, focusedProperty);
    const hasSharedPending = Boolean(state.needs_review);
    const pendingSharedCandidateIds = hasSharedPending
      ? candidates
        .filter((candidate) => resolveReviewItemsForCandidate(candidate, focusedProperty).length > 0)
        .map((candidate) => candidate.candidate_id)
      : [];
    if (hasSharedPending && pendingSharedCandidateIds.length === 0) {
      const fallbackAcceptedId = String(state.accepted_candidate_id || '').trim();
      if (fallbackAcceptedId && candidates.some((candidate) => String(candidate?.candidate_id || '').trim() === fallbackAcceptedId)) {
        pendingSharedCandidateIds.push(fallbackAcceptedId);
      }
      if (pendingSharedCandidateIds.length === 0) {
        const firstCandidateId = String(candidates[0]?.candidate_id || '').trim();
        if (firstCandidateId) pendingSharedCandidateIds.push(firstCandidateId);
      }
    }

    return (
      <CellDrawer
        title={humanizeField(focusedProperty)}
        subtitle={subtitle}
        onClose={onClose}
        currentValue={{
          value: state.selected.value !== null && state.selected.value !== undefined ? String(state.selected.value) : '',
          confidence: state.selected.confidence,
          color: state.selected.color,
          source: state.source,
          sourceTimestamp: state.source_timestamp,
          overridden: state.overridden,
          acceptedCandidateId: state.accepted_candidate_id ?? null,
        }}
        badges={badges}
        isCurrentAccepted={isAccepted}
        pendingAIConfirmation={hasSharedPending}
        pendingSharedCandidateIds={pendingSharedCandidateIds}
        candidateUiContext="shared"
        onManualOverride={(value) => overrideMut.mutate({
          componentType,
          name: item.name,
          maker: item.maker,
          property: focusedProperty,
          value,
          ...getMutationIds(focusedProperty),
        })}
        isPending={overrideMut.isPending || candidateAcceptMut.isPending || confirmSharedLaneMut.isPending || reviewActionMut.isPending}
        candidates={candidates}
        onAcceptCandidate={(candidateId, candidate) => {
          candidateAcceptMut.mutate({
            componentType,
            name: item.name,
            maker: item.maker,
            property: focusedProperty,
            value: String(candidate.value ?? ''),
            candidateId,
            candidateSource: candidate.source_id || candidate.source || '',
            ...getMutationIds(focusedProperty),
          });
        }}
        onConfirmShared={hasSharedPending ? () => {
          confirmSharedLaneMut.mutate({
            componentType,
            name: item.name,
            maker: item.maker,
            property: focusedProperty,
            candidateId: state.accepted_candidate_id || undefined,
            candidateValue: hasValue ? String(state.selected.value) : undefined,
            candidateConfidence: Number(state.selected.confidence ?? 0),
            ...getMutationIds(focusedProperty),
          });
        } : undefined}
        extraSections={
          <>
            {pendingReviewItems.length > 0 && <PendingAIReviewSection items={pendingReviewItems} category={category} queryClient={queryClient} />}
            {state.reason_codes?.length > 0 && <FlagsSection reasonCodes={state.reason_codes} />}
            {item.linked_products && item.linked_products.length > 0 && (
              <LinkedProductsList
                products={item.linked_products}
                headerLabel={state.variance_policy || 'Match Type'}
                maxHeight={180}
                defaultExpanded
              />
            )}
            {impactSection}
          </>
        }
      />
    );
  }

  const propertyKeys = Object.keys(item.properties).sort();
  const subtitle = [item.maker, componentType].filter(Boolean).join(' | ');

  const topBadges: Array<{ label: string; className: string }> = [
    { label: `${item.metrics.property_count} properties`, className: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300' },
  ];
  if (item.metrics.flags > 0) {
    topBadges.push({ label: `${item.metrics.flags} flags`, className: 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200' });
  }

  // "Accept Entire Row" — approves all review items and applies best values as overrides
  const acceptEntireRowMut = useMutation({
    mutationFn: async () => {
      const promises: Promise<unknown>[] = [];
      // 1. Approve all review items
      for (const ri of pendingReviewItems) {
        promises.push(
          api.post(`/review-components/${category}/component-review-action`, {
            review_id: ri.review_id,
            action: ri.match_type === 'new_component' ? 'approve_new' : 'merge_alias',
            merge_target: ri.matched_component || undefined,
          }),
        );
      }
      // 2. Apply best candidate values for each property as overrides
      for (const [propKey, state] of Object.entries(item.properties)) {
        const bestCandidate = state.candidates?.[0];
        if (bestCandidate?.value != null && String(bestCandidate.value).trim()) {
          promises.push(
            api.post(`/review-components/${category}/component-override`, {
              componentType,
              name: item.name,
              maker: item.maker,
              property: propKey,
              value: String(bestCandidate.value),
              componentIdentityId: item.component_identity_id ?? undefined,
              componentValueId: state.slot_id ?? undefined,
            }),
          );
        }
      }
      // 3. Apply name + maker if they have pipeline candidates
      if (item.name_tracked?.candidates?.[0]?.source_id === 'pipeline') {
        promises.push(
          api.post(`/review-components/${category}/component-override`, {
            componentType,
            name: item.name,
            maker: item.maker,
            property: '__name',
            value: item.name,
            componentIdentityId: item.component_identity_id ?? undefined,
          }),
        );
      }
      if (item.maker_tracked?.candidates?.[0]?.source_id === 'pipeline' && item.maker) {
        promises.push(
          api.post(`/review-components/${category}/component-override`, {
            componentType,
            name: item.name,
            maker: item.maker,
            property: '__maker',
            value: item.maker,
            componentIdentityId: item.component_identity_id ?? undefined,
          }),
        );
      }
      await Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['componentReview', category] });
      queryClient.invalidateQueries({ queryKey: ['componentReviewData', category] });
      queryClient.invalidateQueries({ queryKey: ['reviewProductsIndex', category] });
      queryClient.invalidateQueries({ queryKey: ['componentImpact'] });
    },
  });

  return (
    <DrawerShell title={item.name} subtitle={subtitle} onClose={onClose}>
      {isSynthetic && (
        <DrawerSection title="New Component">
          <div className="px-3 py-2 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded space-y-2">
            <div className="text-xs text-purple-700 dark:text-purple-300 font-medium">
              This component was discovered by the pipeline but doesn't exist in the database yet.
            </div>
            <button
              onClick={() => acceptEntireRowMut.mutate()}
              disabled={acceptEntireRowMut.isPending || overrideMut.isPending}
              className="w-full px-3 py-2 text-sm font-medium rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {acceptEntireRowMut.isPending ? 'Accepting...' : 'Accept Entire Row'}
            </button>
            <div className="text-[10px] text-purple-400">
              Approves all review items and accepts best candidate values for every property.
            </div>
          </div>
        </DrawerSection>
      )}
      {!isSynthetic && pendingReviewItems.length > 0 && (
        <DrawerSection title="AI Review">
          <div className="px-3 py-2 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded space-y-2">
            <div className="text-xs text-purple-700 dark:text-purple-300 font-medium">
              {pendingReviewItems.length} pipeline match{pendingReviewItems.length !== 1 ? 'es' : ''} pending review
            </div>
            <button
              onClick={() => acceptEntireRowMut.mutate()}
              disabled={acceptEntireRowMut.isPending || overrideMut.isPending}
              className="w-full px-3 py-1.5 text-[11px] font-medium rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {acceptEntireRowMut.isPending ? 'Accepting...' : 'Accept All Values + Approve'}
            </button>
            <div className="text-[10px] text-purple-400">
              Approves review items and accepts best candidate values for every property.
            </div>
          </div>
        </DrawerSection>
      )}
      {pendingReviewItems.length > 0 && (
        <PendingAIReviewSection items={pendingReviewItems} category={category} queryClient={queryClient} />
      )}
      <DrawerSection title="Identity">
        <DrawerValueRow
          color={confidenceColor(item.metrics.confidence)}
          value={item.name}
          confidence={item.metrics.confidence}
        />
        <DrawerBadges badges={topBadges} />
        <div className="mt-2 space-y-1.5">
          <IdentityOverrideRow
            label="Name"
            value={item.name}
            tracked={item.name_tracked}
            property="__name"
            onOverride={(prop, val) => overrideMut.mutate({
              componentType,
              name: item.name,
              maker: item.maker,
              property: prop,
              value: val,
              ...getMutationIds(prop),
            })}
            isPending={overrideMut.isPending}
          />
          <IdentityOverrideRow
            label="Maker"
            value={item.maker}
            tracked={item.maker_tracked}
            property="__maker"
            onOverride={(prop, val) => overrideMut.mutate({
              componentType,
              name: item.name,
              maker: item.maker,
              property: prop,
              value: val,
              ...getMutationIds(prop),
            })}
            isPending={overrideMut.isPending}
          />
        </div>
      </DrawerSection>

      {(() => {
        const flaggedProps = Object.entries(item.properties)
          .filter(([, state]) => state.needs_review)
          .map(([key, state]) => ({ key, reasonCodes: state.reason_codes || ['missing_value'] }));
        return flaggedProps.length > 0 ? <FlagsOverviewSection flaggedProperties={flaggedProps} /> : null;
      })()}

      <AliasEditor
        aliases={item.aliases}
        overridden={item.aliases_overridden}
        onSave={(items) => overrideMut.mutate({
          componentType,
          name: item.name,
          maker: item.maker,
          property: '__aliases',
          value: items,
          ...getMutationIds('__aliases'),
        })}
        isPending={overrideMut.isPending}
      />

      <LinksEditor
        links={item.links}
        tracked={item.links_tracked}
        onSave={(items) => overrideMut.mutate({
          componentType,
          name: item.name,
          maker: item.maker,
          property: '__links',
          value: items,
          ...getMutationIds('__links'),
        })}
        isPending={overrideMut.isPending}
      />

      {impactQuery.data && impactQuery.data.total > 0 && (
        <DrawerSection title="Product Impact">
          <div className="px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-700 dark:text-blue-300">
            {impactQuery.data.total} product{impactQuery.data.total !== 1 ? 's' : ''} reference this component. Changes will cascade.
          </div>
          <div className="max-h-[100px] overflow-y-auto space-y-0.5 mt-1">
            {(impactQuery.data.affected_products || []).slice(0, 15).map((p) => (
              <div key={p.productId} className="text-[10px] text-gray-400 truncate">{p.productId}</div>
            ))}
          </div>
        </DrawerSection>
      )}

      {item.linked_products && item.linked_products.length > 0 && (
        <DrawerSection title="Linked Products">
          <LinkedProductsList
            products={item.linked_products}
            headerLabel="Match Type"
            maxHeight={220}
            defaultExpanded
          />
        </DrawerSection>
      )}

      <DrawerSection title={`Properties (${propertyKeys.length})`} bodyClassName="space-y-2">
        {propertyKeys.map((key) => (
          <PropertyCard
            key={key}
            propKey={key}
            state={item.properties[key]}
            onOverride={(value) => overrideMut.mutate({
              componentType,
              name: item.name,
              maker: item.maker,
              property: key,
              value,
              ...getMutationIds(key),
            })}
            isPending={overrideMut.isPending}
          />
        ))}
      </DrawerSection>
    </DrawerShell>
  );
}
