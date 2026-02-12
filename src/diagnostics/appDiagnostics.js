import fs from 'node:fs/promises';
import path from 'node:path';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toPosixRelative(rootDir, filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, '/');
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function listDirNames(dirPath) {
  try {
    const rows = await fs.readdir(dirPath, { withFileTypes: true });
    return rows
      .filter((row) => row.isDirectory())
      .map((row) => row.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function listWorkbookFiles(dirPath) {
  try {
    const rows = await fs.readdir(dirPath, { withFileTypes: true });
    return rows
      .filter((row) => row.isFile())
      .map((row) => row.name)
      .filter((name) => /\.xlsm?$|\.xlsx$/i.test(name))
      .filter((name) => !name.startsWith('~$'))
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function buildCategoryPaths({ rootDir, category, config }) {
  const helperRoot = path.resolve(rootDir, config.helperFilesRoot || 'helper_files');
  const helperCategory = path.join(helperRoot, category);
  const runtimeCategory = path.resolve(rootDir, 'categories', category);
  const helperCompiledDir = path.join(helperCategory, '_compiled');
  const dataCompiledDir = path.resolve(rootDir, 'data', 'helpers_compiled');

  return {
    helperRoot,
    helperCategory,
    runtimeCategory,
    helperCompiledContract: path.join(helperCompiledDir, `${category}.spec_helpers.compiled.json`),
    helperCompiledExpectations: path.join(helperCompiledDir, `${category}.expectations.json`),
    dataCompiledContract: path.join(dataCompiledDir, `${category}.spec_helpers.compiled.json`),
    dataCompiledExpectations: path.join(dataCompiledDir, `${category}.expectations.json`)
  };
}

async function collectCategoryReport({ rootDir, category, config }) {
  const paths = buildCategoryPaths({ rootDir, category, config });
  const helperSchemaPath = path.join(paths.helperCategory, 'schema.json');
  const helperGeneratedFieldRulesPath = path.join(paths.helperCategory, '_generated', 'field_rules.json');
  const helperFieldRulesPath = path.join(paths.helperCategory, 'field_rules.json');
  const helperRequiredPath = path.join(paths.helperCategory, 'required_fields.json');
  const helperSourcesPath = path.join(paths.helperCategory, 'sources.json');
  const helperSearchTemplatesPath = path.join(paths.helperCategory, 'search_templates.json');
  const helperAnchorsPath = path.join(paths.helperCategory, 'anchors.json');
  const runtimeSchemaPath = path.join(paths.runtimeCategory, 'schema.json');
  const runtimeRequiredPath = path.join(paths.runtimeCategory, 'required_fields.json');
  const runtimeSourcesPath = path.join(paths.runtimeCategory, 'sources.json');
  const runtimeSearchTemplatesPath = path.join(paths.runtimeCategory, 'search_templates.json');
  const runtimeAnchorsPath = path.join(paths.runtimeCategory, 'anchors.json');

  const workbooks = await listWorkbookFiles(paths.helperCategory);
  const [helperSchemaRaw, runtimeSchemaRaw, helperRequiredRaw, runtimeRequiredRaw] = await Promise.all([
    readTextIfExists(helperSchemaPath),
    readTextIfExists(runtimeSchemaPath),
    readTextIfExists(helperRequiredPath),
    readTextIfExists(runtimeRequiredPath)
  ]);

  const schemaMirrorRedundant = Boolean(helperSchemaRaw && runtimeSchemaRaw && helperSchemaRaw === runtimeSchemaRaw);
  const requiredMirrorRedundant = Boolean(
    helperRequiredRaw &&
    runtimeRequiredRaw &&
    helperRequiredRaw === runtimeRequiredRaw
  );

  const files = {
    helper_schema: await pathExists(helperSchemaPath),
    helper_generated_field_rules: await pathExists(helperGeneratedFieldRulesPath),
    helper_field_rules: await pathExists(helperFieldRulesPath),
    helper_required_fields: await pathExists(helperRequiredPath),
    helper_sources: await pathExists(helperSourcesPath),
    helper_search_templates: await pathExists(helperSearchTemplatesPath),
    helper_anchors: await pathExists(helperAnchorsPath),
    runtime_schema: await pathExists(runtimeSchemaPath),
    runtime_required_fields: await pathExists(runtimeRequiredPath),
    runtime_sources: await pathExists(runtimeSourcesPath),
    runtime_search_templates: await pathExists(runtimeSearchTemplatesPath),
    runtime_anchors: await pathExists(runtimeAnchorsPath),
    helper_compiled_contract: await pathExists(paths.helperCompiledContract),
    helper_compiled_expectations: await pathExists(paths.helperCompiledExpectations),
    data_compiled_contract: await pathExists(paths.dataCompiledContract),
    data_compiled_expectations: await pathExists(paths.dataCompiledExpectations)
  };

  const helperContract = await readJsonIfExists(paths.helperCompiledContract);
  const helperExpectations = await readJsonIfExists(paths.helperCompiledExpectations);
  const dataContract = await readJsonIfExists(paths.dataCompiledContract);
  const dataExpectations = await readJsonIfExists(paths.dataCompiledExpectations);

  const contract = helperContract || dataContract;
  const expectations = helperExpectations || dataExpectations;
  const fieldCount = toArray(contract?.fields).length;

  const reports = {
    category,
    helper_root: toPosixRelative(rootDir, paths.helperCategory),
    runtime_root: toPosixRelative(rootDir, paths.runtimeCategory),
    workbooks,
    files,
    compiled: {
      loaded_from: helperContract ? 'helper_files' : (dataContract ? 'data' : null),
      contract_hash: contract?.hash || null,
      expectations_hash: expectations?.hash || null,
      field_count: fieldCount,
      required_fields_count: toArray(expectations?.required_fields).length
    },
    redundancy: {
      schema_mirror_redundant: schemaMirrorRedundant,
      required_fields_mirror_redundant: requiredMirrorRedundant
    },
    runtime_config_strategy: {
      required_fields_file_optional: true,
      required_fields_derivation: 'field_rules.required_fields -> expectations.required_fields -> schema.critical/expected_easy fallback (fields.* only)',
      anchors_role: 'optional hard locks for known field values; conflicting candidates are rejected',
      search_templates_role: 'optional query seeds; query builder still generates targeted brand/model/field queries when absent',
      sources_role: 'approved/denylist domain policy; should be curated by category/brand and refined by source-intel learning artifacts'
    },
    prune_candidates: []
  };

  if (schemaMirrorRedundant) {
    reports.prune_candidates.push(toPosixRelative(rootDir, runtimeSchemaPath));
  }
  if (requiredMirrorRedundant) {
    reports.prune_candidates.push(toPosixRelative(rootDir, runtimeRequiredPath));
  }
  if (files.helper_compiled_contract && files.data_compiled_contract) {
    reports.prune_candidates.push(toPosixRelative(rootDir, paths.dataCompiledContract));
  }
  if (files.helper_compiled_expectations && files.data_compiled_expectations) {
    reports.prune_candidates.push(toPosixRelative(rootDir, paths.dataCompiledExpectations));
  }

  return reports;
}

async function removeIfExists(rootDir, filePath, removed, errors) {
  if (!(await pathExists(filePath))) {
    return;
  }
  try {
    await fs.rm(filePath, { recursive: true, force: true });
    removed.push(toPosixRelative(rootDir, filePath));
  } catch (error) {
    errors.push({
      path: toPosixRelative(rootDir, filePath),
      error: error.message
    });
  }
}

function pickRequestedCategories(discovered, requested = []) {
  const wanted = new Set(toArray(requested).map((item) => String(item || '').trim()).filter(Boolean));
  if (!wanted.size) {
    return discovered;
  }
  return discovered.filter((category) => wanted.has(category));
}

export async function runAppDiagnostics({
  config = {},
  categories = [],
  prune = false,
  pruneMirrors = false,
  rootDir = process.cwd()
} = {}) {
  const helperRoot = path.resolve(rootDir, config.helperFilesRoot || 'helper_files');
  const runtimeRoot = path.resolve(rootDir, 'categories');
  const helperCategories = await listDirNames(helperRoot);
  const runtimeCategories = await listDirNames(runtimeRoot);
  const discovered = [...new Set([...helperCategories, ...runtimeCategories])].sort((a, b) => a.localeCompare(b));
  const selectedCategories = pickRequestedCategories(discovered, categories);

  const categoryReports = [];
  for (const category of selectedCategories) {
    categoryReports.push(await collectCategoryReport({ rootDir, category, config }));
  }

  const safePruneCandidates = [
    path.resolve(rootDir, '.specfactory_tmp'),
    path.resolve(rootDir, 'tools', 'gui', '__pycache__')
  ];
  for (const category of selectedCategories) {
    safePruneCandidates.push(path.resolve(helperRoot, category, 'accurate-supportive-product-information'));
    safePruneCandidates.push(path.resolve(helperRoot, category, 'site_compiler'));
    safePruneCandidates.push(path.resolve(helperRoot, category, 'models-and-schema'));
  }

  const removed = [];
  const pruneErrors = [];
  if (prune) {
    for (const target of safePruneCandidates) {
      await removeIfExists(rootDir, target, removed, pruneErrors);
    }
    for (const report of categoryReports) {
      const paths = buildCategoryPaths({ rootDir, category: report.category, config });
      if (await pathExists(paths.helperCompiledContract)) {
        await removeIfExists(rootDir, paths.dataCompiledContract, removed, pruneErrors);
      }
      if (await pathExists(paths.helperCompiledExpectations)) {
        await removeIfExists(rootDir, paths.dataCompiledExpectations, removed, pruneErrors);
      }
    }
    if (pruneMirrors) {
      for (const report of categoryReports) {
        if (report.redundancy.schema_mirror_redundant) {
          await removeIfExists(rootDir, path.resolve(rootDir, report.runtime_root, 'schema.json'), removed, pruneErrors);
        }
        if (report.redundancy.required_fields_mirror_redundant) {
          await removeIfExists(
            rootDir,
            path.resolve(rootDir, report.runtime_root, 'required_fields.json'),
            removed,
            pruneErrors
          );
        }
      }
    }
  }

  return {
    generated_at: new Date().toISOString(),
    root_dir: rootDir,
    selected_categories: selectedCategories,
    category_reports: categoryReports,
    prune: {
      requested: Boolean(prune),
      prune_mirrors: Boolean(pruneMirrors),
      removed,
      errors: pruneErrors
    }
  };
}
