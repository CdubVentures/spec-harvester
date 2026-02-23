export function createBatchRouteHandler({ orchestrator, jsonRes, readJsonBody }) {
  return async function handleBatchRoutes(parts, params, method, req, res) {
    if (parts[0] !== 'batch') return false;

    if (parts[1] === 'create' && method === 'POST') {
      const body = await readJsonBody(req);
      const batch = orchestrator.createBatch({
        batchId: body.batchId || `batch-${Date.now()}`,
        category: body.category || '',
        products: Array.isArray(body.products) ? body.products : []
      });
      return jsonRes(res, 200, batch);
    }

    if (parts[1] === 'list' && method === 'GET') {
      const batches = orchestrator.listBatches();
      return jsonRes(res, 200, { batches });
    }

    if (parts[1] === 'status' && parts[2] && method === 'GET') {
      const snapshot = orchestrator.snapshot(parts[2]);
      if (!snapshot) return jsonRes(res, 404, { error: 'batch_not_found' });
      return jsonRes(res, 200, snapshot);
    }

    if (parts[1] === 'start' && parts[2] && method === 'POST') {
      try {
        const batch = orchestrator.startBatch(parts[2]);
        return jsonRes(res, 200, batch);
      } catch (err) {
        return jsonRes(res, 400, { error: err?.message || 'start_failed' });
      }
    }

    if (parts[1] === 'pause' && parts[2] && method === 'POST') {
      try {
        const batch = orchestrator.pauseBatch(parts[2]);
        return jsonRes(res, 200, batch);
      } catch (err) {
        return jsonRes(res, 400, { error: err?.message || 'pause_failed' });
      }
    }

    if (parts[1] === 'resume' && parts[2] && method === 'POST') {
      try {
        const batch = orchestrator.resumeBatch(parts[2]);
        return jsonRes(res, 200, batch);
      } catch (err) {
        return jsonRes(res, 400, { error: err?.message || 'resume_failed' });
      }
    }

    if (parts[1] === 'cancel' && parts[2] && method === 'POST') {
      try {
        const batch = orchestrator.cancelBatch(parts[2]);
        return jsonRes(res, 200, batch);
      } catch (err) {
        return jsonRes(res, 400, { error: err?.message || 'cancel_failed' });
      }
    }

    if (parts[1] === 'add-product' && parts[2] && method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const batch = orchestrator.addProduct(parts[2], {
          productId: body.productId || '',
          s3key: body.s3key || null
        });
        return jsonRes(res, 200, batch);
      } catch (err) {
        return jsonRes(res, 400, { error: err?.message || 'add_product_failed' });
      }
    }

    if (parts[1] === 'remove-product' && parts[2] && method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const batch = orchestrator.removeProduct(parts[2], body.productId || '');
        return jsonRes(res, 200, batch);
      } catch (err) {
        return jsonRes(res, 400, { error: err?.message || 'remove_product_failed' });
      }
    }

    return false;
  };
}
