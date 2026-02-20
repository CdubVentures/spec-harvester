function normalizePart(value) {
  return String(value ?? '').trim();
}

/**
 * Canonical key for shared component review state.
 * Format must stay stable because key_review_state enforces uniqueness on this token.
 */
export function buildComponentIdentifier(componentType, componentName, componentMaker = '') {
  const type = normalizePart(componentType);
  const name = normalizePart(componentName);
  const maker = normalizePart(componentMaker);
  return `${type}::${name}::${maker}`;
}
