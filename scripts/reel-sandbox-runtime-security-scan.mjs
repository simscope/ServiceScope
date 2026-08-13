import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const adapter = read('server/reel-sandbox-runtime/renderer.js');
const config = read('server/reel-sandbox-runtime/config.js');
const runner = read('server/reel-sandbox-runner/runner.js');
const entrypoint = read('server/reel-sandbox-runner/run.mjs');
const dockerfile = read('infra/reel-render-sandbox/Dockerfile');
const queue = read('api/queues/reel-render.js');
const contracts = read('server/reel-render-jobs/contracts.js');
let checks = 0;
const check = (fn) => { fn(); checks += 1; };

check(() => assert.match(config, /REEL_RENDER_RUNTIME !== 'sandbox'/));
check(() => assert.match(config, /REEL_RENDER_SANDBOX_IMAGE/));
check(() => assert.doesNotMatch(config, /FFMPEG_BIN|FFPROBE_BIN|runtime:\s*'node'/));
check(() => assert.match(queue, /render: createProductionReelRenderer\(process\.env\)/));
check(() => assert.match(adapter, /resources: \{ vcpus: 1 \}/));
check(() => assert.match(adapter, /persistent: false/));
check(() => assert.match(adapter, /networkPolicy: 'deny-all'/));
check(() => assert.match(adapter, /timeout: reelSandboxSessionTimeoutMs/));
check(() => assert.doesNotMatch(adapter, /ports:|domain\(|openInteractive|shell:\s*true|exec\(|spawn\(/));
check(() => assert.match(adapter, /cmd: '\/usr\/local\/bin\/node'/));
check(() => assert.match(adapter, /args: \[reelSandboxRunnerPath\]/));
check(() => assert.match(adapter, /sandbox\.downloadFile/));
check(() => assert.match(adapter, /sha256File\(videoPath\) !== result\.videoSha256/));
check(() => assert.match(adapter, /sha256File\(coverPath\) !== result\.coverSha256/));
check(() => assert.match(adapter, /await sandbox\.stop\(\)/));
check(() => assert.doesNotMatch(`${adapter}\n${runner}`, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|VERCEL_TOKEN|OPENAI_API_KEY|META_APP_SECRET/));
check(() => assert.doesNotMatch(`${adapter}\n${runner}`, /https?:\/\//));
check(() => assert.match(runner, /authorize\(\{ plan: authority\.plan, context: authority\.context \}\)/));
check(() => assert.match(runner, /ffmpegBin: '\/usr\/bin\/ffmpeg'/));
check(() => assert.match(runner, /ffprobeBin: '\/usr\/bin\/ffprobe'/));
check(() => assert.match(runner, /timeoutMs: reelSandboxRenderTimeoutMs/));
check(() => assert.match(runner, /sha256\(serialized\) !== expectedSha256/));
check(() => assert.match(entrypoint, /executeSandboxRunner\(\)/));
check(() => assert.doesNotMatch(entrypoint, /listen|serve|http/i));
check(() => assert.match(contracts, /messageFields = new Set\(\['schemaVersion', 'renderJobId'\]\)/));
check(() => assert.match(dockerfile, /^FROM node:22-bookworm-slim@sha256:[0-9a-f]{64}$/m));
check(() => assert.match(dockerfile, /ffmpeg[\s\\]+fonts-dejavu-core[\s\\]+fonts-liberation2/));
check(() => assert.doesNotMatch(dockerfile, /ffmpeg-static|@ffmpeg-installer|curl|wget|\.env|Dockerfile\.vercel/i));
check(() => assert.match(dockerfile, /USER node/));
check(() => {
  let hasSecondParent = false;
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD^2'], { stdio: 'ignore' });
    hasSecondParent = true;
  } catch {
    // A normal branch commit has one parent; GitHub's synthetic PR merge has two.
  }
  const range = hasSecondParent ? ['HEAD^1', 'HEAD^2'] : ['HEAD^', 'HEAD'];
  assert.equal(execFileSync('git', ['diff', '--name-only', ...range, '--', 'server/reel-renderer'], { encoding: 'utf8' }).trim(), '');
});

console.log(`Reel Sandbox runtime security scan passed (${checks}/${checks}).`);
