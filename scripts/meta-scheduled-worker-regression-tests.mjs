import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { connectionEnvelopeContext, encryptTokenBundle } from '../supabase/functions/_shared/meta-connection/crypto.js';
import { MetaPublishingError, runtimePublishingConfig } from '../supabase/functions/_shared/meta-publishing/contracts.js';
import { sha256Hex } from '../supabase/functions/_shared/meta-publishing/photoPreparation.js';
import {
  SCHEDULED_CLAIM_BATCH_SIZE,
  SCHEDULED_CLAIM_LEASE_SECONDS,
  ScheduledWorkerError,
  runScheduledFacebookWorker,
  scheduledRetryDelayMs,
} from '../supabase/functions/_shared/meta-publishing/scheduledWorker.js';
import {
  authorizeScheduledWorkerRequest,
  handleScheduledWorkerRequest,
} from '../supabase/functions/_shared/meta-publishing/scheduledWorkerAuth.js';

const cryptoApi = webcrypto;
const ids = {
  publication: '00000000-0000-4000-8000-000000009001',
  company: '00000000-0000-4000-8000-000000009002',
  connection: '00000000-0000-4000-8000-000000009003',
  job: '00000000-0000-4000-8000-000000009004',
  actor: '00000000-0000-4000-8000-000000009005',
  attachment: '00000000-0000-4000-8000-000000009006',
  analysisRun: '00000000-0000-4000-8000-000000009007',
  analysisResult: '00000000-0000-4000-8000-000000009008',
  approval: '00000000-0000-4000-8000-000000009009',
  claim: '00000000-0000-4000-8000-000000009010',
};
const encryptionKey = Buffer.alloc(32, 41).toString('base64');
const workerSecret = `sb_secret_${'a'.repeat(48)}`;
let checks = 0;
const check = (fn) => { fn(); checks += 1; };
const checkAsync = async (fn) => { await fn(); checks += 1; };

await authChecks();
await workerChecks();
await sourceChecks();

console.log(`Meta scheduled worker checks passed: ${checks}`);

async function authChecks() {
  const base = {
    method: 'POST',
    rawBody: '{}',
    apiKey: workerSecret,
    authorization: '',
    secretKeysJson: JSON.stringify({ 'meta-scheduled-publisher': workerSecret }),
    cryptoApi,
  };
  for (const patch of [
    { apiKey: '' },
    { apiKey: `sb_secret_${'b'.repeat(48)}` },
    { apiKey: `sb_publishable_${'c'.repeat(48)}` },
    { apiKey: 'eyJ.fake.user.jwt', authorization: 'Bearer eyJ.fake.user.jwt' },
    { apiKey: workerSecret, authorization: 'Bearer eyJ.fake.user.jwt' },
  ]) {
    await checkAsync(() => assert.rejects(authorizeScheduledWorkerRequest({ ...base, ...patch }), /AUTH_REQUIRED/));
  }
  await checkAsync(() => assert.rejects(authorizeScheduledWorkerRequest({ ...base, rawBody: '{"companyId":"x"}' }), /INVALID_REQUEST/));
  await checkAsync(() => assert.rejects(authorizeScheduledWorkerRequest({ ...base, secretKeysJson: '{}' }), /WORKER_NOT_CONFIGURED/));
  await checkAsync(async () => {
    const auth = await authorizeScheduledWorkerRequest({ ...base, rawBody: '' });
    assert.equal(auth.workerSecretKey, workerSecret);
  });

  let dependenciesCreated = 0;
  let handlerReached = 0;
  await checkAsync(() => assert.rejects(handleScheduledWorkerRequest({
    ...base,
    apiKey: 'sb_publishable_public',
    createDependencies: () => { dependenciesCreated += 1; return {}; },
    run: async () => { handlerReached += 1; },
  }), /AUTH_REQUIRED/));
  check(() => assert.deepEqual({ dependenciesCreated, handlerReached }, { dependenciesCreated: 0, handlerReached: 0 }));
  const handled = await handleScheduledWorkerRequest({
    ...base,
    createDependencies: (key) => { dependenciesCreated += 1; return { keyAccepted: key === workerSecret }; },
    run: async (deps) => { handlerReached += 1; return { claimed: deps.keyAccepted ? 0 : 99 }; },
  });
  check(() => assert.deepEqual(handled, { claimed: 0 }));
  check(() => assert.deepEqual({ dependenciesCreated, handlerReached }, { dependenciesCreated: 1, handlerReached: 1 }));
  check(() => assert.equal(JSON.stringify(handled).includes(workerSecret), false));
}

async function workerChecks() {
  check(() => assert.deepEqual(
    [scheduledRetryDelayMs(1), scheduledRetryDelayMs(2), scheduledRetryDelayMs(3), scheduledRetryDelayMs(100)],
    [60_000, 120_000, 300_000, 300_000],
  ));

  const empty = await makeDependencies({ claims: [] });
  const emptyResult = await runScheduledFacebookWorker(empty);
  check(() => assert.deepEqual(emptyResult, counts({})));
  check(() => assert.deepEqual(empty.sequence, ['reconcile:20', `claim:${SCHEDULED_CLAIM_LEASE_SECONDS}:${SCHEDULED_CLAIM_BATCH_SIZE}`]));
  check(() => assert.equal(empty.providerCalls.length, 0));

  const text = await makeDependencies();
  const textResult = await runScheduledFacebookWorker(text);
  check(() => assert.deepEqual(textResult, counts({ claimed: 1, published: 1 })));
  check(() => assert.deepEqual(text.sequence.slice(0, 7), [
    'reconcile:20', 'claim:300:3', 'publication', 'connection:exact', 'privacy', 'start', 'provider:text_only',
  ]));
  check(() => assert.equal(text.providerCalls.length, 1));
  check(() => assert.equal(text.completeInputs.length, 1));
  check(() => assert.deepEqual(actorOf(text.completeInputs[0]), { actorAuthUserId: ids.actor, actorName: 'Frozen scheduler', actorRole: 'owner' }));
  check(() => assert.equal(text.beginCalls, 0));

  const photo = await makeDependencies({ publicationKind: 'single_photo' });
  const photoResult = await runScheduledFacebookWorker(photo);
  check(() => assert.deepEqual(photoResult, counts({ claimed: 1, published: 1 })));
  check(() => assert.equal(photo.downloadCalls, 1));
  check(() => assert.equal(photo.sanitizeCalls, 1));
  check(() => assert.equal(photo.providerCalls.length, 1));
  check(() => assert.deepEqual(photo.providerCalls[0].photoBytes, photo.sanitizedBytes));
  check(() => assert.equal(photo.completeInputs[0].publicationAuditMetadata.attachmentId, ids.attachment));
  check(() => assert.equal(photo.completeInputs[0].publicationAuditMetadata.analysisRunId, ids.analysisRun));
  check(() => assert.equal(photo.completeInputs[0].publicationAuditMetadata.approvalId, ids.approval));
  check(() => assert.equal(photo.completeInputs[0].publicationAuditMetadata.providerCallCount, 1));
  check(() => assert.match(photo.completeInputs[0].publicationAuditMetadata.originalHashPrefix, /^[0-9a-f]{16}$/));
  check(() => assert.equal(photo.sequence.indexOf('download') < photo.sequence.indexOf('start'), true));
  check(() => assert.equal(photo.sequence.indexOf('sanitize') < photo.sequence.indexOf('start'), true));
  check(() => assert.equal(photo.sequence.indexOf('start') < photo.sequence.indexOf('provider:single_photo'), true));

  for (const options of [
    { pageChanged: true },
    { permissionRemoved: true },
    { tokenInvalid: true },
    { messageShaMismatch: true },
    { privacyViolation: true },
    { publicationKind: 'single_photo', photoShaMismatch: true },
    { publicationKind: 'single_photo', attachmentPatch: { kind: 'document' } },
    { publicationKind: 'single_photo', attachmentPatch: { mime_type: 'image/png' } },
  ]) {
    const deps = await makeDependencies(options);
    const result = await runScheduledFacebookWorker(deps);
    check(() => assert.deepEqual(result, counts({ claimed: 1, preflightFailed: 1 })));
    check(() => assert.equal(deps.providerCalls.length, 0));
    check(() => assert.equal(deps.failPreflightInputs.length, 1));
  }

  for (const startCode of [
    'SCHEDULED_JOB_INVALID', 'SCHEDULED_CONNECTION_INVALID', 'SCHEDULED_ATTACHMENT_INVALID',
    'SCHEDULED_MEDIA_EVIDENCE_INVALID', 'SCHEDULED_APPROVAL_INVALID', 'SCHEDULED_PRIVACY_REVALIDATION_FAILED',
  ]) {
    const deps = await makeDependencies({ startError: new ScheduledWorkerError(startCode, 'permanent') });
    const result = await runScheduledFacebookWorker(deps);
    check(() => assert.deepEqual(result, counts({ claimed: 1, preflightFailed: 1 })));
    check(() => assert.equal(deps.providerCalls.length, 0));
  }

  const cancelled = await makeDependencies({ startError: new ScheduledWorkerError('SCHEDULED_CLAIM_LOST', 'claim_lost'), stateAfterLoss: 'cancelled' });
  await checkAsync(async () => assert.deepEqual(await runScheduledFacebookWorker(cancelled), counts({ claimed: 1, cancelled: 1 })));
  check(() => assert.equal(cancelled.providerCalls.length, 0));
  const leaseLost = await makeDependencies({ startError: new ScheduledWorkerError('SCHEDULED_CLAIM_LOST', 'claim_lost'), stateAfterLoss: 'scheduled' });
  await checkAsync(async () => assert.deepEqual(await runScheduledFacebookWorker(leaseLost), counts({ claimed: 1, released: 1 })));
  check(() => assert.equal(leaseLost.providerCalls.length, 0));

  const storage = await makeDependencies({ publicationKind: 'single_photo', storageError: true, executionAttempts: 1 });
  await checkAsync(async () => assert.deepEqual(await runScheduledFacebookWorker(storage), counts({ claimed: 1, released: 1 })));
  check(() => assert.equal(storage.providerCalls.length, 0));
  check(() => assert.equal(Date.parse(storage.releaseInputs[0].nextAttemptAt) - storage.clock, 60_000));
  const dbTransient = await makeDependencies({ privacyContextError: true, executionAttempts: 2 });
  await checkAsync(async () => assert.deepEqual(await runScheduledFacebookWorker(dbTransient), counts({ claimed: 1, released: 1 })));
  check(() => assert.equal(Date.parse(dbTransient.releaseInputs[0].nextAttemptAt) - dbTransient.clock, 120_000));
  const bounded = await makeDependencies({ privacyContextError: true, executionAttempts: 9 });
  await runScheduledFacebookWorker(bounded);
  check(() => assert.equal(Date.parse(bounded.releaseInputs[0].nextAttemptAt) - bounded.clock, 300_000));
  const preflightPersistence = await makeDependencies({ pageChanged: true, failPreflightError: true });
  await checkAsync(async () => assert.deepEqual(await runScheduledFacebookWorker(preflightPersistence), counts({ claimed: 1, released: 1 })));
  check(() => assert.equal(preflightPersistence.providerCalls.length, 0));
  check(() => assert.equal(preflightPersistence.releaseInputs.length, 1));

  const rejection = await makeDependencies({ providerError: new MetaPublishingError('META_PUBLICATION_PROVIDER_REJECTED', undefined, { providerCategory: 'PROVIDER_REJECTED' }) });
  await checkAsync(async () => assert.deepEqual(await runScheduledFacebookWorker(rejection), counts({ claimed: 1, providerFailed: 1 })));
  check(() => assert.equal(rejection.providerCalls.length, 1));
  check(() => assert.equal(rejection.failInputs.length, 1));

  const ambiguous = await makeDependencies({ providerError: new MetaPublishingError('META_PUBLICATION_DELIVERY_UNKNOWN') });
  await checkAsync(async () => assert.deepEqual(await runScheduledFacebookWorker(ambiguous), counts({ claimed: 1, deliveryUnknown: 1 })));
  check(() => assert.equal(ambiguous.providerCalls.length, 1));
  check(() => assert.equal(ambiguous.unknownInputs.length, 1));

  const completeFailure = await makeDependencies({ completeError: true });
  await checkAsync(async () => assert.deepEqual(await runScheduledFacebookWorker(completeFailure), counts({ claimed: 1, deliveryUnknown: 1 })));
  check(() => assert.equal(completeFailure.providerCalls.length, 1));
  check(() => assert.equal(completeFailure.unknownInputs.length, 1));

  const reconciled = await makeDependencies({ claims: [], reconciledUnknown: 2 });
  await checkAsync(async () => assert.deepEqual(await runScheduledFacebookWorker(reconciled), counts({ reconciledUnknown: 2 })));
  check(() => assert.equal(reconciled.providerCalls.length, 0));

  const overlap = await makeDependencies();
  let claimCount = 0;
  const originalClaim = overlap.repository.claimDue;
  overlap.repository.claimDue = async (...args) => (++claimCount === 1 ? originalClaim(...args) : []);
  const overlapping = await Promise.all([runScheduledFacebookWorker(overlap), runScheduledFacebookWorker(overlap)]);
  check(() => assert.equal(overlapping.reduce((sum, result) => sum + result.published, 0), 1));
  check(() => assert.equal(overlap.providerCalls.length, 1));

  const invalidConfig = await makeDependencies({ claims: [] });
  invalidConfig.config.configured = false;
  await checkAsync(() => assert.rejects(runScheduledFacebookWorker(invalidConfig), /META_PUBLISH_NOT_CONFIGURED/));
  check(() => assert.deepEqual(invalidConfig.sequence, []));

  for (const result of [emptyResult, textResult, photoResult]) {
    check(() => assert.deepEqual(Object.keys(result).sort(), Object.keys(counts({})).sort()));
    check(() => assert.equal(JSON.stringify(result).match(/[0-9a-f]{8}-[0-9a-f-]{27}/i), null));
  }
}

async function sourceChecks() {
  const [edge, worker, repository, auth, immediateService, contracts, config, migration, schema] = await Promise.all([
    readFile(new URL('../supabase/functions/meta-social-publish-scheduled-worker/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/_shared/meta-publishing/scheduledWorker.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/_shared/meta-publishing/scheduledRepository.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/_shared/meta-publishing/scheduledWorkerAuth.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/_shared/meta-publishing/service.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/_shared/meta-publishing/contracts.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260807010000_meta_facebook_scheduled_worker_reconciliation.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'),
  ]);
  check(() => assert.match(config, /\[functions\.meta-social-publish-scheduled-worker\]\s+verify_jwt = false/));
  check(() => assert.doesNotMatch(edge, /cors|Access-Control-Allow-Origin/i));
  check(() => assert.match(edge, /request\.headers\.get\('apikey'\)/));
  check(() => assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/));
  check(() => assert.match(edge, /createClient\(supabaseUrl, serviceRoleKey/));
  check(() => assert.doesNotMatch(edge, /createClient\(supabaseUrl, workerSecretKey/));
  check(() => assert.match(edge, /SUPABASE_SECRET_KEYS/));
  check(() => assert.match(auth, /meta-scheduled-publisher|sb_secret_/));
  check(() => assert.doesNotMatch(`${edge}\n${worker}\n${repository}`, /handleMetaPublishing|begin_company_facebook_publication|beginPublication/));
  check(() => assert.match(repository, /\.eq\('id', input\.connectionId\)/));
  check(() => assert.doesNotMatch(repository, /order\('updated_at'.*connection/s));
  check(() => assert.match(worker, /claimDue\(SCHEDULED_CLAIM_LEASE_SECONDS, SCHEDULED_CLAIM_BATCH_SIZE\)/));
  check(() => assert.match(worker, /startScheduled[\s\S]*publishSinglePhoto|startScheduled[\s\S]*publishText/));
  check(() => assert.doesNotMatch(contracts, /scheduledAt/));
  check(() => assert.match(immediateService, /prepareFacebookPublicationPhoto/));
  check(() => assert.match(migration, /FOR UPDATE SKIP LOCKED/i));
  check(() => assert.match(migration, /clock_timestamp\(\)/));
  check(() => assert.doesNotMatch(migration, /\bp_now\b|\bp_timestamp\b/));
  check(() => assert.match(migration, /scheduled_for is not null/));
  check(() => assert.match(migration, /status = 'publishing'/));
  check(() => assert.match(migration, /updated_at < database_now - interval '10 minutes'/));
  check(() => assert.match(migration, /attempts = 1/));
  check(() => assert.match(migration, /schedulerRecovery', true/));
  check(() => assert.doesNotMatch(migration, /facebook_page_id|providerPostId|providerMediaId|token_envelope|storage_path|'message'/i));
  const block = migration.trim();
  check(() => assert.equal(schema.includes(block), true));
}

async function makeDependencies(options = {}) {
  const clock = Date.parse('2026-08-07T12:00:00.000Z');
  const originalBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 4]);
  const sanitizedBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 9, 8, 7]);
  const publicationKind = options.publicationKind ?? 'text_only';
  const message = options.privacyViolation ? 'Contact private@example.test.' : 'Scheduled service update.';
  const correctMessageSha = await sha256Hex(message, cryptoApi);
  const correctPhotoSha = await sha256Hex(originalBytes, cryptoApi);
  const connection = {
    id: ids.connection,
    company_id: ids.company,
    provider: 'meta-facebook-login',
    status: 'connected',
    facebook_page_id: options.pageChanged ? '10002' : '10001',
    granted_scopes: options.permissionRemoved ? ['pages_show_list'] : ['pages_manage_posts'],
  };
  connection.token_envelope = options.tokenInvalid ? { invalid: true } : await encryptTokenBundle(
    { pageAccessToken: 'fake-page-token-sensitive' },
    encryptionKey,
    connectionEnvelopeContext({ companyId: ids.company, connectionId: ids.connection, pageId: '10001' }),
    cryptoApi,
  );
  const publication = {
    id: ids.publication,
    company_id: ids.company,
    connection_id: ids.connection,
    job_id: ids.job,
    status: 'scheduled',
    approved_message: message,
    message_sha256: options.messageShaMismatch ? `\\x${'0'.repeat(64)}` : correctMessageSha,
    publication_kind: publicationKind,
    attachment_id: publicationKind === 'single_photo' ? ids.attachment : null,
    safe_mime_type: publicationKind === 'single_photo' ? 'image/jpeg' : null,
    approved_by: ids.actor,
    scheduled_attachment_sha256: publicationKind === 'single_photo'
      ? (options.photoShaMismatch ? `\\x${'1'.repeat(64)}` : correctPhotoSha)
      : null,
    scheduled_analysis_run_id: publicationKind === 'single_photo' ? ids.analysisRun : null,
    scheduled_attachment_result_id: publicationKind === 'single_photo' ? ids.analysisResult : null,
    scheduled_approval_id: publicationKind === 'single_photo' ? ids.approval : null,
    scheduled_facebook_page_id: '10001',
    scheduled_by_name: 'Frozen scheduler',
    scheduled_by_role: 'owner',
    claim_token: ids.claim,
  };
  const claim = {
    publication_id: ids.publication,
    company_id: ids.company,
    connection_id: ids.connection,
    job_id: ids.job,
    publication_kind: publicationKind,
    attachment_id: publication.attachment_id,
    claim_token: ids.claim,
    execution_attempts: options.executionAttempts ?? 1,
  };
  const sequence = [];
  const providerCalls = [];
  const completeInputs = [];
  const failInputs = [];
  const unknownInputs = [];
  const failPreflightInputs = [];
  const releaseInputs = [];
  let downloadCalls = 0;
  let sanitizeCalls = 0;
  let beginCalls = 0;
  const claims = options.claims === undefined ? [claim] : options.claims;
  const deps = {
    clock,
    sequence,
    providerCalls,
    completeInputs,
    failInputs,
    unknownInputs,
    failPreflightInputs,
    releaseInputs,
    sanitizedBytes,
    get downloadCalls() { return downloadCalls; },
    get sanitizeCalls() { return sanitizeCalls; },
    get beginCalls() { return beginCalls; },
    config: runtimePublishingConfig((key) => ({
      META_GRAPH_API_VERSION: 'v25.0',
      META_APP_SECRET: 'fake-app-secret',
      META_TOKEN_ENCRYPTION_KEY_V1: encryptionKey,
      META_REQUEST_TIMEOUT_MS: '8000',
    })[key] ?? ''),
    cryptoApi,
    now: () => clock,
    timeoutController: () => ({ signal: new AbortController().signal, clear() {} }),
    imageProcessor: {
      sanitize: async () => {
        sanitizeCalls += 1;
        sequence.push('sanitize');
        return {
          bytes: sanitizedBytes,
          mimeType: 'image/jpeg',
          detectedMimeType: 'image/jpeg',
          width: 2,
          height: 2,
          sanitizer: 'ImageScript',
          sanitizerVersion: '1.3.0',
        };
      },
    },
    provider: {
      publishText: async (input) => providerCall('text_only', input),
      publishSinglePhoto: async (input) => providerCall('single_photo', input),
    },
    repository: {
      reconcileStale: async (limit) => { sequence.push(`reconcile:${limit}`); return options.reconciledUnknown ?? 0; },
      claimDue: async (lease, limit) => { sequence.push(`claim:${lease}:${limit}`); return claims; },
      getClaimedPublication: async () => { sequence.push('publication'); return publication; },
      getPublicationState: async () => options.stateAfterLoss ?? 'scheduled',
      getExactConnection: async ({ connectionId }) => { sequence.push('connection:exact'); assert.equal(connectionId, ids.connection); return connection; },
      getPrivacyContext: async () => {
        sequence.push('privacy');
        if (options.privacyContextError) throw new ScheduledWorkerError('SCHEDULED_INFRASTRUCTURE_ERROR', 'transient');
        return {
          job: { id: ids.job, company_id: ids.company, status: 'Completed', job_number: 'JOB-PRIVATE', notes: '' },
          customer: { primary_email: 'private@example.test' },
          location: null,
          invoices: [],
          comments: [],
        };
      },
      getExactAttachment: async () => ({
        id: ids.attachment,
        company_id: ids.company,
        job_id: ids.job,
        name: 'scheduled-photo.jpg',
        mime_type: 'image/jpeg',
        size_bytes: originalBytes.byteLength,
        kind: 'photo',
        storage_bucket: 'job-files',
        storage_path: 'private/scheduled-photo.jpg',
        ...(options.attachmentPatch ?? {}),
      }),
      getExactApproval: async () => ({ id: ids.approval, approved_at: '2026-08-07T10:00:00.000Z' }),
      downloadAttachmentBytes: async () => {
        downloadCalls += 1;
        sequence.push('download');
        if (options.storageError) throw new ScheduledWorkerError('SCHEDULED_INFRASTRUCTURE_ERROR', 'transient');
        return originalBytes;
      },
      startScheduled: async () => {
        sequence.push('start');
        if (options.startError) throw options.startError;
        publication.status = 'publishing';
        return publication;
      },
      failPreflight: async (input) => {
        failPreflightInputs.push(input);
        if (options.failPreflightError) throw new ScheduledWorkerError('SCHEDULED_INFRASTRUCTURE_ERROR', 'transient');
        return { status: 'failed' };
      },
      releaseClaim: async (input) => { releaseInputs.push(input); return { status: 'scheduled' }; },
      completePublication: async (input) => {
        completeInputs.push(input);
        if (options.completeError) throw new ScheduledWorkerError('SCHEDULED_INFRASTRUCTURE_ERROR');
        return { status: 'published' };
      },
      failPublication: async (input) => { failInputs.push(input); return { status: 'failed' }; },
      markUnknown: async (input) => { unknownInputs.push(input); return { status: 'delivery_unknown' }; },
      beginPublication: async () => { beginCalls += 1; },
    },
  };
  return deps;

  async function providerCall(kind, input) {
    providerCalls.push({ kind, ...input });
    sequence.push(`provider:${kind}`);
    if (options.providerError) throw options.providerError;
    return kind === 'single_photo' ? { providerMediaId: 'safe-provider-media-id' } : { providerPostId: 'safe-provider-post-id' };
  }
}

function counts(patch) {
  return {
    claimed: 0,
    published: 0,
    preflightFailed: 0,
    providerFailed: 0,
    deliveryUnknown: 0,
    released: 0,
    cancelled: 0,
    reconciledUnknown: 0,
    ...patch,
  };
}

function actorOf(input) {
  return {
    actorAuthUserId: input.actorAuthUserId,
    actorName: input.actorName,
    actorRole: input.actorRole,
  };
}
