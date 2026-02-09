#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  GetObjectAclCommand
} from '@aws-sdk/client-s3';
import { loadConfig } from '../config.js';
import { parseArgs, asBool } from './args.js';
import { createStorage, toPosixKey } from '../s3/storage.js';
import { runProduct } from '../pipeline/runProduct.js';

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonFromS3(client, bucket, key) {
  const res = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key
    })
  );
  const text = await streamToString(res.Body);
  return JSON.parse(text);
}

async function mustHeadObject(client, bucket, key) {
  await client.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: key
    })
  );
}

async function listCount(client, bucket, prefix) {
  const res = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix
    })
  );
  return {
    count: (res.Contents || []).length,
    keys: (res.Contents || []).map((o) => o.Key)
  };
}

function assertNoPublicGrant(acl) {
  const grants = acl.Grants || [];
  for (const grant of grants) {
    const uri = grant.Grantee?.URI || '';
    if (uri.includes('/AllUsers') || uri.includes('/AuthenticatedUsers')) {
      return false;
    }
  }
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const config = loadConfig({
    localMode: false,
    dryRun: asBool(args['dry-run'], false),
    writeMarkdownSummary: asBool(args['write-md'], true)
  });

  if (!config.s3Bucket) {
    throw new Error('S3_BUCKET is required for test:s3');
  }

  const fixturePath = path.resolve(
    args.fixture || 'fixtures/s3/specs/inputs/mouse/products/mouse-razer-viper-v3-pro.json'
  );
  const fixtureRaw = await fs.readFile(fixturePath, 'utf8');
  const job = JSON.parse(fixtureRaw);

  const productId = job.productId;
  if (!productId) {
    throw new Error(`Fixture missing productId: ${fixturePath}`);
  }

  const s3Key =
    args.s3key || toPosixKey(config.s3InputPrefix, 'mouse', 'products', `${productId}.json`);

  const s3 = new S3Client({ region: config.awsRegion });
  await s3.send(
    new PutObjectCommand({
      Bucket: config.s3Bucket,
      Key: s3Key,
      Body: Buffer.from(JSON.stringify(job, null, 2), 'utf8'),
      ContentType: 'application/json'
    })
  );

  const storage = createStorage(config);
  const runResult = await runProduct({
    storage,
    config,
    s3Key
  });

  const runBase = toPosixKey(
    config.s3OutputPrefix,
    'mouse',
    productId,
    'runs',
    runResult.runId
  );
  const latestBase = toPosixKey(config.s3OutputPrefix, 'mouse', productId, 'latest');

  const requiredKeys = [
    `${runBase}/normalized/mouse.normalized.json`,
    `${runBase}/normalized/mouse.row.tsv`,
    `${runBase}/provenance/fields.provenance.json`,
    `${runBase}/logs/events.jsonl.gz`,
    `${runBase}/logs/summary.json`,
    `${latestBase}/normalized.json`,
    `${latestBase}/provenance.json`,
    `${latestBase}/summary.json`,
    `${latestBase}/mouse.row.tsv`
  ];

  if (config.writeMarkdownSummary) {
    requiredKeys.push(`${runBase}/summary/mouse.summary.md`);
    requiredKeys.push(`${latestBase}/summary.md`);
  }

  for (const key of requiredKeys) {
    await mustHeadObject(s3, config.s3Bucket, key);
  }

  const rawPages = await listCount(s3, config.s3Bucket, `${runBase}/raw/pages/`);
  const rawNetwork = await listCount(s3, config.s3Bucket, `${runBase}/raw/network/`);

  if (rawPages.count === 0) {
    throw new Error(`No raw pages written under ${runBase}/raw/pages/`);
  }
  if (rawNetwork.count === 0) {
    throw new Error(`No raw network responses written under ${runBase}/raw/network/`);
  }

  const acl = await s3.send(
    new GetObjectAclCommand({
      Bucket: config.s3Bucket,
      Key: `${latestBase}/normalized.json`
    })
  );
  const privateCheck = assertNoPublicGrant(acl);
  if (!privateCheck) {
    throw new Error('Public ACL grant detected on latest/normalized.json');
  }

  const summary = await readJsonFromS3(s3, config.s3Bucket, `${runBase}/logs/summary.json`);
  const normalized = await readJsonFromS3(
    s3,
    config.s3Bucket,
    `${runBase}/normalized/mouse.normalized.json`
  );

  const output = {
    test: 's3-integration',
    bucket: config.s3Bucket,
    region: config.awsRegion,
    input_key: s3Key,
    run_id: runResult.runId,
    run_base: runBase,
    latest_base: latestBase,
    validated: summary.validated,
    reason: summary.validated_reason || summary.reason,
    confidence: summary.confidence,
    completeness_required_percent: summary.completeness_required_percent,
    coverage_overall_percent: summary.coverage_overall_percent,
    verified_key_count: requiredKeys.length,
    raw_pages_count: rawPages.count,
    raw_network_count: rawNetwork.count,
    mouse_snapshot: {
      productId: normalized.productId,
      brand: normalized.identity.brand,
      model: normalized.identity.model,
      connection: normalized.fields.connection,
      weight: normalized.fields.weight,
      sensor: normalized.fields.sensor,
      polling_rate: normalized.fields.polling_rate,
      dpi: normalized.fields.dpi,
      side_buttons: normalized.fields.side_buttons,
      middle_buttons: normalized.fields.middle_buttons
    }
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
