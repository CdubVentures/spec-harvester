export async function runLearningExportPhase({
  config,
  storage,
  category,
  productId,
  runId,
  job,
  sourceResults,
  summary,
  learningProfile,
  discoveryResult,
  runBase,
  artifactsByHost,
  adapterArtifacts,
  normalized,
  provenance,
  candidates,
  logger,
  markdownSummary,
  rowTsv,
  runtimeFieldRulesEngine,
  fieldOrder,
  runtimeEvidencePack,
  trafficLight,
  persistLearningProfile: persistLearningProfileFn,
  exportRunArtifacts: exportRunArtifactsFn,
  writeFinalOutputs: writeFinalOutputsFn,
  writeProductReviewArtifacts: writeProductReviewArtifactsFn,
  writeCategoryReviewArtifacts: writeCategoryReviewArtifactsFn
}) {
  let learning = null;
  if (config.selfImproveEnabled) {
    learning = await persistLearningProfileFn({
      storage,
      config,
      category,
      job,
      sourceResults,
      summary,
      learningProfile,
      discoveryResult,
      runBase,
      runId
    });
  }

  if (learning) {
    summary.learning = {
      profile_key: learning.profileKey,
      run_log_key: learning.learningRunKey
    };
  }

  const exportInfo = await exportRunArtifactsFn({
    storage,
    category,
    productId,
    runId,
    artifactsByHost,
    adapterArtifacts,
    normalized,
    provenance,
    candidates,
    summary,
    events: logger.events,
    markdownSummary,
    rowTsv,
    writeMarkdownSummary: config.writeMarkdownSummary
  });

  const finalExport = await writeFinalOutputsFn({
    storage,
    category,
    productId,
    runId,
    normalized,
    summary,
    provenance,
    trafficLight,
    sourceResults,
    runtimeEngine: runtimeFieldRulesEngine,
    runtimeFieldOrder: fieldOrder,
    runtimeEnforceEvidence: Boolean(config.fieldRulesEngineEnforceEvidence),
    runtimeEvidencePack: runtimeEvidencePack || null
  });
  summary.final_export = finalExport;

  try {
    const reviewProduct = await writeProductReviewArtifactsFn({
      storage,
      config,
      category,
      productId
    });
    const reviewCategory = await writeCategoryReviewArtifactsFn({
      storage,
      config,
      category,
      status: 'needs_review',
      limit: 500
    });
    summary.review_artifacts = {
      product_review_candidates_key: reviewProduct.keys.candidatesKey,
      product_review_queue_key: reviewProduct.keys.reviewQueueKey,
      category_review_queue_key: reviewCategory.key,
      candidate_count: reviewProduct.candidate_count,
      review_field_count: reviewProduct.review_field_count,
      queue_count: reviewCategory.count
    };
  } catch (error) {
    summary.review_artifacts = {
      error: error.message
    };
    logger.warn('review_artifacts_write_failed', {
      category,
      productId,
      runId,
      message: error.message
    });
  }

  return { exportInfo, finalExport, learning };
}
