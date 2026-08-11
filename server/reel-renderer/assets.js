import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { ReelRenderError } from './errors.js';
import { reelWorkingRaster } from './runtimeSpec.js';

const supportedFormats = new Set(['jpeg', 'png', 'webp']);
const maxInputPixels = 40_000_000;
const maxDimension = 12_000;

export async function normalizeStagedAssets(sourcePaths, stagingRoot, workDir) {
  if (!isAbsolute(stagingRoot)) throw new ReelRenderError('REEL_RENDER_MEDIA_INVALID');
  const root = await realpath(stagingRoot).catch(() => { throw new ReelRenderError('REEL_RENDER_MEDIA_MISSING'); });
  const normalized = new Map();
  let index = 0;
  for (const [sourceKey, requestedPath] of sourcePaths) {
    const candidate = await resolveStagedPath(root, requestedPath);
    const info = await stat(candidate).catch(() => { throw new ReelRenderError('REEL_RENDER_MEDIA_MISSING'); });
    if (!info.isFile()) throw new ReelRenderError('REEL_RENDER_MEDIA_INVALID');
    const pipeline = sharp(candidate, { failOn: 'error', limitInputPixels: maxInputPixels, sequentialRead: true });
    const metadata = await pipeline.metadata().catch(() => { throw new ReelRenderError('REEL_RENDER_MEDIA_INVALID'); });
    if (!supportedFormats.has(metadata.format) || !metadata.width || !metadata.height
      || metadata.width > maxDimension || metadata.height > maxDimension
      || metadata.width * metadata.height > maxInputPixels) {
      throw new ReelRenderError('REEL_RENDER_MEDIA_INVALID');
    }
    const outputPath = resolve(workDir, `normalized-${++index}.jpg`);
    await pipeline
      .rotate()
      .flatten({ background: '#101820' })
      .resize({ ...reelWorkingRaster, fit: 'inside', withoutEnlargement: false })
      .jpeg({ quality: 92, chromaSubsampling: '4:2:0' })
      .toFile(outputPath)
      .catch(() => { throw new ReelRenderError('REEL_RENDER_MEDIA_INVALID'); });
    normalized.set(sourceKey, outputPath);
  }
  return normalized;
}

async function resolveStagedPath(root, requestedPath) {
  if (/^(?:https?|file):/i.test(requestedPath)) throw new ReelRenderError('REEL_RENDER_MEDIA_INVALID');
  const candidate = resolve(root, requestedPath);
  const resolved = await realpath(candidate).catch(() => { throw new ReelRenderError('REEL_RENDER_MEDIA_MISSING'); });
  const relation = relative(root, resolved);
  if (!relation || relation === '..' || relation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(relation)) {
    if (resolved !== root) throw new ReelRenderError('REEL_RENDER_MEDIA_INVALID');
  }
  return resolved;
}
