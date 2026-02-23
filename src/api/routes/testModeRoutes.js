export function registerTestModeRoutes(ctx) {
  const {
    jsonRes,
    readJsonBody,
    toInt,
    toUnitRatio,
    config,
    storage,
    HELPER_ROOT,
    OUTPUT_ROOT,
    getSpecDb,
    getSpecDbReady,
    fs,
    path,
    safeReadJson,
    safeStat,
    listFiles,
    resolveCategoryAlias,
    broadcastWs,
    buildTrafficLight,
    deriveTrafficLightCounts,
    readLatestArtifacts,
    analyzeContract,
    buildTestProducts,
    generateTestSourceResults,
    buildDeterministicSourceResults,
    buildSeedComponentDB,
    buildValidationChecks,
    loadComponentIdentityPoolsFromWorkbook,
    runTestProduct,
    runComponentReviewBatch,
    purgeTestModeCategoryState,
    resetTestModeSharedReviewState,
    resetTestModeProductReviewState,
    addBrand,
    loadBrandRegistry,
    saveBrandRegistry,
    invalidateFieldRulesCache,
    sessionCache,
  } = ctx;

  return async function handleTestModeRoutes(parts, params, method, req, res) {
    // POST /api/v1/test-mode/create  { sourceCategory }
    if (parts[0] === 'test-mode' && parts[1] === 'create' && method === 'POST') {
      const body = await readJsonBody(req);
      const sourceCategory = body.sourceCategory || 'mouse';
      const testCategory = `_test_${sourceCategory}`;
      const sourceDir = path.join(HELPER_ROOT, sourceCategory, '_generated');
      const sourceStat = await safeStat(sourceDir);
      if (!sourceStat) return jsonRes(res, 400, { ok: false, error: 'source_category_not_found', sourceCategory });

      try {
        const runtimeSpecDb = await getSpecDbReady(testCategory);
        purgeTestModeCategoryState(runtimeSpecDb, testCategory);
      } catch { /* non-fatal */ }

      const testDir = path.join(HELPER_ROOT, testCategory);
      const fixturesCategoryDir = path.join('fixtures', 's3', 'specs', 'inputs', testCategory);
      const outputsCategoryDir = path.join(OUTPUT_ROOT, 'specs', 'outputs', testCategory);
      await Promise.all([
        fs.rm(testDir, { recursive: true, force: true }),
        fs.rm(fixturesCategoryDir, { recursive: true, force: true }),
        fs.rm(outputsCategoryDir, { recursive: true, force: true }),
      ]);
      const genDir = path.join(testDir, '_generated');
      const compDbDir = path.join(genDir, 'component_db');
      await fs.mkdir(genDir, { recursive: true });
      await fs.mkdir(compDbDir, { recursive: true });
      await fs.mkdir(path.join(testDir, '_control_plane'), { recursive: true });
      await fs.mkdir(path.join(testDir, '_overrides'), { recursive: true });
      await fs.mkdir(path.join(testDir, '_suggestions'), { recursive: true });

      // Copy generated rule files with progress broadcasts
      const ruleFiles = ['field_rules.json', 'field_rules.runtime.json', 'known_values.json',
        'cross_validation_rules.json', 'parse_templates.json', 'ui_field_catalog.json',
        'key_migrations.json', 'field_groups.json', 'manifest.json'];

      broadcastWs('test-import-progress', { step: 'field_rules', status: 'copying', detail: `Copying ${ruleFiles.length} rule files` });
      let copiedRules = 0;
      for (const f of ruleFiles) {
        const src = path.join(sourceDir, f);
        const dest = path.join(genDir, f);
        try { await fs.copyFile(src, dest); copiedRules++; } catch { /* skip missing */ }
      }
      broadcastWs('test-import-progress', { step: 'field_rules', status: 'done', detail: `${copiedRules} rule files` });

      // Build seed component DBs from source contract analysis
      const sourceAnalysis = await analyzeContract(HELPER_ROOT, sourceCategory);
      const componentTypes = (sourceAnalysis?.summary?.componentTypes || [])
        .map((row) => String(row?.type || '').trim())
        .filter(Boolean);
      const identityPoolsByType = await loadComponentIdentityPoolsFromWorkbook({
        componentTypes,
        strict: true,
      });
      const seedDBs = buildSeedComponentDB(sourceAnalysis, testCategory, {
        identityPoolsByType,
        strictIdentityPools: true,
      });
      for (const [dbFile, db] of Object.entries(seedDBs)) {
        broadcastWs('test-import-progress', { step: `component_db/${dbFile}`, status: 'copying', file: `${dbFile}.json` });
        await fs.writeFile(path.join(compDbDir, `${dbFile}.json`), JSON.stringify(db, null, 2));
        broadcastWs('test-import-progress', { step: `component_db/${dbFile}`, status: 'done', detail: `${db.items.length} seed items` });
      }

      // Create products directory in fixtures
      const productsDir = path.join('fixtures', 's3', 'specs', 'inputs', testCategory, 'products');
      await fs.mkdir(productsDir, { recursive: true });

      // Analyze the test category contract for summary
      let contractSummary = null;
      try {
        const analysis = await analyzeContract(HELPER_ROOT, testCategory);
        contractSummary = analysis.summary;
        broadcastWs('test-import-progress', {
          step: 'complete',
          status: 'done',
          summary: {
            fields: analysis.summary.fieldCount,
            components: analysis.summary.componentTypes.length,
            componentItems: analysis.summary.componentTypes.reduce((s, c) => s + c.itemCount, 0),
            enums: analysis.summary.knownValuesCatalogs.length,
            rules: analysis.summary.crossValidationRules.length
          }
        });
      } catch { /* non-fatal */ }

      return jsonRes(res, 200, { ok: true, category: testCategory, contractSummary });
    }

    // GET /api/v1/test-mode/contract-summary?category=_test_mouse
    if (parts[0] === 'test-mode' && parts[1] === 'contract-summary' && method === 'GET') {
      const category = resolveCategoryAlias(params.get('category') || '');
      if (!category || !category.startsWith('_test_')) {
        return jsonRes(res, 400, { ok: false, error: 'invalid_test_category' });
      }

      try {
        const analysis = await analyzeContract(HELPER_ROOT, category);
        return jsonRes(res, 200, { ok: true, summary: analysis.summary, matrices: analysis.matrices, scenarioDefs: analysis.scenarioDefs });
      } catch (err) {
        return jsonRes(res, 500, { ok: false, error: err.message });
      }
    }

    // GET /api/v1/test-mode/status?sourceCategory=mouse
    if (parts[0] === 'test-mode' && parts[1] === 'status' && method === 'GET') {
      const sourceCategory = params.get('sourceCategory') || 'mouse';
      const testCategory = `_test_${sourceCategory}`;
      const genDir = path.join(HELPER_ROOT, testCategory, '_generated');
      const genExists = await safeStat(genDir);

      if (!genExists) {
        return jsonRes(res, 200, { ok: true, exists: false, testCategory: '', testCases: [], runResults: [] });
      }

      const productsDir = path.join('fixtures', 's3', 'specs', 'inputs', testCategory, 'products');
      const productFiles = await listFiles(productsDir, '.json').catch(() => []);
      const testCases = [];
      const runResults = [];

      for (const pf of productFiles) {
        const job = await safeReadJson(path.join(productsDir, pf));
        if (!job?._testCase) continue;
        testCases.push({
          id: job._testCase.id,
          name: job._testCase.name,
          description: job._testCase.description,
          category: job._testCase.category,
          productId: job.productId
        });

        try {
          const latest = await readLatestArtifacts(storage, testCategory, job.productId);
          const summary = latest.summary && typeof latest.summary === 'object'
            ? latest.summary
            : null;
          if (summary && Object.keys(summary).length > 0) {
            const confidence = toUnitRatio(summary.confidence) ?? toUnitRatio(summary.confidence_percent);
            const coverage = toUnitRatio(summary.coverage_overall) ?? toUnitRatio(summary.coverage_overall_percent);
            const completeness = toUnitRatio(summary.completeness_required) ?? toUnitRatio(summary.completeness_required_percent);
            const trafficLight = deriveTrafficLightCounts({ summary, provenance: latest.provenance }, buildTrafficLight);
            runResults.push({
              productId: job.productId,
              status: 'complete',
              testCase: job._testCase,
              confidence,
              coverage,
              completeness,
              trafficLight,
              constraintConflicts: summary?.constraint_analysis?.contradictionCount || summary?.constraint_analysis?.contradiction_count || 0,
              missingRequired: Array.isArray(summary?.missing_required_fields) ? summary.missing_required_fields : [],
              curationSuggestions: summary?.runtime_engine?.curation_suggestions_count || 0,
              runtimeFailures: (summary?.runtime_engine?.failures || []).length,
              durationMs: toInt(summary?.duration_ms, 0) || undefined
            });
          }
        } catch { /* no artifacts yet */ }
      }

      return jsonRes(res, 200, { ok: true, exists: true, testCategory, testCases, runResults });
    }

    // POST /api/v1/test-mode/generate-products  { category }
    if (parts[0] === 'test-mode' && parts[1] === 'generate-products' && method === 'POST') {
      const body = await readJsonBody(req);
      const category = resolveCategoryAlias(body.category);
      if (!category || !category.startsWith('_test_')) {
        return jsonRes(res, 400, { ok: false, error: 'invalid_test_category' });
      }

      const productsDir = path.join('fixtures', 's3', 'specs', 'inputs', category, 'products');
      await fs.rm(productsDir, { recursive: true, force: true });
      await fs.mkdir(productsDir, { recursive: true });
      const outputsCategoryDir = path.join(OUTPUT_ROOT, 'specs', 'outputs', category);
      await fs.rm(outputsCategoryDir, { recursive: true, force: true });
      const suggestionsDir = path.join(HELPER_ROOT, category, '_suggestions');
      await fs.mkdir(suggestionsDir, { recursive: true });
      await Promise.all([
        fs.rm(path.join(suggestionsDir, 'enums.json'), { force: true }),
        fs.rm(path.join(suggestionsDir, 'components.json'), { force: true }),
        fs.rm(path.join(suggestionsDir, 'component_review.json'), { force: true }),
      ]);

      let contractAnalysis = null;
      try {
        contractAnalysis = await analyzeContract(HELPER_ROOT, category);
      } catch { /* non-fatal */ }

      const testProducts = buildTestProducts(category, contractAnalysis);
      const productIds = [];
      const testCases = [];

      for (const product of testProducts) {
        const filePath = path.join(productsDir, `${product.productId}.json`);
        await fs.writeFile(filePath, JSON.stringify(product, null, 2));
        productIds.push(product.productId);
        testCases.push({
          id: product._testCase.id,
          name: product._testCase.name,
          description: product._testCase.description,
          category: product._testCase.category,
          productId: product.productId
        });
      }

      // Build product_catalog.json
      const catalogProducts = {};
      const testBrands = new Set();
      for (const product of testProducts) {
        const il = product.identityLock || {};
        const brandName = il.brand || 'TestCo';
        testBrands.add(brandName);
        catalogProducts[product.productId] = {
          id: il.id || 0,
          identifier: il.identifier || '',
          brand: brandName,
          model: il.model || '',
          variant: il.variant || '',
          status: 'active',
          seed_urls: [],
          added_at: new Date().toISOString(),
          added_by: 'test-mode'
        };
      }
      const catalogDir = path.join(HELPER_ROOT, category, '_control_plane');
      await fs.mkdir(catalogDir, { recursive: true });
      await fs.writeFile(
        path.join(catalogDir, 'product_catalog.json'),
        JSON.stringify({ _doc: 'Test mode product catalog', _version: 1, products: catalogProducts }, null, 2)
      );

      testBrands.add('NovaForge Labs');
      for (const brandName of testBrands) {
        const result = await addBrand({ config, name: brandName, aliases: [], categories: [category] });
        if (result.ok === false && result.error === 'brand_already_exists') {
          const registry = await loadBrandRegistry(config);
          const brand = registry.brands[result.slug];
          if (brand && !brand.categories.includes(category.toLowerCase())) {
            brand.categories.push(category.toLowerCase());
            await saveBrandRegistry(config, registry);
          }
        }
      }

      return jsonRes(res, 200, { ok: true, products: productIds, testCases });
    }

    // POST /api/v1/test-mode/run  { category, productId? }
    if (parts[0] === 'test-mode' && parts[1] === 'run' && method === 'POST') {
      const body = await readJsonBody(req);
      const category = resolveCategoryAlias(body.category);
      if (!category || !category.startsWith('_test_')) {
        return jsonRes(res, 400, { ok: false, error: 'invalid_test_category' });
      }

      const productsDir = path.join('fixtures', 's3', 'specs', 'inputs', category, 'products');
      let productFiles;
      if (body.productId) {
        productFiles = [`${body.productId}.json`];
      } else {
        productFiles = await listFiles(productsDir, '.json');
      }
      const resetState = body?.resetState !== false;
      const runtimeSpecDb = await getSpecDbReady(category);
      if (resetState && runtimeSpecDb && !body.productId) {
        resetTestModeSharedReviewState(runtimeSpecDb, category);
      }

      const fieldRulesPath = path.join(HELPER_ROOT, category, '_generated', 'field_rules.json');
      const knownValuesPath = path.join(HELPER_ROOT, category, '_generated', 'known_values.json');
      const compDbDir = path.join(HELPER_ROOT, category, '_generated', 'component_db');

      const fieldRules = await safeReadJson(fieldRulesPath) || {};
      const knownValues = await safeReadJson(knownValuesPath) || {};
      const componentDBs = {};
      const compFiles = await listFiles(compDbDir, '.json');
      for (const f of compFiles) {
        const data = await safeReadJson(path.join(compDbDir, f));
        if (data) componentDBs[data?.component_type || f.replace('.json', '')] = data;
      }

      let contractAnalysis = null;
      try {
        contractAnalysis = await analyzeContract(HELPER_ROOT, category);
      } catch { /* non-fatal */ }
      const generationOptions = (body && typeof body.generation === 'object' && body.generation !== null)
        ? body.generation
        : {};

      const results = [];
      for (const pf of productFiles) {
        const productPath = path.join(productsDir, pf);
        const job = await safeReadJson(productPath);
        if (!job) { results.push({ file: pf, error: 'read_failed' }); continue; }

        if (resetState && runtimeSpecDb) {
          resetTestModeProductReviewState(runtimeSpecDb, category, job.productId);
        }

        try {
          let sourceResults;
          if (body.useLlm) {
            sourceResults = await generateTestSourceResults({
              product: job,
              fieldRules,
              componentDBs,
              knownValues,
              config,
              contractAnalysis,
              generationOptions,
            });
          } else {
            sourceResults = buildDeterministicSourceResults({
              product: job,
              contractAnalysis,
              fieldRules,
              componentDBs,
              knownValues,
              generationOptions,
            });
          }

          const result = await runTestProduct({
            storage, config, job, sourceResults, category
          });
          results.push({ productId: job.productId, status: 'complete', ...result });
        } catch (err) {
          results.push({ productId: job.productId, status: 'error', error: err.message });
        }
      }

      if (body.aiReview) {
        try {
          await runComponentReviewBatch({ config, category, logger: null });
        } catch { /* non-fatal */ }
      }

      const resyncSpecDb = body?.resyncSpecDb !== false;
      if (runtimeSpecDb && resyncSpecDb) {
        try {
          if (!body.productId) {
            purgeTestModeCategoryState(runtimeSpecDb, category);
          }
          const { loadFieldRules } = await import('../../field-rules/loader.js');
          const { seedSpecDb } = await import('../../db/seed.js');
          const seedFieldRules = await loadFieldRules(category, { config });
          await seedSpecDb({ db: runtimeSpecDb, config, category, fieldRules: seedFieldRules });
        } catch (err) {
          results.push({
            status: 'warning',
            warning: 'specdb_resync_failed',
            error: err?.message || 'Unknown SpecDb resync error',
          });
        }
      }

      broadcastWs('data-change', { type: 'review', category });
      return jsonRes(res, 200, { ok: true, results });
    }

    // POST /api/v1/test-mode/validate  { category }
    if (parts[0] === 'test-mode' && parts[1] === 'validate' && method === 'POST') {
      const body = await readJsonBody(req);
      const category = resolveCategoryAlias(body.category);
      if (!category || !category.startsWith('_test_')) {
        return jsonRes(res, 400, { ok: false, error: 'invalid_test_category' });
      }

      const productsDir = path.join('fixtures', 's3', 'specs', 'inputs', category, 'products');
      const productFiles = await listFiles(productsDir, '.json');
      const allChecks = [];
      let passed = 0;
      let failed = 0;

      const suggestionsEnums = await safeReadJson(path.join(HELPER_ROOT, category, '_suggestions', 'enums.json')) || { suggestions: [] };
      const suggestionsComponents = await safeReadJson(path.join(HELPER_ROOT, category, '_suggestions', 'components.json')) || { suggestions: [] };

      let contractAnalysis = null;
      try {
        contractAnalysis = await analyzeContract(HELPER_ROOT, category);
      } catch { /* non-fatal */ }
      const scenarioDefs = contractAnalysis?.scenarioDefs || null;

      for (const pf of productFiles) {
        const job = await safeReadJson(path.join(productsDir, pf));
        if (!job?._testCase) continue;

        const productId = job.productId;
        const testCase = job._testCase;

        const latest = await readLatestArtifacts(storage, category, productId);
        const normalizedSpec = latest.normalized;
        const summary = latest.summary;

        const hasRun = Boolean(summary?.runId || summary?.productId);
        if (!hasRun) {
          allChecks.push({ productId, testCase: testCase.name, testCaseId: testCase.id, check: 'has_run', pass: false, detail: 'No output artifacts found' });
          failed++;
          continue;
        }

        const scenarioChecks = buildValidationChecks(testCase.id, {
          normalized: normalizedSpec,
          summary,
          suggestionsEnums,
          suggestionsComponents,
          scenarioDefs
        });

        for (const sc of scenarioChecks) {
          allChecks.push({ productId, testCase: testCase.name, testCaseId: testCase.id, ...sc });
          sc.pass ? passed++ : failed++;
        }
      }

      return jsonRes(res, 200, { results: allChecks, summary: { passed, failed, total: passed + failed } });
    }

    // DELETE /api/v1/test-mode/{category}
    if (parts[0] === 'test-mode' && parts[1] && method === 'DELETE') {
      const category = parts[1];
      if (!category.startsWith('_test_')) {
        return jsonRes(res, 400, { ok: false, error: 'can_only_delete_test_categories' });
      }

      try {
        const runtimeSpecDb = await getSpecDbReady(category);
        purgeTestModeCategoryState(runtimeSpecDb, category);
      } catch { /* non-fatal */ }

      const fixturesRoot = path.resolve('fixtures', 's3', 'specs', 'inputs');
      const dirs = [
        path.resolve(HELPER_ROOT, category),
        path.resolve(fixturesRoot, category),
        path.resolve(OUTPUT_ROOT, 'specs', 'outputs', category)
      ];
      for (const dir of dirs) {
        if (!dir.startsWith(path.resolve(HELPER_ROOT)) &&
            !dir.startsWith(fixturesRoot) &&
            !dir.startsWith(path.resolve(OUTPUT_ROOT))) {
          return jsonRes(res, 400, { ok: false, error: 'invalid_category_path' });
        }
        try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      }

      try {
        const registry = await loadBrandRegistry(config);
        const catLower = category.toLowerCase();
        for (const [slug, brand] of Object.entries(registry.brands || {})) {
          const idx = brand.categories.indexOf(catLower);
          if (idx >= 0) {
            brand.categories.splice(idx, 1);
            if (
              brand.categories.length === 0
              && (brand.canonical_name === 'TestCo' || brand.canonical_name === 'TestNewBrand' || brand.canonical_name === 'NovaForge Labs')
            ) {
              delete registry.brands[slug];
            }
          }
        }
        await saveBrandRegistry(config, registry);
      } catch { /* non-fatal */ }

      return jsonRes(res, 200, { ok: true, deleted: category });
    }

    return false;
  };
}
