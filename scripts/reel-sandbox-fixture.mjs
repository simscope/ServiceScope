import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { reelSandboxAssetSchemaVersion } from '../server/reel-sandbox-runtime/contracts.js';

export const sandboxFixturePlan = {
  schemaVersion: 'reel-creative-plan-v1',
  revision: 'reel-sandbox-fixture-v2',
  decision: 'create_reel',
  qualityScore: 88,
  qualityReasons: ['Clear service story with distinct visual coverage.'],
  marketingAngle: 'repair_process',
  hook: { text: 'See this service transformation', evidenceIds: ['diagnosis'] },
  cover: { title: 'Service transformation', attachmentId: 'photo-a' },
  scenes: [
    scene('scene-1', 1, 'photo-a', 'See this service transformation', 'A clear starting point', 'slow_zoom_in', 'cover_center', 'crossfade'),
    scene('scene-2', 2, 'photo-b', 'Careful work in progress', 'A controlled service sequence', 'pan_left', 'subject_center', 'quick_fade'),
    scene('scene-3', 3, 'photo-c', 'Ready for the next call', 'The finished equipment view', 'focus_detail', 'detail_crop', 'crossfade'),
  ],
  caption: { text: 'A clear service story built from the approved job media, from the starting view through the work and the finished equipment.', evidenceIds: ['diagnosis'] },
  voiceover: { enabled: false, script: '', evidenceIds: [] },
  missingShots: [],
  claims: [{ id: 'claim-1', text: 'Service transformation', evidenceIds: ['diagnosis'] }],
  safety: { ok: true, privacy: 'passed', grounding: 'passed', quality: 'passed', blockedReasons: [] },
  brand: { enabled: true, displayName: 'Northstar Service', cta: 'Book dependable service', durationMs: 1_800, evidenceIds: ['company-public-display-name', 'company-voice-cta'] },
  audio: { musicMode: 'none' },
};

export const sandboxFixtureContext = {
  privateValuesForLeakDetection: [],
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

export const sandboxFixtureAuthority = { plan: sandboxFixturePlan, context: sandboxFixtureContext };
export const sandboxFixtureAssets = [
  { attachmentId: 'photo-a', path: 'input/asset-1.bin' },
  { attachmentId: 'photo-b', path: 'input/asset-2.bin' },
  { attachmentId: 'photo-c', path: 'input/asset-3.bin' },
];

export async function writeSandboxContainerFixture(root) {
  const input = join(root, 'input');
  const output = join(root, 'output');
  await mkdir(input, { recursive: true });
  await mkdir(output, { recursive: true });
  const authorityJson = JSON.stringify(sandboxFixtureAuthority);
  await writeFile(join(root, 'authority.json'), authorityJson);
  const rows = [];
  const imageFixtures = [
    ['#154c79', '#d7f49a', 'UNIT A', 'jpeg'],
    ['#1f6f50', '#ffffff', 'SERVICE STEP', 'png'],
    ['#8a3f2d', '#ffe38a', 'FINISHED UNIT', 'webp'],
  ];
  for (let index = 0; index < imageFixtures.length; index += 1) {
    const [background, accent, label, format] = imageFixtures[index];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="${background}"/><circle cx="800" cy="540" r="310" fill="${accent}"/><rect x="470" y="330" width="660" height="430" rx="48" fill="#101820" fill-opacity=".72"/><text x="800" y="940" text-anchor="middle" font-family="Arial" font-size="92" font-weight="700" fill="#fff">${label}</text></svg>`;
    let pipeline = sharp(Buffer.from(svg));
    if (format === 'jpeg') pipeline = pipeline.jpeg({ quality: 92 });
    else if (format === 'webp') pipeline = pipeline.webp({ quality: 92 });
    else pipeline = pipeline.png();
    const path = join(input, `asset-${index + 1}.bin`);
    await pipeline.toFile(path);
    const bytes = await readFile(path);
    rows.push({
      attachmentId: sandboxFixtureAssets[index].attachmentId,
      path: sandboxFixtureAssets[index].path,
      size: bytes.length,
      sha256: sha256(bytes),
    });
  }
  await writeFile(join(root, 'assets.json'), JSON.stringify({
    schemaVersion: reelSandboxAssetSchemaVersion,
    authoritySha256: sha256(authorityJson),
    assets: rows,
  }));
}

function scene(id, position, attachmentId, overlayText, secondaryText, motionPreset, cropStrategy, transitionOut) {
  return {
    id,
    position,
    attachmentId,
    sceneRole: position === 1 ? 'overview' : position === 2 ? 'repair_process' : 'finished_result',
    durationMs: 4_000,
    overlayText,
    secondaryText,
    motionPreset,
    cropStrategy,
    transitionOut,
    evidenceIds: [`media:${attachmentId}:finding`],
    voiceoverLine: null,
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
