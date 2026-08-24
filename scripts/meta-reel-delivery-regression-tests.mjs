import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  MetaPublishingError,
  parsePublishingRequest,
} from '../supabase/functions/_shared/meta-publishing/contracts.js';
import { connectionEnvelopeContext, encryptTokenBundle } from '../supabase/functions/_shared/meta-connection/crypto.js';
import { handleFacebookReelDelivery } from '../supabase/functions/_shared/meta-publishing/reelDeliveryService.js';
import { sha256Hex } from '../supabase/functions/_shared/meta-publishing/photoPreparation.js';
import { createFacebookPublishingProvider } from '../supabase/functions/_shared/meta-publishing/provider.js';

const ids = {
  company: '10000000-0000-4000-8000-000000000001',
  job: '10000000-0000-4000-8000-000000000002',
  render: '10000000-0000-4000-8000-000000000003',
  connection: '10000000-0000-4000-8000-000000000004',
  actor: '10000000-0000-4000-8000-000000000005',
  publication: '10000000-0000-4000-8000-000000000006',
  idempotency: '10000000-0000-4000-8000-000000000007',
};
const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
const videoSha256 = (await sha256Hex(bytes, webcrypto)).slice(2);
const encryptionKey = Buffer.alloc(32, 7).toString('base64');
const tokenEnvelope = await encryptTokenBundle(
  { pageAccessToken: 'page-token-for-tests' },
  encryptionKey,
  connectionEnvelopeContext({ companyId: ids.company, connectionId: ids.connection, pageId: '10001' }),
  webcrypto,
);
let checks = 0;
const check = (fn) => { fn(); checks += 1; };

check(() => assert.equal(parsePublishingRequest(JSON.stringify(publishRequest())).action, 'publish_facebook_reel'));
check(() => assert.equal(parsePublishingRequest(JSON.stringify({ action: 'reconcile_facebook_reel', companyId: ids.company, publicationId: ids.publication, explicitApproval: true })).action, 'reconcile_facebook_reel'));
for (const unsafe of [
  { pageId: '10001' }, { pageAccessToken: 'secret' }, { uploadUrl: 'https://example.test' },
  { storagePath: 'private/reel.mp4' }, { providerMediaId: '123' }, { graphApiVersion: 'v999.0' },
]) {
  check(() => assert.throws(() => parsePublishingRequest(JSON.stringify({ ...publishRequest(), ...unsafe })), /INVALID_REQUEST/));
}

{
  const calls = [];
  const responses = [
    jsonResponse({ video_id: 'mock-video-1', upload_url: 'https://attacker.invalid/ignored' }),
    jsonResponse({ success: true }),
    jsonResponse({ success: true }),
    jsonResponse({ status: { video_status: 'published', publishing_phase: { status: 'complete' } } }),
  ];
  const provider = createFacebookPublishingProvider({
    config: { graphApiVersion: 'v25.0', appSecret: 'app-secret' }, cryptoApi: webcrypto,
    fetchImpl: async (url, init) => { calls.push({ url: String(url), init }); return responses.shift(); },
  });
  const common = { pageAccessToken: 'page-token', signal: new AbortController().signal };
  const initialized = await provider.initializeReel({ pageId: '10001', ...common });
  await provider.uploadReel({ providerMediaId: initialized.providerMediaId, videoBytes: bytes, ...common });
  await provider.finalizeReel({ pageId: '10001', providerMediaId: initialized.providerMediaId, message: 'Caption', ...common });
  const status = await provider.getReelStatus({ providerMediaId: initialized.providerMediaId, ...common });
  check(() => assert.equal(calls[0].url, 'https://graph.facebook.com/v25.0/10001/video_reels'));
  check(() => assert.equal(calls[1].url, 'https://rupload.facebook.com/video-upload/v25.0/mock-video-1'));
  check(() => assert.equal(calls[1].init.headers.offset, '0'));
  check(() => assert.equal(calls[1].init.headers.file_size, String(bytes.byteLength)));
  check(() => assert.equal(calls[2].url, 'https://graph.facebook.com/v25.0/10001/video_reels'));
  check(() => assert.match(String(calls[2].init.body), /upload_phase=finish/));
  check(() => assert.match(String(calls[2].init.body), /video_state=PUBLISHED/));
  check(() => assert.match(calls[3].url, /^https:\/\/graph\.facebook\.com\/v25\.0\/mock-video-1\?fields=status/));
  check(() => assert.equal(status.state, 'published'));
  check(() => assert.doesNotMatch(calls[1].url, /attacker\.invalid/));
  check(() => assert.equal(calls.every((call) => call.init.redirect === 'error'), true));
}

for (const scenario of [
  [401, { error: { code: 190 } }, 'META_CONNECTION_NEEDS_REAUTHORIZATION', 'INVALID_TOKEN'],
  [403, { error: { code: 200 } }, 'META_PUBLISHING_PERMISSION_MISSING', 'MISSING_PERMISSION'],
  [429, { error: { code: 613 } }, 'META_PUBLICATION_PROVIDER_REJECTED', 'RATE_LIMITED'],
  [400, { error: { code: 100 } }, 'META_PUBLICATION_PROVIDER_REJECTED', 'PAGE_UNAVAILABLE'],
  [500, { error: { code: 2 } }, 'META_PUBLICATION_DELIVERY_UNKNOWN', 'PROVIDER_TEMPORARY_ERROR'],
  [400, { error: { code: 2, is_transient: true } }, 'META_PUBLICATION_DELIVERY_UNKNOWN', 'PROVIDER_TEMPORARY_ERROR'],
]) {
  const [status, payload, expectedCode, expectedCategory] = scenario;
  const provider = createFacebookPublishingProvider({
    config: { graphApiVersion: 'v25.0', appSecret: 'app-secret' },
    cryptoApi: webcrypto,
    fetchImpl: async (_url, init) => {
      assert.equal(init.redirect, 'error');
      return jsonResponse(payload, status);
    },
  });
  await assert.rejects(
    () => provider.initializeReel({
      pageId: '10001', pageAccessToken: 'page-token', signal: new AbortController().signal,
    }),
    (error) => error?.code === expectedCode && error?.diagnostic?.providerCategory === expectedCategory,
  );
  checks += 1;
}

{
  const fixture = await makeFixture();
  const result = await publish(fixture);
  check(() => assert.equal(result.status, 'published'));
  check(() => assert.equal(result.providerStage, 'published'));
  check(() => assert.equal(fixture.repository.rows.size, 1));
  check(() => assert.deepEqual(fixture.provider.calls, ['initialize', 'upload', 'finalize', 'status']));
  check(() => assert.equal(fixture.repository.row.provider_call_count, 4));
  check(() => assert.equal(fixture.repository.row.approved_message, 'Exact reviewed Reel caption'));
  check(() => assert.equal(fixture.repository.row.render_job_id, ids.render));
  check(() => assert.equal(fixture.repository.row.video_sha256, videoSha256));
}

{
  const fixture = await makeFixture({ failAdvanceStage: 'upload_initializing' });
  await assert.rejects(() => publish(fixture), hasCode('INTERNAL_ERROR'));
  checks += 1;
  check(() => assert.deepEqual(fixture.provider.calls, ['initialize']));
  check(() => assert.equal(fixture.repository.row.status, 'delivery_unknown'));
  check(() => assert.equal(fixture.repository.row.provider_delivery_stage, 'delivery_unknown'));
  check(() => assert.equal(fixture.repository.row.reel_provider_media_id, 'mock-video-1'));
  check(() => assert.equal(fixture.repository.row.provider_call_count, 1));
  check(() => assert.equal(fixture.repository.row.provider_status_checks, 0));
}

{
  const fixture = await makeFixture({
    failAdvanceStage: 'upload_initializing',
    statusStates: ['processing', 'processing', 'processing'],
  });
  await assert.rejects(() => publish(fixture), hasCode('INTERNAL_ERROR'));
  checks += 1;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await handleFacebookReelDelivery({
      body: { action: 'reconcile_facebook_reel', companyId: ids.company, publicationId: ids.publication, explicitApproval: true },
      companyId: ids.company, access: fixture.access, deps: fixture.deps,
    });
    check(() => assert.equal(result.status, 'delivery_unknown'));
  }
  check(() => assert.deepEqual(fixture.provider.calls, ['initialize', 'status', 'status', 'status']));
  check(() => assert.equal(fixture.repository.row.provider_call_count, 4));
  check(() => assert.equal(fixture.repository.row.provider_status_checks, 3));
  check(() => assert.equal(fixture.repository.row.status, 'delivery_unknown'));
  check(() => assert.equal(fixture.repository.row.reel_provider_media_id, 'mock-video-1'));
  const callsBeforeLimit = fixture.provider.calls.length;
  await assert.rejects(() => handleFacebookReelDelivery({
    body: { action: 'reconcile_facebook_reel', companyId: ids.company, publicationId: ids.publication, explicitApproval: true },
    companyId: ids.company, access: fixture.access, deps: fixture.deps,
  }), hasCode('META_REEL_STATUS_CHECK_LIMIT_REACHED'));
  checks += 1;
  check(() => assert.equal(fixture.provider.calls.length, callsBeforeLimit));
}

{
  const fixture = await makeFixture({ failAdvanceStage: 'uploading' });
  await assert.rejects(() => publish(fixture), hasCode('INTERNAL_ERROR'));
  checks += 1;
  check(() => assert.deepEqual(fixture.provider.calls, ['initialize', 'upload']));
  check(() => assert.equal(fixture.repository.row.status, 'delivery_unknown'));
  check(() => assert.equal(fixture.repository.row.reel_provider_media_id, 'mock-video-1'));
  check(() => assert.equal(fixture.repository.row.provider_call_count, 2));
  check(() => assert.equal(fixture.repository.row.provider_status_checks, 0));
}

{
  const fixture = await makeFixture();
  await assert.rejects(() => publish(fixture, { message: 'Call 212-555-0199 for access' }), hasCode('META_PUBLICATION_PRIVACY_REVIEW_REQUIRED'));
  checks += 1;
  check(() => assert.equal(fixture.provider.calls.length, 0));
  check(() => assert.equal(fixture.repository.rows.size, 0));
}

{
  const fixture = await makeFixture({ providerDelay: 5 });
  const [first, second] = await Promise.all([publish(fixture), publish(fixture)]);
  check(() => assert.equal(fixture.repository.rows.size, 1));
  check(() => assert.equal([first.status, second.status].includes('published'), true));
  check(() => assert.deepEqual(fixture.provider.calls, ['initialize', 'upload', 'finalize', 'status']));
}

{
  const fixture = await makeFixture({ failStage: 'finalize', failureCode: 'META_PUBLICATION_DELIVERY_UNKNOWN' });
  await assert.rejects(() => publish(fixture), hasCode('META_PUBLICATION_DELIVERY_UNKNOWN'));
  checks += 1;
  check(() => assert.equal(fixture.repository.row.status, 'delivery_unknown'));
  check(() => assert.deepEqual(fixture.provider.calls, ['initialize', 'upload', 'finalize']));
  fixture.provider.failStage = null;
  fixture.provider.statusState = 'published';
  const reconciled = await handleFacebookReelDelivery({
    body: { action: 'reconcile_facebook_reel', companyId: ids.company, publicationId: ids.publication, explicitApproval: true },
    companyId: ids.company,
    access: fixture.access,
    deps: fixture.deps,
  });
  check(() => assert.equal(reconciled.status, 'published'));
  check(() => assert.deepEqual(fixture.provider.calls, ['initialize', 'upload', 'finalize', 'status']));
  check(() => assert.equal(fixture.provider.calls.filter((value) => value === 'finalize').length, 1));
}

for (const scenario of [
  ['initialize', 'META_CONNECTION_NEEDS_REAUTHORIZATION', 'INVALID_TOKEN', 'failed'],
  ['initialize', 'META_PUBLISHING_PERMISSION_MISSING', 'MISSING_PERMISSION', 'failed'],
  ['upload', 'META_PUBLICATION_PROVIDER_REJECTED', 'PROVIDER_REJECTED', 'failed'],
  ['initialize', 'META_PUBLICATION_PROVIDER_REJECTED', 'RATE_LIMITED', 'failed'],
  ['initialize', 'META_PUBLICATION_DELIVERY_UNKNOWN', 'PROVIDER_TEMPORARY_ERROR', 'delivery_unknown'],
]) {
  const [failStage, failureCode, providerCategory, expectedStatus] = scenario;
  const fixture = await makeFixture({ failStage, failureCode, providerCategory });
  await assert.rejects(() => publish(fixture), hasCode(failureCode));
  checks += 1;
  check(() => assert.equal(fixture.repository.row.status, expectedStatus));
  check(() => assert.equal(fixture.provider.calls.filter((value) => value === failStage).length, 1));
}

{
  const fixture = await makeFixture({ statusState: 'failed' });
  await assert.rejects(() => publish(fixture), hasCode('META_PUBLICATION_PROVIDER_REJECTED'));
  checks += 1;
  check(() => assert.equal(fixture.repository.row.status, 'failed'));
  check(() => assert.equal(fixture.repository.row.provider_error_category, 'REEL_PROCESSING_FAILED'));
}

{
  const fixture = await makeFixture();
  fixture.repository.completeReelPublication = async () => {
    throw new Error('durable completion unavailable');
  };
  await assert.rejects(() => publish(fixture), hasCode('META_PUBLICATION_DELIVERY_UNKNOWN'));
  checks += 1;
  check(() => assert.equal(fixture.repository.row.status, 'delivery_unknown'));
  check(() => assert.equal(fixture.repository.row.provider_status_checks, 1));
  check(() => assert.deepEqual(fixture.provider.calls, ['initialize', 'upload', 'finalize', 'status']));
  await assert.rejects(() => publish(fixture), hasCode('META_PUBLICATION_DELIVERY_UNKNOWN'));
  checks += 1;
  check(() => assert.deepEqual(fixture.provider.calls, ['initialize', 'upload', 'finalize', 'status']));
}

{
  const fixture = await makeFixture({ grantedScopes: ['pages_show_list', 'pages_read_engagement'] });
  await assert.rejects(() => publish(fixture), hasCode('META_PUBLISHING_PERMISSION_MISSING'));
  checks += 1;
  check(() => assert.equal(fixture.provider.calls.length, 0));
}

{
  const fixture = await makeFixture({ renderCompanyId: '20000000-0000-4000-8000-000000000001' });
  await assert.rejects(() => publish(fixture), hasCode('META_REEL_RENDER_INVALID'));
  checks += 1;
  check(() => assert.equal(fixture.provider.calls.length, 0));
}

{
  const fixture = await makeFixture({ corruptBytes: true });
  await assert.rejects(() => publish(fixture), hasCode('META_REEL_RENDER_INVALID'));
  checks += 1;
  check(() => assert.equal(fixture.provider.calls.length, 0));
}

{
  const fixture = await makeFixture({ fileSize: 25_000_001 });
  await assert.rejects(() => publish(fixture), hasCode('META_REEL_RENDER_INVALID'));
  checks += 1;
  check(() => assert.equal(fixture.provider.calls.length, 0));
}

{
  const fixture = await makeFixture({ invalidEnvelope: true });
  await assert.rejects(() => publish(fixture), hasCode('META_CONNECTION_NEEDS_REAUTHORIZATION'));
  checks += 1;
  check(() => assert.equal(fixture.provider.calls.length, 0));
}

{
  const fixture = await makeFixture({ failStage: 'status', failureCode: 'META_PUBLICATION_DELIVERY_UNKNOWN' });
  await assert.rejects(() => publish(fixture), hasCode('META_PUBLICATION_DELIVERY_UNKNOWN'));
  checks += 1;
  check(() => assert.equal(fixture.repository.row.status, 'delivery_unknown'));
  check(() => assert.equal(fixture.repository.row.provider_status_checks, 1));
  check(() => assert.deepEqual(fixture.provider.calls, ['initialize', 'upload', 'finalize', 'status']));
}

{
  const fixture = await makeFixture({ failStage: 'status', failureCode: 'META_CONNECTION_NEEDS_REAUTHORIZATION', providerCategory: 'INVALID_TOKEN' });
  await assert.rejects(() => publish(fixture), hasCode('META_CONNECTION_NEEDS_REAUTHORIZATION'));
  checks += 1;
  check(() => assert.equal(fixture.repository.row.status, 'delivery_unknown'));
  check(() => assert.equal(fixture.repository.row.provider_status_checks, 1));
}

{
  const fixture = await makeFixture({ statusState: 'processing' });
  const initial = await publish(fixture);
  check(() => assert.equal(initial.status, 'delivery_unknown'));
  check(() => assert.equal(fixture.repository.row.provider_call_count, 4));
  check(() => assert.equal(fixture.repository.row.provider_status_checks, 1));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const processing = await handleFacebookReelDelivery({
      body: { action: 'reconcile_facebook_reel', companyId: ids.company, publicationId: ids.publication, explicitApproval: true },
      companyId: ids.company, access: fixture.access, deps: fixture.deps,
    });
    check(() => assert.equal(processing.status, 'delivery_unknown'));
  }
  check(() => assert.equal(fixture.repository.row.provider_call_count, 6));
  check(() => assert.equal(fixture.repository.row.provider_status_checks, 3));
  check(() => assert.equal(fixture.repository.row.status, 'delivery_unknown'));
  check(() => assert.equal(fixture.repository.row.provider_delivery_stage, 'delivery_unknown'));
  check(() => assert.equal(fixture.repository.row.last_error_code, 'META_PUBLICATION_DELIVERY_UNKNOWN'));
  check(() => assert.equal(fixture.repository.row.reel_provider_media_id, 'mock-video-1'));
  const callsBeforeLimit = fixture.provider.calls.length;
  await assert.rejects(() => handleFacebookReelDelivery({
    body: { action: 'reconcile_facebook_reel', companyId: ids.company, publicationId: ids.publication, explicitApproval: true },
    companyId: ids.company, access: fixture.access, deps: fixture.deps,
  }), hasCode('META_REEL_STATUS_CHECK_LIMIT_REACHED'));
  checks += 1;
  check(() => assert.equal(fixture.provider.calls.length, callsBeforeLimit));
  check(() => assert.equal(fixture.provider.calls.filter((value) => value === 'status').length, 3));
}

{
  const fixture = await makeFixture({ statusState: 'processing' });
  await publish(fixture);
  fixture.repository.row.status = 'publishing';
  fixture.repository.row.provider_delivery_stage = 'provider_processing';
  fixture.repository.row.provider_status_checks = 3;
  const callsBefore = fixture.provider.calls.length;
  await assert.rejects(() => handleFacebookReelDelivery({
    body: { action: 'reconcile_facebook_reel', companyId: ids.company, publicationId: ids.publication, explicitApproval: true },
    companyId: ids.company, access: fixture.access, deps: fixture.deps,
  }), hasCode('META_REEL_STATUS_CHECK_LIMIT_REACHED'));
  checks += 1;
  check(() => assert.equal(fixture.provider.calls.length, callsBefore));
}

for (const scenario of ['published', 'failed'].flatMap((finalStatus) => [1, 2, 3].map((statusCalls) => ({
  states: [...Array(statusCalls - 1).fill('processing'), finalStatus],
  finalStatus,
  statusCalls,
})))) {
  const fixture = await makeFixture({ statusStates: scenario.states });
  let result;
  try {
    result = await publish(fixture);
    while (result.status === 'delivery_unknown') {
      result = await handleFacebookReelDelivery({
        body: { action: 'reconcile_facebook_reel', companyId: ids.company, publicationId: ids.publication, explicitApproval: true },
        companyId: ids.company, access: fixture.access, deps: fixture.deps,
      });
    }
  } catch (error) {
    if (scenario.finalStatus !== 'failed') throw error;
    check(() => assert.equal(error.code, 'META_PUBLICATION_PROVIDER_REJECTED'));
  }
  check(() => assert.equal(fixture.repository.row.status, scenario.finalStatus));
  check(() => assert.equal(fixture.provider.calls.filter((value) => value === 'status').length, scenario.statusCalls));
}

{
  const fixture = await makeFixture({ statusStates: ['processing', 'processing', 'published'], providerDelay: 5 });
  await publish(fixture);
  await handleFacebookReelDelivery({
    body: { action: 'reconcile_facebook_reel', companyId: ids.company, publicationId: ids.publication, explicitApproval: true },
    companyId: ids.company, access: fixture.access, deps: fixture.deps,
  });
  const concurrent = await Promise.allSettled([0, 1, 2, 3, 4].map(() => handleFacebookReelDelivery({
    body: { action: 'reconcile_facebook_reel', companyId: ids.company, publicationId: ids.publication, explicitApproval: true },
    companyId: ids.company, access: fixture.access, deps: fixture.deps,
  })));
  check(() => assert.equal(concurrent.filter((entry) => entry.status === 'fulfilled').length, 1));
  check(() => assert.equal(concurrent.filter((entry) => entry.status === 'rejected').length, 4));
  check(() => assert.equal(concurrent.filter((entry) => entry.status === 'rejected')
    .every((entry) => entry.reason?.code === 'META_REEL_STATUS_CHECK_LIMIT_REACHED'), true));
  check(() => assert.equal(fixture.provider.calls.filter((value) => value === 'status').length, 3));
  check(() => assert.equal(fixture.repository.row.provider_status_checks, 3));
  check(() => assert.equal(fixture.repository.row.provider_call_count, 6));
  check(() => assert.equal(fixture.repository.row.status, 'published'));
}

console.log(`Meta Reel delivery regression tests passed: ${checks}`);

async function publish(fixture, overrides = {}) {
  return handleFacebookReelDelivery({
    body: publishRequest(overrides),
    companyId: ids.company,
    access: fixture.access,
    deps: fixture.deps,
  });
}

function publishRequest(overrides = {}) {
  return {
    action: 'publish_facebook_reel', companyId: ids.company, jobId: ids.job,
    renderJobId: ids.render, message: 'Exact reviewed Reel caption',
    idempotencyKey: ids.idempotency, explicitApproval: true, ...overrides,
  };
}

async function makeFixture(options = {}) {
  const connection = {
    id: ids.connection, company_id: ids.company, status: 'connected', facebook_page_id: '10001',
    granted_scopes: options.grantedScopes ?? ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts'],
    token_envelope: options.invalidEnvelope ? { invalid: true } : tokenEnvelope,
  };
  const render = {
    id: ids.render, company_id: options.renderCompanyId ?? ids.company, job_id: ids.job, status: 'completed',
    output_bucket: 'company-reel-renders', video_object_path: `${ids.company}/${ids.render}/reel.mp4`,
    duration_ms: 12000, width: 1080, height: 1920, fps: 30, video_codec: 'h264',
    pixel_format: 'yuv420p', audio_streams: 0, file_size: options.fileSize ?? bytes.byteLength, video_sha256: videoSha256, faststart: true,
  };
  const repository = fakeRepository(
    connection,
    render,
    options.corruptBytes ? new Uint8Array([9, 9, 9, 9, 9, 9]) : bytes,
    options,
  );
  const provider = fakeProvider(options);
  const deps = {
    repository, provider, config: { configured: true, encryptionKey, timeoutMs: 1000 },
    cryptoApi: webcrypto, now: () => Date.parse('2026-08-17T04:00:00Z'),
    newUuid: () => ids.publication,
    timeoutController: () => ({ signal: new AbortController().signal, clear() {} }),
  };
  return { repository, provider, deps, access: { actorAuthUserId: ids.actor, actorName: 'Owner', actorRole: 'owner' } };
}

function fakeProvider(options) {
  return {
    calls: [], failStage: options.failStage ?? null, statusState: options.statusState ?? 'published',
    statusStates: [...(options.statusStates ?? [])],
    async initializeReel() { await this.call('initialize'); return { providerMediaId: 'mock-video-1' }; },
    async uploadReel() { await this.call('upload'); return { uploaded: true }; },
    async finalizeReel() { await this.call('finalize'); return { finalized: true }; },
    async getReelStatus() {
      await this.call('status');
      return { state: this.statusStates.length > 0 ? this.statusStates.shift() : this.statusState };
    },
    async call(stage) {
      this.calls.push(stage);
      if (options.providerDelay) await new Promise((resolve) => setTimeout(resolve, options.providerDelay));
      if (this.failStage === stage) {
        throw new MetaPublishingError(options.failureCode, undefined, { providerCategory: options.providerCategory ?? 'DELIVERY_UNKNOWN' });
      }
    },
  };
}

function fakeRepository(connection, render, storedBytes, options = {}) {
  const rows = new Map();
  const repository = {
    rows,
    get row() { return rows.get(ids.publication); },
    async getPublicationContext() {
      return { job: { id: ids.job, company_id: ids.company, status: 'Completed' }, connection, customer: null, location: null, invoices: [], comments: [] };
    },
    async getCompletedReel() { return render; },
    async downloadReelBytes() { return storedBytes; },
    async beginReelPublication(input) {
      const existing = [...rows.values()].find((row) => row.intent === input.publicationIntentSha256);
      if (existing) return rpcRow(existing, false);
      const row = {
        id: input.publicationId, status: 'publishing', publication_kind: 'reel_video',
        provider_delivery_stage: 'upload_initializing', provider_call_count: 0, provider_status_checks: 0,
        approved_at: input.timestamp, published_at: null, last_error_code: null,
        reel_provider_media_id: null, render_job_id: input.renderJobId, video_sha256: input.videoSha256,
        approved_message: input.message, intent: input.publicationIntentSha256,
      };
      rows.set(row.id, row);
      return rpcRow(row, true);
    },
    async advanceReelPublication(input) {
      const row = this.row;
      assert.equal(typeof input.actorName, 'string', 'advance Reel RPC requires actorName');
      assert.equal(typeof input.actorRole, 'string', 'advance Reel RPC requires actorRole');
      if (options.failAdvanceStage === input.expectedStage) throw new MetaPublishingError('INTERNAL_ERROR');
      assert.equal(row.provider_delivery_stage, input.expectedStage);
      row.provider_delivery_stage = input.nextStage;
      row.reel_provider_media_id = input.providerMediaId;
      row.provider_call_count += 1;
      return row;
    },
    async recordReelProcessing() {
      const row = this.row;
      row.status = 'publishing'; row.provider_delivery_stage = 'provider_processing';
      row.provider_call_count += 1; row.provider_status_checks += 1;
      return row;
    },
    async claimReelStatusCheck() {
      const row = this.row;
      if (row.status !== 'delivery_unknown' || row.provider_delivery_stage !== 'delivery_unknown'
        || row.provider_call_count >= 6 || row.provider_status_checks >= 3) {
        throw new MetaPublishingError('META_REEL_STATUS_CHECK_LIMIT_REACHED', 409);
      }
      row.status = 'publishing'; row.provider_delivery_stage = 'provider_processing'; row.attempts = 0;
      row.last_error_code = null; row.provider_error_category = null;
      row.provider_call_count += 1; row.provider_status_checks += 1;
      return row;
    },
    async completeReelPublication() {
      const row = this.row;
      row.status = 'published'; row.provider_delivery_stage = 'published'; row.published_at = '2026-08-17T04:00:00Z';
      row.provider_call_count += 1; row.provider_status_checks += 1;
      return row;
    },
    async completeReelReconciliation() {
      const row = this.row;
      assert.equal(row.status, 'publishing');
      assert.equal(row.provider_delivery_stage, 'provider_processing');
      row.status = 'published'; row.provider_delivery_stage = 'published'; row.published_at = '2026-08-17T04:00:00Z';
      return row;
    },
    async failReelPublication(input) {
      const row = this.row;
      row.status = 'failed'; row.provider_delivery_stage = 'failed'; row.last_error_code = input.lastErrorCode;
      row.provider_error_category = input.diagnostic.providerCategory; row.provider_call_count += input.callWasSent ? 1 : 0;
      row.provider_status_checks += input.statusWasChecked ? 1 : 0;
      return row;
    },
    async markReelUnknown(input) {
      const row = this.row;
      row.status = 'delivery_unknown'; row.provider_delivery_stage = 'delivery_unknown';
      row.last_error_code = 'META_PUBLICATION_DELIVERY_UNKNOWN'; row.reel_provider_media_id ||= input.providerMediaId;
      row.provider_error_category = 'DELIVERY_UNKNOWN';
      row.provider_call_count += input.callWasSent ? 1 : 0;
      row.provider_status_checks += input.statusWasChecked ? 1 : 0;
      return row;
    },
    async getReelPublication() { return { ...this.row, connection }; },
  };
  return repository;
}

function rpcRow(row, shouldPublish) {
  return {
    publication_id: row.id, publication_status: row.status, publication_approved_at: row.approved_at,
    publication_published_at: row.published_at, publication_last_error_code: row.last_error_code,
    provider_delivery_stage: row.provider_delivery_stage, should_publish: shouldPublish,
  };
}

function hasCode(code) {
  return (error) => error?.code === code;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
