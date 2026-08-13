import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Sandbox } from '@vercel/sandbox';
import sharp from 'sharp';
import {
  parseSandboxResultJson,
  reelSandboxCoverPath,
  reelSandboxResultPath,
  reelSandboxRoot,
  reelSandboxRunnerPath,
  reelSandboxVideoPath,
} from '../server/reel-sandbox-runtime/contracts.js';
import { writeSandboxContainerFixture } from './reel-sandbox-fixture.mjs';

const MAIN_SOURCE_SHA = '293c48a34aea465c22a17762e53d341ba22b5b1d';
const QUALIFICATION_BRANCH = 'codex/reel-vcr-preview-qualification';
const TEAM_SLUG = 'andrei-simanenkas-projects';
const PROJECT_SLUG = 'servicescope';
const PROJECT_ID = 'prj_Dpz3ezW4P3tghwhGwd69nItK9PL0';
const OIDC_AUDIENCE = `https://vercel.com/${TEAM_SLUG}`;
const OIDC_SUBJECT = `owner:${TEAM_SLUG}:project:${PROJECT_SLUG}:environment:preview`;
const IMAGE_REPOSITORY = 'servicescope-reel-renderer';
const IMAGE_TAG_NAME = `v2-${MAIN_SOURCE_SHA}`;
const FULL_IMAGE_TAG = `vcr.vercel.com/${TEAM_SLUG}/${PROJECT_SLUG}/${IMAGE_REPOSITORY}:${IMAGE_TAG_NAME}`;
const BASE_IMAGE_DIGEST = 'sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436';
const BUILD_CONTEXT_ROOT = '/vercel/sandbox/build-context';
const DOCKER_CONFIG = '/tmp/servicescope-vcr-docker-auth';
const EXPECTED_DURATION_MS = 13_800;
const MANIFEST_PATH = resolve('scripts/reel-vcr-source-manifest.json');
const DOCKERFILE_PATH = resolve('infra/reel-render-sandbox/Dockerfile');
const sensitiveEnvironmentNames = /^(?:SUPABASE_(?:SERVICE_ROLE_KEY|ACCESS_TOKEN)|OPENAI_API_KEY|META_.+(?:TOKEN|SECRET|KEY)|FACEBOOK_.+(?:TOKEN|SECRET|KEY)|VERCEL_OIDC_TOKEN|VCR_.+(?:TOKEN|SECRET|KEY)|DATABASE_URL)$/i;

let redactionSecret = '';

class QualificationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function main() {
  if (process.argv.includes('--verify-source')) {
    const manifest = await verifySourceManifest();
    process.stdout.write(`${JSON.stringify({ mainSourceSha: manifest.mainSourceSha, sourceManifestVerified: true, files: manifest.files.length })}\n`);
    return;
  }

  if (process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'preview') return;
  if (process.env.VERCEL_GIT_COMMIT_REF !== QUALIFICATION_BRANCH) {
    throw new QualificationError('QUALIFICATION_REF_MISMATCH', 'Preview qualification branch mismatch.');
  }

  const oidcToken = process.env.VERCEL_OIDC_TOKEN;
  if (!oidcToken) throw new QualificationError('OIDC_TOKEN_MISSING', 'Vercel Preview OIDC token is unavailable.');
  redactionSecret = oidcToken;
  assertPreviewIdentity(oidcToken);

  const manifest = await verifySourceManifest();
  let builder;
  let renderer;
  let builderStopped = false;
  let rendererStopped = false;
  let builderSnapshotCreated = false;
  let rendererSnapshotCreated = false;
  let builderSandboxId;
  let rendererSandboxId;
  let imageDigest;
  let imageId;
  let architecture;
  let ffmpegVersion;
  let rendererResult;
  let rendererExitCode;
  let rendererWallMs;
  let networkBlocked = false;
  let sensitiveEnvAbsent = false;
  let parentHashesVerified = false;
  let visualSanity = 'FAIL';
  let fixtureRoot;

  try {
    builder = await Sandbox.create({
      runtime: 'node22',
      resources: { vcpus: 2 },
      persistent: false,
      ports: [],
      timeout: 1_200_000,
      env: { VERCEL_OIDC_TOKEN: oidcToken },
    });
    builderSandboxId = builder.name;
    assert.equal(builder.persistent, false, 'Builder Sandbox must be non-persistent.');
    assert.equal(builder.vcpus, 2, 'Builder Sandbox must have 2 vCPUs.');
    assert.equal(builder.memory, 4096, 'Builder Sandbox must have 4 GB RAM.');

    await transferBuildContext(builder, manifest);
    await verifyTransferredFiles(builder, manifest.files, BUILD_CONTEXT_ROOT, 'BUILD_CONTEXT_TRANSFER_INVALID');
    await installDocker(builder);
    await dockerLogin(builder);

    const existing = await inspectRemoteManifest(builder, FULL_IMAGE_TAG, true);
    if (existing.exists) {
      throw new QualificationError(
        'META_PHASE_5D3F_PREVIEW_BOOTSTRAP_TAG_ALREADY_EXISTS',
        `Exact qualification tag already exists at ${existing.digest ?? 'an immutable digest'}.`,
      );
    }

    const built = await buildAndValidateImage(builder);
    imageId = built.imageId;
    architecture = built.architecture;
    ffmpegVersion = built.ffmpegVersion;

    const push = await runChecked(builder, {
      sudo: true,
      cmd: 'docker',
      args: ['push', FULL_IMAGE_TAG],
      env: { DOCKER_CONFIG },
      timeoutMs: 300_000,
    }, 'VCR_PUSH_FAILED');
    const pushOutput = await commandOutput(push);
    imageDigest = pushOutput.match(/digest:\s*(sha256:[a-f0-9]{64})/i)?.[1]?.toLowerCase();
    if (!imageDigest) throw new QualificationError('VCR_PUSH_DIGEST_MISSING', 'Registry push did not return an OCI digest.');

    const tagged = await inspectRemoteManifest(builder, FULL_IMAGE_TAG, false);
    if (tagged.digest !== imageDigest) throw new QualificationError('VCR_TAG_DIGEST_MISMATCH', 'Pushed tag digest does not match registry digest.');
    const fullDigestReference = `vcr.vercel.com/${TEAM_SLUG}/${PROJECT_SLUG}/${IMAGE_REPOSITORY}@${imageDigest}`;
    await runChecked(builder, {
      sudo: true,
      cmd: 'docker',
      args: ['pull', fullDigestReference],
      env: { DOCKER_CONFIG },
      timeoutMs: 300_000,
    }, 'VCR_DIGEST_PULL_FAILED');
    const pulled = await inspectLocalImage(builder, fullDigestReference);
    if (pulled.architecture !== 'amd64' || !pulled.repoDigests.includes(fullDigestReference)) {
      throw new QualificationError('VCR_DIGEST_INSPECT_FAILED', 'Digest-pulled image identity or architecture is invalid.');
    }
    imageId = pulled.imageId;
    architecture = `linux/${pulled.architecture}`;

    await dockerLogout(builder);
    const builderFinal = await builder.stop();
    builderStopped = true;
    builderSnapshotCreated = Boolean(builderFinal.snapshot);
    builder = undefined;
    if (builderSnapshotCreated) throw new QualificationError('BUILDER_SNAPSHOT_CREATED', 'Non-persistent builder unexpectedly created a snapshot.');

    fixtureRoot = await mkdtemp(join(tmpdir(), 'servicescope-vcr-preview-fixture-'));
    await writeSandboxContainerFixture(fixtureRoot);
    const fixture = await readFixture(fixtureRoot);
    const canonicalImage = `${IMAGE_REPOSITORY}@${imageDigest}`;

    renderer = await Sandbox.create({
      image: canonicalImage,
      resources: { vcpus: 1 },
      persistent: false,
      networkPolicy: 'deny-all',
      timeout: 240_000,
      ports: [],
      env: {},
    });
    rendererSandboxId = renderer.name;
    assert.equal(renderer.persistent, false, 'Renderer Sandbox must be non-persistent.');
    assert.equal(renderer.vcpus, 1, 'Renderer Sandbox must have 1 vCPU.');
    assert.equal(renderer.memory, 2048, 'Renderer Sandbox must have 2 GB RAM.');
    assert.equal(renderer.image, canonicalImage, 'Renderer Sandbox must use the verified digest.');

    const networkProbe = await renderer.runCommand({
      cmd: '/usr/local/bin/node',
      args: ['-e', "const c=new AbortController();setTimeout(()=>c.abort(),5000);fetch('https://example.com',{signal:c.signal}).then(()=>process.exit(42)).catch(()=>process.exit(0));"],
      timeoutMs: 8_000,
    });
    networkBlocked = networkProbe.exitCode === 0;
    if (!networkBlocked) throw new QualificationError('RENDERER_NETWORK_POLICY_FAILED', 'Renderer Sandbox outbound network probe was not blocked.');

    const envNamesCommand = await runChecked(renderer, {
      cmd: '/usr/local/bin/node',
      args: ['-e', "process.stdout.write(Object.keys(process.env).sort().join('\\n'))"],
      timeoutMs: 5_000,
    }, 'RENDERER_ENV_INSPECTION_FAILED');
    const envNames = (await envNamesCommand.stdout()).split(/\r?\n/).filter(Boolean);
    sensitiveEnvAbsent = !envNames.some((name) => sensitiveEnvironmentNames.test(name));
    if (!sensitiveEnvAbsent) throw new QualificationError('RENDERER_SECRET_ENV_PRESENT', 'Renderer Sandbox received a prohibited environment variable name.');

    await renderer.writeFiles(fixture.files);
    await verifyTransferredFiles(renderer, fixture.entries, reelSandboxRoot, 'FIXTURE_TRANSFER_INVALID');
    const renderStart = Date.now();
    const renderCommand = await renderer.runCommand({
      cmd: '/usr/local/bin/node',
      args: [reelSandboxRunnerPath],
      cwd: reelSandboxRoot,
      timeoutMs: 210_000,
    });
    rendererWallMs = Date.now() - renderStart;
    rendererExitCode = renderCommand.exitCode;
    if (rendererExitCode !== 0) throw new QualificationError('RENDERER_EXECUTION_FAILED', 'Synthetic renderer command returned a non-zero exit code.');

    const resultPath = join(fixtureRoot, 'result.json');
    const videoPath = join(fixtureRoot, 'reel.mp4');
    const coverPath = join(fixtureRoot, 'cover.jpg');
    await downloadRequired(renderer, reelSandboxResultPath, resultPath);
    await downloadRequired(renderer, reelSandboxVideoPath, videoPath);
    await downloadRequired(renderer, reelSandboxCoverPath, coverPath);
    rendererResult = parseSandboxResultJson(await readFile(resultPath, 'utf8'));
    assert.equal(rendererResult.rendererVersion, 'servicescope-reel-renderer-v2');
    assert.equal(rendererResult.durationMs, EXPECTED_DURATION_MS);
    assert.deepEqual([rendererResult.width, rendererResult.height, rendererResult.fps], [1080, 1920, 30]);
    assert.equal(rendererResult.videoCodec, 'h264');
    assert.equal(rendererResult.pixelFormat, 'yuv420p');
    assert.equal(rendererResult.audioStreams, 0);
    assert.equal(rendererResult.faststart, true);

    const videoSha256 = await sha256File(videoPath);
    const coverSha256 = await sha256File(coverPath);
    parentHashesVerified = videoSha256 === rendererResult.videoSha256 && coverSha256 === rendererResult.coverSha256;
    if (!parentHashesVerified) throw new QualificationError('PARENT_HASH_VERIFICATION_FAILED', 'Downloaded output hashes do not match result.json.');

    await verifyWithFfprobe(renderer, rendererResult);
    const videoBytes = await readFile(videoPath);
    if (!(videoBytes.indexOf(Buffer.from('moov')) < videoBytes.indexOf(Buffer.from('mdat')))) {
      throw new QualificationError('FASTSTART_VERIFICATION_FAILED', 'MP4 moov atom is not before mdat.');
    }
    visualSanity = await verifySyntheticFrames(renderer, fixtureRoot);

    const rendererFinal = await renderer.stop();
    rendererStopped = true;
    rendererSnapshotCreated = Boolean(rendererFinal.snapshot);
    renderer = undefined;
    if (rendererSnapshotCreated) throw new QualificationError('RENDERER_SNAPSHOT_CREATED', 'Non-persistent renderer unexpectedly created a snapshot.');

    const videoStat = await stat(videoPath);
    const coverStat = await stat(coverPath);
    process.stdout.write(`${JSON.stringify({
      mainSourceSha: MAIN_SOURCE_SHA,
      sourceManifestVerified: true,
      builderSandboxId,
      builderStopped,
      imageRepository: IMAGE_REPOSITORY,
      imageTag: IMAGE_TAG_NAME,
      imageDigest,
      imageId,
      architecture,
      ffmpegVersion,
      rendererSandboxId,
      networkBlocked,
      sensitiveEnvAbsent,
      rendererExitCode,
      wallMs: rendererWallMs,
      durationMs: rendererResult.durationMs,
      videoCodec: rendererResult.videoCodec,
      width: rendererResult.width,
      height: rendererResult.height,
      fps: rendererResult.fps,
      pixelFormat: rendererResult.pixelFormat,
      audioStreams: rendererResult.audioStreams,
      faststart: rendererResult.faststart,
      videoBytes: videoStat.size,
      coverBytes: coverStat.size,
      videoSha256: rendererResult.videoSha256,
      coverSha256: rendererResult.coverSha256,
      parentHashesVerified,
      visualSanity,
      rendererStopped,
    })}\n`);
  } finally {
    if (renderer) {
      const final = await renderer.stop().catch(() => null);
      rendererStopped = Boolean(final);
      rendererSnapshotCreated ||= Boolean(final?.snapshot);
    }
    if (builder) {
      await dockerLogout(builder).catch(() => {});
      const final = await builder.stop().catch(() => null);
      builderStopped = Boolean(final);
      builderSnapshotCreated ||= Boolean(final?.snapshot);
    }
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
    if (builderSnapshotCreated || rendererSnapshotCreated) {
      throw new QualificationError('QUALIFICATION_SNAPSHOT_CREATED', 'A qualification Sandbox unexpectedly created a snapshot.');
    }
  }
}

function assertPreviewIdentity(token) {
  let claims;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('invalid token shape');
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new QualificationError('OIDC_TOKEN_INVALID', 'Vercel Preview OIDC token claims cannot be parsed.');
  }
  if (claims.aud !== OIDC_AUDIENCE || claims.sub !== OIDC_SUBJECT
    || claims.owner !== TEAM_SLUG || claims.project !== PROJECT_SLUG
    || claims.project_id !== PROJECT_ID || claims.environment !== 'preview') {
    throw new QualificationError('OIDC_IDENTITY_MISMATCH', 'Vercel Preview OIDC project identity does not match ServiceScope.');
  }
  if (process.env.VERCEL_PROJECT_ID && process.env.VERCEL_PROJECT_ID !== PROJECT_ID) {
    throw new QualificationError('VERCEL_PROJECT_ID_MISMATCH', 'Vercel build project ID does not match ServiceScope.');
  }
}

async function verifySourceManifest() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  assert.equal(manifest.schemaVersion, 'servicescope-reel-vcr-source-manifest-v1');
  assert.equal(manifest.mainSourceSha, MAIN_SOURCE_SHA);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
  const consumedPaths = await dockerfileConsumedFiles();
  const manifestPaths = manifest.files.map((entry) => entry.path).sort();
  assert.deepEqual(manifestPaths, consumedPaths, 'Source manifest must cover exactly every Dockerfile input.');
  for (const entry of manifest.files) {
    assert.match(entry.path, /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$)).+/);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    const filePath = resolve(entry.path);
    const fileStat = await lstat(filePath);
    assert.equal(fileStat.isFile(), true);
    assert.equal(fileStat.isSymbolicLink(), false);
    const content = await canonicalSourceBytes(filePath);
    assert.equal(content.length, entry.bytes);
    assert.equal(sha256(content), entry.sha256);
  }
  return manifest;
}

async function dockerfileConsumedFiles() {
  const dockerfile = await readFile(DOCKERFILE_PATH, 'utf8');
  assert.match(dockerfile, new RegExp(`^FROM node:22-bookworm-slim@${BASE_IMAGE_DIGEST.replace(':', '\\:')}$`, 'm'));
  const sources = ['infra/reel-render-sandbox/Dockerfile'];
  for (const line of dockerfile.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('COPY ')) continue;
    const tokens = trimmed.split(/\s+/).slice(1);
    assert.ok(tokens.length >= 2 && !tokens.some((token) => token.startsWith('--')), 'Unsupported Dockerfile COPY form.');
    for (const source of tokens.slice(0, -1)) sources.push(source.replace(/\/$/, ''));
  }
  const files = [];
  for (const source of sources) {
    const sourceStat = await lstat(resolve(source));
    if (sourceStat.isFile()) files.push(source.replaceAll('\\', '/'));
    else if (sourceStat.isDirectory()) files.push(...await filesUnder(source));
    else throw new QualificationError('SOURCE_INPUT_INVALID', `Unsupported Dockerfile input: ${source}`);
  }
  return [...new Set(files)].sort();
}

async function filesUnder(directory) {
  const root = resolve(directory);
  const output = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new QualificationError('SOURCE_SYMLINK_REJECTED', 'Docker build context cannot contain symlinks.');
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) output.push(relative(process.cwd(), path).split(sep).join('/'));
      else throw new QualificationError('SOURCE_INPUT_INVALID', 'Docker build context contains an unsupported filesystem entry.');
    }
  }
  await walk(root);
  return output;
}

async function transferBuildContext(builder, manifest) {
  const directories = [...new Set(manifest.files.map((entry) => dirname(`${BUILD_CONTEXT_ROOT}/${entry.path}`)))].sort();
  await builder.mkDir(BUILD_CONTEXT_ROOT);
  for (const directory of directories) await builder.mkDir(directory);
  await builder.writeFiles(await Promise.all(manifest.files.map(async (entry) => ({
    path: `${BUILD_CONTEXT_ROOT}/${entry.path}`,
    content: await canonicalSourceBytes(resolve(entry.path)),
  }))));
}

async function canonicalSourceBytes(path) {
  const content = await readFile(path);
  const decoded = content.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(content)) {
    throw new QualificationError('SOURCE_ENCODING_INVALID', 'Docker build inputs must be valid UTF-8 text files.');
  }
  const normalized = decoded.replaceAll('\r\n', '\n');
  if (normalized.includes('\r')) {
    throw new QualificationError('SOURCE_LINE_ENDINGS_INVALID', 'Docker build inputs contain unsupported carriage returns.');
  }
  return Buffer.from(normalized, 'utf8');
}

async function verifyTransferredFiles(sandbox, entries, remoteRoot, code) {
  const paths = entries.map((entry) => `${remoteRoot}/${entry.path.replace(/^input\//, 'input/')}`);
  const command = await runChecked(sandbox, { cmd: 'sha256sum', args: paths, timeoutMs: 30_000 }, code);
  const rows = new Map((await command.stdout()).trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
    if (!match) throw new QualificationError(code, 'Remote SHA-256 output is malformed.');
    return [match[2], match[1]];
  }));
  for (const entry of entries) {
    const path = `${remoteRoot}/${entry.path.replace(/^input\//, 'input/')}`;
    if (rows.get(path) !== entry.sha256) throw new QualificationError(code, `Remote SHA-256 mismatch for ${entry.path}.`);
  }
}

async function installDocker(builder) {
  await runChecked(builder, {
    sudo: true,
    cmd: 'dnf',
    args: ['install', '-y', 'docker'],
    timeoutMs: 240_000,
  }, 'DOCKER_INSTALL_FAILED');
  await builder.runCommand({ sudo: true, cmd: 'dockerd', detached: true });
  await runChecked(builder, {
    cmd: 'sh',
    args: ['-lc', 'until sudo docker info >/dev/null 2>&1; do sleep 1; done'],
    timeoutMs: 60_000,
  }, 'DOCKER_DAEMON_FAILED');
}

async function dockerLogin(builder) {
  await runChecked(builder, {
    sudo: true,
    cmd: 'sh',
    args: ['-lc', 'umask 077; mkdir -p "$DOCKER_CONFIG"; printf %s "$VERCEL_OIDC_TOKEN" | docker login vcr.vercel.com --username oidc --password-stdin'],
    env: { DOCKER_CONFIG },
    timeoutMs: 30_000,
  }, 'VCR_LOGIN_FAILED');
}

async function dockerLogout(builder) {
  await builder.runCommand({
    sudo: true,
    cmd: 'sh',
    args: ['-lc', 'docker logout vcr.vercel.com >/dev/null 2>&1 || true; rm -rf "$DOCKER_CONFIG"'],
    env: { DOCKER_CONFIG },
    timeoutMs: 15_000,
  });
}

async function inspectRemoteManifest(builder, reference, allowMissing) {
  const command = await builder.runCommand({
    sudo: true,
    cmd: 'docker',
    args: ['manifest', 'inspect', '--verbose', reference],
    env: { DOCKER_CONFIG },
    timeoutMs: 60_000,
  });
  const output = await commandOutput(command);
  if (command.exitCode !== 0) {
    if (allowMissing && /manifest unknown|no such manifest|not found/i.test(output)) return { exists: false };
    throw new QualificationError('VCR_MANIFEST_INSPECT_FAILED', safeText(output));
  }
  const value = JSON.parse(await command.stdout());
  const descriptor = Array.isArray(value) ? value[0]?.Descriptor : value.Descriptor;
  const digest = descriptor?.digest?.toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? '')) throw new QualificationError('VCR_MANIFEST_DIGEST_INVALID', 'Registry manifest digest is invalid.');
  return { exists: true, digest };
}

async function buildAndValidateImage(builder) {
  const buildx = await builder.runCommand({ sudo: true, cmd: 'docker', args: ['buildx', 'version'], timeoutMs: 20_000 });
  const args = buildx.exitCode === 0
    ? ['buildx', 'build', '--platform', 'linux/amd64', '--load', '--progress', 'plain', '--file', 'infra/reel-render-sandbox/Dockerfile', '--tag', FULL_IMAGE_TAG, '.']
    : ['build', '--platform', 'linux/amd64', '--file', 'infra/reel-render-sandbox/Dockerfile', '--tag', FULL_IMAGE_TAG, '.'];
  await runChecked(builder, {
    sudo: true,
    cmd: 'docker',
    args,
    cwd: BUILD_CONTEXT_ROOT,
    env: { DOCKER_CONFIG },
    timeoutMs: 720_000,
  }, 'DOCKER_BUILD_FAILED');

  const local = await inspectLocalImage(builder, FULL_IMAGE_TAG);
  if (local.architecture !== 'amd64') throw new QualificationError('IMAGE_ARCHITECTURE_INVALID', 'Built image is not linux/amd64.');
  await runChecked(builder, {
    sudo: true,
    cmd: 'docker',
    args: ['run', '--rm', '--entrypoint', '/bin/sh', FULL_IMAGE_TAG, '-lc', 'test -x /usr/bin/ffmpeg && test -x /usr/bin/ffprobe && test -f /app/server/reel-sandbox-runner/run.mjs'],
    timeoutMs: 30_000,
  }, 'IMAGE_REQUIRED_FILES_MISSING');

  const versionCommand = await runChecked(builder, {
    sudo: true,
    cmd: 'docker',
    args: ['run', '--rm', '--entrypoint', '/usr/local/bin/node', FULL_IMAGE_TAG, '--input-type=module', '--eval', "import('/app/server/reel-render-jobs/contracts.js').then(m=>process.stdout.write(m.reelRendererVersion))"],
    timeoutMs: 30_000,
  }, 'IMAGE_RENDERER_VERSION_INVALID');
  if ((await versionCommand.stdout()).trim() !== 'servicescope-reel-renderer-v2') {
    throw new QualificationError('IMAGE_RENDERER_VERSION_INVALID', 'Built image renderer contract is not v2.');
  }

  const ffmpeg = await runChecked(builder, {
    sudo: true,
    cmd: 'docker',
    args: ['run', '--rm', '--entrypoint', '/usr/bin/ffmpeg', FULL_IMAGE_TAG, '-version'],
    timeoutMs: 30_000,
  }, 'IMAGE_FFMPEG_INVALID');
  const ffmpegOutput = await ffmpeg.stdout();
  const ffmpegVersion = ffmpegOutput.split(/\r?\n/)[0]?.trim();
  if (!/^ffmpeg version 5\.1\.9-0\+deb12u1\b/.test(ffmpegVersion ?? '') || !/--enable-gpl\b/.test(ffmpegOutput) || !/--enable-libx264\b/.test(ffmpegOutput)) {
    throw new QualificationError('IMAGE_FFMPEG_INVALID', 'FFmpeg version, GPL flag, or libx264 support is invalid.');
  }
  const x264 = await runChecked(builder, {
    sudo: true,
    cmd: 'docker',
    args: ['run', '--rm', '--entrypoint', '/usr/bin/ffmpeg', FULL_IMAGE_TAG, '-hide_banner', '-loglevel', 'info', '-f', 'lavfi', '-i', 'color=size=16x16:rate=1', '-frames:v', '1', '-c:v', 'libx264', '-f', 'null', '-'],
    timeoutMs: 30_000,
  }, 'IMAGE_LIBX264_INVALID');
  if (!/x264\s+-\s+core\s+\d+/i.test(await x264.stderr())) throw new QualificationError('IMAGE_LIBX264_INVALID', 'libx264 runtime version was not reported.');

  const envCommand = await runChecked(builder, {
    sudo: true,
    cmd: 'docker',
    args: ['image', 'inspect', FULL_IMAGE_TAG, '--format', '{{json .Config.Env}}'],
    timeoutMs: 20_000,
  }, 'IMAGE_ENV_INSPECT_FAILED');
  const imageEnv = JSON.parse((await envCommand.stdout()).trim());
  if (imageEnv.some((row) => sensitiveEnvironmentNames.test(String(row).split('=')[0]))) {
    throw new QualificationError('IMAGE_SECRET_ENV_PRESENT', 'Built image contains a prohibited credential environment name.');
  }
  const envFiles = await runChecked(builder, {
    sudo: true,
    cmd: 'docker',
    args: ['run', '--rm', '--entrypoint', '/usr/bin/find', FULL_IMAGE_TAG, '/app', '-type', 'f', '-name', '.env*', '-print'],
    timeoutMs: 30_000,
  }, 'IMAGE_ENV_FILE_SCAN_FAILED');
  if ((await envFiles.stdout()).trim()) throw new QualificationError('IMAGE_ENV_FILE_PRESENT', 'Built image contains an .env file.');
  return { ...local, ffmpegVersion };
}

async function inspectLocalImage(builder, reference) {
  const command = await runChecked(builder, {
    sudo: true,
    cmd: 'docker',
    args: ['image', 'inspect', reference],
    env: { DOCKER_CONFIG },
    timeoutMs: 30_000,
  }, 'LOCAL_IMAGE_INSPECT_FAILED');
  const [value] = JSON.parse(await command.stdout());
  return {
    imageId: value.Id,
    architecture: value.Architecture,
    repoDigests: Array.isArray(value.RepoDigests) ? value.RepoDigests : [],
  };
}

async function readFixture(root) {
  const assetManifest = JSON.parse(await readFile(join(root, 'assets.json'), 'utf8'));
  const paths = ['authority.json', 'assets.json', ...assetManifest.assets.map((asset) => asset.path)];
  const entries = await Promise.all(paths.map(async (path) => {
    const content = await readFile(join(root, path));
    return { path, content, sha256: sha256(content), bytes: content.length };
  }));
  return {
    entries,
    files: entries.map((entry) => ({ path: `${reelSandboxRoot}/${entry.path}`, content: entry.content })),
  };
}

async function downloadRequired(sandbox, source, destination) {
  const downloaded = await sandbox.downloadFile({ path: source }, { path: destination }, { mkdirRecursive: true });
  if (!downloaded) throw new QualificationError('RENDERER_OUTPUT_MISSING', `Required renderer output is missing: ${source}`);
}

async function verifyWithFfprobe(renderer, result) {
  const command = await runChecked(renderer, {
    cmd: '/usr/bin/ffprobe',
    args: ['-v', 'error', '-show_entries', 'format=duration', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt', '-of', 'json', reelSandboxVideoPath],
    cwd: reelSandboxRoot,
    timeoutMs: 30_000,
  }, 'FFPROBE_VERIFICATION_FAILED');
  const probe = JSON.parse(await command.stdout());
  const videoStreams = probe.streams.filter((stream) => stream.codec_type === 'video');
  const audioStreams = probe.streams.filter((stream) => stream.codec_type === 'audio');
  const video = videoStreams[0];
  if (videoStreams.length !== 1 || audioStreams.length !== 0 || video.codec_name !== 'h264'
    || video.width !== 1080 || video.height !== 1920 || video.r_frame_rate !== '30/1'
    || video.pix_fmt !== 'yuv420p' || Math.abs(Number(probe.format.duration) * 1000 - result.durationMs) > 50) {
    throw new QualificationError('FFPROBE_VERIFICATION_FAILED', 'Independent FFprobe result does not match the renderer contract.');
  }
}

async function verifySyntheticFrames(renderer, root) {
  const times = ['1.0', '5.0', '9.0', '13.0'];
  for (let index = 0; index < times.length; index += 1) {
    await runChecked(renderer, {
      cmd: '/usr/bin/ffmpeg',
      args: ['-hide_banner', '-loglevel', 'error', '-ss', times[index], '-i', reelSandboxVideoPath, '-frames:v', '1', `output/visual-${index + 1}.png`],
      cwd: reelSandboxRoot,
      timeoutMs: 30_000,
    }, 'VISUAL_FRAME_EXTRACTION_FAILED');
    await downloadRequired(renderer, `${reelSandboxRoot}/output/visual-${index + 1}.png`, join(root, `visual-${index + 1}.png`));
  }
  for (let index = 0; index < times.length; index += 1) {
    const { data, info } = await sharp(join(root, `visual-${index + 1}.png`))
      .resize(108, 192, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) throw new QualificationError('VISUAL_SANITY_FAILED', 'Synthetic frame channel count is invalid.');
    let black = 0;
    let white = 0;
    let sum = 0;
    let sumSquares = 0;
    for (let offset = 0; offset < data.length; offset += 3) {
      const value = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
      if (value < 8) black += 1;
      if (value > 225) white += 1;
      sum += value;
      sumSquares += value * value;
    }
    const pixels = data.length / 3;
    const variance = sumSquares / pixels - (sum / pixels) ** 2;
    if (black / pixels > 0.85 || white / pixels < 0.0005 || variance < 150) {
      throw new QualificationError('VISUAL_SANITY_FAILED', 'Synthetic frame is black, lacks overlays, or is visibly degenerate.');
    }
    const borderBlackRatio = blackBorderRatio(data, info.width, info.height);
    if (borderBlackRatio > 0.8) throw new QualificationError('VISUAL_SANITY_FAILED', 'Synthetic frame contains an apparent black letterbox.');
  }
  return 'PASS';
}

function blackBorderRatio(data, width, height) {
  let black = 0;
  let total = 0;
  const sample = (x, y) => {
    const offset = (y * width + x) * 3;
    total += 1;
    if (data[offset] < 8 && data[offset + 1] < 8 && data[offset + 2] < 8) black += 1;
  };
  for (let x = 0; x < width; x += 1) { sample(x, 0); sample(x, height - 1); }
  for (let y = 1; y < height - 1; y += 1) { sample(0, y); sample(width - 1, y); }
  return black / total;
}

async function runChecked(sandbox, params, code) {
  const command = await sandbox.runCommand(params);
  if (command.exitCode !== 0) throw new QualificationError(code, safeText(await commandOutput(command)));
  return command;
}

async function commandOutput(command) {
  const [stdout, stderr] = await Promise.all([command.stdout(), command.stderr()]);
  return `${stdout}\n${stderr}`;
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function safeText(value) {
  let output = String(value ?? 'Qualification command failed.');
  if (redactionSecret) output = output.split(redactionSecret).join('[REDACTED]');
  output = output.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]');
  return output.trim().slice(-2_000) || 'Qualification command failed without safe output.';
}

main().catch((error) => {
  const code = error instanceof QualificationError ? error.code : 'PREVIEW_QUALIFICATION_FAILED';
  process.stderr.write(`${JSON.stringify({ status: code, error: safeText(error?.message) })}\n`);
  process.exitCode = 1;
});
