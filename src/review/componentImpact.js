import fs from 'node:fs/promises';
import path from 'node:path';

async function safeReadJson(fp) {
  try { return JSON.parse(await fs.readFile(fp, 'utf8')); } catch { return null; }
}

async function listDirs(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

function categoryRootCandidates(outputRoot, category) {
  const roots = [
    path.join(outputRoot, category),
    path.join(outputRoot, 'specs', 'outputs', category),
  ];
  return [...new Set(roots.map((entry) => path.resolve(entry)))];
}

async function listProductDirsFromOutput(outputRoot, category) {
  const names = new Set();
  const roots = categoryRootCandidates(outputRoot, category);
  for (const root of roots) {
    const dirs = await listDirs(root);
    for (const dir of dirs) {
      names.add(dir);
    }
  }
  return [...names];
}

function latestNormalizedPathCandidates(outputRoot, category, productId) {
  return categoryRootCandidates(outputRoot, category)
    .map((root) => path.join(root, productId, 'latest', 'normalized.json'));
}

async function readLatestNormalized(outputRoot, category, productId) {
  for (const filePath of latestNormalizedPathCandidates(outputRoot, category, productId)) {
    const normalized = await safeReadJson(filePath);
    if (normalized) {
      return { filePath, normalized };
    }
  }
  return null;
}

function addAffectedRow(map, row = {}) {
  const productId = String(row.productId || row.product_id || '').trim();
  if (!productId) return;
  const field = String(row.field || row.field_key || '').trim();
  const key = `${productId}::${field || '*'}`;
  if (map.has(key)) return;
  map.set(key, {
    productId,
    field: field || null,
    value: row.value ?? null,
    match_type: row.match_type || null,
    match_score: row.match_score ?? null,
  });
}

function uniqueProductIds(rows = []) {
  return [...new Set(rows.map((row) => String(row?.productId || '').trim()).filter(Boolean))];
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function upsertNormalizedField(normalized, field, value) {
  if (!normalized || !field) return;

  let wrote = false;
  if (normalized.fields && typeof normalized.fields === 'object') {
    if (value === undefined) delete normalized.fields[field];
    else normalized.fields[field] = value;
    wrote = true;
  }
  if (normalized.specs && typeof normalized.specs === 'object') {
    if (value === undefined) delete normalized.specs[field];
    else normalized.specs[field] = value;
    wrote = true;
  }
  if (!wrote) {
    normalized.fields = {};
    if (value !== undefined) {
      normalized.fields[field] = value;
    }
  }
}

/**
 * Find all products whose normalized.json references a specific component.
 * Tries SpecDb first, then falls back to filesystem scan.
 */
export async function findProductsReferencingComponent({
  outputRoot,
  category,
  componentType,
  componentName,
  componentMaker = '',
  specDb = null,
}) {
  const affectedMap = new Map();

  if (specDb) {
    try {
      const linkRows = specDb.getProductsForComponent(componentType, componentName, componentMaker || '');
      for (const row of linkRows) {
        addAffectedRow(affectedMap, {
          productId: row.product_id,
          field: row.field_key || componentType,
          value: componentName,
          match_type: row.match_type || 'exact',
          match_score: row.match_score ?? null,
        });
      }

      // Catch products that reference the component but are not linked yet.
      const fieldRows = specDb.getProductsForFieldValue(componentType, componentName);
      for (const row of fieldRows) {
        addAffectedRow(affectedMap, {
          productId: row.product_id,
          field: row.field_key || componentType,
          value: componentName,
          match_type: 'field_state',
          match_score: 1.0,
        });
      }
    } catch {
      // Fall through to filesystem fallback.
    }
  }

  const productDirs = await listProductDirsFromOutput(outputRoot, category);
  const nameStr = String(componentName || '').trim().toLowerCase();

  for (const productId of productDirs) {
    if (productId.startsWith('_')) continue;

    const productData = await readLatestNormalized(outputRoot, category, productId);
    if (!productData?.normalized) continue;
    const { normalized } = productData;

    const values = [];
    if (normalized.fields && typeof normalized.fields === 'object') {
      values.push(normalized.fields[componentType]);
    }
    if (normalized.specs && typeof normalized.specs === 'object') {
      values.push(normalized.specs[componentType]);
    }

    for (const rawValue of values) {
      if (!rawValue) continue;
      const valueStr = String(rawValue).trim().toLowerCase();
      if (!valueStr) continue;
      if (valueStr === nameStr || valueStr.includes(nameStr)) {
        addAffectedRow(affectedMap, {
          productId,
          field: componentType,
          value: String(rawValue),
          match_type: valueStr === nameStr ? 'exact' : 'partial',
          match_score: valueStr === nameStr ? 1.0 : 0.6,
        });
        break;
      }
    }
  }

  return [...affectedMap.values()];
}

/**
 * After a component property changes, mark affected products as stale.
 */
export async function cascadeComponentChange({
  storage,
  outputRoot,
  category,
  componentType,
  componentName,
  componentMaker = '',
  changedProperty,
  newValue,
  variancePolicy,
  constraints = [],
  loadQueueState,
  saveQueueState,
  specDb = null,
}) {
  const affected = await findProductsReferencingComponent({
    outputRoot,
    category,
    componentType,
    componentName,
    componentMaker,
    specDb,
  });
  if (affected.length === 0) return { affected: [], cascaded: 0, propagation: null };

  const affectedProductIds = uniqueProductIds(affected);
  const isIdentity = changedProperty && changedProperty.startsWith('__');
  const hasConstraints = Array.isArray(constraints) && constraints.length > 0;
  const effectivePolicy = variancePolicy || (isIdentity ? 'authoritative' : null);
  let targetProductIds = [...affectedProductIds];

  const propagation = {
    policy: effectivePolicy,
    action: 'stale_only',
    violations: [],
    compliant: [],
    updated: [],
  };

  if (specDb && changedProperty && newValue !== undefined && !isIdentity) {
    try {
      if (effectivePolicy === 'authoritative') {
        const updatedPids = uniqueStrings(specDb.pushAuthoritativeValueToLinkedProducts(
          componentType,
          componentName,
          componentMaker || '',
          changedProperty,
          String(newValue),
        ));
        propagation.action = 'value_pushed';
        propagation.updated = updatedPids;
        targetProductIds = [...updatedPids];

        for (const productId of targetProductIds) {
          try {
            const productData = await readLatestNormalized(outputRoot, category, productId);
            if (!productData?.normalized) continue;
            upsertNormalizedField(productData.normalized, changedProperty, String(newValue));
            await fs.writeFile(productData.filePath, JSON.stringify(productData.normalized, null, 2));
          } catch {
            // Best effort.
          }
        }
      } else if (effectivePolicy === 'upper_bound' || effectivePolicy === 'lower_bound' || effectivePolicy === 'range') {
        const result = specDb.evaluateAndFlagLinkedProducts(
          componentType,
          componentName,
          componentMaker || '',
          changedProperty,
          String(newValue),
          effectivePolicy,
        );
        propagation.action = 'variance_evaluated';
        propagation.violations = result.violations;
        propagation.compliant = result.compliant;
        targetProductIds = uniqueStrings([
          ...(result.violations || []),
          ...(result.compliant || []),
        ]);
      }

      if (hasConstraints) {
        const constraintResult = specDb.evaluateConstraintsForLinkedProducts(
          componentType,
          componentName,
          componentMaker || '',
          changedProperty,
          constraints,
        );
        propagation.constraint_violations = constraintResult.violations;
        propagation.constraint_compliant = constraintResult.compliant;
        for (const pid of constraintResult.violations) {
          if (!propagation.violations.includes(pid)) {
            propagation.violations.push(pid);
          }
        }
        const constraintTargets = uniqueStrings([
          ...(constraintResult.violations || []),
          ...(constraintResult.compliant || []),
        ]);
        if (constraintTargets.length > 0) {
          if (effectivePolicy === 'authoritative' || effectivePolicy === 'upper_bound' || effectivePolicy === 'lower_bound' || effectivePolicy === 'range') {
            targetProductIds = uniqueStrings([...targetProductIds, ...constraintTargets]);
          } else {
            // Constraints-only rechecks should target linked products only.
            targetProductIds = constraintTargets;
          }
        }
      }
    } catch (err) {
      propagation.error = err?.message || 'propagation_failed';
    }
  }

  const loaded = await loadQueueState({ storage, category, specDb });
  const products = loaded.state.products || {};
  let cascaded = 0;

  const priorityMap = { authoritative: 1, upper_bound: 2, lower_bound: 2, range: 2, override_allowed: 3 };
  let priority = priorityMap[effectivePolicy] || 3;
  if (hasConstraints && priority > 1) {
    priority = Math.max(1, priority - 1);
  }

  for (const productId of targetProductIds) {
    const existing = products[productId];
    if (!existing) continue;
    const currentStatus = existing.status || '';
    if (currentStatus === 'complete' || currentStatus === 'stale' || currentStatus === 'pending') {
      existing.status = 'stale';
      existing.priority = Math.min(existing.priority || 99, priority);
      if (!Array.isArray(existing.dirty_flags)) existing.dirty_flags = [];
      existing.dirty_flags.push({
        reason: 'component_change',
        componentType,
        componentName,
        componentMaker: componentMaker || '',
        property: changedProperty,
        newValue: newValue !== undefined ? String(newValue) : undefined,
        variance_policy: effectivePolicy || null,
        propagation_action: propagation.action,
        constraints: hasConstraints ? constraints : [],
        at: new Date().toISOString(),
      });
      cascaded += 1;
    }
  }

  if (cascaded > 0) {
    await saveQueueState({ storage, category, state: loaded.state, specDb });
  }

  if (specDb && targetProductIds.length > 0) {
    try {
      specDb.markProductsStaleDetailed(targetProductIds, {
        reason: 'component_change',
        componentType,
        componentName,
        componentMaker: componentMaker || '',
        property: changedProperty,
        newValue: newValue !== undefined ? String(newValue) : undefined,
        variance_policy: effectivePolicy || null,
        propagation_action: propagation.action,
        constraints: hasConstraints ? constraints : [],
        priority,
        at: new Date().toISOString(),
      });
    } catch {
      // Best effort.
    }
  }

  return { affected, cascaded, propagation };
}

/**
 * After an enum value is removed or renamed, update the stored value in every
 * affected product and mark them stale.
 */
export async function cascadeEnumChange({
  storage,
  outputRoot,
  category,
  field,
  action,
  value,
  newValue,
  preAffectedProductIds = [],
  loadQueueState,
  saveQueueState,
  specDb = null,
}) {
  if (action !== 'remove' && action !== 'rename') return { affected: [], cascaded: 0 };

  const targetValue = String(value).trim();
  const affectedMap = new Map();

  for (const productId of preAffectedProductIds || []) {
    addAffectedRow(affectedMap, {
      productId,
      field,
      value: targetValue,
      match_type: 'precomputed',
      match_score: 1.0,
    });
  }

  if (specDb) {
    try {
      const fieldRows = specDb.getProductsForFieldValue(field, targetValue);
      for (const row of fieldRows) {
        addAffectedRow(affectedMap, {
          productId: row.product_id,
          field: row.field_key || field,
          value: targetValue,
          match_type: 'field_state',
          match_score: 1.0,
        });
      }

      const listRows = specDb.getProductsForListValue(field, targetValue);
      for (const row of listRows) {
        addAffectedRow(affectedMap, {
          productId: row.product_id,
          field: row.field_key || field,
          value: targetValue,
          match_type: 'list_link',
          match_score: 1.0,
        });
      }
    } catch {
      // Fall through to filesystem fallback.
    }
  }

  if (affectedMap.size === 0) {
    const productDirs = await listProductDirsFromOutput(outputRoot, category);
    const normalizedValue = targetValue.toLowerCase();

    for (const productId of productDirs) {
      if (productId.startsWith('_')) continue;

      const productData = await readLatestNormalized(outputRoot, category, productId);
      if (!productData?.normalized) continue;
      const { normalized } = productData;

      const values = [];
      if (normalized.fields && typeof normalized.fields === 'object') {
        values.push(normalized.fields[field]);
      }
      if (normalized.specs && typeof normalized.specs === 'object') {
        values.push(normalized.specs[field]);
      }

      for (const fieldValue of values) {
        if (!fieldValue) continue;
        const fieldStr = String(fieldValue).trim().toLowerCase();
        if (fieldStr === normalizedValue) {
          addAffectedRow(affectedMap, {
            productId,
            field,
            value: String(fieldValue),
            match_type: 'normalized_file',
            match_score: 1.0,
          });
          break;
        }
      }
    }
  }

  const affected = [...affectedMap.values()];
  if (affected.length === 0) return { affected, cascaded: 0 };
  const affectedProductIds = uniqueProductIds(affected);

  if (specDb) {
    try {
      if (action === 'rename' && newValue) {
        specDb.renameFieldValueInItems(field, targetValue, String(newValue).trim());
      } else if (action === 'remove') {
        specDb.removeFieldValueFromItems(field, targetValue);
        specDb.removeListLinks(field, targetValue);
      }
    } catch {
      // Best effort.
    }
  }

  const trimmedNew = newValue ? String(newValue).trim() : null;
  for (const productId of affectedProductIds) {
    try {
      const productData = await readLatestNormalized(outputRoot, category, productId);
      if (!productData?.normalized) continue;

      if (action === 'rename' && trimmedNew) {
        upsertNormalizedField(productData.normalized, field, trimmedNew);
      } else if (action === 'remove') {
        upsertNormalizedField(productData.normalized, field, undefined);
      }
      await fs.writeFile(productData.filePath, JSON.stringify(productData.normalized, null, 2));
    } catch {
      // Best effort.
    }
  }

  const loaded = await loadQueueState({ storage, category, specDb });
  const products = loaded.state.products || {};
  let cascaded = 0;

  const priority = 1;
  const reason = action === 'rename' ? 'enum_renamed' : 'enum_removed';

  for (const productId of affectedProductIds) {
    const existing = products[productId];
    if (!existing) continue;
    existing.status = 'stale';
    existing.priority = Math.min(existing.priority || 99, priority);
    if (!Array.isArray(existing.dirty_flags)) existing.dirty_flags = [];
    existing.dirty_flags.push({
      reason,
      field,
      value: targetValue,
      ...(action === 'rename' ? { newValue: trimmedNew } : {}),
      variance_policy: 'authoritative',
      at: new Date().toISOString(),
    });
    cascaded += 1;
  }

  if (cascaded > 0) {
    await saveQueueState({ storage, category, state: loaded.state, specDb });
  }

  if (specDb && affectedProductIds.length > 0) {
    try {
      specDb.markProductsStaleDetailed(affectedProductIds, {
        reason,
        field,
        value: targetValue,
        ...(action === 'rename' ? { newValue: trimmedNew } : {}),
        variance_policy: 'authoritative',
        priority: 1,
        at: new Date().toISOString(),
      });
    } catch {
      // Best effort.
    }
  }

  return { affected, cascaded };
}
