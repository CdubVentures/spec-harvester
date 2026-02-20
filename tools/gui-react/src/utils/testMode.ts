export function isTestCategory(category: string): boolean {
  return category.startsWith('_test_');
}

export function formatTestCategory(category: string): string {
  if (!isTestCategory(category)) return category;
  return 'Test: ' + category.slice('_test_'.length);
}
