import path from 'node:path';
import { gzipBuffer, toNdjson } from '../utils/common.js';

function jsonBuffer(value) {
  return Buffer.from(JSON.stringify(value, null, 2), 'utf8');
}

function safeName(value, fallback = 'artifact') {
  const text = String(value || fallback).replace(/[^a-zA-Z0-9._-]/g, '_');
  return text || fallback;
}

function compactSummary(summary) {
  return {
    productId: summary.productId,
    runId: summary.runId,
    validated: summary.validated,
    reason: summary.reason,
    validated_reason: summary.validated_reason,
    confidence: summary.confidence,
    completeness_required_percent: summary.completeness_required_percent,
    coverage_overall_percent: summary.coverage_overall_percent,
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
          textPreview: pdf.textPreview || ''
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

  return {
    runBase,
    latestBase
  };
}
