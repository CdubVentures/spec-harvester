/**
 * Internal Retrieval Index (IP04-4C).
 *
 * In-memory inverted index of past evidence snippets
 * keyed by field + domain, enabling evidence reuse
 * across products in the same category.
 */

export class RetrievalIndex {
  constructor({ maxEntriesPerField = 500 } = {}) {
    this._maxPerField = Math.max(1, Math.floor(maxEntriesPerField) || 500);
    this._byField = new Map();
    this._byProduct = new Map();
  }

  /**
   * Add an evidence snippet to the index.
   */
  add({ field, domain, snippet, productId, value, confidence, source } = {}) {
    const normalizedField = String(field || '').trim().toLowerCase();
    if (!normalizedField) return;

    const key = `${normalizedField}||${domain || ''}||${productId || ''}`;
    const entry = {
      field: normalizedField,
      domain: String(domain || ''),
      snippet: String(snippet || ''),
      productId: String(productId || ''),
      value: value ?? null,
      confidence: confidence ?? null,
      source: source ?? null,
      indexedAt: new Date().toISOString()
    };

    // Field index
    if (!this._byField.has(normalizedField)) {
      this._byField.set(normalizedField, new Map());
    }
    const fieldMap = this._byField.get(normalizedField);
    fieldMap.set(key, entry);

    // Enforce max entries per field
    if (fieldMap.size > this._maxPerField) {
      const oldest = fieldMap.keys().next().value;
      fieldMap.delete(oldest);
    }

    // Product index
    const pid = String(productId || '');
    if (pid) {
      if (!this._byProduct.has(pid)) {
        this._byProduct.set(pid, []);
      }
      const prodEntries = this._byProduct.get(pid);
      const existingIdx = prodEntries.findIndex((e) => e.field === normalizedField && e.domain === entry.domain);
      if (existingIdx >= 0) {
        prodEntries[existingIdx] = entry;
      } else {
        prodEntries.push(entry);
      }
    }
  }

  /**
   * Query evidence by field, optionally filtered by domain.
   */
  query({ field, domain } = {}) {
    const normalizedField = String(field || '').trim().toLowerCase();
    const fieldMap = this._byField.get(normalizedField);
    if (!fieldMap) return [];

    let entries = [...fieldMap.values()];
    if (domain) {
      entries = entries.filter((e) => e.domain === String(domain));
    }
    return entries;
  }

  /**
   * Query all evidence for a specific product.
   */
  queryByProduct(productId) {
    return this._byProduct.get(String(productId || '')) || [];
  }

  /**
   * List all indexed fields.
   */
  fields() {
    return [...this._byField.keys()];
  }

  clear() {
    this._byField.clear();
    this._byProduct.clear();
  }

  stats() {
    let total = 0;
    for (const fieldMap of this._byField.values()) {
      total += fieldMap.size;
    }
    return {
      field_count: this._byField.size,
      total_entries: total,
      product_count: this._byProduct.size
    };
  }
}
