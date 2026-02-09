import { MOUSE_FIELD_ORDER } from '../constants.js';

function makeUnknownFieldMap() {
  const map = {};
  for (const field of MOUSE_FIELD_ORDER) {
    map[field] = 'unk';
  }
  return map;
}

export function buildIdentityObject(job, extractedIdentity = {}) {
  const lock = job.identityLock || {};
  const brand = lock.brand || extractedIdentity.brand || 'unk';
  const model = lock.model || extractedIdentity.model || 'unk';
  const sku = lock.sku || extractedIdentity.sku || 'unk';

  return {
    brand,
    model,
    base_model: lock.model || extractedIdentity.base_model || model,
    variant: lock.variant || extractedIdentity.variant || 'unk',
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
  completeness
}) {
  const fields = makeUnknownFieldMap();
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
      completeness,
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
