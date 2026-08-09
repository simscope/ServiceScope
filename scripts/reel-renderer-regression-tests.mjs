import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { activeReelFrame, buildReelTimeline, reelMotionFrame, reelPresentationSpec, reelSafeZonePixels } from '../src/features/reel-director/presentationSpec.js';
import { buildFfmpegArgs, buildReelRenderManifest, escapeXml, renderReel } from '../server/reel-renderer/index.js';
import { runBinary } from '../server/reel-renderer/process.js';

let checks = 0;
function check(fn) { fn(); checks += 1; }
async function checkAsync(fn) { await fn(); checks += 1; }

const validPlan = {
  schemaVersion: 'reel-creative-plan-v1',
  revision: 'reel-v1-fixture',
  decision: 'create_reel',
  qualityScore: 88,
  qualityReasons: ['Clear service story with distinct visual coverage.'],
  marketingAngle: 'repair_process',
  hook: { text: 'See this service transformation', evidenceIds: ['diagnosis'] },
  cover: { title: 'Service transformation', attachmentId: 'photo-a' },
  scenes: [
    scene('scene-1', 1, 'photo-a', 4_000, 'See this service transformation', 'A clear starting point', 'slow_zoom_in', 'cover_center', 'crossfade'),
    scene('scene-2', 2, 'photo-b', 4_000, 'Careful work in progress', 'A controlled service sequence', 'pan_left', 'subject_center', 'quick_fade'),
    scene('scene-3', 3, 'photo-c', 4_000, 'Ready for the next call', 'The finished equipment view', 'focus_detail', 'detail_crop', 'crossfade'),
  ],
  caption: { text: 'A clear service story built from the approved job media, from the starting view through the work and the finished equipment.', evidenceIds: ['diagnosis'] },
  voiceover: { enabled: false, script: '', evidenceIds: [] },
  missingShots: [],
  claims: [{ id: 'claim-1', text: 'Service transformation', evidenceIds: ['diagnosis'] }],
  safety: { ok: true, privacy: 'passed', grounding: 'passed', quality: 'passed', blockedReasons: [] },
  brand: { enabled: true, displayName: 'Northstar Service', cta: 'Book dependable service', durationMs: 1_800, evidenceIds: ['company-public-display-name'] },
  audio: { musicMode: 'none' },
};
const stagedAssets = [
  { attachmentId: 'photo-a', path: 'photo-a.jpg' },
  { attachmentId: 'photo-b', path: 'photo-b.png' },
  { attachmentId: 'photo-c', path: 'photo-c.webp' },
];

const { manifest } = buildReelRenderManifest(validPlan, stagedAssets);
check(() => assert.equal(manifest.schemaVersion, 'reel-render-manifest-v1'));
check(() => assert.deepEqual([manifest.width, manifest.height, manifest.fps], [1080, 1920, 30]));
check(() => assert.equal(manifest.durationMs, 13_800));
check(() => assert.deepEqual(manifest.scenes.map((item) => [item.startMs, item.endMs]), [[0, 4_000], [4_000, 8_000], [8_000, 12_000]]));
check(() => assert.deepEqual([manifest.brand.startMs, manifest.brand.endMs], [12_000, 13_800]));
check(() => assert.deepEqual(manifest.scenes.map((item) => item.transition && [item.transition.startMs, item.transition.endMs]), [[3_550, 4_000], [7_750, 8_000], [11_550, 12_000]]));
check(() => assert.equal(manifest.scenes[0].overlayText, validPlan.hook.text));
check(() => assert.equal(manifest.brand.durationMs, validPlan.brand.durationMs));
check(() => assert.equal(manifest.cover.sourceKey, manifest.scenes[0].sourceKey));
check(() => assert.doesNotMatch(JSON.stringify(manifest), /photo-[abc]|\.jpg|\.png|\.webp|attachmentId|sceneRole|evidence|job|customer/i));

for (const mutate of [
  (plan) => { plan.schemaVersion = 'unknown'; },
  (plan) => { plan.scenes[0].motionPreset = 'spin'; },
  (plan) => { plan.scenes[0].cropStrategy = 'face_track'; },
  (plan) => { plan.scenes[0].transitionOut = 'wipe'; },
  (plan) => { plan.scenes[0].overlayText = 'Different first scene'; },
  (plan) => { plan.audio.musicMode = 'future_library'; },
]) {
  check(() => assert.throws(() => buildReelRenderManifest(mutatedPlan(mutate), stagedAssets), /REEL_RENDER_INVALID_PLAN/));
}
check(() => assert.throws(() => buildReelRenderManifest(validPlan, stagedAssets.slice(0, 2)), /REEL_RENDER_MEDIA_MISSING|REEL_RENDER_MEDIA_INVALID/));
check(() => assert.throws(() => buildReelRenderManifest(validPlan, [...stagedAssets, { attachmentId: 'extra', path: 'extra.jpg' }]), /REEL_RENDER_MEDIA_INVALID/));
check(() => assert.throws(() => buildReelRenderManifest(validPlan, [stagedAssets[0], stagedAssets[0], stagedAssets[2]]), /REEL_RENDER_MEDIA_INVALID/));
check(() => assert.throws(() => buildReelRenderManifest(validPlan, stagedAssets.map((item, index) => index === 0 ? { ...item, path: 'https://example.com/a.jpg' } : item)), /REEL_RENDER_MEDIA_INVALID/));

const timeline = buildReelTimeline(validPlan);
check(() => assert.equal(activeReelFrame(timeline, 0).item.scene.id, 'scene-1'));
check(() => assert.equal(activeReelFrame(timeline, 3_600).transition.kind, 'crossfade'));
check(() => assert.equal(activeReelFrame(timeline, 4_000).item.scene.id, 'scene-2'));
check(() => assert.equal(activeReelFrame(timeline, 12_000).item.kind, 'brand'));
check(() => assert.equal(activeReelFrame(timeline, 13_800).item.kind, 'brand'));
check(() => assert.ok(timeline.transitions.every((item) => item.startMs >= 0 && item.endMs > item.startMs)));
check(() => assert.deepEqual(reelSafeZonePixels(), { left: 86, top: 288, right: 918, bottom: 1574, width: 832, height: 1286 }));
check(() => assert.ok(reelMotionFrame('slow_zoom_in', 'cover_center', 1).scale > reelMotionFrame('slow_zoom_in', 'cover_center', 0).scale));
check(() => assert.ok(reelMotionFrame('pan_left', 'cover_center', 1).x < reelMotionFrame('pan_left', 'cover_center', 0).x));
check(() => assert.equal(reelMotionFrame('static', 'cover_center', 0.5).scale, 1));
check(() => assert.equal(reelPresentationSpec.textFadeMs, 180));

const fakeNormalized = new Map(manifest.scenes.map((item) => [item.sourceKey, `/staged/${item.sourceKey}.jpg`]));
const ffmpeg = buildFfmpegArgs({ manifest, normalized: fakeNormalized, overlays: manifest.scenes.map((_, index) => `/work/overlay-${index}.png`), brandPath: '/work/brand.png', videoPath: '/output/reel.mp4' });
check(() => assert.ok(ffmpeg.args.includes('libx264')));
check(() => assert.ok(ffmpeg.args.includes('yuv420p')));
check(() => assert.ok(ffmpeg.args.includes('+faststart')));
check(() => assert.ok(ffmpeg.args.includes('-an')));
check(() => assert.match(ffmpeg.filterGraph, /xfade=transition=fade:duration=0\.45/));
check(() => assert.match(ffmpeg.filterGraph, /xfade=transition=fadeblack:duration=0\.25/));
check(() => assert.match(ffmpeg.filterGraph, /iw\/2-\(iw\/zoom\/2\)-iw\*\(0\.035\+/));
check(() => assert.doesNotMatch(ffmpeg.filterGraph, /See this|Northstar|drawtext|photo-[abc]|Overview|Detail|Process|Part|Result|Context/));
check(() => assert.equal(escapeXml(`A&B <tag> "quote" 'single'`), 'A&amp;B &lt;tag&gt; &quot;quote&quot; &apos;single&apos;'));
await checkAsync(() => assert.rejects(runBinary(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 30 }), /REEL_RENDER_TIMEOUT/));

const fixtureRoot = await mkdtemp(join(tmpdir(), 'servicescope-renderer-fixture-'));
let rendered;
try {
  await createSyntheticImages(fixtureRoot);
  const tempBeforeFailures = await rendererTempEntries();
  await checkAsync(() => assert.rejects(
    renderReel({ plan: validPlan, stagedAssets: stagedAssets.map((item) => ({ ...item, path: '../outside.jpg' })), stagingRoot: fixtureRoot, ffmpegBin: 'missing-ffmpeg' }),
    /REEL_RENDER_MEDIA_MISSING|REEL_RENDER_MEDIA_INVALID/,
  ));
  for (const invalidPath of ['unsafe.svg', 'unsafe.pdf', 'malformed.jpg', 'too-wide.png']) {
    await checkAsync(() => assert.rejects(
      renderReel({
        plan: validPlan,
        stagedAssets: stagedAssets.map((item, index) => index === 0 ? { ...item, path: invalidPath } : item),
        stagingRoot: fixtureRoot,
        ffmpegBin: 'missing-ffmpeg',
      }),
      /REEL_RENDER_MEDIA_INVALID/,
    ));
  }
  await checkAsync(async () => assert.deepEqual(await rendererTempEntries(), tempBeforeFailures));
  const ffmpegBin = process.env.FFMPEG_BIN || 'ffmpeg';
  const ffprobeBin = process.env.FFPROBE_BIN || 'ffprobe';
  const available = binaryAvailable(ffmpegBin) && binaryAvailable(ffprobeBin);
  if (process.env.REEL_RENDER_REAL_FIXTURE === '1' && !available) throw new Error('REAL_FFMPEG_FIXTURE_REQUIRED');
  if (available) {
    rendered = await renderReel({ plan: validPlan, stagedAssets, stagingRoot: fixtureRoot, ffmpegBin, ffprobeBin });
    await verifyRealRender(rendered);
    checks += 12;
    if (process.env.REEL_RENDER_ARTIFACT_DIR) await publishArtifacts(rendered, process.env.REEL_RENDER_ARTIFACT_DIR, ffmpegBin);
    console.log(`Real Reel fixture rendered (${rendered.fileSize} MP4 bytes, ${rendered.durationMs}ms).`);
  } else {
    console.log('Real Reel fixture skipped locally: ffmpeg/ffprobe unavailable; CI requires it.');
  }
} finally {
  await rendered?.dispose();
  await rm(fixtureRoot, { recursive: true, force: true });
}

console.log(`Reel renderer regression tests passed (${checks}/${checks}).`);

function scene(id, position, attachmentId, durationMs, overlayText, secondaryText, motionPreset, cropStrategy, transitionOut) {
  return { id, position, attachmentId, sceneRole: position === 1 ? 'overview' : position === 2 ? 'repair_process' : 'finished_result', durationMs, overlayText, secondaryText, motionPreset, cropStrategy, transitionOut, evidenceIds: [`media:${attachmentId}:finding`], voiceoverLine: null };
}

function mutatedPlan(mutate) {
  const plan = structuredClone(validPlan);
  mutate(plan);
  return plan;
}

function binaryAvailable(binary) {
  return spawnSync(binary, ['-version'], { shell: false, windowsHide: true, stdio: 'ignore' }).status === 0;
}

async function createSyntheticImages(root) {
  const fixtures = [
    ['photo-a.jpg', '#154c79', '#d7f49a', 'UNIT A'],
    ['photo-b.png', '#1f6f50', '#ffffff', 'SERVICE STEP'],
    ['photo-c.webp', '#8a3f2d', '#ffe38a', 'FINISHED UNIT'],
  ];
  for (const [name, background, accent, label] of fixtures) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="${background}"/><circle cx="800" cy="540" r="310" fill="${accent}"/><rect x="470" y="330" width="660" height="430" rx="48" fill="#101820" fill-opacity=".72"/><text x="800" y="940" text-anchor="middle" font-family="Arial" font-size="92" font-weight="700" fill="#fff">${label}</text></svg>`;
    let pipeline = sharp(Buffer.from(svg));
    if (name.endsWith('.jpg')) pipeline = pipeline.jpeg({ quality: 92 });
    else if (name.endsWith('.webp')) pipeline = pipeline.webp({ quality: 92 });
    else pipeline = pipeline.png();
    await pipeline.toFile(join(root, name));
  }
  await writeFile(join(root, 'unsafe.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
  await writeFile(join(root, 'unsafe.pdf'), '%PDF-1.4 invalid fixture');
  await writeFile(join(root, 'malformed.jpg'), 'not a jpeg');
  await sharp({ create: { width: 13_000, height: 2, channels: 3, background: '#ffffff' } }).png().toFile(join(root, 'too-wide.png'));
}

async function verifyRealRender(result) {
  assert.equal(result.videoCodec, 'h264');
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
  assert.equal(result.fps, 30);
  assert.equal(result.pixelFormat, 'yuv420p');
  assert.equal(result.audioStreams, 0);
  assert.equal(result.faststart, true);
  assert.ok(Math.abs(result.durationMs - 13_800) <= 100);
  assert.ok((await stat(result.videoPath)).size > 20_000);
  assert.ok((await stat(result.coverPath)).size > 10_000);
  const cover = await sharp(result.coverPath).metadata();
  assert.deepEqual([cover.format, cover.width, cover.height], ['jpeg', 1080, 1920]);
  assert.doesNotMatch((await readFile(result.videoPath)).subarray(0, 512).toString('latin1'), /ftyp.{0,64}mdat.{0,64}moov/s);
}

async function publishArtifacts(result, artifactDir, ffmpegBin) {
  await mkdir(artifactDir, { recursive: true });
  const video = join(artifactDir, 'fixture-reel.mp4');
  const cover = join(artifactDir, 'fixture-cover.jpg');
  await copyFile(result.videoPath, video);
  await copyFile(result.coverPath, cover);
  const frames = [
    ['fixture-hook-frame.jpg', '0.20'],
    ['fixture-middle-frame.jpg', '6.00'],
    ['fixture-brand-frame.jpg', '12.60'],
  ];
  for (const [name, timestamp] of frames) {
    await runBinary(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', timestamp, '-i', video, '-frames:v', '1', '-q:v', '2', join(artifactDir, name)], { timeoutMs: 60_000 });
  }
  const coverInfo = await stat(cover);
  await writeFile(join(artifactDir, 'fixture-metadata.json'), `${JSON.stringify({
    videoFile: 'fixture-reel.mp4',
    coverFile: 'fixture-cover.jpg',
    videoBytes: result.fileSize,
    coverBytes: coverInfo.size,
    codec: result.videoCodec,
    width: result.width,
    height: result.height,
    fps: result.fps,
    durationMs: result.durationMs,
    audioStreams: result.audioStreams,
    pixelFormat: result.pixelFormat,
    faststart: result.faststart,
  }, null, 2)}\n`);
}

async function rendererTempEntries() {
  return (await readdir(tmpdir()))
    .filter((name) => name.startsWith('servicescope-reel-work-') || name.startsWith('servicescope-reel-output-'))
    .sort();
}
