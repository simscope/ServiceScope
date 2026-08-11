import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArtifactHandler } from '../server/reel-render-jobs/artifacts.js';
import {
  reelDispatchMaxAttempts,
  reelQueueDisabledRetryDelaySeconds,
  reelQueueRetryDelaySeconds,
  reelQueueVisibilitySeconds,
  reelRenderMaxMediaBytes,
  reelRenderMaxAttempts,
  reelRenderMessageSchema,
  reelRendererVersion,
  reelRenderTopic,
  reelWorkerLeaseSeconds,
  reelWorkerMaxDurationSeconds,
  RenderJobError,
} from '../server/reel-render-jobs/contracts.js';
import { asNodeHandler } from '../server/reel-render-jobs/nodeAdapter.js';
import { createRenderRequestHandler } from '../server/reel-render-jobs/producer.js';
import { createReelQueueConsumer, reelQueueRetry } from '../server/reel-render-jobs/queueConsumer.js';
import { createSupabaseHttpClient } from '../server/reel-render-jobs/supabaseHttp.js';
import { createRenderWorker } from '../server/reel-render-jobs/worker.js';
import { REEL_DISPATCH_RECOVERY_INTERVAL_MS, shouldRecoverReelDispatch } from '../src/features/reel-render-jobs/dispatchRecovery.js';
import {
  idleReelRender,
  isReelAsyncScopeCurrent,
  isReelRenderForPlan,
  reconcileReelRenderForPlan,
  reelPlanIdentity,
  sameReelPlanIdentity,
} from '../src/features/reel-render-jobs/renderState.js';

const creativePlanId = '00000000-0000-4000-8000-000000000101';
const renderJobId = '00000000-0000-4000-8000-000000000201';
const companyId = '00000000-0000-4000-8000-000000000301';
const revision = 'reel-v1-regression';
let checks = 0;
const check = (fn) => { fn(); checks += 1; };
const checkAsync = async (fn) => { await fn(); checks += 1; };

function request(body, { method = 'POST', token = 'user-token', headers = {} } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('https://example.test/api/reel-render-request', {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: method === 'GET' ? undefined : text,
  });
}

function producerFixture({ enabled = true, status = 'queued', rpcError, publishFailures = 0 } = {}) {
  const calls = { auth: 0, rpc: 0, publish: [] };
  const client = {
    async authenticate(value) {
      calls.auth += 1;
      if (value !== 'Bearer user-token') throw new RenderJobError('AUTH_REQUIRED', 401);
      return { token: 'user-token', userId: 'user-1' };
    },
    async userRpc(name, body, token) {
      calls.rpc += 1;
      check(() => assert.equal(name, 'begin_company_reel_render_request'));
      check(() => assert.deepEqual(body, { p_creative_plan_id: creativePlanId, p_expected_plan_revision: revision }));
      check(() => assert.equal(token, 'user-token'));
      if (rpcError) throw rpcError;
      return [{ render_job_id: renderJobId, status, error_code: status === 'failed' ? 'REEL_RENDER_FAILED' : null }];
    },
  };
  const handler = createRenderRequestHandler({
    client,
    enabled: () => enabled,
    publish: async (message, idempotencyKey) => {
      calls.publish.push({ message, idempotencyKey });
      if (calls.publish.length <= publishFailures) throw new Error('queue unavailable');
    },
  });
  return { handler, calls };
}

const validBody = { creativePlanId, expectedPlanRevision: revision };
{
  const { handler, calls } = producerFixture();
  const response = await handler(request(validBody, { method: 'GET' }));
  check(() => assert.equal(response.status, 405));
  check(() => assert.equal(calls.auth, 0));
}
{
  const { handler, calls } = producerFixture();
  const response = await handler(request(validBody, { token: '' }));
  check(() => assert.equal(response.status, 401));
  check(() => assert.equal(calls.publish.length, 0));
}
for (const invalid of [
  '{', {}, { ...validBody, companyId }, { ...validBody, jobId: renderJobId },
  { ...validBody, plan: {} }, { ...validBody, localFacts: {} }, { creativePlanId },
  { ...validBody, expectedPlanRevision: 'bad revision' },
]) {
  const { handler, calls } = producerFixture();
  const response = await handler(request(invalid));
  check(() => assert.equal(response.status, 400));
  check(() => assert.equal(calls.rpc, 0));
  check(() => assert.equal(calls.publish.length, 0));
}
{
  const { handler, calls } = producerFixture({ enabled: false });
  const response = await handler(request(validBody));
  const responseBody = await response.json();
  check(() => assert.equal(response.status, 503));
  check(() => assert.deepEqual(responseBody, { code: 'REEL_RENDER_NOT_CONFIGURED' }));
  check(() => assert.equal(calls.rpc, 0));
  check(() => assert.equal(calls.publish.length, 0));
}
{
  const { handler, calls } = producerFixture();
  const first = await handler(request(validBody));
  const second = await handler(request(validBody));
  const firstBody = await first.json();
  check(() => assert.equal(first.status, 202));
  check(() => assert.equal(second.status, 202));
  check(() => assert.equal(firstBody.renderJobId, renderJobId));
  check(() => assert.deepEqual(calls.publish, [
    { message: { schemaVersion: reelRenderMessageSchema, renderJobId }, idempotencyKey: renderJobId },
    { message: { schemaVersion: reelRenderMessageSchema, renderJobId }, idempotencyKey: renderJobId },
  ]));
  check(() => assert.equal(Object.keys(calls.publish[0].message).join(','), 'schemaVersion,renderJobId'));
}
{
  const { handler, calls } = producerFixture({ publishFailures: 1 });
  const response = await handler(request(validBody));
  const body = await response.json();
  check(() => assert.equal(response.status, 202));
  check(() => assert.equal(body.renderJobId, renderJobId));
  check(() => assert.equal(calls.rpc, 1));
  check(() => assert.equal(calls.publish.length, 2));
  check(() => assert.ok(calls.publish.every((item) => item.idempotencyKey === renderJobId)));
  check(() => assert.ok(calls.publish.every((item) => item.message.renderJobId === renderJobId)));
}
{
  const { handler, calls } = producerFixture({ publishFailures: reelDispatchMaxAttempts });
  const response = await handler(request(validBody));
  const body = await response.json();
  check(() => assert.equal(response.status, 503));
  check(() => assert.deepEqual(body, { code: 'REEL_RENDER_DISPATCH_FAILED' }));
  check(() => assert.equal(calls.rpc, 1));
  check(() => assert.equal(calls.publish.length, reelDispatchMaxAttempts));
  const recovered = await handler(request(validBody));
  const recoveredBody = await recovered.json();
  check(() => assert.equal(recovered.status, 202));
  check(() => assert.equal(recoveredBody.renderJobId, renderJobId));
  check(() => assert.equal(calls.rpc, 2));
  check(() => assert.equal(calls.publish.at(-1).idempotencyKey, renderJobId));
}
{
  const queued = { render_job_id: renderJobId, render_status: 'queued' };
  check(() => assert.equal(shouldRecoverReelDispatch(queued, undefined, 1000), true));
  check(() => assert.equal(shouldRecoverReelDispatch(queued, 1000, 1000 + REEL_DISPATCH_RECOVERY_INTERVAL_MS - 1), false));
  check(() => assert.equal(shouldRecoverReelDispatch(queued, 1000, 1000 + REEL_DISPATCH_RECOVERY_INTERVAL_MS), true));
  check(() => assert.equal(shouldRecoverReelDispatch({ ...queued, render_status: 'rendering' }, undefined, 1000), false));
}
{
  const { handler, calls } = producerFixture({ status: 'completed' });
  const response = await handler(request(validBody));
  check(() => assert.equal(response.status, 202));
  check(() => assert.equal(calls.publish.length, 0));
}
{
  const { handler } = producerFixture({ rpcError: new RenderJobError('REEL_RENDER_PLAN_UNAVAILABLE', 409) });
  const response = await handler(request(validBody));
  const responseBody = await response.json();
  check(() => assert.equal(response.status, 409));
  check(() => assert.deepEqual(responseBody, { code: 'REEL_RENDER_PLAN_UNAVAILABLE' }));
}
{
  const { handler } = producerFixture();
  const response = await handler(request('x'.repeat(2049), { headers: { 'content-length': '2049' } }));
  check(() => assert.equal(response.status, 400));
}
{
  let responseBody;
  const headers = new Map();
  const handler = asNodeHandler(() => async (webRequest) => Response.json({
    method: webRequest.method,
    body: await webRequest.json(),
  }));
  await handler(
    { method: 'POST', url: '/api/test', headers: { host: 'example.test', 'content-type': 'application/json' }, body: validBody },
    { statusCode: 0, setHeader(name, value) { headers.set(name, value); }, end(value) { responseBody = JSON.parse(Buffer.from(value).toString('utf8')); } },
  );
  check(() => assert.equal(responseBody.method, 'POST'));
  check(() => assert.deepEqual(responseBody.body, validBody));
  check(() => assert.match(headers.get('content-type'), /application\/json/));
}
{
  const requests = [];
  const client = createSupabaseHttpClient(
    { VITE_SUPABASE_URL: 'https://project.supabase.test', VITE_SUPABASE_ANON_KEY: 'public-anon-key' },
    async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ id: 'user-1' }), { status: 200 });
    },
  );
  check(() => assert.ok(client));
  const authenticated = await client.authenticate('Bearer user-access-token');
  check(() => assert.deepEqual(authenticated, { token: 'user-access-token', userId: 'user-1' }));
  check(() => assert.equal(requests[0].options.headers.apikey, 'public-anon-key'));
  check(() => assert.equal(requests[0].options.headers.Authorization, 'Bearer user-access-token'));
  await checkAsync(() => assert.rejects(client.adminRpc('private_rpc', {}), /REEL_RENDER_NOT_CONFIGURED/));
  check(() => assert.equal(requests.length, 1));
}
{
  const client = createSupabaseHttpClient(
    { SUPABASE_URL: 'https://project.supabase.test', SUPABASE_ANON_KEY: 'public-anon-key', SUPABASE_SERVICE_ROLE_KEY: 'server-secret-key' },
    async (_url, options) => new Response(JSON.stringify(
      options.method === 'POST' && String(options.body).includes('expiresIn') ? { signedURL: '/storage/v1/object/sign/private' } : [],
    ), { status: 200 }),
  );
  const signed = await client.sign('company-reel-renders', 'company/job/reel.mp4', 300);
  check(() => assert.equal(signed.signedURL, 'https://project.supabase.test/storage/v1/object/sign/private'));
}
{
  const client = createSupabaseHttpClient(
    { SUPABASE_URL: 'https://project.supabase.test', SUPABASE_ANON_KEY: 'public-anon-key', SUPABASE_SERVICE_ROLE_KEY: 'server-secret-key' },
    async () => { throw new TypeError('network unavailable'); },
  );
  await checkAsync(() => assert.rejects(client.adminRpc('private_rpc', {}), /REEL_RENDER_SERVICE_UNAVAILABLE/));
}

function storageClient(fetchImpl) {
  return createSupabaseHttpClient(
    { SUPABASE_URL: 'https://project.supabase.test', SUPABASE_ANON_KEY: 'public-anon-key', SUPABASE_SERVICE_ROLE_KEY: 'server-secret-key' },
    fetchImpl,
  );
}

function byteStream({ chunks, onPull = () => {}, onCancel = () => {}, errorAt = -1 }) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      onPull(index);
      if (index === errorAt) {
        controller.error(new Error('stream interrupted'));
        return;
      }
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index]);
      index += 1;
    },
    cancel() { onCancel(); },
  });
}

function readerResponse({ chunks, contentLength, onRead = () => {}, onCancel = () => {}, errorAt = -1 }) {
  let index = 0;
  const reader = {
    async read() {
      onRead(index);
      if (index === errorAt) throw new Error('stream interrupted');
      if (index >= chunks.length) return { done: true, value: undefined };
      const value = chunks[index];
      index += 1;
      return { done: false, value };
    },
    async cancel() { onCancel(); },
    releaseLock() {},
  };
  return {
    ok: true,
    status: 200,
    headers: new Headers(contentLength ? { 'content-length': contentLength } : undefined),
    body: { getReader: () => reader, cancel: () => reader.cancel() },
  };
}

{
  const source = new Uint8Array(5_000_000).fill(7);
  const client = storageClient(async () => new Response(source, { status: 200, headers: { 'content-length': '5000000' } }));
  const downloaded = await client.downloadBounded('private', 'five-meg.jpg', reelRenderMaxMediaBytes);
  check(() => assert.equal(downloaded.byteLength, source.byteLength));
  check(() => assert.equal(createHash('sha256').update(downloaded).digest('hex'), createHash('sha256').update(source).digest('hex')));
}
{
  let readers = 0;
  let cancelled = 0;
  const client = storageClient(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': '20000000' }),
    body: {
      async cancel() { cancelled += 1; },
      getReader() { readers += 1; throw new Error('body must not be read'); },
    },
  }));
  await checkAsync(() => assert.rejects(client.downloadBounded('private', 'oversize.jpg', reelRenderMaxMediaBytes), /REEL_RENDER_CONTEXT_STALE/));
  check(() => assert.equal(readers, 0));
  check(() => assert.equal(cancelled, 1));
}
{
  const chunks = Array.from({ length: 11 }, () => new Uint8Array(1_000_000).fill(3));
  const client = storageClient(async () => new Response(byteStream({ chunks }), { status: 200 }));
  const downloaded = await client.downloadBounded('private', 'eleven-meg.jpg', reelRenderMaxMediaBytes);
  check(() => assert.equal(downloaded.byteLength, 11_000_000));
  check(() => assert.equal(downloaded[0], 3));
  check(() => assert.equal(downloaded.at(-1), 3));
}
for (const contentLength of [undefined, '5000000']) {
  let reads = 0;
  let cancelled = 0;
  const response = readerResponse({
    chunks: [new Uint8Array(reelRenderMaxMediaBytes), new Uint8Array([1])],
    contentLength,
    onRead: () => { reads += 1; },
    onCancel: () => { cancelled += 1; },
  });
  const client = storageClient(async () => response);
  await checkAsync(() => assert.rejects(client.downloadBounded('private', 'stream-oversize.jpg', reelRenderMaxMediaBytes), /REEL_RENDER_CONTEXT_STALE/));
  check(() => assert.equal(reads, 2));
  check(() => assert.equal(cancelled, 1));
}
{
  let reads = 0;
  let cancelled = 0;
  const chunks = Array.from({ length: 100 }, () => new Uint8Array(1_000_000));
  const client = storageClient(async () => readerResponse({
    chunks,
    onRead: () => { reads += 1; },
    onCancel: () => { cancelled += 1; },
  }));
  await checkAsync(() => assert.rejects(client.downloadBounded('private', 'very-large.jpg', reelRenderMaxMediaBytes), /REEL_RENDER_CONTEXT_STALE/));
  check(() => assert.equal(reads, 13));
  check(() => assert.equal(cancelled, 1));
}
{
  const client = storageClient(async () => readerResponse({
    chunks: [new Uint8Array(1024)],
    errorAt: 1,
  }));
  await checkAsync(() => assert.rejects(client.downloadBounded('private', 'network-error.jpg', reelRenderMaxMediaBytes), /REEL_RENDER_SERVICE_UNAVAILABLE/));
}

{
  const planA = reelPlanIdentity('plan-a', 'revision-a');
  const planB = reelPlanIdentity('plan-b', 'revision-b');
  const completedA = { ...planA, renderJobId: 'render-a', status: 'completed', videoUrl: 'signed-a.mp4', coverUrl: 'signed-a.jpg' };
  const failedA = { ...planA, renderJobId: 'render-a', status: 'failed', errorCode: 'REEL_RENDER_FAILED' };
  const renderingA = { ...planA, renderJobId: 'render-a', status: 'rendering' };
  const resetCompleted = reconcileReelRenderForPlan(completedA, planB);
  const resetFailed = reconcileReelRenderForPlan(failedA, planB);
  const resetRendering = reconcileReelRenderForPlan(renderingA, planB);
  check(() => assert.deepEqual(resetCompleted, idleReelRender(planB)));
  check(() => assert.deepEqual(resetFailed, idleReelRender(planB)));
  check(() => assert.deepEqual(resetRendering, idleReelRender(planB)));
  check(() => assert.equal(resetCompleted.videoUrl, undefined));
  check(() => assert.equal(reconcileReelRenderForPlan(completedA, planA), completedA));
  check(() => assert.equal(isReelRenderForPlan(completedA, planB), false));
  check(() => assert.equal(sameReelPlanIdentity(planA, planB), false));
  const planAScope = { jobId: 'job-1', ...planA, epoch: 1 };
  const planBScope = { jobId: 'job-1', ...planB, epoch: 2 };
  check(() => assert.equal(isReelAsyncScopeCurrent(planAScope, planBScope), false));
  check(() => assert.equal(isReelAsyncScopeCurrent(planBScope, planBScope), true));
}

{
  let enabled = true;
  const calls = { worker: 0 };
  const consumer = createReelQueueConsumer({
    enabled: () => enabled,
    worker: async (message) => { calls.worker += 1; return { status: 'completed', rendered: message.renderJobId === renderJobId }; },
  });
  const first = await consumer({ schemaVersion: reelRenderMessageSchema, renderJobId });
  check(() => assert.deepEqual(first, { status: 'completed', rendered: true }));
  enabled = false;
  let disabledError;
  await checkAsync(async () => {
    await assert.rejects(consumer({ schemaVersion: reelRenderMessageSchema, renderJobId }), (error) => {
      disabledError = error;
      return error instanceof RenderJobError && error.code === 'REEL_RENDER_NOT_CONFIGURED';
    });
  });
  check(() => assert.equal(calls.worker, 1));
  check(() => assert.deepEqual(reelQueueRetry(disabledError), { afterSeconds: reelQueueDisabledRetryDelaySeconds }));
  const malformed = await consumer({ schemaVersion: reelRenderMessageSchema, renderJobId, plan: {} });
  check(() => assert.deepEqual(malformed, { status: 'ignored', rendered: false }));
  check(() => assert.equal(calls.worker, 1));
  enabled = true;
  const retried = await consumer({ schemaVersion: reelRenderMessageSchema, renderJobId });
  check(() => assert.deepEqual(retried, { status: 'completed', rendered: true }));
  check(() => assert.equal(calls.worker, 2));
  check(() => assert.deepEqual(reelQueueRetry(new RenderJobError('REEL_RENDER_SERVICE_UNAVAILABLE', 503)), { afterSeconds: reelQueueRetryDelaySeconds }));
}

function workerFixture(overrides = {}) {
  const calls = { claim: 0, load: 0, authorize: 0, staging: 0, render: 0, uploads: [], complete: 0, fail: [], release: 0, disposed: 0 };
  const claim = {
    id: renderJobId,
    company_id: companyId,
    job_id: 'job-1',
    creative_plan_id: creativePlanId,
    lease_token: 'lease-1',
    attempt_count: overrides.attemptCount ?? 1,
    renderer_version: overrides.rendererVersion ?? reelRendererVersion,
  };
  const repository = {
    async claim() { calls.claim += 1; return overrides.claim === undefined ? claim : overrides.claim; },
    async status() { return overrides.status === undefined ? 'rendering' : overrides.status; },
    async loadAuthority() {
      calls.load += 1;
      if (overrides.loadError) throw overrides.loadError;
      return { plan: { revision }, context: { evidence: [] }, assets: new Map([['attachment-1', new Uint8Array([1, 2, 3])]]) };
    },
    async upload(bucket, path, bytes, mime) {
      calls.uploads.push({ bucket, path, bytes: bytes.length, mime });
      if (overrides.uploadErrorAt === calls.uploads.length) throw new RenderJobError('REEL_RENDER_SERVICE_UNAVAILABLE', 503);
    },
    async complete() {
      calls.complete += 1;
      if (overrides.completeError && calls.complete <= overrides.completeError) throw new RenderJobError('REEL_RENDER_SERVICE_UNAVAILABLE', 503);
      return [{ status: 'completed' }];
    },
    async fail(_id, _token, code) {
      calls.fail.push(code);
      if (overrides.failError) throw new RenderJobError('REEL_RENDER_SERVICE_UNAVAILABLE', 503);
      return overrides.failRows ?? [{ status: 'failed' }];
    },
    async release() { calls.release += 1; return [{ status: 'rendering' }]; },
  };
  const authorize = ({ plan, context }) => {
    calls.authorize += 1;
    if (overrides.authorizeError) throw overrides.authorizeError;
    check(() => assert.equal(plan.revision, revision));
    check(() => assert.deepEqual(context, { evidence: [] }));
    return Object.freeze({ authorized: true });
  };
  const render = async ({ stagedAssets, stagingRoot }) => {
    calls.render += 1;
    const bytes = await readFile(join(stagingRoot, stagedAssets[0].path));
    check(() => assert.deepEqual([...bytes], [1, 2, 3]));
    const outputRoot = await mkdtemp(join(tmpdir(), 'servicescope-render-job-test-'));
    const videoPath = join(outputRoot, 'reel.mp4');
    const coverPath = join(outputRoot, 'cover.jpg');
    await writeFile(videoPath, 'video');
    await writeFile(coverPath, 'cover');
    return {
      videoPath, coverPath, durationMs: 13_800, width: 1080, height: 1920, fps: 30,
      videoCodec: 'h264', pixelFormat: 'yuv420p', audioStreams: 0, fileSize: 5, faststart: true,
      async dispose() { calls.disposed += 1; await rm(outputRoot, { recursive: true, force: true }); },
    };
  };
  const createStagingRoot = () => {
    calls.staging += 1;
    return mkdtemp(join(tmpdir(), 'servicescope-reel-stage-test-'));
  };
  return { calls, worker: createRenderWorker({ repository, authorize, render, createStagingRoot }) };
}

const queueMessage = { schemaVersion: reelRenderMessageSchema, renderJobId };
{
  const { worker, calls } = workerFixture();
  const result = await worker(queueMessage);
  check(() => assert.deepEqual(result, { status: 'completed', rendered: true }));
  check(() => assert.equal(calls.load, 1));
  check(() => assert.equal(calls.authorize, 1));
  check(() => assert.equal(calls.staging, 1));
  check(() => assert.equal(calls.render, 1));
  check(() => assert.equal(calls.complete, 1));
  check(() => assert.equal(calls.disposed, 1));
  check(() => assert.deepEqual(calls.uploads.map(({ path, mime }) => [path, mime]), [
    [`${companyId}/${renderJobId}/reel.mp4`, 'video/mp4'],
    [`${companyId}/${renderJobId}/cover.jpg`, 'image/jpeg'],
  ]));
}
{
  const { worker, calls } = workerFixture({ rendererVersion: 'servicescope-reel-renderer-v1' });
  const result = await worker(queueMessage);
  check(() => assert.deepEqual(result, { status: 'failed', rendered: false, errorCode: 'REEL_RENDER_CONTEXT_STALE' }));
  check(() => assert.equal(calls.load, 0));
  check(() => assert.equal(calls.authorize, 0));
  check(() => assert.equal(calls.staging, 0));
  check(() => assert.equal(calls.render, 0));
  check(() => assert.equal(calls.uploads.length, 0));
  check(() => assert.deepEqual(calls.fail, ['REEL_RENDER_CONTEXT_STALE']));
  check(() => assert.equal(calls.release, 0));
}
for (const failure of [{ failError: true }, { failRows: [] }]) {
  const { worker, calls } = workerFixture({
    rendererVersion: 'servicescope-reel-renderer-v1',
    ...failure,
  });
  await checkAsync(() => assert.rejects(worker(queueMessage), /REEL_RENDER_SERVICE_UNAVAILABLE/));
  check(() => assert.equal(calls.load, 0));
  check(() => assert.equal(calls.authorize, 0));
  check(() => assert.equal(calls.staging, 0));
  check(() => assert.equal(calls.render, 0));
  check(() => assert.equal(calls.uploads.length, 0));
  check(() => assert.equal(calls.release, 1));
}
{
  const { worker, calls } = workerFixture({ claim: null, status: 'completed' });
  const result = await worker(queueMessage);
  check(() => assert.deepEqual(result, { status: 'completed', rendered: false }));
  check(() => assert.equal(calls.render, 0));
}
for (const status of ['failed', null]) {
  const { worker, calls } = workerFixture({ claim: null, status });
  const result = await worker(queueMessage);
  check(() => assert.equal(result.status, status ?? 'missing'));
  check(() => assert.equal(result.rendered, false));
  check(() => assert.equal(calls.render, 0));
}
{
  const { worker, calls } = workerFixture({ claim: null, status: 'rendering' });
  await checkAsync(() => assert.rejects(worker(queueMessage), /REEL_RENDER_BUSY/));
  check(() => assert.equal(calls.render, 0));
}
for (const [loadError, authorizeError] of [
  [new RenderJobError('REEL_RENDER_CONTEXT_STALE', 409), null],
  [null, new Error('REEL_RENDER_INVALID_PLAN')],
  [new Error('REEL_RENDER_MEDIA_MISSING'), null],
  [null, new Error('REEL_PRIVACY_FAILED')],
]) {
  const { worker, calls } = workerFixture({ loadError, authorizeError });
  const result = await worker(queueMessage);
  check(() => assert.equal(result.status, 'failed'));
  check(() => assert.equal(calls.render, 0));
  check(() => assert.equal(calls.fail.length, 1));
  check(() => assert.equal(calls.release, 0));
}
for (const uploadErrorAt of [1, 2]) {
  const { worker, calls } = workerFixture({ uploadErrorAt });
  await checkAsync(() => assert.rejects(worker(queueMessage), /REEL_RENDER_SERVICE_UNAVAILABLE/));
  check(() => assert.equal(calls.complete, 0));
  check(() => assert.equal(calls.fail.length, 0));
  check(() => assert.equal(calls.release, 1));
}
{
  const { worker, calls } = workerFixture({ completeError: 1 });
  await checkAsync(() => assert.rejects(worker(queueMessage), /REEL_RENDER_SERVICE_UNAVAILABLE/));
  check(() => assert.equal(calls.release, 1));
  const firstPaths = calls.uploads.map((item) => item.path);
  await worker(queueMessage);
  check(() => assert.deepEqual(calls.uploads.slice(2).map((item) => item.path), firstPaths));
  check(() => assert.equal(calls.complete, 2));
}
for (const attemptCount of [1, 4]) {
  const { worker, calls } = workerFixture({ attemptCount, uploadErrorAt: 1 });
  await checkAsync(() => assert.rejects(worker(queueMessage), /REEL_RENDER_SERVICE_UNAVAILABLE/));
  check(() => assert.equal(calls.release, 1));
  check(() => assert.equal(calls.fail.length, 0));
}
{
  const { worker, calls } = workerFixture({ attemptCount: reelRenderMaxAttempts, uploadErrorAt: 1 });
  const result = await worker(queueMessage);
  check(() => assert.deepEqual(result, { status: 'failed', rendered: false, errorCode: 'REEL_RENDER_FAILED' }));
  check(() => assert.deepEqual(calls.fail, ['REEL_RENDER_FAILED']));
  check(() => assert.equal(calls.release, 0));
}
await checkAsync(() => assert.rejects(
  workerFixture().worker({ ...queueMessage, plan: {} }),
  /INVALID_REQUEST/,
));

{
  const signed = [];
  const client = {
    async authenticate(value) { if (value !== 'Bearer user-token') throw new RenderJobError('AUTH_REQUIRED', 401); return { token: 'user-token' }; },
    async select() { return [{ id: renderJobId, job_id: 'job-1', status: 'completed', output_bucket: 'company-reel-renders', video_object_path: `${companyId}/${renderJobId}/reel.mp4`, cover_object_path: `${companyId}/${renderJobId}/cover.jpg` }]; },
    async userRpc() { return [{ render_job_id: renderJobId }]; },
    async sign(_bucket, path, ttl) { signed.push({ path, ttl }); return { signedURL: `https://signed.example.test/${path}` }; },
  };
  const handler = createArtifactHandler({ client, clock: { now: () => Date.parse('2026-08-09T00:00:00Z') } });
  const response = await handler(new Request('https://example.test/api/reel-render-artifacts', {
    method: 'POST', headers: { authorization: 'Bearer user-token' }, body: JSON.stringify({ renderJobId }),
  }));
  const body = await response.json();
  check(() => assert.equal(response.status, 200));
  check(() => assert.deepEqual(Object.keys(body), ['videoUrl', 'coverUrl', 'expiresAt']));
  check(() => assert.equal(body.expiresAt, '2026-08-09T00:05:00.000Z'));
  check(() => assert.deepEqual(signed.map((item) => item.ttl), [300, 300]));
  check(() => assert.doesNotMatch(JSON.stringify(body), /output_bucket|object_path|lease_token|service_role/i));
}
{
  const signed = [];
  const client = {
    async authenticate() { return { token: 'ai-off-token' }; },
    async select() { return [{ id: renderJobId, job_id: 'job-1', status: 'completed', output_bucket: 'company-reel-renders', video_object_path: 'private/reel.mp4', cover_object_path: 'private/cover.jpg' }]; },
    async userRpc() { throw new RenderJobError('FORBIDDEN', 403); },
    async sign(...args) { signed.push(args); return { signedURL: 'https://should-not-sign.example.test' }; },
  };
  const handler = createArtifactHandler({ client });
  const response = await handler(new Request('https://example.test/api/reel-render-artifacts', {
    method: 'POST', headers: { authorization: 'Bearer ai-off-token' }, body: JSON.stringify({ renderJobId }),
  }));
  const body = await response.json();
  check(() => assert.equal(response.status, 403));
  check(() => assert.deepEqual(body, { code: 'FORBIDDEN' }));
  check(() => assert.equal(signed.length, 0));
}

check(() => assert.equal(reelRenderTopic, 'servicescope-reel-render-v1'));
check(() => assert.equal(reelWorkerMaxDurationSeconds, 300));
check(() => assert.equal(reelWorkerLeaseSeconds, 360));
check(() => assert.equal(reelQueueVisibilitySeconds, reelWorkerLeaseSeconds));
check(() => assert.ok(reelWorkerLeaseSeconds > reelWorkerMaxDurationSeconds));
check(() => assert.equal(reelQueueDisabledRetryDelaySeconds, 300));
check(() => assert.equal(reelRenderMaxMediaBytes, 12_000_000));
console.log(`Reel render job regression tests passed (${checks}/${checks}).`);
