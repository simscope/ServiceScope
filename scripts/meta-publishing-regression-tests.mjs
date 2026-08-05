import assert from 'node:assert/strict';
import { randomUUID, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildPrivateValues } from '../supabase/functions/_shared/content-engine/context.js';
import { assertMetaAccessRole } from '../supabase/functions/_shared/meta-connection/contracts.js';
import { connectionEnvelopeContext, encryptTokenBundle } from '../supabase/functions/_shared/meta-connection/crypto.js';
import {
  MetaPublishingError,
  facebookPublishingEnabled,
  normalizeApprovedMessage,
  parsePublishingRequest,
  publicationIntentSource,
  runtimePublishingConfig,
  safePublishingTelemetry,
} from '../supabase/functions/_shared/meta-publishing/contracts.js';
import { assertPublicationPrivacy } from '../supabase/functions/_shared/meta-publishing/privacy.js';
import { createFacebookPublishingProvider } from '../supabase/functions/_shared/meta-publishing/provider.js';
import { inspectImageHeader } from '../supabase/functions/_shared/meta-publishing/imageProcessor.js';
import { handleMetaPublishing } from '../supabase/functions/_shared/meta-publishing/service.js';
import {
  beginFacebookPublishSubmission,
  facebookPublicationInProgress,
  facebookPublicationNeedsPageCheck,
  invalidateFacebookPublishApproval,
  openFacebookPublishConfirmation,
  resetFacebookPublishWorkspace,
} from '../.tmp/meta-publishing-tests/workspaceState.js';
import {
  normalizeFacebookPublishingMessage,
} from '../.tmp/meta-publishing-tests/contracts.js';

const cryptoApi = globalThis.crypto ?? webcrypto;
const newTestUuid = () => randomUUID();
const ids = {
  company: '00000000-0000-4000-8000-000000008001',
  otherCompany: '00000000-0000-4000-8000-000000008002',
  actor: '00000000-0000-4000-8000-000000008003',
  job: '00000000-0000-4000-8000-000000008004',
  jobB: '00000000-0000-4000-8000-000000008006',
  connection: '00000000-0000-4000-8000-000000008005',
  attachment: '00000000-0000-4000-8000-000000008007',
};
const jwt = 'synthetic-header.synthetic-payload.synthetic-signature';
const encryptionKey = Buffer.alloc(32, 31).toString('base64');
const config = runtimePublishingConfig((key) => ({
  META_GRAPH_API_VERSION: 'v25.0',
  META_APP_SECRET: 'fake-app-secret-sensitive',
  META_TOKEN_ENCRYPTION_KEY_V1: encryptionKey,
  META_REQUEST_TIMEOUT_MS: '8000',
}[key]));
let checks = 0;
const check = (fn) => { fn(); checks += 1; };
const checkAsync = async (fn) => { await fn(); checks += 1; };

configurationAndAccessChecks();
telemetryChecks();
multilineContractChecks();
privacyChecks();
workspaceChecks();
imagePreflightChecks();
await providerChecks();
await serviceChecks();
await sourceChecks();

console.log(`Meta publishing regression checks passed: ${checks}`);

function configurationAndAccessChecks() {
  check(() => assert.equal(config.configured, true));
  check(() => assert.equal(config.graphApiVersion, 'v25.0'));
  check(() => assert.equal(runtimePublishingConfig(() => '').configured, false));
  check(() => assert.equal(facebookPublishingEnabled({ status: 'connected', granted_scopes: discoveryScopes() }), false));
  check(() => assert.equal(facebookPublishingEnabled({ status: 'connected', granted_scopes: publishingScopes() }), true));
  check(() => assert.equal(facebookPublishingEnabled({ status: 'revoked', granted_scopes: publishingScopes() }), false));

  check(() => assert.doesNotThrow(() => assertMetaAccessRole({ kind: 'owner', role: 'owner' }, ids.company)));
  for (const role of ['admin', 'manager']) {
    check(() => assert.doesNotThrow(() => assertMetaAccessRole({ kind: 'company', role, company_id: ids.company }, ids.company)));
  }
  for (const role of ['technician', 'dispatcher']) {
    check(() => assert.throws(() => assertMetaAccessRole({ kind: 'company', role, company_id: ids.company }, ids.company), /FORBIDDEN/));
  }
  for (const role of ['admin', 'support', 'viewer']) {
    check(() => assert.throws(() => assertMetaAccessRole({ kind: 'owner', role }, ids.company), /FORBIDDEN/));
  }
  check(() => assert.throws(() => assertMetaAccessRole({ kind: 'company', role: 'admin', company_id: ids.otherCompany }, ids.company), /FORBIDDEN/));

  check(() => assert.equal(parsePublishingRequest(JSON.stringify({ action: 'status', companyId: ids.company })).action, 'status'));
  check(() => assert.equal(parsePublishingRequest(JSON.stringify({ action: 'status', companyId: ids.company, jobId: ids.job })).jobId, ids.job));
  check(() => assert.equal(parsePublishingRequest(JSON.stringify({ action: 'revoke_facebook_publication_photo_approval', companyId: ids.company, jobId: ids.job, attachmentId: ids.attachment, explicitApproval: true })).action, 'revoke_facebook_publication_photo_approval'));
  for (const invalid of [
    { action: 'publish_facebook_text', companyId: ids.company, jobId: ids.job, message: 'Ready', idempotencyKey: newTestUuid() },
    { action: 'publish_facebook_text', companyId: ids.company, jobId: ids.job, message: 'Ready', idempotencyKey: newTestUuid(), explicitApproval: false },
    { action: 'publish_facebook_text', companyId: ids.company, jobId: ids.job, message: 'Ready', idempotencyKey: newTestUuid(), explicitApproval: true, pageId: '123' },
    { action: 'publish_facebook_text', companyId: ids.company, jobId: ids.job, message: 'Ready', idempotencyKey: newTestUuid(), explicitApproval: true, scheduledAt: new Date().toISOString() },
    { action: 'publish_facebook_single_photo', companyId: ids.company, jobId: ids.job, attachmentId: ids.attachment, message: 'Ready', idempotencyKey: newTestUuid(), explicitApproval: true, mediaUrl: 'https://example.test/photo.jpg' },
    { action: 'publish_facebook_single_photo', companyId: ids.company, jobId: ids.job, attachmentId: ids.attachment, message: 'Ready', idempotencyKey: newTestUuid(), explicitApproval: true, storagePath: 'private/path.jpg' },
    { action: 'publish_facebook_single_photo', companyId: ids.company, jobId: ids.job, attachmentId: ids.attachment, message: 'Ready', idempotencyKey: newTestUuid(), explicitApproval: true, base64: 'AA==' },
    { action: 'publish_facebook_single_photo', companyId: ids.company, jobId: ids.job, attachmentId: ids.attachment, message: 'Ready', idempotencyKey: newTestUuid(), explicitApproval: true, pageId: '123' },
    { action: 'revoke_facebook_publication_photo_approval', companyId: ids.company, jobId: ids.job, attachmentId: ids.attachment, explicitApproval: true, storagePath: 'private/path.jpg' },
    { action: 'publish_instagram_text', companyId: ids.company },
  ]) {
    if (invalid.action === 'publish_facebook_text' && invalid.explicitApproval !== true) {
      check(() => assert.equal(parsePublishingRequest(JSON.stringify(invalid)).action, 'publish_facebook_text'));
    } else {
      check(() => assert.throws(() => parsePublishingRequest(JSON.stringify(invalid)), /INVALID_REQUEST/));
    }
  }
  check(() => assert.throws(() => parsePublishingRequest('x'.repeat(24_001), 24_000), /INVALID_REQUEST/));
}

function imagePreflightChecks() {
  check(() => assert.deepEqual(inspectImageHeader(jpegHeader(400, 300)), { mimeType: 'image/jpeg', width: 400, height: 300 }));
  check(() => assert.deepEqual(inspectImageHeader(pngHeader(320, 240)), { mimeType: 'image/png', width: 320, height: 240 }));
  for (const invalid of [
    new Uint8Array([0x47, 0x49, 0x46, 0x38]),
    new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    pngHeader(100, 100, 'acTL'),
    jpegHeader(0, 100),
  ]) {
    check(() => assert.throws(() => inspectImageHeader(invalid), /META_PUBLICATION_MEDIA_UNSUPPORTED/));
  }
}

function multilineContractChecks() {
  const exact = [
    'Service story: our team documented work for a rooftop unit.',
    'The reported issue was: insufficient cooling.',
    'Recorded work performed: replaced the failed contactor.',
    'Final result: normal operation verified.',
  ].join('\n');
  const aiResult = 'Headline: Rooftop unit service update\nBody: Replaced the failed contactor.\nCTA: Schedule documented service support.';
  for (const value of [exact, aiResult]) {
    check(() => assert.equal(normalizeApprovedMessage(value), value));
    check(() => assert.equal(normalizeFacebookPublishingMessage(value), value));
  }
  for (const [input, expected] of [
    [`  ${exact}\r\n  `, exact],
    ['Line one\r\n\r\nLine three', 'Line one\n\nLine three'],
    ['Line one\rLine two', 'Line one\nLine two'],
  ]) {
    check(() => assert.equal(normalizeApprovedMessage(input), expected));
    check(() => assert.equal(normalizeFacebookPublishingMessage(input), expected));
  }
  for (const invalid of ['bad\ttext', '\tbad text', `bad\u0000text`, `bad\u000btext`, `bad\u007ftext`, '[private]']) {
    check(() => assert.throws(() => normalizeApprovedMessage(invalid), /INVALID_REQUEST/));
    check(() => assert.throws(() => normalizeFacebookPublishingMessage(invalid), /INVALID_REQUEST/));
  }
}

function telemetryChecks() {
  check(() => assert.deepEqual(safePublishingTelemetry({ action: 'publish_facebook_text', success: true, code: 'OK', stage: 'facebook_publish', attempts: 1, latencyMs: 10 }), {
    event: 'meta-social-publish', action: 'publish_facebook_text', success: true, code: 'OK', stage: 'facebook_publish', attempts: 1, latencyMs: 10,
    providerHttpStatus: null, providerCode: null, providerSubcode: null, providerCategory: null, providerIsTransient: null,
  }));
}

function privacyChecks() {
  const context = {
    job: { job_number: 'JOB-100', notes: 'customer asked for quiet operation', service_call_fee_cents: 9900, labor_cents: 12500 },
    customer: { organization: 'Private Customer LLC', primary_name: 'Taylor Private', primary_email: 'private@example.test', primary_phone: '212-555-0199', notes: '' },
    location: { address: '10 Private Street' },
    invoices: [{ invoice_number: 'INV-100', amount_cents: 22400, status: 'open' }],
    comments: [{ message: 'Gate code 2468' }],
  };
  const privateValues = buildPrivateValues(context);
  check(() => assert.ok(privateValues.includes('Private Customer LLC')));
  for (const value of [
    'Private Customer LLC received service.',
    'Email private@example.test for details.',
    'Call 212-555-0199 today.',
    'Service completed at 10 Private Street.',
    'Gate code 2468.',
    'Invoice # INV-100 is ready.',
    'Unresolved [private] value.',
  ]) {
    check(() => assert.throws(() => assertPublicationPrivacy(value, privateValues), /META_PUBLICATION_PRIVACY_REVIEW_REQUIRED/));
  }
  for (const value of [
    'Installed a new ECM blower motor and verified operation.',
    'Supply air measured 55 F after service.',
    'Suction pressure stabilized at 118 psi.',
    'Replaced the contactor and confirmed normal amperage.',
  ]) {
    check(() => assert.doesNotThrow(() => assertPublicationPrivacy(value, privateValues)));
  }
}

function workspaceChecks() {
  const multiline = 'Exact final text\n\nSecond paragraph';
  const opened = openFacebookPublishConfirmation(multiline, '00000000-0000-4000-8000-000000008010');
  check(() => assert.equal(opened.confirmationOpen, true));
  check(() => assert.equal(opened.approved, false));
  check(() => assert.equal(beginFacebookPublishSubmission(opened).shouldSubmit, false));
  const approved = { ...opened, approved: true };
  const begun = beginFacebookPublishSubmission(approved);
  check(() => assert.equal(begun.shouldSubmit, true));
  check(() => assert.equal(beginFacebookPublishSubmission(begun.state).shouldSubmit, false));
  check(() => assert.equal(invalidateFacebookPublishApproval(approved, 'Edited final text').confirmationOpen, false));
  check(() => assert.equal(invalidateFacebookPublishApproval(approved, multiline).confirmationOpen, true));
  const settled = { ...approved, confirmationOpen: false, result: { status: 'published' } };
  check(() => assert.equal(invalidateFacebookPublishApproval(settled, multiline).result?.status, 'published'));
  check(() => assert.equal(invalidateFacebookPublishApproval(settled, 'Edited final text').result, null));
  check(() => assert.equal(facebookPublicationInProgress({ status: 'publishing' }), true));
  check(() => assert.equal(facebookPublicationInProgress({ status: 'published' }), false));
  check(() => assert.equal(facebookPublicationNeedsPageCheck({ status: 'delivery_unknown' }), true));
  check(() => assert.equal(facebookPublicationNeedsPageCheck(null, 'META_PUBLICATION_DELIVERY_UNKNOWN'), true));

  const jobA = { ...settled, approvedMessage: multiline, idempotencyKey: '00000000-0000-4000-8000-000000008011' };
  const jobB = resetFacebookPublishWorkspace();
  check(() => assert.equal(jobB.result, null));
  check(() => assert.equal(jobB.idempotencyKey, null));
  check(() => assert.equal(jobB.confirmationOpen, false));
  const jobBOpened = openFacebookPublishConfirmation(multiline, '00000000-0000-4000-8000-000000008012');
  check(() => assert.notEqual(jobBOpened.idempotencyKey, jobA.idempotencyKey));
}

async function providerChecks() {
  const sensitiveToken = 'fake-page-access-token-sensitive';
  const multiline = [
    'Service story: our team documented work for a rooftop unit.',
    'The reported issue was: insufficient cooling.',
    'Recorded work performed: replaced the failed contactor.',
    'Final result: normal operation verified.',
  ].join('\n');
  const calls = [];
  const provider = createFacebookPublishingProvider({
    config,
    cryptoApi,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ id: '10001_20002' }), { status: 200 });
    },
  });
  const result = await provider.publishText({ pageId: '10001', pageAccessToken: sensitiveToken, message: multiline, signal: new AbortController().signal });
  check(() => assert.equal(result.providerPostId, '10001_20002'));
  check(() => assert.equal(calls.length, 1));
  check(() => assert.equal(calls[0].url, 'https://graph.facebook.com/v25.0/10001/feed'));
  check(() => assert.equal(calls[0].options.method, 'POST'));
  check(() => assert.equal(calls[0].options.headers.Authorization, `Bearer ${sensitiveToken}`));
  check(() => assert.ok(!calls[0].url.includes(sensitiveToken)));
  check(() => assert.ok(!String(calls[0].options.body).includes(sensitiveToken)));
  check(() => assert.equal(new URLSearchParams(String(calls[0].options.body)).get('message'), multiline));
  check(() => assert.match(String(calls[0].options.body), /%0A/));

  const rejected = createFacebookPublishingProvider({
    config,
    cryptoApi,
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'raw sensitive message', code: 200, error_subcode: 10, is_transient: false } }), { status: 403 }),
  });
  await checkAsync(() => assert.rejects(
    rejected.publishText({ pageId: '10001', pageAccessToken: sensitiveToken, message: 'Approved', signal: new AbortController().signal }),
    (error) => error.code === 'META_PUBLICATION_PROVIDER_REJECTED' && error.diagnostic.providerCategory === 'MISSING_PERMISSION' && !JSON.stringify(error).includes('raw sensitive message'),
  ));

  const unavailable = createFacebookPublishingProvider({ config, cryptoApi, fetchImpl: async () => { throw new Error('network detail'); } });
  await checkAsync(() => assert.rejects(
    unavailable.publishText({ pageId: '10001', pageAccessToken: sensitiveToken, message: 'Approved', signal: new AbortController().signal }),
    (error) => error.code === 'META_PUBLICATION_DELIVERY_UNKNOWN',
  ));

  const malformed = createFacebookPublishingProvider({ config, cryptoApi, fetchImpl: async () => new Response('{}', { status: 200 }) });
  await checkAsync(() => assert.rejects(
    malformed.publishText({ pageId: '10001', pageAccessToken: sensitiveToken, message: 'Approved', signal: new AbortController().signal }),
    (error) => error.code === 'META_PUBLICATION_FAILED' && error.diagnostic.providerCategory === 'RESPONSE_MISSING_POST_ID',
  ));

  const photoCalls = [];
  const photoProvider = createFacebookPublishingProvider({
    config,
    cryptoApi,
    fetchImpl: async (url, options) => {
      photoCalls.push({ url, options });
      return new Response(JSON.stringify({ id: '10001_photo_30003' }), { status: 200 });
    },
  });
  const photoResult = await photoProvider.publishSinglePhoto({
    pageId: '10001',
    pageAccessToken: sensitiveToken,
    message: multiline,
    photoBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    mimeType: 'image/jpeg',
    signal: new AbortController().signal,
  });
  check(() => assert.equal(photoResult.providerPostId, null));
  check(() => assert.equal(photoResult.providerMediaId, '10001_photo_30003'));
  check(() => assert.equal(photoCalls.length, 1));
  check(() => assert.equal(photoCalls[0].url, 'https://graph.facebook.com/v25.0/10001/photos'));
  check(() => assert.equal(photoCalls[0].options.method, 'POST'));
  check(() => assert.equal(photoCalls[0].options.headers.Authorization, `Bearer ${sensitiveToken}`));
  check(() => assert.ok(photoCalls[0].options.body instanceof FormData));

  const missingMediaId = createFacebookPublishingProvider({ config, cryptoApi, fetchImpl: async () => new Response('{}', { status: 200 }) });
  await checkAsync(() => assert.rejects(
    missingMediaId.publishSinglePhoto({
      pageId: '10001',
      pageAccessToken: sensitiveToken,
      message: multiline,
      photoBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      mimeType: 'image/jpeg',
      signal: new AbortController().signal,
    }),
    (error) => error.code === 'META_PUBLICATION_FAILED' && error.diagnostic.providerCategory === 'RESPONSE_MISSING_MEDIA_ID',
  ));
}

async function serviceChecks() {
  const base = await makeDependencies();
  const threeScope = await invoke(base, { action: 'status', companyId: ids.company, jobId: ids.job });
  check(() => assert.equal(threeScope.connected, true));
  check(() => assert.equal(threeScope.facebookPublishingEnabled, false));
  check(() => assert.deepEqual(threeScope.missingPermissions, ['pages_manage_posts']));

  base.context.connection.granted_scopes = publishingScopes();
  const ready = await invoke(base, { action: 'status', companyId: ids.company, jobId: ids.job });
  check(() => assert.equal(ready.facebookPublishingEnabled, true));
  check(() => assert.deepEqual(ready.missingPermissions, []));
  check(() => assert.ok(!JSON.stringify(ready).includes(ids.job)));
  const companyOnlyStatus = await invoke(base, { action: 'status', companyId: ids.company });
  check(() => assert.equal(companyOnlyStatus.facebookPublishingEnabled, true));
  await checkAsync(() => assert.rejects(
    invoke(base, { action: 'status', companyId: ids.company, jobId: ids.jobB }),
    /FORBIDDEN/,
  ));

  const idempotencyKey = '00000000-0000-4000-8000-000000008020';
  const exactMultiline = [
    'Service story: our team documented work for a rooftop unit.',
    'The reported issue was: insufficient cooling.',
    'Recorded work performed: replaced the failed contactor.',
    'Final result: normal operation verified.',
  ].join('\n');
  const request = publishRequest(`  ${exactMultiline.replace(/\n/g, '\r\n')}  `, idempotencyKey);
  const published = await invoke(base, request);
  check(() => assert.equal(published.status, 'published'));
  check(() => assert.equal(base.providerCalls.length, 1));
  check(() => assert.ok(!('providerPostId' in published)));
  check(() => assert.ok(!JSON.stringify(published).includes('10001_20002')));
  check(() => assert.equal(base.providerCalls[0].message, exactMultiline));
  check(() => assert.equal(base.beginInputs[0].message, exactMultiline));
  check(() => assert.deepEqual(
    { actorAuthUserId: base.beginInputs[0].actorAuthUserId, actorName: base.beginInputs[0].actorName, actorRole: base.beginInputs[0].actorRole },
    { actorAuthUserId: ids.actor, actorName: 'Publisher', actorRole: 'admin' },
  ));
  const expectedHash = `\\x${Buffer.from(await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(exactMultiline))).toString('hex')}`;
  check(() => assert.equal(base.beginInputs[0].messageSha256, expectedHash));
  const expectedIntent = `\\x${Buffer.from(await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(publicationIntentSource({
    companyId: ids.company,
    jobId: ids.job,
    connectionId: ids.connection,
    actorAuthUserId: ids.actor,
    publicationKind: 'text_only',
    approvedMessage: exactMultiline,
    attachmentId: null,
  })))).toString('hex')}`;
  check(() => assert.equal(base.beginInputs[0].publicationIntentSha256, expectedIntent));
  check(() => assert.deepEqual(actorRecordOnly(base.terminalActors[0]), { action: 'complete', actorAuthUserId: ids.actor, actorName: 'Publisher', actorRole: 'admin' }));
  await invoke(base, request);
  check(() => assert.equal(base.providerCalls.length, 1));
  await invoke(base, { ...request, idempotencyKey: '00000000-0000-4000-8000-000000008021' });
  check(() => assert.equal(base.providerCalls.length, 1));

  for (const body of [
    { ...request, explicitApproval: false },
    { ...request, message: '' },
    { ...request, message: 'x'.repeat(5001) },
    { ...request, pageId: '10001' },
    { ...request, mediaIds: ['photo-1'] },
    { ...request, scheduledAt: new Date().toISOString() },
  ]) {
    await checkAsync(() => assert.rejects(invoke(base, body), /INVALID_REQUEST/));
  }
  await checkAsync(() => assert.rejects(invoke(base, publishRequest('Contact private@example.test for access.', newTestUuid())), /META_PUBLICATION_PRIVACY_REVIEW_REQUIRED/));
  check(() => assert.equal(base.providerCalls.length, 1));

  const network = await makeDependencies({ providerError: new MetaPublishingError('META_PUBLICATION_DELIVERY_UNKNOWN', undefined, { providerCategory: 'DELIVERY_UNKNOWN' }) });
  network.context.connection.granted_scopes = publishingScopes();
  const networkKey = '00000000-0000-4000-8000-000000008030';
  await checkAsync(() => assert.rejects(invoke(network, publishRequest('Verified normal airflow.', networkKey)), /META_PUBLICATION_DELIVERY_UNKNOWN/));
  check(() => assert.equal(network.publications.get(networkKey).publication_status, 'delivery_unknown'));
  check(() => assert.equal(network.providerCalls.length, 1));
  await checkAsync(() => assert.rejects(invoke(network, publishRequest('Verified normal airflow.', networkKey)), /META_PUBLICATION_DELIVERY_UNKNOWN/));
  check(() => assert.equal(network.providerCalls.length, 1));

  const unknownPersistenceFailure = await makeDependencies({
    providerError: new MetaPublishingError('META_PUBLICATION_DELIVERY_UNKNOWN', undefined, { providerCategory: 'DELIVERY_UNKNOWN' }),
    markUnknownError: new Error('database detail'),
  });
  unknownPersistenceFailure.context.connection.granted_scopes = publishingScopes();
  const unknownPersistenceKey = '00000000-0000-4000-8000-000000008031';
  await checkAsync(() => assert.rejects(
    invoke(unknownPersistenceFailure, publishRequest('Verified safe operation.', unknownPersistenceKey)),
    /META_PUBLICATION_DELIVERY_UNKNOWN/,
  ));
  check(() => assert.equal(unknownPersistenceFailure.publications.get(unknownPersistenceKey).publication_status, 'publishing'));
  await checkAsync(() => assert.rejects(
    invoke(unknownPersistenceFailure, publishRequest('Verified safe operation.', unknownPersistenceKey)),
    /META_PUBLICATION_IN_PROGRESS/,
  ));
  check(() => assert.equal(unknownPersistenceFailure.providerCalls.length, 1));
  const remounted = await invoke(unknownPersistenceFailure, { action: 'status', companyId: ids.company, jobId: ids.job });
  check(() => assert.equal(remounted.lastPublication.status, 'publishing'));
  check(() => assert.equal(facebookPublicationInProgress(remounted.lastPublication), true));
  check(() => assert.doesNotMatch(JSON.stringify(unknownPersistenceFailure.telemetryEvents), /database detail|Verified safe operation/));

  const failure = await makeDependencies({ providerError: new MetaPublishingError('META_PUBLICATION_PROVIDER_REJECTED', undefined, { providerHttpStatus: 403, providerCode: 200, providerCategory: 'MISSING_PERMISSION', providerIsTransient: false }) });
  failure.context.connection.granted_scopes = publishingScopes();
  const failureKey = '00000000-0000-4000-8000-000000008040';
  await checkAsync(() => assert.rejects(invoke(failure, publishRequest('Verified normal operation.', failureKey)), /META_PUBLICATION_PROVIDER_REJECTED/));
  check(() => assert.equal(failure.publications.get(failureKey).publication_status, 'failed'));
  check(() => assert.deepEqual(failure.terminalActors[0], { action: 'fail', actorAuthUserId: ids.actor, actorName: 'Publisher', actorRole: 'admin' }));
  await checkAsync(() => assert.rejects(invoke(failure, publishRequest('Verified normal operation.', failureKey)), /META_PUBLICATION_PROVIDER_REJECTED/));
  check(() => assert.equal(failure.providerCalls.length, 1));

  const brokenEnvelope = await makeDependencies();
  brokenEnvelope.context.connection.granted_scopes = publishingScopes();
  brokenEnvelope.context.connection.token_envelope = { invalid: true };
  await checkAsync(() => assert.rejects(invoke(brokenEnvelope, publishRequest('Verified operation.', newTestUuid())), /META_CONNECTION_NEEDS_REAUTHORIZATION/));
  check(() => assert.equal(brokenEnvelope.providerCalls.length, 0));

  const unsupported = await makeDependencies();
  unsupported.context.connection.granted_scopes = publishingScopes();
  unsupported.context.job.status = 'In progress';
  await checkAsync(() => assert.rejects(
    invoke(unsupported, publishRequest('This action is unavailable.', newTestUuid())),
    /INVALID_REQUEST/,
  ));
  check(() => assert.equal(unsupported.providerCalls.length, 0));

  check(() => assert.deepEqual(network.terminalActors[0], { action: 'unknown', actorAuthUserId: ids.actor, actorName: 'Publisher', actorRole: 'admin' }));
  check(() => assert.equal(base.statusCalls[0].jobId, ids.job));

  const photoBase = await makeDependencies();
  photoBase.context.connection.granted_scopes = publishingScopes();
  const photoKey = '00000000-0000-4000-8000-000000008050';
  const photoPublished = await invoke(photoBase, singlePhotoRequest('Verified normal operation.', photoKey));
  check(() => assert.equal(photoPublished.status, 'published'));
  check(() => assert.equal(photoBase.providerCalls.length, 1));
  check(() => assert.equal(photoBase.providerCalls[0].kind, 'single_photo'));
  check(() => assert.equal(photoBase.providerCalls[0].attachmentId, ids.attachment));
  check(() => assert.equal(photoBase.beginInputs[0].publicationKind, 'single_photo'));
  check(() => assert.equal(photoBase.beginInputs[0].attachmentId, ids.attachment));
  check(() => assert.equal(photoBase.beginInputs[0].safeMimeType, 'image/jpeg'));
  check(() => assert.equal(photoBase.beginInputs[0].mediaCount, 1));
  check(() => assert.equal(photoBase.providerCalls[0].photoBytes.includes(0xe1), false));
  check(() => assert.equal(photoBase.terminalActors[0].publicationAuditMetadata.providerCallCount, 1));
  check(() => assert.equal(photoBase.terminalActors[0].publicationAuditMetadata.sanitizer, 'ImageScript'));
  check(() => assert.equal(photoBase.terminalActors[0].publicationAuditMetadata.sanitizerVersion, '1.3.0'));
  check(() => assert.equal(photoBase.terminalActors[0].publicationAuditMetadata.metadataStripped, true));
  check(() => assert.equal(photoBase.terminalActors[0].publicationAuditMetadata.gpsStripped, true));
  check(() => assert.match(photoBase.terminalActors[0].publicationAuditMetadata.originalHashPrefix, /^[0-9a-f]{16}$/));
  check(() => assert.match(photoBase.terminalActors[0].publicationAuditMetadata.sanitizedHashPrefix, /^[0-9a-f]{16}$/));
  await invoke(photoBase, singlePhotoRequest('Verified normal operation.', photoKey));
  check(() => assert.equal(photoBase.providerCalls.length, 1));

  const revokedPhoto = await makeDependencies();
  revokedPhoto.context.connection.granted_scopes = publishingScopes();
  const revocation = await invoke(revokedPhoto, { action: 'revoke_facebook_publication_photo_approval', companyId: ids.company, jobId: ids.job, attachmentId: ids.attachment, explicitApproval: true });
  check(() => assert.equal(revocation.approvalStatus, 'revoked'));
  await checkAsync(() => assert.rejects(invoke(revokedPhoto, singlePhotoRequest('Verified normal operation.', newTestUuid())), /META_PUBLICATION_MEDIA_PRIVACY_REVIEW_REQUIRED/));
  check(() => assert.equal(revokedPhoto.providerCalls.length, 0));

  const missingMedia = await makeDependencies({ providerError: new MetaPublishingError('META_PUBLICATION_FAILED', undefined, { providerCategory: 'RESPONSE_MISSING_MEDIA_ID' }) });
  missingMedia.context.connection.granted_scopes = publishingScopes();
  const missingMediaKey = '00000000-0000-4000-8000-000000008055';
  await checkAsync(() => assert.rejects(invoke(missingMedia, singlePhotoRequest('Verified normal operation.', missingMediaKey)), /META_PUBLICATION_FAILED/));
  check(() => assert.equal(missingMedia.publications.get(missingMediaKey).publication_status, 'failed'));
  check(() => assert.equal(missingMedia.publications.get(missingMediaKey).provider_error_category, 'RESPONSE_MISSING_MEDIA_ID'));
  await checkAsync(() => assert.rejects(invoke(missingMedia, singlePhotoRequest('Verified normal operation.', missingMediaKey)), /META_PUBLICATION_FAILED/));
  check(() => assert.equal(missingMedia.providerCalls.length, 1));

  const unapprovedPhoto = await makeDependencies({ photoApproved: false });
  unapprovedPhoto.context.connection.granted_scopes = publishingScopes();
  await checkAsync(() => assert.rejects(invoke(unapprovedPhoto, singlePhotoRequest('Verified normal operation.', newTestUuid())), /META_PUBLICATION_MEDIA_PRIVACY_REVIEW_REQUIRED/));
  check(() => assert.equal(unapprovedPhoto.providerCalls.length, 0));

  const noPhoto = await makeDependencies({ attachment: null });
  noPhoto.context.connection.granted_scopes = publishingScopes();
  await checkAsync(() => assert.rejects(invoke(noPhoto, singlePhotoRequest('Verified normal operation.', newTestUuid())), /META_PUBLICATION_MEDIA_REQUIRED/));
  const video = await makeDependencies({ attachmentPatch: { kind: 'video', mime_type: 'video/mp4' } });
  video.context.connection.granted_scopes = publishingScopes();
  await checkAsync(() => assert.rejects(invoke(video, singlePhotoRequest('Verified normal operation.', newTestUuid())), /META_PUBLICATION_MEDIA_UNSUPPORTED/));
  const oversized = await makeDependencies({ attachmentPatch: { size_bytes: 12_000_001 } });
  oversized.context.connection.granted_scopes = publishingScopes();
  await checkAsync(() => assert.rejects(invoke(oversized, singlePhotoRequest('Verified normal operation.', newTestUuid())), /META_PUBLICATION_MEDIA_TOO_LARGE/));

  for (const event of [...base.telemetryEvents, ...network.telemetryEvents, ...failure.telemetryEvents, ...brokenEnvelope.telemetryEvents]) {
    check(() => assert.deepEqual(Object.keys(event).sort(), [
      'action', 'attempts', 'code', 'event', 'latencyMs', 'providerCategory', 'providerCode',
      'providerHttpStatus', 'providerIsTransient', 'providerSubcode', 'stage', 'success',
    ].sort()));
  }
}

async function sourceChecks() {
  const edge = await readFile(new URL('../supabase/functions/meta-social-publish/index.ts', import.meta.url), 'utf8');
  const provider = await readFile(new URL('../supabase/functions/_shared/meta-publishing/provider.js', import.meta.url), 'utf8');
  const client = await readFile(new URL('../src/features/meta-publishing/clientApi.ts', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../src/components/portal/FacebookPublishPanel.tsx', import.meta.url), 'utf8');
  check(() => assert.match(edge, /auth\.getUser\(jwt\)/));
  check(() => assert.match(edge, /app_current_session/));
  check(() => assert.match(edge, /can_manage_company/));
  check(() => assert.match(edge, /some\(\(result\) => result\.error\)/));
  check(() => assert.match(edge, /\.eq\('job_id', jobId\)/));
  check(() => assert.doesNotMatch(client, /graph\.facebook\.com|access_token|pageId|connectionId/));
  check(() => assert.match(provider, /Authorization: `Bearer \$\{pageAccessToken\}`/));
  check(() => assert.doesNotMatch(provider, /access_token/));
  check(() => assert.doesNotMatch(provider, /for\s*\(|while\s*\(/));
  check(() => assert.match(panel, /I reviewed the exact final text and approve publishing it to the Facebook Page now\./));
  check(() => assert.match(panel, /selected photos and videos will not be uploaded/i));
  check(() => assert.match(panel, /A Facebook publication for this job is already in progress\./));
  check(() => assert.match(panel, /blocked until a reconciliation workflow resolves the unknown delivery state/i));
  check(() => assert.match(panel, /\[companyId, jobId, refreshToken\]/));
  check(() => assert.match(panel, /Completed.*Warranty/s));
  check(() => assert.doesNotMatch(panel, /retry/i));
  check(() => assert.doesNotMatch(`${client}\n${panel}`, /providerPostId|facebookPageId|token_envelope|service_role/));
}

async function makeDependencies({ providerError = null, markUnknownError = null, attachment = undefined, attachmentPatch = {}, photoApproved = true } = {}) {
  const connection = {
    id: ids.connection,
    company_id: ids.company,
    status: 'connected',
    facebook_page_id: '10001',
    facebook_page_name: 'ServiceScope',
    granted_scopes: discoveryScopes(),
    token_envelope: null,
  };
  connection.token_envelope = await encryptTokenBundle(
    { schemaVersion: 'meta-connection-token-bundle-v1', userAccessToken: 'fake-user-token-sensitive', pageAccessToken: 'fake-page-token-sensitive' },
    encryptionKey,
    connectionEnvelopeContext({ companyId: ids.company, connectionId: ids.connection, pageId: '10001' }),
    cryptoApi,
  );
  const context = {
    job: { id: ids.job, company_id: ids.company, status: 'Completed', job_number: 'JOB-100', notes: '', service_call_fee_cents: 0, labor_cents: 0 },
    connection,
    customer: { organization: '', primary_name: '', primary_email: 'private@example.test', primary_phone: '', notes: '' },
    location: { address: '' },
    invoices: [],
    comments: [],
  };
  const selectedAttachment = attachment === null ? null : {
    id: ids.attachment,
    company_id: ids.company,
    job_id: ids.job,
    name: 'approved-photo.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 24,
    kind: 'photo',
    storage_bucket: 'job-files',
    storage_path: `${ids.company}/${ids.job}/approved-photo.jpg`,
    ...attachmentPatch,
  };
  const publications = new Map();
  const providerCalls = [];
  const beginInputs = [];
  const terminalActors = [];
  const statusCalls = [];
  const telemetryEvents = [];
  const revokeInputs = [];
  const excludeInputs = [];
  const falsePositiveInputs = [];
  let photoRevoked = false;
  let photoExcluded = false;
  let findingsResolved = false;
  let clock = Date.parse('2026-08-03T12:00:00.000Z');
  return {
    context,
    publications,
    providerCalls,
    beginInputs,
    terminalActors,
    statusCalls,
    telemetryEvents,
    auth: {
      resolveSession: async () => ({ kind: 'company', role: 'admin', company_id: ids.company }),
      assertCompanyAccess: async () => ({ actorAuthUserId: ids.actor, actorName: 'Publisher', actorRole: 'admin' }),
    },
    repository: {
      getStatus: async (companyId, jobId) => {
        statusCalls.push({ companyId, jobId });
        if (companyId !== ids.company || (jobId && jobId !== context.job.id)) throw new MetaPublishingError('FORBIDDEN');
        const latest = [...publications.values()].reverse().find((row) => !jobId || row.job_id === jobId);
        return {
          connection,
          lastPublication: latest ? {
            status: latest.publication_status,
            approved_at: latest.publication_approved_at,
            published_at: latest.publication_published_at,
            last_error_code: latest.publication_last_error_code,
          } : null,
          eligiblePhotos: photoApproved && selectedAttachment && !photoRevoked ? [{
            attachmentId: ids.attachment,
            displayName: 'approved-photo.jpg',
            previewUrl: null,
            mimeType: 'image/jpeg',
            approvalStatus: 'approved',
            approvedAt: '2026-08-03T12:00:00.000Z',
            revokedAt: null,
            analysisRunId: '00000000-0000-4000-8000-000000008081',
            analysisStatus: 'completed',
            privacyReviewStatus: 'passed',
            checksumMatch: true,
            eligibleForFacebookPublication: true,
          }] : [],
        };
      },
      getPublicationContext: async () => context,
      getPublicationAttachment: async (companyId, jobId, attachmentId) => {
        if (!selectedAttachment || companyId !== ids.company || jobId !== ids.job || attachmentId !== ids.attachment) return null;
        return selectedAttachment;
      },
      downloadAttachmentBytes: async () => jpegWithExifBytes(),
      approvePublicationPhoto: async (input) => ({
        id: input.approvalId,
        company_id: input.companyId,
        job_id: input.jobId,
        attachment_id: input.attachmentId,
        approval_status: 'approved',
        approved_at: input.timestamp,
      }),
      revokePublicationPhotoApproval: async (input) => {
        revokeInputs.push(input);
        photoRevoked = true;
        return {
          id: newTestUuid(),
          company_id: input.companyId,
          job_id: input.jobId,
          attachment_id: input.attachmentId,
          approval_status: 'revoked',
          revoked_at: input.timestamp,
        };
      },
      excludePublicationPhoto: async (input) => {
        excludeInputs.push(input);
        photoExcluded = true;
        photoRevoked = true;
        return { attachment_id: input.attachmentId, excluded: true, revoked_approval_id: newTestUuid() };
      },
      resolvePublicationPhotoFalsePositive: async (input) => {
        falsePositiveInputs.push(input);
        findingsResolved = true;
        return { attachment_id: input.attachmentId, privacy_review_status: 'resolved_false_positive', resolved_finding_count: input.findingIds.length };
      },
      getPublicationPhotoApproval: async (companyId, jobId, attachmentId, attachmentSha256) => {
        if (photoRevoked || photoExcluded || !photoApproved || companyId !== ids.company || jobId !== ids.job || attachmentId !== ids.attachment) return null;
        const expected = `\\x${Buffer.from(await cryptoApi.subtle.digest('SHA-256', jpegWithExifBytes())).toString('hex')}`;
        return attachmentSha256 === expected ? {
          id: '00000000-0000-4000-8000-000000008080',
          analysis_run_id: '00000000-0000-4000-8000-000000008081',
          approval_status: 'approved',
          approved_at: '2026-08-03T12:00:00.000Z',
          revoked_at: null,
        } : null;
      },
      revalidatePublicationPhotoEligibility: async (companyId, jobId, attachmentId, attachmentSha256) => {
        if (photoRevoked || photoExcluded || !photoApproved || companyId !== ids.company || jobId !== ids.job || attachmentId !== ids.attachment) return null;
        const expected = `\\x${Buffer.from(await cryptoApi.subtle.digest('SHA-256', jpegWithExifBytes())).toString('hex')}`;
        if (attachmentSha256 !== expected) return null;
        const approval = {
          id: '00000000-0000-4000-8000-000000008080',
          analysis_run_id: '00000000-0000-4000-8000-000000008081',
          approval_status: 'approved',
          approved_at: '2026-08-03T12:00:00.000Z',
          revoked_at: null,
        };
        return {
          attachmentId,
          approvalId: approval.id,
          approvalStatus: 'approved',
          approvedAt: approval.approved_at,
          revokedAt: null,
          analysisRunId: approval.analysis_run_id,
          analysisStatus: 'completed',
          privacyReviewStatus: findingsResolved ? 'resolved_false_positive' : 'passed',
          checksumMatch: true,
          eligibleForFacebookPublication: true,
          approval,
        };
      },
      beginPublication: async (input) => {
        beginInputs.push(input);
        const existing = publications.get(input.publicationIntentSha256);
        if (existing) return { ...existing, should_publish: false };
        const row = {
          publication_id: input.publicationId,
          publication_status: 'publishing',
          publication_approved_at: input.timestamp,
          publication_published_at: null,
          publication_last_error_code: null,
          job_id: input.jobId,
          publication_kind: input.publicationKind,
          attachment_id: input.attachmentId,
          safe_mime_type: input.safeMimeType,
          media_count: input.mediaCount,
          should_publish: true,
        };
        publications.set(input.publicationIntentSha256, row);
        publications.set(input.idempotencyKey, row);
        return row;
      },
      completePublication: async (input) => {
        terminalActors.push({ ...actorRecord('complete', input), publicationAuditMetadata: input.publicationAuditMetadata ?? {} });
        return updatePublication(publications, input.publicationId, {
          publication_status: 'published', publication_published_at: input.timestamp, publication_last_error_code: null,
        });
      },
      failPublication: async (input) => {
        terminalActors.push(actorRecord('fail', input));
        return updatePublication(publications, input.publicationId, {
          publication_status: 'failed', publication_published_at: null, publication_last_error_code: input.lastErrorCode, provider_error_category: input.diagnostic?.providerCategory ?? 'PROVIDER_REJECTED',
        });
      },
      markUnknown: async (input) => {
        terminalActors.push(actorRecord('unknown', input));
        if (markUnknownError) throw markUnknownError;
        return updatePublication(publications, input.publicationId, {
          publication_status: 'delivery_unknown', publication_published_at: null,
          publication_last_error_code: 'META_PUBLICATION_DELIVERY_UNKNOWN', provider_error_category: 'DELIVERY_UNKNOWN',
        });
      },
    },
    provider: {
      publishText: async (input) => {
        providerCalls.push({ ...input, kind: 'text_only' });
        if (providerError) throw providerError;
        return { providerPostId: '10001_20002' };
      },
      publishSinglePhoto: async (input) => {
        providerCalls.push({ ...input, kind: 'single_photo', attachmentId: ids.attachment });
        if (providerError) throw providerError;
        return { providerPostId: null, providerMediaId: '10001_photo_30003' };
      },
    },
    imageProcessor: {
      sanitize: async ({ bytes, mimeType }) => {
        const clean = Uint8Array.from(bytes).filter((byte) => byte !== 0xe1);
        return { bytes: clean, mimeType, detectedMimeType: mimeType, width: 1, height: 1, sanitizer: 'ImageScript', sanitizerVersion: '1.3.0' };
      },
    },
    config,
    cryptoApi,
    maxBodyBytes: 24_000,
    newUuid: () => newTestUuid(),
    timeoutController: () => ({ signal: new AbortController().signal, clear() {} }),
    now: () => { clock += 10; return clock; },
    telemetry: { record: (event) => telemetryEvents.push(event) },
  };
}

function jpegHeader(width, height) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff,
    0x03, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0,
    0xff, 0xda, 0x00, 0x0c,
  ]);
}

function pngHeader(width, height, extraChunk = null) {
  const chunks = [
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    (width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
    (height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
    8, 2, 0, 0, 0, 0, 0, 0, 0,
  ];
  if (extraChunk) chunks.push(0, 0, 0, 0, ...Buffer.from(extraChunk), 0, 0, 0, 0);
  chunks.push(0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0);
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunks]);
}

function actorRecord(action, input) {
  return {
    action,
    actorAuthUserId: input.actorAuthUserId,
    actorName: input.actorName,
    actorRole: input.actorRole,
  };
}

function actorRecordOnly(value) {
  return {
    action: value.action,
    actorAuthUserId: value.actorAuthUserId,
    actorName: value.actorName,
    actorRole: value.actorRole,
  };
}

function updatePublication(publications, publicationId, patch) {
  let found = null;
  for (const [key, value] of publications) {
    if (value.publication_id === publicationId) {
      const updated = { ...value, ...patch, should_publish: false };
      publications.set(key, updated);
      found = {
        status: updated.publication_status,
        approved_at: updated.publication_approved_at,
        published_at: updated.publication_published_at,
        last_error_code: updated.publication_last_error_code,
        provider_error_category: updated.provider_error_category ?? null,
      };
    }
  }
  if (found) return found;
  throw new Error('missing publication');
}

function invoke(deps, body) {
  return handleMetaPublishing({ rawBody: JSON.stringify(body), authorization: `Bearer ${jwt}`, deps });
}

function publishRequest(message, idempotencyKey) {
  return { action: 'publish_facebook_text', companyId: ids.company, jobId: ids.job, message, idempotencyKey, explicitApproval: true };
}

function singlePhotoRequest(message, idempotencyKey) {
  return { action: 'publish_facebook_single_photo', companyId: ids.company, jobId: ids.job, attachmentId: ids.attachment, message, idempotencyKey, explicitApproval: true };
}

function jpegWithExifBytes() {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0xff, 0xda, 0x00, 0x04, 0x11, 0x22, 0xff, 0xd9,
  ]);
}

function discoveryScopes() {
  return ['pages_show_list', 'pages_read_engagement', 'instagram_basic'];
}

function publishingScopes() {
  return [...discoveryScopes(), 'pages_manage_posts'];
}
