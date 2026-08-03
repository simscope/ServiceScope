import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildPrivateValues } from '../supabase/functions/_shared/content-engine/context.js';
import { assertMetaAccessRole } from '../supabase/functions/_shared/meta-connection/contracts.js';
import { connectionEnvelopeContext, encryptTokenBundle } from '../supabase/functions/_shared/meta-connection/crypto.js';
import {
  MetaPublishingError,
  facebookPublishingEnabled,
  parsePublishingRequest,
  runtimePublishingConfig,
  safePublishingTelemetry,
} from '../supabase/functions/_shared/meta-publishing/contracts.js';
import { assertPublicationPrivacy } from '../supabase/functions/_shared/meta-publishing/privacy.js';
import { createFacebookPublishingProvider } from '../supabase/functions/_shared/meta-publishing/provider.js';
import { handleMetaPublishing } from '../supabase/functions/_shared/meta-publishing/service.js';
import {
  beginFacebookPublishSubmission,
  invalidateFacebookPublishApproval,
  openFacebookPublishConfirmation,
} from '../.tmp/meta-publishing-tests/workspaceState.js';

const cryptoApi = globalThis.crypto ?? webcrypto;
const ids = {
  company: '00000000-0000-4000-8000-000000008001',
  otherCompany: '00000000-0000-4000-8000-000000008002',
  actor: '00000000-0000-4000-8000-000000008003',
  job: '00000000-0000-4000-8000-000000008004',
  connection: '00000000-0000-4000-8000-000000008005',
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
privacyChecks();
workspaceChecks();
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
  for (const invalid of [
    { action: 'publish_facebook_text', companyId: ids.company, jobId: ids.job, message: 'Ready', idempotencyKey: crypto.randomUUID() },
    { action: 'publish_facebook_text', companyId: ids.company, jobId: ids.job, message: 'Ready', idempotencyKey: crypto.randomUUID(), explicitApproval: false },
    { action: 'publish_facebook_text', companyId: ids.company, jobId: ids.job, message: 'Ready', idempotencyKey: crypto.randomUUID(), explicitApproval: true, pageId: '123' },
    { action: 'publish_facebook_text', companyId: ids.company, jobId: ids.job, message: 'Ready', idempotencyKey: crypto.randomUUID(), explicitApproval: true, scheduledAt: new Date().toISOString() },
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
  const opened = openFacebookPublishConfirmation('Exact final text', '00000000-0000-4000-8000-000000008010');
  check(() => assert.equal(opened.confirmationOpen, true));
  check(() => assert.equal(opened.approved, false));
  check(() => assert.equal(beginFacebookPublishSubmission(opened).shouldSubmit, false));
  const approved = { ...opened, approved: true };
  const begun = beginFacebookPublishSubmission(approved);
  check(() => assert.equal(begun.shouldSubmit, true));
  check(() => assert.equal(beginFacebookPublishSubmission(begun.state).shouldSubmit, false));
  check(() => assert.equal(invalidateFacebookPublishApproval(approved, 'Edited final text').confirmationOpen, false));
  check(() => assert.equal(invalidateFacebookPublishApproval(approved, 'Exact final text').confirmationOpen, true));
  const settled = { ...approved, confirmationOpen: false, result: { status: 'published' } };
  check(() => assert.equal(invalidateFacebookPublishApproval(settled, 'Exact final text').result?.status, 'published'));
  check(() => assert.equal(invalidateFacebookPublishApproval(settled, 'Edited final text').result, null));
}

async function providerChecks() {
  const sensitiveToken = 'fake-page-access-token-sensitive';
  const calls = [];
  const provider = createFacebookPublishingProvider({
    config,
    cryptoApi,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ id: '10001_20002' }), { status: 200 });
    },
  });
  const result = await provider.publishText({ pageId: '10001', pageAccessToken: sensitiveToken, message: 'Approved text', signal: new AbortController().signal });
  check(() => assert.equal(result.providerPostId, '10001_20002'));
  check(() => assert.equal(calls.length, 1));
  check(() => assert.equal(calls[0].url, 'https://graph.facebook.com/v25.0/10001/feed'));
  check(() => assert.equal(calls[0].options.method, 'POST'));
  check(() => assert.equal(calls[0].options.headers.Authorization, `Bearer ${sensitiveToken}`));
  check(() => assert.ok(!calls[0].url.includes(sensitiveToken)));
  check(() => assert.ok(!String(calls[0].options.body).includes(sensitiveToken)));
  check(() => assert.match(String(calls[0].options.body), /message=Approved\+text/));

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
}

async function serviceChecks() {
  const base = await makeDependencies();
  const threeScope = await invoke(base, { action: 'status', companyId: ids.company });
  check(() => assert.equal(threeScope.connected, true));
  check(() => assert.equal(threeScope.facebookPublishingEnabled, false));
  check(() => assert.deepEqual(threeScope.missingPermissions, ['pages_manage_posts']));

  base.context.connection.granted_scopes = publishingScopes();
  const ready = await invoke(base, { action: 'status', companyId: ids.company });
  check(() => assert.equal(ready.facebookPublishingEnabled, true));
  check(() => assert.deepEqual(ready.missingPermissions, []));

  const idempotencyKey = '00000000-0000-4000-8000-000000008020';
  const request = publishRequest('Replaced the contactor and verified normal operation.', idempotencyKey);
  const published = await invoke(base, request);
  check(() => assert.equal(published.status, 'published'));
  check(() => assert.equal(base.providerCalls.length, 1));
  check(() => assert.ok(!('providerPostId' in published)));
  check(() => assert.ok(!JSON.stringify(published).includes('10001_20002')));
  await invoke(base, request);
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
  await checkAsync(() => assert.rejects(invoke(base, publishRequest('Contact private@example.test for access.', crypto.randomUUID())), /META_PUBLICATION_PRIVACY_REVIEW_REQUIRED/));
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
  await checkAsync(() => assert.rejects(
    invoke(unknownPersistenceFailure, publishRequest('Verified safe operation.', crypto.randomUUID())),
    /META_PUBLICATION_DELIVERY_UNKNOWN/,
  ));

  const failure = await makeDependencies({ providerError: new MetaPublishingError('META_PUBLICATION_PROVIDER_REJECTED', undefined, { providerHttpStatus: 403, providerCode: 200, providerCategory: 'MISSING_PERMISSION', providerIsTransient: false }) });
  failure.context.connection.granted_scopes = publishingScopes();
  const failureKey = '00000000-0000-4000-8000-000000008040';
  await checkAsync(() => assert.rejects(invoke(failure, publishRequest('Verified normal operation.', failureKey)), /META_PUBLICATION_PROVIDER_REJECTED/));
  check(() => assert.equal(failure.publications.get(failureKey).publication_status, 'failed'));
  await checkAsync(() => assert.rejects(invoke(failure, publishRequest('Verified normal operation.', failureKey)), /META_PUBLICATION_PROVIDER_REJECTED/));
  check(() => assert.equal(failure.providerCalls.length, 1));

  const brokenEnvelope = await makeDependencies();
  brokenEnvelope.context.connection.granted_scopes = publishingScopes();
  brokenEnvelope.context.connection.token_envelope = { invalid: true };
  await checkAsync(() => assert.rejects(invoke(brokenEnvelope, publishRequest('Verified operation.', crypto.randomUUID())), /META_CONNECTION_NEEDS_REAUTHORIZATION/));
  check(() => assert.equal(brokenEnvelope.providerCalls.length, 0));

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
  check(() => assert.doesNotMatch(client, /graph\.facebook\.com|access_token|pageId|connectionId/));
  check(() => assert.match(provider, /Authorization: `Bearer \$\{pageAccessToken\}`/));
  check(() => assert.doesNotMatch(provider, /access_token/));
  check(() => assert.doesNotMatch(provider, /for\s*\(|while\s*\(/));
  check(() => assert.match(panel, /I reviewed the exact final text and approve publishing it to the Facebook Page now\./));
  check(() => assert.match(panel, /selected photos and videos will not be uploaded/i));
  check(() => assert.doesNotMatch(`${client}\n${panel}`, /providerPostId|facebookPageId|token_envelope|service_role/));
}

async function makeDependencies({ providerError = null, markUnknownError = null } = {}) {
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
  const publications = new Map();
  const providerCalls = [];
  const telemetryEvents = [];
  let clock = Date.parse('2026-08-03T12:00:00.000Z');
  return {
    context,
    publications,
    providerCalls,
    telemetryEvents,
    auth: {
      resolveSession: async () => ({ kind: 'company', role: 'admin', company_id: ids.company }),
      assertCompanyAccess: async () => ({ actorAuthUserId: ids.actor, actorName: 'Publisher', actorRole: 'admin' }),
    },
    repository: {
      getStatus: async () => ({ connection, lastPublication: null }),
      getPublicationContext: async () => context,
      beginPublication: async (input) => {
        const existing = publications.get(input.idempotencyKey);
        if (existing) return { ...existing, should_publish: false };
        const row = {
          publication_id: input.publicationId,
          publication_status: 'publishing',
          publication_approved_at: input.timestamp,
          publication_published_at: null,
          publication_last_error_code: null,
          should_publish: true,
        };
        publications.set(input.idempotencyKey, row);
        return row;
      },
      completePublication: async (input) => updatePublication(publications, input.publicationId, {
        publication_status: 'published', publication_published_at: input.timestamp, publication_last_error_code: null,
      }),
      failPublication: async (input) => updatePublication(publications, input.publicationId, {
        publication_status: 'failed', publication_published_at: null, publication_last_error_code: input.lastErrorCode,
      }),
      markUnknown: async (input) => {
        if (markUnknownError) throw markUnknownError;
        return updatePublication(publications, input.publicationId, {
          publication_status: 'delivery_unknown', publication_published_at: null,
          publication_last_error_code: 'META_PUBLICATION_DELIVERY_UNKNOWN', provider_error_category: 'DELIVERY_UNKNOWN',
        });
      },
    },
    provider: {
      publishText: async (input) => {
        providerCalls.push(input);
        if (providerError) throw providerError;
        return { providerPostId: '10001_20002' };
      },
    },
    config,
    cryptoApi,
    maxBodyBytes: 24_000,
    newUuid: () => crypto.randomUUID(),
    timeoutController: () => ({ signal: new AbortController().signal, clear() {} }),
    now: () => { clock += 10; return clock; },
    telemetry: { record: (event) => telemetryEvents.push(event) },
  };
}

function updatePublication(publications, publicationId, patch) {
  for (const [key, value] of publications) {
    if (value.publication_id === publicationId) {
      const updated = { ...value, ...patch, should_publish: false };
      publications.set(key, updated);
      return {
        status: updated.publication_status,
        approved_at: updated.publication_approved_at,
        published_at: updated.publication_published_at,
        last_error_code: updated.publication_last_error_code,
        provider_error_category: updated.provider_error_category ?? null,
      };
    }
  }
  throw new Error('missing publication');
}

function invoke(deps, body) {
  return handleMetaPublishing({ rawBody: JSON.stringify(body), authorization: `Bearer ${jwt}`, deps });
}

function publishRequest(message, idempotencyKey) {
  return { action: 'publish_facebook_text', companyId: ids.company, jobId: ids.job, message, idempotencyKey, explicitApproval: true };
}

function discoveryScopes() {
  return ['pages_show_list', 'pages_read_engagement', 'instagram_basic'];
}

function publishingScopes() {
  return [...discoveryScopes(), 'pages_manage_posts'];
}
