import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import {
  reelRenderMaxAggregateMediaBytes,
  reelRenderMaxMediaBytes,
  reelRenderMaxMediaItems,
  RenderJobError,
} from '../reel-render-jobs/contracts.js';
import { reelRenderErrorCodes } from '../reel-renderer/errors.js';
import { recordRenderEvent } from '../reel-render-jobs/telemetry.js';
import {
  assertImmutableSandboxImage,
  parseSandboxResultJson,
  reelSandboxAssetSchemaVersion,
  reelSandboxAuthorityPath,
  reelSandboxCoverMaxBytes,
  reelSandboxCoverPath,
  reelSandboxErrorPath,
  reelSandboxManifestMaxBytes,
  reelSandboxManifestPath,
  reelSandboxOutputDir,
  reelSandboxRenderTimeoutMs,
  reelSandboxResultMaxBytes,
  reelSandboxResultPath,
  reelSandboxRoot,
  reelSandboxRunnerPath,
  reelSandboxSessionTimeoutMs,
  reelSandboxVideoMaxBytes,
  reelSandboxVideoPath,
  serializeSandboxAuthority,
} from './contracts.js';

const deterministicErrors = new Set(reelRenderErrorCodes);

export function createSandboxRenderAdapter({
  image,
  createSandbox,
  createOutputRoot = () => mkdtemp(join(tmpdir(), 'servicescope-reel-sandbox-output-')),
  telemetry,
}) {
  const immutableImage = assertImmutableSandboxImage(image);
  if (typeof createSandbox !== 'function') throw serviceUnavailable();

  return async function renderInSandbox({ authorized, authority, stagedAssets, stagingRoot, telemetryContext = {} }) {
    if (!authorized || typeof authorized !== 'object') throw new RenderJobError('REEL_RENDER_UNAUTHORIZED', 403);
    const transfer = await buildTransfer(authority, stagedAssets, stagingRoot);
    let sandbox;
    let outputRoot;
    let succeeded = false;
    let operationError;
    try {
      sandbox = await createSandbox({
        image: immutableImage,
        resources: { vcpus: 1 },
        persistent: false,
        timeout: reelSandboxSessionTimeoutMs,
        networkPolicy: 'deny-all',
      });
      recordRenderEvent(telemetry, 'sandbox_started', telemetryContext);
      await sandbox.writeFiles(transfer.files);
      recordRenderEvent(telemetry, 'ffmpeg_started', telemetryContext);
      const command = await sandbox.runCommand({
        cmd: '/usr/local/bin/node',
        args: [reelSandboxRunnerPath],
        cwd: reelSandboxRoot,
        timeoutMs: reelSandboxRenderTimeoutMs,
      });
      outputRoot = await createOutputRoot();
      if (command.exitCode !== 0) throw await runnerFailure(sandbox, outputRoot);
      recordRenderEvent(telemetry, 'ffmpeg_completed', telemetryContext);

      const resultPath = join(outputRoot, 'result.json');
      const videoPath = join(outputRoot, 'reel.mp4');
      const coverPath = join(outputRoot, 'cover.jpg');
      await downloadRequired(sandbox, reelSandboxResultPath, resultPath);
      await assertFileSize(resultPath, 1, reelSandboxResultMaxBytes);
      const result = parseSandboxResultJson(await readFile(resultPath, 'utf8'));
      await downloadRequired(sandbox, reelSandboxVideoPath, videoPath);
      await downloadRequired(sandbox, reelSandboxCoverPath, coverPath);
      const videoSize = await assertFileSize(videoPath, 20_000, reelSandboxVideoMaxBytes);
      const coverSize = await assertFileSize(coverPath, 1, reelSandboxCoverMaxBytes);
      if (videoSize !== result.fileSize
        || await sha256File(videoPath) !== result.videoSha256
        || await sha256File(coverPath) !== result.coverSha256) {
        throw new RenderJobError('REEL_RENDER_OUTPUT_INVALID', 400);
      }
      recordRenderEvent(telemetry, 'output_validated', telemetryContext);
      succeeded = true;
      return {
        videoPath,
        coverPath,
        durationMs: result.durationMs,
        width: result.width,
        height: result.height,
        fps: result.fps,
        videoCodec: result.videoCodec,
        pixelFormat: result.pixelFormat,
        audioStreams: result.audioStreams,
        fileSize: result.fileSize,
        coverFileSize: coverSize,
        videoSha256: result.videoSha256,
        coverSha256: result.coverSha256,
        faststart: result.faststart,
        async dispose() {
          await rm(outputRoot, { recursive: true, force: true });
        },
      };
    } catch (error) {
      operationError = mapSandboxError(error);
      const code = operationError.code ?? 'REEL_RENDER_SERVICE_UNAVAILABLE';
      if (code === 'REEL_RENDER_TIMEOUT') recordRenderEvent(telemetry, 'render_timeout', { ...telemetryContext, code });
      else if (code === 'REEL_RENDER_OUTPUT_INVALID') recordRenderEvent(telemetry, 'output_rejected', { ...telemetryContext, code });
      else if (sandbox) recordRenderEvent(telemetry, 'ffmpeg_failed', { ...telemetryContext, code });
      else recordRenderEvent(telemetry, 'sandbox_failed', { ...telemetryContext, code });
      throw operationError;
    } finally {
      if (sandbox) {
        try {
          await sandbox.stop();
        } catch {
          if (!operationError) {
            if (outputRoot) await rm(outputRoot, { recursive: true, force: true });
            throw serviceUnavailable();
          }
        }
      }
      if (!succeeded && outputRoot) await rm(outputRoot, { recursive: true, force: true });
      recordRenderEvent(telemetry, 'cleanup_completed', telemetryContext);
    }
  };
}

async function buildTransfer(authority, stagedAssets, stagingRoot) {
  if (!plainObject(authority) || Object.keys(authority).sort().join(',') !== 'context,plan'
    || !Array.isArray(stagedAssets) || stagedAssets.length < 1 || stagedAssets.length > reelRenderMaxMediaItems
    || typeof stagingRoot !== 'string') {
    throw new RenderJobError('REEL_RENDER_MEDIA_INVALID', 400);
  }
  const authorityJson = serializeSandboxAuthority(authority);
  const assets = [];
  const files = [{ path: reelSandboxAuthorityPath, content: authorityJson }];
  let aggregateBytes = 0;
  const attachmentIds = new Set();
  for (let index = 0; index < stagedAssets.length; index += 1) {
    const row = stagedAssets[index];
    if (!plainObject(row) || Object.keys(row).sort().join(',') !== 'attachmentId,path'
      || typeof row.attachmentId !== 'string' || attachmentIds.has(row.attachmentId)
      || row.path !== `asset-${index + 1}.bin`) {
      throw new RenderJobError('REEL_RENDER_MEDIA_INVALID', 400);
    }
    const localPath = resolve(stagingRoot, row.path);
    if (basename(localPath) !== row.path) throw new RenderJobError('REEL_RENDER_MEDIA_INVALID', 400);
    const size = await assertFileSize(localPath, 1, reelRenderMaxMediaBytes, 'REEL_RENDER_MEDIA_INVALID');
    aggregateBytes += size;
    if (aggregateBytes > reelRenderMaxAggregateMediaBytes) throw new RenderJobError('REEL_RENDER_MEDIA_INVALID', 400);
    const bytes = await readFile(localPath);
    const sandboxPath = `input/asset-${index + 1}.bin`;
    assets.push({ attachmentId: row.attachmentId, path: sandboxPath, size, sha256: sha256(bytes) });
    files.push({ path: `${reelSandboxRoot}/${sandboxPath}`, content: bytes });
    attachmentIds.add(row.attachmentId);
  }
  const manifestJson = JSON.stringify({
    schemaVersion: reelSandboxAssetSchemaVersion,
    authoritySha256: sha256(authorityJson),
    assets,
  });
  if (Buffer.byteLength(manifestJson, 'utf8') > reelSandboxManifestMaxBytes) {
    throw new RenderJobError('REEL_RENDER_MEDIA_INVALID', 400);
  }
  files.push({ path: reelSandboxManifestPath, content: manifestJson });
  return { files };
}

async function runnerFailure(sandbox, outputRoot) {
  const errorPath = join(outputRoot, 'error.json');
  try {
    await downloadRequired(sandbox, reelSandboxErrorPath, errorPath);
    await assertFileSize(errorPath, 1, 256);
    const value = JSON.parse(await readFile(errorPath, 'utf8'));
    if (plainObject(value) && Object.keys(value).join(',') === 'code' && deterministicErrors.has(value.code)) {
      return new RenderJobError(value.code, 400);
    }
  } catch {
    // An absent or malformed safe error envelope is an infrastructure failure.
  }
  return serviceUnavailable();
}

async function downloadRequired(sandbox, sandboxPath, localPath) {
  const result = await sandbox.downloadFile({ path: sandboxPath }, { path: localPath }, { mkdirRecursive: true });
  if (!result) throw serviceUnavailable();
}

async function assertFileSize(path, minimum, maximum, code = 'REEL_RENDER_OUTPUT_INVALID') {
  const value = await stat(path).catch(() => { throw new RenderJobError(code, 400); });
  if (!value.isFile() || !Number.isSafeInteger(value.size) || value.size < minimum || value.size > maximum) {
    throw new RenderJobError(code, 400);
  }
  return value.size;
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function mapSandboxError(error) {
  if (error instanceof RenderJobError) return error;
  return serviceUnavailable();
}

function serviceUnavailable() {
  return new RenderJobError('REEL_RENDER_SERVICE_UNAVAILABLE', 503);
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
