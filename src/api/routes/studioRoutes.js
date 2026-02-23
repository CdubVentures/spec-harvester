export function registerStudioRoutes(ctx) {
  const {
    jsonRes,
    readJsonBody,
    config,
    HELPER_ROOT,
    safeReadJson,
    safeStat,
    listFiles,
    fs,
    path,
    sessionCache,
    loadWorkbookMap,
    saveWorkbookMap,
    validateWorkbookMap,
    invalidateFieldRulesCache,
    buildFieldLabelsMap,
    storage,
    loadCategoryConfig,
    startProcess,
    broadcastWs,
    reviewLayoutByCategory,
    loadProductCatalog,
    cleanVariant,
  } = ctx;

  return async function handleStudioRoutes(parts, params, method, req, res) {
    if (parts[0] === 'field-labels' && parts[1] && !parts[2] && method === 'GET') {
      const category = parts[1];
      const session = await sessionCache.getSessionRules(category);
      return jsonRes(res, 200, { category, labels: session.labels });
    }

    // Studio payload
    if (parts[0] === 'studio' && parts[1] && parts[2] === 'payload' && method === 'GET') {
      const category = parts[1];
      const catConfig = await loadCategoryConfig(category, { storage, config }).catch(() => ({}));
      const session = await sessionCache.getSessionRules(category);
      return jsonRes(res, 200, {
        category,
        fieldRules: session.mergedFields,
        fieldOrder: session.mergedFieldOrder,
        uiFieldCatalog: catConfig.uiFieldCatalog || null,
        guardrails: catConfig.guardrails || null,
        compiledAt: session.compiledAt,
        draftSavedAt: session.draftSavedAt,
        compileStale: session.compileStale,
      });
    }

    // Workbook products (reads from product catalog)
    if (parts[0] === 'workbook' && parts[1] && parts[2] === 'products' && method === 'GET') {
      const category = parts[1];
      const catalog = await loadProductCatalog(config, category);
      const products = [];
      const brandSet = new Set();
      for (const [pid, entry] of Object.entries(catalog.products || {})) {
        const brand = String(entry.brand || '').trim();
        const model = String(entry.model || '').trim();
        const variant = cleanVariant(entry.variant);
        if (!brand || !model) continue;
        brandSet.add(brand);
        products.push({
          brand,
          model,
          variant,
          productId: pid,
        });
      }
      return jsonRes(res, 200, { products, brands: [...brandSet].sort() });
    }

    // Studio compile
    if (parts[0] === 'studio' && parts[1] && parts[2] === 'compile' && method === 'POST') {
      const category = parts[1];
      try {
        const status = startProcess('src/cli/spec.js', ['category-compile', '--category', category, '--local']);
        return jsonRes(res, 200, status);
      } catch (err) {
        return jsonRes(res, 409, { error: err.message });
      }
    }

    // Studio: validate rules
    if (parts[0] === 'studio' && parts[1] && parts[2] === 'validate-rules' && method === 'POST') {
      const category = parts[1];
      try {
        const status = startProcess('src/cli/spec.js', ['validate-rules', '--category', category, '--local']);
        return jsonRes(res, 200, status);
      } catch (err) {
        return jsonRes(res, 409, { error: err.message });
      }
    }

    if (parts[0] === 'studio' && parts[1] && parts[2] === 'guardrails' && method === 'GET') {
      const category = parts[1];
      const OUTPUT_ROOT = ctx.OUTPUT_ROOT;
      const guardrailPath = path.join(OUTPUT_ROOT, '_studio', category, 'guardrails.json');
      const data = await safeReadJson(guardrailPath);
      return jsonRes(res, 200, data || {});
    }

    // Studio known-values
    if (parts[0] === 'studio' && parts[1] && parts[2] === 'known-values' && method === 'GET') {
      const category = parts[1];
      const kvPath = path.join(HELPER_ROOT, category, '_generated', 'known_values.json');
      const data = await safeReadJson(kvPath);
      return jsonRes(res, 200, data || {});
    }

    // Studio component-db (entity names by type)
    if (parts[0] === 'studio' && parts[1] && parts[2] === 'component-db' && method === 'GET') {
      const category = parts[1];
      const dbDir = path.join(HELPER_ROOT, category, '_generated', 'component_db');
      const files = await listFiles(dbDir, '.json');
      const result = {};
      for (const f of files) {
        const data = await safeReadJson(path.join(dbDir, f));
        if (data?.component_type && Array.isArray(data.items)) {
          result[data.component_type] = data.items.map(item => ({
            name: item.name || '',
            maker: item.maker || '',
            aliases: item.aliases || [],
          }));
        }
      }
      return jsonRes(res, 200, result);
    }

    // Studio workbook-map GET (using full loadWorkbookMap with normalization)
    if (parts[0] === 'studio' && parts[1] && parts[2] === 'workbook-map' && method === 'GET') {
      const category = parts[1];
      try {
        const result = await loadWorkbookMap({ category, config });
        return jsonRes(res, 200, result || { file_path: '', map: {} });
      } catch (err) {
        return jsonRes(res, 200, { file_path: '', map: {}, error: err.message });
      }
    }

    // Studio workbook-map PUT (save)
    if (parts[0] === 'studio' && parts[1] && parts[2] === 'workbook-map' && method === 'PUT') {
      const category = parts[1];
      const body = await readJsonBody(req);
      try {
        const result = await saveWorkbookMap({ category, workbookMap: body, config });
        return jsonRes(res, 200, result);
      } catch (err) {
        return jsonRes(res, 500, { error: 'save_failed', message: err.message });
      }
    }

    // Studio workbook-map validate
    if (parts[0] === 'studio' && parts[1] && parts[2] === 'validate-map' && method === 'POST') {
      const category = parts[1];
      const body = await readJsonBody(req);
      const result = validateWorkbookMap(body, { category });
      return jsonRes(res, 200, result);
    }

    // Studio tooltip bank
    if (parts[0] === 'studio' && parts[1] && parts[2] === 'tooltip-bank' && method === 'GET') {
      const category = parts[1];
      const catRoot = path.join(HELPER_ROOT, category);
      const mapData = await safeReadJson(path.join(catRoot, '_control_plane', 'workbook_map.json'));
      const tooltipPath = mapData?.tooltip_source?.path || '';
      const tooltipFiles = [];
      const tooltipEntries = {};
      try {
        const entries = await fs.readdir(catRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && /^hbs_tooltips/i.test(entry.name)) {
            tooltipFiles.push(entry.name);
            const raw = await fs.readFile(path.join(catRoot, entry.name), 'utf8').catch(() => '');
            if (raw) {
              try {
                const parsed = JSON.parse(raw);
                if (typeof parsed === 'object') {
                  for (const [k, v] of Object.entries(parsed)) {
                    tooltipEntries[k] = v;
                  }
                }
              } catch { /* not JSON, skip */ }
            }
          }
        }
      } catch { /* no files */ }
      return jsonRes(res, 200, { entries: tooltipEntries, files: tooltipFiles, configuredPath: tooltipPath });
    }

    // Studio save drafts
    if (parts[0] === 'studio' && parts[1] && parts[2] === 'save-drafts' && method === 'POST') {
      const category = parts[1];
      const body = await readJsonBody(req);
      const catRoot = path.join(HELPER_ROOT, category);
      const controlPlane = path.join(catRoot, '_control_plane');
      await fs.mkdir(controlPlane, { recursive: true });
      if (body.fieldRulesDraft) {
        const draftFile = path.join(controlPlane, 'field_rules_draft.json');
        const existing = (await safeReadJson(draftFile)) || {};
        const merged = { ...existing, ...body.fieldRulesDraft, draft_saved_at: new Date().toISOString() };
        await fs.writeFile(draftFile, JSON.stringify(merged, null, 2));
      }
      if (body.uiFieldCatalogDraft) {
        await fs.writeFile(path.join(controlPlane, 'ui_field_catalog_draft.json'), JSON.stringify(body.uiFieldCatalogDraft, null, 2));
      }
      if (body.renames && typeof body.renames === 'object' && Object.keys(body.renames).length > 0) {
        const renamesPath = path.join(controlPlane, 'pending_renames.json');
        const existing = (await safeReadJson(renamesPath)) || { renames: {} };
        if (!existing.renames || typeof existing.renames !== 'object') existing.renames = {};
        Object.assign(existing.renames, body.renames);
        existing.timestamp = new Date().toISOString();
        await fs.writeFile(renamesPath, JSON.stringify(existing, null, 2));
      }
      sessionCache.invalidateSessionCache(category);
      reviewLayoutByCategory.delete(category);
      broadcastWs('data-change', { type: 'studio-drafts-saved', category });
      return jsonRes(res, 200, { ok: true });
    }

    // Studio cache invalidation
    if (parts[0] === 'studio' && parts[1] && parts[2] === 'invalidate-cache' && method === 'POST') {
      const category = parts[1];
      sessionCache.invalidateSessionCache(category);
      invalidateFieldRulesCache(category);
      reviewLayoutByCategory.delete(category);
      return jsonRes(res, 200, { ok: true });
    }

    // Studio field rules draft GET
    if (parts[0] === 'studio' && parts[1] && parts[2] === 'drafts' && method === 'GET') {
      const category = parts[1];
      const controlPlane = path.join(HELPER_ROOT, category, '_control_plane');
      const [fieldRulesDraft, uiFieldCatalogDraft] = await Promise.all([
        safeReadJson(path.join(controlPlane, 'field_rules_draft.json')),
        safeReadJson(path.join(controlPlane, 'ui_field_catalog_draft.json')),
      ]);
      return jsonRes(res, 200, { fieldRulesDraft, uiFieldCatalogDraft });
    }

    // Studio generated artifacts list
    if (parts[0] === 'studio' && parts[1] && parts[2] === 'artifacts' && method === 'GET') {
      const category = parts[1];
      const generatedRoot = path.join(HELPER_ROOT, category, '_generated');
      const files = await listFiles(generatedRoot, '.json');
      const artifacts = [];
      for (const f of files) {
        const st = await safeStat(path.join(generatedRoot, f));
        artifacts.push({ name: f, size: st?.size || 0, updated: st?.mtime?.toISOString() || '' });
      }
      return jsonRes(res, 200, artifacts);
    }

    return false;
  };
}
