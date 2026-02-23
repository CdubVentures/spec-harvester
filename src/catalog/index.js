export {
  loadProductCatalog,
  saveProductCatalog,
  addProduct,
  addProductsBulk,
  updateProduct,
  removeProduct,
  seedFromWorkbook,
  listProducts
} from './productCatalog.js';
export {
  loadBrandRegistry,
  saveBrandRegistry,
  addBrand,
  addBrandsBulk,
  updateBrand,
  removeBrand,
  getBrandsForCategory,
  findBrandByAlias,
  seedBrandsFromActiveFiltering,
  seedBrandsFromWorkbook,
  renameBrand,
  getBrandImpactAnalysis,
  appendBrandRenameLog
} from './brandRegistry.js';
export {
  buildCanonicalIdentityIndex,
  loadCanonicalIdentityIndex,
  evaluateIdentityGate,
  registerCanonicalIdentity,
  maybeCanonicalProductId,
  normalizeIdentityForGate
} from './identityGate.js';
export {
  cleanVariant,
  isFabricatedVariant,
  normalizeProductIdentity
} from './identityDedup.js';
export { generateIdentifier, nextAvailableId } from './productIdentity.js';
export { slugify, buildProductId } from './slugify.js';
export {
  loadWorkbookProducts,
  loadWorkbookProductsWithFields,
  discoverCategoriesLocal
} from './workbookProductLoader.js';
export {
  loadActiveFilteringData,
  discoverCategories
} from './activeFilteringLoader.js';
export {
  migrateProductArtifacts,
  appendRenameLog
} from './artifactMigration.js';
export { scanOrphans, reconcileOrphans } from './reconciler.js';
