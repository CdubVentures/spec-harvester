function makeUnknownFieldMap(fieldOrder) {
  const map = {};
  for (const field of fieldOrder) {
    map[field] = 'unk';
  }
  return map;
}

export function buildIdentityObject(job, extractedIdentity = {}, options = {}) {
  const lock = job.identityLock || {};
  const allowDerivedVariant = Boolean(options.allowDerivedVariant);
  const brand = lock.brand || extractedIdentity.brand || 'unk';
  const model = lock.model || extractedIdentity.model || 'unk';
  const sku = lock.sku || extractedIdentity.sku || 'unk';
  const extractedVariant = String(extractedIdentity.variant || '').trim();
  const variant = lock.variant || (allowDerivedVariant && extractedVariant ? extractedVariant : 'unk');

  return {
    brand,
    model,
    base_model: lock.model || extractedIdentity.base_model || model,
    variant,
    sku,
    mpn: lock.mpn || extractedIdentity.mpn || 'unk',
    gtin: lock.gtin || extractedIdentity.gtin || 'unk'
  };
}

export function buildAbortedNormalized({
  productId,
  runId,
  category,
  identity,
  sourceSummary,
  notes,
  confidence,
  completenessRequired,
  coverageOverall,
  fieldOrder
}) {
  const fields = makeUnknownFieldMap(fieldOrder);
  fields.id = productId;
  fields.brand = identity.brand;
  fields.model = identity.model;
  fields.base_model = identity.base_model;
  fields.category = category;
  fields.sku = identity.sku;

  return {
    productId,
    runId,
    category,
    identity,
    fields,
    quality: {
      validated: false,
      confidence,
      completeness_required: completenessRequired,
      coverage_overall: coverageOverall,
      notes
    },
    sources: sourceSummary
  };
}

export function buildValidatedNormalized({
  productId,
  runId,
  category,
  identity,
  fields,
  quality,
  sourceSummary
}) {
  return {
    productId,
    runId,
    category,
    identity,
    fields,
    quality,
    sources: sourceSummary
  };
}
