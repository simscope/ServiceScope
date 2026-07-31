import {
  META_PROVIDER,
  META_REQUESTED_SCOPES,
  MetaConnectionError,
  assertRequiredScopes,
  assertRuntimeConfigured,
  normalizeProviderErrorFields,
  normalizeReturnPath,
  optionalUuid,
  parseActionRequest,
  requireShortString,
  requireUuid,
  safeAsset,
  safeConnection,
  safePending,
  safeTelemetry,
} from './contracts.js';
import {
  decryptTokenBundle,
  encryptTokenBundle,
  generateOAuthState,
  hashOAuthState,
} from './crypto.js';

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
    deps.rateLimiter.assert({ actorId: access.actorId, companyId: access.companyId, action });

    const context = { body, access, stateHash };
    let result;
    if (action === 'status') result = await status(context);
    else if (action === 'start') result = await start(context);
    else if (action === 'complete') {
      attempts = 1;
      result = await complete(context);
    } else if (action === 'select_asset') result = await selectAsset(context);
    else if (action === 'check_health') {
      attempts = 1;
      result = await checkHealth(context);
    } else if (action === 'disconnect') {
      attempts = 1;
      result = await disconnect(context);
    } else throw new MetaConnectionError('INVALID_REQUEST');

    deps.telemetry.record(safeTelemetry({ action, success: true, code: 'OK', stage: 'complete', attempts, latencyMs: deps.now() - startedAt }));
    return result;

    async function status({ access: currentAccess }) {
      stage = 'status';
      const snapshot = await deps.repository.getStatus(currentAccess.companyId, currentAccess.actorId);
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
      const state = generateOAuthState(32, deps.cryptoApi);
      const hash = await hashOAuthState(state, deps.cryptoApi);
      await deps.repository.createOAuthState({
        companyId: currentAccess.companyId,
        actorId: currentAccess.actorId,
        provider: META_PROVIDER,
        stateHash: hash,
        redirectUri: config.redirectUri,
        returnPath,
        expiresAt: new Date(deps.now() + Math.min(10 * 60_000, deps.stateTtlMs)).toISOString(),
      });
      await recordAudit('meta_connection_started', currentAccess, null);
      return { ok: true, provider: META_PROVIDER, authorizationUrl: deps.provider.buildAuthorizationUrl({ state }) };
    }

    async function complete({ body: requestBody, access: currentAccess, stateHash: hash }) {
      stage = 'state_consume';
      const config = assertRuntimeConfigured(deps.config);
      const consumed = await deps.repository.consumeOAuthState({
        stateHash: hash,
        companyId: currentAccess.companyId,
        actorId: currentAccess.actorId,
        provider: META_PROVIDER,
        redirectUri: config.redirectUri,
      });
      if (!consumed) {
        const reason = await deps.repository.classifyOAuthState(hash, currentAccess.companyId, currentAccess.actorId);
        throw new MetaConnectionError(reason);
      }
      if (normalizeProviderErrorFields(requestBody)) throw new MetaConnectionError('OAUTH_PROVIDER_ERROR');
      const code = requireShortString(requestBody.code, 4096);
      stage = 'code_exchange';
      const controller = deps.timeoutController(config.timeoutMs);
      try {
        const token = await deps.provider.exchangeCode({ code, signal: controller.signal });
        stage = 'asset_discovery';
        const discovery = await deps.provider.discover({ userAccessToken: token.accessToken, signal: controller.signal });
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
        const envelope = await encryptTokenBundle(pendingBundle, config.encryptionKey, deps.cryptoApi);
        await deps.repository.saveOAuthDiscovery(consumed.id, envelope, assets);
        await recordAudit('meta_oauth_completed', currentAccess, null);
        return {
          ok: true,
          provider: META_PROVIDER,
          status: 'pending_asset_selection',
          oauthSessionId: consumed.id,
          assets,
        };
      } finally {
        controller.clear();
      }
    }

    async function selectAsset({ body: requestBody, access: currentAccess }) {
      stage = 'asset_selection';
      const config = assertRuntimeConfigured(deps.config);
      const oauthSessionId = requireUuid(requestBody.oauthSessionId);
      const pageId = requireShortString(requestBody.pageId, 40);
      const pending = await deps.repository.getPendingOAuthSession(oauthSessionId, currentAccess.companyId, currentAccess.actorId);
      if (!pending || Date.parse(pending.expires_at) <= deps.now()) throw new MetaConnectionError('OAUTH_STATE_EXPIRED');
      const assets = Array.isArray(pending.discovered_assets) ? pending.discovered_assets.map(safeAsset) : [];
      const selected = assets.find((asset) => asset.pageId === pageId);
      if (!selected) throw new MetaConnectionError('META_ASSET_NOT_FOUND');
      const pendingBundle = await decryptTokenBundle(pending.encrypted_pending_token_bundle, config.encryptionKey, deps.cryptoApi);
      const pageToken = Array.isArray(pendingBundle.pages)
        ? pendingBundle.pages.find((page) => page?.pageId === pageId)?.pageAccessToken
        : null;
      if (typeof pendingBundle.userAccessToken !== 'string' || typeof pageToken !== 'string') {
        throw new MetaConnectionError('CONNECTION_NEEDS_REAUTHORIZATION');
      }
      const tokenEnvelope = await encryptTokenBundle({
        schemaVersion: 'meta-connection-token-bundle-v1',
        userAccessToken: pendingBundle.userAccessToken,
        pageAccessToken: pageToken,
      }, config.encryptionKey, deps.cryptoApi);
      const connection = await deps.repository.saveConnection({
        companyId: currentAccess.companyId,
        actorId: currentAccess.actorId,
        asset: selected,
        grantedScopes: assertRequiredScopes(pendingBundle.grantedScopes),
        tokenEnvelope,
        tokenExpiresAt: pendingBundle.userTokenExpiresAt ?? null,
      });
      await deps.repository.deleteOAuthSession(oauthSessionId, currentAccess.companyId, currentAccess.actorId);
      await recordAudit('meta_asset_selected', currentAccess, connection.id);
      return { ok: true, connection: safeConnection(connection) };
    }

    async function checkHealth({ body: requestBody, access: currentAccess }) {
      stage = 'health';
      const config = assertRuntimeConfigured(deps.config);
      const connectionId = requireUuid(requestBody.connectionId);
      const connection = await deps.repository.getConnection(connectionId, currentAccess.companyId);
      if (!connection) throw new MetaConnectionError('CONNECTION_NOT_FOUND');
      if (!connection.token_envelope || connection.status === 'revoked') throw new MetaConnectionError('CONNECTION_NEEDS_REAUTHORIZATION');
      try {
        const tokenBundle = await decryptTokenBundle(connection.token_envelope, config.encryptionKey, deps.cryptoApi);
        const controller = deps.timeoutController(config.timeoutMs);
        try {
          const health = await deps.provider.checkHealth({
            userAccessToken: requireToken(tokenBundle.userAccessToken),
            pageAccessToken: requireToken(tokenBundle.pageAccessToken),
            pageId: connection.facebook_page_id,
            instagramAccountId: connection.instagram_account_id,
            signal: controller.signal,
          });
          const grantedScopes = assertRequiredScopes(health.grantedScopes);
          if (!health.pageAvailable) throw new MetaConnectionError('CONNECTION_NEEDS_REAUTHORIZATION');
          const updated = await deps.repository.updateHealth(connection.id, {
            status: 'connected',
            lastErrorCode: null,
            grantedScopes,
            checkedAt: new Date(deps.now()).toISOString(),
          });
          await recordAudit('meta_health_checked', currentAccess, connection.id);
          return { ok: true, connection: safeConnection(updated) };
        } finally {
          controller.clear();
        }
      } catch (error) {
        const normalized = normalizeError(error);
        const updated = await deps.repository.updateHealth(connection.id, {
          status: 'needs_reauthorization',
          lastErrorCode: normalized.code,
          grantedScopes: connection.granted_scopes,
          checkedAt: new Date(deps.now()).toISOString(),
        });
        await recordAudit('meta_connection_needs_reauthorization', currentAccess, connection.id);
        return { ok: false, code: normalized.code, connection: safeConnection(updated) };
      }
    }

    async function disconnect({ body: requestBody, access: currentAccess }) {
      stage = 'disconnect';
      const config = assertRuntimeConfigured(deps.config);
      const connectionId = requireUuid(requestBody.connectionId);
      const connection = await deps.repository.getConnection(connectionId, currentAccess.companyId);
      if (!connection) throw new MetaConnectionError('CONNECTION_NOT_FOUND');
      let providerRevokeSucceeded = false;
      try {
        if (connection.token_envelope) {
          const tokenBundle = await decryptTokenBundle(connection.token_envelope, config.encryptionKey, deps.cryptoApi);
          const controller = deps.timeoutController(config.timeoutMs);
          try {
            providerRevokeSucceeded = await deps.provider.revoke({
              userAccessToken: requireToken(tokenBundle.userAccessToken),
              signal: controller.signal,
            });
          } finally {
            controller.clear();
          }
        }
      } catch {
        providerRevokeSucceeded = false;
      } finally {
        await deps.repository.revokeConnection(connection.id, new Date(deps.now()).toISOString());
        await deps.repository.deletePendingOAuthSessions(currentAccess.companyId, currentAccess.actorId);
      }
      await recordAudit('meta_connection_disconnected', currentAccess, connection.id);
      return { ok: true, status: 'revoked', providerRevokeSucceeded };
    }

    async function recordAudit(event, currentAccess, connectionId) {
      await deps.repository.recordAudit({
        event,
        companyId: currentAccess.companyId,
        actorId: currentAccess.actorId,
        actorName: currentAccess.actorName,
        actorRole: currentAccess.actorRole,
        connectionId,
      });
    }
  } catch (error) {
    const normalized = normalizeError(error);
    deps.telemetry.record(safeTelemetry({ action, success: false, code: normalized.code, stage, attempts, latencyMs: deps.now() - startedAt }));
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

function requireToken(value) {
  if (typeof value !== 'string' || !value || value.length > 4096) {
    throw new MetaConnectionError('CONNECTION_NEEDS_REAUTHORIZATION');
  }
  return value;
}
