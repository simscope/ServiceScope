import {
  META_OAUTH_STATE_TTL_MS,
  META_PROVIDER,
  META_REQUESTED_SCOPES,
  META_TOKEN_EXCHANGE_PHASES,
  MetaConnectionError,
  assertRequiredScopes,
  assertRuntimeConfigured,
  normalizeProviderErrorFields,
  normalizeReturnPath,
  optionalUuid,
  parseActionRequest,
  requireShortString,
  requireUuid,
  returnDestinationForPath,
  safeAsset,
  safeConnection,
  safePending,
  safeTelemetry,
} from './contracts.js';
import {
  connectionEnvelopeContext,
  decryptTokenBundle,
  encryptTokenBundle,
  generateOAuthState,
  hashOAuthState,
  pendingEnvelopeContext,
} from './crypto.js';

const REAUTHORIZATION_CODES = new Set([
  'META_TOKEN_INVALID',
  'META_PERMISSION_MISSING',
  'META_PAGE_UNAVAILABLE',
  'META_INSTAGRAM_ACCOUNT_MISMATCH',
  'CONNECTION_NEEDS_REAUTHORIZATION',
]);
const TRANSIENT_PROVIDER_CODES = new Set([
  'META_RATE_LIMITED',
  'META_PROVIDER_TIMEOUT',
  'META_PROVIDER_UNAVAILABLE',
  'OAUTH_PROVIDER_ERROR',
]);

export async function handleMetaConnection({ rawBody, authorization, deps }) {
  const startedAt = deps.now();
  let action = 'unknown';
  let stage = 'request';
  let attempts = 0;
  try {
    if (!authorization?.startsWith('Bearer ')) throw new MetaConnectionError('AUTH_REQUIRED');
    const body = parseActionRequest(rawBody, deps.maxBodyBytes);
    action = body.action;
    stage = 'authorization';
    const session = await deps.auth.resolveSession(authorization);

    let stateHash = null;
    let requestedCompanyId = optionalUuid(body.companyId);
    if (action === 'complete') {
      const state = requireShortString(body.state, 512);
      stateHash = await hashOAuthState(state, deps.cryptoApi);
      const scope = await deps.repository.getOAuthStateScope(stateHash);
      if (!scope) throw new MetaConnectionError('OAUTH_STATE_INVALID');
      requestedCompanyId = scope.company_id;
    }
    if (!requestedCompanyId) throw new MetaConnectionError('INVALID_REQUEST');
    const access = await deps.auth.assertCompanyAccess(session, requestedCompanyId, authorization);
    deps.rateLimiter.assert({ actorId: access.actorAuthUserId, companyId: access.companyId, action });

    if (action === 'status' || action === 'start') {
      stage = 'retention_cleanup';
      await deps.repository.cleanupOAuthStates({
        companyId: access.companyId,
        provider: META_PROVIDER,
        now: new Date(deps.now()).toISOString(),
        limit: deps.retentionCleanupLimit,
      });
    }

    const context = { body, access, stateHash };
    let result;
    if (action === 'status') result = await status(context);
    else if (action === 'start') result = await start(context);
    else if (action === 'complete') result = await complete(context);
    else if (action === 'select_asset') result = await selectAsset(context);
    else if (action === 'check_health') result = await checkHealth(context);
    else if (action === 'disconnect') result = await disconnect(context);
    else throw new MetaConnectionError('INVALID_REQUEST');

    deps.telemetry.record(safeTelemetry({ action, success: true, code: 'OK', stage: 'complete', attempts, latencyMs: deps.now() - startedAt }));
    return result;

    async function status({ access: currentAccess }) {
      stage = 'status';
      const snapshot = await deps.repository.getStatus(currentAccess.companyId, currentAccess.actorAuthUserId);
      return {
        ok: true,
        provider: META_PROVIDER,
        configured: deps.config.configured,
        graphApiVersion: deps.config.configured ? deps.config.graphApiVersion : null,
        requestedScopes: META_REQUESTED_SCOPES,
        connection: safeConnection(snapshot.connection),
        pending: safePending(snapshot.pending),
      };
    }

    async function start({ body: requestBody, access: currentAccess }) {
      stage = 'oauth_state';
      const config = assertRuntimeConfigured(deps.config);
      const returnPath = normalizeReturnPath(requestBody.returnPath);
      if (!Number.isFinite(deps.stateTtlMs) || deps.stateTtlMs <= 0) {
        throw new MetaConnectionError('INTERNAL_ERROR');
      }
      const boundedStateTtlMs = Math.min(META_OAUTH_STATE_TTL_MS, deps.stateTtlMs);
      const timestamp = deps.now();
      const state = generateOAuthState(32, deps.cryptoApi);
      const hash = await hashOAuthState(state, deps.cryptoApi);
      await deps.repository.createOAuthState({
        companyId: currentAccess.companyId,
        actorAuthUserId: currentAccess.actorAuthUserId,
        actorName: currentAccess.actorName,
        actorRole: currentAccess.actorRole,
        provider: META_PROVIDER,
        stateHash: hash,
        redirectUri: config.redirectUri,
        returnPath,
        expiresAt: new Date(timestamp + boundedStateTtlMs).toISOString(),
        timestamp: new Date(timestamp).toISOString(),
      });
      return { ok: true, provider: META_PROVIDER, authorizationUrl: deps.provider.buildAuthorizationUrl({ state }) };
    }

    async function complete({ body: requestBody, access: currentAccess, stateHash: hash }) {
      stage = 'state_consume';
      const config = assertRuntimeConfigured(deps.config);
      const consumed = await deps.repository.consumeOAuthState({
        stateHash: hash,
        companyId: currentAccess.companyId,
        actorAuthUserId: currentAccess.actorAuthUserId,
        provider: META_PROVIDER,
        redirectUri: config.redirectUri,
      });
      if (!consumed) {
        const reason = await deps.repository.classifyOAuthState(hash, currentAccess.companyId, currentAccess.actorAuthUserId);
        throw new MetaConnectionError(reason);
      }
      try {
        if (normalizeProviderErrorFields(requestBody)) throw new MetaConnectionError('OAUTH_PROVIDER_ERROR');
        const code = requireShortString(requestBody.code, 4096);
        stage = 'code_exchange';
        const controller = deps.timeoutController(config.timeoutMs);
        try {
          const token = await deps.provider.exchangeCode({ code, signal: controller.signal });
          stage = 'asset_discovery';
          const discovery = await deps.provider.discover({ userAccessToken: token.accessToken, signal: controller.signal });
          attempts = providerAttempts(discovery, attempts);
          const grantedScopes = assertRequiredScopes(discovery.grantedScopes);
          if (!Array.isArray(discovery.pages) || discovery.pages.length === 0) throw new MetaConnectionError('META_NO_PAGES');
          const assets = discovery.pages.map((page) => safeAsset(page));
          const pendingBundle = {
            schemaVersion: 'meta-pending-token-bundle-v1',
            userAccessToken: token.accessToken,
            userTokenExpiresAt: token.expiresAt,
            grantedScopes,
            pages: discovery.pages.map((page) => ({ pageId: page.pageId, pageAccessToken: page.accessToken })),
          };
          const envelope = await encryptTokenBundle(
            pendingBundle,
            config.encryptionKey,
            pendingEnvelopeContext({
              companyId: currentAccess.companyId,
              actorId: currentAccess.actorAuthUserId,
              oauthStateId: consumed.id,
              redirectUri: consumed.redirect_uri,
            }),
            deps.cryptoApi,
          );
          await deps.repository.saveOAuthDiscovery({
            oauthStateId: consumed.id,
            companyId: currentAccess.companyId,
            actorAuthUserId: currentAccess.actorAuthUserId,
            actorName: currentAccess.actorName,
            actorRole: currentAccess.actorRole,
            provider: META_PROVIDER,
            envelope,
            assets,
            timestamp: new Date(deps.now()).toISOString(),
          });
          return {
            ok: true,
            provider: META_PROVIDER,
            status: 'pending_asset_selection',
            destination: returnDestinationForPath(consumed.return_path),
            oauthSessionId: consumed.id,
            assets,
          };
        } finally {
          controller.clear();
        }
      } catch (error) {
        attempts = providerAttempts(error, attempts);
        if (stage === 'code_exchange' && META_TOKEN_EXCHANGE_PHASES.includes(error?.providerPhase)) {
          stage = error.providerPhase;
        }
        await deps.repository.deleteOAuthSession(consumed.id, currentAccess.companyId, currentAccess.actorAuthUserId);
        throw error;
      }
    }

    async function selectAsset({ body: requestBody, access: currentAccess }) {
      stage = 'asset_selection';
      const config = assertRuntimeConfigured(deps.config);
      const oauthSessionId = requireUuid(requestBody.oauthSessionId);
      const pageId = requireShortString(requestBody.pageId, 40);
      const pending = await deps.repository.getPendingOAuthSession(oauthSessionId, currentAccess.companyId, currentAccess.actorAuthUserId);
      if (!pending || Date.parse(pending.expires_at) <= deps.now()) throw new MetaConnectionError('OAUTH_STATE_EXPIRED');
      const assets = Array.isArray(pending.discovered_assets) ? pending.discovered_assets.map(safeAsset) : [];
      const selected = assets.find((asset) => asset.pageId === pageId);
      if (!selected) throw new MetaConnectionError('META_ASSET_NOT_FOUND');
      const pendingBundle = await decryptTokenBundle(
        pending.encrypted_pending_token_bundle,
        config.encryptionKey,
        pendingEnvelopeContext({
          companyId: currentAccess.companyId,
          actorId: currentAccess.actorAuthUserId,
          oauthStateId: pending.id,
          redirectUri: pending.redirect_uri,
        }),
        deps.cryptoApi,
      );
      const pageToken = Array.isArray(pendingBundle.pages)
        ? pendingBundle.pages.find((page) => page?.pageId === pageId)?.pageAccessToken
        : null;
      if (typeof pendingBundle.userAccessToken !== 'string' || typeof pageToken !== 'string') {
        throw new MetaConnectionError('CONNECTION_NEEDS_REAUTHORIZATION');
      }
      const connectionId = deps.newUuid();
      const tokenEnvelope = await encryptTokenBundle({
        schemaVersion: 'meta-connection-token-bundle-v1',
        userAccessToken: pendingBundle.userAccessToken,
        pageAccessToken: pageToken,
      }, config.encryptionKey, connectionEnvelopeContext({
        companyId: currentAccess.companyId,
        connectionId,
        pageId,
      }), deps.cryptoApi);
      const connection = await deps.repository.replaceConnection({
        connectionId,
        companyId: currentAccess.companyId,
        actorAuthUserId: currentAccess.actorAuthUserId,
        actorName: currentAccess.actorName,
        actorRole: currentAccess.actorRole,
        provider: META_PROVIDER,
        asset: selected,
        grantedScopes: assertRequiredScopes(pendingBundle.grantedScopes),
        tokenEnvelope,
        tokenExpiresAt: pendingBundle.userTokenExpiresAt ?? null,
        timestamp: new Date(deps.now()).toISOString(),
      });
      return { ok: true, connection: safeConnection(connection) };
    }

    async function checkHealth({ body: requestBody, access: currentAccess }) {
      stage = 'health';
      const config = assertRuntimeConfigured(deps.config);
      const connectionId = requireUuid(requestBody.connectionId);
      const connection = await deps.repository.getConnection(connectionId, currentAccess.companyId);
      if (!connection) throw new MetaConnectionError('CONNECTION_NOT_FOUND');
      if (!connection.token_envelope || connection.status === 'revoked') throw new MetaConnectionError('CONNECTION_NEEDS_REAUTHORIZATION');

      let health;
      try {
        if (connection.token_expires_at && Date.parse(connection.token_expires_at) <= deps.now()) {
          throw new MetaConnectionError('CONNECTION_NEEDS_REAUTHORIZATION');
        }
        const tokenBundle = await decryptTokenBundle(
          connection.token_envelope,
          config.encryptionKey,
          connectionEnvelopeContext({
            companyId: currentAccess.companyId,
            connectionId: connection.id,
            pageId: connection.facebook_page_id,
          }),
          deps.cryptoApi,
        );
        const controller = deps.timeoutController(config.timeoutMs);
        try {
          health = await deps.provider.checkHealth({
            userAccessToken: requireToken(tokenBundle.userAccessToken),
            pageAccessToken: requireToken(tokenBundle.pageAccessToken),
            pageId: connection.facebook_page_id,
            instagramAccountId: connection.instagram_account_id,
            signal: controller.signal,
          });
          attempts = providerAttempts(health, attempts);
        } finally {
          controller.clear();
        }
        const grantedScopes = assertRequiredScopes(health.grantedScopes);
        if (!health.pageAvailable) throw new MetaConnectionError('META_PAGE_UNAVAILABLE');
        const updated = await deps.repository.updateHealth({
          connectionId: connection.id,
          companyId: currentAccess.companyId,
          actorAuthUserId: currentAccess.actorAuthUserId,
          actorName: currentAccess.actorName,
          actorRole: currentAccess.actorRole,
          provider: META_PROVIDER,
          status: 'connected',
          lastErrorCode: null,
          grantedScopes,
          checkedAt: new Date(deps.now()).toISOString(),
          auditAction: 'meta_health_checked',
        });
        return { ok: true, connection: safeConnection(updated) };
      } catch (error) {
        attempts = providerAttempts(error, attempts);
        const normalized = normalizeError(error);
        if (normalized.code === 'INTERNAL_ERROR') throw normalized;
        const reauthorize = REAUTHORIZATION_CODES.has(normalized.code);
        if (!reauthorize && !TRANSIENT_PROVIDER_CODES.has(normalized.code)) throw normalized;
        const auditAction = reauthorize ? 'meta_connection_needs_reauthorization' : 'meta_health_checked';
        const updated = await deps.repository.updateHealth({
          connectionId: connection.id,
          companyId: currentAccess.companyId,
          actorAuthUserId: currentAccess.actorAuthUserId,
          actorName: currentAccess.actorName,
          actorRole: currentAccess.actorRole,
          provider: META_PROVIDER,
          status: reauthorize ? 'needs_reauthorization' : connection.status,
          lastErrorCode: normalized.code,
          grantedScopes: connection.granted_scopes,
          checkedAt: new Date(deps.now()).toISOString(),
          auditAction,
        });
        return { ok: false, code: normalized.code, connection: safeConnection(updated) };
      }
    }

    async function disconnect({ body: requestBody, access: currentAccess }) {
      stage = 'disconnect';
      const connectionId = requireUuid(requestBody.connectionId);
      const connection = await deps.repository.disconnectConnection({
        connectionId,
        companyId: currentAccess.companyId,
        actorAuthUserId: currentAccess.actorAuthUserId,
        actorName: currentAccess.actorName,
        actorRole: currentAccess.actorRole,
        provider: META_PROVIDER,
        timestamp: new Date(deps.now()).toISOString(),
      });
      if (!connection) throw new MetaConnectionError('CONNECTION_NOT_FOUND');
      return { ok: true, status: 'revoked' };
    }

  } catch (error) {
    attempts = providerAttempts(error, attempts);
    const normalized = normalizeError(error);
    deps.telemetry.record(safeTelemetry({
      action,
      success: false,
      code: normalized.code,
      stage,
      attempts,
      latencyMs: deps.now() - startedAt,
      providerPhase: normalized.providerPhase,
      providerHttpStatus: normalized.providerHttpStatus,
      providerCode: normalized.providerCode,
      providerSubcode: normalized.providerSubcode,
      providerCategory: normalized.providerCategory,
      providerIsTransient: normalized.providerIsTransient,
    }));
    throw normalized;
  }
}

export function normalizeError(error) {
  if (error instanceof MetaConnectionError) return error;
  const code = typeof error?.message === 'string' ? error.message : '';
  if (code === 'AUTH_REQUIRED' || code === 'FORBIDDEN') return new MetaConnectionError(code);
  return new MetaConnectionError('INTERNAL_ERROR');
}

export function createTimeoutController(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

function providerAttempts(value, fallback) {
  const count = Number(value?.attempts ?? value?.providerAttempts);
  return Number.isInteger(count) ? Math.max(fallback, count) : fallback;
}

function requireToken(value) {
  if (typeof value !== 'string' || !value || value.length > 4096) {
    throw new MetaConnectionError('CONNECTION_NEEDS_REAUTHORIZATION');
  }
  return value;
}
