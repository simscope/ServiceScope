import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import {
  authorizeReelForRender,
  buildReelRenderManifest,
  createReelRenderer,
} from '../../server/reel-renderer/index.js';
import { runBinary } from '../../server/reel-renderer/process.js';

const limits = Object.freeze({
  cpu: 1,
  memoryBytes: 2 * 1024 ** 3,
  tmpBytes: 500 * 1024 ** 2,
  durationMs: 300_000,
  sampleIntervalMs: 200,
});
const qualification25Targets = Object.freeze({
  containerPeakMemoryBytes: 1_717_986_918,
  rendererWallMs: 210_000,
  totalWallMsExclusive: 300_000,
  peakTmpBytes: 250 * 1024 ** 2,
  aggregateIntermediateBytes: 180_000_000,
});

const fixtureArg = argument('fixture');
const outputArg = argument('output');
const combineArg = argument('combine');
const validateArg = argument('validate');

if (combineArg) {
  await combineReports(combineArg);
} else if (validateArg) {
  await validateFixture(validateArg);
} else if (fixtureArg && outputArg) {
  await runFixture(fixtureArg, outputArg);
} else {
  throw new Error('Expected --fixture=<13.8s|25s> --output=<path>, --validate=<13.8s|25s>, or --combine=<path>');
}

async function validateFixture(name) {
  assert.ok(name === '13.8s' || name === '25s');
  const stagingRoot = await mkdtemp(join(tmpdir(), `servicescope-qualification-validation-${name}-`));
  try {
    const fixture = name === '13.8s'
      ? await createNominalFixture(stagingRoot)
      : await createWorstNormalFixture(stagingRoot);
    const authorized = authorizeReelForRender({ plan: fixture.plan, context: fixture.context });
    const { manifest } = buildReelRenderManifest(authorized, fixture.stagedAssets);
    assert.equal(manifest.durationMs, fixture.expectedDurationMs);
    assert.equal(manifest.scenes.length, fixture.expectedScenes);
    console.log(JSON.stringify({ fixture: name, authorized: true, durationMs: manifest.durationMs, scenes: manifest.scenes.length }));
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

async function runFixture(name, outputDir) {
  assert.ok(name === '13.8s' || name === '25s');
  await mkdir(outputDir, { recursive: true });
  const sampler = createSampler();
  const totalStarted = performance.now();
  const stagingRoot = await mkdtemp(join(tmpdir(), `servicescope-qualification-${name}-`));
  const ffmpegStages = [];
  const intermediateEvidence = { aggregateBytes: 0, maximumBytes: 0 };
  let rendered;
  try {
    sampler.start();
    const fixture = name === '13.8s'
      ? await createNominalFixture(stagingRoot)
      : await createWorstNormalFixture(stagingRoot);
    const inputBytes = await sumFiles(fixture.stagedAssets.map((item) => join(stagingRoot, item.path)));
    const authorized = authorizeReelForRender({ plan: fixture.plan, context: fixture.context });
    const { manifest } = buildReelRenderManifest(authorized, fixture.stagedAssets);
    assert.equal(manifest.durationMs, fixture.expectedDurationMs);
    assert.equal(manifest.scenes.length, fixture.expectedScenes);

    const renderer = createReelRenderer({
      onStageChange(event) {
        const label = stageLabel(event);
        if (event.phase === 'start') {
          sampler.setStage(label);
          void sampler.sampleNow();
          if (isFfmpegStage(event.stage)) {
            const timingFile = join(outputDir, `ffmpeg-${label}-time.json`);
            const diagnosticFile = join(outputDir, `ffmpeg-${label}-stderr.txt`);
            ffmpegStages.push({ stage: label, timingFile, diagnosticFile });
            process.env.FFMPEG_METRICS_FILE = timingFile;
            process.env.FFMPEG_DIAGNOSTIC_FILE = diagnosticFile;
          }
        } else if (event.phase === 'end') {
          void sampler.sampleNow();
          sampler.setStage('idle');
        } else if (event.phase === 'artifact') {
          intermediateEvidence.aggregateBytes = event.aggregateIntermediateBytes;
          intermediateEvidence.maximumBytes = Math.max(intermediateEvidence.maximumBytes, event.bytes);
        }
      },
    });

    const rendererStarted = performance.now();
    rendered = await renderer({
      authorized,
      stagedAssets: fixture.stagedAssets,
      stagingRoot,
      ffmpegBin: '/workspace/qualification/reel-runtime/ffmpeg-measured.sh',
      ffprobeBin: '/usr/bin/ffprobe',
    });
    const rendererWallMs = performance.now() - rendererStarted;

    assertOutputContract(rendered, fixture.expectedDurationMs);
    const videoPath = join(outputDir, `${name}-synthetic.mp4`);
    const coverPath = join(outputDir, `${name}-cover.jpg`);
    await copyFile(rendered.videoPath, videoPath);
    await copyFile(rendered.coverPath, coverPath);
    await captureFrames(videoPath, outputDir, fixture.frameTimes);
    const probe = await probeVideo(videoPath);
    assertProbeContract(probe, fixture.expectedDurationMs);

    await sampler.sampleNow();
    const ffmpeg = await readFfmpegStages(ffmpegStages);
    const videoBytes = (await stat(videoPath)).size;
    const coverBytes = (await stat(coverPath)).size;
    const resources = await sampler.finish();
    const totalWallMs = performance.now() - totalStarted;
    await writeFile(join(outputDir, 'resource-samples.csv'), resourceSamplesCsv(resources.samples));
    const report = {
      fixture: name,
      status: 'PASS',
      scenes: manifest.scenes.length,
      expectedDurationMs: fixture.expectedDurationMs,
      output: {
        durationMs: rendered.durationMs,
        codec: rendered.videoCodec,
        width: rendered.width,
        height: rendered.height,
        fps: rendered.fps,
        pixelFormat: rendered.pixelFormat,
        faststart: rendered.faststart,
        audioStreams: rendered.audioStreams,
        videoBytes,
        coverBytes,
      },
      performance: {
        totalWallMs: round(totalWallMs),
        rendererWallMs: round(rendererWallMs),
        ffmpegWallMs: ffmpeg.wallMs,
        ffmpegUserCpuMs: ffmpeg.userCpuMs,
        ffmpegSystemCpuMs: ffmpeg.systemCpuMs,
        ffmpegMaxRssBytes: ffmpeg.maxRssBytes,
        ffmpegStages: ffmpeg.stages,
        cgroupCpuUsageMs: round(resources.cpuUsageUsec / 1000),
        sampledPeakCpuPercent: round(resources.peakCpuPercent),
        containerPeakMemoryBytes: resources.memoryPeakBytes,
        sampledPeakMemoryBytes: resources.sampledMemoryPeakBytes,
        peakTmpBytes: resources.tmpPeakBytes,
        rendererWorkDirectoryPeakBytes: resources.workPeakBytes,
        normalizedSourcePeakBytes: resources.normalizedPeakBytes,
        normalizationPeakMemoryBytes: resources.stageMemoryPeaks.normalization ?? 0,
        maximumScenePeakMemoryBytes: maximumStagePeak(resources.stageMemoryPeaks, 'scene-'),
        brandPeakMemoryBytes: resources.stageMemoryPeaks.brand ?? 0,
        finalComposePeakMemoryBytes: resources.stageMemoryPeaks['final-compose'] ?? 0,
        aggregateIntermediateBytes: intermediateEvidence.aggregateBytes,
        maximumIntermediateBytes: intermediateEvidence.maximumBytes,
        inputBytes,
      },
      limits,
      qualification25Targets,
      margins: {
        durationMs: round(limits.durationMs - totalWallMs),
        memoryBytes: limits.memoryBytes - resources.memoryPeakBytes,
        tmpBytes: limits.tmpBytes - resources.tmpPeakBytes,
      },
      runtime: {
        node: process.version,
        network: 'none',
        cgroupV2MemoryPeakAvailable: resources.cgroupV2MemoryPeakAvailable,
      },
    };
    assert.ok(report.margins.durationMs > 0, 'Fixture exceeded 300 second duration limit');
    assert.ok(report.margins.memoryBytes > 0, 'Container exceeded 2 GB memory limit');
    assert.ok(report.margins.tmpBytes > 0, 'Container exceeded 500 MB /tmp limit');
    await writeFile(join(outputDir, 'fixture-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const resources = await sampler.finish();
    const totalWallMs = performance.now() - totalStarted;
    await writeFile(join(outputDir, 'resource-samples.csv'), resourceSamplesCsv(resources.samples));
    const report = {
      fixture: name,
      status: 'FAIL',
      errorCode: typeof error?.code === 'string' ? error.code : 'QUALIFICATION_FAILED',
      errorMessage: String(error?.message ?? error),
      performance: {
        totalWallMs: round(totalWallMs),
        cgroupCpuUsageMs: round(resources.cpuUsageUsec / 1000),
        sampledPeakCpuPercent: round(resources.peakCpuPercent),
        containerPeakMemoryBytes: resources.memoryPeakBytes,
        sampledPeakMemoryBytes: resources.sampledMemoryPeakBytes,
        peakTmpBytes: resources.tmpPeakBytes,
        rendererWorkDirectoryPeakBytes: resources.workPeakBytes,
        normalizedSourcePeakBytes: resources.normalizedPeakBytes,
        normalizationPeakMemoryBytes: resources.stageMemoryPeaks.normalization ?? 0,
        maximumScenePeakMemoryBytes: maximumStagePeak(resources.stageMemoryPeaks, 'scene-'),
        brandPeakMemoryBytes: resources.stageMemoryPeaks.brand ?? 0,
        finalComposePeakMemoryBytes: resources.stageMemoryPeaks['final-compose'] ?? 0,
        aggregateIntermediateBytes: intermediateEvidence.aggregateBytes,
        maximumIntermediateBytes: intermediateEvidence.maximumBytes,
      },
      limits,
      qualification25Targets,
      cgroupMemoryEvents: await readKeyValueFile('/sys/fs/cgroup/memory.events'),
      ffmpegEvidence: await readFfmpegEvidence(ffmpegStages),
      runtime: {
        node: process.version,
        network: 'none',
        cgroupV2MemoryPeakAvailable: resources.cgroupV2MemoryPeakAvailable,
      },
    };
    await writeFile(join(outputDir, 'fixture-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.error(JSON.stringify(report, null, 2));
    throw error;
  } finally {
    await sampler.finish().catch(() => {});
    await rendered?.dispose().catch(() => {});
    await rm(stagingRoot, { recursive: true, force: true });
    delete process.env.FFMPEG_METRICS_FILE;
    delete process.env.FFMPEG_DIAGNOSTIC_FILE;
  }
}

async function createNominalFixture(root) {
  const definitions = [
    ['photo-a.jpg', '#154c79', '#d7f49a', 'UNIT A'],
    ['photo-b.png', '#1f6f50', '#ffffff', 'SERVICE STEP'],
    ['photo-c.webp', '#8a3f2d', '#ffe38a', 'FINISHED UNIT'],
  ];
  for (const [name, background, accent, label] of definitions) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="${background}"/><circle cx="800" cy="540" r="310" fill="${accent}"/><rect x="470" y="330" width="660" height="430" rx="48" fill="#101820" fill-opacity=".72"/><text x="800" y="940" text-anchor="middle" font-family="Arial" font-size="92" font-weight="700" fill="#fff">${label}</text></svg>`;
    let pipeline = sharp(Buffer.from(svg));
    if (name.endsWith('.jpg')) pipeline = pipeline.jpeg({ quality: 92 });
    else if (name.endsWith('.webp')) pipeline = pipeline.webp({ quality: 92 });
    else pipeline = pipeline.png();
    await pipeline.toFile(join(root, name));
  }
  return nominalPlanFixture();
}

function nominalPlanFixture() {
  const plan = {
    schemaVersion: 'reel-creative-plan-v1',
    revision: 'reel-v1-fixture',
    decision: 'create_reel',
    qualityScore: 88,
    qualityReasons: ['Clear service story with distinct visual coverage.'],
    marketingAngle: 'repair_process',
    hook: { text: 'See this service transformation', evidenceIds: ['diagnosis'] },
    cover: { title: 'Service transformation', attachmentId: 'photo-a' },
    scenes: [
      scene('scene-1', 1, 'photo-a', 'overview', 4_000, 'See this service transformation', 'A clear starting point', 'slow_zoom_in', 'cover_center', 'crossfade'),
      scene('scene-2', 2, 'photo-b', 'repair_process', 4_000, 'Careful work in progress', 'A controlled service sequence', 'pan_left', 'subject_center', 'quick_fade'),
      scene('scene-3', 3, 'photo-c', 'finished_result', 4_000, 'Ready for the next call', 'The finished equipment view', 'focus_detail', 'detail_crop', 'crossfade'),
    ],
    caption: { text: 'A clear service story built from the approved job media, from the starting view through the work and the finished equipment.', evidenceIds: ['diagnosis'] },
    voiceover: { enabled: false, script: '', evidenceIds: [] },
    missingShots: [],
    claims: [{ id: 'claim-1', text: 'Service transformation', evidenceIds: ['diagnosis'] }],
    safety: { ok: true, privacy: 'passed', grounding: 'passed', quality: 'passed', blockedReasons: [] },
    brand: { enabled: true, displayName: 'Northstar Service', cta: 'Book dependable service', durationMs: 1_800, evidenceIds: ['company-public-display-name', 'company-voice-cta'] },
    audio: { musicMode: 'none' },
  };
  const context = {
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
  return {
    plan,
    context,
    stagedAssets: [
      { attachmentId: 'photo-a', path: 'photo-a.jpg' },
      { attachmentId: 'photo-b', path: 'photo-b.png' },
      { attachmentId: 'photo-c', path: 'photo-c.webp' },
    ],
    expectedDurationMs: 13_800,
    expectedScenes: 3,
    frameTimes: [['hook', '0.20'], ['transition', '3.70'], ['middle', '6.00'], ['brand-final', '12.60']],
  };
}

async function createWorstNormalFixture(root) {
  const stagedAssets = [];
  for (let index = 0; index < 7; index += 1) {
    const name = `phone-photo-${index + 1}.jpg`;
    await createPhonePhoto(join(root, name), index);
    stagedAssets.push({ attachmentId: `phone-${index + 1}`, path: name });
  }
  const roles = ['overview', 'detail', 'repair_process', 'replacement_part', 'supporting_image', 'detail', 'finished_result'];
  const primary = [
    'Inside a careful service process',
    'Detailed inspection from every angle',
    'Measured steps guide the work',
    'Prepared components support the sequence',
    'Every service stage stays organized',
    'Final checks confirm visible progress',
    'A complete finished equipment view',
  ];
  const secondary = [
    'The starting equipment view establishes the service sequence',
    'Close visual details support a controlled inspection',
    'The work progresses through clear documented stages',
    'Organized parts and tools frame the next service step',
    'Supporting views preserve context across the full process',
    'Detailed finishing work remains visible before completion',
    'The final frame presents the completed visual sequence',
  ];
  const motions = ['slow_zoom_in', 'focus_detail', 'pan_left', 'pan_right', 'static', 'slow_zoom_out', 'focus_detail'];
  const crops = ['cover_center', 'detail_crop', 'subject_center', 'cover_center', 'subject_center', 'detail_crop', 'cover_center'];
  const transitions = ['crossfade', 'quick_fade', 'crossfade', 'cut', 'quick_fade', 'crossfade', 'crossfade'];
  const durations = [3_300, 3_300, 3_300, 3_300, 3_300, 3_300, 3_200];
  const evidence = [];
  const safeMedia = [];
  const scenes = [];
  for (let index = 0; index < 7; index += 1) {
    const attachmentId = `phone-${index + 1}`;
    const evidenceId = `media:${attachmentId}:finding`;
    evidence.push({ id: evidenceId, text: `${primary[index]}. ${secondary[index]}.` });
    safeMedia.push({ attachmentId, role: roles[index] });
    scenes.push(scene(
      `scene-${index + 1}`,
      index + 1,
      attachmentId,
      roles[index],
      durations[index],
      primary[index],
      secondary[index],
      motions[index],
      crops[index],
      transitions[index],
      index === 0 ? [evidenceId, 'diagnosis'] : [evidenceId],
    ));
  }
  const caption = 'A careful service process moves from the starting equipment view through organized inspection stages and documented visual progress to a complete finished view.';
  evidence.push(
    { id: 'diagnosis', text: `Inside a careful service process. ${caption}` },
    { id: 'repair-performed', text: 'Measured service steps guide organized work through a controlled repair process.' },
    { id: 'company-public-display-name', text: 'Northstar Service' },
    { id: 'company-voice-cta', text: 'Schedule a careful service visit' },
  );
  return {
    plan: {
      schemaVersion: 'reel-creative-plan-v1',
      revision: 'reel-v1-qualification-25s',
      decision: 'create_reel',
      qualityScore: 92,
      qualityReasons: ['Seven distinct synthetic views provide complete visual coverage.'],
      marketingAngle: 'repair_process',
      hook: { text: primary[0], evidenceIds: ['diagnosis'] },
      cover: { title: 'Careful service process', attachmentId: 'phone-1' },
      scenes,
      caption: { text: caption, evidenceIds: ['diagnosis'] },
      voiceover: { enabled: false, script: '', evidenceIds: [] },
      missingShots: [],
      claims: [{ id: 'claim-1', text: 'A careful service process', evidenceIds: ['diagnosis'] }],
      safety: { ok: true, privacy: 'passed', grounding: 'passed', quality: 'passed', blockedReasons: [] },
      brand: { enabled: true, displayName: 'Northstar Service', cta: 'Schedule a careful service visit', durationMs: 2_000, evidenceIds: ['company-public-display-name', 'company-voice-cta'] },
      audio: { musicMode: 'none' },
    },
    context: {
      privateValues: [],
      companyVoice: { enabled: true, publicDisplayName: 'Northstar Service' },
      evidence,
      safeMedia,
    },
    stagedAssets,
    expectedDurationMs: 25_000,
    expectedScenes: 7,
    frameTimes: [
      ['slow-zoom-in', '1.50'],
      ['focus-detail', '5.00'],
      ['quick-fade', '6.45'],
      ['pan-left', '8.00'],
      ['crossfade', '9.70'],
      ['pan-right', '11.20'],
      ['middle', '14.50'],
      ['brand-final', '24.20'],
    ],
  };
}

async function createPhonePhoto(path, index) {
  const hues = [205, 152, 28, 12, 270, 188, 42];
  const hue = hues[index];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4032" height="3024">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${hue} 55% 24%)"/>
        <stop offset="0.55" stop-color="hsl(${(hue + 28) % 360} 48% 48%)"/>
        <stop offset="1" stop-color="hsl(${(hue + 70) % 360} 62% 72%)"/>
      </linearGradient>
      <pattern id="texture" width="${132 + index * 7}" height="${118 + index * 9}" patternUnits="userSpaceOnUse" patternTransform="rotate(${8 + index * 5})">
        <rect width="100%" height="100%" fill="none" stroke="#fff" stroke-width="7" opacity=".24"/>
        <circle cx="34" cy="42" r="13" fill="#101820" opacity=".38"/>
        <path d="M0 92 L58 34 L118 102" fill="none" stroke="#fff" stroke-width="9" opacity=".22"/>
      </pattern>
    </defs>
    <rect width="4032" height="3024" fill="url(#sky)"/>
    <rect width="4032" height="3024" fill="url(#texture)" opacity=".34"/>
    <rect x="${360 + index * 70}" y="410" width="2500" height="1640" rx="96" fill="#101820" opacity=".72"/>
    <circle cx="${1100 + index * 250}" cy="${1050 + (index % 3) * 170}" r="520" fill="hsl(${(hue + 145) % 360} 60% 68%)" opacity=".82"/>
    <path d="M260 2500 C1100 ${1850 + index * 40}, 2400 ${2800 - index * 55}, 3850 1980" fill="none" stroke="#fff" stroke-width="44" opacity=".46"/>
    <g fill="#fff" opacity=".75">${Array.from({ length: 16 }, (_, item) => `<rect x="${220 + item * 235}" y="${2300 - (item % 4) * 115}" width="130" height="${180 + (item % 5) * 75}" rx="24"/>`).join('')}</g>
    <text x="2016" y="2760" text-anchor="middle" font-family="DejaVu Sans" font-size="150" font-weight="700" fill="#fff">SYNTHETIC SERVICE VIEW ${index + 1}</text>
  </svg>`;
  await sharp(Buffer.from(svg), { limitInputPixels: false })
    .jpeg({ quality: 90, chromaSubsampling: '4:2:0' })
    .toFile(path);
  const metadata = await sharp(path).metadata();
  assert.deepEqual([metadata.width, metadata.height], [4032, 3024]);
}

function scene(id, position, attachmentId, sceneRole, durationMs, overlayText, secondaryText, motionPreset, cropStrategy, transitionOut, evidenceIds) {
  return {
    id,
    position,
    attachmentId,
    sceneRole,
    durationMs,
    overlayText,
    secondaryText,
    motionPreset,
    cropStrategy,
    transitionOut,
    evidenceIds: evidenceIds ?? [`media:${attachmentId}:finding`],
    voiceoverLine: null,
  };
}

function assertOutputContract(result, expectedDurationMs) {
  assert.equal(result.videoCodec, 'h264');
  assert.deepEqual([result.width, result.height], [1080, 1920]);
  assert.equal(result.fps, 30);
  assert.equal(result.pixelFormat, 'yuv420p');
  assert.equal(result.faststart, true);
  assert.equal(result.audioStreams, 0);
  assert.ok(Math.abs(result.durationMs - expectedDurationMs) <= 100);
}

async function probeVideo(path) {
  const result = await runBinary('/usr/bin/ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path,
  ], { timeoutMs: 60_000 });
  return JSON.parse(result.stdout);
}

function assertProbeContract(probe, expectedDurationMs) {
  const videos = probe.streams.filter((stream) => stream.codec_type === 'video');
  const audios = probe.streams.filter((stream) => stream.codec_type === 'audio');
  assert.equal(videos.length, 1);
  assert.equal(audios.length, 0);
  assert.equal(videos[0].codec_name, 'h264');
  assert.deepEqual([videos[0].width, videos[0].height], [1080, 1920]);
  assert.equal(videos[0].pix_fmt, 'yuv420p');
  assert.equal(videos[0].avg_frame_rate, '30/1');
  assert.ok(Math.abs(Number(probe.format.duration) * 1000 - expectedDurationMs) <= 100);
}

async function captureFrames(videoPath, outputDir, frames) {
  for (const [label, timestamp] of frames) {
    await runBinary('/usr/bin/ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-ss', timestamp, '-i', videoPath,
      '-frames:v', '1', '-q:v', '2', join(outputDir, `${label}.jpg`),
    ], { timeoutMs: 60_000 });
  }
}

function createSampler() {
  let timer;
  let active = false;
  let finished;
  let sampledMemoryPeakBytes = 0;
  let tmpPeakBytes = 0;
  let workPeakBytes = 0;
  let normalizedPeakBytes = 0;
  let peakCpuPercent = 0;
  let previousCpuUsec;
  let previousSampleMs;
  let initialCpuUsec = 0;
  let samplerStartedMs = performance.now();
  let currentStage = 'setup';
  const samples = [];
  const stageMemoryPeaks = {};

  async function sampleNow() {
    if (active) return;
    active = true;
    try {
      const now = performance.now();
      const stage = currentStage;
      const memory = await readNumber('/sys/fs/cgroup/memory.current');
      const cpuUsec = await readCpuUsage();
      const tmp = await directoryBytes(tmpdir());
      const work = await prefixedDirectoryBytes(tmpdir(), 'servicescope-reel-work-');
      const normalized = await prefixedFileBytes(tmpdir(), 'servicescope-reel-work-', 'normalized-');
      let cpuPercent = 0;
      sampledMemoryPeakBytes = Math.max(sampledMemoryPeakBytes, memory ?? 0);
      stageMemoryPeaks[stage] = Math.max(stageMemoryPeaks[stage] ?? 0, memory ?? 0);
      tmpPeakBytes = Math.max(tmpPeakBytes, tmp);
      workPeakBytes = Math.max(workPeakBytes, work);
      normalizedPeakBytes = Math.max(normalizedPeakBytes, normalized);
      if (previousCpuUsec !== undefined && cpuUsec !== undefined) {
        const wallMs = now - previousSampleMs;
        if (wallMs > 0) cpuPercent = ((cpuUsec - previousCpuUsec) / 1000) / wallMs * 100;
        peakCpuPercent = Math.max(peakCpuPercent, cpuPercent);
      }
      samples.push({
        elapsedMs: round(now - samplerStartedMs),
        stage,
        memoryCurrentBytes: memory ?? 0,
        cpuUsageUsec: cpuUsec ?? 0,
        cpuPercent: round(cpuPercent),
        tmpBytes: tmp,
        rendererWorkBytes: work,
        normalizedSourceBytes: normalized,
      });
      previousCpuUsec = cpuUsec;
      previousSampleMs = now;
    } finally {
      active = false;
    }
  }

  return {
    start() {
      initialCpuUsec = 0;
      samplerStartedMs = performance.now();
      readCpuUsage().then((value) => { initialCpuUsec = value ?? 0; });
      void sampleNow();
      timer = setInterval(() => { void sampleNow(); }, limits.sampleIntervalMs);
    },
    setStage(stage) {
      currentStage = stage;
    },
    sampleNow,
    async finish() {
      if (finished) return finished;
      if (timer) clearInterval(timer);
      while (active) await new Promise((resolve) => setTimeout(resolve, 10));
      await sampleNow();
      const memoryPeak = await readNumber('/sys/fs/cgroup/memory.peak');
      const finalCpuUsec = await readCpuUsage();
      finished = {
        memoryPeakBytes: Math.max(memoryPeak ?? 0, sampledMemoryPeakBytes),
        sampledMemoryPeakBytes,
        cgroupV2MemoryPeakAvailable: memoryPeak !== undefined,
        tmpPeakBytes,
        workPeakBytes,
        normalizedPeakBytes,
        stageMemoryPeaks,
        peakCpuPercent,
        cpuUsageUsec: Math.max(0, (finalCpuUsec ?? initialCpuUsec) - initialCpuUsec),
        samples,
      };
      return finished;
    },
  };
}

function resourceSamplesCsv(samples) {
  const fields = ['elapsedMs', 'stage', 'memoryCurrentBytes', 'cpuUsageUsec', 'cpuPercent', 'tmpBytes', 'rendererWorkBytes', 'normalizedSourceBytes'];
  return `${fields.join(',')}\n${samples.map((sample) => fields.map((field) => sample[field]).join(',')).join('\n')}\n`;
}

function stageLabel(event) {
  return event.stage === 'scene' ? `scene-${event.position}` : event.stage;
}

function isFfmpegStage(stage) {
  return stage === 'scene' || stage === 'brand' || stage === 'final-compose';
}

function maximumStagePeak(peaks, prefix) {
  return Math.max(0, ...Object.entries(peaks)
    .filter(([stage]) => stage.startsWith(prefix))
    .map(([, bytes]) => bytes));
}

async function readFfmpegStages(entries) {
  const stages = await Promise.all(entries.map(async ({ stage, timingFile }) => {
    const metrics = JSON.parse(await readFile(timingFile, 'utf8'));
    return {
      stage,
      wallMs: round(metrics.wallSeconds * 1000),
      userCpuMs: round(metrics.userSeconds * 1000),
      systemCpuMs: round(metrics.systemSeconds * 1000),
      maxRssBytes: metrics.maxRssKb * 1024,
    };
  }));
  return {
    stages,
    wallMs: round(stages.reduce((sum, stage) => sum + stage.wallMs, 0)),
    userCpuMs: round(stages.reduce((sum, stage) => sum + stage.userCpuMs, 0)),
    systemCpuMs: round(stages.reduce((sum, stage) => sum + stage.systemCpuMs, 0)),
    maxRssBytes: Math.max(0, ...stages.map((stage) => stage.maxRssBytes)),
  };
}

async function readFfmpegEvidence(entries) {
  return Promise.all(entries.map(async ({ stage, timingFile, diagnosticFile }) => ({
    stage,
    timing: await readOptional(timingFile),
    diagnostic: await readOptional(diagnosticFile),
  })));
}

async function readCpuUsage() {
  try {
    const text = await readFile('/sys/fs/cgroup/cpu.stat', 'utf8');
    return Number(text.match(/^usage_usec\s+(\d+)$/m)?.[1]);
  } catch {
    return undefined;
  }
}

async function readNumber(path) {
  try {
    const value = (await readFile(path, 'utf8')).trim();
    return /^\d+$/.test(value) ? Number(value) : undefined;
  } catch {
    return undefined;
  }
}

async function readKeyValueFile(path) {
  try {
    const text = await readFile(path, 'utf8');
    return Object.fromEntries(text.trim().split(/\r?\n/).map((line) => {
      const [key, value] = line.trim().split(/\s+/, 2);
      return [key, Number(value)];
    }));
  } catch {
    return {};
  }
}

async function readOptional(path) {
  try { return (await readFile(path, 'utf8')).slice(-16_384); }
  catch { return ''; }
}

async function directoryBytes(root) {
  let total = 0;
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch { return 0; }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(path);
    else if (entry.isFile()) total += (await stat(path).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

async function prefixedDirectoryBytes(root, prefix) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) if (entry.isDirectory() && entry.name.startsWith(prefix)) total += await directoryBytes(join(root, entry.name));
  return total;
}

async function prefixedFileBytes(root, directoryPrefix, filePrefix) {
  const directories = await readdir(root, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const directory of directories) {
    if (!directory.isDirectory() || !directory.name.startsWith(directoryPrefix)) continue;
    const path = join(root, directory.name);
    const files = await readdir(path, { withFileTypes: true }).catch(() => []);
    for (const file of files) if (file.isFile() && file.name.startsWith(filePrefix)) total += (await stat(join(path, file.name))).size;
  }
  return total;
}

async function sumFiles(paths) {
  let total = 0;
  for (const path of paths) total += (await stat(path)).size;
  return total;
}

async function combineReports(root) {
  const nominal = JSON.parse(await readFile(join(root, '13.8s', 'fixture-report.json'), 'utf8'));
  const worst = JSON.parse(await readFile(join(root, '25s', 'fixture-report.json'), 'utf8'));
  const baseImage = (await readFile(join(root, 'base-image.txt'), 'utf8')).trim();
  const runner = (await readFile(join(root, 'runner-metadata.txt'), 'utf8')).trim();
  const ffmpegVersion = firstLine(await readFile(join(root, 'ffmpeg-version.txt'), 'utf8'));
  const ffprobeVersion = firstLine(await readFile(join(root, 'ffprobe-version.txt'), 'utf8'));
  const buildconf = await readFile(join(root, 'ffmpeg-buildconf.txt'), 'utf8');
  const encoders = await readFile(join(root, 'ffmpeg-encoders.txt'), 'utf8');
  const packageInventory = await readFile(join(root, 'debian-package-inventory.txt'), 'utf8');
  const report = {
    schemaVersion: 'servicescope-reel-runtime-staged-qualification-v1',
    baselineSha: '97da68e07ad1723e75c28e02543b937b5b323778',
    runner,
    container: {
      baseImage,
      node: nominal.runtime.node,
      ffmpegVersion,
      ffprobeVersion,
      debianFfmpegPackage: packageInventory.split('\n').find((line) => line.startsWith('ffmpeg\t')) ?? packageInventory.split('\n')[0],
      gplEnabled: buildconf.includes('--enable-gpl'),
      libx264: encoders.includes('libx264'),
      runtimeNetwork: 'none',
    },
    limits,
    qualification25Targets,
    fixtures: { nominal, worstNormal: worst },
  };
  assert.equal(report.container.gplEnabled, true);
  assert.equal(report.container.libx264, true);
  await writeFile(join(root, 'runtime-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(root, 'runtime-report.md'), markdownReport(report));
}

function markdownReport(report) {
  const fixture = (value) => `| ${value.fixture} | ${value.status} | ${value.output?.durationMs ?? 'n/a'} | ${value.performance.rendererWallMs ?? 'n/a'} | ${value.performance.ffmpegWallMs ?? 'n/a'} | ${value.performance.containerPeakMemoryBytes} | ${value.performance.maximumScenePeakMemoryBytes} | ${value.performance.finalComposePeakMemoryBytes} | ${value.performance.aggregateIntermediateBytes} | ${value.performance.peakTmpBytes} |`;
  return `# ServiceScope staged Reel runtime qualification

- Baseline: \`${report.baselineSha}\`
- Base image: \`${report.container.baseImage}\`
- Node: \`${report.container.node}\`
- FFmpeg: \`${report.container.ffmpegVersion}\`
- FFprobe: \`${report.container.ffprobeVersion}\`
- GPL enabled: \`${report.container.gplEnabled}\`
- libx264: \`${report.container.libx264}\`
- Runtime network: \`${report.container.runtimeNetwork}\`
- Limits: 1 CPU, 2 GiB memory, 2 GiB memory+swap total, 500 MiB /tmp, 300 seconds

| Fixture | Status | Duration ms | Renderer wall ms | FFmpeg wall ms | Peak memory bytes | Max scene peak bytes | Final compose peak bytes | Intermediate bytes | Peak /tmp bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${fixture(report.fixtures.nominal)}
${fixture(report.fixtures.worstNormal)}

## Margins

| Fixture | Duration margin ms | Memory margin bytes | /tmp margin bytes |
| --- | ---: | ---: | ---: |
| 13.8s | ${report.fixtures.nominal.margins?.durationMs ?? 'n/a'} | ${report.fixtures.nominal.margins?.memoryBytes ?? 'n/a'} | ${report.fixtures.nominal.margins?.tmpBytes ?? 'n/a'} |
| 25s | ${report.fixtures.worstNormal.margins?.durationMs ?? 'n/a'} | ${report.fixtures.worstNormal.margins?.memoryBytes ?? 'n/a'} | ${report.fixtures.worstNormal.margins?.tmpBytes ?? 'n/a'} |
`;
}

function firstLine(value) {
  return value.split(/\r?\n/, 1)[0].trim();
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function round(value) {
  return Math.round(value * 100) / 100;
}
