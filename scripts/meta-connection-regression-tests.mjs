import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import {
  META_FOUNDATION_MARKERS,
  META_LIFECYCLE_MARKERS,
  META_OAUTH_STATE_TTL_MARKERS,
  assertNoCanonicalPatchArtifacts,
  extractExactMarkedBlock,
  extractMetaCanonicalBlocks,
  normalizeSqlForParity,
} from './meta-canonical-schema.mjs';
import {
  META_PROVIDER,
  META_PROVIDER_ERROR_CATEGORIES,
  META_OAUTH_STATE_TTL_MS,
  META_REQUESTED_SCOPES,
  META_TOKEN_EXCHANGE_PHASES,
  MetaConnectionError,
  assertMetaAccessRole,
  normalizeReturnPath,
  requireActiveDomainSession,
  requireBearerJwt,
  requireVerifiedAuthUserId,
  runtimeConfigFromEnv,
  safeTelemetry,
  sanitizeMetaProviderDiagnostic,
} from '../supabase/functions/_shared/meta-connection/contracts.js';
import {
  assertEnvelope,
  connectionEnvelopeContext,
  decryptTokenBundle,
  encryptTokenBundle,
  generateOAuthState,
  hashOAuthState,
  pendingEnvelopeContext,
} from '../supabase/functions/_shared/meta-connection/crypto.js';
import { createMetaProvider, normalizeMetaProviderDiagnostic } from '../supabase/functions/_shared/meta-connection/provider.js';
import { createMetaRateLimiter } from '../supabase/functions/_shared/meta-connection/rateLimit.js';
import { handleMetaConnection } from '../supabase/functions/_shared/meta-connection/service.js';

const cryptoApi = globalThis.crypto ?? webcrypto;
const companyId = '00000000-0000-4000-8000-000000005501';
const otherCompanyId = '00000000-0000-4000-8000-000000005504';
const platformDomainUserId = '00000000-0000-4000-8000-000000005502';
const companyDomainUserId = '00000000-0000-4000-8000-000000005503';
const companyFallbackDomainId = '00000000-0000-4000-8000-000000005505';
const verifiedAuthUserId = '00000000-0000-4000-8000-000000005506';
const otherAuthUserId = '00000000-0000-4000-8000-000000005507';
const syntheticJwt = 'synthetic-header.synthetic-payload.synthetic-signature';
const encryptionKey = Buffer.alloc(32, 17).toString('base64');
const configValues = {
  META_APP_ID: '1234567890',
  META_APP_SECRET: 'server-only-app-secret',
  META_GRAPH_API_VERSION: 'v25.0',
  META_LOGIN_CONFIGURATION_ID: '9876543210',
  META_OAUTH_REDIRECT_URI: 'https://preview.example.test/auth/meta/callback',
  META_REQUEST_TIMEOUT_MS: '8000',
  META_TOKEN_ENCRYPTION_KEY_V1: encryptionKey,
};
const config = runtimeConfigFromEnv((key) => configValues[key]);
let checks = 0;
const check = (fn) => { fn(); checks += 1; };
const checkAsync = async (fn) => { await fn(); checks += 1; };

configurationChecks();
diagnosticContractChecks();
identityBoundaryChecks();
await encryptionChecks();
await providerChecks();
await serviceChecks();
await sourceAndSchemaChecks();

console.log(`Meta connection regression checks passed: ${checks}`);

function configurationChecks() {
  check(() => assert.equal(config.configured, true));
  check(() => assert.equal(config.graphApiVersion, 'v25.0'));
  check(() => assert.equal(config.loginConfigurationId, '9876543210'));
  check(() => assert.equal(META_PROVIDER, 'meta-facebook-login'));
  check(() => assert.equal(META_OAUTH_STATE_TTL_MS, 1_800_000));
  check(() => assert.deepEqual(META_REQUESTED_SCOPES, ['pages_show_list', 'pages_read_engagement', 'instagram_basic']));
  check(() => assert.equal(normalizeReturnPath('/settings/social-connections'), '/settings/social-connections'));
  check(() => assert.throws(() => normalizeReturnPath('https://attacker.example/return'), /INVALID_REQUEST/));
  check(() => assert.throws(() => normalizeReturnPath('//attacker.example'), /INVALID_REQUEST/));

  const invalid = (patch) => runtimeConfigFromEnv((key) => ({ ...configValues, ...patch })[key]);
  check(() => assert.equal(invalid({ META_GRAPH_API_VERSION: 'latest' }).configured, false));
  check(() => assert.equal(invalid({ META_LOGIN_CONFIGURATION_ID: '' }).configured, false));
  check(() => assert.equal(invalid({ META_LOGIN_CONFIGURATION_ID: 'config-value' }).configured, false));
  check(() => assert.equal(invalid({ META_APP_SECRET: '' }).configured, false));
  check(() => assert.equal(invalid({ META_TOKEN_ENCRYPTION_KEY_V1: '' }).configured, false));
  check(() => assert.equal(invalid({ META_TOKEN_ENCRYPTION_KEY_V1: 'not-base64***' }).configured, false));
  check(() => assert.equal(invalid({ META_TOKEN_ENCRYPTION_KEY_V1: Buffer.alloc(16).toString('base64') }).configured, false));
  check(() => assert.equal(invalid({ META_TOKEN_ENCRYPTION_KEY_V1: Buffer.alloc(31).toString('base64') }).configured, false));
  check(() => assert.equal(invalid({ META_TOKEN_ENCRYPTION_KEY_V1: Buffer.alloc(33).toString('base64') }).configured, false));
  check(() => assert.equal(invalid({ META_TOKEN_ENCRYPTION_KEY_V1: Buffer.alloc(32).toString('base64url') }).configured, true));
  check(() => assert.equal(invalid({ META_OAUTH_REDIRECT_URI: 'https://preview.example.test/auth/meta/callback?next=https://attacker.test' }).configured, false));
}

function diagnosticContractChecks() {
  check(() => assert.deepEqual(META_TOKEN_EXCHANGE_PHASES, ['short_token_exchange', 'long_token_exchange']));
  check(() => assert.deepEqual(META_PROVIDER_ERROR_CATEGORIES, [
    'INVALID_CLIENT_CREDENTIALS',
    'REDIRECT_URI_MISMATCH',
    'INVALID_OR_EXPIRED_CODE',
    'CODE_ALREADY_USED',
    'UNSUPPORTED_GRANT_OR_PARAMETER',
    'APP_CONFIGURATION_ERROR',
    'PROVIDER_RATE_LIMIT',
    'PROVIDER_TEMPORARY_ERROR',
    'SUCCESS_RESPONSE_MISSING_TOKEN',
    'UNKNOWN_PROVIDER_REJECTION',
  ]));

  const invalid = sanitizeMetaProviderDiagnostic({
    providerPhase: 'attacker_phase',
    providerHttpStatus: 99,
    providerCode: 1.5,
    providerSubcode: 2 ** 31,
    providerCategory: 'RAW_PROVIDER_MESSAGE',
    providerIsTransient: 'true',
    providerAttempts: 3,
  });
  check(() => assert.deepEqual(invalid, {
    providerPhase: null,
    providerHttpStatus: null,
    providerCode: null,
    providerSubcode: null,
    providerCategory: null,
    providerIsTransient: null,
    providerAttempts: null,
  }));

  const valid = sanitizeMetaProviderDiagnostic({
    providerPhase: 'short_token_exchange',
    providerHttpStatus: 400,
    providerCode: -2_147_483_648,
    providerSubcode: 2_147_483_647,
    providerCategory: 'UNKNOWN_PROVIDER_REJECTION',
    providerIsTransient: false,
    providerAttempts: 1,
  });
  check(() => assert.equal(valid.providerPhase, 'short_token_exchange'));
  check(() => assert.equal(valid.providerHttpStatus, 400));
  check(() => assert.equal(valid.providerCode, -2_147_483_648));
  check(() => assert.equal(valid.providerSubcode, 2_147_483_647));
  check(() => assert.equal(valid.providerCategory, 'UNKNOWN_PROVIDER_REJECTION'));
  check(() => assert.equal(valid.providerIsTransient, false));
  check(() => assert.equal(valid.providerAttempts, 1));

  const unrelated = safeTelemetry({
    action: 'status',
    success: false,
    code: 'INTERNAL_ERROR',
    providerPhase: 'short_token_exchange',
    providerHttpStatus: 400,
    providerCode: 190,
    providerSubcode: 123,
    providerCategory: 'INVALID_OR_EXPIRED_CODE',
    providerIsTransient: false,
  });
  for (const field of ['providerPhase', 'providerHttpStatus', 'providerCode', 'providerSubcode', 'providerCategory', 'providerIsTransient']) {
    check(() => assert.equal(unrelated[field], null));
  }
}

function identityBoundaryChecks() {
  const identities = [
    platformDomainUserId,
    companyDomainUserId,
    companyFallbackDomainId,
    verifiedAuthUserId,
    otherAuthUserId,
  ];
  check(() => assert.equal(new Set(identities).size, identities.length));
  check(() => assert.equal(requireBearerJwt(`Bearer ${syntheticJwt}`), syntheticJwt));
  for (const authorization of ['', 'Bearer', 'bearer a.b.c', 'Bearer a.b', 'Bearer a.b.c trailing']) {
    check(() => assert.throws(() => requireBearerJwt(authorization), (error) => error.code === 'AUTH_REQUIRED'));
  }
  check(() => assert.equal(requireVerifiedAuthUserId({ data: { user: { id: verifiedAuthUserId } }, error: null }), verifiedAuthUserId));
  for (const result of [
    { data: { user: { id: verifiedAuthUserId } }, error: new Error('synthetic verification failure') },
    { data: { user: null }, error: null },
    { data: { user: { id: 'not-a-uuid' } }, error: null },
  ]) {
    check(() => assert.throws(() => requireVerifiedAuthUserId(result), (error) => error.code === 'AUTH_REQUIRED'));
  }
  check(() => assert.equal(requireActiveDomainSession({ user_id: companyDomainUserId, status: 'active' }, null).user_id, companyDomainUserId));
  check(() => assert.throws(
    () => requireActiveDomainSession({ user_id: companyDomainUserId, status: 'disabled' }, null),
    (error) => error.code === 'AUTH_REQUIRED',
  ));

  check(() => assert.doesNotThrow(() => assertMetaAccessRole({ kind: 'owner', role: 'owner' }, companyId)));
  for (const role of ['admin', 'support', 'viewer']) {
    check(() => assert.throws(() => assertMetaAccessRole({ kind: 'owner', role }, companyId), (error) => error.code === 'FORBIDDEN'));
  }
  for (const role of ['admin', 'manager']) {
    check(() => assert.doesNotThrow(() => assertMetaAccessRole({ kind: 'company', role, company_id: companyId }, companyId)));
  }
  for (const role of ['dispatcher', 'technician', 'invited']) {
    check(() => assert.throws(
      () => assertMetaAccessRole({ kind: 'company', role, company_id: companyId }, companyId),
      (error) => error.code === 'FORBIDDEN',
    ));
  }
  check(() => assert.throws(
    () => assertMetaAccessRole({ kind: 'company', role: 'admin', company_id: otherCompanyId }, companyId),
    (error) => error.code === 'FORBIDDEN',
  ));
}

async function encryptionChecks() {
  const stateA = generateOAuthState(32, cryptoApi);
  const stateB = generateOAuthState(32, cryptoApi);
  check(() => assert.notEqual(stateA, stateB));
  check(() => assert.ok(stateA.length >= 43));
  const stateHash = await hashOAuthState(stateA, cryptoApi);
  check(() => assert.match(stateHash, /^\\x[0-9a-f]{64}$/));
  check(() => assert.ok(!stateHash.includes(stateA)));
  await checkAsync(() => assert.rejects(hashOAuthState('short', cryptoApi), /OAUTH_STATE_INVALID/));

  const pendingContext = pendingEnvelopeContext({
    companyId,
    actorId: verifiedAuthUserId,
    oauthStateId: '00000000-0000-4000-8000-000000005601',
    redirectUri: config.redirectUri,
  });
  const value = { schemaVersion: 'test-v1', secretValue: 'sensitive-test-value' };
  const envelopeA = await encryptTokenBundle(value, encryptionKey, pendingContext, cryptoApi);
  const envelopeB = await encryptTokenBundle(value, encryptionKey, pendingContext, cryptoApi);
  check(() => assert.equal(envelopeA.purpose, 'meta-pending'));
  check(() => assert.equal(envelopeA.schemaVersion, 'encrypted-social-token-v1'));
  check(() => assert.equal(envelopeA.algorithm, 'AES-GCM'));
  check(() => assert.equal(envelopeA.keyVersion, 1));
  check(() => assert.notEqual(envelopeA.iv, envelopeB.iv));
  check(() => assert.notEqual(envelopeA.ciphertext, envelopeB.ciphertext));
  check(() => assert.ok(!JSON.stringify(envelopeA).includes(value.secretValue)));
  await checkAsync(async () => assert.deepEqual(await decryptTokenBundle(envelopeA, encryptionKey, pendingContext, cryptoApi), value));

  const wrongPendingContexts = [
    pendingEnvelopeContext({ ...pendingContext, companyId: otherCompanyId }),
    pendingEnvelopeContext({ ...pendingContext, actorId: otherAuthUserId }),
    pendingEnvelopeContext({ ...pendingContext, oauthStateId: '00000000-0000-4000-8000-000000005602' }),
    pendingEnvelopeContext({ ...pendingContext, redirectUri: 'https://other.example.test/auth/meta/callback' }),
  ];
  for (const context of wrongPendingContexts) {
    await checkAsync(() => assert.rejects(decryptTokenBundle(envelopeA, encryptionKey, context, cryptoApi), /CONNECTION_NEEDS_REAUTHORIZATION/));
  }
  await checkAsync(() => assert.rejects(decryptTokenBundle(envelopeA, Buffer.alloc(32, 18).toString('base64'), pendingContext, cryptoApi), /CONNECTION_NEEDS_REAUTHORIZATION/));
  await checkAsync(() => assert.rejects(decryptTokenBundle({ ...envelopeA, keyVersion: 2 }, encryptionKey, pendingContext, cryptoApi), /CONNECTION_NEEDS_REAUTHORIZATION/));
  await checkAsync(() => assert.rejects(decryptTokenBundle({ ...envelopeA, iv: mutate(envelopeA.iv) }, encryptionKey, pendingContext, cryptoApi), /CONNECTION_NEEDS_REAUTHORIZATION/));
  await checkAsync(() => assert.rejects(decryptTokenBundle({ ...envelopeA, ciphertext: mutate(envelopeA.ciphertext) }, encryptionKey, pendingContext, cryptoApi), /CONNECTION_NEEDS_REAUTHORIZATION/));
  check(() => assert.throws(() => assertEnvelope({ ...envelopeA, extra: 'blocked' }, 'meta-pending'), /CONNECTION_NEEDS_REAUTHORIZATION/));

  const finalContext = connectionEnvelopeContext({
    companyId,
    connectionId: '00000000-0000-4000-8000-000000005701',
    pageId: '10001',
  });
  const finalEnvelope = await encryptTokenBundle(value, encryptionKey, finalContext, cryptoApi);
  check(() => assert.equal(finalEnvelope.purpose, 'meta-connection'));
  await checkAsync(async () => assert.deepEqual(await decryptTokenBundle(finalEnvelope, encryptionKey, finalContext, cryptoApi), value));
  for (const context of [
    connectionEnvelopeContext({ ...finalContext, companyId: otherCompanyId }),
    connectionEnvelopeContext({ ...finalContext, connectionId: '00000000-0000-4000-8000-000000005702' }),
    connectionEnvelopeContext({ ...finalContext, pageId: '10002' }),
  ]) {
    await checkAsync(() => assert.rejects(decryptTokenBundle(finalEnvelope, encryptionKey, context, cryptoApi), /CONNECTION_NEEDS_REAUTHORIZATION/));
  }
  await checkAsync(() => assert.rejects(decryptTokenBundle(envelopeA, encryptionKey, finalContext, cryptoApi), /CONNECTION_NEEDS_REAUTHORIZATION/));
}

async function providerChecks() {
  const basic = makeProvider([{ data: [rawPage('10001')] }]);
  const authorizationUrl = new URL(basic.provider.buildAuthorizationUrl({ state: generateOAuthState(32, cryptoApi) }));
  check(() => assert.equal(authorizationUrl.origin, 'https://www.facebook.com'));
  check(() => assert.equal(authorizationUrl.pathname, '/v25.0/dialog/oauth'));
  check(() => assert.equal(authorizationUrl.searchParams.get('client_id'), config.appId));
  check(() => assert.equal(authorizationUrl.searchParams.get('config_id'), config.loginConfigurationId));
  check(() => assert.equal(authorizationUrl.searchParams.get('response_type'), 'code'));
  check(() => assert.equal(authorizationUrl.searchParams.get('override_default_response_type'), 'true'));
  check(() => assert.equal(authorizationUrl.searchParams.has('scope'), false));
  check(() => assert.equal(authorizationUrl.searchParams.has('next'), false));
  const onePage = await basic.provider.discover({ userAccessToken: 'user-token-value' });
  check(() => assert.equal(onePage.pages.length, 1));
  check(() => assert.equal(onePage.attempts, 1));

  const multi = makeProvider([
    { data: [rawPage('10001'), rawPage('10002')], cursor: 'cursor_2' },
    { data: [rawPage('10002'), rawPage('10003')], cursor: 'cursor_3' },
    { data: [rawPage('10004')] },
  ]);
  const multiplePages = await multi.provider.discover({ userAccessToken: 'user-token-value' });
  check(() => assert.deepEqual(multiplePages.pages.map((page) => page.pageId), ['10001', '10002', '10003', '10004']));
  check(() => assert.equal(multi.accountCalls(), 3));
  check(() => assert.equal(new URL(multi.calls[2].url).searchParams.get('after'), 'cursor_2'));
  check(() => assert.equal(new URL(multi.calls[3].url).searchParams.get('after'), 'cursor_3'));

  const hundredBatches = Array.from({ length: 4 }, (_, batch) => ({
    data: Array.from({ length: 25 }, (_, index) => rawPage(String(20000 + batch * 25 + index))),
    cursor: batch < 3 ? `cursor_${batch + 2}` : null,
  }));
  const hundred = await makeProvider(hundredBatches).provider.discover({ userAccessToken: 'user-token-value' });
  check(() => assert.equal(hundred.pages.length, 100));

  const capped = makeProvider(Array.from({ length: 5 }, (_, index) => ({ data: [rawPage(String(30000 + index))], cursor: `more_${index}` })));
  await checkAsync(() => assert.rejects(
    capped.provider.discover({ userAccessToken: 'user-token-value' }),
    (error) => error.code === 'META_PAGE_DISCOVERY_LIMIT',
  ));
  check(() => assert.equal(capped.accountCalls(), 5));

  const malformed = makeProvider([{ data: [rawPage('40001')], cursor: 'https://attacker.example/next' }]);
  await checkAsync(() => assert.rejects(
    malformed.provider.discover({ userAccessToken: 'user-token-value' }),
    (error) => error.code === 'OAUTH_PROVIDER_ERROR',
  ));
  check(() => assert.ok([...basic.calls, ...multi.calls].every((call) => !call.url.includes('user-token-value'))));
  check(() => assert.ok([...basic.calls, ...multi.calls].every((call) => call.init.headers?.Authorization === 'Bearer user-token-value')));
  check(() => assert.ok([...basic.calls, ...multi.calls].every((call) => !call.url.startsWith('https://attacker.example'))));

  const retrying = makeProvider([{ data: [rawPage('50001')] }], { failFirstPageWith500: true });
  const retried = await retrying.provider.discover({ userAccessToken: 'user-token-value' });
  check(() => assert.equal(retried.attempts, 2));
  check(() => assert.equal(retrying.accountCalls(), 2));

  const retryThenCapped = makeProvider(
    Array.from({ length: 4 }, (_, index) => ({ data: [rawPage(String(51001 + index))], cursor: `retry_more_${index}` })),
    { failFirstPageWith500: true },
  );
  await checkAsync(() => assert.rejects(
    retryThenCapped.provider.discover({ userAccessToken: 'user-token-value' }),
    (error) => error.code === 'META_PAGE_DISCOVERY_LIMIT',
  ));
  check(() => assert.equal(retryThenCapped.accountCalls(), 5));

  const successfulExchange = makeExchangeProvider([
    { payload: { access_token: 'synthetic-short-token', expires_in: 3600 }, status: 200 },
    { payload: { access_token: 'synthetic-long-token', expires_in: 7200, token_type: 'bearer' }, status: 200 },
  ]);
  const exchanged = await successfulExchange.provider.exchangeCode({ code: 'synthetic-oauth-code' });
  check(() => assert.equal(exchanged.accessToken, 'synthetic-long-token'));
  check(() => assert.equal(successfulExchange.calls.length, 2));
  check(() => assert.ok(successfulExchange.calls.every((call) => call.url === 'https://graph.facebook.com/v25.0/oauth/access_token')));
  check(() => assert.ok(successfulExchange.calls.every((call) => call.init.method === 'POST')));
  check(() => assert.ok(successfulExchange.calls.every((call) => call.init.headers['Content-Type'] === 'application/x-www-form-urlencoded')));
  const shortForm = new URLSearchParams(successfulExchange.calls[0].init.body);
  const longForm = new URLSearchParams(successfulExchange.calls[1].init.body);
  check(() => assert.deepEqual([...shortForm.keys()].sort(), ['client_id', 'client_secret', 'code', 'redirect_uri']));
  check(() => assert.deepEqual([...longForm.keys()].sort(), ['client_id', 'client_secret', 'fb_exchange_token', 'grant_type']));
  check(() => assert.equal(longForm.get('grant_type'), 'fb_exchange_token'));

  const sensitiveFixtures = [
    'fake-access-token-sensitive',
    'fake-oauth-code-sensitive',
    'fake-app-secret-sensitive',
    '123456789012345-sensitive-client',
    'https://sensitive.example.test/callback?code=secret',
  ];
  const maliciousMessage = `The authorization code is invalid or expired ${sensitiveFixtures.join(' ')}`;
  const shortFailure = makeExchangeProvider([{
    payload: { error: { code: 190, error_subcode: 463, is_transient: false, message: maliciousMessage } },
    status: 400,
  }]);
  const shortError = await captureExchangeError(shortFailure.provider);
  check(() => assert.equal(shortFailure.calls.length, 1));
  assertSafeExchangeError(shortError, {
    code: 'OAUTH_CODE_EXCHANGE_FAILED',
    phase: 'short_token_exchange',
    status: 400,
    providerCode: 190,
    providerSubcode: 463,
    category: 'INVALID_OR_EXPIRED_CODE',
    transient: false,
    attempts: 1,
  });
  const shortTelemetry = safeTelemetry({
    action: 'complete', success: false, code: shortError.code, stage: shortError.providerPhase,
    attempts: shortError.providerAttempts, latencyMs: 625, ...shortError,
  });
  check(() => assert.equal(shortTelemetry.stage, 'short_token_exchange'));
  check(() => assert.equal(shortTelemetry.providerCategory, 'INVALID_OR_EXPIRED_CODE'));
  for (const sensitive of sensitiveFixtures) {
    check(() => assert.equal(JSON.stringify(shortError).includes(sensitive), false));
    check(() => assert.equal(JSON.stringify(shortTelemetry).includes(sensitive), false));
  }

  const longFailure = makeExchangeProvider([
    { payload: { access_token: 'synthetic-short-token' }, status: 200 },
    { payload: { error: { code: 101, error_subcode: 7, is_transient: false, message: 'Invalid client secret provided.' } }, status: 400 },
  ]);
  const longError = await captureExchangeError(longFailure.provider);
  check(() => assert.equal(longFailure.calls.length, 2));
  assertSafeExchangeError(longError, {
    code: 'OAUTH_CODE_EXCHANGE_FAILED',
    phase: 'long_token_exchange',
    status: 400,
    providerCode: 101,
    providerSubcode: 7,
    category: 'INVALID_CLIENT_CREDENTIALS',
    transient: false,
    attempts: 2,
  });

  const shortMissing = makeExchangeProvider([{ payload: { expires_in: 3600, token_type: 'bearer' }, status: 200 }]);
  const shortMissingError = await captureExchangeError(shortMissing.provider);
  assertSafeExchangeError(shortMissingError, {
    code: 'OAUTH_CODE_EXCHANGE_FAILED', phase: 'short_token_exchange', status: 200,
    providerCode: null, providerSubcode: null, category: 'SUCCESS_RESPONSE_MISSING_TOKEN', transient: false, attempts: 1,
  });
  check(() => assert.equal(shortMissing.calls.length, 1));

  const longMissing = makeExchangeProvider([
    { payload: { access_token: 'synthetic-short-token' }, status: 200 },
    { payload: { access_token: 123, expires_in: 7200 }, status: 200 },
  ]);
  const longMissingError = await captureExchangeError(longMissing.provider);
  assertSafeExchangeError(longMissingError, {
    code: 'OAUTH_CODE_EXCHANGE_FAILED', phase: 'long_token_exchange', status: 200,
    providerCode: null, providerSubcode: null, category: 'SUCCESS_RESPONSE_MISSING_TOKEN', transient: false, attempts: 2,
  });
  check(() => assert.equal(longMissing.calls.length, 2));

  for (const scenario of [
    { name: 'short network', steps: [{ throw: 'raw short network secret' }], signal: undefined, code: 'META_PROVIDER_UNAVAILABLE', phase: 'short_token_exchange', attempts: 1 },
    { name: 'long network', steps: [{ payload: { access_token: 'synthetic-short-token' }, status: 200 }, { throw: 'raw long network secret' }], signal: undefined, code: 'META_PROVIDER_UNAVAILABLE', phase: 'long_token_exchange', attempts: 2 },
    { name: 'short abort', steps: [{ throw: 'raw short abort secret' }], signal: { aborted: true }, code: 'META_PROVIDER_TIMEOUT', phase: 'short_token_exchange', attempts: 1 },
    { name: 'long abort', steps: [{ payload: { access_token: 'synthetic-short-token' }, status: 200 }, { throw: 'raw long abort secret' }], signal: { aborted: true }, code: 'META_PROVIDER_TIMEOUT', phase: 'long_token_exchange', attempts: 2 },
  ]) {
    const fixture = makeExchangeProvider(scenario.steps);
    const error = await captureExchangeError(fixture.provider, scenario.signal);
    check(() => assert.equal(error.code, scenario.code, scenario.name));
    check(() => assert.equal(error.providerPhase, scenario.phase, scenario.name));
    check(() => assert.equal(error.providerHttpStatus, null, scenario.name));
    check(() => assert.equal(error.providerCode, null, scenario.name));
    check(() => assert.equal(error.providerSubcode, null, scenario.name));
    check(() => assert.equal(error.providerCategory, 'PROVIDER_TEMPORARY_ERROR', scenario.name));
    check(() => assert.equal(error.providerIsTransient, true, scenario.name));
    check(() => assert.equal(error.providerAttempts, scenario.attempts, scenario.name));
    check(() => assert.doesNotMatch(JSON.stringify(error), /raw .* secret/i, scenario.name));
  }

  for (const scenario of [
    { status: 429, payload: { error: { code: 4, message: 'Unclassified throttling response.' } }, category: 'PROVIDER_RATE_LIMIT' },
    { status: 503, payload: { error: { code: 2, message: 'Unclassified upstream response.' } }, category: 'PROVIDER_TEMPORARY_ERROR' },
    { status: 400, payload: { error: { code: 2, is_transient: true, message: 'Unclassified provider response.' } }, category: 'PROVIDER_TEMPORARY_ERROR' },
    { status: 400, payload: { error: { code: 999, message: 'Unclassified provider rejection.' } }, category: 'UNKNOWN_PROVIDER_REJECTION' },
  ]) {
    const fixture = makeExchangeProvider([{ payload: scenario.payload, status: scenario.status }]);
    const error = await captureExchangeError(fixture.provider);
    check(() => assert.equal(error.providerCategory, scenario.category));
    check(() => assert.equal(error.providerHttpStatus, scenario.status));
    check(() => assert.equal(error.providerAttempts, 1));
  }

  const malformedFailure = makeExchangeProvider([{ status: 400, malformed: true }]);
  const malformedError = await captureExchangeError(malformedFailure.provider);
  check(() => assert.equal(malformedError.providerCategory, 'UNKNOWN_PROVIDER_REJECTION'));
  check(() => assert.equal(malformedError.providerCode, null));
  check(() => assert.equal(malformedError.providerSubcode, null));

  for (const [message, category] of [
    ['The redirect_uri does not match the original redirect URI.', 'REDIRECT_URI_MISMATCH'],
    ['This authorization code has already been used.', 'CODE_ALREADY_USED'],
    ['Unsupported grant_type parameter.', 'UNSUPPORTED_GRANT_OR_PARAMETER'],
    ['The application configuration is disabled.', 'APP_CONFIGURATION_ERROR'],
    ['Provider rejected the request.', 'UNKNOWN_PROVIDER_REJECTION'],
  ]) {
    const diagnostic = normalizeMetaProviderDiagnostic({ error: { message } }, 400, 'short_token_exchange');
    check(() => assert.equal(diagnostic.providerCategory, category));
    check(() => assert.equal(diagnostic.providerAttempts, 1));
  }
}

async function serviceChecks() {
  const configurationOnlyMemory = makeMemoryRepository();
  const configurationOnlyProvider = {
    buildAuthorizationUrl: () => { throw new Error('configuration-only status reached provider'); },
    exchangeCode: async () => { throw new Error('configuration-only status reached provider'); },
    discover: async () => { throw new Error('configuration-only status reached provider'); },
    checkHealth: async () => { throw new Error('configuration-only status reached provider'); },
  };
  const configurationOnlyDeps = makeServiceDeps(configurationOnlyMemory, configurationOnlyProvider);
  const configurationOnlyStatus = await callService(configurationOnlyDeps, { action: 'status', companyId });
  check(() => assert.equal(configurationOnlyStatus.configured, true));
  check(() => assert.equal(configurationOnlyMemory.providerCalls, 0));
  check(() => assert.equal(configurationOnlyMemory.states.size, 0));
  check(() => assert.equal(configurationOnlyMemory.audits.length, 0));
  check(() => assert.equal(configurationOnlyMemory.connections.size, 0));

  const memory = makeMemoryRepository();
  const providerCalls = { exchange: 0, discover: 0, health: 0 };
  const serviceProvider = {
    buildAuthorizationUrl: ({ state }) => `https://www.facebook.com/v25.0/dialog/oauth?state=${encodeURIComponent(state)}`,
    exchangeCode: async () => { providerCalls.exchange += 1; return { accessToken: 'user-secret', expiresAt: '2026-08-30T00:00:00.000Z' }; },
    discover: async () => {
      providerCalls.discover += 1;
      return { grantedScopes: [...META_REQUESTED_SCOPES], pages: [safePage('10001'), safePage('10002', true)], attempts: 1 };
    },
    checkHealth: async () => { providerCalls.health += 1; return { grantedScopes: [...META_REQUESTED_SCOPES], pageAvailable: true, attempts: 1 }; },
  };
  const deps = makeServiceDeps(memory, serviceProvider);

  const started = await callService(deps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
  const generatedState = new URL(started.authorizationUrl).searchParams.get('state');
  check(() => assert.ok(generatedState));
  check(() => assert.equal(memory.states.size, 1));
  check(() => assert.ok([...memory.states.values()].every((row) => row.stateHash !== generatedState)));
  const startedRow = [...memory.states.values()][0];
  check(() => assert.equal(startedRow.actorAuthUserId, verifiedAuthUserId));
  check(() => assert.equal(JSON.stringify(startedRow).includes(companyDomainUserId), false));
  check(() => assert.deepEqual(memory.auditRecords.at(-1), {
    action: 'meta_connection_started',
    resourceType: 'meta_social_authorization',
    resourceLabel: 'Meta authorization',
    actorAuthUserId: verifiedAuthUserId,
  }));
  const completed = await callService(deps, { action: 'complete', code: 'provider-code', state: generatedState });
  check(() => assert.equal(completed.destination, 'social_connections'));
  check(() => assert.equal(completed.status, 'pending_asset_selection'));
  check(() => assert.equal(completed.assets.length, 2));
  check(() => assert.equal(JSON.stringify(completed).includes('user-secret'), false));
  check(() => assert.equal(JSON.stringify(completed).includes(companyDomainUserId), false));
  const pendingRow = memory.states.get(completed.oauthSessionId);
  await checkAsync(async () => assert.equal(
    (await decryptTokenBundle(
      pendingRow.envelope,
      encryptionKey,
      pendingEnvelopeContext({
        companyId,
        actorId: verifiedAuthUserId,
        oauthStateId: pendingRow.id,
        redirectUri: pendingRow.redirectUri,
      }),
      cryptoApi,
    )).schemaVersion,
    'meta-pending-token-bundle-v1',
  ));
  await checkAsync(() => assert.rejects(
    decryptTokenBundle(
      pendingRow.envelope,
      encryptionKey,
      pendingEnvelopeContext({
        companyId,
        actorId: companyDomainUserId,
        oauthStateId: pendingRow.id,
        redirectUri: pendingRow.redirectUri,
      }),
      cryptoApi,
    ),
    (error) => error.code === 'CONNECTION_NEEDS_REAUTHORIZATION',
  ));
  check(() => assert.deepEqual(memory.auditRecords.at(-1), {
    action: 'meta_oauth_completed',
    resourceType: 'meta_social_authorization',
    resourceLabel: 'Meta authorization',
    actorAuthUserId: verifiedAuthUserId,
  }));

  const selected = await callService(deps, {
    action: 'select_asset', companyId, oauthSessionId: completed.oauthSessionId, pageId: '10001',
  });
  check(() => assert.equal(selected.connection.facebookPageId, '10001'));
  check(() => assert.equal(memory.connections.get(selected.connection.id).connected_by, verifiedAuthUserId));
  check(() => assert.equal(JSON.stringify(selected).includes(companyDomainUserId), false));
  check(() => assert.equal(activeConnections(memory, companyId).length, 1));
  check(() => assert.equal(companyStates(memory, companyId).length, 0));

  const secondStart = await callService(deps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
  const secondState = new URL(secondStart.authorizationUrl).searchParams.get('state');
  const secondComplete = await callService(deps, { action: 'complete', code: 'provider-code', state: secondState });
  const replaced = await callService(deps, {
    action: 'select_asset', companyId, oauthSessionId: secondComplete.oauthSessionId, pageId: '10002',
  });
  check(() => assert.equal(replaced.connection.facebookPageId, '10002'));
  check(() => assert.equal(activeConnections(memory, companyId).length, 1));
  const oldConnection = memory.connections.get(selected.connection.id);
  check(() => assert.equal(oldConnection.status, 'revoked'));
  check(() => assert.equal(oldConnection.token_envelope, null));
  check(() => assert.equal(memory.audits.filter((event) => event === 'meta_asset_selected').length, 2));

  const otherConnection = makeConnection('00000000-0000-4000-8000-000000005799', otherCompanyId, '90001');
  memory.connections.set(otherConnection.id, otherConnection);
  addPending(memory, companyId, otherAuthUserId, '00000000-0000-4000-8000-000000005799');
  addPending(memory, otherCompanyId, otherAuthUserId, '00000000-0000-4000-8000-000000005798');
  const providerCallsBeforeDisconnect = { ...providerCalls };
  const disconnected = await callService(deps, { action: 'disconnect', companyId, connectionId: replaced.connection.id });
  check(() => assert.equal(disconnected.status, 'revoked'));
  check(() => assert.deepEqual(providerCalls, providerCallsBeforeDisconnect));
  check(() => assert.equal(memory.connections.get(replaced.connection.id).token_envelope, null));
  check(() => assert.equal(companyStates(memory, companyId).length, 0));
  check(() => assert.equal(companyStates(memory, otherCompanyId).length, 1));
  check(() => assert.equal(memory.connections.get(otherConnection.id).status, 'connected'));
  await checkAsync(() => assert.rejects(
    callService(deps, { action: 'check_health', companyId, connectionId: replaced.connection.id }),
    (error) => error.code === 'CONNECTION_NEEDS_REAUTHORIZATION',
  ));

  const errorStart = await callService(deps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
  const errorState = new URL(errorStart.authorizationUrl).searchParams.get('state');
  await checkAsync(() => assert.rejects(
    callService(deps, { action: 'complete', state: errorState, providerError: 'access_denied' }),
    (error) => error.code === 'OAUTH_PROVIDER_ERROR',
  ));
  check(() => assert.equal(companyStates(memory, companyId).length, 0));

  const invalidConfigMemory = makeMemoryRepository();
  const invalidConfigDeps = makeServiceDeps(invalidConfigMemory, serviceProvider, {
    config: runtimeConfigFromEnv((key) => ({ ...configValues, META_TOKEN_ENCRYPTION_KEY_V1: Buffer.alloc(31).toString('base64') })[key]),
  });
  const callsBeforeInvalidStart = { ...providerCalls };
  await checkAsync(() => assert.rejects(
    callService(invalidConfigDeps, { action: 'start', companyId, returnPath: '/settings/social-connections' }),
    (error) => error.code === 'META_NOT_CONFIGURED',
  ));
  check(() => assert.equal(invalidConfigMemory.states.size, 0));
  check(() => assert.deepEqual(providerCalls, callsBeforeInvalidStart));

  await runtimeTtlChecks(serviceProvider);
  await lifecycleAuditRollbackChecks(serviceProvider);
  await exchangeTelemetryChecks();

  await retentionChecks(serviceProvider);
  await healthChecks(serviceProvider);
  await authorizationChecks(serviceProvider);
  await identityLifecycleChecks(serviceProvider);
}

async function exchangeTelemetryChecks() {
  for (const scenario of [
    {
      name: 'short exchange service failure',
      steps: [{ payload: { error: { code: 190, error_subcode: 463, is_transient: false, message: 'Authorization code is expired.' } }, status: 400 }],
      phase: 'short_token_exchange',
      attempts: 1,
      category: 'INVALID_OR_EXPIRED_CODE',
    },
    {
      name: 'long exchange service failure',
      steps: [
        { payload: { access_token: 'synthetic-short-token' }, status: 200 },
        { payload: { error: { code: 101, error_subcode: 7, is_transient: false, message: 'Invalid client secret provided.' } }, status: 400 },
      ],
      phase: 'long_token_exchange',
      attempts: 2,
      category: 'INVALID_CLIENT_CREDENTIALS',
    },
  ]) {
    const memory = makeMemoryRepository();
    const fixture = makeExchangeProvider(scenario.steps);
    let discoveryCalls = 0;
    const provider = {
      ...fixture.provider,
      exchangeCode: async (input) => {
        check(() => assert.ok([...memory.states.values()].every((row) => row.consumedAt), scenario.name));
        return fixture.provider.exchangeCode(input);
      },
      discover: async () => {
        discoveryCalls += 1;
        throw new Error('exchange failure reached discovery');
      },
    };
    const deps = makeServiceDeps(memory, provider);
    const started = await callService(deps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
    const state = new URL(started.authorizationUrl).searchParams.get('state');
    await checkAsync(() => assert.rejects(
      callService(deps, { action: 'complete', code: 'synthetic-oauth-code', state }),
      (error) => error.code === 'OAUTH_CODE_EXCHANGE_FAILED',
      scenario.name,
    ));
    const telemetry = memory.telemetry.at(-1);
    check(() => assert.equal(telemetry.action, 'complete', scenario.name));
    check(() => assert.equal(telemetry.success, false, scenario.name));
    check(() => assert.equal(telemetry.code, 'OAUTH_CODE_EXCHANGE_FAILED', scenario.name));
    check(() => assert.equal(telemetry.stage, scenario.phase, scenario.name));
    check(() => assert.equal(telemetry.providerPhase, scenario.phase, scenario.name));
    check(() => assert.equal(telemetry.providerCategory, scenario.category, scenario.name));
    check(() => assert.equal(telemetry.attempts, scenario.attempts, scenario.name));
    check(() => assert.equal(telemetry.providerIsTransient, false, scenario.name));
    check(() => assert.equal(fixture.calls.length, scenario.attempts, scenario.name));
    check(() => assert.equal(discoveryCalls, 0, scenario.name));
    check(() => assert.equal(memory.states.size, 0, scenario.name));
    check(() => assert.equal(memory.connections.size, 0, scenario.name));
    check(() => assert.equal(memory.auditRecords.filter((record) => record.action === 'meta_oauth_completed').length, 0, scenario.name));
  }
}

async function runtimeTtlChecks(provider) {
  const startAt = Date.parse('2026-07-31T22:00:00.000Z');
  for (const [label, injectedTtlMs, expectedTtlMs] of [
    ['production', META_OAUTH_STATE_TTL_MS, META_OAUTH_STATE_TTL_MS],
    ['short injected', 5 * 60_000, 5 * 60_000],
    ['capped injected', 60 * 60_000, META_OAUTH_STATE_TTL_MS],
  ]) {
    const memory = makeMemoryRepository();
    const deps = makeServiceDeps(memory, provider, { stateTtlMs: injectedTtlMs });
    await callService(deps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
    const row = [...memory.states.values()][0];
    check(() => assert.equal(Date.parse(row.expiresAt) - startAt, expectedTtlMs, `${label} TTL mismatch`));
  }

  for (const invalidTtl of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '300000']) {
    const memory = makeMemoryRepository();
    const deps = makeServiceDeps(memory, provider, { stateTtlMs: invalidTtl });
    await checkAsync(() => assert.rejects(
      callService(deps, { action: 'start', companyId, returnPath: '/settings/social-connections' }),
      (error) => error.code === 'INTERNAL_ERROR',
    ));
    check(() => assert.equal(memory.states.size, 0));
  }

  const payloadMemory = makeMemoryRepository();
  await checkAsync(() => assert.rejects(
    callService(makeServiceDeps(payloadMemory, provider), {
      action: 'start', companyId, returnPath: '/settings/social-connections', stateTtlMs: 60_000,
    }),
    (error) => error.code === 'INVALID_REQUEST',
  ));
  check(() => assert.equal(payloadMemory.states.size, 0));

  for (const elapsedMs of [17 * 60_000 + 36_000, 29 * 60_000 + 59_000]) {
    const memory = makeMemoryRepository();
    const timingCalls = { exchange: 0, discover: 0 };
    const timingProvider = {
      ...provider,
      exchangeCode: async () => {
        check(() => assert.ok([...memory.states.values()].every((row) => row.consumedAt)));
        timingCalls.exchange += 1;
        return { accessToken: 'timing-secret', expiresAt: '2026-08-30T00:00:00.000Z' };
      },
      discover: async () => {
        timingCalls.discover += 1;
        return { grantedScopes: [...META_REQUESTED_SCOPES], pages: [safePage('10001')], attempts: 1 };
      },
    };
    const deps = makeServiceDeps(memory, timingProvider);
    const started = await callService(deps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
    memory.nowMs += elapsedMs;
    await callService(deps, {
      action: 'complete', code: 'provider-code', state: new URL(started.authorizationUrl).searchParams.get('state'),
    });
    check(() => assert.deepEqual(timingCalls, { exchange: 1, discover: 1 }));
  }

  const expiredMemory = makeMemoryRepository();
  const expiredCalls = { exchange: 0, discover: 0 };
  const expiredProvider = {
    ...provider,
    exchangeCode: async () => { expiredCalls.exchange += 1; throw new Error('expired callback reached code exchange'); },
    discover: async () => { expiredCalls.discover += 1; throw new Error('expired callback reached Graph discovery'); },
  };
  const expiredDeps = makeServiceDeps(expiredMemory, expiredProvider);
  const expiredStart = await callService(expiredDeps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
  expiredMemory.nowMs += META_OAUTH_STATE_TTL_MS + 1;
  await checkAsync(() => assert.rejects(
    callService(expiredDeps, {
      action: 'complete', code: 'provider-code', state: new URL(expiredStart.authorizationUrl).searchParams.get('state'),
    }),
    (error) => error.code === 'OAUTH_STATE_EXPIRED',
  ));
  check(() => assert.deepEqual(expiredCalls, { exchange: 0, discover: 0 }));
  check(() => assert.equal([...expiredMemory.states.values()][0].consumedAt, null));
  check(() => assert.equal(expiredMemory.telemetry.at(-1).attempts, 0));
}

async function lifecycleAuditRollbackChecks(provider) {
  const startMemory = makeMemoryRepository();
  startMemory.failAuditActions.add('meta_connection_started');
  const startDeps = makeServiceDeps(startMemory, provider);
  await checkAsync(() => assert.rejects(
    callService(startDeps, { action: 'start', companyId, returnPath: '/settings/social-connections' }),
    (error) => error.code === 'INTERNAL_ERROR',
  ));
  check(() => assert.equal(startMemory.states.size, 0));
  check(() => assert.equal(startMemory.audits.length, 0));

  const completeMemory = makeMemoryRepository();
  const completeDeps = makeServiceDeps(completeMemory, provider);
  const started = await callService(completeDeps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
  completeMemory.failAuditActions.add('meta_oauth_completed');
  const rawState = new URL(started.authorizationUrl).searchParams.get('state');
  await checkAsync(() => assert.rejects(
    callService(completeDeps, { action: 'complete', code: 'provider-code', state: rawState }),
    (error) => error.code === 'INTERNAL_ERROR',
  ));
  check(() => assert.equal(completeMemory.states.size, 0));
  check(() => assert.equal(completeMemory.audits.includes('meta_oauth_completed'), false));
  check(() => assert.ok([...completeMemory.states.values()].every((row) => row.envelope === null && row.assets === null)));

  const healthMemory = makeMemoryRepository();
  const healthDeps = makeServiceDeps(healthMemory, provider);
  const connection = await createConnectedFixture(healthDeps);
  const previousConnection = structuredClone(healthMemory.connections.get(connection.id));
  const previousAuditCount = healthMemory.audits.length;
  healthMemory.failAuditActions.add('meta_health_checked');
  await checkAsync(() => assert.rejects(
    callService(healthDeps, { action: 'check_health', companyId, connectionId: connection.id }),
    (error) => error.code === 'INTERNAL_ERROR',
  ));
  check(() => assert.deepEqual(healthMemory.connections.get(connection.id), previousConnection));
  check(() => assert.equal(healthMemory.audits.length, previousAuditCount));
}

async function retentionChecks(provider) {
  const memory = makeMemoryRepository();
  addPending(memory, companyId, verifiedAuthUserId, '00000000-0000-4000-8000-000000005810', { expiresAt: '2026-07-31T21:59:00.000Z' });
  addPending(memory, companyId, verifiedAuthUserId, '00000000-0000-4000-8000-000000005811', { expiresAt: '2026-07-31T22:09:00.000Z' });
  addPending(memory, otherCompanyId, verifiedAuthUserId, '00000000-0000-4000-8000-000000005812', { expiresAt: '2026-07-31T21:59:00.000Z' });
  const deps = makeServiceDeps(memory, provider);
  await callService(deps, { action: 'status', companyId });
  check(() => assert.equal(memory.states.has('00000000-0000-4000-8000-000000005810'), false));
  check(() => assert.equal(memory.states.has('00000000-0000-4000-8000-000000005811'), true));
  check(() => assert.equal(memory.states.has('00000000-0000-4000-8000-000000005812'), true));
  check(() => assert.equal(memory.providerCalls, 0));

  const failing = makeMemoryRepository();
  failing.failCleanup = true;
  const failingDeps = makeServiceDeps(failing, provider);
  await checkAsync(() => assert.rejects(
    callService(failingDeps, { action: 'status', companyId }),
    (error) => error.code === 'INTERNAL_ERROR',
  ));
  check(() => assert.equal(failing.providerCalls, 0));
}

async function healthChecks(provider) {
  for (const [code, expectedStatus] of [
    ['META_TOKEN_INVALID', 'needs_reauthorization'],
    ['META_PERMISSION_MISSING', 'needs_reauthorization'],
    ['META_PAGE_UNAVAILABLE', 'needs_reauthorization'],
    ['META_INSTAGRAM_ACCOUNT_MISMATCH', 'needs_reauthorization'],
    ['META_RATE_LIMITED', 'connected'],
    ['META_PROVIDER_TIMEOUT', 'connected'],
  ]) {
    const memory = makeMemoryRepository();
    const deps = makeServiceDeps(memory, provider);
    const connection = await createConnectedFixture(deps);
    deps.provider.checkHealth = async () => {
      const error = new MetaConnectionError(code);
      error.providerAttempts = code === 'META_PROVIDER_TIMEOUT' ? 2 : 1;
      throw error;
    };
    const result = await callService(deps, { action: 'check_health', companyId, connectionId: connection.id });
    check(() => assert.equal(result.ok, false));
    check(() => assert.equal(result.connection.status, expectedStatus));
    check(() => assert.equal(result.connection.lastErrorCode, code));
    check(() => assert.equal(memory.telemetry.at(-1).attempts, code === 'META_PROVIDER_TIMEOUT' ? 2 : 1));
  }

  const successMemory = makeMemoryRepository();
  const successDeps = makeServiceDeps(successMemory, provider);
  const successConnection = await createConnectedFixture(successDeps);
  successDeps.provider.checkHealth = async () => ({ grantedScopes: [...META_REQUESTED_SCOPES], pageAvailable: true, attempts: 2 });
  const success = await callService(successDeps, { action: 'check_health', companyId, connectionId: successConnection.id });
  check(() => assert.equal(success.connection.status, 'connected'));
  check(() => assert.equal(successMemory.telemetry.at(-1).attempts, 2));
  check(() => assert.deepEqual(successMemory.auditRecords.at(-1), {
    action: 'meta_health_checked',
    resourceType: 'meta_social_connection',
    resourceLabel: successConnection.facebook_page_name,
    actorAuthUserId: verifiedAuthUserId,
  }));

  const dbFailureMemory = makeMemoryRepository();
  const dbFailureDeps = makeServiceDeps(dbFailureMemory, provider);
  const dbFailureConnection = await createConnectedFixture(dbFailureDeps);
  const previous = { ...dbFailureMemory.connections.get(dbFailureConnection.id) };
  dbFailureMemory.failHealthUpdate = true;
  await checkAsync(() => assert.rejects(
    callService(dbFailureDeps, { action: 'check_health', companyId, connectionId: dbFailureConnection.id }),
    (error) => error.code === 'INTERNAL_ERROR',
  ));
  check(() => assert.equal(dbFailureMemory.connections.get(dbFailureConnection.id).status, previous.status));
  check(() => assert.equal(dbFailureMemory.connections.get(dbFailureConnection.id).last_error_code, previous.last_error_code));
}

async function authorizationChecks(provider) {
  const denied = makeMemoryRepository();
  const deniedDeps = makeServiceDeps(denied, provider, { accessAllowed: false });
  await checkAsync(() => assert.rejects(callService(deniedDeps, { action: 'status', companyId }), (error) => error.code === 'FORBIDDEN'));
  check(() => assert.equal(denied.providerCalls, 0));

  const owner = makeMemoryRepository();
  const ownerDeps = makeServiceDeps(owner, provider, { sessionKind: 'owner', actorRole: 'owner' });
  const ownerStatus = await callService(ownerDeps, { action: 'status', companyId });
  check(() => assert.equal(ownerStatus.ok, true));

  for (const role of ['admin', 'support', 'viewer']) {
    const memory = makeMemoryRepository();
    const deps = makeServiceDeps(memory, provider, { sessionKind: 'owner', actorRole: role });
    await checkAsync(() => assert.rejects(callService(deps, { action: 'status', companyId }), (error) => error.code === 'FORBIDDEN'));
    check(() => assert.equal(memory.states.size + memory.audits.length + memory.connections.size, 0));
  }

  for (const role of ['dispatcher', 'technician', 'invited']) {
    const memory = makeMemoryRepository();
    const deps = makeServiceDeps(memory, provider, { actorRole: role });
    await checkAsync(() => assert.rejects(callService(deps, { action: 'status', companyId }), (error) => error.code === 'FORBIDDEN'));
    check(() => assert.equal(memory.states.size + memory.audits.length + memory.connections.size, 0));
  }

  for (const actorRole of ['admin', 'manager']) {
    const allowed = makeMemoryRepository();
    const allowedDeps = makeServiceDeps(allowed, provider, { actorRole });
    const status = await callService(allowedDeps, { action: 'status', companyId });
    check(() => assert.equal(status.ok, true));
  }

  const crossCompany = makeMemoryRepository();
  const crossCompanyDeps = makeServiceDeps(crossCompany, provider, { actorRole: 'admin', sessionCompanyId: otherCompanyId });
  await checkAsync(() => assert.rejects(callService(crossCompanyDeps, { action: 'status', companyId }), (error) => error.code === 'FORBIDDEN'));

  const inactive = makeMemoryRepository();
  const inactiveDeps = makeServiceDeps(inactive, provider, { sessionStatus: 'disabled' });
  await checkAsync(() => assert.rejects(callService(inactiveDeps, { action: 'status', companyId }), (error) => error.code === 'AUTH_REQUIRED'));

  const malformedBearer = makeMemoryRepository();
  await checkAsync(() => assert.rejects(
    callServiceWithAuthorization(makeServiceDeps(malformedBearer, provider), { action: 'status', companyId }, 'Bearer malformed'),
    (error) => error.code === 'AUTH_REQUIRED',
  ));
  const missingBearer = makeMemoryRepository();
  await checkAsync(() => assert.rejects(
    callServiceWithAuthorization(makeServiceDeps(missingBearer, provider), { action: 'status', companyId }, ''),
    (error) => error.code === 'AUTH_REQUIRED',
  ));

  for (const getUserResult of [
    { data: { user: { id: verifiedAuthUserId } }, error: new Error('synthetic verification failure') },
    { data: { user: null }, error: null },
  ]) {
    const memory = makeMemoryRepository();
    const deps = makeServiceDeps(memory, provider, { getUserResult });
    await checkAsync(() => assert.rejects(callService(deps, { action: 'status', companyId }), (error) => error.code === 'AUTH_REQUIRED'));
    check(() => assert.equal(memory.states.size + memory.audits.length + memory.connections.size, 0));
  }

  const callerIdentity = makeMemoryRepository();
  const callerIdentityDeps = makeServiceDeps(callerIdentity, provider);
  await checkAsync(() => assert.rejects(
    callService(callerIdentityDeps, { action: 'start', companyId, returnPath: '/settings/social-connections', actorAuthUserId: otherAuthUserId }),
    (error) => error.code === 'INVALID_REQUEST',
  ));
  check(() => assert.equal(callerIdentity.states.size + callerIdentity.audits.length + callerIdentity.connections.size, 0));
}

async function identityLifecycleChecks(provider) {
  const scenarios = [
    { sessionKind: 'owner', actorRole: 'owner', domainUserId: platformDomainUserId },
    { sessionKind: 'company', actorRole: 'admin', domainUserId: companyDomainUserId },
    { sessionKind: 'company', actorRole: 'manager', domainUserId: companyDomainUserId },
    { sessionKind: 'company', actorRole: 'admin', domainUserId: companyFallbackDomainId },
  ];
  for (const scenario of scenarios) {
    const memory = makeMemoryRepository();
    const deps = makeServiceDeps(memory, provider, scenario);
    const connection = await createConnectedFixture(deps);
    check(() => assert.equal(connection.connected_by, verifiedAuthUserId));
    check(() => assert.equal(JSON.stringify(connection).includes(scenario.domainUserId), false));
    deps.provider.checkHealth = async () => ({ grantedScopes: [...META_REQUESTED_SCOPES], pageAvailable: true, attempts: 1 });
    await callService(deps, { action: 'check_health', companyId, connectionId: connection.id });
    await callService(deps, { action: 'disconnect', companyId, connectionId: connection.id });
    check(() => assert.ok(memory.auditRecords.every((record) => record.actorAuthUserId === verifiedAuthUserId)));
    check(() => assert.equal(JSON.stringify(memory.telemetry).includes(scenario.domainUserId), false));
    check(() => assert.equal(JSON.stringify(memory.telemetry).includes(verifiedAuthUserId), false));
  }
}

async function sourceAndSchemaChecks() {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const [accessSource, appSource, callbackSource, callbackPageSource, clientContractsSource, socialConnectionsSource, contractsSource, serviceSource, providerSource, edgeSource, migrationSource, lifecycleAuditMigrationSource, ttlMigrationSource, schemaSource, sqlRunnerSource] = await Promise.all([
    read('src/features/company-portal/companySettingsAccess.ts'),
    read('src/App.tsx'),
    read('src/features/meta-connection/callback.ts'),
    read('src/features/meta-connection/MetaOAuthCallbackPage.tsx'),
    read('src/features/meta-connection/contracts.ts'),
    read('src/features/meta-connection/SocialConnectionsPanel.tsx'),
    read('supabase/functions/_shared/meta-connection/contracts.js'),
    read('supabase/functions/_shared/meta-connection/service.js'),
    read('supabase/functions/_shared/meta-connection/provider.js'),
    read('supabase/functions/meta-social-connection/index.ts'),
    read('supabase/migrations/20260731220000_meta_social_connection_foundation.sql'),
    read('supabase/migrations/20260802020000_meta_social_lifecycle_audit_transactions.sql'),
    read('supabase/migrations/20260802203000_meta_social_oauth_state_ttl_30_minutes.sql'),
    read('supabase/schema.sql'),
    read('scripts/meta-connection-sql-tests.mjs'),
  ]);
  check(() => assert.match(accessSource, /export function canManageCompanySettings/));
  check(() => assert.match(accessSource, /sessionKind === 'owner'.*platformRole === 'owner'/s));
  check(() => assert.match(appSource, /canManageCompanySettings\(\{/));
  check(() => assert.match(appSource, /destination === 'social_connections'.*view=onboarding#portal/s));
  check(() => assert.match(callbackSource, /replaceState\(null, '', META_CALLBACK_PATH\)/));
  check(() => assert.doesNotMatch(callbackSource, /localStorage|sessionStorage/));
  check(() => assert.match(callbackPageSource, /type CallbackState = [^;]*'expired'/));
  check(() => assert.match(callbackPageSource, /error\.message\.includes\('OAUTH_STATE_EXPIRED'\) \? 'expired' : 'error'/));
  check(() => assert.match(callbackPageSource, /Authorization expired/));
  check(() => assert.match(callbackPageSource, /This Meta authorization took too long to complete\. Return to Social connections and start a new authorization\./));
  check(() => assert.doesNotMatch(callbackPageSource, /startMetaConnection|window\.location\.reload|completeMetaConnection\(callback\)[\s\S]*completeMetaConnection\(callback\)/));
  check(() => assert.match(callbackPageSource, /Connection could not be completed/));
  check(() => assert.match(callbackPageSource, /onClick=\{\(\) => onReturn\(destination\)\}/));
  check(() => assert.equal((callbackPageSource.match(/completeMetaConnection\(callback\)/g) ?? []).length, 1));
  check(() => assert.match(clientContractsSource, /export const META_FACEBOOK_PUBLISHING_SCOPE =\s*'pages_manage_posts' as const/));
  check(() => assert.match(clientContractsSource, /META_REQUESTED_SCOPES = \['pages_show_list', 'pages_read_engagement', 'instagram_basic'\] as const/));
  check(() => assert.doesNotMatch(
    clientContractsSource.match(/META_REQUESTED_SCOPES\s*=\s*\[([^\]]*)\]/)?.[1] ?? '',
    /pages_manage_posts/,
  ));
  const reconnectExpressions = extractReconnectExpressions(socialConnectionsSource);
  const reconnectState = (value) => reconnectExpressions(value, 'pages_manage_posts');
  const healthyThreeScope = reconnectState(reconnectFixture(['pages_show_list', 'pages_read_engagement', 'instagram_basic']));
  const healthyFourScope = reconnectState(reconnectFixture(['instagram_basic', 'pages_manage_posts', 'pages_show_list', 'pages_read_engagement']));
  const needsReauthorization = reconnectState(reconnectFixture([], { status: 'needs_reauthorization' }));
  const expired = reconnectState(reconnectFixture([], { tokenExpiryStatus: 'expired' }));
  const emptyScopes = reconnectState(reconnectFixture([]));
  const unknownScopes = reconnectState(reconnectFixture(['unknown_scope']));
  const revoked = reconnectState(reconnectFixture([], { status: 'revoked' }));
  check(() => assert.deepEqual(healthyThreeScope, {
    authorizationReconnectRequired: false,
    missingPublishingPermission: true,
    publishingReconnectRequired: true,
  }));
  check(() => assert.deepEqual(healthyFourScope, {
    authorizationReconnectRequired: false,
    missingPublishingPermission: false,
    publishingReconnectRequired: false,
  }));
  check(() => assert.equal(needsReauthorization.authorizationReconnectRequired, true));
  check(() => assert.equal(expired.authorizationReconnectRequired, true));
  check(() => assert.equal(emptyScopes.publishingReconnectRequired, true));
  check(() => assert.equal(unknownScopes.publishingReconnectRequired, true));
  check(() => assert.equal(revoked.publishingReconnectRequired, false));
  check(() => assert.match(socialConnectionsSource, /authorizationReconnectRequired \? 'warning-state' : 'connected-state'/));
  check(() => assert.match(socialConnectionsSource, /authorizationReconnectRequired \? 'Needs reauthorization' : 'Connected'/));
  check(() => assert.match(socialConnectionsSource, /<ScopeList scopes=\{value\.grantedScopes\} \/>/));
  check(() => assert.match(socialConnectionsSource, /Facebook publishing permission is not enabled\. Reconnect Meta to add pages_manage_posts\./));
  check(() => assert.match(socialConnectionsSource, /authorizationReconnectRequired \|\| publishingReconnectRequired \? \([\s\S]*onClick=\{onReconnect\}[\s\S]*Reconnect Meta/));
  check(() => assert.match(socialConnectionsSource, /!authorizationReconnectRequired \? \([\s\S]*onClick=\{onCheck\}[\s\S]*Check connection/));
  check(() => assert.match(socialConnectionsSource, /onClick=\{onDisconnect\}[\s\S]*Disconnect Meta/));
  check(() => assert.match(socialConnectionsSource, /disabled=\{busy\} onClick=\{onReconnect\}/));
  check(() => assert.match(socialConnectionsSource, /disabled=\{busy\} onClick=\{onCheck\}/));
  check(() => assert.match(socialConnectionsSource, /disabled=\{busy\} onClick=\{onDisconnect\}/));
  check(() => assert.match(socialConnectionsSource, /openingMeta \? 'Opening Meta\.\.\.' : 'Reconnect Meta'/));
  check(() => assert.match(socialConnectionsSource, /onReconnect=\{connection\.start\}/));
  check(() => assert.doesNotMatch(socialConnectionsSource, /onReconnect=\{[^}]*disconnect|disconnect\([^)]*\)[\s\S]{0,160}connection\.start/));
  check(() => assert.match(contractsSource, /export const META_OAUTH_STATE_TTL_MS = 30 \* 60_000/));
  check(() => assert.match(contractsSource, /export const META_TOKEN_EXCHANGE_PHASES = Object\.freeze\(\[\s*'short_token_exchange',\s*'long_token_exchange',\s*\]\)/));
  check(() => assert.match(contractsSource, /export const META_PROVIDER_ERROR_CATEGORIES = Object\.freeze\(\[/));
  check(() => assert.match(contractsSource, /providerHttpStatus: safeInteger/));
  check(() => assert.match(contractsSource, /providerCategory: META_PROVIDER_ERROR_CATEGORIES\.includes/));
  check(() => assert.match(edgeSource, /stateTtlMs: META_OAUTH_STATE_TTL_MS/));
  check(() => assert.doesNotMatch(edgeSource, /stateTtlMs: 10 \* 60_000/));
  check(() => assert.match(serviceSource, /Math\.min\(META_OAUTH_STATE_TTL_MS, deps\.stateTtlMs\)/));
  check(() => assert.match(serviceSource, /returnDestinationForPath\(consumed\.return_path\)/));
  check(() => assert.match(serviceSource, /disconnectConnection/));
  check(() => assert.doesNotMatch(serviceSource, /provider\.revoke|providerRevokeSucceeded/));
  check(() => assert.doesNotMatch(providerSource, /DELETE|\/me\/permissions\?/));
  check(() => assert.match(providerSource, /MAX_PAGE_REQUESTS = 5/));
  check(() => assert.match(providerSource, /MAX_DISCOVERED_PAGES = 100/));
  check(() => assert.match(providerSource, /config_id: config\.loginConfigurationId/));
  check(() => assert.doesNotMatch(providerSource, /scope:/));
  check(() => assert.match(providerSource, /signal, 'short_token_exchange'/));
  check(() => assert.match(providerSource, /signal, 'long_token_exchange'/));
  check(() => assert.match(serviceSource, /META_TOKEN_EXCHANGE_PHASES\.includes\(error\?\.providerPhase\)/));
  check(() => assert.match(edgeSource, /\{ error: 'Meta connection request was rejected\.', code: normalized\.code \}/));
  check(() => assert.doesNotMatch(edgeSource, /providerPhase|providerHttpStatus|providerSubcode|providerCategory|providerIsTransient/));
  check(() => assert.match(edgeSource, /replace_company_social_connection/));
  check(() => assert.match(edgeSource, /disconnect_company_social_connection/));
  check(() => assert.match(edgeSource, /create_company_social_oauth_state_with_audit/));
  check(() => assert.match(edgeSource, /save_company_social_oauth_discovery_with_audit/));
  check(() => assert.match(edgeSource, /update_company_social_connection_health_with_audit/));
  check(() => assert.doesNotMatch(edgeSource, /from\(['"]audit_events['"]\)\.insert/));
  check(() => assert.doesNotMatch(serviceSource, /recordAudit\(/));
  check(() => assert.match(edgeSource, /if \(error\) throw new MetaConnectionError\('INTERNAL_ERROR'\)/));
  check(() => assert.match(edgeSource, /const jwt = requireBearerJwt\(authorization\)/));
  check(() => assert.match(edgeSource, /callerClient\.auth\.getUser\(jwt\)/));
  check(() => assert.match(edgeSource, /catch \{\s*throw new MetaConnectionError\('AUTH_REQUIRED'\);\s*\}/));
  check(() => assert.match(edgeSource, /domainUserId: String\(session\.user_id\)/));
  check(() => assert.match(edgeSource, /authUserId,/));
  check(() => assert.match(edgeSource, /actorAuthUserId: String\(session\.authUserId\)/));
  check(() => assert.match(edgeSource, /actorDomainUserId: String\(session\.domainUserId\)/));
  check(() => assert.doesNotMatch(edgeSource, /\bactorId:\s*String\(session\./));
  check(() => assert.doesNotMatch(edgeSource, /input\.actorId\b/));
  check(() => assert.doesNotMatch(serviceSource, /currentAccess\.actorId\b/));
  check(() => assert.match(serviceSource, /actorId: currentAccess\.actorAuthUserId/));
  check(() => assert.match(edgeSource, /p_actor_auth_user_id: input\.actorAuthUserId/g));
  check(() => assert.match(edgeSource, /p_actor_id: input\.actorAuthUserId/g));
  check(() => assert.doesNotMatch(serviceSource, /actorDomainUserId|domainUserId/));
  check(() => assert.doesNotMatch(edgeSource, /atob\(|\.split\(['"]\.['"]\).*sub|decode.*jwt/i));
  check(() => assert.doesNotMatch(edgeSource, /console\.[a-z]+\([^\n]*(authorization|jwt|authUserId|domainUserId)/i));
  check(() => assert.doesNotThrow(() => assertNoCanonicalPatchArtifacts(schemaSource)));
  const canonicalBlocks = extractMetaCanonicalBlocks(schemaSource);
  const migrationBlock = extractExactMarkedBlock(migrationSource, META_FOUNDATION_MARKERS);
  const lifecycleAuditMigrationBlock = extractExactMarkedBlock(lifecycleAuditMigrationSource, META_LIFECYCLE_MARKERS);
  const ttlMigrationBlock = extractExactMarkedBlock(ttlMigrationSource, META_OAUTH_STATE_TTL_MARKERS);
  check(() => assert.equal(normalizeSqlForParity(canonicalBlocks.foundation), normalizeSqlForParity(migrationBlock)));
  check(() => assert.equal(normalizeSqlForParity(canonicalBlocks.lifecycle), normalizeSqlForParity(lifecycleAuditMigrationBlock)));
  check(() => assert.equal(normalizeSqlForParity(canonicalBlocks.ttl), normalizeSqlForParity(ttlMigrationBlock)));

  const validCanonicalFixture = [
    META_FOUNDATION_MARKERS.begin,
    'select 1;',
    META_FOUNDATION_MARKERS.end,
    '',
    '-- blocks remain adjacent except for comments and whitespace',
    META_LIFECYCLE_MARKERS.begin,
    'select 2;',
    META_LIFECYCLE_MARKERS.end,
    '',
    META_OAUTH_STATE_TTL_MARKERS.begin,
    'select 3;',
    META_OAUTH_STATE_TTL_MARKERS.end,
  ].join('\n');
  const invalidCanonicalFixtures = [
    validCanonicalFixture.replace(META_FOUNDATION_MARKERS.begin, `+${META_FOUNDATION_MARKERS.begin}`),
    validCanonicalFixture.replace(META_FOUNDATION_MARKERS.begin, `${META_FOUNDATION_MARKERS.begin}\n${META_FOUNDATION_MARKERS.begin}`),
    validCanonicalFixture.replace(`${META_FOUNDATION_MARKERS.end}\n`, ''),
    validCanonicalFixture.replace(META_FOUNDATION_MARKERS.begin, ` ${META_FOUNDATION_MARKERS.begin}`),
    validCanonicalFixture.replace(META_FOUNDATION_MARKERS.begin, `${META_FOUNDATION_MARKERS.begin} trailing`),
    validCanonicalFixture.replace(META_OAUTH_STATE_TTL_MARKERS.begin, `+${META_OAUTH_STATE_TTL_MARKERS.begin}`),
    validCanonicalFixture.replace(META_OAUTH_STATE_TTL_MARKERS.begin, `${META_OAUTH_STATE_TTL_MARKERS.begin}\n${META_OAUTH_STATE_TTL_MARKERS.begin}`),
    validCanonicalFixture.replace(`${META_OAUTH_STATE_TTL_MARKERS.end}`, ''),
    [
      META_FOUNDATION_MARKERS.begin,
      META_LIFECYCLE_MARKERS.begin,
      META_FOUNDATION_MARKERS.end,
      META_LIFECYCLE_MARKERS.end,
      META_OAUTH_STATE_TTL_MARKERS.begin,
      META_OAUTH_STATE_TTL_MARKERS.end,
    ].join('\n'),
  ];
  check(() => assert.doesNotThrow(() => extractMetaCanonicalBlocks(validCanonicalFixture)));
  for (const fixture of invalidCanonicalFixtures) {
    check(() => assert.throws(
      () => extractMetaCanonicalBlocks(fixture),
      (error) => error?.code === 'CANONICAL_SCHEMA_MARKER_INVALID',
    ));
  }
  for (const rpc of [
    'create_company_social_oauth_state_with_audit',
    'save_company_social_oauth_discovery_with_audit',
    'update_company_social_connection_health_with_audit',
  ]) {
    check(() => assert.match(lifecycleAuditMigrationBlock, new RegExp(`create or replace function public\\.${rpc}`)));
  }
  check(() => assert.match(lifecycleAuditMigrationBlock, /resource_label, details/));
  check(() => assert.match(lifecycleAuditMigrationBlock, /'Meta authorization'/g));
  check(() => assert.match(lifecycleAuditMigrationBlock, /locked_connection\.facebook_page_name/));
  check(() => assert.doesNotMatch(lifecycleAuditMigrationBlock, /execute\s+(format|p_actor|p_resource)/i));
  check(() => assert.match(ttlMigrationBlock, /drop constraint company_social_oauth_states_expiry_check/));
  check(() => assert.match(ttlMigrationBlock, /add constraint company_social_oauth_states_expiry_check/));
  check(() => assert.doesNotMatch(ttlMigrationBlock, /if exists/i));
  check(() => assert.match(ttlMigrationBlock, /interval '30 minutes'/g));
  check(() => assert.doesNotMatch(ttlMigrationBlock, /interval '10 minutes'/));
  check(() => assert.match(ttlMigrationBlock, /revoke all on function public\.create_company_social_oauth_state_with_audit[\s\S]*from public/));
  check(() => assert.match(ttlMigrationBlock, /grant execute on function public\.create_company_social_oauth_state_with_audit[\s\S]*to service_role/));
  check(() => assert.match(migrationBlock, /company_social_connections_active_provider_unique/));
  check(() => assert.match(migrationBlock, /where status <> 'revoked'/));
  check(() => assert.match(migrationBlock, /token_envelope_shape_check/));
  check(() => assert.match(migrationBlock, /pending_envelope_shape_check/));
  check(() => assert.match(migrationBlock, /security definer[\s\S]*set search_path = ''/));
  check(() => assert.match(migrationBlock, /revoke all on function public\.replace_company_social_connection[\s\S]*authenticated/));
  check(() => assert.match(migrationBlock, /grant execute on function public\.replace_company_social_connection[\s\S]*service_role/));
  const canonicalAuditTable = extractCreateTable(schemaSource, 'audit_events');
  const runnerAuditTable = extractCreateTable(sqlRunnerSource, 'audit_events');
  const runnerCompaniesTable = extractCreateTable(sqlRunnerSource, 'companies');
  const replaceAudit = extractAuditInsert(extractFunction(migrationSource, 'replace_company_social_connection'));
  const disconnectAudit = extractAuditInsert(extractFunction(migrationSource, 'disconnect_company_social_connection'));
  check(() => assertRequiredWithoutDefault(canonicalAuditTable, 'resource_label', /text\s+not\s+null/i));
  check(() => assertRequiredWithoutDefault(runnerAuditTable, 'resource_label', /text\s+not\s+null/i));
  check(() => assertRequiredWithoutDefault(runnerCompaniesTable, 'owner_email', /text\s+not\s+null/i));
  check(() => assert.ok(replaceAudit.columns.includes('resource_type') && replaceAudit.columns.includes('resource_label')));
  check(() => assert.ok(disconnectAudit.columns.includes('resource_type') && disconnectAudit.columns.includes('resource_label')));
  check(() => assert.match(replaceAudit.statement, /p_facebook_page_name/));
  check(() => assert.match(disconnectAudit.statement, /disconnected\.facebook_page_name/));
  check(() => assert.doesNotMatch(`${replaceAudit.statement}\n${disconnectAudit.statement}`, /token_envelope|encrypted_pending|state_hash|access_token|ciphertext/i));
}

function extractReconnectExpressions(source) {
  const expression = (name) => {
    const match = source.match(new RegExp(`const ${name} = ([\\s\\S]*?);`));
    assert.ok(match, `${name} expression is missing`);
    return match[1];
  };
  return new Function('value', 'META_FACEBOOK_PUBLISHING_SCOPE', `
    const authorizationReconnectRequired = ${expression('authorizationReconnectRequired')};
    const missingPublishingPermission = ${expression('missingPublishingPermission')};
    const publishingReconnectRequired = ${expression('publishingReconnectRequired')};
    return { authorizationReconnectRequired, missingPublishingPermission, publishingReconnectRequired };
  `);
}

function reconnectFixture(grantedScopes, overrides = {}) {
  return {
    status: 'connected',
    tokenExpiryStatus: 'valid',
    grantedScopes,
    ...overrides,
  };
}

function makeProvider(pageBatches, options = {}) {
  const calls = [];
  let pageAttempt = 0;
  const provider = createMetaProvider({
    config,
    cryptoApi,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      const parsed = new URL(String(url));
      if (parsed.pathname.endsWith('/me/permissions')) {
        return response({ data: META_REQUESTED_SCOPES.map((permission) => ({ permission, status: 'granted' })) });
      }
      if (parsed.pathname.endsWith('/me/accounts')) {
        pageAttempt += 1;
        if (options.failFirstPageWith500 && pageAttempt === 1) return response({ error: { code: 2 } }, 500);
        const successfulIndex = options.failFirstPageWith500 ? pageAttempt - 2 : pageAttempt - 1;
        const batch = pageBatches[successfulIndex] ?? { data: [] };
        return response({
          data: batch.data,
          paging: batch.cursor ? { cursors: { after: batch.cursor }, next: 'https://attacker.example/untrusted' } : undefined,
        });
      }
      throw new Error(`Unexpected provider URL: ${url}`);
    },
  });
  return { provider, calls, accountCalls: () => calls.filter((call) => new URL(call.url).pathname.endsWith('/me/accounts')).length };
}

function makeExchangeProvider(steps) {
  const calls = [];
  let nextStep = 0;
  const provider = createMetaProvider({
    config,
    cryptoApi,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      const step = steps[nextStep++];
      if (!step) throw new Error('Unexpected synthetic token endpoint request');
      if (step.throw) throw new Error(step.throw);
      if (step.malformed) {
        return { ok: false, status: step.status, json: async () => { throw new Error('synthetic malformed response'); } };
      }
      return response(step.payload, step.status);
    },
  });
  return { provider, calls };
}

async function captureExchangeError(provider, signal = undefined) {
  try {
    await provider.exchangeCode({ code: 'synthetic-oauth-code', signal });
  } catch (error) {
    return error;
  }
  assert.fail('Expected token exchange to fail');
}

function assertSafeExchangeError(error, expected) {
  check(() => assert.equal(error.code, expected.code));
  check(() => assert.equal(error.providerPhase, expected.phase));
  check(() => assert.equal(error.providerHttpStatus, expected.status));
  check(() => assert.equal(error.providerCode, expected.providerCode));
  check(() => assert.equal(error.providerSubcode, expected.providerSubcode));
  check(() => assert.equal(error.providerCategory, expected.category));
  check(() => assert.equal(error.providerIsTransient, expected.transient));
  check(() => assert.equal(error.providerAttempts, expected.attempts));
  check(() => assert.ok(Object.keys(error).every((key) => [
    'name', 'code', 'status', 'providerPhase', 'providerHttpStatus', 'providerCode', 'providerSubcode',
    'providerCategory', 'providerIsTransient', 'providerAttempts',
  ].includes(key))));
}

function makeServiceDeps(repository, provider, overrides = {}) {
  const sessionKind = overrides.sessionKind ?? 'company';
  const actorRole = overrides.actorRole ?? (sessionKind === 'owner' ? 'owner' : 'manager');
  const domainUserId = overrides.domainUserId ?? (sessionKind === 'owner' ? platformDomainUserId : companyDomainUserId);
  const sessionCompanyId = overrides.sessionCompanyId ?? (sessionKind === 'company' ? companyId : null);
  return {
    auth: {
      resolveSession: async (authorization) => {
        requireBearerJwt(authorization);
        const authUserId = requireVerifiedAuthUserId(overrides.getUserResult ?? {
          data: { user: { id: overrides.authUserId ?? verifiedAuthUserId } },
          error: null,
        });
        const domainSession = requireActiveDomainSession({
          user_id: domainUserId,
          status: overrides.sessionStatus ?? 'active',
        }, overrides.sessionError ?? null);
        return {
          domainUserId: domainSession.user_id,
          authUserId,
          kind: sessionKind,
          role: actorRole,
          company_id: sessionCompanyId,
          name: 'Synthetic Manager',
        };
      },
      assertCompanyAccess: async (session, requestedCompanyId) => {
        if (overrides.accessAllowed === false) throw new MetaConnectionError('FORBIDDEN');
        assertMetaAccessRole(session, requestedCompanyId);
        return {
          actorAuthUserId: session.authUserId,
          actorDomainUserId: session.domainUserId,
          actorName: 'Synthetic Manager',
          actorRole,
          companyId: requestedCompanyId,
        };
      },
    },
    repository,
    provider: { ...provider },
    config: overrides.config ?? config,
    rateLimiter: createMetaRateLimiter({ now: () => repository.nowMs }),
    cryptoApi,
    maxBodyBytes: 32_768,
    stateTtlMs: overrides.stateTtlMs ?? META_OAUTH_STATE_TTL_MS,
    retentionCleanupLimit: 50,
    timeoutController: () => ({ signal: undefined, clear() {} }),
    now: () => repository.nowMs,
    newUuid: () => repository.nextUuid(),
    telemetry: { record: (event) => repository.telemetry.push(event) },
  };
}

function makeMemoryRepository() {
  let sequence = 600;
  const memory = {
    nowMs: Date.parse('2026-07-31T22:00:00.000Z'),
    states: new Map(),
    connections: new Map(),
    audits: [],
    auditRecords: [],
    telemetry: [],
    providerCalls: 0,
    failCleanup: false,
    failHealthUpdate: false,
    failAuditActions: new Set(),
    nextUuid() {
      sequence += 1;
      return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
    },
    async getOAuthStateScope(stateHash) {
      const row = [...this.states.values()].find((value) => value.stateHash === stateHash);
      return row ? { company_id: row.companyId } : null;
    },
    async createOAuthState(input) {
      const id = this.nextUuid();
      this.states.set(id, { id, ...input, consumedAt: null, envelope: null, assets: null });
      try {
        appendAudit(this, 'meta_connection_started', 'meta_social_authorization', 'Meta authorization', input.actorAuthUserId);
      } catch (error) {
        this.states.delete(id);
        throw error;
      }
      return { id };
    },
    async consumeOAuthState(input) {
      const row = [...this.states.values()].find((value) => value.stateHash === input.stateHash);
      if (!row || row.consumedAt || row.companyId !== input.companyId || row.actorAuthUserId !== input.actorAuthUserId || row.provider !== input.provider || row.redirectUri !== input.redirectUri || Date.parse(row.expiresAt) <= this.nowMs) return null;
      row.consumedAt = new Date(this.nowMs).toISOString();
      return dbState(row);
    },
    async classifyOAuthState(stateHash, requestedCompanyId, requestedActorAuthUserId) {
      const row = [...this.states.values()].find((value) => value.stateHash === stateHash);
      if (!row || row.companyId !== requestedCompanyId || row.actorAuthUserId !== requestedActorAuthUserId || row.provider !== META_PROVIDER) return 'OAUTH_STATE_INVALID';
      if (row.consumedAt) return 'OAUTH_STATE_REPLAYED';
      if (Date.parse(row.expiresAt) <= this.nowMs) return 'OAUTH_STATE_EXPIRED';
      return 'OAUTH_STATE_INVALID';
    },
    async saveOAuthDiscovery(input) {
      const row = this.states.get(input.oauthStateId);
      if (!row || row.companyId !== input.companyId || row.actorAuthUserId !== input.actorAuthUserId || !row.consumedAt || row.envelope || row.assets) {
        throw new MetaConnectionError('INTERNAL_ERROR');
      }
      row.envelope = input.envelope;
      row.assets = input.assets;
      try {
        appendAudit(this, 'meta_oauth_completed', 'meta_social_authorization', 'Meta authorization', input.actorAuthUserId);
      } catch (error) {
        row.envelope = null;
        row.assets = null;
        throw error;
      }
      return dbState(row);
    },
    async cleanupOAuthStates({ companyId: requestedCompanyId, provider, now, limit }) {
      if (this.failCleanup) throw new MetaConnectionError('INTERNAL_ERROR');
      let deleted = 0;
      for (const [id, row] of [...this.states.entries()].sort()) {
        if (deleted >= limit) break;
        if (row.companyId === requestedCompanyId && row.provider === provider && Date.parse(row.expiresAt) <= Date.parse(now)) {
          this.states.delete(id);
          deleted += 1;
        }
      }
      return deleted;
    },
    async getStatus(requestedCompanyId, requestedActorAuthUserId) {
      const connection = activeConnections(this, requestedCompanyId).at(-1) ?? null;
      const pending = [...this.states.values()].filter((row) => row.companyId === requestedCompanyId && row.actorAuthUserId === requestedActorAuthUserId && row.consumedAt && row.envelope && Date.parse(row.expiresAt) > this.nowMs).at(-1);
      return { connection, pending: pending ? dbState(pending) : null };
    },
    async getPendingOAuthSession(id, requestedCompanyId, requestedActorAuthUserId) {
      const row = this.states.get(id);
      return row && row.companyId === requestedCompanyId && row.actorAuthUserId === requestedActorAuthUserId && row.consumedAt ? dbState(row) : null;
    },
    async replaceConnection(input) {
      for (const row of this.connections.values()) {
        if (row.company_id === input.companyId && row.provider === input.provider && row.status !== 'revoked') {
          row.status = 'revoked';
          row.token_envelope = null;
          row.revoked_at = input.timestamp;
        }
      }
      const row = makeConnection(input.connectionId, input.companyId, input.asset.pageId, {
        asset: input.asset,
        envelope: input.tokenEnvelope,
        scopes: input.grantedScopes,
        actorAuthUserId: input.actorAuthUserId,
        timestamp: input.timestamp,
        tokenExpiresAt: input.tokenExpiresAt,
      });
      this.connections.set(row.id, row);
      for (const [id, state] of [...this.states]) if (state.companyId === input.companyId && state.provider === input.provider) this.states.delete(id);
      appendAudit(this, 'meta_asset_selected', 'meta_social_connection', row.facebook_page_name, input.actorAuthUserId);
      return row;
    },
    async deleteOAuthSession(id, requestedCompanyId, requestedActorAuthUserId) {
      const row = this.states.get(id);
      if (!row || row.companyId !== requestedCompanyId || row.actorAuthUserId !== requestedActorAuthUserId) throw new MetaConnectionError('INTERNAL_ERROR');
      this.states.delete(id);
    },
    async getConnection(id, requestedCompanyId) {
      const row = this.connections.get(id);
      return row?.company_id === requestedCompanyId ? row : null;
    },
    async updateHealth(input) {
      if (this.failHealthUpdate) throw new MetaConnectionError('INTERNAL_ERROR');
      const row = this.connections.get(input.connectionId);
      if (!row) throw new MetaConnectionError('INTERNAL_ERROR');
      const previous = structuredClone(row);
      Object.assign(row, {
        status: input.status,
        last_error_code: input.lastErrorCode,
        last_checked_at: input.checkedAt,
        granted_scopes: input.grantedScopes,
      });
      try {
        appendAudit(this, input.auditAction, 'meta_social_connection', previous.facebook_page_name, input.actorAuthUserId);
      } catch (error) {
        this.connections.set(row.id, previous);
        throw error;
      }
      return row;
    },
    async disconnectConnection(input) {
      const row = this.connections.get(input.connectionId);
      if (!row || row.company_id !== input.companyId || row.provider !== input.provider || row.status === 'revoked') return null;
      row.status = 'revoked';
      row.token_envelope = null;
      row.revoked_at = input.timestamp;
      for (const [id, state] of [...this.states]) if (state.companyId === input.companyId && state.provider === input.provider) this.states.delete(id);
      appendAudit(this, 'meta_connection_disconnected', 'meta_social_connection', row.facebook_page_name, input.actorAuthUserId);
      return row;
    },
  };
  return memory;
}

function appendAudit(memory, action, resourceType, resourceLabel, actorAuthUserId) {
  if (memory.failAuditActions.has(action)) throw new MetaConnectionError('INTERNAL_ERROR');
  memory.audits.push(action);
  memory.auditRecords.push({ action, resourceType, resourceLabel, actorAuthUserId });
}

async function createConnectedFixture(deps) {
  const start = await callService(deps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
  const state = new URL(start.authorizationUrl).searchParams.get('state');
  const complete = await callService(deps, { action: 'complete', code: 'code', state });
  const selected = await callService(deps, { action: 'select_asset', companyId, oauthSessionId: complete.oauthSessionId, pageId: complete.assets[0].pageId });
  return deps.repository.connections.get(selected.connection.id);
}

function addPending(memory, targetCompanyId, targetActorAuthUserId, id, { expiresAt = '2026-07-31T22:09:00.000Z' } = {}) {
  memory.states.set(id, {
    id,
    companyId: targetCompanyId,
    actorAuthUserId: targetActorAuthUserId,
    provider: META_PROVIDER,
    stateHash: `hash-${id}`,
    redirectUri: config.redirectUri,
    returnPath: '/settings/social-connections',
    expiresAt,
    consumedAt: '2026-07-31T22:00:00.000Z',
    envelope: { safe: true },
    assets: [],
  });
}

function makeConnection(id, targetCompanyId, pageId, options = {}) {
  const asset = options.asset ?? safePage(pageId);
  return {
    id,
    company_id: targetCompanyId,
    provider: META_PROVIDER,
    status: 'connected',
    facebook_page_id: pageId,
    facebook_page_name: asset.pageName,
    instagram_account_id: asset.instagram?.accountId ?? null,
    instagram_username: asset.instagram?.username ?? null,
    instagram_account_type: asset.instagram?.accountType ?? null,
    granted_scopes: options.scopes ?? [...META_REQUESTED_SCOPES],
    token_envelope: options.envelope ?? { synthetic: true },
    token_expires_at: options.tokenExpiresAt ?? '2026-08-30T00:00:00.000Z',
    connected_by: options.actorAuthUserId ?? verifiedAuthUserId,
    connected_at: options.timestamp ?? '2026-07-31T22:00:00.000Z',
    last_checked_at: null,
    last_error_code: null,
    revoked_at: null,
  };
}

function dbState(row) {
  return {
    id: row.id,
    company_id: row.companyId,
    actor_auth_user_id: row.actorAuthUserId,
    provider: row.provider,
    redirect_uri: row.redirectUri,
    return_path: row.returnPath,
    expires_at: row.expiresAt,
    consumed_at: row.consumedAt,
    encrypted_pending_token_bundle: row.envelope,
    discovered_assets: row.assets,
  };
}

function activeConnections(memory, targetCompanyId) {
  return [...memory.connections.values()].filter((row) => row.company_id === targetCompanyId && row.provider === META_PROVIDER && row.status !== 'revoked');
}

function companyStates(memory, targetCompanyId) {
  return [...memory.states.values()].filter((row) => row.companyId === targetCompanyId && row.provider === META_PROVIDER);
}

function safePage(pageId, linkedInstagram = false) {
  return {
    provider: META_PROVIDER,
    pageId,
    pageName: `Synthetic Page ${pageId}`,
    permittedTasks: ['MANAGE'],
    instagram: linkedInstagram ? { accountId: `${pageId}99`, username: `page_${pageId}`, accountType: 'BUSINESS' } : null,
    connectionEligibility: linkedInstagram ? 'facebook_and_instagram' : 'facebook_only',
    accessToken: `page-secret-${pageId}`,
  };
}

function rawPage(pageId) {
  return { id: pageId, name: `Page ${pageId}`, tasks: ['MANAGE'], access_token: `page-token-${pageId}` };
}

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function mutate(value) {
  const first = value[0] === 'A' ? 'B' : 'A';
  return first + value.slice(1);
}

function extractCreateTable(source, tableName) {
  const match = source.match(new RegExp(`create table (?:public\\.)?${tableName}\\s*\\([\\s\\S]*?\\n\\s*\\);`, 'i'));
  assert.ok(match, `${tableName} table definition is missing`);
  return match[0];
}

function extractFunction(source, functionName) {
  const match = source.match(new RegExp(`create or replace function public\\.${functionName}\\([\\s\\S]*?\\n\\$\\$;`, 'i'));
  assert.ok(match, `${functionName} function definition is missing`);
  return match[0];
}

function extractAuditInsert(functionSource) {
  const match = functionSource.match(/insert into public\.audit_events\s*\(([\s\S]*?)\)\s*values\s*\(([\s\S]*?)\);/i);
  assert.ok(match, 'RPC audit insert is missing');
  return {
    statement: match[0],
    columns: match[1].split(',').map((column) => column.trim()),
  };
}

function assertRequiredWithoutDefault(tableSource, columnName, contract) {
  const line = tableSource.split('\n').find((candidate) => new RegExp(`^\\s*${columnName}\\s+`, 'i').test(candidate));
  assert.ok(line, `${columnName} is missing`);
  assert.match(line, contract);
  assert.doesNotMatch(line, /\bdefault\b/i);
}

function callService(deps, body) {
  return callServiceWithAuthorization(deps, body, `Bearer ${syntheticJwt}`);
}

function callServiceWithAuthorization(deps, body, authorization) {
  return handleMetaConnection({ rawBody: JSON.stringify(body), authorization, deps });
}
