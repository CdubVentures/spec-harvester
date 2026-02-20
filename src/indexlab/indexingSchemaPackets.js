import crypto from 'node:crypto';

const PHASE_IDS = [
  'phase_01_static_html',
  'phase_02_dynamic_js',
  'phase_03_main_article',
  'phase_04_html_spec_table',
  'phase_05_embedded_json',
  'phase_06_text_pdf',
  'phase_07_scanned_pdf_ocr',
  'phase_08_image_ocr',
  'phase_09_chart_graph',
  'phase_10_office_mixed_doc'
];

const IDENTITY_FIELDS = new Set(['id', 'brand', 'model', 'base_model', 'category', 'sku']);

function sha256(value = '') {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function toIso(value, fallback = '') {
  const raw = String(value || '').trim();
  const ms = Date.parse(raw);
  if (Number.isFinite(ms)) return new Date(ms).toISOString();
  if (fallback) return toIso(fallback, '');
  return new Date().toISOString();
}

function toInt(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toFloat(value, fallback = 0) {
  const n = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(value, fallback = 0) {
  const n = toFloat(value, fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function hasKnownValue(value) {
  const token = String(value ?? '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'unknown' && token !== 'n/a' && token !== 'null' && token !== 'undefined';
}

function normalizeHost(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '');
}

function rootDomainFromHost(host = '') {
  const token = normalizeHost(host);
  if (!token) return '';
  const parts = token.split('.').filter(Boolean);
  if (parts.length <= 2) return token;
  return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
}

function requiredLevelForField(fieldKey = '', categoryConfig = {}) {
  const field = String(fieldKey || '').trim();
  if (!field) return 'optional';
  if (IDENTITY_FIELDS.has(field)) return 'identity';
  const critical = categoryConfig?.criticalFieldSet instanceof Set
    ? categoryConfig.criticalFieldSet
    : new Set(Array.isArray(categoryConfig?.schema?.critical_fields) ? categoryConfig.schema.critical_fields : []);
  if (critical.has(field)) return 'critical';
  const required = new Set(Array.isArray(categoryConfig?.requiredFields) ? categoryConfig.requiredFields : []);
  if (required.has(field)) return 'required';
  return 'optional';
}

function unitForField(fieldKey = '') {
  const token = String(fieldKey || '').toLowerCase();
  if (token.endsWith('_hz') || token.includes('polling_rate')) return 'Hz';
  if (token.endsWith('_dpi')) return 'DPI';
  if (token.endsWith('_mm')) return 'mm';
  if (token.endsWith('_g')) return 'g';
  if (token.endsWith('_ms')) return 'ms';
  return null;
}

function inferValueType(value) {
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  const token = String(value ?? '').trim();
  if (token === '') return 'string';
  if (/^-?\d+(\.\d+)?$/.test(token)) return 'number';
  return 'string';
}

function tryNormalizeValue(value) {
  const type = inferValueType(value);
  if (type === 'number') {
    const n = toFloat(value, NaN);
    if (Number.isFinite(n)) return n;
  }
  if (type === 'boolean') {
    return Boolean(value);
  }
  return value;
}

function phaseFromMethod(method = '') {
  const token = String(method || '').trim().toLowerCase();
  if (!token) return 'phase_01_static_html';
  if (
    token.includes('network')
    || token.includes('json')
    || token.includes('embedded_state')
    || token.includes('ldjson')
    || token.includes('microdata')
    || token.includes('opengraph')
    || token.includes('microformat')
    || token.includes('rdfa')
    || token.includes('twitter_card')
  ) {
    return 'phase_05_embedded_json';
  }
  if (token.includes('article')) return 'phase_03_main_article';
  if (token.includes('scanned_pdf_ocr')) return 'phase_07_scanned_pdf_ocr';
  if (token.includes('pdf')) return 'phase_06_text_pdf';
  if (token.includes('table') || token.includes('spec')) return 'phase_04_html_spec_table';
  if (token.includes('ocr') || token.includes('image') || token.includes('screenshot')) return 'phase_08_image_ocr';
  if (token.includes('chart')) return 'phase_09_chart_graph';
  if (token.includes('office') || token.includes('xlsx') || token.includes('docx') || token.includes('pptx')) {
    return 'phase_10_office_mixed_doc';
  }
  if (token.includes('graphql') || token.includes('dynamic') || token.includes('playwright') || token.includes('js')) {
    return 'phase_02_dynamic_js';
  }
  return 'phase_01_static_html';
}

function sourceSurfaceFromMethod(method = '') {
  const token = String(method || '').trim().toLowerCase();
  if (!token) return 'static_dom';
  if (token.includes('network_json') || token === 'adapter_api') return 'network_json';
  if (token.includes('graphql')) return 'graphql_replay';
  if (token.includes('ldjson') || token.includes('json_ld')) return 'json_ld';
  if (token.includes('embedded_state')) return 'embedded_state';
  if (token.includes('microdata')) return 'microdata';
  if (token.includes('opengraph')) return 'opengraph';
  if (token.includes('microformat')) return 'microformat';
  if (token.includes('rdfa')) return 'rdfa';
  if (token.includes('twitter_card')) return 'twitter_card';
  if (token.includes('article')) return 'main_article';
  if (token.includes('scanned_pdf_ocr_table')) return 'scanned_pdf_ocr_table';
  if (token.includes('scanned_pdf_ocr_kv')) return 'scanned_pdf_ocr_kv';
  if (token.includes('scanned_pdf_ocr_text')) return 'scanned_pdf_ocr_text';
  if (token.includes('pdf_table')) return 'pdf_table';
  if (token.includes('pdf_kv')) return 'pdf_kv';
  if (token === 'pdf') return 'pdf_text';
  if (token.includes('html_table') || token.includes('spec_table') || token.includes('table')) return 'html_spec_table';
  if (token.includes('screenshot')) return 'screenshot_capture';
  if (token.includes('image_ocr')) return 'image_ocr_text';
  if (token.includes('chart')) return 'chart_script_config';
  if (token.includes('office_docx')) return 'office_docx';
  if (token.includes('office_xlsx')) return 'office_xlsx';
  if (token.includes('office_pptx')) return 'office_pptx';
  if (token.includes('office')) return 'office_mixed';
  if (token.includes('dynamic') || token.includes('llm')) return 'dynamic_dom';
  return 'static_dom';
}

function normalizeFetchStatus(status = 0) {
  const code = toInt(status, 0);
  if (code >= 200 && code < 300) return 'fetched';
  if (code === 403 || code === 429) return 'blocked';
  if (code > 0) return 'failed';
  return 'partial';
}

function blockedReasonForStatus(status = 0) {
  const code = toInt(status, 0);
  if (code === 403) return 'forbidden';
  if (code === 404 || code === 410) return 'not_found';
  if (code === 429) return 'rate_limited';
  if (code >= 500) return 'server_error';
  if (code > 0 && (code < 200 || code >= 300)) return `http_${code}`;
  return '';
}

function defaultPhaseLineage(phaseIds = []) {
  const out = {};
  for (const phaseId of PHASE_IDS) {
    out[phaseId] = phaseIds.includes(phaseId);
  }
  return out;
}

function emptyRunPhaseSummary() {
  return PHASE_IDS.reduce((acc, phaseId) => {
    acc[phaseId] = {
      enabled: true,
      executed_sources: 0,
      assertion_count: 0,
      evidence_count: 0,
      error_count: 0,
      duration_ms: 0
    };
    return acc;
  }, {});
}

function parseTierWeight(tier = 0) {
  if (tier === 1) return 1;
  if (tier === 2) return 0.8;
  if (tier === 3) return 0.45;
  return 0.35;
}

function makeTargetMatch(source = {}) {
  const score = clamp01(source?.identity?.score, 0);
  const passed = Boolean(source?.identity?.match);
  return {
    page_product_cluster_id: passed ? 'cluster_main_product' : 'cluster_non_target',
    target_match_score: score,
    target_match_passed: passed,
    ...(passed ? {} : { identity_reject_reason: 'identity_mismatch' })
  };
}

function makeCandidateRows(source = {}) {
  const rows = Array.isArray(source?.fieldCandidates) ? source.fieldCandidates : [];
  const out = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const fieldKey = String(row.field || row.field_key || '').trim();
    if (!fieldKey) continue;
    const value = row.value;
    if (!hasKnownValue(value)) continue;
    out.push({
      idx: index + 1,
      field_key: fieldKey,
      context_kind: String(row.context_kind || row.contextKind || 'scalar').trim() || 'scalar',
      context_ref: row.context_ref ?? null,
      value_raw: value,
      value_normalized: tryNormalizeValue(row.normalized_value ?? row.value_normalized ?? value),
      value_type: inferValueType(row.normalized_value ?? row.value_normalized ?? value),
      unit: row.unit ?? unitForField(fieldKey),
      extraction_method: String(row.method || 'dom').trim(),
      parser_confidence: clamp01(row.confidence ?? row.score ?? source?.parserHealth?.health_score, 0.7),
      confidence: clamp01(row.score ?? row.confidence ?? source?.identity?.score, 0.7),
      evidence_refs: Array.isArray(row.evidenceRefs)
        ? row.evidenceRefs.map((id) => String(id || '').trim()).filter(Boolean)
        : [],
      evidence_quote: String(row?.evidence?.quote || '').trim(),
      evidence_snippet_id: String(row?.evidence?.snippet_id || '').trim(),
      evidence_snippet_hash: String(row?.evidence?.snippet_hash || '').trim(),
      evidence_source_id: String(row?.evidence?.source_id || '').trim(),
      evidence_file_uri: String(row?.evidence?.file_uri || '').trim(),
      evidence_mime_type: String(row?.evidence?.mime_type || '').trim(),
      evidence_content_hash: String(row?.evidence?.content_hash || '').trim(),
      evidence_surface: String(row?.evidence?.surface || '').trim(),
      key_path: String(row.keyPath || row.key_path || '').trim()
    });
  }
  return out;
}

function topFieldKeysByNeedSet(needSet = {}, fallbackKeys = []) {
  const rows = Array.isArray(needSet?.needs) ? needSet.needs : [];
  const ranked = rows
    .map((row) => String(row?.field_key || '').trim())
    .filter(Boolean);
  if (ranked.length > 0) return [...new Set(ranked)].slice(0, 24);
  return [...new Set((fallbackKeys || []).map((row) => String(row || '').trim()).filter(Boolean))].slice(0, 24);
}

function buildSourcePacket({
  source,
  runId,
  category,
  productId,
  categoryConfig,
  nowIso
}) {
  const canonicalUrl = String(source?.finalUrl || source?.url || '').trim();
  if (!canonicalUrl) return null;

  const sourceHost = normalizeHost(source?.host || '');
  const sourceRoot = normalizeHost(source?.rootDomain || rootDomainFromHost(sourceHost));
  const sourceId = String(source?.sourceId || '').trim()
    || `src_${sha256(`${sourceRoot}|${canonicalUrl}`).slice(0, 12)}`;
  const contentHashRaw = sha256([
    canonicalUrl,
    String(source?.title || ''),
    String(source?.status || ''),
    String(source?.ts || '')
  ].join('|'));
  const contentHash = `sha256:${contentHashRaw}`;
  const sourcePacketId = `sha256:${sha256(canonicalUrl)}`;
  const sourceVersionId = `sha256:${sha256(`${canonicalUrl}|${contentHashRaw}`)}`;
  const targetMatch = makeTargetMatch(source);

  const candidateRows = makeCandidateRows(source);
  if (candidateRows.length === 0) {
    return null;
  }

  const phaseSet = new Set(candidateRows.map((row) => phaseFromMethod(row.extraction_method)));
  if (phaseSet.size === 0) phaseSet.add('phase_01_static_html');
  const phaseLineage = defaultPhaseLineage([...phaseSet]);
  const phaseStats = {};
  for (const phaseId of [...phaseSet]) {
    const rowsForPhase = candidateRows.filter((row) => phaseFromMethod(row.extraction_method) === phaseId);
    phaseStats[phaseId] = {
      executed: rowsForPhase.length > 0,
      duration_ms: 0,
      assertion_count: rowsForPhase.length,
      evidence_count: rowsForPhase.length
    };
  }

  const sourceArtifactRefs = source?.artifact_refs && typeof source.artifact_refs === 'object'
    ? source.artifact_refs
    : {};
  const htmlArtifactId = `art_${sha256(`${sourceVersionId}|html`).slice(0, 12)}`;
  const domArtifactId = String(sourceArtifactRefs?.dom_snippet_uri || '').trim()
    ? `art_${sha256(`${sourceVersionId}|dom_snippet`).slice(0, 12)}`
    : '';
  const screenshotArtifactId = String(sourceArtifactRefs?.screenshot_uri || '').trim()
    ? `art_${sha256(`${sourceVersionId}|screenshot`).slice(0, 12)}`
    : '';
  const artifactIndex = {
    [htmlArtifactId]: {
      artifact_id: htmlArtifactId,
      phase_id: [...phaseSet][0] || 'phase_01_static_html',
      artifact_kind: 'html',
      content_hash: contentHash,
      mime_type: 'text/html',
      captured_at: toIso(source?.ts, nowIso),
      local_path: String(sourceArtifactRefs?.html_uri || canonicalUrl).trim() || canonicalUrl
    }
  };
  if (domArtifactId) {
    artifactIndex[domArtifactId] = {
      artifact_id: domArtifactId,
      phase_id: 'phase_01_static_html',
      artifact_kind: 'dom_snapshot',
      content_hash: String(sourceArtifactRefs?.dom_snippet_content_hash || '').trim() || contentHash,
      mime_type: 'text/html',
      captured_at: toIso(source?.ts, nowIso),
      local_path: String(sourceArtifactRefs?.dom_snippet_uri || '').trim()
    };
  }
  if (screenshotArtifactId) {
    artifactIndex[screenshotArtifactId] = {
      artifact_id: screenshotArtifactId,
      phase_id: 'phase_08_image_ocr',
      artifact_kind: 'screenshot',
      content_hash: String(sourceArtifactRefs?.screenshot_content_hash || '').trim() || contentHash,
      mime_type: String(sourceArtifactRefs?.screenshot_mime_type || 'image/jpeg').trim(),
      captured_at: toIso(source?.ts, nowIso),
      local_path: String(sourceArtifactRefs?.screenshot_uri || '').trim()
    };
  }

  const evidenceIndex = {};
  const fieldGroups = new Map();
  const sourceAssertionRows = [];
  const sourceEvidenceRows = [];
  const assertionRefs = [];

  for (const row of candidateRows) {
    const fieldKey = row.field_key;
    if (!fieldGroups.has(fieldKey)) fieldGroups.set(fieldKey, []);

    const evidenceSeed = row.evidence_refs[0]
      || row.evidence_snippet_id
      || `${fieldKey}|${row.idx}|${String(row.value_raw || '')}`;
    const evidenceId = `e_${sha256(`${sourceVersionId}|${evidenceSeed}`).slice(0, 14)}`;
    const snippetId = row.evidence_snippet_id || `snip_${sha256(`${evidenceId}|snippet`).slice(0, 10)}`;
    const snippetText = row.evidence_quote || String(row.value_raw ?? '');
    const snippetHash = row.evidence_snippet_hash || `sha256:${sha256(snippetText)}`;
    let evidenceArtifactId = htmlArtifactId;
    const evidenceFileUri = String(row.evidence_file_uri || '').trim();
    const screenshotUri = String(sourceArtifactRefs?.screenshot_uri || '').trim();
    const screenshotFileUri = String(sourceArtifactRefs?.screenshot_file_uri || '').trim();
    const domSnippetUri = String(sourceArtifactRefs?.dom_snippet_uri || '').trim();
    const evidenceSurface = String(row.evidence_surface || '').trim().toLowerCase();
    if (
      screenshotArtifactId &&
      (
        evidenceFileUri === screenshotUri
        || evidenceFileUri === screenshotFileUri
        || evidenceSurface.includes('screenshot')
      )
    ) {
      evidenceArtifactId = screenshotArtifactId;
    } else if (domArtifactId && (evidenceFileUri === domSnippetUri || evidenceSurface.includes('dom'))) {
      evidenceArtifactId = domArtifactId;
    }
    evidenceIndex[evidenceId] = {
      evidence_id: evidenceId,
      source_id: sourceId,
      source_url: canonicalUrl,
      source_host: sourceHost,
      source_root_domain: sourceRoot,
      phase_id: phaseFromMethod(row.extraction_method),
      source_surface: sourceSurfaceFromMethod(row.extraction_method),
      target_match: targetMatch,
      artifact_id: evidenceArtifactId,
      snippet_id: snippetId,
      snippet_hash: snippetHash,
      quote: snippetText,
      snippet_text: snippetText,
      key_path: row.key_path || undefined,
      method: row.extraction_method,
      tier: toInt(source?.tier, 0),
      retrieved_at: toIso(source?.ts, nowIso),
      surface_meta: {
        file_uri: evidenceFileUri || undefined,
        mime_type: String(row.evidence_mime_type || '').trim() || undefined,
        content_hash: String(row.evidence_content_hash || '').trim() || undefined,
        surface: evidenceSurface || undefined
      }
    };

    const parserScore = clamp01(row.parser_confidence, 0.7);
    const assertionId = String(row?.candidate_id || '').trim()
      || `cand_${sha256(`${sourceVersionId}|${fieldKey}|${row.idx}|${String(row.value_raw || '')}`).slice(0, 18)}`;
    const ambiguityScore = targetMatch.target_match_passed ? 0.08 : 0.82;
    const ambiguityLevel = targetMatch.target_match_passed ? 'low' : 'high';
    const assertion = {
      assertion_id: assertionId,
      candidate_id: assertionId,
      source_id: sourceId,
      field_key: fieldKey,
      context_kind: row.context_kind || 'scalar',
      context_ref: row.context_ref ?? null,
      value_raw: row.value_raw,
      value_normalized: row.value_normalized,
      value_type: row.value_type,
      unit: row.unit ?? null,
      extraction_method: row.extraction_method,
      parser_phase: phaseFromMethod(row.extraction_method),
      parser_confidence: parserScore,
      confidence: clamp01(row.confidence, parserScore),
      target_match: targetMatch,
      ambiguity: {
        level: ambiguityLevel,
        score: ambiguityScore
      },
      parse_score_by_key: {
        field_key: fieldKey,
        score: parserScore,
        score_factors: {
          parser_confidence: parserScore,
          evidence_density: 1,
          unit_match: row.unit ? 1 : 0.7,
          identity_match: targetMatch.target_match_score,
          tier_weight: parseTierWeight(toInt(source?.tier, 0))
        },
        suggested_start_rank: row.idx
      },
      evidence_ref_ids: [evidenceId],
      created_at: toIso(source?.ts, nowIso)
    };
    fieldGroups.get(fieldKey).push(assertion);
    assertionRefs.push({
      field_key: fieldKey,
      source_id: sourceId,
      source_packet_id: sourcePacketId,
      source_version_id: sourceVersionId,
      canonical_url: canonicalUrl,
      source_tier: toInt(source?.tier, 0),
      assertion_id: assertionId,
      evidence_id: evidenceId,
      parser_score: parserScore,
      target_match_score: targetMatch.target_match_score,
      ambiguity_level: ambiguityLevel,
      ambiguity_score: ambiguityScore,
      value_normalized: row.value_normalized,
      value_raw: row.value_raw,
      unit: row.unit ?? null
    });

    sourceAssertionRows.push({
      assertion_id: assertionId,
      source_id: sourceId,
      field_key: fieldKey,
      context_kind: row.context_kind || 'scalar',
      context_ref: row.context_ref ?? null,
      value_raw: row.value_raw,
      value_normalized: row.value_normalized,
      unit: row.unit ?? null,
      candidate_id: assertionId,
      extraction_method: row.extraction_method
    });
    sourceEvidenceRows.push({
      assertion_id: assertionId,
      evidence_url: canonicalUrl,
      snippet_id: snippetId,
      quote: snippetText,
      method: row.extraction_method,
      tier: toInt(source?.tier, 0),
      retrieved_at: toIso(source?.ts, nowIso)
    });
  }

  const fieldKeyMap = {};
  for (const [fieldKey, assertions] of fieldGroups.entries()) {
    const contextId = `ctx_${sha256(`${sourceVersionId}|${fieldKey}|scalar`).slice(0, 12)}`;
    const fieldInstanceId = `fi_${sha256(`${sourceVersionId}|grid_key|${fieldKey}|scalar`).slice(0, 16)}`;
    const ambiguityScore = assertions.length > 1 ? 0.35 : (targetMatch.target_match_passed ? 0.08 : 0.82);
    const ambiguityLevel = ambiguityScore >= 0.75 ? 'high' : ambiguityScore >= 0.35 ? 'medium' : 'low';
    fieldKeyMap[fieldKey] = {
      field_key: fieldKey,
      field_key_id: `sha256:${sha256(`${sourceVersionId}|${fieldKey}`)}`,
      field_meta: {
        field_key: fieldKey,
        contract_type: 'spec_field',
        shape: 'scalar',
        required_level: requiredLevelForField(fieldKey, categoryConfig),
        is_identity: IDENTITY_FIELDS.has(fieldKey),
        unit_expected: unitForField(fieldKey),
        component_type: null,
        enum_source: null
      },
      contexts: [
        {
          field_instance_id: fieldInstanceId,
          context_id: contextId,
          context_kind: 'scalar',
          context_ref: null,
          ambiguity: {
            level: ambiguityLevel,
            score: ambiguityScore
          },
          assertions
        }
      ],
      field_metrics: {
        assertion_count: assertions.length,
        distinct_evidence_count: assertions.length,
        distinct_surface_count: 1,
        distinct_source_count: 1,
        ambiguity_level: ambiguityLevel,
        ambiguity_score: ambiguityScore,
        has_conflict: assertions.length > 1
      }
    };
  }

  const fieldKeys = Object.keys(fieldKeyMap);
  const requiredFields = new Set(Array.isArray(categoryConfig?.requiredFields) ? categoryConfig.requiredFields : []);
  const criticalFields = categoryConfig?.criticalFieldSet instanceof Set
    ? categoryConfig.criticalFieldSet
    : new Set(Array.isArray(categoryConfig?.schema?.critical_fields) ? categoryConfig.schema.critical_fields : []);
  const requiredKnown = [...requiredFields].filter((field) => fieldKeys.includes(field)).length;
  const requiredTotal = requiredFields.size;
  const criticalKnown = [...criticalFields].filter((field) => fieldKeys.includes(field)).length;
  const criticalTotal = criticalFields.size;
  const fetchedAt = toIso(source?.ts, nowIso);
  const visualEvidence = screenshotArtifactId
    ? {
      store_original_images: true,
      llm_derivative_policy: {
        send_original_to_llm: false,
        preferred_variant: 'review_sm',
        max_bytes_per_image: 700000,
        review_lg: { enabled: true, max_side_px: 1600, format: 'jpeg', quality: 72 },
        review_sm: { enabled: true, max_side_px: 960, format: 'jpeg', quality: 58 },
        region_crop: { enabled: true, max_side_px: 720, format: 'jpeg', quality: 65 }
      },
      image_assets: {
        [`img_${sha256(`${sourceVersionId}|${screenshotArtifactId}`).slice(0, 12)}`]: {
          image_asset_id: `img_${sha256(`${sourceVersionId}|${screenshotArtifactId}`).slice(0, 12)}`,
          asset_kind: 'page_screenshot',
          source_surface: 'screenshot_capture',
          candidate_source_type: 'dom_img',
          content_hash: String(sourceArtifactRefs?.screenshot_content_hash || '').trim() || contentHash,
          mime_type: String(sourceArtifactRefs?.screenshot_mime_type || 'image/jpeg').trim(),
          width: Math.max(1, toInt(sourceArtifactRefs?.screenshot_width, 1)),
          height: Math.max(1, toInt(sourceArtifactRefs?.screenshot_height, 1)),
          size_bytes: Math.max(0, toInt(sourceArtifactRefs?.screenshot_size_bytes, 0)),
          storage_uri: String(sourceArtifactRefs?.screenshot_uri || '').trim(),
          captured_at: fetchedAt,
          target_match: targetMatch,
          quality_gate: {
            quality_score: 0.7,
            quality_gate_passed: true
          }
        }
      }
    }
    : null;

  const packet = {
    schema_version: '2026-02-20.source-indexing-extraction-packet.v1',
    record_kind: 'source_indexing_extraction_packet',
    source_packet_id: sourcePacketId,
    source_id: sourceId,
    source_key: canonicalUrl,
    canonical_url: canonicalUrl,
    source_version_id: sourceVersionId,
    content_hash: contentHash,
    run_meta: {
      run_id: runId,
      category,
      item_identifier: productId,
      product_id: productId,
      started_at: fetchedAt,
      finished_at: fetchedAt,
      fetch_status: normalizeFetchStatus(source?.status),
      http_status: toInt(source?.status, 0),
      content_type: 'text/html',
      fetch_ms: 0
    },
    source_metadata: {
      source_url: canonicalUrl,
      source_host: sourceHost,
      source_root_domain: sourceRoot,
      source_tier: toInt(source?.tier, 0),
      source_method: source?.approvedDomain ? 'approved_source' : 'candidate_source',
      doc_kind: 'html',
      host_authority_disabled: true
    },
    parser_execution: {
      supported_source_kinds: [...phaseSet],
      phase_lineage: phaseLineage,
      phase_stats: phaseStats
    },
    identity_target: {
      category,
      brand: String(source?.identityCandidates?.brand || '').trim(),
      model: String(source?.identityCandidates?.model || '').trim(),
      variant: String(source?.identityCandidates?.variant || '').trim(),
      sku: String(source?.identityCandidates?.sku || '').trim()
    },
    artifact_index: artifactIndex,
    evidence_index: evidenceIndex,
    field_key_map: fieldKeyMap,
    quality: {
      wrong_model: !targetMatch.target_match_passed,
      junk: toInt(source?.status, 0) >= 400,
      blocked_reason: blockedReasonForStatus(source?.status)
    },
    coverage_summary: {
      field_count: fieldKeys.length,
      fields: fieldKeys,
      required_coverage: `${requiredKnown}/${requiredTotal}`,
      critical_coverage: `${criticalKnown}/${criticalTotal}`,
      is_jackpot_candidate: fieldKeys.length > 0 && targetMatch.target_match_passed
    },
    indexing_projection: {
      retrieval_ready: Object.keys(evidenceIndex).length > 0,
      chunk_strategy: 'hybrid',
      chunk_count: Object.keys(evidenceIndex).length,
      embedding_ready_evidence_ids: Object.keys(evidenceIndex),
      retrieval_priority_field_keys: fieldKeys.slice(0, 24),
      token_estimate_total: Math.max(1, Object.keys(evidenceIndex).length) * 80
    },
    sql_projection: {
      source_registry_row: {
        source_id: sourceId,
        category,
        item_identifier: productId,
        product_id: productId,
        run_id: runId,
        source_url: canonicalUrl,
        source_host: sourceHost || null,
        source_root_domain: sourceRoot || null,
        source_tier: toInt(source?.tier, 0),
        source_method: source?.approvedDomain ? 'approved_source' : 'candidate_source',
        crawl_status: normalizeFetchStatus(source?.status),
        http_status: toInt(source?.status, 0),
        fetched_at: fetchedAt
      },
      source_artifact_rows: [
        ...Object.values(artifactIndex).map((artifact) => ({
          source_id: sourceId,
          artifact_type: String(artifact?.artifact_kind || 'html'),
          local_path: String(artifact?.local_path || canonicalUrl),
          content_hash: String(artifact?.content_hash || contentHash),
          mime_type: String(artifact?.mime_type || 'text/html'),
          size_bytes: Number.isFinite(Number(artifact?.size_bytes))
            ? Number(artifact.size_bytes)
            : null,
          captured_at: String(artifact?.captured_at || fetchedAt)
        }))
      ],
      source_assertion_rows: sourceAssertionRows,
      source_evidence_rows: sourceEvidenceRows
    },
    ...(visualEvidence ? { visual_evidence: visualEvidence } : {}),
    packet_invariants: {
      one_packet_per_canonical_url: true,
      source_host_non_authority: true,
      extraction_first_packet: true,
      downstream_binding_optional: true
    }
  };

  return {
    packet,
    assertionRefs
  };
}

function buildFallbackSourcePacket({
  runId,
  category,
  productId,
  nowIso,
  normalized,
  categoryConfig
}) {
  const fallbackUrl = `https://fallback.local/${encodeURIComponent(productId)}`;
  const source = {
    url: fallbackUrl,
    finalUrl: fallbackUrl,
    host: 'fallback.local',
    rootDomain: 'fallback.local',
    tier: 3,
    approvedDomain: false,
    status: 0,
    ts: nowIso,
    identity: { match: true, score: 1 },
    identityCandidates: {
      brand: String(normalized?.identity?.brand || '').trim(),
      model: String(normalized?.identity?.model || '').trim(),
      variant: String(normalized?.identity?.variant || '').trim(),
      sku: String(normalized?.identity?.sku || '').trim()
    },
    fieldCandidates: [
      {
        field: 'model',
        value: String(normalized?.identity?.model || normalized?.fields?.model || productId).trim(),
        method: 'dom',
        confidence: 1
      }
    ]
  };
  return buildSourcePacket({
    source,
    runId,
    category,
    productId,
    categoryConfig,
    nowIso
  });
}

function buildItemPacket({
  runId,
  category,
  productId,
  sourcePackets = [],
  sourceAssertionRefs = [],
  categoryConfig = {},
  normalized = {},
  provenance = {},
  needSet = {},
  nowIso
}) {
  const itemPacketId = `sha256:${sha256(`${category}|${productId}`)}`;
  const sourcePacketRefs = sourcePackets.map((packet) => ({
    source_packet_id: packet.source_packet_id,
    source_id: packet.source_id,
    canonical_url: packet.canonical_url,
    source_version_id: packet.source_version_id,
    content_hash: packet.content_hash,
    source_tier: packet?.source_metadata?.source_tier ?? null,
    doc_kind: packet?.source_metadata?.doc_kind ?? null,
    run_id: packet?.run_meta?.run_id || runId
  }));

  const byField = new Map();
  for (const row of sourceAssertionRefs) {
    const fieldKey = String(row?.field_key || '').trim();
    if (!fieldKey) continue;
    if (!byField.has(fieldKey)) byField.set(fieldKey, []);
    byField.get(fieldKey).push(row);
  }

  const fieldSourceIndex = {};
  const fieldKeyMap = {};
  const candidateRows = [];
  const stateRows = [];
  const reviewRows = [];
  let syntheticIdCounter = 1;

  for (const [fieldKey, refs] of byField.entries()) {
    const sortedRefs = [...refs].sort((a, b) => (b.parser_score || 0) - (a.parser_score || 0));
    const itemCandidates = sortedRefs.map((row) => {
      const itemCandidateId = `item_cand_${sha256(`${itemPacketId}|${row.assertion_id}`).slice(0, 16)}`;
      candidateRows.push({
        candidate_id: row.assertion_id || `cand_${syntheticIdCounter++}`,
        category,
        product_id: productId,
        field_key: fieldKey,
        value: row.value_raw,
        normalized_value: row.value_normalized,
        score: clamp01(row.parser_score, 0.7),
        rank: null,
        source_url: row.canonical_url || null,
        source_host: row.source_id ? String(row.source_id).replace(/_/g, '.') : null,
        source_root_domain: row.source_id ? String(row.source_id).replace(/_/g, '.') : null,
        source_tier: row.source_tier ?? null,
        source_method: null,
        snippet_id: row.evidence_id || null,
        snippet_hash: null,
        snippet_text: null,
        quote: null,
        evidence_url: row.canonical_url || null,
        evidence_retrieved_at: nowIso,
        is_component_field: false,
        component_type: null,
        is_list_field: false,
        run_id: runId
      });
      return {
        item_candidate_id: itemCandidateId,
        source_packet_id: row.source_packet_id,
        source_version_id: row.source_version_id,
        source_id: row.source_id,
        assertion_id: row.assertion_id,
        candidate_id: row.assertion_id,
        field_key: fieldKey,
        context_kind: 'scalar',
        value_raw: row.value_raw,
        value_normalized: row.value_normalized,
        unit: row.unit ?? null,
        confidence: clamp01(row.parser_score, 0.7),
        parser_score: clamp01(row.parser_score, 0.7),
        target_match: {
          page_product_cluster_id: 'cluster_main_product',
          target_match_score: clamp01(row.target_match_score, 0.9),
          target_match_passed: clamp01(row.target_match_score, 0.9) >= 0.5
        },
        suggested_start_rank: null,
        ambiguity: {
          level: row.ambiguity_level || 'low',
          score: clamp01(row.ambiguity_score, 0.08)
        },
        evidence_refs: [
          {
            source_packet_id: row.source_packet_id,
            evidence_id: row.evidence_id
          }
        ]
      };
    });

    if (itemCandidates.length === 0) {
      continue;
    }

    const selected = itemCandidates[0];
    const distinctSourceCount = new Set(itemCandidates.map((row) => row.source_id).filter(Boolean)).size;
    const maxAmbiguity = Math.max(...itemCandidates.map((row) => clamp01(row?.ambiguity?.score, 0.08)));
    const ambiguityLevel = maxAmbiguity >= 0.75 ? 'high' : maxAmbiguity >= 0.35 ? 'medium' : 'low';

    fieldKeyMap[fieldKey] = {
      field_key: fieldKey,
      field_key_id: `sha256:${sha256(`${itemPacketId}|${fieldKey}`)}`,
      field_meta: {
        field_key: fieldKey,
        shape: 'scalar',
        required_level: requiredLevelForField(fieldKey, categoryConfig),
        unit_expected: unitForField(fieldKey),
        component_type: null,
        enum_source: null
      },
      contexts: [
        {
          field_instance_id: `fi_${sha256(`${itemPacketId}|grid_key|${fieldKey}`).slice(0, 16)}`,
          context_kind: 'scalar',
          context_ref: null,
          target_kind: 'grid_key',
          selected_candidate_id: selected.item_candidate_id,
          candidates: itemCandidates
        }
      ],
      field_metrics: {
        candidate_count: itemCandidates.length,
        distinct_source_count: distinctSourceCount,
        ambiguity_level: ambiguityLevel,
        ambiguity_score: maxAmbiguity,
        has_conflict: itemCandidates.length > 1
      }
    };

    const bySource = new Map();
    for (const candidate of itemCandidates) {
      const key = `${candidate.source_packet_id}|${candidate.source_id}`;
      if (!bySource.has(key)) {
        bySource.set(key, {
          source_packet_id: candidate.source_packet_id,
          source_version_id: candidate.source_version_id,
          source_id: candidate.source_id,
          canonical_url: sourcePacketRefs.find((row) => row.source_packet_id === candidate.source_packet_id)?.canonical_url || '',
          source_tier: sourcePacketRefs.find((row) => row.source_packet_id === candidate.source_packet_id)?.source_tier ?? null,
          assertion_ids: [],
          evidence_ids: [],
          best_parser_score: null,
          best_target_match_score: 0,
          ambiguity_level: 'low',
          ambiguity_score: 0.08
        });
      }
      const entry = bySource.get(key);
      entry.assertion_ids.push(candidate.assertion_id);
      for (const ref of candidate.evidence_refs || []) {
        entry.evidence_ids.push(ref.evidence_id);
      }
      const parser = clamp01(candidate.parser_score, 0.7);
      entry.best_parser_score = entry.best_parser_score === null ? parser : Math.max(entry.best_parser_score, parser);
      entry.best_target_match_score = Math.max(entry.best_target_match_score, clamp01(candidate?.target_match?.target_match_score, 0));
      const ambScore = clamp01(candidate?.ambiguity?.score, 0.08);
      if (ambScore > entry.ambiguity_score) {
        entry.ambiguity_score = ambScore;
        entry.ambiguity_level = ambScore >= 0.75 ? 'high' : ambScore >= 0.35 ? 'medium' : 'low';
      }
    }

    fieldSourceIndex[fieldKey] = {
      field_key: fieldKey,
      sources: [...bySource.values()].map((row) => ({
        ...row,
        assertion_ids: [...new Set(row.assertion_ids)],
        evidence_ids: [...new Set(row.evidence_ids)]
      })),
      source_count: bySource.size,
      best_parser_score: Math.max(...itemCandidates.map((row) => clamp01(row.parser_score, 0.7)))
    };

    const normalizedValue = normalized?.fields?.[fieldKey];
    const selectedValue = hasKnownValue(normalizedValue) ? normalizedValue : selected.value_normalized;
    const confidence = clamp01(provenance?.[fieldKey]?.confidence, clamp01(selected?.parser_score, 0.7));
    const candidateId = selected.candidate_id || selected.assertion_id;
    stateRows.push({
      id: null,
      category,
      product_id: productId,
      field_key: fieldKey,
      value: selectedValue,
      confidence,
      source: 'pipeline',
      accepted_candidate_id: candidateId,
      overridden: false,
      needs_ai_review: true,
      ai_review_complete: false
    });
    reviewRows.push({
      id: null,
      category,
      target_kind: 'grid_key',
      item_identifier: productId,
      field_key: fieldKey,
      enum_value_norm: null,
      component_identifier: null,
      property_key: null,
      item_field_state_id: null,
      component_value_id: null,
      list_value_id: null,
      enum_list_id: null,
      selected_value: selectedValue,
      selected_candidate_id: candidateId,
      confidence_score: confidence,
      ai_confirm_primary_status: null,
      ai_confirm_primary_confidence: null,
      ai_confirm_shared_status: null,
      ai_confirm_shared_confidence: null,
      user_accept_primary_status: null,
      user_accept_shared_status: null,
      user_override_ai_primary: false,
      user_override_ai_shared: false
    });
  }

  if (candidateRows.length === 0) {
    const fallbackField = 'model';
    const fallbackValue = String(normalized?.identity?.model || normalized?.fields?.model || productId).trim();
    const fallbackSource = sourcePacketRefs[0];
    const fallbackCandidateId = `cand_${sha256(`${itemPacketId}|fallback|${fallbackField}`).slice(0, 16)}`;
    candidateRows.push({
      candidate_id: fallbackCandidateId,
      category,
      product_id: productId,
      field_key: fallbackField,
      value: fallbackValue,
      normalized_value: fallbackValue,
      score: 1,
      rank: 1,
      source_url: fallbackSource?.canonical_url || null,
      source_host: null,
      source_root_domain: null,
      source_tier: fallbackSource?.source_tier ?? null,
      source_method: 'fallback',
      snippet_id: null,
      snippet_hash: null,
      snippet_text: null,
      quote: null,
      evidence_url: fallbackSource?.canonical_url || null,
      evidence_retrieved_at: nowIso,
      is_component_field: false,
      component_type: null,
      is_list_field: false,
      run_id: runId
    });
    stateRows.push({
      id: null,
      category,
      product_id: productId,
      field_key: fallbackField,
      value: fallbackValue,
      confidence: 1,
      source: 'pipeline',
      accepted_candidate_id: fallbackCandidateId,
      overridden: false,
      needs_ai_review: true,
      ai_review_complete: false
    });
    reviewRows.push({
      id: null,
      category,
      target_kind: 'grid_key',
      item_identifier: productId,
      field_key: fallbackField,
      enum_value_norm: null,
      component_identifier: null,
      property_key: null,
      item_field_state_id: null,
      component_value_id: null,
      list_value_id: null,
      enum_list_id: null,
      selected_value: fallbackValue,
      selected_candidate_id: fallbackCandidateId,
      confidence_score: 1,
      ai_confirm_primary_status: null,
      ai_confirm_primary_confidence: null,
      ai_confirm_shared_status: null,
      ai_confirm_shared_confidence: null,
      user_accept_primary_status: null,
      user_accept_shared_status: null,
      user_override_ai_primary: false,
      user_override_ai_shared: false
    });
  }

  const knownFieldCount = Object.values(normalized?.fields || {}).filter((value) => hasKnownValue(value)).length;
  const totalFieldCount = Array.isArray(categoryConfig?.fieldOrder) && categoryConfig.fieldOrder.length > 0
    ? categoryConfig.fieldOrder.length
    : Object.keys(normalized?.fields || {}).length;
  const required = new Set(Array.isArray(categoryConfig?.requiredFields) ? categoryConfig.requiredFields : []);
  const critical = categoryConfig?.criticalFieldSet instanceof Set
    ? categoryConfig.criticalFieldSet
    : new Set(Array.isArray(categoryConfig?.schema?.critical_fields) ? categoryConfig.schema.critical_fields : []);
  const requiredKnown = [...required].filter((field) => hasKnownValue(normalized?.fields?.[field])).length;
  const criticalKnown = [...critical].filter((field) => hasKnownValue(normalized?.fields?.[field])).length;
  const priorityFieldKeys = topFieldKeysByNeedSet(needSet, Object.keys(fieldKeyMap));

  return {
    schema_version: '2026-02-20.item-indexing-extraction-packet.v1',
    record_kind: 'item_indexing_extraction_packet',
    item_packet_id: itemPacketId,
    category,
    item_identifier: productId,
    product_id: productId,
    generated_at: nowIso,
    run_scope: {
      current_run_id: runId,
      included_run_ids: [runId]
    },
    item_identity: {
      brand: String(normalized?.identity?.brand || '').trim() || null,
      model: String(normalized?.identity?.model || '').trim() || null,
      variant: String(normalized?.identity?.variant || '').trim() || null,
      sku: String(normalized?.identity?.sku || '').trim() || null
    },
    source_packet_refs: sourcePacketRefs,
    field_source_index: fieldSourceIndex,
    field_key_map: fieldKeyMap,
    coverage_summary: {
      field_count: totalFieldCount,
      known_field_count: knownFieldCount,
      required_coverage: `${requiredKnown}/${required.size}`,
      critical_coverage: `${criticalKnown}/${critical.size}`
    },
    indexing_projection: {
      retrieval_ready: candidateRows.length > 0,
      candidate_chunk_count: candidateRows.length,
      priority_field_keys: priorityFieldKeys,
      token_estimate_total: candidateRows.length * 60
    },
    sql_projection: {
      item_field_state_rows: stateRows,
      candidate_rows: candidateRows,
      key_review_state_rows: reviewRows
    }
  };
}

function buildRunMetaPacket({
  runId,
  category,
  startedAt,
  finishedAt,
  durationMs,
  sourcePackets = [],
  itemPacket,
  summary = {},
  phase08Extraction = {}
}) {
  const phaseSummary = emptyRunPhaseSummary();
  let assertionTotal = 0;
  let evidenceTotal = 0;
  let targetRejectedEvidence = 0;
  let sourceFetched = 0;
  let sourceFailed = 0;

  for (const packet of sourcePackets) {
    const fetchStatus = String(packet?.run_meta?.fetch_status || '').trim();
    if (fetchStatus === 'fetched') sourceFetched += 1;
    else sourceFailed += 1;

    const evidenceRows = Object.values(packet?.evidence_index || {});
    const assertions = [];
    for (const bundle of Object.values(packet?.field_key_map || {})) {
      const contexts = Array.isArray(bundle?.contexts) ? bundle.contexts : [];
      for (const context of contexts) {
        const rows = Array.isArray(context?.assertions) ? context.assertions : [];
        assertions.push(...rows);
      }
    }
    assertionTotal += assertions.length;
    evidenceTotal += evidenceRows.length;
    targetRejectedEvidence += evidenceRows.filter((row) => row?.target_match?.target_match_passed === false).length;

    const stats = packet?.parser_execution?.phase_stats && typeof packet.parser_execution.phase_stats === 'object'
      ? packet.parser_execution.phase_stats
      : {};
    for (const phaseId of PHASE_IDS) {
      const row = stats[phaseId];
      if (!row) continue;
      phaseSummary[phaseId].executed_sources += row.executed ? 1 : 0;
      phaseSummary[phaseId].assertion_count += toInt(row.assertion_count, 0);
      phaseSummary[phaseId].evidence_count += toInt(row.evidence_count, 0);
      phaseSummary[phaseId].error_count += toInt(row.error_count, 0);
      phaseSummary[phaseId].duration_ms += toInt(row.duration_ms, 0);
    }
  }

  const sourceTotal = sourcePackets.length;
  const coverageRatio = clamp01(summary?.completeness_required ?? summary?.coverage_overall, 0);
  const errorRatio = sourceTotal > 0 ? sourceFailed / sourceTotal : 0;
  const targetMatchPassRatio = evidenceTotal > 0 ? (evidenceTotal - targetRejectedEvidence) / evidenceTotal : 1;

  return {
    schema_version: '2026-02-20.run-meta-packet.v1',
    record_kind: 'run_meta_packet',
    run_packet_id: `sha256:${sha256(`${runId}|${category}`)}`,
    run_id: runId,
    category,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: Math.max(0, toInt(durationMs, 0)),
    trigger: 'manual',
    execution_summary: {
      item_total: 1,
      item_succeeded: summary?.validated ? 1 : 0,
      item_partial: summary?.validated ? 0 : 1,
      item_failed: 0,
      source_total: sourceTotal,
      source_fetched: sourceFetched,
      source_failed: sourceFailed,
      assertion_total: assertionTotal,
      evidence_total: evidenceTotal,
      identity_rejected_evidence_total: targetRejectedEvidence
    },
    phase_summary: phaseSummary,
    output_refs: {
      source_packet_refs: sourcePackets.map((packet) => ({
        source_packet_id: packet.source_packet_id,
        source_version_id: packet.source_version_id,
        source_id: packet.source_id
      })),
      item_packet_refs: [
        {
          item_packet_id: itemPacket.item_packet_id,
          item_identifier: itemPacket.item_identifier
        }
      ],
      manifest_paths: [],
      visual_manifest_paths: []
    },
    quality_gates: {
      coverage_gate_passed: coverageRatio >= 0.5,
      evidence_gate_passed: evidenceTotal > 0,
      error_rate_gate_passed: errorRatio <= 0.5,
      target_match_gate_passed: targetMatchPassRatio >= 0.5,
      target_match_pass_ratio: Number(targetMatchPassRatio.toFixed(6)),
      coverage_ratio: Number(coverageRatio.toFixed(6)),
      error_ratio: Number(errorRatio.toFixed(6))
    },
    pipeline_config: {
      phase08_batch_count: toInt(phase08Extraction?.summary?.batch_count, 0)
    }
  };
}

export function buildIndexingSchemaPackets({
  runId = '',
  category = '',
  productId = '',
  startMs = 0,
  summary = {},
  categoryConfig = {},
  sourceResults = [],
  normalized = {},
  provenance = {},
  needSet = {},
  phase08Extraction = {}
} = {}) {
  const nowIso = toIso(summary?.generated_at || new Date().toISOString());
  const startedAt = Number.isFinite(Number(startMs)) && Number(startMs) > 0
    ? new Date(Number(startMs)).toISOString()
    : nowIso;
  const durationMs = Math.max(0, toInt(summary?.duration_ms, 0));
  const finishedAt = durationMs > 0
    ? new Date(Date.parse(startedAt) + durationMs).toISOString()
    : nowIso;

  const sourcePackets = [];
  const sourceAssertionRefs = [];
  for (const source of Array.isArray(sourceResults) ? sourceResults : []) {
    const built = buildSourcePacket({
      source,
      runId,
      category,
      productId,
      categoryConfig,
      nowIso
    });
    if (!built?.packet) continue;
    sourcePackets.push(built.packet);
    sourceAssertionRefs.push(...(built.assertionRefs || []));
  }

  if (sourcePackets.length === 0) {
    const fallback = buildFallbackSourcePacket({
      runId,
      category,
      productId,
      nowIso,
      normalized,
      categoryConfig
    });
    if (fallback?.packet) {
      sourcePackets.push(fallback.packet);
      sourceAssertionRefs.push(...(fallback.assertionRefs || []));
    }
  }

  const itemPacket = buildItemPacket({
    runId,
    category,
    productId,
    sourcePackets,
    sourceAssertionRefs,
    categoryConfig,
    normalized,
    provenance,
    needSet,
    nowIso
  });

  const runMetaPacket = buildRunMetaPacket({
    runId,
    category,
    startedAt,
    finishedAt,
    durationMs,
    sourcePackets,
    itemPacket,
    summary,
    phase08Extraction
  });

  const sourceCollection = {
    schema_version: '2026-02-20.source-indexing-extraction-packet.collection.v1',
    record_kind: 'source_indexing_extraction_packet_collection',
    run_id: runId,
    category,
    item_identifier: productId,
    generated_at: nowIso,
    source_packet_count: sourcePackets.length,
    packets: sourcePackets
  };

  return {
    sourceCollection,
    itemPacket,
    runMetaPacket
  };
}
