import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const rendererFiles = [
  'server/reel-renderer/authorization.js',
  'server/reel-renderer/assets.js',
  'server/reel-renderer/errors.js',
  'server/reel-renderer/index.js',
  'server/reel-renderer/manifest.js',
  'server/reel-renderer/overlays.js',
  'server/reel-renderer/probe.js',
  'server/reel-renderer/process.js',
  'server/reel-renderer/renderer.js',
  'server/reel-renderer/textLayout.js',
];
const browserFiles = [
  'src/components/portal/ReelPreview.tsx',
  'src/features/reel-director/clientApi.ts',
  'src/features/reel-director/contracts.ts',
  'src/features/reel-director/reelState.ts',
  'src/features/reel-director/presentationSpec.js',
];
const renderer = (await Promise.all(rendererFiles.map((file) => readFile(file, 'utf8')))).join('\n');
const browser = (await Promise.all(browserFiles.map((file) => readFile(file, 'utf8')))).join('\n');
const manifest = await readFile('server/reel-renderer/manifest.js', 'utf8');
const authorization = await readFile('server/reel-renderer/authorization.js', 'utf8');
const processSource = await readFile('server/reel-renderer/process.js', 'utf8');
const rendererSource = await readFile('server/reel-renderer/renderer.js', 'utf8');
const overlays = await readFile('server/reel-renderer/overlays.js', 'utf8');
const textLayout = await readFile('server/reel-renderer/textLayout.js', 'utf8');
const errors = await readFile('server/reel-renderer/errors.js', 'utf8');
const packageJson = await readFile('package.json', 'utf8');
let checks = 0;
function check(fn) { fn(); checks += 1; }

check(() => assert.doesNotMatch(browser, /server\/reel-renderer|node:child_process|node:fs|FFMPEG_BIN|FFPROBE_BIN|spawn\(/));
check(() => assert.doesNotMatch(browser, /authorizeReelForRender|renderAuthorizedReel|REEL_RENDER_UNAUTHORIZED|authorizedPlans/));
check(() => assert.doesNotMatch(renderer, /META_(?:APP_SECRET|TOKEN)|OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|sb_secret_|graph\.facebook\.com/i));
check(() => assert.doesNotMatch(renderer, /\bfetch\s*\(|XMLHttpRequest|axios|node:https|node:http/));
check(() => assert.doesNotMatch(renderer, /\bexec(?:File|Sync)?\s*\(|shell\s*:\s*true|`ffmpeg\s|drawtext/i));
check(() => assert.match(processSource, /spawn\(executable, args/));
check(() => assert.match(processSource, /shell:\s*false/));
check(() => assert.match(processSource, /maxCapturedBytes/));
check(() => assert.match(processSource, /child\.kill\('SIGKILL'\)/));
check(() => assert.match(rendererSource, /finally\s*\{[\s\S]*rm\(workDir/));
check(() => assert.match(rendererSource, /renderAuthorizedReel\(\{\s*authorized,/));
check(() => assert.doesNotMatch(rendererSource, /export async function renderReel\b|\{\s*plan,\s*stagedAssets/));
check(() => assert.match(authorization, /parseReelPlanShape\(providerPlan\)[\s\S]*validateReelPlan\(canonicalPlan, context\)/));
check(() => assert.match(authorization, /const authorizedPlans = new WeakMap\(\)/));
check(() => assert.doesNotMatch(authorization, /export\s+(?:const|let|var|class)\s+(?:authorizedPlans|authorizationMarker|authorizationSymbol)/));
check(() => assert.match(authorization, /authorizedPlans\.set\(authorization, deepFreeze/));
check(() => assert.match(authorization, /REEL_RENDER_AUDIO_UNSUPPORTED/));
check(() => assert.doesNotMatch(authorization, /plan\.safety\.|revision\.(?:startsWith|includes)|revision.{0,40}(?:signed|unforgeable|authenticated)/i));
check(() => assert.match(manifest, /requireAuthorizedReelPlan\(authorization\)/));
check(() => assert.doesNotMatch(manifest, /validateReelPlan|parseReelPlanShape|context\.|privateValues|diagnosis|complaint|repair-performed|final-result/i));
check(() => assert.doesNotMatch(manifest, /return\s*\{\s*manifest,\s*sourcePaths,\s*plan/));
check(() => assert.doesNotMatch(manifest, /customerName|customerEmail|customerPhone|streetAddress|jobNumber|storagePath|signedUrl|token|credential/i));
check(() => assert.doesNotMatch(manifest, /https?:\/\//i));
check(() => assert.doesNotMatch(rendererSource, /scene\.overlayText|scene\.secondaryText|brand\.displayName|brand\.cta/));
check(() => assert.match(textLayout, /https\?:\|href\\s\*=/));
check(() => assert.match(overlays, /<script\|<foreignObject\|<image\|href/));
check(() => assert.match(textLayout, /replaceAll\('&', '&amp;'\)/));
check(() => assert.match(textLayout, /replaceAll\('<', '&lt;'\)/));
check(() => assert.match(textLayout, /sharp\(Buffer\.from\(svg\)/));
check(() => assert.match(textLayout, /trim\(\{ background:/));
check(() => assert.doesNotMatch(`${overlays}\n${textLayout}`, /maxCharacters|word\.length\s*>|wrapText\(/));
check(() => assert.match(errors, /REEL_RENDER_AUDIO_UNSUPPORTED/));
check(() => assert.match(errors, /REEL_RENDER_TEXT_OVERFLOW/));
check(() => assert.match(authorization, /canonicalPlan\.voiceover\.enabled[\s\S]*REEL_RENDER_AUDIO_UNSUPPORTED/));
check(() => assert.doesNotMatch(`${manifest}\n${overlays}`, /sceneRoleLabel|reel-preview-role|Overview|Detail|Process|Part|Result|Context/));
check(() => assert.doesNotMatch(packageJson, /ffmpeg-static|shotstack|remotion|creatomate|canva|runway|kling|sora/i));
check(() => assert.match(rendererSource, /'-an'/));
check(() => assert.match(rendererSource, /'libx264'/));
check(() => assert.match(rendererSource, /'\+faststart'/));
check(() => assert.doesNotMatch(renderer, /outputPath\s*[:=].*input|destinationDir|outputDir\s*=.*(?:request|options)/i));

const trackedRendererMedia = execFileSync('git', ['ls-files', 'server', 'shared', 'scripts'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter((file) => /(?:fixture-reel\.mp4|fixture-cover\.jpg|fixture-(?:hook|middle|brand|long|russian|spanish).*\.jpg)$/i.test(file));
check(() => assert.deepEqual(trackedRendererMedia, []));

const dist = await readDistJavaScript();
check(() => assert.doesNotMatch(dist, /server\/reel-renderer|node:child_process|FFMPEG_BIN|FFPROBE_BIN|libx264|reel-render-manifest-v1|authorizeReelForRender|renderAuthorizedReel/i));

console.log(`Reel renderer security scan passed (${checks}/${checks}).`);

async function readDistJavaScript() {
  try {
    const files = await readdir('dist/assets');
    return (await Promise.all(files.filter((file) => file.endsWith('.js')).map((file) => readFile(`dist/assets/${file}`, 'utf8')))).join('\n');
  } catch {
    return '';
  }
}
