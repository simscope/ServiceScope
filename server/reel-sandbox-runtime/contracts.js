import { reelRendererVersion } from '../reel-render-jobs/contracts.js';

export const reelSandboxSessionTimeoutMs = 240_000;
export const reelSandboxRenderTimeoutMs = 210_000;
export const reelSandboxAuthorityMaxBytes = 1_000_000;
export const reelSandboxManifestMaxBytes = 16_000;
export const reelSandboxResultMaxBytes = 4_096;
export const reelSandboxVideoMaxBytes = 64 * 1024 * 1024;
export const reelSandboxCoverMaxBytes = 8 * 1024 * 1024;
export const reelSandboxRoot = '/vercel/sandbox/reel';
export const reelSandboxRunnerPath = '/app/server/reel-sandbox-runner/run.mjs';
export const reelSandboxAuthorityPath = `${reelSandboxRoot}/authority.json`;
export const reelSandboxManifestPath = `${reelSandboxRoot}/assets.json`;
export const reelSandboxOutputDir = `${reelSandboxRoot}/output`;
export const reelSandboxResultPath = `${reelSandboxOutputDir}/result.json`;
export const reelSandboxErrorPath = `${reelSandboxOutputDir}/error.json`;
export const reelSandboxVideoPath = `${reelSandboxOutputDir}/reel.mp4`;
export const reelSandboxCoverPath = `${reelSandboxOutputDir}/cover.jpg`;
export const reelSandboxAssetSchemaVersion = 'reel-sandbox-assets-v1';

const authorityFields = ['context', 'plan'];
const manifestFields = ['assets', 'authoritySha256', 'schemaVersion'];
const assetFields = ['attachmentId', 'path', 'sha256', 'size'];
export const reelSandboxResultFields = Object.freeze([
  'rendererVersion', 'durationMs', 'width', 'height', 'fps', 'videoCodec',
  'pixelFormat', 'audioStreams', 'fileSize', 'faststart', 'videoSha256', 'coverSha256',
]);

export function parseSandboxAuthorityJson(text) {
  const value = boundedJson(text, reelSandboxAuthorityMaxBytes, 'REEL_RENDER_INVALID_PLAN');
  exactFields(value, authorityFields, 'REEL_RENDER_INVALID_PLAN');
  if (!plainObject(value.plan) || !plainObject(value.context)) fail('REEL_RENDER_INVALID_PLAN');
  return value;
}

export function parseSandboxAssetManifestJson(text) {
  const value = boundedJson(text, reelSandboxManifestMaxBytes, 'REEL_RENDER_MEDIA_INVALID');
  exactFields(value, manifestFields, 'REEL_RENDER_MEDIA_INVALID');
  if (value.schemaVersion !== reelSandboxAssetSchemaVersion || !sha(value.authoritySha256) || !Array.isArray(value.assets)
    || value.assets.length < 1 || value.assets.length > 4) fail('REEL_RENDER_MEDIA_INVALID');
  const ids = new Set();
  const assets = value.assets.map((row, index) => {
    exactFields(row, assetFields, 'REEL_RENDER_MEDIA_INVALID');
    const expectedPath = `input/asset-${index + 1}.bin`;
    if (typeof row.attachmentId !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(row.attachmentId)
      || ids.has(row.attachmentId) || row.path !== expectedPath
      || !Number.isSafeInteger(row.size) || row.size < 1 || row.size > 12_000_000
      || typeof row.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.sha256)) {
      fail('REEL_RENDER_MEDIA_INVALID');
    }
    ids.add(row.attachmentId);
    return row;
  });
  return { assets, authoritySha256: value.authoritySha256 };
}

export function parseSandboxResultJson(text) {
  const value = boundedJson(text, reelSandboxResultMaxBytes, 'REEL_RENDER_OUTPUT_INVALID');
  exactFields(value, [...reelSandboxResultFields].sort(), 'REEL_RENDER_OUTPUT_INVALID');
  if (value.rendererVersion !== reelRendererVersion
    || !integer(value.durationMs, 1, 30_000)
    || value.width !== 1080 || value.height !== 1920 || value.fps !== 30
    || value.videoCodec !== 'h264' || value.pixelFormat !== 'yuv420p'
    || value.audioStreams !== 0 || !integer(value.fileSize, 20_000, reelSandboxVideoMaxBytes)
    || value.faststart !== true
    || !sha(value.videoSha256) || !sha(value.coverSha256)) {
    fail('REEL_RENDER_OUTPUT_INVALID');
  }
  return value;
}

export function assertImmutableSandboxImage(value) {
  if (typeof value !== 'string' || value !== value.trim()
    || !/^(?:vcr\.vercel\.com\/[a-z0-9._-]+\/[a-z0-9._-]+\/)?servicescope-reel-renderer:v2-[0-9a-f]{40}$/.test(value)) {
    fail('REEL_RENDER_SERVICE_UNAVAILABLE');
  }
  return value;
}

function boundedJson(text, maxBytes, code) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > maxBytes) fail(code);
  try {
    return JSON.parse(text);
  } catch {
    fail(code);
  }
}

function exactFields(value, fields, code) {
  if (!plainObject(value) || Object.keys(value).sort().join(',') !== fields.join(',')) fail(code);
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function integer(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function sha(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
