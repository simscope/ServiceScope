import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { authorizeReelForRender } from '../reel-renderer/authorization.js';
import { renderAuthorizedReel } from '../reel-renderer/renderer.js';
import { reelRenderErrorCodes } from '../reel-renderer/errors.js';
import { reelRendererVersion } from '../reel-render-jobs/contracts.js';
import {
  parseSandboxAssetManifestJson,
  parseSandboxAuthorityJson,
  reelSandboxAuthorityMaxBytes,
  reelSandboxAuthorityPath,
  reelSandboxCoverMaxBytes,
  reelSandboxCoverPath,
  reelSandboxErrorPath,
  reelSandboxManifestMaxBytes,
  reelSandboxManifestPath,
  reelSandboxOutputDir,
  reelSandboxRenderTimeoutMs,
  reelSandboxResultPath,
  reelSandboxRoot,
  reelSandboxVideoMaxBytes,
  reelSandboxVideoPath,
} from '../reel-sandbox-runtime/contracts.js';

const allowedErrors = new Set(reelRenderErrorCodes);

export async function executeSandboxRunner({
  root = reelSandboxRoot,
  authorize = authorizeReelForRender,
  render = renderAuthorizedReel,
} = {}) {
  if (root !== reelSandboxRoot) throw safeError('REEL_RENDER_MEDIA_INVALID');
  await mkdir(reelSandboxOutputDir, { recursive: true });
  const authorityJson = await readBoundedUtf8(reelSandboxAuthorityPath, reelSandboxAuthorityMaxBytes);
  const manifest = parseSandboxAssetManifestJson(await readBoundedUtf8(reelSandboxManifestPath, reelSandboxManifestMaxBytes));
  const authority = reauthorizeSerializedAuthority(authorityJson, manifest.authoritySha256, authorize);
  const stagedAssets = [];
  for (const row of manifest.assets) {
    const path = resolve(reelSandboxRoot, row.path);
    if (!path.startsWith(`${reelSandboxRoot}/input/`)) throw safeError('REEL_RENDER_MEDIA_INVALID');
    const file = await stat(path).catch(() => { throw safeError('REEL_RENDER_MEDIA_MISSING'); });
    if (!file.isFile() || file.size !== row.size || await sha256File(path) !== row.sha256) {
      throw safeError('REEL_RENDER_MEDIA_INVALID');
    }
    stagedAssets.push({ attachmentId: row.attachmentId, path: row.path });
  }

  const output = await render({
    authorized: authority,
    stagedAssets,
    stagingRoot: reelSandboxRoot,
    ffmpegBin: '/usr/bin/ffmpeg',
    ffprobeBin: '/usr/bin/ffprobe',
    timeoutMs: reelSandboxRenderTimeoutMs,
  });
  try {
    const video = await stat(output.videoPath);
    const cover = await stat(output.coverPath);
    if (!video.isFile() || video.size !== output.fileSize || video.size > reelSandboxVideoMaxBytes
      || !cover.isFile() || cover.size < 1 || cover.size > reelSandboxCoverMaxBytes) {
      throw safeError('REEL_RENDER_OUTPUT_INVALID');
    }
    await copyFile(output.videoPath, reelSandboxVideoPath);
    await copyFile(output.coverPath, reelSandboxCoverPath);
    const result = {
      rendererVersion: reelRendererVersion,
      durationMs: output.durationMs,
      width: output.width,
      height: output.height,
      fps: output.fps,
      videoCodec: output.videoCodec,
      pixelFormat: output.pixelFormat,
      audioStreams: output.audioStreams,
      fileSize: output.fileSize,
      faststart: output.faststart,
      videoSha256: await sha256File(reelSandboxVideoPath),
      coverSha256: await sha256File(reelSandboxCoverPath),
    };
    await writeFile(reelSandboxResultPath, JSON.stringify(result), { flag: 'wx' });
    return result;
  } finally {
    await output.dispose().catch(() => {});
  }
}

export function reauthorizeSerializedAuthority(serialized, expectedSha256, authorize = authorizeReelForRender) {
  if (typeof expectedSha256 !== 'string' || sha256(serialized) !== expectedSha256) {
    throw safeError('REEL_RENDER_INVALID_PLAN');
  }
  const authority = parseSandboxAuthorityJson(serialized);
  return authorize({ plan: authority.plan, context: authority.context });
}

export async function writeSafeRunnerError(error) {
  await mkdir(reelSandboxOutputDir, { recursive: true });
  const code = safeErrorCode(error);
  await writeFile(reelSandboxErrorPath, JSON.stringify({ code }), { flag: 'wx' }).catch(() => {});
  return code;
}

async function readBoundedUtf8(path, maximum) {
  const file = await stat(path).catch(() => { throw safeError('REEL_RENDER_MEDIA_MISSING'); });
  if (!file.isFile() || file.size < 1 || file.size > maximum) throw safeError('REEL_RENDER_MEDIA_INVALID');
  return readFile(path, 'utf8');
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeErrorCode(error) {
  const code = error?.code ?? error?.message;
  return allowedErrors.has(code) ? code : 'REEL_RENDER_FAILED';
}

function safeError(code) {
  const error = new Error(allowedErrors.has(code) ? code : 'REEL_RENDER_FAILED');
  error.code = error.message;
  return error;
}
