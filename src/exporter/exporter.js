import { gzipBuffer, toNdjson } from '../utils/common.js';

function jsonBuffer(value) {
  return Buffer.from(JSON.stringify(value, null, 2), 'utf8');
}

function compactSummary(summary) {
  return {
    productId: summary.productId,
    runId: summary.runId,
    validated: summary.validated,
    reason: summary.reason,
    confidence: summary.confidence,
    completeness: summary.completeness,
    fields_below_pass_target_count: (summary.fields_below_pass_target || []).length,
    anchor_conflicts_count: (summary.anchor_conflicts || []).length,
    duration_ms: summary.duration_ms
  };
}

export async function exportRunArtifacts({
  storage,
  productId,
  runId,
  artifactsByHost,
  normalized,
  provenance,
  summary,
  events,
  markdownSummary,
  rowTsv,
  writeMarkdownSummary
}) {
  const runBase = storage.resolveOutputKey('mouse', productId, 'runs', runId);
  const latestBase = storage.resolveOutputKey('mouse', productId, 'latest');

  const writes = [];

  for (const [host, artifact] of Object.entries(artifactsByHost)) {
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
  }

  writes.push(
    storage.writeObject(
      `${runBase}/normalized/mouse.normalized.json`,
      jsonBuffer(normalized),
      { contentType: 'application/json' }
    )
  );

  writes.push(
    storage.writeObject(
      `${runBase}/normalized/mouse.row.tsv`,
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
        `${runBase}/summary/mouse.summary.md`,
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
      `${latestBase}/mouse.row.tsv`,
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
