import sharp from 'sharp';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { frameSvg, timeline } from '../../src/features/reel-editor/presentation.js';
import { requireAuthorizedReelPlan } from './authorization.js';
import { ReelRenderError } from './errors.js';
import { validateRenderedVideo } from './probe.js';

// Rasterize the exact shared SVG at the output size. No zoompan, integer moving
// crop, subsampled working raster, or independent text/motion timeline is used.
export async function renderEditorReel({ authorized, stagedAssets, stagingRoot, ffmpegBin = 'ffmpeg', ffprobeBin = 'ffprobe', timeoutMs = 210000, validate = validateRenderedVideo }) {
  const snapshot = requireAuthorizedReelPlan(authorized);
  if (snapshot.schemaVersion !== 'reel-manager-plan-v2') throw new ReelRenderError('REEL_RENDER_INVALID_PLAN');
  // Explicit registration is necessary on Windows: merely naming a font in SVG
  // can silently fall back to serif even with a FONTCONFIG_FILE. Legacy fonts
  // keep the system configuration; only the new profile explicitly registers this font.
  await sharp({ text: { text: 'Font registration', font: 'DejaVu Sans 58', fontfile: fileURLToPath(new URL('../../public/reel-editor/fonts/DejaVuSans.ttf', import.meta.url)) } }).png().toBuffer();
  const expected = new Map(snapshot.media.map(m => [m.attachmentId, m]));
  if (stagedAssets.length !== expected.size) throw new ReelRenderError('REEL_RENDER_MEDIA_INVALID');
  const media = new Map();
  for (const row of stagedAssets) {
    const asset = expected.get(row.attachmentId), path = resolve(stagingRoot, row.path);
    if (!asset || !path.startsWith(resolve(stagingRoot) + sep) || media.has(row.attachmentId)) throw new ReelRenderError('REEL_RENDER_MEDIA_INVALID');
    const bytes = await readFile(path);
    if (createHash('sha256').update(bytes).digest('hex') !== asset.identity) throw new ReelRenderError('REEL_RENDER_MEDIA_INVALID');
    const normalized = await sharp(bytes).rotate().toColourspace('srgb').png().toBuffer();
    media.set(row.attachmentId, { ...asset, url: `data:image/png;base64,${normalized.toString('base64')}` });
  }
  const output = await mkdtemp(join(tmpdir(), 'servicescope-editor-export-'));
  const videoPath = join(output, 'reel.mp4'), coverPath = join(output, 'cover.jpg');
  const frames = timeline(snapshot.draft).frames;
  const child = spawn(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', '1080x1920', '-framerate', '30', '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-threads', '1', '-movflags', '+faststart', videoPath], { shell: false, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  let failed = null, timedOut = false;
  child.on('error', e => { failed = e; }); child.stdin.on('error', e => { failed = e; }); child.stderr.resume();
  const closed = new Promise(resolve => child.once('close', code => resolve(code)));
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  try {
    for (let frame = 0; frame < frames; frame++) {
      if (failed || timedOut) throw new ReelRenderError(timedOut ? 'REEL_RENDER_TIMEOUT' : 'REEL_RENDER_FAILED');
      const svg = Buffer.from(frameSvg(snapshot.draft, media, frame));
      const raster = sharp(svg);
      if (frame === 0) await raster.clone().jpeg({ quality: 92 }).toFile(coverPath);
      const bytes = await raster.removeAlpha().raw().toBuffer();
      if (!child.stdin.write(bytes)) await Promise.race([once(child.stdin, 'drain'), closed.then(() => { throw new ReelRenderError('REEL_RENDER_FAILED'); })]);
    }
    child.stdin.end();
    if (await closed !== 0 || failed || timedOut) throw new ReelRenderError(timedOut ? 'REEL_RENDER_TIMEOUT' : 'REEL_RENDER_FAILED');
    const metadata = await validate(videoPath, frames / 30 * 1000, ffprobeBin, timeoutMs);
    return { ...metadata, videoPath, coverPath, coverFileSize: (await stat(coverPath)).size, dispose: () => rm(output, { recursive: true, force: true }) };
  } catch (error) { child.kill('SIGKILL'); await closed; await rm(output, { recursive: true, force: true }); throw error; }
  finally { clearTimeout(timer); }
}
