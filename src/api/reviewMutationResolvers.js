function toPositiveId(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const id = Math.trunc(n);
  return id > 0 ? id : null;
}

export function resolveExplicitPositiveId(body, keys = []) {
  if (!body || !Array.isArray(keys) || keys.length === 0) {
    return { provided: false, id: null, raw: null, key: null };
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const raw = body?.[key];
    const token = String(raw ?? '').trim();
    if (!token) continue;
    return {
      provided: true,
      id: toPositiveId(raw),
      raw: token,
      key,
    };
  }
  return { provided: false, id: null, raw: null, key: null };
}

export function resolveGridFieldStateForMutation(specDb, category, body) {
  if (!specDb) {
    return {
      row: null,
      error: 'specdb_not_ready',
      errorMessage: 'SpecDb is not available for this category.',
    };
  }
  const idReq = resolveExplicitPositiveId(body, [
    'itemFieldStateId',
    'item_field_state_id',
  ]);
  if (idReq.provided) {
    const byId = idReq.id ? specDb.getItemFieldStateById(idReq.id) : null;
    if (byId && String(byId.category || '').trim() === String(category || '').trim()) {
      return { row: byId, error: null };
    }
    return {
      row: null,
      error: 'item_field_state_id_not_found',
      errorMessage: `itemFieldStateId '${idReq.raw}' does not resolve in category '${category}'.`,
    };
  }
  return {
    row: null,
    error: 'item_field_state_id_required',
    errorMessage: 'itemFieldStateId is required for this mutation.',
  };
}

export function resolveComponentMutationContext(specDb, category, body, options = {}) {
  if (!specDb) {
    return {
      error: 'specdb_not_ready',
      errorMessage: 'SpecDb is not available for this category.',
    };
  }
  const requireComponentValueId = Boolean(options?.requireComponentValueId);
  const requireComponentIdentityId = Boolean(options?.requireComponentIdentityId);

  const componentValueReq = resolveExplicitPositiveId(body, [
    'componentValueId',
    'component_value_id',
  ]);
  let componentValueRow = componentValueReq.id ? specDb.getComponentValueById(componentValueReq.id) : null;
  if (componentValueRow && String(componentValueRow.category || '').trim() !== String(category || '').trim()) {
    componentValueRow = null;
  }
  if (componentValueReq.provided && !componentValueRow) {
    return {
      error: 'component_value_id_not_found',
      errorMessage: `componentValueId '${componentValueReq.raw}' does not resolve in category '${category}'.`,
    };
  }
  if (requireComponentValueId && !componentValueReq.provided) {
    return {
      error: 'component_value_id_required',
      errorMessage: 'componentValueId is required for component property mutations.',
    };
  }

  let componentType = '';
  let componentName = '';
  let componentMaker = '';
  let property = String(body?.property || body?.propertyKey || '').trim();

  if (componentValueRow) {
    componentType = String(componentValueRow.component_type || '').trim();
    componentName = String(componentValueRow.component_name || '').trim();
    componentMaker = String(componentValueRow.component_maker || '').trim();
    property = String(componentValueRow.property_key || '').trim();
  }

  const componentIdentityReq = resolveExplicitPositiveId(body, [
    'componentIdentityId',
    'component_identity_id',
  ]);
  let identityRow = componentIdentityReq.id ? specDb.getComponentIdentityById(componentIdentityReq.id) : null;
  if (identityRow && String(identityRow.category || '').trim() !== String(category || '').trim()) {
    identityRow = null;
  }
  if (componentIdentityReq.provided && !identityRow) {
    return {
      error: 'component_identity_id_not_found',
      errorMessage: `componentIdentityId '${componentIdentityReq.raw}' does not resolve in category '${category}'.`,
    };
  }
  if (requireComponentIdentityId && !componentIdentityReq.provided) {
    return {
      error: 'component_identity_id_required',
      errorMessage: 'componentIdentityId is required for component identity mutations.',
    };
  }
  if (!componentValueReq.provided && !componentIdentityReq.provided) {
    return {
      error: 'component_slot_or_identity_id_required',
      errorMessage: 'Provide componentValueId or componentIdentityId for component mutations.',
    };
  }
  if (identityRow) {
    componentType = String(identityRow.component_type || componentType || '').trim();
    componentName = String(identityRow.canonical_name || componentName || '').trim();
    componentMaker = String(identityRow.maker || componentMaker || '').trim();
  }

  return {
    componentType,
    componentName,
    componentMaker,
    property,
    componentIdentityId: identityRow?.id ?? componentIdentityReq.id ?? null,
    componentIdentityRow: identityRow || null,
    componentValueId: componentValueRow?.id ?? componentValueReq.id ?? null,
    componentValueRow: componentValueRow || null,
    error: null,
  };
}

export function resolveEnumMutationContext(specDb, category, body, options = {}) {
  if (!specDb) {
    return {
      error: 'specdb_not_ready',
      errorMessage: 'SpecDb is not available for this category.',
    };
  }
  const requireListValueId = Boolean(options?.requireListValueId);
  const requireEnumListId = Boolean(options?.requireEnumListId);
  const listValueReq = resolveExplicitPositiveId(body, ['listValueId', 'list_value_id']);
  const enumListReq = resolveExplicitPositiveId(body, ['enumListId', 'enum_list_id']);

  let listValueRow = listValueReq.id ? specDb.getListValueById(listValueReq.id) : null;
  if (listValueRow && String(listValueRow.category || '').trim() !== String(category || '').trim()) {
    listValueRow = null;
  }
  if (listValueReq.provided && !listValueRow) {
    return {
      error: 'list_value_id_not_found',
      errorMessage: `listValueId '${listValueReq.raw}' does not resolve in category '${category}'.`,
    };
  }
  if (requireListValueId && !listValueReq.provided) {
    return {
      error: 'list_value_id_required',
      errorMessage: 'listValueId is required for enum value mutations.',
    };
  }

  let enumListRow = enumListReq.id ? specDb.getEnumListById(enumListReq.id) : null;
  if (enumListRow && String(enumListRow.category || '').trim() !== String(category || '').trim()) {
    enumListRow = null;
  }
  if (enumListReq.provided && !enumListRow) {
    return {
      error: 'enum_list_id_not_found',
      errorMessage: `enumListId '${enumListReq.raw}' does not resolve in category '${category}'.`,
    };
  }
  if (requireEnumListId && !enumListReq.provided) {
    return {
      error: 'enum_list_id_required',
      errorMessage: 'enumListId is required for enum list mutations.',
    };
  }
  if (!listValueReq.provided && !enumListReq.provided) {
    return {
      error: 'list_value_or_enum_list_id_required',
      errorMessage: 'Provide listValueId or enumListId for enum mutations.',
    };
  }
  if (!enumListRow && listValueRow?.list_id) {
    enumListRow = specDb.getEnumListById(listValueRow.list_id);
  }

  const field = String(listValueRow?.field_key || enumListRow?.field_key || '').trim();
  const value = body?.value !== undefined && body?.value !== null
    ? String(body.value).trim()
    : String(listValueRow?.value || '').trim();
  const oldValue = body?.oldValue !== undefined
    ? String(body.oldValue || '').trim()
    : (body?.old_value !== undefined
      ? String(body.old_value || '').trim()
      : String(listValueRow?.value || '').trim());

  return {
    field,
    value,
    oldValue,
    listValueId: listValueRow?.id ?? listValueReq.id ?? null,
    listValueRow: listValueRow || null,
    enumListId: enumListRow?.id ?? enumListReq.id ?? null,
    enumListRow: enumListRow || null,
    error: null,
  };
}
