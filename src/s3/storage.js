import fs from 'node:fs/promises';
import path from 'node:path';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand
} from '@aws-sdk/client-s3';

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function toPosixKey(...parts) {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');
}

class S3Storage {
  constructor(config) {
    this.bucket = config.s3Bucket;
    this.inputPrefix = config.s3InputPrefix;
    this.outputPrefix = config.s3OutputPrefix;
    this.client = new S3Client({ region: config.awsRegion });
  }

  async listInputKeys(category) {
    const prefix = toPosixKey(this.inputPrefix, category, 'products');
    const keys = [];
    let continuationToken;

    do {
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken
        })
      );

      for (const item of result.Contents || []) {
        if (item.Key && item.Key.endsWith('.json')) {
          keys.push(item.Key);
        }
      }

      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);

    return keys.sort();
  }

  async listKeys(prefix) {
    const keys = [];
    let continuationToken;

    do {
      const result = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken
        })
      );

      for (const item of result.Contents || []) {
        if (item.Key) {
          keys.push(item.Key);
        }
      }

      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (continuationToken);

    return keys.sort();
  }

  async readJson(key) {
    const text = await this.readText(key);
    return JSON.parse(text);
  }

  async readText(key) {
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      })
    );
    const buffer = await streamToBuffer(result.Body);
    return buffer.toString('utf8');
  }

  async readJsonOrNull(key) {
    try {
      return await this.readJson(key);
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }

  async readTextOrNull(key) {
    try {
      return await this.readText(key);
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }

  async writeObject(key, body, metadata = {}) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: metadata.contentType,
        ContentEncoding: metadata.contentEncoding,
        CacheControl: metadata.cacheControl
      })
    );
  }

  async objectExists(key) {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key
        })
      );
      return true;
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  resolveOutputKey(...parts) {
    return toPosixKey(this.outputPrefix, ...parts);
  }

  resolveInputKey(...parts) {
    return toPosixKey(this.inputPrefix, ...parts);
  }
}

class LocalStorage {
  constructor(config) {
    this.inputRoot = path.resolve(config.localInputRoot);
    this.outputRoot = path.resolve(config.localOutputRoot);
    this.inputPrefix = config.s3InputPrefix;
    this.outputPrefix = config.s3OutputPrefix;
  }

  resolveLocalPath(key) {
    if (key.startsWith(`${this.inputPrefix}/`)) {
      return path.join(this.inputRoot, ...key.split('/'));
    }
    if (key.startsWith(`${this.outputPrefix}/`)) {
      return path.join(this.outputRoot, ...key.split('/'));
    }
    return path.join(this.outputRoot, ...key.split('/'));
  }

  async listInputKeys(category) {
    const dir = path.join(this.inputRoot, this.inputPrefix, category, 'products');
    const keys = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.json')) {
          keys.push(
            toPosixKey(this.inputPrefix, category, 'products', entry.name)
          );
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }

    return keys.sort();
  }

  async listKeys(prefix) {
    const root = path.join(this.outputRoot, ...String(prefix || '').split('/'));
    const keys = [];

    const walk = async (dir) => {
      let entries = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (error.code === 'ENOENT') {
          return;
        }
        throw error;
      }

      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        const rel = path.relative(this.outputRoot, full).split(path.sep).join('/');
        keys.push(rel);
      }
    };

    await walk(root);
    return keys.sort();
  }

  async readJson(key) {
    const content = await this.readText(key);
    return JSON.parse(content);
  }

  async readText(key) {
    const fullPath = this.resolveLocalPath(key);
    return await fs.readFile(fullPath, 'utf8');
  }

  async readJsonOrNull(key) {
    try {
      return await this.readJson(key);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async readTextOrNull(key) {
    try {
      return await this.readText(key);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async writeObject(key, body) {
    const fullPath = this.resolveLocalPath(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, body);
  }

  async objectExists(key) {
    const fullPath = this.resolveLocalPath(key);
    try {
      await fs.access(fullPath);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }

  resolveOutputKey(...parts) {
    return toPosixKey(this.outputPrefix, ...parts);
  }

  resolveInputKey(...parts) {
    return toPosixKey(this.inputPrefix, ...parts);
  }
}

export function createStorage(config) {
  if (config.localMode) {
    return new LocalStorage(config);
  }
  return new S3Storage(config);
}

export { toPosixKey };
