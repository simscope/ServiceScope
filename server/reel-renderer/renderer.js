import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reelPresentationSpec } from '../../src/features/reel-director/presentationSpec.js';
import { normalizeStagedAssets } from './assets.js';
import { asReelRenderError, ReelRenderError } from './errors.js';
import { buildReelRenderManifest } from './manifest.js';
import { renderBrandCard, renderCover, renderSceneOverlay } from './overlays.js';
import { validateRenderedVideo } from './probe.js';
import { runBinary } from './process.js';

export async function renderReel({
  plan,
  stagedAssets,
  stagingRoot,
  ffmpegBin = process.env.FFMPEG_BIN || 'ffmpeg',
  ffprobeBin = process.env.FFPROBE_BIN || 'ffprobe',
  timeoutMs = 240_000,
}) {
  let manifest;
  let sourcePaths;
  try {
    ({ manifest, sourcePaths } = buildReelRenderManifest(plan, stagedAssets));
  } catch (error) {
    throw asReelRenderError(error);
  }
  const outputDir = await mkdtemp(join(tmpdir(), 'servicescope-reel-output-'));
  let workDir;
  let succeeded = false;
  try {
    workDir = await mkdtemp(join(tmpdir(), 'servicescope-reel-work-'));
    const normalized = await normalizeStagedAssets(sourcePaths, stagingRoot, workDir);
    const overlays = [];
    for (const scene of manifest.scenes) {
      const overlayPath = join(workDir, `overlay-${scene.position}.png`);
      await renderSceneOverlay(scene, overlayPath);
      overlays.push(overlayPath);
    }
    let brandPath;
    if (manifest.brand.enabled) {
      brandPath = join(workDir, 'brand.png');
      await renderBrandCard(manifest.brand, brandPath);
    }
    const videoPath = join(outputDir, `reel-${crypto.randomUUID()}.mp4`);
    const coverPath = join(outputDir, `cover-${crypto.randomUUID()}.jpg`);
    await renderCover(normalized.get(manifest.cover.sourceKey), manifest.cover.title, coverPath);
    const { args } = buildFfmpegArgs({ manifest, normalized, overlays, brandPath, videoPath });
    await runBinary(ffmpegBin, args, { timeoutMs });
    const metadata = await validateRenderedVideo(videoPath, manifest.durationMs, ffprobeBin, Math.min(timeoutMs, 60_000));
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
}

export function buildFfmpegArgs({ manifest, normalized, overlays, brandPath, videoPath }) {
  if (!manifest?.scenes?.length || overlays.length !== manifest.scenes.length) throw new ReelRenderError('REEL_RENDER_INVALID_PLAN');
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  const filters = [];
  const clips = [];
  let inputIndex = 0;
  for (let index = 0; index < manifest.scenes.length; index += 1) {
    const scene = manifest.scenes[index];
    const incomingMs = index === 0 ? 0 : (manifest.scenes[index - 1].transition?.durationMs ?? 0);
    const clipDurationMs = scene.durationMs + incomingMs;
    const imageIndex = inputIndex++;
    const overlayIndex = inputIndex++;
    args.push(...loopedInput(normalized.get(scene.sourceKey), clipDurationMs));
    args.push(...loopedInput(overlays[index], clipDurationMs));
    const baseLabel = `base${index}`;
    const overlayLabel = `overlay${index}`;
    const clipLabel = `clip${index}`;
    filters.push(`[${imageIndex}:v]${motionFilter(scene, incomingMs)},settb=AVTB[${baseLabel}]`);
    const textStartSeconds = (incomingMs + reelPresentationSpec.textFadeMs) / 1000;
    filters.push(`[${overlayIndex}:v]format=rgba,fade=t=in:st=${decimal(textStartSeconds - reelPresentationSpec.textFadeMs / 1000)}:d=${decimal(reelPresentationSpec.textFadeMs / 1000)}:alpha=1,trim=duration=${seconds(clipDurationMs)},setpts=PTS-STARTPTS,settb=AVTB[${overlayLabel}]`);
    filters.push(`[${baseLabel}][${overlayLabel}]overlay=0:0:shortest=1,format=yuv420p[${clipLabel}]`);
    clips.push({ label: clipLabel, durationMs: scene.durationMs, incomingMs });
  }

  if (manifest.brand.enabled) {
    const incomingMs = manifest.scenes.at(-1).transition?.durationMs ?? 0;
    const clipDurationMs = manifest.brand.durationMs + incomingMs;
    const brandIndex = inputIndex++;
    args.push(...loopedInput(brandPath, clipDurationMs));
    filters.push(`[${brandIndex}:v]fps=${reelPresentationSpec.fps},scale=${reelPresentationSpec.width}:${reelPresentationSpec.height},setsar=1,format=yuv420p,trim=duration=${seconds(clipDurationMs)},setpts=PTS-STARTPTS,settb=AVTB[brandclip]`);
    clips.push({ label: 'brandclip', durationMs: manifest.brand.durationMs, incomingMs });
  }

  let currentLabel = clips[0].label;
  let currentDurationMs = clips[0].durationMs;
  for (let index = 1; index < clips.length; index += 1) {
    const clip = clips[index];
    const outputLabel = `joined${index}`;
    if (clip.incomingMs > 0) {
      const transition = manifest.scenes[index - 1].transition;
      const ffmpegTransition = reelPresentationSpec.transitions[transition.kind].ffmpeg;
      filters.push(`[${currentLabel}][${clip.label}]xfade=transition=${ffmpegTransition}:duration=${seconds(clip.incomingMs)}:offset=${seconds(currentDurationMs - clip.incomingMs)}[${outputLabel}]`);
    } else {
      filters.push(`[${currentLabel}][${clip.label}]concat=n=2:v=1:a=0[${outputLabel}]`);
    }
    currentLabel = outputLabel;
    currentDurationMs += clip.durationMs;
  }
  filters.push(`[${currentLabel}]trim=duration=${seconds(manifest.durationMs)},setpts=PTS-STARTPTS,fps=${reelPresentationSpec.fps},format=yuv420p[outv]`);
  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[outv]',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-r', String(reelPresentationSpec.fps),
    '-movflags', '+faststart',
    videoPath,
  );
  return { args, filterGraph: filters.join(';') };
}

function loopedInput(path, durationMs) {
  if (typeof path !== 'string' || !path) throw new ReelRenderError('REEL_RENDER_MEDIA_MISSING');
  return ['-loop', '1', '-framerate', String(reelPresentationSpec.fps), '-t', seconds(durationMs), '-i', path];
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
  return `scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=${reelPresentationSpec.width}x${reelPresentationSpec.height}:fps=${reelPresentationSpec.fps},trim=duration=${seconds(scene.durationMs + incomingMs)},setpts=PTS-STARTPTS,setsar=1`;
}

function seconds(milliseconds) {
  return decimal(milliseconds / 1000);
}

function decimal(value) {
  return Number(value.toFixed(6)).toString();
}
