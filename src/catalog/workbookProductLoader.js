/**
 * Workbook Product Loader — reads products + field values from the Excel workbook.
 *
 * Replaces activeFilteringLoader as the data source for catalog seeding.
 * The workbook (configured via Mapping Studio) is the single source of truth
 * for what products exist and their field values.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadWorkbookMap, extractWorkbookContext } from '../ingest/categoryCompile.js';
import { extractExcelSeedData, loadCategoryFieldRules } from '../ingest/excelSeed.js';
import { cleanVariant } from './identityDedup.js';

/**
 * Load product identities (brand, model, variant) from the workbook.
 * Uses workbookMap + extractWorkbookContext from categoryCompile.
 * Returns [{ brand, model, variant }] or [] if no workbook configured.
 */
export async function loadWorkbookProducts({ category, config = {} }) {
  const cat = String(category ?? '').trim().toLowerCase();
  if (!cat) return [];

  try {
    const mapResult = await loadWorkbookMap({ category: cat, config });
    if (!mapResult?.map?.workbook_path) return [];

    const result = await extractWorkbookContext({
      workbookPath: mapResult.map.workbook_path,
      workbookMap: mapResult.map,
      category: cat
    });

    if (!Array.isArray(result?.products)) return [];

    return result.products
      .filter(p => {
        const brand = String(p.brand ?? '').trim();
        const model = String(p.model ?? '').trim();
        return brand && model;
      })
      .map(p => ({
        brand: String(p.brand ?? '').trim(),
        model: String(p.model ?? '').trim(),
        variant: cleanVariant(p.variant)
      }));
  } catch {
    return [];
  }
}

/**
 * Load products with full field values from the workbook.
 * Uses extractExcelSeedData from excelSeed.js which returns canonical_fields per product.
 * Returns [{ brand, model, variant, canonical_fields: { weight: "95", ... } }] or [].
 */
export async function loadWorkbookProductsWithFields({ category, config = {} }) {
  const cat = String(category ?? '').trim().toLowerCase();
  if (!cat) return [];

  try {
    const frResult = await loadCategoryFieldRules(cat, config);
    const fieldRules = frResult?.value || {};

    const extracted = await extractExcelSeedData({
      category: cat,
      config,
      fieldRules,
      fieldOrder: []
    });

    if (!extracted?.enabled || !Array.isArray(extracted.products)) return [];

    return extracted.products
      .filter(p => {
        const brand = String(p.brand ?? '').trim();
        const model = String(p.model ?? '').trim();
        return brand && model;
      })
      .map(p => ({
        brand: String(p.brand ?? '').trim(),
        model: String(p.model ?? '').trim(),
        variant: cleanVariant(p.variant),
        canonical_fields: p.canonical_fields || {}
      }));
  } catch {
    return [];
  }
}

/**
 * List local category directories (replaces S3-based discoverCategories).
 * Scans helper_files/ for subdirectories, filters out _ prefixed ones.
 */
export async function discoverCategoriesLocal({ helperFilesRoot } = {}) {
  const root = helperFilesRoot || 'helper_files';
  const rootPath = path.resolve(root);
  const cats = [];

  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('_')) {
        cats.push(e.name);
      }
    }
  } catch {}

  return cats.sort();
}
