import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { authorizeReelForRender } from '../server/reel-renderer/authorization.js';
import { buildReelRenderManifest } from '../server/reel-renderer/manifest.js';
import { createProductionReelRenderer } from '../server/reel-sandbox-runtime/config.js';
import {
  reelSandboxCoverPath,
  reelSandboxErrorPath,
  reelSandboxRenderTimeoutMs,
  reelSandboxResultPath,
  reelSandboxRunnerPath,
  reelSandboxSessionTimeoutMs,
  reelSandboxVideoMaxBytes,
  reelSandboxVideoPath,
} from '../server/reel-sandbox-runtime/contracts.js';
import { createSandboxRenderAdapter } from '../server/reel-sandbox-runtime/renderer.js';
import { reauthorizeSerializedAuthority } from '../server/reel-sandbox-runner/runner.js';
import { sandboxFixtureAssets, sandboxFixtureAuthority } from './reel-sandbox-fixture.mjs';

let checks = 0;
function check(fn) { fn(); checks += 1; }
async function checkAsync(fn) { await fn(); checks += 1; }

const image = `servicescope-reel-renderer:v2-${'a'.repeat(40)}`;
const serializedAuthority = JSON.stringify(sandboxFixtureAuthority);
const authoritySha256 = sha256(serializedAuthority);
const reauthorized = reauthorizeSerializedAuthority(serializedAuthority, authoritySha256);
check(() => assert.doesNotThrow(() => buildReelRenderManifest(reauthorized, sandboxFixtureAssets)));
check(() => assert.throws(() => buildReelRenderManifest(sandboxFixtureAuthority.plan, sandboxFixtureAssets), /REEL_RENDER_UNAUTHORIZED/));

for (const mutate of [
  (value) => { value.plan.claims[0].text = 'Unsupported replacement claim'; },
  (value) => { value.context.evidence[0].text = 'Changed evidence'; },
  (value) => { value.plan.scenes[0].attachmentId = 'photo-b'; },
  (value) => { value.plan.safety.ok = false; },
  (value) => { value.plan.revision = 'changed-revision'; },
]) {
  const value = structuredClone(sandboxFixtureAuthority);
  mutate(value);
  check(() => assert.throws(
    () => reauthorizeSerializedAuthority(JSON.stringify(value), authoritySha256),
    /REEL_RENDER_INVALID_PLAN/,
  ));
}

check(() => assert.throws(() => createProductionReelRenderer({ REEL_RENDER_ENABLED: 'true' }), /REEL_RENDER_SERVICE_UNAVAILABLE/));
check(() => assert.throws(() => createProductionReelRenderer({ REEL_RENDER_ENABLED: 'true', REEL_RENDER_RUNTIME: 'local' }), /REEL_RENDER_SERVICE_UNAVAILABLE/));
check(() => assert.throws(() => createProductionReelRenderer({ REEL_RENDER_ENABLED: 'true', REEL_RENDER_RUNTIME: 'sandbox', REEL_RENDER_SANDBOX_IMAGE: 'servicescope-reel-renderer:latest' }), /REEL_RENDER_SERVICE_UNAVAILABLE/));
check(() => assert.equal(typeof createProductionReelRenderer({
  REEL_RENDER_ENABLED: 'true', REEL_RENDER_RUNTIME: 'sandbox', REEL_RENDER_SANDBOX_IMAGE: image,
}, { createSandbox: async () => ({}) }), 'function'));

await sandboxSuccessAndIntegrity();
await sandboxFailureCoverage();
await oversizedInputBeforeCreate();

console.log(`Reel Sandbox runtime tests passed (${checks}/${checks}).`);

async function sandboxSuccessAndIntegrity() {
  const fixture = await adapterFixture();
  try {
    const output = await fixture.render(fixture.input);
    check(() => assert.deepEqual(fixture.calls.createOptions, {
      image,
      resources: { vcpus: 1 },
      persistent: false,
      timeout: reelSandboxSessionTimeoutMs,
      networkPolicy: 'deny-all',
    }));
    check(() => assert.deepEqual(fixture.calls.command, {
      cmd: '/usr/local/bin/node', args: [reelSandboxRunnerPath], cwd: '/vercel/sandbox/reel', timeoutMs: reelSandboxRenderTimeoutMs,
    }));
    check(() => assert.equal(fixture.calls.create, 1));
    check(() => assert.equal(fixture.calls.run, 1));
    check(() => assert.equal(fixture.calls.stop, 1));
    check(() => assert.equal(fixture.calls.write, 1));
    check(() => assert.equal(Object.hasOwn(fixture.calls.createOptions, 'ports'), false));
    check(() => assert.equal(Object.hasOwn(fixture.calls.createOptions, 'env'), false));
    check(() => assert.doesNotMatch(JSON.stringify(fixture.calls.files), /SUPABASE|SERVICE_ROLE|https?:\/\//i));
    await checkAsync(async () => assert.equal((await readFile(output.videoPath)).length, fixture.video.length));
    await checkAsync(async () => assert.equal((await readFile(output.coverPath)).length, fixture.cover.length));
    await output.dispose();
  } finally {
    await fixture.dispose();
  }
}

async function sandboxFailureCoverage() {
  for (const [failure, expected, expectedStop] of [
    ['create', /REEL_RENDER_SERVICE_UNAVAILABLE/, 0],
    ['write', /REEL_RENDER_SERVICE_UNAVAILABLE/, 1],
    ['run-transport', /REEL_RENDER_SERVICE_UNAVAILABLE/, 1],
    ['run-infra', /REEL_RENDER_SERVICE_UNAVAILABLE/, 1],
    ['run-deterministic', /REEL_RENDER_INVALID_PLAN/, 1],
    ['missing-result', /REEL_RENDER_SERVICE_UNAVAILABLE/, 1],
    ['missing-cover', /REEL_RENDER_SERVICE_UNAVAILABLE/, 1],
    ['hash-mismatch', /REEL_RENDER_OUTPUT_INVALID/, 1],
    ['renderer-mismatch', /REEL_RENDER_SERVICE_UNAVAILABLE/, 1],
    ['oversized-output', /REEL_RENDER_OUTPUT_INVALID/, 1],
    ['stop', /REEL_RENDER_SERVICE_UNAVAILABLE/, 1],
  ]) {
    const fixture = await adapterFixture({ failure });
    try {
      await checkAsync(() => assert.rejects(fixture.render(fixture.input), expected));
      check(() => assert.equal(fixture.calls.create, 1));
      check(() => assert.equal(fixture.calls.stop, expectedStop));
      if (failure !== 'create' && failure !== 'write' && failure !== 'run-transport') {
        check(() => assert.equal(fixture.calls.run, 1));
      }
    } finally {
      await fixture.dispose();
    }
  }
}

async function oversizedInputBeforeCreate() {
  const fixture = await adapterFixture();
  try {
    await writeFile(join(fixture.stagingRoot, 'asset-1.bin'), Buffer.alloc(12_000_001));
    await checkAsync(() => assert.rejects(fixture.render(fixture.input), /REEL_RENDER_MEDIA_INVALID/));
    check(() => assert.equal(fixture.calls.create, 0));
  } finally {
    await fixture.dispose();
  }
}

async function adapterFixture({ failure } = {}) {
  const stagingRoot = await mkdtemp(join(tmpdir(), 'servicescope-sandbox-adapter-test-'));
  const outputRoots = [];
  const stagedAssets = [];
  for (let index = 0; index < 3; index += 1) {
    const path = `asset-${index + 1}.bin`;
    await writeFile(join(stagingRoot, path), Buffer.from(`asset-${index + 1}`));
    stagedAssets.push({ attachmentId: `photo-${String.fromCharCode(97 + index)}`, path });
  }
  const video = Buffer.alloc(24_000, 7);
  const cover = Buffer.alloc(2_000, 9);
  const result = Buffer.from(JSON.stringify({
    rendererVersion: failure === 'renderer-mismatch' ? 'servicescope-reel-renderer-v1' : 'servicescope-reel-renderer-v2', durationMs: 13_800,
    width: 1080, height: 1920, fps: 30, videoCodec: 'h264', pixelFormat: 'yuv420p',
    audioStreams: 0, fileSize: video.length, faststart: true,
    videoSha256: failure === 'hash-mismatch' ? '0'.repeat(64) : sha256(video), coverSha256: sha256(cover),
  }));
  const files = new Map([[reelSandboxResultPath, result], [reelSandboxVideoPath, video], [reelSandboxCoverPath, cover]]);
  if (failure === 'missing-result') files.delete(reelSandboxResultPath);
  if (failure === 'missing-cover') files.delete(reelSandboxCoverPath);
  if (failure === 'run-deterministic') files.set(reelSandboxErrorPath, Buffer.from('{"code":"REEL_RENDER_INVALID_PLAN"}'));
  const calls = { create: 0, write: 0, run: 0, stop: 0 };
  const sandbox = {
    async writeFiles(value) { calls.write += 1; calls.files = value; if (failure === 'write') throw new Error('transport'); },
    async runCommand(value) {
      calls.run += 1; calls.command = value;
      if (failure === 'run-transport') throw new Error('transport');
      return { exitCode: failure === 'run-infra' || failure === 'run-deterministic' ? 1 : 0 };
    },
    async downloadFile({ path }, { path: destination }) {
      const bytes = files.get(path);
      if (!bytes) return null;
      await mkdir(dirname(destination), { recursive: true });
      if (failure === 'oversized-output' && path === reelSandboxVideoPath) {
        await writeFile(destination, Buffer.alloc(1));
        await truncate(destination, reelSandboxVideoMaxBytes + 1);
      } else {
        await writeFile(destination, bytes);
      }
      return destination;
    },
    async stop() { calls.stop += 1; if (failure === 'stop') throw new Error('stop'); },
  };
  const createSandbox = async (options) => {
    calls.create += 1;
    calls.createOptions = options;
    if (failure === 'create') throw new Error('create');
    return sandbox;
  };
  const render = createSandboxRenderAdapter({
    image,
    createSandbox,
    createOutputRoot: async () => {
      const root = await mkdtemp(join(tmpdir(), 'servicescope-sandbox-download-test-'));
      outputRoots.push(root);
      return root;
    },
  });
  return {
    calls, render, video, cover, stagingRoot,
    input: { authorized: {}, authority: sandboxFixtureAuthority, stagedAssets, stagingRoot },
    async dispose() {
      await rm(stagingRoot, { recursive: true, force: true });
      for (const root of outputRoots) await rm(root, { recursive: true, force: true });
    },
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
