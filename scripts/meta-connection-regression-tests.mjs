import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import {
  META_PROVIDER,
  META_REQUESTED_SCOPES,
  MetaConnectionError,
  normalizeReturnPath,
  runtimeConfigFromEnv,
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
import { createMetaProvider } from '../supabase/functions/_shared/meta-connection/provider.js';
import { createMetaRateLimiter } from '../supabase/functions/_shared/meta-connection/rateLimit.js';
import { handleMetaConnection } from '../supabase/functions/_shared/meta-connection/service.js';

const cryptoApi = globalThis.crypto ?? webcrypto;
const companyId = '00000000-0000-4000-8000-000000005501';
const otherCompanyId = '00000000-0000-4000-8000-000000005504';
const actorId = '00000000-0000-4000-8000-000000005502';
const managerBId = '00000000-0000-4000-8000-000000005503';
const encryptionKey = Buffer.alloc(32, 17).toString('base64');
const configValues = {
  META_APP_ID: '1234567890',
  META_APP_SECRET: 'server-only-app-secret',
  META_GRAPH_API_VERSION: 'v25.0',
  META_LOGIN_CONFIGURATION_ID: '9876543210',
  META_OAUTH_REDIRECT_URI: 'https://preview.example.test/auth/meta/callback',
  META_TOKEN_ENCRYPTION_KEY_V1: encryptionKey,
};
const config = runtimeConfigFromEnv((key) => configValues[key]);
let checks = 0;
const check = (fn) => { fn(); checks += 1; };
const checkAsync = async (fn) => { await fn(); checks += 1; };

configurationChecks();
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
    actorId,
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
    pendingEnvelopeContext({ ...pendingContext, actorId: managerBId }),
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
}

async function serviceChecks() {
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
  const completed = await callService(deps, { action: 'complete', code: 'provider-code', state: generatedState });
  check(() => assert.equal(completed.destination, 'social_connections'));
  check(() => assert.equal(completed.status, 'pending_asset_selection'));
  check(() => assert.equal(completed.assets.length, 2));
  check(() => assert.equal(JSON.stringify(completed).includes('user-secret'), false));

  const selected = await callService(deps, {
    action: 'select_asset', companyId, oauthSessionId: completed.oauthSessionId, pageId: '10001',
  });
  check(() => assert.equal(selected.connection.facebookPageId, '10001'));
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
  addPending(memory, companyId, managerBId, '00000000-0000-4000-8000-000000005799');
  addPending(memory, otherCompanyId, managerBId, '00000000-0000-4000-8000-000000005798');
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

  await retentionChecks(serviceProvider);
  await healthChecks(serviceProvider);
  await authorizationChecks(serviceProvider);
}

async function retentionChecks(provider) {
  const memory = makeMemoryRepository();
  addPending(memory, companyId, actorId, '00000000-0000-4000-8000-000000005810', { expiresAt: '2026-07-31T21:59:00.000Z' });
  addPending(memory, companyId, actorId, '00000000-0000-4000-8000-000000005811', { expiresAt: '2026-07-31T22:09:00.000Z' });
  addPending(memory, otherCompanyId, actorId, '00000000-0000-4000-8000-000000005812', { expiresAt: '2026-07-31T21:59:00.000Z' });
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
}

async function sourceAndSchemaChecks() {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const [accessSource, appSource, callbackSource, serviceSource, providerSource, edgeSource, migrationSource, schemaSource] = await Promise.all([
    read('src/features/company-portal/companySettingsAccess.ts'),
    read('src/App.tsx'),
    read('src/features/meta-connection/callback.ts'),
    read('supabase/functions/_shared/meta-connection/service.js'),
    read('supabase/functions/_shared/meta-connection/provider.js'),
    read('supabase/functions/meta-social-connection/index.ts'),
    read('supabase/migrations/20260731220000_meta_social_connection_foundation.sql'),
    read('supabase/schema.sql'),
  ]);
  check(() => assert.match(accessSource, /export function canManageCompanySettings/));
  check(() => assert.match(accessSource, /sessionKind === 'owner'.*platformRole === 'owner'/s));
  check(() => assert.match(appSource, /canManageCompanySettings\(\{/));
  check(() => assert.match(appSource, /destination === 'social_connections'.*view=onboarding#portal/s));
  check(() => assert.match(callbackSource, /replaceState\(null, '', META_CALLBACK_PATH\)/));
  check(() => assert.doesNotMatch(callbackSource, /localStorage|sessionStorage/));
  check(() => assert.match(serviceSource, /returnDestinationForPath\(consumed\.return_path\)/));
  check(() => assert.match(serviceSource, /disconnectConnection/));
  check(() => assert.doesNotMatch(serviceSource, /provider\.revoke|providerRevokeSucceeded/));
  check(() => assert.doesNotMatch(providerSource, /DELETE|\/me\/permissions\?/));
  check(() => assert.match(providerSource, /MAX_PAGE_REQUESTS = 5/));
  check(() => assert.match(providerSource, /MAX_DISCOVERED_PAGES = 100/));
  check(() => assert.match(providerSource, /config_id: config\.loginConfigurationId/));
  check(() => assert.doesNotMatch(providerSource, /scope:/));
  check(() => assert.match(edgeSource, /replace_company_social_connection/));
  check(() => assert.match(edgeSource, /disconnect_company_social_connection/));
  check(() => assert.match(edgeSource, /if \(error\) throw new MetaConnectionError\('INTERNAL_ERROR'\)/));
  const migrationBlock = extractSchemaBlock(migrationSource);
  const canonicalBlock = extractSchemaBlock(schemaSource);
  check(() => assert.equal(normalizeSql(canonicalBlock), normalizeSql(migrationBlock)));
  check(() => assert.match(migrationBlock, /company_social_connections_active_provider_unique/));
  check(() => assert.match(migrationBlock, /where status <> 'revoked'/));
  check(() => assert.match(migrationBlock, /token_envelope_shape_check/));
  check(() => assert.match(migrationBlock, /pending_envelope_shape_check/));
  check(() => assert.match(migrationBlock, /security definer[\s\S]*set search_path = ''/));
  check(() => assert.match(migrationBlock, /revoke all on function public\.replace_company_social_connection[\s\S]*authenticated/));
  check(() => assert.match(migrationBlock, /grant execute on function public\.replace_company_social_connection[\s\S]*service_role/));
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

function makeServiceDeps(repository, provider, overrides = {}) {
  const sessionKind = overrides.sessionKind ?? 'company';
  return {
    auth: {
      resolveSession: async () => ({ userId: actorId, kind: sessionKind }),
      assertCompanyAccess: async (_session, requestedCompanyId) => {
        if (overrides.accessAllowed === false || (sessionKind === 'company' && requestedCompanyId !== companyId)) {
          throw new MetaConnectionError('FORBIDDEN');
        }
        return {
          actorId,
          actorName: 'Synthetic Manager',
          actorRole: overrides.actorRole ?? (sessionKind === 'owner' ? 'owner' : 'Manager'),
          companyId: requestedCompanyId,
        };
      },
    },
    repository,
    provider: { ...provider },
    config: overrides.config ?? config,
    rateLimiter: createMetaRateLimiter({ now: () => Date.parse('2026-07-31T22:00:00.000Z') }),
    cryptoApi,
    maxBodyBytes: 32_768,
    stateTtlMs: 10 * 60_000,
    retentionCleanupLimit: 50,
    timeoutController: () => ({ signal: undefined, clear() {} }),
    now: () => Date.parse('2026-07-31T22:00:00.000Z'),
    newUuid: () => repository.nextUuid(),
    telemetry: { record: (event) => repository.telemetry.push(event) },
  };
}

function makeMemoryRepository() {
  let sequence = 600;
  const memory = {
    states: new Map(),
    connections: new Map(),
    audits: [],
    telemetry: [],
    providerCalls: 0,
    failCleanup: false,
    failHealthUpdate: false,
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
      return { id };
    },
    async consumeOAuthState(input) {
      const row = [...this.states.values()].find((value) => value.stateHash === input.stateHash);
      if (!row || row.consumedAt || row.companyId !== input.companyId || row.actorId !== input.actorId || row.provider !== input.provider || row.redirectUri !== input.redirectUri || Date.parse(row.expiresAt) <= Date.parse('2026-07-31T22:00:00.000Z')) return null;
      row.consumedAt = '2026-07-31T22:00:00.000Z';
      return dbState(row);
    },
    async classifyOAuthState(stateHash, requestedCompanyId, requestedActorId) {
      const row = [...this.states.values()].find((value) => value.stateHash === stateHash);
      if (!row || row.companyId !== requestedCompanyId || row.actorId !== requestedActorId || row.provider !== META_PROVIDER) return 'OAUTH_STATE_INVALID';
      if (row.consumedAt) return 'OAUTH_STATE_REPLAYED';
      if (Date.parse(row.expiresAt) <= Date.parse('2026-07-31T22:00:00.000Z')) return 'OAUTH_STATE_EXPIRED';
      return 'OAUTH_STATE_INVALID';
    },
    async saveOAuthDiscovery(id, requestedCompanyId, requestedActorId, envelope, assets) {
      const row = this.states.get(id);
      if (!row || row.companyId !== requestedCompanyId || row.actorId !== requestedActorId || !row.consumedAt) throw new MetaConnectionError('INTERNAL_ERROR');
      row.envelope = envelope;
      row.assets = assets;
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
    async getStatus(requestedCompanyId, requestedActorId) {
      const connection = activeConnections(this, requestedCompanyId).at(-1) ?? null;
      const pending = [...this.states.values()].filter((row) => row.companyId === requestedCompanyId && row.actorId === requestedActorId && row.consumedAt && row.envelope && Date.parse(row.expiresAt) > Date.parse('2026-07-31T22:00:00.000Z')).at(-1);
      return { connection, pending: pending ? dbState(pending) : null };
    },
    async getPendingOAuthSession(id, requestedCompanyId, requestedActorId) {
      const row = this.states.get(id);
      return row && row.companyId === requestedCompanyId && row.actorId === requestedActorId && row.consumedAt ? dbState(row) : null;
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
        actorId: input.actorId,
        timestamp: input.timestamp,
        tokenExpiresAt: input.tokenExpiresAt,
      });
      this.connections.set(row.id, row);
      for (const [id, state] of [...this.states]) if (state.companyId === input.companyId && state.provider === input.provider) this.states.delete(id);
      this.audits.push('meta_asset_selected');
      return row;
    },
    async deleteOAuthSession(id, requestedCompanyId, requestedActorId) {
      const row = this.states.get(id);
      if (!row || row.companyId !== requestedCompanyId || row.actorId !== requestedActorId) throw new MetaConnectionError('INTERNAL_ERROR');
      this.states.delete(id);
    },
    async getConnection(id, requestedCompanyId) {
      const row = this.connections.get(id);
      return row?.company_id === requestedCompanyId ? row : null;
    },
    async updateHealth(id, input) {
      if (this.failHealthUpdate) throw new MetaConnectionError('INTERNAL_ERROR');
      const row = this.connections.get(id);
      if (!row) throw new MetaConnectionError('INTERNAL_ERROR');
      Object.assign(row, {
        status: input.status,
        last_error_code: input.lastErrorCode,
        last_checked_at: input.checkedAt,
        granted_scopes: input.grantedScopes,
      });
      return row;
    },
    async disconnectConnection(input) {
      const row = this.connections.get(input.connectionId);
      if (!row || row.company_id !== input.companyId || row.provider !== input.provider || row.status === 'revoked') return null;
      row.status = 'revoked';
      row.token_envelope = null;
      row.revoked_at = input.timestamp;
      for (const [id, state] of [...this.states]) if (state.companyId === input.companyId && state.provider === input.provider) this.states.delete(id);
      this.audits.push('meta_connection_disconnected');
      return row;
    },
    async recordAudit(input) { this.audits.push(input.event); },
  };
  return memory;
}

async function createConnectedFixture(deps) {
  const start = await callService(deps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
  const state = new URL(start.authorizationUrl).searchParams.get('state');
  const complete = await callService(deps, { action: 'complete', code: 'code', state });
  const selected = await callService(deps, { action: 'select_asset', companyId, oauthSessionId: complete.oauthSessionId, pageId: complete.assets[0].pageId });
  return deps.repository.connections.get(selected.connection.id);
}

function addPending(memory, targetCompanyId, targetActorId, id, { expiresAt = '2026-07-31T22:09:00.000Z' } = {}) {
  memory.states.set(id, {
    id,
    companyId: targetCompanyId,
    actorId: targetActorId,
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
    connected_by: options.actorId ?? actorId,
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
    actor_auth_user_id: row.actorId,
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

function extractSchemaBlock(source) {
  const match = source.match(/-- META_SOCIAL_CONNECTION_SCHEMA_BEGIN[\s\S]*?-- META_SOCIAL_CONNECTION_SCHEMA_END/);
  assert.ok(match, 'Meta schema parity block is missing');
  return match[0];
}

function normalizeSql(value) {
  return value.replace(/\r/g, '').replace(/\s+/g, ' ').trim();
}

function callService(deps, body) {
  return handleMetaConnection({ rawBody: JSON.stringify(body), authorization: 'Bearer synthetic-session', deps });
}
