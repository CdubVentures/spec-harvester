import { handleReviewItemMutationRoute } from '../reviewItemRoutes.js';
import { handleReviewComponentMutationRoute } from '../reviewComponentMutationRoutes.js';
import { handleReviewEnumMutationRoute } from '../reviewEnumMutationRoutes.js';

export function registerReviewRoutes(ctx) {
  const {
    jsonRes,
    readJsonBody,
    toInt,
    hasKnownValue,
    config,
    storage,
    OUTPUT_ROOT,
    HELPER_ROOT,
    path,
    fs,
    getSpecDb,
    getSpecDbReady,
    buildReviewLayout,
    buildProductReviewPayload,
    buildReviewQueue,
    buildComponentReviewLayout,
    buildComponentReviewPayloads,
    buildEnumReviewPayloads,
    loadProductCatalog,
    readLatestArtifacts,
    sessionCache,
    reviewLayoutByCategory,
    broadcastWs,
    specDbCache,
    findProductsReferencingComponent,
    componentReviewPath,
    runComponentReviewBatch,
    invalidateFieldRulesCache,
    safeReadJson,
    slugify,
    spawn,
    // Review mutation helpers
    resolveGridFieldStateForMutation,
    setOverrideFromCandidate,
    setManualOverride,
    syncPrimaryLaneAcceptFromItemSelection,
    resolveKeyReviewForLaneMutation,
    getPendingItemPrimaryCandidateIds,
    markPrimaryLaneReviewedInItemState,
    syncItemFieldStateFromPrimaryLaneAccept,
    isMeaningfulValue,
    propagateSharedLaneDecision,
    // Component mutation helpers
    syncSyntheticCandidatesFromComponentReview,
    resolveComponentMutationContext,
    candidateLooksReference,
    normalizeLower,
    buildComponentIdentifier,
    applySharedLaneState,
    cascadeComponentChange,
    loadQueueState,
    saveQueueState,
    remapPendingComponentReviewItemsForNameChange,
    getPendingComponentSharedCandidateIdsAsync,
    // Enum mutation helpers
    resolveEnumMutationContext,
    getPendingEnumSharedCandidateIds,
    cascadeEnumChange,
    markEnumSuggestionStatusBound,
    // Candidate enrichment helpers
    annotateCandidatePrimaryReviews,
    ensureGridKeyReviewState,
    patchCompiledComponentDb,
  } = ctx;

  return async function handleReviewRoutes(parts, params, method, req, res) {
    // Review layout
    if (parts[0] === 'review' && parts[1] && parts[2] === 'layout' && method === 'GET') {
      const category = parts[1];
      const session = await sessionCache.getSessionRules(category);
      const layout = await buildReviewLayout({ storage, config, category, fieldOrderOverride: session.draftFieldOrder, fieldsOverride: session.draftFields });
      return jsonRes(res, 200, layout);
    }

    // Review product payload (single) - only serve if product exists in catalog
    if (parts[0] === 'review' && parts[1] && parts[2] === 'product' && parts[3] && method === 'GET') {
      const [, category, , productId] = parts;
      const specDb = getSpecDb(category);
      const catalog = await loadProductCatalog(config, category);
      const catalogPids = new Set(Object.keys(catalog.products || {}));
      if (catalogPids.size > 0 && !catalogPids.has(productId)) {
        return jsonRes(res, 404, { error: 'not_in_catalog', message: `Product ${productId} is not in the product catalog` });
      }
      const sessionProd = await sessionCache.getSessionRules(category);
      const draftLayout = await buildReviewLayout({ storage, config, category, fieldOrderOverride: sessionProd.draftFieldOrder, fieldsOverride: sessionProd.draftFields });
      const payload = await buildProductReviewPayload({ storage, config, category, productId, layout: draftLayout, specDb });
      // Enrich identity with catalog id/identifier (normalized.json may predate the backfill)
      const catEntry = catalog.products?.[productId] || {};
      if (payload?.identity) {
        if (!payload.identity.id) payload.identity.id = catEntry.id || 0;
        if (!payload.identity.identifier) payload.identity.identifier = catEntry.identifier || '';
      }
      return jsonRes(res, 200, payload);
    }

    // Review batch products (for multi-product matrix)
    if (parts[0] === 'review' && parts[1] && parts[2] === 'products' && method === 'GET') {
      const category = parts[1];
      const specDb = getSpecDb(category);
      const idsParam = params.get('ids') || '';
      const brandsParam = params.get('brands') || '';
      const limit = toInt(params.get('limit'), 20);
      const wantCandidates = params.get('includeCandidates') !== 'false';
      let productIds;
      if (idsParam) {
        productIds = idsParam.split(',').filter(Boolean);
      } else {
        const queue = await buildReviewQueue({ storage, config, category, status: 'needs_review', limit, specDb });
        productIds = queue.map(q => q.product_id || q.productId).filter(Boolean).slice(0, limit);
      }
      const catalog = await loadProductCatalog(config, category);
      const catalogPids = new Set(Object.keys(catalog.products || {}));
      if (specDb) {
        try {
          const dbProducts = specDb.getAllProducts('active');
          for (const p of dbProducts) catalogPids.add(p.product_id);
        } catch { /* fall through */ }
      }
      productIds = productIds.filter(pid => catalogPids.has(pid));
      const brandsFilter = brandsParam ? new Set(brandsParam.split(',').map(b => b.trim().toLowerCase()).filter(Boolean)) : null;
      const batchSession = await sessionCache.getSessionRules(category);
      const batchLayout = await buildReviewLayout({ storage, config, category, fieldOrderOverride: batchSession.draftFieldOrder, fieldsOverride: batchSession.draftFields });
      const payloads = [];
      for (const pid of productIds) {
        try {
          const payload = await buildProductReviewPayload({ storage, config, category, productId: pid, layout: batchLayout, includeCandidates: wantCandidates, specDb });
          if (payload?.identity) {
            const ce = catalog.products?.[pid] || {};
            if (!payload.identity.id) payload.identity.id = ce.id || 0;
            if (!payload.identity.identifier) payload.identity.identifier = ce.identifier || '';
          }
          if (payload) {
            if (brandsFilter) {
              const brand = String(payload.identity?.brand || '').trim().toLowerCase();
              if (!brandsFilter.has(brand)) continue;
            }
            payloads.push(payload);
          }
        } catch { /* skip failed products */ }
      }
      return jsonRes(res, 200, payloads);
    }

    // Review products index - ALL products, lightweight (no candidates), sorted by brand
    if (parts[0] === 'review' && parts[1] && parts[2] === 'products-index' && method === 'GET') {
      const category = parts[1];
      const specDb = getSpecDb(category);
      const catalog = await loadProductCatalog(config, category);
      const catalogProducts = catalog.products || {};
      let productIds = Object.keys(catalogProducts);
      if (productIds.length === 0) {
        if (specDb) {
          try {
            const dbProducts = specDb.getAllProducts('active');
            productIds = dbProducts.map(p => p.product_id);
            for (const p of dbProducts) {
              catalogProducts[p.product_id] = { brand: p.brand, model: p.model, variant: p.variant, id: p.id, identifier: p.identifier };
            }
          } catch { /* fall through */ }
        }
      }

      const payloads = [];
      for (const pid of productIds) {
        try {
          const payload = await buildProductReviewPayload({ storage, config, category, productId: pid, includeCandidates: false, specDb });
          if (payload?.identity) {
            const ce = catalogProducts[pid] || {};
            if (!payload.identity.id) payload.identity.id = ce.id || 0;
            if (!payload.identity.identifier) payload.identity.identifier = ce.identifier || '';
          }
          if (payload) payloads.push(payload);
        } catch { /* skip failed products */ }
      }

      // Tag each product with hasRun (has summary data)
      for (const p of payloads) {
        p.hasRun = !!p.metrics.has_run;
      }

      // Enrich each product's fields with key_review_state data
      {
        if (specDb) {
          for (const p of payloads) {
            try {
              const krsRows = specDb.getKeyReviewStatesForItem(p.product_id);
              for (const krs of krsRows) {
                const fieldState = p.fields[krs.field_key];
                if (!fieldState) continue;
                fieldState.keyReview = {
                  id: krs.id,
                  selectedCandidateId: krs.selected_candidate_id || null,
                  primaryStatus: krs.ai_confirm_primary_status || null,
                  primaryConfidence: krs.ai_confirm_primary_confidence ?? null,
                  sharedStatus: krs.ai_confirm_shared_status || null,
                  sharedConfidence: krs.ai_confirm_shared_confidence ?? null,
                  userAcceptPrimary: krs.user_accept_primary_status || null,
                  userAcceptShared: krs.user_accept_shared_status || null,
                  overridePrimary: Boolean(krs.user_override_ai_primary),
                  overrideShared: Boolean(krs.user_override_ai_shared),
                };
              }
            } catch { /* best-effort key review enrichment */ }
          }
        }
      }

      // Sort by brand (ascending), then model (ascending)
      payloads.sort((a, b) => {
        const brandA = String(a.identity?.brand || '').toLowerCase();
        const brandB = String(b.identity?.brand || '').toLowerCase();
        if (brandA !== brandB) return brandA.localeCompare(brandB);
        const modelA = String(a.identity?.model || '').toLowerCase();
        const modelB = String(b.identity?.model || '').toLowerCase();
        return modelA.localeCompare(modelB);
      });

      // Extract unique sorted brands
      const brandSet = new Set();
      for (const p of payloads) {
        const brand = String(p.identity?.brand || '').trim();
        if (brand) brandSet.add(brand);
      }
      const brands = [...brandSet].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

      // Compute run-only metrics (excludes unrun products that drag averages down)
      const runProducts = payloads.filter(p => p.hasRun);
      const metricsRun = runProducts.length > 0 ? {
        confidence: runProducts.reduce((s, p) => s + p.metrics.confidence, 0) / runProducts.length,
        coverage: runProducts.reduce((s, p) => s + p.metrics.coverage, 0) / runProducts.length,
        flags: runProducts.reduce((s, p) => s + p.metrics.flags, 0),
        missing: runProducts.reduce((s, p) => s + (p.metrics.missing || 0), 0),
        count: runProducts.length,
      } : { confidence: 0, coverage: 0, flags: 0, missing: 0, count: 0 };

      return jsonRes(res, 200, { products: payloads, brands, total: payloads.length, metrics_run: metricsRun });
    }

    // Review candidates for a single field - lazy loading for drawer
    if (parts[0] === 'review' && parts[1] && parts[2] === 'candidates' && parts[3] && parts[4] && method === 'GET') {
      const [, category, , productId, field] = parts;
      const specDb = getSpecDb(category);
      const catalog = await loadProductCatalog(config, category);
      const catalogPids = new Set(Object.keys(catalog.products || {}));
      if (catalogPids.size > 0 && !catalogPids.has(productId)) {
        const dbProduct = specDb?.getProduct(productId);
        if (!dbProduct) {
          return jsonRes(res, 404, { error: 'not_in_catalog', message: `Product ${productId} is not in the product catalog` });
        }
      }
      const payload = await buildProductReviewPayload({
        storage,
        config,
        category,
        productId,
        includeCandidates: true,
        specDb
      });
      const requestedField = decodeURIComponent(String(field || ''));
      const availableFields = Object.keys(payload.fields || {});
      const resolvedField = payload.fields?.[requestedField]
        ? requestedField
        : (availableFields.find((key) => key.toLowerCase() === requestedField.toLowerCase()) || requestedField);
      const fieldState = payload.fields?.[resolvedField] || { candidates: [] };
      let itemFieldStateId = (() => {
        const n = Number(fieldState?.slot_id ?? fieldState?.id ?? null);
        if (!Number.isFinite(n)) return null;
        const id = Math.trunc(n);
        return id > 0 ? id : null;
      })();
      const allCandidates = Array.isArray(fieldState.candidates) ? [...fieldState.candidates] : [];
      let keyReview = null;
      if (specDb) {
        try {
          const krs = specDb.getKeyReviewState({
            targetKind: 'grid_key',
            itemIdentifier: productId,
            fieldKey: resolvedField,
            itemFieldStateId,
            category,
          });
          if (krs) {
            keyReview = {
              id: krs.id,
              selectedCandidateId: krs.selected_candidate_id || null,
              primaryStatus: krs.ai_confirm_primary_status || null,
              primaryConfidence: krs.ai_confirm_primary_confidence ?? null,
              sharedStatus: krs.ai_confirm_shared_status || null,
              sharedConfidence: krs.ai_confirm_shared_confidence ?? null,
              userAcceptPrimary: krs.user_accept_primary_status || null,
              userAcceptShared: krs.user_accept_shared_status || null,
              overridePrimary: Boolean(krs.user_override_ai_primary),
              overrideShared: Boolean(krs.user_override_ai_shared),
            };
          }
        } catch { /* best-effort */ }
      }
      const selectedValue = fieldState?.selected?.value;
      const selectedValueNorm = String(selectedValue ?? '').trim().toLowerCase();
      const hasSelectedValue = hasKnownValue(selectedValue);
      const selectedCandidateId = String(
        keyReview?.selectedCandidateId
        || fieldState?.accepted_candidate_id
        || '',
      ).trim();
      const existingIds = new Set(allCandidates.map((candidate) => String(candidate?.candidate_id || '').trim()).filter(Boolean));
      const hasSelectedId = selectedCandidateId ? existingIds.has(selectedCandidateId) : false;
      const hasSelectedValueCandidate = hasSelectedValue
        && allCandidates.some((candidate) => String(candidate?.value ?? '').trim().toLowerCase() === selectedValueNorm);
      const sourceTokenRaw = String(fieldState?.source || '').trim().toLowerCase();
      const sourceId = sourceTokenRaw === 'component_db'
        || sourceTokenRaw === 'known_values'
        || sourceTokenRaw === 'reference'
        ? 'reference'
        : (sourceTokenRaw.startsWith('pipeline')
            ? 'pipeline'
            : (sourceTokenRaw === 'manual' || sourceTokenRaw === 'user' ? 'user' : sourceTokenRaw));
      const sourceLabel = sourceId === 'reference'
        ? 'Reference'
        : (sourceId === 'pipeline'
            ? 'Pipeline'
            : (String(fieldState?.source || '').trim() || sourceId || 'Pipeline'));
      const selectedConfidence = Number.isFinite(Number(fieldState?.selected?.confidence))
        ? Math.max(0, Math.min(1, Number(fieldState.selected.confidence)))
        : 0.5;
      const selectedEvidenceUrl = String(fieldState?.evidence_url || '').trim();
      const selectedEvidenceQuote = String(fieldState?.evidence_quote || '').trim()
        || 'Selected value retained from slot state';
      const ensureSelectedCandidate = (candidateId) => {
        const cid = String(candidateId || '').trim();
        if (!cid || existingIds.has(cid) || !hasSelectedValue) return;
        existingIds.add(cid);
        allCandidates.push({
          candidate_id: cid,
          value: selectedValue,
          score: selectedConfidence,
          source_id: sourceId || '',
          source: sourceLabel,
          tier: null,
          method: sourceId === 'user' ? 'manual_override' : 'selected_value',
          is_synthetic_selected: true,
          evidence: {
            url: selectedEvidenceUrl,
            retrieved_at: String(fieldState?.source_timestamp || '').trim(),
            snippet_id: '',
            snippet_hash: '',
            quote: selectedEvidenceQuote,
            quote_span: null,
            snippet_text: selectedEvidenceQuote,
            source_id: sourceId || '',
          },
        });
      };
      if (hasSelectedValue && selectedCandidateId && !hasSelectedId) {
        ensureSelectedCandidate(selectedCandidateId);
      }
      if (hasSelectedValue && !hasSelectedValueCandidate) {
        ensureSelectedCandidate(`selected_${slugify(productId || 'product')}_${slugify(resolvedField || 'field')}`);
      }
      if (specDb) {
        const reviewRows = itemFieldStateId
          ? (specDb.getReviewsForContext('item', String(itemFieldStateId)) || [])
          : [];
        annotateCandidatePrimaryReviews(allCandidates, reviewRows);
      }
      allCandidates.sort((a, b) => {
        const aScore = Number.parseFloat(String(a?.score ?? ''));
        const bScore = Number.parseFloat(String(b?.score ?? ''));
        const left = Number.isFinite(aScore) ? aScore : 0;
        const right = Number.isFinite(bScore) ? bScore : 0;
        if (right !== left) return right - left;
        return String(a?.candidate_id || '').localeCompare(String(b?.candidate_id || ''));
      });
      return jsonRes(res, 200, {
        product_id: productId,
        field: resolvedField,
        candidates: allCandidates,
        candidate_count: allCandidates.length,
        keyReview,
      });
    }

    const handledReviewItemMutation = await handleReviewItemMutationRoute({
      parts,
      method,
      req,
      res,
      context: {
        storage,
        config,
        readJsonBody,
        jsonRes,
        getSpecDb,
        resolveGridFieldStateForMutation,
        setOverrideFromCandidate,
        setManualOverride,
        syncPrimaryLaneAcceptFromItemSelection,
        resolveKeyReviewForLaneMutation,
        getPendingItemPrimaryCandidateIds,
        markPrimaryLaneReviewedInItemState,
        syncItemFieldStateFromPrimaryLaneAccept,
        isMeaningfulValue,
        propagateSharedLaneDecision,
        broadcastWs,
      },
    });
    if (handledReviewItemMutation) return handledReviewItemMutation;

    // Review suggest - submit suggestion feedback
    if (parts[0] === 'review' && parts[1] && parts[2] === 'suggest' && method === 'POST') {
      const category = parts[1];
      const body = await readJsonBody(req);
      const { type, field, value, evidenceUrl, evidenceQuote, canonical, reason, reviewer, productId } = body;
      if (!type || !field || !value) return jsonRes(res, 400, { error: 'type, field, and value required' });
      const cliArgs = ['src/cli/spec.js', 'review', 'suggest', '--category', category, '--type', type, '--field', field, '--value', String(value)];
      if (evidenceUrl) cliArgs.push('--evidence-url', String(evidenceUrl));
      if (evidenceQuote) cliArgs.push('--evidence-quote', String(evidenceQuote));
      if (canonical) cliArgs.push('--canonical', String(canonical));
      if (reason) cliArgs.push('--reason', String(reason));
      if (reviewer) cliArgs.push('--reviewer', String(reviewer));
      if (productId) cliArgs.push('--product-id', String(productId));
      cliArgs.push('--local');
      try {
        const result = await new Promise((resolve, reject) => {
          const proc = spawn('node', cliArgs, { cwd: path.resolve('.'), stdio: ['ignore', 'pipe', 'pipe'] });
          let stdout = '', stderr = '';
          proc.stdout.on('data', d => { stdout += d; });
          proc.stderr.on('data', d => { stderr += d; });
          proc.on('exit', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `exit ${code}`)));
        });
        broadcastWs('data-change', { type: 'review-suggest', category });
        return jsonRes(res, 200, { ok: true, output: result });
      } catch (err) {
        return jsonRes(res, 500, { error: 'suggest_failed', message: err.message });
      }
    }

    // -- Review Components endpoints --

    // Layout - list component types with property columns
    if (parts[0] === 'review-components' && parts[1] && parts[2] === 'layout' && method === 'GET') {
      const category = parts[1];
      const runtimeSpecDb = await getSpecDbReady(category);
      if (!runtimeSpecDb || !runtimeSpecDb.isSeeded()) {
        return jsonRes(res, 503, { error: 'specdb_not_ready', message: `SpecDb not ready for ${category}` });
      }
      const layout = await buildComponentReviewLayout({ config, category, specDb: runtimeSpecDb });
      return jsonRes(res, 200, layout);
    }

    // Component items for a specific type
    if (parts[0] === 'review-components' && parts[1] && parts[2] === 'components' && method === 'GET') {
      const category = parts[1];
      const componentType = params.get('type') || '';
      if (!componentType) return jsonRes(res, 400, { error: 'type parameter required' });
      const specDb = await getSpecDbReady(category);
      if (!specDb || !specDb.isSeeded()) {
        return jsonRes(res, 503, { error: 'specdb_not_ready', message: `SpecDb not ready for ${category}` });
      }
      const sessionComp = await sessionCache.getSessionRules(category);
      const payload = await buildComponentReviewPayloads({ config, category, componentType, specDb, fieldOrderOverride: sessionComp.cleanFieldOrder });
      return jsonRes(res, 200, payload);
    }

    // Enum review data
    if (parts[0] === 'review-components' && parts[1] && parts[2] === 'enums' && method === 'GET') {
      const category = parts[1];
      const specDb = await getSpecDbReady(category);
      if (!specDb || !specDb.isSeeded()) {
        return jsonRes(res, 503, { error: 'specdb_not_ready', message: `SpecDb not ready for ${category}` });
      }
      const sessionEnum = await sessionCache.getSessionRules(category);
      const payload = await buildEnumReviewPayloads({ config, category, specDb, fieldOrderOverride: sessionEnum.cleanFieldOrder });
      return jsonRes(res, 200, payload);
    }

    const handledReviewComponentMutation = await handleReviewComponentMutationRoute({
      parts,
      method,
      req,
      res,
      context: {
        readJsonBody,
        jsonRes,
        getSpecDbReady,
        syncSyntheticCandidatesFromComponentReview,
        resolveComponentMutationContext,
        isMeaningfulValue,
        candidateLooksReference,
        normalizeLower,
        buildComponentIdentifier,
        applySharedLaneState,
        cascadeComponentChange,
        outputRoot: OUTPUT_ROOT,
        storage,
        loadQueueState,
        saveQueueState,
        remapPendingComponentReviewItemsForNameChange,
        specDbCache,
        broadcastWs,
        getPendingComponentSharedCandidateIdsAsync,
      },
    });
    if (handledReviewComponentMutation !== false) return handledReviewComponentMutation;

    const handledReviewEnumMutation = await handleReviewEnumMutationRoute({
      parts,
      method,
      req,
      res,
      context: {
        readJsonBody,
        jsonRes,
        getSpecDbReady,
        syncSyntheticCandidatesFromComponentReview,
        resolveEnumMutationContext,
        isMeaningfulValue,
        normalizeLower,
        candidateLooksReference,
        applySharedLaneState,
        getPendingEnumSharedCandidateIds,
        specDbCache,
        storage,
        outputRoot: OUTPUT_ROOT,
        cascadeEnumChange,
        loadQueueState,
        saveQueueState,
        markEnumSuggestionStatus: markEnumSuggestionStatusBound,
        broadcastWs,
      },
    });
    if (handledReviewEnumMutation !== false) return handledReviewEnumMutation;

    // Component impact analysis
    if (parts[0] === 'review-components' && parts[1] && parts[2] === 'component-impact' && method === 'GET') {
      const category = parts[1];
      const type = params.get('type') || '';
      const name = params.get('name') || '';
      if (!type || !name) return jsonRes(res, 400, { error: 'type and name parameters required' });
      const runtimeSpecDb = getSpecDb(category);
      const affected = await findProductsReferencingComponent({
        outputRoot: OUTPUT_ROOT,
        category,
        componentType: type,
        componentName: name,
        specDb: runtimeSpecDb,
      });
      return jsonRes(res, 200, { affected_products: affected, total: affected.length });
    }

    // -- Component AI Review endpoints --

    // Get component review items (flagged for AI/human review)
    if (parts[0] === 'review-components' && parts[1] && parts[2] === 'component-review' && method === 'GET') {
      const category = parts[1];
      const filePath = componentReviewPath({ config, category });
      const data = await safeReadJson(filePath);
      return jsonRes(res, 200, data || { version: 1, category, items: [], updated_at: null });
    }

    // Component review action (approve_new, merge_alias, dismiss)
    if (parts[0] === 'review-components' && parts[1] && parts[2] === 'component-review-action' && method === 'POST') {
      const category = parts[1];
      const body = await readJsonBody(req);
      const { review_id, action, merge_target } = body;
      if (!review_id || !action) return jsonRes(res, 400, { error: 'review_id and action required' });

      const filePath = componentReviewPath({ config, category });
      const data = await safeReadJson(filePath);
      if (!data || !Array.isArray(data.items)) return jsonRes(res, 404, { error: 'No review data found' });

      const item = data.items.find((i) => i.review_id === review_id);
      if (!item) return jsonRes(res, 404, { error: 'Review item not found' });

      if (action === 'approve_new') {
        item.status = 'approved_new';
      } else if (action === 'merge_alias' && merge_target) {
        item.status = 'accepted_alias';
        item.matched_component = merge_target;
        // Write alias to overrides
        const slug = String(merge_target).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const overrideDir = path.join(HELPER_ROOT, category, '_overrides', 'components');
        await fs.mkdir(overrideDir, { recursive: true });
        const overridePath = path.join(overrideDir, `${item.component_type}_${slug}.json`);
        const existing = await safeReadJson(overridePath) || { componentType: item.component_type, name: merge_target, properties: {} };
        if (!existing.identity) existing.identity = {};
        const aliases = Array.isArray(existing.identity.aliases) ? existing.identity.aliases : [];
        const alias = String(item.raw_query).trim();
        if (alias && !aliases.some((a) => a.toLowerCase() === alias.toLowerCase())) {
          aliases.push(alias);
          existing.identity.aliases = aliases;
        }
        existing.updated_at = new Date().toISOString();
        await fs.writeFile(overridePath, JSON.stringify(existing, null, 2));
        invalidateFieldRulesCache(category);
        sessionCache.invalidateSessionCache(category);
        // Dual-write alias to SpecDb
        const specDb = getSpecDb(category);
        if (specDb && alias) {
          try {
            const idRow = specDb.db.prepare(
              'SELECT id FROM component_identity WHERE category = ? AND component_type = ? AND canonical_name = ? AND maker = ?'
            ).get(specDb.category, item.component_type, merge_target, '');
            if (idRow) {
              specDb.insertAlias(idRow.id, alias, 'user');
            }
            specDbCache.delete(category);
          } catch (_specDbErr) {
            return jsonRes(res, 500, {
              error: 'component_review_alias_specdb_write_failed',
              message: _specDbErr?.message || 'SpecDb write failed',
            });
          }
        }
      } else if (action === 'dismiss') {
        item.status = 'dismissed';
      } else {
        return jsonRes(res, 400, { error: `Unknown action: ${action}` });
      }

      item.human_reviewed_at = new Date().toISOString();
      data.updated_at = new Date().toISOString();
      await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      broadcastWs('data-change', { type: 'component-review', category });

      return jsonRes(res, 200, { ok: true, review_id, action, status: item.status });
    }

    // Manually trigger AI batch review
    if (parts[0] === 'review-components' && parts[1] && parts[2] === 'run-component-review-batch' && method === 'POST') {
      const category = parts[1];
      try {
        const result = await runComponentReviewBatch({ config, category, logger: null });
        if (result.accepted_alias > 0) {
          invalidateFieldRulesCache(category);
          sessionCache.invalidateSessionCache(category);
        }
        broadcastWs('data-change', { type: 'component-review', category });
        return jsonRes(res, 200, result);
      } catch (err) {
        return jsonRes(res, 500, { error: err.message });
      }
    }

    return false;
  };
}
