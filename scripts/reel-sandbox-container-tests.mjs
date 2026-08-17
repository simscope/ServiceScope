import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { writeSandboxContainerFixture } from './reel-sandbox-fixture.mjs';

const [mode, rootArgument] = process.argv.slice(2);
const root = resolve(rootArgument ?? '');
if (!rootArgument || !['prepare', 'verify'].includes(mode)) throw new Error('USAGE: prepare|verify <absolute-root>');

if (mode === 'prepare') {
  await writeSandboxContainerFixture(root);
  console.log('Sandbox container fixture prepared.');
} else {
  const result = JSON.parse(await readFile(join(root, 'output', 'result.json'), 'utf8'));
  assert.deepEqual(Object.keys(result), [
    'rendererVersion', 'durationMs', 'width', 'height', 'fps', 'videoCodec', 'pixelFormat',
    'audioStreams', 'fileSize', 'faststart', 'videoSha256', 'coverSha256',
  ]);
  assert.equal(result.rendererVersion, 'servicescope-reel-renderer-v2');
  assert.equal(result.videoCodec, 'h264');
  assert.deepEqual([result.width, result.height, result.fps], [1080, 1920, 30]);
  assert.equal(result.pixelFormat, 'yuv420p');
  assert.equal(result.audioStreams, 0);
  assert.equal(result.faststart, true);
  assert.equal((await stat(join(root, 'output', 'reel.mp4'))).size, result.fileSize);
  assert.equal(await sha256File(join(root, 'output', 'reel.mp4')), result.videoSha256);
  assert.equal(await sha256File(join(root, 'output', 'cover.jpg')), result.coverSha256);
  console.log(JSON.stringify({
    container_fixture: 'PASS', codec: result.videoCodec, width: result.width, height: result.height,
    fps: result.fps, durationMs: result.durationMs, audioStreams: result.audioStreams,
    pixelFormat: result.pixelFormat, faststart: result.faststart, fileSize: result.fileSize,
    videoSha256: result.videoSha256, coverSha256: result.coverSha256, shaVerification: true,
  }));
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
