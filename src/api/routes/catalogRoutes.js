export function registerCatalogRoutes(ctx) {
  const {
    jsonRes,
    readJsonBody,
    toInt,
    config,
    storage,
    reconcileOrphans,
    buildCatalog,
    listProducts,
    catalogAddProduct,
    catalogAddProductsBulk,
    catalogUpdateProduct,
    catalogRemoveProduct,
    catalogSeedFromWorkbook,
    upsertQueueProduct,
    loadProductCatalog,
    readJsonlEvents,
    fs,
    path,
    OUTPUT_ROOT,
    sessionCache,
    resolveCategoryAlias,
    listDirs,
    HELPER_ROOT,
  } = ctx;

  return async function handleCatalogRoutes(parts, params, method, req, res) {
    // POST /api/v1/catalog/{cat}/reconcile  { dryRun?: boolean }
    if (parts[0] === 'catalog' && parts[1] && parts[2] === 'reconcile' && method === 'POST') {
      const body = await readJsonBody(req).catch(() => ({}));
      const result = await reconcileOrphans({
        storage,
        category: parts[1],
        config,
        dryRun: body.dryRun !== false
      });
      return jsonRes(res, 200, result);
    }

    // Product Catalog CRUD - /api/v1/catalog/{cat}/products[/{pid}]
    if (parts[0] === 'catalog' && parts[1] && parts[2] === 'products') {
      const category = parts[1];

      // POST /api/v1/catalog/{cat}/products/seed
      if (parts[3] === 'seed' && method === 'POST') {
        const body = await readJsonBody(req).catch(() => ({}));
        const mode = body.mode === 'full' ? 'full' : 'identity';
        const result = await catalogSeedFromWorkbook({ config, category, mode, storage, upsertQueue: upsertQueueProduct });
        return jsonRes(res, 200, result);
      }

      // POST /api/v1/catalog/{cat}/products/bulk  { brand, rows:[{ model, variant? }] }
      if (parts[3] === 'bulk' && method === 'POST') {
        const body = await readJsonBody(req).catch(() => ({}));
        const rows = Array.isArray(body.rows) ? body.rows : [];
        if (rows.length > 5000) {
          return jsonRes(res, 400, { ok: false, error: 'too_many_rows', max_rows: 5000 });
        }
        const result = await catalogAddProductsBulk({
          config,
          category,
          brand: body.brand || '',
          rows,
          storage,
          upsertQueue: upsertQueueProduct
        });
        return jsonRes(res, result.ok ? 200 : 400, result);
      }

      // GET /api/v1/catalog/{cat}/products
      if (!parts[3] && method === 'GET') {
        const products = await listProducts(config, category);
        return jsonRes(res, 200, products);
      }

      // POST /api/v1/catalog/{cat}/products  { brand, model, variant?, seedUrls? }
      if (!parts[3] && method === 'POST') {
        const body = await readJsonBody(req);
        const result = await catalogAddProduct({
          config, category,
          brand: body.brand,
          model: body.model,
          variant: body.variant || '',
          seedUrls: body.seedUrls || [],
          storage,
          upsertQueue: upsertQueueProduct
        });
        const status = result.ok ? 201 : (result.error === 'product_already_exists' ? 409 : 400);
        return jsonRes(res, status, result);
      }

      // PUT /api/v1/catalog/{cat}/products/{pid}  { brand?, model?, variant?, seedUrls?, status? }
      if (parts[3] && method === 'PUT') {
        const body = await readJsonBody(req);
        const result = await catalogUpdateProduct({
          config, category,
          productId: parts[3],
          patch: body,
          storage,
          upsertQueue: upsertQueueProduct
        });
        const status = result.ok ? 200 : (result.error === 'product_not_found' ? 404 : 409);
        return jsonRes(res, status, result);
      }

      // DELETE /api/v1/catalog/{cat}/products/{pid}
      if (parts[3] && method === 'DELETE') {
        const result = await catalogRemoveProduct({ config, category, productId: parts[3], storage });
        const status = result.ok ? 200 : 404;
        return jsonRes(res, status, result);
      }
    }

    // Catalog overview - /api/v1/catalog/{cat}  ("all" merges every category)
    if (parts[0] === 'catalog' && parts[1] && !parts[2] && method === 'GET') {
      if (parts[1] === 'all') {
        const cats = (await listDirs(HELPER_ROOT)).filter(c => !c.startsWith('_'));
        const all = [];
        for (const cat of cats) {
          try {
            const rows = await buildCatalog(cat);
            all.push(...rows);
          } catch (err) {
            console.error(`[gui-server] buildCatalog failed for ${cat}:`, err.message);
          }
        }
        all.sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
        return jsonRes(res, 200, all);
      }
      const rows = await buildCatalog(parts[1]);
      return jsonRes(res, 200, rows);
    }

    // Product detail
    if (parts[0] === 'product' && parts[1] && parts[2] && method === 'GET') {
      const [, category, productId] = parts;
      const latestBase = storage.resolveOutputKey(category, productId, 'latest');
      const [summary, normalized, provenance] = await Promise.all([
        storage.readJsonOrNull(`${latestBase}/summary.json`),
        storage.readJsonOrNull(`${latestBase}/normalized.json`),
        storage.readJsonOrNull(`${latestBase}/provenance.json`),
      ]);
      const trafficLight = await storage.readJsonOrNull(`${latestBase}/traffic_light.json`);
      // Enrich identity with catalog id/identifier (normalized.json may predate the backfill)
      if (normalized?.identity) {
        const catalog = await loadProductCatalog(config, category);
        const catEntry = catalog.products?.[productId] || {};
        if (!normalized.identity.id) normalized.identity.id = catEntry.id || 0;
        if (!normalized.identity.identifier) normalized.identity.identifier = catEntry.identifier || '';
      }
      const sessionProduct = await sessionCache.getSessionRules(category);
      return jsonRes(res, 200, { summary, normalized, provenance, trafficLight, fieldOrder: sessionProduct.cleanFieldOrder });
    }

    // Events
    if (parts[0] === 'events' && parts[1] && method === 'GET') {
      const category = parts[1];
      const productId = params.get('productId') || '';
      const limit = toInt(params.get('limit'), 500);
      const eventsPath = path.join(OUTPUT_ROOT, '_runtime', 'events.jsonl');
      let lines = [];
      try {
        const text = await fs.readFile(eventsPath, 'utf8');
        lines = text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      } catch { /* no events file */ }
      const normalizedCategory = String(category || '').trim().toLowerCase();
      if (normalizedCategory && normalizedCategory !== 'all') {
        lines = lines.filter((e) => {
          const eventCategory = String(e.category || e.cat || '').trim().toLowerCase();
          if (eventCategory) return eventCategory === normalizedCategory;
          const pid = String(e.productId || e.product_id || '').trim().toLowerCase();
          return pid.startsWith(`${normalizedCategory}-`);
        });
      }
      if (productId) {
        const normalizedProductId = String(productId).trim();
        lines = lines.filter((e) => String(e.productId || e.product_id || '').trim() === normalizedProductId);
      }
      return jsonRes(res, 200, lines.slice(-limit));
    }

    return false;
  };
}
