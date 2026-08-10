import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { activeReelFrame, buildReelTimeline, reelMotionFrame, reelPresentationSpec, reelSafeZonePixels } from '../src/features/reel-director/presentationSpec.js';
import {
  authorizeReelForRender,
  buildFfmpegArgs,
  buildReelRenderManifest,
  escapeXml,
  layoutReelText,
  measureTextPixels,
  renderAuthorizedReel,
} from '../server/reel-renderer/index.js';
import { renderBrandCard, renderCover, renderSceneOverlay } from '../server/reel-renderer/overlays.js';
import { runBinary } from '../server/reel-renderer/process.js';
import { createArtifactHandler } from '../server/reel-render-jobs/artifacts.js';
import { reelRenderMessageSchema } from '../server/reel-render-jobs/contracts.js';
import { createRenderWorker } from '../server/reel-render-jobs/worker.js';

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
  brand: { enabled: true, displayName: 'Northstar Service', cta: 'Book dependable service', durationMs: 1_800, evidenceIds: ['company-public-display-name', 'company-voice-cta'] },
  audio: { musicMode: 'none' },
};
const stagedAssets = [
  { attachmentId: 'photo-a', path: 'photo-a.jpg' },
  { attachmentId: 'photo-b', path: 'photo-b.png' },
  { attachmentId: 'photo-c', path: 'photo-c.webp' },
];
const validContext = {
  privateValues: [],
  companyVoice: { enabled: true, publicDisplayName: 'Northstar Service' },
  evidence: [
    { id: 'diagnosis', text: 'See this service transformation. A clear service story built from the approved job media, from the starting view through the work and the finished equipment. Service transformation.' },
    { id: 'repair-performed', text: 'Careful work in progress through a controlled service sequence.' },
    { id: 'media:photo-a:finding', text: 'See this service transformation. A clear starting point.' },
    { id: 'media:photo-b:finding', text: 'Careful work in progress. A controlled service sequence.' },
    { id: 'media:photo-c:finding', text: 'Ready for the next call. The finished equipment view.' },
    { id: 'company-public-display-name', text: 'Northstar Service' },
    { id: 'company-voice-cta', text: 'Book dependable service' },
  ],
  safeMedia: [
    { attachmentId: 'photo-a', role: 'overview' },
    { attachmentId: 'photo-b', role: 'repair_process' },
    { attachmentId: 'photo-c', role: 'finished_result' },
  ],
};
const russianPrimary = '\u041a\u041e\u041d\u0414\u0418\u0426\u0418\u041e\u041d\u0415\u0420 \u041d\u0415 \u041e\u0425\u041b\u0410\u0416\u0414\u0410\u0415\u0422?';
const spanishPrimary = '\u00bfEL AIRE NO EST\u00c1 ENFRIANDO?';

const authorizedPlan = authorizeReelForRender({ plan: validPlan, context: validContext });
const { manifest } = buildReelRenderManifest(authorizedPlan, stagedAssets);
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
]) {
  check(() => assert.throws(
    () => authorizeReelForRender({ plan: mutatedPlan(mutate), context: validContext }),
    /REEL_RENDER_INVALID_PLAN|REEL_QUALITY_FAILED|REEL_GROUNDING_FAILED/,
  ));
}
check(() => assert.doesNotThrow(() => authorizeReelForRender({ plan: validPlan, context: validContext })));
check(() => assert.throws(() => buildReelRenderManifest(validPlan, stagedAssets), /REEL_RENDER_UNAUTHORIZED/));
check(() => assert.throws(() => buildReelRenderManifest({}, stagedAssets), /REEL_RENDER_UNAUTHORIZED/));
check(() => assert.throws(() => buildReelRenderManifest(JSON.parse(JSON.stringify(authorizedPlan)), stagedAssets), /REEL_RENDER_UNAUTHORIZED/));
check(() => assert.throws(
  () => authorizeReelForRender({
    plan: mutatedPlan((plan) => { plan.voiceover = { enabled: true, script: 'See this service transformation', evidenceIds: ['diagnosis'] }; }),
    context: validContext,
  }),
  /REEL_RENDER_AUDIO_UNSUPPORTED/,
));
check(() => assert.throws(
  () => authorizeReelForRender({ plan: mutatedPlan((plan) => { plan.voiceover = { enabled: false, script: 'Contradictory narration', evidenceIds: [] }; }), context: validContext }),
  /REEL_RENDER_INVALID_PLAN/,
));
check(() => assert.throws(
  () => authorizeReelForRender({ plan: mutatedPlan((plan) => { plan.audio.musicMode = 'future_library'; }), context: validContext }),
  /REEL_RENDER_AUDIO_UNSUPPORTED/,
));
check(() => assert.throws(() => buildReelRenderManifest(authorizedPlan, stagedAssets.slice(0, 2)), /REEL_RENDER_MEDIA_MISSING|REEL_RENDER_MEDIA_INVALID/));
check(() => assert.throws(() => buildReelRenderManifest(authorizedPlan, [...stagedAssets, { attachmentId: 'extra', path: 'extra.jpg' }]), /REEL_RENDER_MEDIA_INVALID/));
check(() => assert.throws(() => buildReelRenderManifest(authorizedPlan, [stagedAssets[0], stagedAssets[0], stagedAssets[2]]), /REEL_RENDER_MEDIA_INVALID/));
check(() => assert.throws(() => buildReelRenderManifest(authorizedPlan, stagedAssets.map((item, index) => index === 0 ? { ...item, path: 'https://example.com/a.jpg' } : item)), /REEL_RENDER_MEDIA_INVALID/));

const relayContext = createRelayContext();
const relayPlan = createRelayPlan();
check(() => assert.doesNotThrow(() => authorizeReelForRender({ plan: relayPlan, context: relayContext })));
const contactorTamperedPlan = mutateRelayPlan((plan) => { plan.scenes[1].overlayText = 'CONTACTOR REPLACED'; });
check(() => assert.equal(contactorTamperedPlan.revision, relayPlan.revision));
check(() => assert.deepEqual(contactorTamperedPlan.safety, relayPlan.safety));
check(() => assert.deepEqual(contactorTamperedPlan.scenes[1].evidenceIds, relayPlan.scenes[1].evidenceIds));
check(() => assert.throws(
  () => authorizeReelForRender({ plan: contactorTamperedPlan, context: relayContext }),
  /REEL_GROUNDING_FAILED/,
));
for (const text of ['FUSE REPLACED', 'VALVE REPLACED', 'COOLING RESTORED', 'SYSTEM PRESSURE RESTORED']) {
  check(() => assert.throws(
    () => authorizeReelForRender({ plan: mutateRelayPlan((plan) => { plan.scenes[1].overlayText = text; }), context: relayContext }),
    /REEL_GROUNDING_FAILED/,
  ));
}
check(() => assert.throws(
  () => authorizeReelForRender({
    plan: mutateRelayPlan((plan) => { plan.revision = 'reel-v1-tampered'; plan.scenes[1].overlayText = 'CONTACTOR REPLACED'; }),
    context: relayContext,
  }),
  /REEL_GROUNDING_FAILED/,
));
for (const text of ['FUSE CAUSED THE FAILURE', 'CONTACTOR CAUSED THE FAILURE']) {
  check(() => assert.throws(
    () => authorizeReelForRender({
      plan: mutateRelayPlan((plan) => { plan.hook.text = text; plan.scenes[0].overlayText = text; }),
      context: relayContext,
    }),
    /REEL_GROUNDING_FAILED/,
  ));
}
check(() => assert.throws(
  () => authorizeReelForRender({ plan: mutateRelayPlan((plan) => { plan.brand.displayName = 'Tampered Service'; }), context: relayContext }),
  /REEL_GROUNDING_FAILED/,
));
check(() => assert.throws(
  () => authorizeReelForRender({ plan: mutateRelayPlan((plan) => { plan.brand.cta = 'Buy luxury equipment now'; }), context: relayContext }),
  /REEL_GROUNDING_FAILED/,
));
check(() => assert.throws(
  () => authorizeReelForRender({ plan: mutateRelayPlan((plan) => { plan.scenes[0].attachmentId = 'unknown-photo'; }), context: relayContext }),
  /REEL_MEDIA_UNAVAILABLE/,
));
check(() => assert.throws(
  () => authorizeReelForRender({ plan: mutateRelayPlan((plan) => { plan.scenes[0].sceneRole = 'overview'; }), context: relayContext }),
  /REEL_GROUNDING_FAILED/,
));
check(() => assert.throws(
  () => authorizeReelForRender({ plan: mutateRelayPlan((plan) => { plan.scenes[1].evidenceIds = ['unknown-evidence']; }), context: relayContext }),
  /REEL_GROUNDING_FAILED/,
));
check(() => assert.throws(
  () => authorizeReelForRender({ plan: mutateRelayPlan((plan) => { plan.cover.attachmentId = 'unknown-photo'; }), context: relayContext }),
  /REEL_MEDIA_UNAVAILABLE/,
));
check(() => assert.throws(
  () => authorizeReelForRender({
    plan: mutateRelayPlan((plan) => {
      plan.caption.text = `${plan.caption.text} Jane Customer.`;
      plan.safety = { ok: true, privacy: 'passed', grounding: 'passed', quality: 'passed', blockedReasons: [] };
    }),
    context: relayContext,
  }),
  /REEL_PRIVACY_FAILED/,
));
check(() => assert.throws(
  () => authorizeReelForRender({
    plan: mutateRelayPlan((plan) => {
      plan.qualityScore = 20;
      plan.safety = { ok: true, privacy: 'passed', grounding: 'passed', quality: 'passed', blockedReasons: [] };
    }),
    context: relayContext,
  }),
  /REEL_QUALITY_FAILED/,
));

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
check(() => assert.deepEqual(
  [reelPresentationSpec.text.scenePrimary.minFontSize, reelPresentationSpec.text.scenePrimary.maxFontSize, reelPresentationSpec.text.scenePrimary.maxLines],
  [44, 68, 3],
));

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
check(() => assert.doesNotMatch(escapeXml('<script>alert(1)</script>'), /<script>/i));
check(() => assert.doesNotMatch(escapeXml('</text><script>alert(1)</script>'), /<script>/i));
const wideMetrics = await measureTextPixels('WWWWWWWW', { fontSize: 68, fontWeight: 800 });
const narrowMetrics = await measureTextPixels('iiiiiiii', { fontSize: 68, fontWeight: 800 });
check(() => assert.ok(wideMetrics.width > narrowMetrics.width * 2));
const longWordLayout = await layoutReelText('ELECTROMECHANICAL-SERVICE READY', 'scenePrimary', { maxWidth: 788, maxHeight: 300, fontWeight: 800 });
check(() => assert.ok(longWordLayout.lines[0].length > 22));
check(() => assert.ok(longWordLayout.fontSize >= reelPresentationSpec.text.scenePrimary.minFontSize));
check(() => assert.ok(longWordLayout.fontSize < reelPresentationSpec.text.scenePrimary.maxFontSize));
check(() => assert.ok(longWordLayout.width <= longWordLayout.maxWidth && longWordLayout.height <= longWordLayout.maxHeight));
for (const text of ['AIR-CONDITIONING NOT COOLING?', russianPrimary, spanishPrimary]) {
  const unicodeLayout = await layoutReelText(text, 'scenePrimary', { maxWidth: 788, maxHeight: 300, fontWeight: 800 });
  check(() => assert.ok(unicodeLayout.width > 0 && unicodeLayout.height > 0 && !text.includes('\ufffd')));
}
for (const maliciousText of ['</text><script>alert(1)</script>', '<foreignObject>plain text</foreignObject>']) {
  const escapedLayout = await layoutReelText(maliciousText, 'sceneSecondary', { maxWidth: 704, maxHeight: 180, fontWeight: 700 });
  check(() => assert.ok(escapedLayout.width <= escapedLayout.maxWidth && !/<(?:script|foreignObject)/i.test(escapeXml(maliciousText))));
}
await checkAsync(() => assert.rejects(
  layoutReelText('W'.repeat(45), 'scenePrimary', { maxWidth: 788, maxHeight: 300, fontWeight: 800 }),
  /REEL_RENDER_TEXT_OVERFLOW/,
));
await checkAsync(() => assert.rejects(
  renderSceneOverlay({ overlayText: 'Approved text', secondaryText: 'https://example.com/private' }, join(tmpdir(), 'servicescope-reel-url-rejected.png')),
 /REEL_RENDER_INVALID_PLAN/,
));
for (const malicious of ['<image href="https://example.com/x">', 'url(https://example.com/x)']) {
  await checkAsync(() => assert.rejects(
    renderSceneOverlay({ overlayText: 'Approved text', secondaryText: malicious }, join(tmpdir(), 'servicescope-reel-remote-ref-rejected.png')),
    /REEL_RENDER_INVALID_PLAN/,
  ));
}
await checkAsync(() => assert.rejects(runBinary(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 30 }), /REEL_RENDER_TIMEOUT/));

const fixtureRoot = await mkdtemp(join(tmpdir(), 'servicescope-renderer-fixture-'));
let rendered;
try {
  await createSyntheticImages(fixtureRoot);
  const stressFixtures = await createStressFixtures(fixtureRoot);
  for (const { layout, bounds, zone } of stressFixtures.layoutChecks) {
    check(() => assertLayoutInside(layout, bounds, zone));
  }
  const overlayFixture = join(fixtureRoot, 'scene-overlay.png');
  const normalOverlayLayout = await renderSceneOverlay(manifest.scenes[0], overlayFixture);
  check(() => assertLayoutInside(normalOverlayLayout.primary, normalOverlayLayout.primaryBounds, normalOverlayLayout.zone));
  check(() => assertLayoutInside(normalOverlayLayout.secondary, normalOverlayLayout.secondaryBounds, normalOverlayLayout.zone));
  const overlayMetadata = await sharp(overlayFixture).metadata();
  check(() => assert.deepEqual([overlayMetadata.format, overlayMetadata.width, overlayMetadata.height], ['png', 1080, 1920]));
  const tempBeforeFailures = await rendererTempEntries();
  await checkAsync(async () => assert.throws(
    () => authorizeReelForRender({
      plan: mutatedPlan((plan) => { plan.voiceover = { enabled: true, script: 'See this service transformation', evidenceIds: ['diagnosis'] }; }),
      context: validContext,
    }),
    /REEL_RENDER_AUDIO_UNSUPPORTED/,
  ));
  await checkAsync(async () => assert.deepEqual(await rendererTempEntries(), tempBeforeFailures));
  await checkAsync(() => assert.rejects(
    renderAuthorizedReel({ authorized: validPlan, stagedAssets, stagingRoot: 'normalization-must-not-run', ffmpegBin: 'ffmpeg-must-not-run', ffprobeBin: 'ffprobe-must-not-run' }),
    /REEL_RENDER_UNAUTHORIZED/,
  ));
  await checkAsync(() => assert.rejects(
    renderAuthorizedReel({ authorized: JSON.parse(JSON.stringify(authorizedPlan)), stagedAssets, stagingRoot: 'normalization-must-not-run', ffmpegBin: 'ffmpeg-must-not-run', ffprobeBin: 'ffprobe-must-not-run' }),
    /REEL_RENDER_UNAUTHORIZED/,
  ));
  await checkAsync(async () => assert.deepEqual(await rendererTempEntries(), tempBeforeFailures));
  await checkAsync(() => assert.rejects(
    renderAuthorizedReel({ authorized: authorizedPlan, stagedAssets: stagedAssets.map((item) => ({ ...item, path: '../outside.jpg' })), stagingRoot: fixtureRoot, ffmpegBin: 'missing-ffmpeg' }),
    /REEL_RENDER_MEDIA_MISSING|REEL_RENDER_MEDIA_INVALID/,
  ));
  for (const invalidPath of ['unsafe.svg', 'unsafe.pdf', 'malformed.jpg', 'too-wide.png']) {
    await checkAsync(() => assert.rejects(
      renderAuthorizedReel({
        authorized: authorizedPlan,
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
    rendered = await renderAuthorizedReel({ authorized: authorizedPlan, stagedAssets, stagingRoot: fixtureRoot, ffmpegBin, ffprobeBin });
    await verifyRealRender(rendered);
    checks += 12;
    await verifyDurableRenderWorkflow(fixtureRoot);
    if (process.env.REEL_RENDER_ARTIFACT_DIR) await publishArtifacts(rendered, process.env.REEL_RENDER_ARTIFACT_DIR, ffmpegBin, stressFixtures.artifactFiles);
    console.log(`Real Reel fixture rendered (${rendered.fileSize} MP4 bytes, ${rendered.durationMs}ms).`);
  } else {
    console.log('Real Reel fixture skipped locally: ffmpeg/ffprobe unavailable; CI requires it.');
  }
} finally {
  await rendered?.dispose();
  await rm(fixtureRoot, { recursive: true, force: true });
}

console.log(`Reel renderer regression tests passed (${checks}/${checks}).`);

async function verifyDurableRenderWorkflow(fixtureRoot) {
  const renderJobId = '00000000-0000-4000-8000-00000000d301';
  const companyId = '00000000-0000-4000-8000-00000000d302';
  const jobId = '00000000-0000-4000-8000-00000000d303';
  const uploads = new Map();
  let completed;
  const assets = new Map();
  for (const asset of stagedAssets) assets.set(asset.attachmentId, await readFile(join(fixtureRoot, asset.path)));
  const repository = {
    async claim() {
      return { id: renderJobId, company_id: companyId, job_id: jobId, creative_plan_id: 'plan-1', lease_token: 'lease-1' };
    },
    async status() { return 'rendering'; },
    async loadAuthority() { return { plan: validPlan, context: validContext, assets }; },
    async upload(bucket, path, bytes, mime) { uploads.set(path, { bucket, bytes, mime }); },
    async complete(_id, _token, paths, metadata) { completed = { paths, metadata }; return [{ status: 'completed' }]; },
    async fail() { throw new Error('REAL_DURABLE_FIXTURE_MUST_NOT_FAIL'); },
  };
  const result = await createRenderWorker({ repository })({ schemaVersion: reelRenderMessageSchema, renderJobId });
  check(() => assert.deepEqual(result, { status: 'completed', rendered: true }));
  check(() => assert.equal(uploads.size, 2));
  check(() => assert.ok(uploads.get(`${companyId}/${renderJobId}/reel.mp4`)?.bytes.length > 1_000));
  check(() => assert.equal(uploads.get(`${companyId}/${renderJobId}/reel.mp4`)?.mime, 'video/mp4'));
  check(() => assert.equal(uploads.get(`${companyId}/${renderJobId}/cover.jpg`)?.mime, 'image/jpeg'));
  check(() => assert.deepEqual([completed.metadata.width, completed.metadata.height, completed.metadata.audioStreams], [1080, 1920, 0]));

  const artifactHandler = createArtifactHandler({ client: {
    async authenticate() { return { token: 'synthetic-user-token' }; },
    async select() { return [{ id: renderJobId, job_id: jobId, status: 'completed', output_bucket: completed.paths.bucket, video_object_path: completed.paths.video, cover_object_path: completed.paths.cover }]; },
    async userRpc() { return [{ render_job_id: renderJobId }]; },
    async sign(_bucket, path) { return { signedURL: `https://signed.synthetic.test/${path}` }; },
  } });
  const response = await artifactHandler(new Request('https://synthetic.test/api/reel-render-artifacts', {
    method: 'POST', headers: { authorization: 'Bearer synthetic-user-token' }, body: JSON.stringify({ renderJobId }),
  }));
  const body = await response.json();
  check(() => assert.equal(response.status, 200));
  check(() => assert.match(body.videoUrl, /^https:\/\/signed\.synthetic\.test\//));
  check(() => assert.match(body.coverUrl, /^https:\/\/signed\.synthetic\.test\//));
}

function scene(id, position, attachmentId, durationMs, overlayText, secondaryText, motionPreset, cropStrategy, transitionOut) {
  return { id, position, attachmentId, sceneRole: position === 1 ? 'overview' : position === 2 ? 'repair_process' : 'finished_result', durationMs, overlayText, secondaryText, motionPreset, cropStrategy, transitionOut, evidenceIds: [`media:${attachmentId}:finding`], voiceoverLine: null };
}

function mutatedPlan(mutate) {
  const plan = structuredClone(validPlan);
  mutate(plan);
  return plan;
}

function createRelayContext() {
  return {
    privateValues: ['Jane Customer'],
    companyVoice: { enabled: true, publicDisplayName: 'Northstar Service' },
    evidence: [
      { id: 'complaint', text: 'The oven stopped heating.' },
      { id: 'diagnosis', text: 'A burned relay caused the heating failure.' },
      { id: 'repair-performed', text: 'The burned relay was replaced.' },
      { id: 'final-result', text: 'Heating operation was restored.' },
      { id: 'media:detail-1:detail-finding', text: 'The burned relay is visible in this problem detail.' },
      { id: 'media:finish-1:finished_result-finding', text: 'The restored oven is shown after testing.' },
      { id: 'company-public-display-name', text: 'Northstar Service' },
    ],
    safeMedia: [
      { attachmentId: 'detail-1', role: 'detail' },
      { attachmentId: 'finish-1', role: 'finished_result' },
    ],
  };
}

function createRelayPlan() {
  return {
    schemaVersion: 'reel-creative-plan-v1',
    revision: 'reel-v1-relay-fixture',
    decision: 'create_reel',
    qualityScore: 86,
    qualityReasons: ['A specific supported failure and repair create a useful visual story.'],
    marketingAngle: 'diagnostic_reveal',
    hook: { text: 'BURNED RELAY CAUSED HEATING FAILURE', evidenceIds: ['complaint', 'diagnosis'] },
    cover: { title: 'BURNED RELAY CAUSED HEATING FAILURE', attachmentId: 'detail-1' },
    scenes: [
      {
        id: 'scene-1', position: 1, attachmentId: 'detail-1', sceneRole: 'detail', durationMs: 5_000,
        overlayText: 'BURNED RELAY CAUSED HEATING FAILURE', secondaryText: 'The burned relay is visible in detail',
        motionPreset: 'focus_detail', cropStrategy: 'detail_crop', transitionOut: 'quick_fade',
        evidenceIds: ['media:detail-1:detail-finding', 'complaint', 'diagnosis'], voiceoverLine: null,
      },
      {
        id: 'scene-2', position: 2, attachmentId: 'finish-1', sceneRole: 'finished_result', durationMs: 5_000,
        overlayText: 'RELAY REPLACED', secondaryText: 'HEATING OPERATION RESTORED',
        motionPreset: 'slow_zoom_out', cropStrategy: 'subject_center', transitionOut: 'crossfade',
        evidenceIds: ['media:finish-1:finished_result-finding', 'repair-performed', 'final-result'], voiceoverLine: null,
      },
    ],
    caption: {
      text: 'A burned relay caused this heating failure. The burned relay was replaced. Heating operation was restored. Having a similar oven issue? Send us a message. #OvenRepair',
      evidenceIds: ['complaint', 'diagnosis', 'repair-performed', 'final-result', 'company-public-display-name'],
    },
    voiceover: { enabled: false, script: '', evidenceIds: [] },
    missingShots: [],
    claims: [
      { id: 'claim-1', text: 'The oven stopped heating.', evidenceIds: ['complaint'] },
      { id: 'claim-2', text: 'A burned relay caused the failure.', evidenceIds: ['diagnosis'] },
      { id: 'claim-3', text: 'The relay was replaced.', evidenceIds: ['repair-performed'] },
      { id: 'claim-4', text: 'Heating operation was restored.', evidenceIds: ['final-result'] },
    ],
    safety: { ok: true, privacy: 'passed', grounding: 'passed', quality: 'passed', blockedReasons: [] },
    brand: {
      enabled: true, displayName: 'Northstar Service', cta: 'Having a similar issue? Send us a message.',
      durationMs: 2_000, evidenceIds: ['company-public-display-name'],
    },
    audio: { musicMode: 'none' },
  };
}

function mutateRelayPlan(mutate) {
  const plan = createRelayPlan();
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

async function createStressFixtures(root) {
  const artifactFiles = [];
  const layoutChecks = [];
  const overlayCases = [
    {
      name: 'fixture-long-text-frame.jpg',
      primary: 'AIR-CONDITIONING SYSTEM TROUBLESHOOTING',
      secondary: 'ELECTROMECHANICAL REFRIGERATION TROUBLESHOOTING WITH VERIFIED SERVICE STEPS',
    },
    {
      name: 'fixture-russian-frame.jpg',
      primary: russianPrimary,
      secondary: '\u041f\u0420\u041e\u0412\u0415\u0420\u041a\u0410 \u0421\u0418\u0421\u0422\u0415\u041c\u042b \u0412\u042b\u041f\u041e\u041b\u041d\u0415\u041d\u0410',
    },
    {
      name: 'fixture-spanish-frame.jpg',
      primary: spanishPrimary,
      secondary: '\u00bfNECESITA SERVICIO DE REFRIGERACI\u00d3N?',
    },
  ];
  for (const [index, fixture] of overlayCases.entries()) {
    const overlayPath = join(root, `stress-overlay-${index}.png`);
    const report = await renderSceneOverlay({ overlayText: fixture.primary, secondaryText: fixture.secondary }, overlayPath);
    const framePath = join(root, fixture.name);
    await composeOverlayFrame(join(root, 'photo-a.jpg'), overlayPath, framePath);
    artifactFiles.push({ name: fixture.name, path: framePath });
    layoutChecks.push(
      { layout: report.primary, bounds: report.primaryBounds, zone: report.zone },
      { layout: report.secondary, bounds: report.secondaryBounds, zone: report.zone },
    );
  }

  const coverPath = join(root, 'fixture-long-cover.jpg');
  const coverReport = await renderCover(join(root, 'photo-b.png'), 'REFRIGERATION TROUBLESHOOTING SERVICE', coverPath);
  artifactFiles.push({ name: 'fixture-long-cover.jpg', path: coverPath });
  layoutChecks.push({ layout: coverReport.layout, bounds: coverReport.textBounds, zone: coverReport.zone });

  const brandPng = join(root, 'stress-brand.png');
  const brandReport = await renderBrandCard({
    displayName: 'International Electromechanical Refrigeration Services',
    cta: 'Schedule AIR-CONDITIONING and REFRIGERATION TROUBLESHOOTING with our service team',
  }, brandPng);
  const brandPath = join(root, 'fixture-long-brand-frame.jpg');
  await sharp(brandPng).jpeg({ quality: 92 }).toFile(brandPath);
  artifactFiles.push({ name: 'fixture-long-brand-frame.jpg', path: brandPath });
  layoutChecks.push(
    { layout: brandReport.displayName, bounds: brandReport.displayBounds, zone: brandReport.zone },
    { layout: brandReport.cta, bounds: brandReport.ctaBounds, zone: brandReport.zone },
  );

  for (const { path } of artifactFiles) {
    const metadata = await sharp(path).metadata();
    check(() => assert.deepEqual([metadata.width, metadata.height], [1080, 1920]));
  }
  return { artifactFiles, layoutChecks };
}

async function composeOverlayFrame(sourcePath, overlayPath, outputPath) {
  await sharp(sourcePath)
    .resize(reelPresentationSpec.width, reelPresentationSpec.height, { fit: 'cover', position: 'centre' })
    .composite([{ input: overlayPath, top: 0, left: 0 }])
    .jpeg({ quality: 92 })
    .toFile(outputPath);
}

function assertLayoutInside(layout, bounds, zone) {
  assert.ok(layout && bounds && zone);
  const style = reelPresentationSpec.text[layout.styleName];
  assert.ok(layout.fontSize >= style.minFontSize && layout.fontSize <= style.maxFontSize);
  assert.ok(layout.lines.length > 0 && layout.lines.length <= style.maxLines);
  assert.ok(layout.width <= layout.maxWidth && layout.height <= layout.maxHeight);
  assert.ok(bounds.left >= zone.left && bounds.right <= zone.right);
  assert.ok(bounds.top >= zone.top && bounds.bottom <= zone.bottom);
  assert.ok(bounds.left >= 0 && bounds.top >= 0 && bounds.width > 0 && bounds.height > 0);
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

async function publishArtifacts(result, artifactDir, ffmpegBin, stressFiles) {
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
  for (const fixture of stressFiles) await copyFile(fixture.path, join(artifactDir, fixture.name));
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
    stressFiles: stressFiles.map((item) => item.name),
  }, null, 2)}\n`);
}

async function rendererTempEntries() {
  return (await readdir(tmpdir()))
    .filter((name) => name.startsWith('servicescope-reel-work-') || name.startsWith('servicescope-reel-output-'))
    .sort();
}
