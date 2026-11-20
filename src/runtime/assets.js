import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import models from './weights.json' with { type: 'json' };

export { models };
export const vectorFormat = 'qwen3-0.6b/' + models.embedding.revision + '/fp16-last-token-l2-v1';

async function verified(path, asset) {
  try {
    if ((await stat(path)).size !== asset.bytes) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex') === asset.sha256;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

// A file enters the cache only after its exact pinned bytes pass verification.
// Retries keep files that completed before a disconnect or host restart.
export async function installModel(root, kind, report, signal) {
  const manifest = models[kind];
  const total = manifest.files.reduce((sum, item) => sum + item.bytes, 0);
  let complete = 0;
  for (const asset of manifest.files) {
    signal.throwIfAborted();
    const path = join(root, kind, asset.path);
    await mkdir(dirname(path), { recursive: true });
    report({ file: asset.path, received: complete, total });
    if (!(await verified(path, asset))) {
      const url =
        'https://huggingface.co/' +
        manifest.repo +
        '/resolve/' +
        manifest.revision +
        '/' +
        asset.path;
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(45 * 60_000)]),
      });
      if (!response.ok || !response.body)
        throw new Error('Download failed for ' + asset.path + ' (HTTP ' + response.status + ')');
      const hash = createHash('sha256');
      let received = 0;
      let nextReport = 0;
      const meter = new Transform({
        transform(chunk, encoding, done) {
          received += chunk.length;
          hash.update(chunk);
          if (Date.now() >= nextReport) {
            report({ file: asset.path, received: complete + received, total });
            nextReport = Date.now() + 250;
          }
          done(received > asset.bytes ? new Error('Download exceeds expected size') : null, chunk);
        },
      });
      const partial = path + '.' + randomUUID() + '.part';
      try {
        await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(partial), {
          signal,
        });
        if (received !== asset.bytes || hash.digest('hex') !== asset.sha256)
          throw new Error('Checksum mismatch for ' + asset.path);
        await rename(partial, path);
      } finally {
        await rm(partial, { force: true });
      }
    }
    complete += asset.bytes;
    report({ file: asset.path, received: complete, total });
  }
}
