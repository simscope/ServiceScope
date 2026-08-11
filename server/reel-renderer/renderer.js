import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { reelPresentationSpec } from '../../src/features/reel-director/presentationSpec.js';
import { normalizeStagedAssets } from './assets.js';
import { asReelRenderError, ReelRenderError } from './errors.js';
import { buildReelRenderManifest } from './manifest.js';
import { renderBrandCard, renderCover, renderSceneOverlay } from './overlays.js';
import { validateRenderedVideo } from './probe.js';
import { runBinary } from './process.js';
import { reelWorkingRaster } from './runtimeSpec.js';

export const reelIntermediateSpec = Object.freeze({
  width: 1080,
  height: 1920,
  fps: 30,
  codec: 'libx264',
  preset: 'ultrafast',
  crf: 10,
  pixelFormat: 'yuv420p',
  threads: 1,
});
export const reelMaxAggregateIntermediateBytes = 180_000_000;

export function createReelRenderer({
  execute = runBinary,
  validate = validateRenderedVideo,
  buildManifest = buildReelRenderManifest,
  normalize = normalizeStagedAssets,
  renderOverlay = renderSceneOverlay,
  renderBrand = renderBrandCard,
  renderCoverImage = renderCover,
  fileStat = stat,
  now = () => performance.now(),
  onStageChange = () => {},
} = {}) {
  return async function render({
    authorized,
    stagedAssets,
    stagingRoot,
    ffmpegBin = process.env.FFMPEG_BIN || 'ffmpeg',
    ffprobeBin = process.env.FFPROBE_BIN || 'ffprobe',
    timeoutMs = 240_000,
  }) {
    const deadline = now() + timeoutMs;
    let manifest;
    let sourcePaths;
    try {
      ({ manifest, sourcePaths } = buildManifest(authorized, stagedAssets));
    } catch (error) {
      throw asReelRenderError(error);
    }
    const outputDir = await mkdtemp(join(tmpdir(), 'servicescope-reel-output-'));
    let workDir;
    let succeeded = false;
    try {
      workDir = await mkdtemp(join(tmpdir(), 'servicescope-reel-work-'));
      const normalized = await observeStage(onStageChange, { stage: 'normalization' },
        () => normalize(sourcePaths, stagingRoot, workDir));
      const overlays = [];
      for (const scene of manifest.scenes) {
        const overlayPath = join(workDir, `overlay-${scene.position}.png`);
        await renderOverlay(scene, overlayPath);
        overlays.push(overlayPath);
      }
      let brandPath;
      if (manifest.brand.enabled) {
        brandPath = join(workDir, 'brand.png');
        await renderBrand(manifest.brand, brandPath);
      }
      const videoPath = join(outputDir, `reel-${crypto.randomUUID()}.mp4`);
      const coverPath = join(outputDir, `cover-${crypto.randomUUID()}.jpg`);
      await renderCoverImage(normalized.get(manifest.cover.sourceKey), manifest.cover.title, coverPath);

      const clips = [];
      let aggregateIntermediateBytes = 0;
      for (let index = 0; index < manifest.scenes.length; index += 1) {
        const scene = manifest.scenes[index];
        const incomingMs = index === 0 ? 0 : (manifest.scenes[index - 1].transition?.durationMs ?? 0);
        const clipPath = join(workDir, `scene-${scene.position}.mp4`);
        const { args } = buildSceneClipArgs({
          scene,
          incomingMs,
          normalizedPath: normalized.get(scene.sourceKey),
          overlayPath: overlays[index],
          clipPath,
        });
        await observeStage(onStageChange, { stage: 'scene', position: scene.position },
          () => execute(ffmpegBin, args, { timeoutMs: remainingBudget(deadline, now) }));
        const size = await intermediateSize(fileStat, clipPath);
        aggregateIntermediateBytes += size;
        assertIntermediateAggregate(aggregateIntermediateBytes);
        onStageChange({ stage: 'scene', position: scene.position, phase: 'artifact', bytes: size, aggregateIntermediateBytes });
        clips.push({
          path: clipPath,
          durationMs: scene.durationMs,
          incomingMs,
          transitionKind: index === 0 ? 'cut' : (manifest.scenes[index - 1].transition?.kind ?? 'cut'),
        });
      }

      if (manifest.brand.enabled) {
        const incomingMs = manifest.scenes.at(-1).transition?.durationMs ?? 0;
        const clipPath = join(workDir, 'brand.mp4');
        const { args } = buildBrandClipArgs({ brandPath, durationMs: manifest.brand.durationMs, incomingMs, clipPath });
        await observeStage(onStageChange, { stage: 'brand' },
          () => execute(ffmpegBin, args, { timeoutMs: remainingBudget(deadline, now) }));
        const size = await intermediateSize(fileStat, clipPath);
        aggregateIntermediateBytes += size;
        assertIntermediateAggregate(aggregateIntermediateBytes);
        onStageChange({ stage: 'brand', phase: 'artifact', bytes: size, aggregateIntermediateBytes });
        clips.push({
          path: clipPath,
          durationMs: manifest.brand.durationMs,
          incomingMs,
          transitionKind: manifest.scenes.at(-1).transition?.kind ?? 'cut',
        });
      }

      const { args } = buildFinalComposeArgs({ clips, durationMs: manifest.durationMs, videoPath });
      await observeStage(onStageChange, { stage: 'final-compose' },
        () => execute(ffmpegBin, args, { timeoutMs: remainingBudget(deadline, now) }));
      const metadata = await observeStage(onStageChange, { stage: 'validation' },
        () => validate(videoPath, manifest.durationMs, ffprobeBin, Math.min(remainingBudget(deadline, now), 60_000), execute));
      succeeded = true;
      return {
        videoPath,
        coverPath,
        durationMs: metadata.durationMs,
        width: metadata.width,
        height: metadata.height,
        fps: metadata.fps,
        videoCodec: metadata.videoCodec,
        pixelFormat: metadata.pixelFormat,
        audioStreams: metadata.audioStreams,
        fileSize: metadata.fileSize,
        faststart: metadata.faststart,
        async dispose() {
          await rm(outputDir, { recursive: true, force: true });
        },
      };
    } catch (error) {
      throw asReelRenderError(error);
    } finally {
      if (workDir) await rm(workDir, { recursive: true, force: true });
      if (!succeeded) await rm(outputDir, { recursive: true, force: true });
    }
  };
}

export const renderAuthorizedReel = createReelRenderer();

export function buildSceneClipArgs({ scene, incomingMs, normalizedPath, overlayPath, clipPath }) {
  if (!scene || !Number.isInteger(incomingMs) || incomingMs < 0) throw new ReelRenderError('REEL_RENDER_INVALID_PLAN');
  const clipDurationMs = scene.durationMs + incomingMs;
  const args = ffmpegBaseArgs();
  args.push(...loopedInput(normalizedPath, clipDurationMs));
  args.push(...loopedInput(overlayPath, clipDurationMs));
  const filters = [
    `[0:v]${motionFilter(scene, incomingMs)},settb=AVTB[base]`,
    `[1:v]format=rgba,fade=t=in:st=${seconds(incomingMs)}:d=${decimal(reelPresentationSpec.textFadeMs / 1000)}:alpha=1,trim=duration=${seconds(clipDurationMs)},setpts=PTS-STARTPTS,settb=AVTB[overlay]`,
    '[base][overlay]overlay=0:0:shortest=1,format=yuv420p[outv]',
  ];
  args.push('-filter_complex', filters.join(';'), ...intermediateEncodingArgs(clipPath));
  return { args, filterGraph: filters.join(';'), incomingMs, clipDurationMs };
}

export function buildBrandClipArgs({ brandPath, durationMs, incomingMs, clipPath }) {
  if (!Number.isInteger(durationMs) || durationMs <= 0 || !Number.isInteger(incomingMs) || incomingMs < 0) {
    throw new ReelRenderError('REEL_RENDER_INVALID_PLAN');
  }
  const clipDurationMs = durationMs + incomingMs;
  const args = ffmpegBaseArgs();
  args.push(...loopedInput(brandPath, clipDurationMs));
  const filterGraph = `[0:v]fps=${reelPresentationSpec.fps},scale=${reelPresentationSpec.width}:${reelPresentationSpec.height},setsar=1,format=yuv420p,trim=duration=${seconds(clipDurationMs)},setpts=PTS-STARTPTS,settb=AVTB[outv]`;
  args.push('-filter_complex', filterGraph, ...intermediateEncodingArgs(clipPath));
  return { args, filterGraph, incomingMs, clipDurationMs };
}

export function buildFinalComposeArgs({ clips, durationMs, videoPath }) {
  if (!Array.isArray(clips) || clips.length < 1 || !Number.isInteger(durationMs) || durationMs <= 0) {
    throw new ReelRenderError('REEL_RENDER_INVALID_PLAN');
  }
  const args = ffmpegBaseArgs();
  const filters = [];
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    localPath(clip.path);
    if (!Number.isInteger(clip.durationMs) || clip.durationMs <= 0 || !Number.isInteger(clip.incomingMs) || clip.incomingMs < 0) {
      throw new ReelRenderError('REEL_RENDER_INVALID_PLAN');
    }
    args.push('-threads', '1', '-i', clip.path);
    filters.push(`[${index}:v]fps=${reelPresentationSpec.fps},scale=${reelPresentationSpec.width}:${reelPresentationSpec.height},setsar=1,format=yuv420p,setpts=PTS-STARTPTS,settb=AVTB[clip${index}]`);
  }
  let currentLabel = 'clip0';
  let currentDurationMs = clips[0].durationMs;
  for (let index = 1; index < clips.length; index += 1) {
    const clip = clips[index];
    const outputLabel = `joined${index}`;
    if (clip.incomingMs > 0) {
      const transition = reelPresentationSpec.transitions[clip.transitionKind];
      if (!transition || transition.durationMs !== clip.incomingMs || transition.ffmpeg === 'none') {
        throw new ReelRenderError('REEL_RENDER_INVALID_PLAN');
      }
      filters.push(`[${currentLabel}][clip${index}]xfade=transition=${transition.ffmpeg}:duration=${seconds(clip.incomingMs)}:offset=${seconds(currentDurationMs - clip.incomingMs)}[${outputLabel}]`);
    } else {
      filters.push(`[${currentLabel}][clip${index}]concat=n=2:v=1:a=0[${outputLabel}]`);
    }
    currentLabel = outputLabel;
    currentDurationMs += clip.durationMs;
  }
  filters.push(`[${currentLabel}]trim=duration=${seconds(durationMs)},setpts=PTS-STARTPTS,fps=${reelPresentationSpec.fps},format=yuv420p[outv]`);
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[outv]',
    '-an',
    '-c:v', 'libx264',
    '-threads', '1',
    '-preset', 'medium',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-r', String(reelPresentationSpec.fps),
    '-movflags', '+faststart',
    localPath(videoPath),
  );
  return { args, filterGraph: filters.join(';') };
}

function ffmpegBaseArgs() {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-filter_complex_threads', '1'];
}

function intermediateEncodingArgs(outputPath) {
  return [
    '-map', '[outv]',
    '-an',
    '-c:v', reelIntermediateSpec.codec,
    '-threads', String(reelIntermediateSpec.threads),
    '-preset', reelIntermediateSpec.preset,
    '-crf', String(reelIntermediateSpec.crf),
    '-pix_fmt', reelIntermediateSpec.pixelFormat,
    '-r', String(reelIntermediateSpec.fps),
    localPath(outputPath),
  ];
}

function loopedInput(path, durationMs) {
  return ['-loop', '1', '-framerate', String(reelPresentationSpec.fps), '-t', seconds(durationMs), '-i', localPath(path)];
}

function localPath(path) {
  if (typeof path !== 'string' || !path || /^(?:https?|file):/i.test(path)) {
    throw new ReelRenderError('REEL_RENDER_MEDIA_INVALID');
  }
  return path;
}

function motionFilter(scene, incomingMs) {
  const motion = reelPresentationSpec.motions[scene.motionPreset];
  const crop = reelPresentationSpec.crops[scene.cropStrategy];
  if (!motion || !crop) throw new ReelRenderError('REEL_RENDER_INVALID_PLAN');
  const frames = Math.max(2, Math.round(scene.durationMs * reelPresentationSpec.fps / 1000));
  const incomingFrames = Math.round(incomingMs * reelPresentationSpec.fps / 1000);
  const startScale = crop.scale * motion.startScale;
  const scaleDelta = crop.scale * (motion.endScale - motion.startScale);
  const startX = crop.x + motion.startX;
  const deltaX = motion.endX - motion.startX;
  const startY = crop.y + motion.startY;
  const deltaY = motion.endY - motion.startY;
  const progress = incomingFrames ? `max(0\\,on-${incomingFrames})/${frames - 1}` : `on/${frames - 1}`;
  const zoom = `${decimal(startScale)}+${decimal(scaleDelta)}*${progress}`;
  const x = `iw/2-(iw/zoom/2)-iw*(${decimal(startX)}+${decimal(deltaX)}*${progress})`;
  const y = `ih/2-(ih/zoom/2)-ih*(${decimal(startY)}+${decimal(deltaY)}*${progress})`;
  return `scale=${reelWorkingRaster.width}:${reelWorkingRaster.height}:force_original_aspect_ratio=increase,crop=${reelWorkingRaster.width}:${reelWorkingRaster.height},zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=${reelPresentationSpec.width}x${reelPresentationSpec.height}:fps=${reelPresentationSpec.fps},trim=duration=${seconds(scene.durationMs + incomingMs)},setpts=PTS-STARTPTS,setsar=1`;
}

function remainingBudget(deadline, now) {
  const remaining = Math.floor(deadline - now());
  if (!Number.isFinite(remaining) || remaining <= 0) throw new ReelRenderError('REEL_RENDER_TIMEOUT');
  return remaining;
}

async function intermediateSize(fileStat, path) {
  const file = await fileStat(path).catch(() => { throw new ReelRenderError('REEL_RENDER_OUTPUT_INVALID'); });
  if (!Number.isSafeInteger(file?.size) || file.size <= 0) throw new ReelRenderError('REEL_RENDER_OUTPUT_INVALID');
  return file.size;
}

function assertIntermediateAggregate(bytes) {
  if (bytes > reelMaxAggregateIntermediateBytes) throw new ReelRenderError('REEL_RENDER_OUTPUT_INVALID');
}

async function observeStage(observer, details, operation) {
  observer({ ...details, phase: 'start' });
  try {
    return await operation();
  } finally {
    observer({ ...details, phase: 'end' });
  }
}

function seconds(milliseconds) {
  return decimal(milliseconds / 1000);
}

function decimal(value) {
  return Number(value.toFixed(6)).toString();
}
