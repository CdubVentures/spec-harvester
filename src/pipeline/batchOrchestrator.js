const BATCH_TRANSITIONS = {
  pending: new Set(['running', 'cancelled']),
  running: new Set(['paused', 'cancelled', 'completed']),
  paused: new Set(['running', 'cancelled']),
  completed: new Set(),
  cancelled: new Set()
};

const PRODUCT_TRANSITIONS = {
  pending: new Set(['running']),
  running: new Set(['done', 'failed']),
  failed: new Set(['pending', 'skipped']),
  done: new Set(),
  skipped: new Set()
};

function transitionBatch(batch, newStatus) {
  const allowed = BATCH_TRANSITIONS[batch.status];
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid batch transition: ${batch.status} -> ${newStatus}`);
  }
  batch.status = newStatus;
  batch.updatedAt = new Date().toISOString();
  return batch;
}

function transitionProduct(product, newStatus) {
  const allowed = PRODUCT_TRANSITIONS[product.status];
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(`Invalid product transition: ${product.status} -> ${newStatus}`);
  }
  product.status = newStatus;
  product.updatedAt = new Date().toISOString();
  return product;
}

export class BatchOrchestrator {
  constructor({ maxRetries = 2, runProduct = null } = {}) {
    this._batches = new Map();
    this._maxRetries = Math.max(0, maxRetries);
    this._runProduct = runProduct || (async () => ({ status: 'done' }));
  }

  createBatch({ batchId, category, products = [] }) {
    const now = new Date().toISOString();
    const batch = {
      batchId,
      category,
      status: 'pending',
      products: products.map((p) => ({
        productId: p.productId,
        s3key: p.s3key || null,
        status: 'pending',
        retries: 0,
        error: null,
        result: null,
        createdAt: now,
        updatedAt: now
      })),
      createdAt: now,
      updatedAt: now
    };
    this._batches.set(batchId, batch);
    return { ...batch };
  }

  getBatch(batchId) {
    const batch = this._batches.get(batchId);
    return batch ? { ...batch, products: batch.products.map((p) => ({ ...p })) } : null;
  }

  startBatch(batchId) {
    const batch = this._batches.get(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);
    return { ...transitionBatch(batch, 'running') };
  }

  pauseBatch(batchId) {
    const batch = this._batches.get(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);
    return { ...transitionBatch(batch, 'paused') };
  }

  resumeBatch(batchId) {
    const batch = this._batches.get(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);
    return { ...transitionBatch(batch, 'running') };
  }

  cancelBatch(batchId) {
    const batch = this._batches.get(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);
    return { ...transitionBatch(batch, 'cancelled') };
  }

  addProduct(batchId, product) {
    const batch = this._batches.get(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);
    const now = new Date().toISOString();
    batch.products.push({
      productId: product.productId,
      s3key: product.s3key || null,
      status: 'pending',
      retries: 0,
      error: null,
      result: null,
      createdAt: now,
      updatedAt: now
    });
    batch.updatedAt = now;
    return { ...batch };
  }

  removeProduct(batchId, productId) {
    const batch = this._batches.get(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);
    batch.products = batch.products.filter((p) => p.productId !== productId);
    batch.updatedAt = new Date().toISOString();
    return { ...batch };
  }

  async runNextProduct(batchId) {
    const batch = this._batches.get(batchId);
    if (!batch) throw new Error(`Batch ${batchId} not found`);
    if (batch.status !== 'running') return null;

    const nextProduct = batch.products.find((p) => p.status === 'pending');
    if (!nextProduct) {
      const allDone = batch.products.every((p) => p.status === 'done' || p.status === 'skipped');
      if (allDone) transitionBatch(batch, 'completed');
      return null;
    }

    transitionProduct(nextProduct, 'running');

    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      try {
        const result = await this._runProduct({
          productId: nextProduct.productId,
          s3key: nextProduct.s3key,
          category: batch.category,
          batchId
        });
        transitionProduct(nextProduct, 'done');
        nextProduct.result = result;
        return { productId: nextProduct.productId, status: 'done', result };
      } catch (err) {
        nextProduct.retries = attempt;
        nextProduct.error = err?.message || 'unknown_error';

        if (attempt >= this._maxRetries) {
          nextProduct.status = 'failed';
          transitionProduct(nextProduct, 'skipped');
          return { productId: nextProduct.productId, status: 'skipped', error: nextProduct.error };
        }

        nextProduct.status = 'failed';
        transitionProduct(nextProduct, 'pending');
      }
    }

    return null;
  }

  snapshot(batchId) {
    const batch = this._batches.get(batchId);
    if (!batch) return null;

    const counts = { pending: 0, running: 0, done: 0, failed: 0, skipped: 0 };
    for (const p of batch.products) {
      counts[p.status] = (counts[p.status] || 0) + 1;
    }

    return {
      batchId: batch.batchId,
      category: batch.category,
      status: batch.status,
      total: batch.products.length,
      ...counts,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt
    };
  }

  listBatches() {
    return [...this._batches.keys()].map((id) => this.snapshot(id));
  }
}
