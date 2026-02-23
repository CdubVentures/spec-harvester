export function registerSourceStrategyRoutes(ctx) {
  const {
    jsonRes,
    readJsonBody,
    getSpecDb,
    resolveCategoryAlias,
  } = ctx;

  return async function handleSourceStrategyRoutes(parts, params, method, req, res) {
    // GET /api/v1/source-strategy
    if (parts[0] === 'source-strategy' && method === 'GET' && !parts[1]) {
      const category = resolveCategoryAlias(params.get('category') || '');
      const db = getSpecDb(category || 'mouse');
      return jsonRes(res, 200, db.listSourceStrategies());
    }

    // POST /api/v1/source-strategy
    if (parts[0] === 'source-strategy' && method === 'POST' && !parts[1]) {
      const body = await readJsonBody(req).catch(() => ({}));
      if (!body.host) return jsonRes(res, 400, { error: 'host_required' });
      const category = resolveCategoryAlias(params.get('category') || '');
      const db = getSpecDb(category || 'mouse');
      const result = db.insertSourceStrategy(body);
      return jsonRes(res, 201, { ok: true, id: result.id });
    }

    // PUT /api/v1/source-strategy/:id
    if (parts[0] === 'source-strategy' && parts[1] && method === 'PUT') {
      const id = Number.parseInt(parts[1], 10);
      if (!Number.isFinite(id)) return jsonRes(res, 400, { error: 'invalid_id' });
      const body = await readJsonBody(req).catch(() => ({}));
      const category = resolveCategoryAlias(params.get('category') || '');
      const db = getSpecDb(category || 'mouse');
      const updated = db.updateSourceStrategy(id, body);
      if (!updated) return jsonRes(res, 404, { error: 'not_found' });
      return jsonRes(res, 200, updated);
    }

    // DELETE /api/v1/source-strategy/:id
    if (parts[0] === 'source-strategy' && parts[1] && method === 'DELETE') {
      const id = Number.parseInt(parts[1], 10);
      if (!Number.isFinite(id)) return jsonRes(res, 400, { error: 'invalid_id' });
      const category = resolveCategoryAlias(params.get('category') || '');
      const db = getSpecDb(category || 'mouse');
      db.deleteSourceStrategy(id);
      return jsonRes(res, 200, { ok: true });
    }

    return false;
  };
}
