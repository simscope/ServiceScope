import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import {
  META_PROVIDER,
  META_REQUESTED_SCOPES,
  MetaConnectionError,
  normalizeReturnPath,
  runtimeConfigFromEnv,
  safeAsset,
} from '../supabase/functions/_shared/meta-connection/contracts.js';
import {
  assertEnvelope,
  decryptTokenBundle,
  encryptTokenBundle,
  generateOAuthState,
  hashOAuthState,
} from '../supabase/functions/_shared/meta-connection/crypto.js';
import { appSecretProof, createMetaProvider } from '../supabase/functions/_shared/meta-connection/provider.js';
import { createMetaRateLimiter } from '../supabase/functions/_shared/meta-connection/rateLimit.js';
import { handleMetaConnection } from '../supabase/functions/_shared/meta-connection/service.js';

const cryptoApi = globalThis.crypto ?? webcrypto;
const companyId = '00000000-0000-4000-8000-000000005501';
const actorId = '00000000-0000-4000-8000-000000005502';
const otherActorId = '00000000-0000-4000-8000-000000005503';
const encryptionKey = Buffer.alloc(32, 17).toString('base64');
const configValues = {
  META_APP_ID: '1234567890',
  META_APP_SECRET: 'server-only-app-secret',
  META_GRAPH_API_VERSION: 'v25.0',
  META_OAUTH_REDIRECT_URI: 'https://preview.example.test/auth/meta/callback',
  META_TOKEN_ENCRYPTION_KEY_V1: encryptionKey,
};
let checks = 0;
const check = (fn) => { fn(); checks += 1; };
const checkAsync = async (fn) => { await fn(); checks += 1; };

const config = runtimeConfigFromEnv((key) => configValues[key]);
check(() => assert.equal(config.configured, true));
check(() => assert.equal(config.graphApiVersion, 'v25.0'));
check(() => assert.equal(runtimeConfigFromEnv((key) => ({ ...configValues, META_GRAPH_API_VERSION: 'latest' })[key]).configured, false));
check(() => assert.equal(runtimeConfigFromEnv((key) => ({ ...configValues, META_APP_SECRET: '' })[key]).configured, false));
check(() => assert.equal(runtimeConfigFromEnv((key) => ({ ...configValues, META_OAUTH_REDIRECT_URI: 'https://preview.example.test/other' })[key]).configured, false));
check(() => assert.equal(runtimeConfigFromEnv((key) => ({ ...configValues, META_OAUTH_REDIRECT_URI: 'https://preview.example.test/auth/meta/callback?next=https://attacker.example' })[key]).configured, false));
check(() => assert.equal(META_PROVIDER, 'meta-facebook-login'));
check(() => assert.deepEqual(META_REQUESTED_SCOPES, ['pages_show_list', 'pages_read_engagement', 'instagram_basic']));
check(() => assert.equal(normalizeReturnPath('/settings/social-connections'), '/settings/social-connections'));
check(() => assert.throws(() => normalizeReturnPath('https://attacker.example/return'), /INVALID_REQUEST/));
check(() => assert.throws(() => normalizeReturnPath('//attacker.example'), /INVALID_REQUEST/));
await checkAsync(() => assert.rejects(
  handleMetaConnection({
    rawBody: JSON.stringify({ action: 'status', companyId, unexpectedAuthorizationValue: 'blocked' }),
    authorization: 'Bearer synthetic-session',
    deps: makeServiceDeps(makeMemoryRepository(), { buildAuthorizationUrl() {} }),
  }),
  (error) => error.code === 'INVALID_REQUEST',
));

const stateA = generateOAuthState(32, cryptoApi);
const stateB = generateOAuthState(32, cryptoApi);
check(() => assert.notEqual(stateA, stateB));
check(() => assert.ok(stateA.length >= 43));
const stateHash = await hashOAuthState(stateA, cryptoApi);
check(() => assert.match(stateHash, /^\\x[0-9a-f]{64}$/));
check(() => assert.ok(!stateHash.includes(stateA)));
await checkAsync(() => assert.rejects(hashOAuthState('short', cryptoApi), /OAUTH_STATE_INVALID/));

const secretBundle = { schemaVersion: 'test-bundle-v1', secretValue: 'sensitive-test-value' };
const envelopeA = await encryptTokenBundle(secretBundle, encryptionKey, cryptoApi);
const envelopeB = await encryptTokenBundle(secretBundle, encryptionKey, cryptoApi);
check(() => assert.equal(envelopeA.schemaVersion, 'encrypted-social-token-v1'));
check(() => assert.equal(envelopeA.algorithm, 'AES-GCM'));
check(() => assert.equal(envelopeA.keyVersion, 1));
check(() => assert.notEqual(envelopeA.iv, envelopeB.iv));
check(() => assert.notEqual(envelopeA.ciphertext, envelopeB.ciphertext));
check(() => assert.ok(!JSON.stringify(envelopeA).includes(secretBundle.secretValue)));
const decryptedBundle = await decryptTokenBundle(envelopeA, encryptionKey, cryptoApi);
check(() => assert.deepEqual(decryptedBundle, secretBundle));
await checkAsync(() => assert.rejects(decryptTokenBundle(envelopeA, Buffer.alloc(32, 18).toString('base64'), cryptoApi), /CONNECTION_NEEDS_REAUTHORIZATION/));
await checkAsync(() => assert.rejects(decryptTokenBundle({ ...envelopeA, keyVersion: 2 }, encryptionKey, cryptoApi), /CONNECTION_NEEDS_REAUTHORIZATION/));
await checkAsync(() => assert.rejects(decryptTokenBundle({ ...envelopeA, ciphertext: envelopeA.ciphertext.slice(0, -2) + 'aa' }, encryptionKey, cryptoApi), /CONNECTION_NEEDS_REAUTHORIZATION/));
check(() => assert.doesNotThrow(() => assertEnvelope(envelopeA)));

const facebookOnly = safeAsset({ pageId: '101', pageName: 'Service Page', tasks: ['ANALYZE'] });
check(() => assert.equal(facebookOnly.connectionEligibility, 'facebook_only'));
const linkedAsset = safeAsset({
  pageId: '102',
  pageName: 'Service Page Two',
  tasks: ['ANALYZE', 'CREATE_CONTENT'],
  instagram: { accountId: '202', username: 'service.page', accountType: 'BUSINESS' },
});
check(() => assert.equal(linkedAsset.connectionEligibility, 'facebook_and_instagram'));
check(() => assert.equal(linkedAsset.instagram.username, 'service.page'));
check(() => assert.throws(() => safeAsset({ pageId: 'bad-id', pageName: 'Page' }), /OAUTH_PROVIDER_ERROR/));

const providerCalls = [];
const provider = createMetaProvider({
  config,
  cryptoApi,
  fetchImpl: async (url, init) => {
    providerCalls.push({ url: String(url), init });
    if (String(url).endsWith('/oauth/access_token')) {
      const body = new URLSearchParams(init.body);
      return Response.json({ access_token: body.has('code') ? 'short-user-value' : 'long-user-value', expires_in: 3600 });
    }
    if (String(url).includes('/me/permissions')) {
      return Response.json({ data: META_REQUESTED_SCOPES.map((permission) => ({ permission, status: 'granted' })) });
    }
    if (String(url).includes('/me/accounts')) {
      return Response.json({ data: [{
        id: '101', name: 'Service Page', tasks: ['ANALYZE'], access_token: 'page-value',
        instagram_business_account: { id: '202', username: 'service.page', account_type: 'BUSINESS' },
      }] });
    }
    if (init.method === 'DELETE') return Response.json({ success: true });
    return Response.json({ id: '101', name: 'Service Page', instagram_business_account: { id: '202' } });
  },
});
const authorizationUrl = new URL(provider.buildAuthorizationUrl({ state: stateA }));
check(() => assert.equal(authorizationUrl.hostname, 'www.facebook.com'));
check(() => assert.equal(authorizationUrl.pathname, '/v25.0/dialog/oauth'));
check(() => assert.deepEqual(authorizationUrl.searchParams.get('scope').split(','), META_REQUESTED_SCOPES));
check(() => assert.equal(authorizationUrl.searchParams.get('state'), stateA));
check(() => assert.equal(authorizationUrl.searchParams.has('pages_manage_posts'), false));
const exchanged = await provider.exchangeCode({ code: 'authorization-code-value' });
check(() => assert.equal(exchanged.accessToken, 'long-user-value'));
const discovery = await provider.discover({ userAccessToken: exchanged.accessToken });
check(() => assert.equal(discovery.pages.length, 1));
check(() => assert.equal(discovery.pages[0].instagram.username, 'service.page'));
check(() => assert.deepEqual(discovery.grantedScopes, META_REQUESTED_SCOPES));
check(() => assert.ok(providerCalls.every((call) => !call.url.includes('long-user-value') && !call.url.includes('page-value'))));
check(() => assert.ok(providerCalls.some((call) => call.url.includes('appsecret_proof='))));
check(() => assert.ok(providerCalls.some((call) => call.init.headers?.Authorization === 'Bearer long-user-value')));
const proof = await appSecretProof('value', 'secret', cryptoApi);
check(() => assert.equal(proof.length, 64));

const limiter = createMetaRateLimiter({ windowMs: 60_000, now: () => 1000 });
for (let index = 0; index < 10; index += 1) limiter.assert({ actorId, companyId, action: 'start' });
check(() => assert.throws(() => limiter.assert({ actorId, companyId, action: 'start' }), /META_RATE_LIMITED/));
limiter.clear();
check(() => assert.doesNotThrow(() => limiter.assert({ actorId, companyId, action: 'start' })));

const memory = makeMemoryRepository();
const serviceProvider = {
  buildAuthorizationUrl: ({ state }) => `https://www.facebook.com/v25.0/dialog/oauth?state=${encodeURIComponent(state)}`,
  exchangeCode: async () => ({ accessToken: 'user-value', expiresAt: '2026-08-01T00:00:00.000Z' }),
  discover: async () => ({
    grantedScopes: [...META_REQUESTED_SCOPES],
    pages: [{ ...linkedAsset, accessToken: 'page-value' }, { ...facebookOnly, accessToken: 'page-two-value' }],
  }),
  checkHealth: async () => ({ grantedScopes: [...META_REQUESTED_SCOPES], pageAvailable: true }),
  revoke: async () => true,
};
const deps = makeServiceDeps(memory, serviceProvider);
const startResult = await callService(deps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
const generatedState = new URL(startResult.authorizationUrl).searchParams.get('state');
check(() => assert.ok(generatedState));
check(() => assert.equal(memory.states.size, 1));
check(() => assert.ok([...memory.states.keys()][0] !== generatedState));
check(() => assert.ok(JSON.stringify([...memory.states.values()]).includes(generatedState) === false));
check(() => assert.ok([...memory.states.values()][0].expiresAt - deps.now() <= 10 * 60_000));

const completeResult = await callService(deps, { action: 'complete', code: 'provider-code', state: generatedState });
check(() => assert.equal(completeResult.status, 'pending_asset_selection'));
check(() => assert.equal(completeResult.assets.length, 2));
check(() => assert.equal(JSON.stringify(completeResult).includes('user-value'), false));
check(() => assert.equal(JSON.stringify(completeResult).includes('page-value'), false));
await checkAsync(() => assert.rejects(
  callService(deps, { action: 'complete', code: 'provider-code', state: generatedState }),
  (error) => error.code === 'OAUTH_STATE_REPLAYED',
));
await checkAsync(() => assert.rejects(
  callService(deps, { action: 'select_asset', companyId, oauthSessionId: completeResult.oauthSessionId, pageId: '999' }),
  (error) => error.code === 'META_ASSET_NOT_FOUND',
));
const selection = await callService(deps, {
  action: 'select_asset', companyId, oauthSessionId: completeResult.oauthSessionId, pageId: linkedAsset.pageId,
});
check(() => assert.equal(selection.connection.facebookPageName, linkedAsset.pageName));
check(() => assert.equal(selection.connection.instagramUsername, linkedAsset.instagram.username));
check(() => assert.equal(JSON.stringify(selection).includes('page-value'), false));
check(() => assert.equal(memory.states.size, 0));
check(() => assert.equal(memory.connections.size, 1));

const health = await callService(deps, { action: 'check_health', companyId, connectionId: selection.connection.id });
check(() => assert.equal(health.ok, true));
check(() => assert.equal(health.connection.status, 'connected'));
const disconnected = await callService(deps, { action: 'disconnect', companyId, connectionId: selection.connection.id });
check(() => assert.equal(disconnected.status, 'revoked'));
check(() => assert.equal(disconnected.providerRevokeSucceeded, true));
check(() => assert.equal([...memory.connections.values()][0].token_envelope, null));
await checkAsync(() => assert.rejects(
  callService(deps, { action: 'check_health', companyId, connectionId: selection.connection.id }),
  (error) => error.code === 'CONNECTION_NEEDS_REAUTHORIZATION',
));
check(() => assert.ok(memory.audits.includes('meta_connection_started')));
check(() => assert.ok(memory.audits.includes('meta_oauth_completed')));
check(() => assert.ok(memory.audits.includes('meta_asset_selected')));
check(() => assert.ok(memory.audits.includes('meta_health_checked')));
check(() => assert.ok(memory.audits.includes('meta_connection_disconnected')));
check(() => assert.ok(memory.telemetry.every((event) => !JSON.stringify(event).includes('user-value'))));

await stateFailureChecks();
await providerFailureChecks();

const revokeFailureMemory = makeMemoryRepository();
const revokeFailureDeps = makeServiceDeps(revokeFailureMemory, { ...serviceProvider, revoke: async () => { throw new Error('raw provider detail'); } });
const revokeStart = await callService(revokeFailureDeps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
const revokeState = new URL(revokeStart.authorizationUrl).searchParams.get('state');
const revokeComplete = await callService(revokeFailureDeps, { action: 'complete', code: 'code', state: revokeState });
const revokeSelection = await callService(revokeFailureDeps, { action: 'select_asset', companyId, oauthSessionId: revokeComplete.oauthSessionId, pageId: linkedAsset.pageId });
const revokeResult = await callService(revokeFailureDeps, { action: 'disconnect', companyId, connectionId: revokeSelection.connection.id });
check(() => assert.equal(revokeResult.providerRevokeSucceeded, false));
check(() => assert.equal([...revokeFailureMemory.connections.values()][0].token_envelope, null));

const accessSource = await readFile(new URL('../src/features/company-portal/companySettingsAccess.ts', import.meta.url), 'utf8');
const callbackSource = await readFile(new URL('../src/features/meta-connection/callback.ts', import.meta.url), 'utf8');
const callbackPageSource = await readFile(new URL('../src/features/meta-connection/MetaOAuthCallbackPage.tsx', import.meta.url), 'utf8');
const restrictedPageSource = await readFile(new URL('../src/features/company-voice/CompanyVoiceSettingsPage.tsx', import.meta.url), 'utf8');
const onboardingSource = await readFile(new URL('../src/components/portal/OnboardingPage.tsx', import.meta.url), 'utf8');
const vercelSource = await readFile(new URL('../vercel.json', import.meta.url), 'utf8');
check(() => assert.match(accessSource, /sessionRole === 'Admin'/));
check(() => assert.match(accessSource, /sessionRole === 'Manager'.*staffRole === 'manager'.*staffStatus === 'active'/s));
check(() => assert.match(callbackSource, /history\.replaceState\(null, '', '\/#portal'\)/));
check(() => assert.doesNotMatch(callbackSource, /localStorage|sessionStorage/));
check(() => assert.doesNotMatch(callbackPageSource, /\{\s*callback\.(code|state)\s*\}|JSON\.stringify\(callback\)/));
check(() => assert.match(restrictedPageSource, /SocialConnectionsPanel/));
check(() => assert.match(onboardingSource, /!settingsReadOnly \? <SocialConnectionsPanel/));
check(() => assert.deepEqual(JSON.parse(vercelSource).rewrites, [{ source: '/auth/meta/callback', destination: '/index.html' }]));

console.log(`Meta connection regression checks passed: ${checks}`);

async function callService(deps, body) {
  return handleMetaConnection({ rawBody: JSON.stringify(body), authorization: 'Bearer synthetic-session', deps });
}

function makeServiceDeps(repository, providerValue) {
  let nowValue = Date.parse('2026-07-31T22:00:00.000Z');
  return {
    auth: {
      resolveSession: async () => ({ user_id: actorId, company_id: companyId, kind: 'company', role: 'manager', status: 'active' }),
      assertCompanyAccess: async (session, requestedCompanyId) => {
        if (session.company_id !== requestedCompanyId) throw new MetaConnectionError('FORBIDDEN');
        return { actorId: session.user_id, actorName: 'Synthetic Manager', actorRole: session.role, companyId: requestedCompanyId };
      },
    },
    repository,
    provider: providerValue,
    config,
    rateLimiter: createMetaRateLimiter(),
    cryptoApi,
    maxBodyBytes: 32_768,
    stateTtlMs: 10 * 60_000,
    timeoutController: () => ({ signal: undefined, clear() {} }),
    now: () => nowValue,
    advance: (milliseconds) => { nowValue += milliseconds; },
    telemetry: { record: (event) => repository.telemetry.push(event) },
  };
}

function makeMemoryRepository() {
  const states = new Map();
  const connections = new Map();
  const audits = [];
  const telemetry = [];
  let stateCounter = 1;
  let connectionCounter = 1;
  const repository = {
    states, connections, audits, telemetry,
    async getOAuthStateScope(hash) {
      const row = states.get(hash);
      return row ? { company_id: row.companyId } : null;
    },
    async createOAuthState(input) {
      states.set(input.stateHash, { ...input, id: uuidFor(stateCounter++), expiresAt: Date.parse(input.expiresAt), consumedAt: null });
    },
    async consumeOAuthState(input) {
      const row = states.get(input.stateHash);
      if (!row || row.consumedAt || row.companyId !== input.companyId || row.actorId !== input.actorId || row.provider !== input.provider || row.redirectUri !== input.redirectUri || row.expiresAt <= Date.parse('2026-07-31T22:00:00.000Z')) return null;
      row.consumedAt = Date.now();
      return row;
    },
    async classifyOAuthState(hash, requestedCompanyId, requestedActorId) {
      const row = states.get(hash);
      if (!row || row.companyId !== requestedCompanyId || row.actorId !== requestedActorId || row.provider !== META_PROVIDER) return 'OAUTH_STATE_INVALID';
      if (row.consumedAt) return 'OAUTH_STATE_REPLAYED';
      if (row.expiresAt <= Date.parse('2026-07-31T22:00:00.000Z')) return 'OAUTH_STATE_EXPIRED';
      return 'OAUTH_STATE_INVALID';
    },
    async saveOAuthDiscovery(id, envelope, assets) {
      const row = [...states.values()].find((candidate) => candidate.id === id);
      row.envelope = envelope;
      row.assets = assets;
    },
    async getStatus(requestedCompanyId, requestedActorId) {
      return {
        connection: [...connections.values()].find((row) => row.company_id === requestedCompanyId && row.status !== 'revoked') ?? null,
        pending: [...states.values()].find((row) => row.companyId === requestedCompanyId && row.actorId === requestedActorId && row.envelope) ? mapPending([...states.values()].find((row) => row.companyId === requestedCompanyId && row.actorId === requestedActorId && row.envelope)) : null,
      };
    },
    async getPendingOAuthSession(id, requestedCompanyId, requestedActorId) {
      const row = [...states.values()].find((candidate) => candidate.id === id && candidate.companyId === requestedCompanyId && candidate.actorId === requestedActorId);
      return row ? mapPending(row, true) : null;
    },
    async saveConnection(input) {
      const id = uuidFor(100 + connectionCounter++);
      const row = {
        id, company_id: input.companyId, provider: META_PROVIDER, status: 'connected',
        facebook_page_id: input.asset.pageId, facebook_page_name: input.asset.pageName,
        instagram_account_id: input.asset.instagram?.accountId ?? null,
        instagram_username: input.asset.instagram?.username ?? null,
        instagram_account_type: input.asset.instagram?.accountType ?? null,
        granted_scopes: input.grantedScopes, token_envelope: input.tokenEnvelope,
        token_expires_at: input.tokenExpiresAt, connected_at: '2026-07-31T22:00:00.000Z',
        last_checked_at: null, last_error_code: null,
      };
      connections.set(id, row);
      return row;
    },
    async deleteOAuthSession(id) {
      for (const [hash, row] of states) if (row.id === id) states.delete(hash);
    },
    async getConnection(id, requestedCompanyId) {
      const row = connections.get(id);
      return row?.company_id === requestedCompanyId ? row : null;
    },
    async updateHealth(id, input) {
      const row = connections.get(id);
      Object.assign(row, { status: input.status, last_checked_at: input.checkedAt, last_error_code: input.lastErrorCode, granted_scopes: input.grantedScopes });
      return row;
    },
    async revokeConnection(id, timestamp) {
      Object.assign(connections.get(id), { status: 'revoked', token_envelope: null, revoked_at: timestamp });
    },
    async deletePendingOAuthSessions(requestedCompanyId, requestedActorId) {
      for (const [hash, row] of states) if (row.companyId === requestedCompanyId && row.actorId === requestedActorId) states.delete(hash);
    },
    async recordAudit(input) { audits.push(input.event); },
  };
  return repository;
}

function mapPending(row, includeEnvelope = false) {
  return {
    id: row.id,
    expires_at: new Date(row.expiresAt).toISOString(),
    discovered_assets: row.assets,
    ...(includeEnvelope ? { encrypted_pending_token_bundle: row.envelope } : {}),
  };
}

function uuidFor(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

async function stateFailureChecks() {
  const expiredMemory = makeMemoryRepository();
  const expiredDeps = makeServiceDeps(expiredMemory, serviceProvider);
  const expiredStart = await callService(expiredDeps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
  const expiredState = new URL(expiredStart.authorizationUrl).searchParams.get('state');
  [...expiredMemory.states.values()][0].expiresAt = expiredDeps.now() - 1;
  await checkAsync(() => assert.rejects(
    callService(expiredDeps, { action: 'complete', code: 'code', state: expiredState }),
    (error) => error.code === 'OAUTH_STATE_EXPIRED',
  ));

  const actorMemory = makeMemoryRepository();
  const actorDeps = makeServiceDeps(actorMemory, serviceProvider);
  const actorStart = await callService(actorDeps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
  const actorState = new URL(actorStart.authorizationUrl).searchParams.get('state');
  actorDeps.auth.resolveSession = async () => ({ user_id: otherActorId, company_id: companyId, kind: 'company', role: 'manager', status: 'active' });
  await checkAsync(() => assert.rejects(
    callService(actorDeps, { action: 'complete', code: 'code', state: actorState }),
    (error) => error.code === 'OAUTH_STATE_INVALID',
  ));

  const companyMemory = makeMemoryRepository();
  const companyDeps = makeServiceDeps(companyMemory, serviceProvider);
  const companyStart = await callService(companyDeps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
  const companyState = new URL(companyStart.authorizationUrl).searchParams.get('state');
  companyDeps.auth.resolveSession = async () => ({ user_id: actorId, company_id: uuidFor(999), kind: 'company', role: 'manager', status: 'active' });
  await checkAsync(() => assert.rejects(
    callService(companyDeps, { action: 'complete', code: 'code', state: companyState }),
    (error) => error.code === 'FORBIDDEN',
  ));

  for (const mutate of [
    (row) => { row.provider = 'wrong-provider'; },
    (row) => { row.redirectUri = 'https://preview.example.test/wrong-callback'; },
  ]) {
    const scopedMemory = makeMemoryRepository();
    const scopedDeps = makeServiceDeps(scopedMemory, serviceProvider);
    const scopedStart = await callService(scopedDeps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
    const scopedState = new URL(scopedStart.authorizationUrl).searchParams.get('state');
    mutate([...scopedMemory.states.values()][0]);
    await checkAsync(() => assert.rejects(
      callService(scopedDeps, { action: 'complete', code: 'code', state: scopedState }),
      (error) => error.code === 'OAUTH_STATE_INVALID',
    ));
  }

  const errorMemory = makeMemoryRepository();
  const errorDeps = makeServiceDeps(errorMemory, { ...serviceProvider, exchangeCode: async () => { throw new Error('must not run'); } });
  const errorStart = await callService(errorDeps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
  const errorState = new URL(errorStart.authorizationUrl).searchParams.get('state');
  await checkAsync(() => assert.rejects(
    callService(errorDeps, { action: 'complete', state: errorState, providerError: 'access_denied' }),
    (error) => error.code === 'OAUTH_PROVIDER_ERROR',
  ));
}

async function providerFailureChecks() {
  const malformedProvider = createMetaProvider({
    config,
    cryptoApi,
    fetchImpl: async () => Response.json({}, { status: 200 }),
  });
  await checkAsync(() => assert.rejects(
    malformedProvider.exchangeCode({ code: 'code' }),
    (error) => error.code === 'OAUTH_CODE_EXCHANGE_FAILED',
  ));

  for (const { providerValue, expectedCode } of [
    {
      providerValue: { ...serviceProvider, discover: async () => ({ grantedScopes: ['pages_show_list'], pages: [{ ...linkedAsset, accessToken: 'page-value' }] }) },
      expectedCode: 'META_PERMISSION_MISSING',
    },
    {
      providerValue: { ...serviceProvider, discover: async () => ({ grantedScopes: [...META_REQUESTED_SCOPES], pages: [] }) },
      expectedCode: 'META_NO_PAGES',
    },
  ]) {
    const failureMemory = makeMemoryRepository();
    const failureDeps = makeServiceDeps(failureMemory, providerValue);
    const failureStart = await callService(failureDeps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
    const failureState = new URL(failureStart.authorizationUrl).searchParams.get('state');
    await checkAsync(() => assert.rejects(
      callService(failureDeps, { action: 'complete', code: 'code', state: failureState }),
      (error) => error.code === expectedCode,
    ));
    const code = failureMemory.telemetry.at(-1)?.code;
    check(() => assert.equal(code, expectedCode));
  }

  const healthMemory = makeMemoryRepository();
  const healthDeps = makeServiceDeps(healthMemory, serviceProvider);
  const healthStart = await callService(healthDeps, { action: 'start', companyId, returnPath: '/settings/social-connections' });
  const healthState = new URL(healthStart.authorizationUrl).searchParams.get('state');
  const healthComplete = await callService(healthDeps, { action: 'complete', code: 'code', state: healthState });
  const healthSelection = await callService(healthDeps, { action: 'select_asset', companyId, oauthSessionId: healthComplete.oauthSessionId, pageId: linkedAsset.pageId });
  healthDeps.provider.checkHealth = async () => { throw new MetaConnectionError('META_TOKEN_INVALID'); };
  const invalidHealth = await callService(healthDeps, { action: 'check_health', companyId, connectionId: healthSelection.connection.id });
  check(() => assert.equal(invalidHealth.ok, false));
  check(() => assert.equal(invalidHealth.code, 'META_TOKEN_INVALID'));
  check(() => assert.equal(invalidHealth.connection.status, 'needs_reauthorization'));
}
