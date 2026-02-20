import path from 'node:path';
import fsSync from 'node:fs';
import { gzipBuffer, toNdjson } from '../utils/common.js';
import { SpecDb } from '../db/specDb.js';
import { buildScopedItemCandidateId } from '../utils/candidateIdentifier.js';

function jsonBuffer(value) {
  return Buffer.from(JSON.stringify(value, null, 2), 'utf8');
}

function safeName(value, fallback = 'artifact') {
  const text = String(value || fallback).replace(/[^a-zA-Z0-9._-]/g, '_');
  return text || fallback;
}

function screenshotBuffer(artifact = {}) {
  if (Buffer.isBuffer(artifact?.bytes)) {
    return artifact.bytes;
  }
  const raw = artifact?.bytes;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return Buffer.from(raw, 'base64');
    } catch {
      return null;
    }
  }
  return null;
}

function compactSummary(summary) {
  return {
    productId: summary.productId,
    runId: summary.runId,
    validated: summary.validated,
    reason: summary.reason,
    validated_reason: summary.validated_reason,
    validation_reasons: summary.validation_reasons || [],
    confidence: summary.confidence,
    completeness_required_percent: summary.completeness_required_percent,
    coverage_overall_percent: summary.coverage_overall_percent,
    missing_required_fields: summary.missing_required_fields || [],
    fields_below_pass_target: summary.fields_below_pass_target || [],
    critical_fields_below_pass_target: summary.critical_fields_below_pass_target || [],
    anchor_conflicts: summary.anchor_conflicts || [],
    identity_confidence: summary.identity_confidence,
    identity_gate_validated: summary.identity_gate_validated,
    publishable: typeof summary.publishable === 'boolean' ? summary.publishable : Boolean(summary.validated),
    publish_blockers: summary.publish_blockers || [],
    identity_report: summary.identity_report || null,
    hypothesis_queue: summary.hypothesis_queue || [],
    constraint_analysis: summary.constraint_analysis || {},
    runtime_engine: summary.runtime_engine || {},
    field_reasoning: summary.field_reasoning || {},
    needset: summary.needset || null,
    parser_health: summary.parser_health || {},
    temporal_evidence: summary.temporal_evidence || {},
    endpoint_mining: summary.endpoint_mining || {},
    fields_below_pass_target_count: (summary.fields_below_pass_target || []).length,
    anchor_conflicts_count: (summary.anchor_conflicts || []).length,
    duration_ms: summary.duration_ms,
    generated_at: summary.generated_at
  };
}

async function writePageArtifacts({ writes, storage, runBase, host, artifact }) {
  writes.push(
    storage.writeObject(
      `${runBase}/raw/pages/${host}/page.html.gz`,
      gzipBuffer(artifact.html || ''),
      {
        contentType: 'text/html',
        contentEncoding: 'gzip'
      }
    )
  );

  writes.push(
    storage.writeObject(
      `${runBase}/raw/pages/${host}/ldjson.json`,
      jsonBuffer(artifact.ldjsonBlocks || []),
      {
        contentType: 'application/json'
      }
    )
  );

  writes.push(
    storage.writeObject(
      `${runBase}/raw/pages/${host}/embedded_state.json`,
      jsonBuffer(artifact.embeddedState || {}),
      {
        contentType: 'application/json'
      }
    )
  );

  writes.push(
    storage.writeObject(
      `${runBase}/raw/network/${host}/responses.ndjson.gz`,
      gzipBuffer(toNdjson(artifact.networkResponses || [])),
      {
        contentType: 'application/x-ndjson',
        contentEncoding: 'gzip'
      }
    )
  );

  const domSnippetHtml = String(artifact?.domSnippet?.html || '').trim();
  if (domSnippetHtml) {
    writes.push(
      storage.writeObject(
        `${runBase}/raw/dom/${host}/dom_snippet.html`,
        Buffer.from(domSnippetHtml, 'utf8'),
        { contentType: 'text/html; charset=utf-8' }
      )
    );
    writes.push(
      storage.writeObject(
        `${runBase}/raw/dom/${host}/dom_snippet.meta.json`,
        jsonBuffer({
          kind: String(artifact?.domSnippet?.kind || 'html_window'),
          char_count: Number(artifact?.domSnippet?.char_count || domSnippetHtml.length),
          generated_at: new Date().toISOString()
        }),
        { contentType: 'application/json' }
      )
    );
  }

  const screenshot = screenshotBuffer(artifact?.screenshot || {});
  if (screenshot && screenshot.length > 0) {
    const format = String(artifact?.screenshot?.format || 'jpeg').trim().toLowerCase();
    const ext = format === 'png' ? 'png' : 'jpg';
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
    writes.push(
      storage.writeObject(
        `${runBase}/raw/screenshots/${host}/screenshot.${ext}`,
        screenshot,
        { contentType }
      )
    );
    writes.push(
      storage.writeObject(
        `${runBase}/raw/screenshots/${host}/screenshot.meta.json`,
        jsonBuffer({
          kind: String(artifact?.screenshot?.kind || 'page'),
          format: ext,
          selector: String(artifact?.screenshot?.selector || '').trim() || null,
          width: Number(artifact?.screenshot?.width || 0) || null,
          height: Number(artifact?.screenshot?.height || 0) || null,
          bytes: screenshot.length,
          captured_at: String(artifact?.screenshot?.captured_at || '').trim() || null
        }),
        { contentType: 'application/json' }
      )
    );
  }

  writes.push(
    storage.writeObject(
      `${runBase}/extracted/${host}/candidates.json`,
      jsonBuffer(artifact.extractedCandidates || []),
      {
        contentType: 'application/json'
      }
    )
  );

  for (const pdf of artifact.pdfDocs || []) {
    const filename = safeName(pdf.filename || path.basename(pdf.url || '') || 'doc.pdf');
    writes.push(
      storage.writeObject(
        `${runBase}/raw/pdfs/${host}/${filename}`,
        pdf.bytes,
        {
          contentType: 'application/pdf'
        }
      )
    );

    writes.push(
      storage.writeObject(
        `${runBase}/raw/pdfs/${host}/${filename}.json`,
        jsonBuffer({
          url: pdf.url,
          filename,
          textPreview: pdf.textPreview || '',
          backend_selected: String(pdf.backend_selected || '').trim() || null,
          backend_requested: String(pdf.backend_requested || '').trim() || null,
          backend_fallback_used: Boolean(pdf.backend_fallback_used),
          pair_count: Number(pdf.pair_count || 0),
          kv_pair_count: Number(pdf.kv_pair_count || 0),
          table_pair_count: Number(pdf.table_pair_count || 0),
          pages_scanned: Number(pdf.pages_scanned || 0),
          tables_found: Number(pdf.tables_found || 0),
          kv_preview_rows: Array.isArray(pdf.kv_preview_rows) ? pdf.kv_preview_rows.slice(0, 20) : [],
          table_preview_rows: Array.isArray(pdf.table_preview_rows) ? pdf.table_preview_rows.slice(0, 20) : []
        }),
        {
          contentType: 'application/json'
        }
      )
    );
  }
}

export async function exportRunArtifacts({
  storage,
  category,
  productId,
  runId,
  artifactsByHost,
  adapterArtifacts,
  normalized,
  provenance,
  candidates,
  specDb,
  summary,
  events,
  markdownSummary,
  rowTsv,
  writeMarkdownSummary
}) {
  const runBase = storage.resolveOutputKey(category, productId, 'runs', runId);
  const latestBase = storage.resolveOutputKey(category, productId, 'latest');

  const writes = [];

  for (const [host, artifact] of Object.entries(artifactsByHost)) {
    await writePageArtifacts({ writes, storage, runBase, host, artifact });
  }

  for (const artifact of adapterArtifacts || []) {
    const name = safeName(artifact.name || 'adapter');
    writes.push(
      storage.writeObject(
        `${runBase}/raw/adapters/${name}.json`,
        jsonBuffer(artifact.payload || artifact),
        {
          contentType: 'application/json'
        }
      )
    );
  }

  writes.push(
    storage.writeObject(
      `${runBase}/normalized/${category}.normalized.json`,
      jsonBuffer(normalized),
      { contentType: 'application/json' }
    )
  );

  writes.push(
    storage.writeObject(
      `${runBase}/normalized/${category}.row.tsv`,
      Buffer.from(`${rowTsv}\n`, 'utf8'),
      { contentType: 'text/tab-separated-values' }
    )
  );

  writes.push(
    storage.writeObject(
      `${runBase}/provenance/fields.provenance.json`,
      jsonBuffer(provenance),
      { contentType: 'application/json' }
    )
  );

  writes.push(
    storage.writeObject(
      `${runBase}/provenance/fields.candidates.json`,
      jsonBuffer(candidates || {}),
      { contentType: 'application/json' }
    )
  );

  writes.push(
    storage.writeObject(
      `${runBase}/logs/events.jsonl.gz`,
      gzipBuffer(toNdjson(events || [])),
      { contentType: 'application/x-ndjson', contentEncoding: 'gzip' }
    )
  );

  writes.push(
    storage.writeObject(
      `${runBase}/logs/summary.json`,
      jsonBuffer(summary),
      { contentType: 'application/json' }
    )
  );

  if (writeMarkdownSummary && markdownSummary) {
    writes.push(
      storage.writeObject(
        `${runBase}/summary/${category}.summary.md`,
        Buffer.from(markdownSummary, 'utf8'),
        { contentType: 'text/markdown; charset=utf-8' }
      )
    );
  }

  writes.push(
    storage.writeObject(
      `${latestBase}/normalized.json`,
      jsonBuffer(normalized),
      { contentType: 'application/json' }
    )
  );

  writes.push(
    storage.writeObject(
      `${latestBase}/provenance.json`,
      jsonBuffer(provenance),
      { contentType: 'application/json' }
    )
  );

  writes.push(
    storage.writeObject(
      `${latestBase}/summary.json`,
      jsonBuffer(compactSummary(summary)),
      { contentType: 'application/json' }
    )
  );

  writes.push(
    storage.writeObject(
      `${latestBase}/candidates.json`,
      jsonBuffer(candidates || {}),
      { contentType: 'application/json' }
    )
  );

  writes.push(
    storage.writeObject(
      `${latestBase}/${category}.row.tsv`,
      Buffer.from(`${rowTsv}\n`, 'utf8'),
      { contentType: 'text/tab-separated-values' }
    )
  );

  if (writeMarkdownSummary && markdownSummary) {
    writes.push(
      storage.writeObject(
        `${latestBase}/summary.md`,
        Buffer.from(markdownSummary, 'utf8'),
        { contentType: 'text/markdown; charset=utf-8' }
      )
    );
  }

  await Promise.all(writes);

  // Dual-write to SpecDb — resolve lazily if not passed in
  let db = specDb;
  if (!db) {
    try {
      const dbPath = path.join('.specfactory_tmp', category, 'spec.sqlite');
      fsSync.accessSync(dbPath);
      db = new SpecDb({ dbPath, category });
    } catch { /* no DB available */ }
  }
  if (db) {
    try {
      exportToSpecDb({ specDb: db, category, productId, runId, normalized, provenance, candidates, summary });
    } catch (err) {
      // Best-effort — don't fail the export if SpecDb write fails
      if (typeof console !== 'undefined') console.error('[exporter] SpecDb dual-write error:', err.message);
    } finally {
      // Close if we opened it ourselves
      if (!specDb && db) try { db.close(); } catch { /* */ }
    }
  }

  return {
    runBase,
    latestBase
  };
}

/** Dual-write pipeline outputs into SpecDb tables */
function exportToSpecDb({ specDb, category, productId, runId, normalized, provenance, candidates, summary }) {
  const fields = normalized?.fields || {};
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const usedCandidateIds = new Set();
  const reserveCandidateId = (candidateIdBase) => {
    let next = String(candidateIdBase || '').trim();
    if (!next) return next;
    if (!usedCandidateIds.has(next)) {
      usedCandidateIds.add(next);
      return next;
    }
    let ordinal = 1;
    while (usedCandidateIds.has(`${next}::dup_${ordinal}`)) ordinal += 1;
    next = `${next}::dup_${ordinal}`;
    usedCandidateIds.add(next);
    return next;
  };

  const tx = specDb.db.transaction(() => {
    // 1. Product run record
    specDb.upsertProductRun({
      product_id: productId,
      run_id: runId,
      is_latest: true,
      summary: summary || {},
      validated: summary?.validated || false,
      confidence: summary?.confidence ?? 0,
      cost_usd_run: summary?.cost_usd ?? 0,
      sources_attempted: summary?.sources_attempted ?? 0,
      run_at: new Date().toISOString()
    });

    // 2. Item field state from normalized
    for (const [fieldKey, rawValue] of Object.entries(fields)) {
      const prov = isObj(provenance) ? provenance[fieldKey] : null;
      const nextValue = rawValue != null ? String(rawValue) : null;
      specDb.upsertItemFieldState({
        productId,
        fieldKey,
        value: nextValue,
        confidence: prov?.confidence ?? 0,
        source: 'pipeline',
        overridden: false,
        needsAiReview: (prov?.confidence ?? 0) < 0.8,
        aiReviewComplete: false
      });
      specDb.syncItemListLinkForFieldValue({
        productId,
        fieldKey,
        value: nextValue,
      });
    }

    // 3. Candidates
    if (isObj(candidates)) {
      for (const [fieldKey, fieldCandidates] of Object.entries(candidates)) {
        if (!Array.isArray(fieldCandidates)) continue;
        for (let i = 0; i < fieldCandidates.length; i++) {
          const c = fieldCandidates[i];
          if (!isObj(c)) continue;
          const baseCandidateId = buildScopedItemCandidateId({
            productId,
            fieldKey,
            rawCandidateId: c.candidate_id || c.id || '',
            value: c.value ?? '',
            sourceHost: c.source_host ?? c.evidence?.host ?? '',
            sourceMethod: c.source_method ?? c.method ?? c.evidence?.method ?? '',
            index: c.rank ?? i,
            runId: runId || '',
          });
          const candidateId = reserveCandidateId(baseCandidateId);
          specDb.insertCandidate({
            candidate_id: candidateId,
            category,
            product_id: productId,
            field_key: fieldKey,
            value: c.value ?? null,
            normalized_value: c.normalized_value ?? null,
            score: c.score ?? c.confidence ?? 0,
            rank: c.rank ?? i,
            source_url: c.source_url ?? c.evidence?.url ?? null,
            source_host: c.source_host ?? c.evidence?.host ?? null,
            source_root_domain: c.source_root_domain ?? c.evidence?.rootDomain ?? null,
            source_tier: c.source_tier ?? c.evidence?.tier ?? null,
            source_method: c.source_method ?? c.evidence?.method ?? null,
            approved_domain: c.approved_domain ?? c.evidence?.approvedDomain ?? false,
            snippet_id: c.snippet_id ?? null,
            snippet_hash: c.snippet_hash ?? null,
            snippet_text: c.snippet_text ?? null,
            quote: c.quote ?? c.evidence?.quote ?? null,
            quote_span_start: c.quote_span?.[0] ?? null,
            quote_span_end: c.quote_span?.[1] ?? null,
            evidence_url: c.evidence_url ?? c.evidence?.url ?? null,
            evidence_retrieved_at: c.evidence_retrieved_at ?? c.evidence?.retrieved_at ?? null,
            extracted_at: c.extracted_at || new Date().toISOString(),
            run_id: runId
          });
        }
      }
    }

    // 4. Update queue product with run results
    const existingQueue = specDb.getQueueProduct(productId);
    if (existingQueue) {
      specDb.upsertQueueProduct({
        product_id: productId,
        status: summary?.validated ? 'complete' : existingQueue.status,
        last_run_id: runId,
        rounds_completed: (existingQueue.rounds_completed || 0) + 1,
        cost_usd_total: (existingQueue.cost_usd_total || 0) + (summary?.cost_usd ?? 0),
        attempts_total: (existingQueue.attempts_total || 0) + 1,
        last_completed_at: new Date().toISOString(),
        last_summary: summary ? JSON.stringify(summary) : null,
        // Preserve existing fields
        s3key: existingQueue.s3key,
        priority: existingQueue.priority,
        retry_count: existingQueue.retry_count,
        max_attempts: existingQueue.max_attempts,
        next_retry_at: existingQueue.next_retry_at,
        next_action_hint: existingQueue.next_action_hint,
        last_urls_attempted: existingQueue.last_urls_attempted,
        last_error: existingQueue.last_error,
        last_started_at: existingQueue.last_started_at,
        dirty_flags: existingQueue.dirty_flags
      });
    }
  });
  tx();
}
