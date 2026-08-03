import { buildPrivateValues } from '../content-engine/context.js';
import { connectionEnvelopeContext, decryptTokenBundle } from '../meta-connection/crypto.js';
import {
  MetaPublishingError,
  assertExplicitApproval,
  facebookPublishingEnabled,
  normalizeApprovedMessage,
  parsePublishingRequest,
  requireUuid,
  safePublicationResult,
  safePublishingStatus,
  safePublishingTelemetry,
} from './contracts.js';
import { assertPublicationPrivacy } from './privacy.js';

export async function handleMetaPublishing({ rawBody, authorization, deps }) {
  const startedAt = deps.now();
  let action = 'unknown';
  let stage = 'authorize';
  let attempts = 0;
  let diagnostic = {};
  try {
    const body = parsePublishingRequest(rawBody, deps.maxBodyBytes);
    action = body.action;
    const session = await deps.auth.resolveSession(authorization);
    const companyId = requireUuid(body.companyId);
    const access = await deps.auth.assertCompanyAccess(session, companyId);

    if (action === 'status') {
      const snapshot = await deps.repository.getStatus(companyId);
      const result = safePublishingStatus({ config: deps.config, ...snapshot });
      deps.telemetry.record(safePublishingTelemetry({ action, success: true, code: 'OK', stage, attempts, latencyMs: deps.now() - startedAt }));
      return result;
    }

    stage = 'validate_request';
    if (!deps.config.configured) throw new MetaPublishingError('META_PUBLISH_NOT_CONFIGURED');
    assertExplicitApproval(body.explicitApproval);
    const jobId = requireUuid(body.jobId);
    const idempotencyKey = requireUuid(body.idempotencyKey);
    const message = normalizeApprovedMessage(body.message);
    const publicationContext = await deps.repository.getPublicationContext(companyId, jobId);
    if (!publicationContext?.job || String(publicationContext.job.company_id) !== companyId) {
      throw new MetaPublishingError('FORBIDDEN');
    }
    if (!['Completed', 'Warranty'].includes(String(publicationContext.job.status))) {
      throw new MetaPublishingError('INVALID_REQUEST');
    }
    const connection = publicationContext.connection;
    if (!connection || connection.status !== 'connected') throw new MetaPublishingError('META_CONNECTION_NEEDS_REAUTHORIZATION');
    if (!facebookPublishingEnabled(connection)) throw new MetaPublishingError('META_PUBLISHING_PERMISSION_MISSING');

    stage = 'privacy_review';
    const privateValues = buildPrivateValues(publicationContext);
    assertPublicationPrivacy(message, privateValues);

    stage = 'decrypt_connection';
    let tokenBundle;
    try {
      tokenBundle = await decryptTokenBundle(
        connection.token_envelope,
        deps.config.encryptionKey,
        connectionEnvelopeContext({
          companyId,
          connectionId: connection.id,
          pageId: connection.facebook_page_id,
        }),
        deps.cryptoApi,
      );
    } catch {
      throw new MetaPublishingError('META_CONNECTION_NEEDS_REAUTHORIZATION');
    }
    const pageAccessToken = requirePageToken(tokenBundle?.pageAccessToken);

    stage = 'idempotency_begin';
    const messageSha256 = await sha256Hex(message, deps.cryptoApi);
    const timestamp = new Date(deps.now()).toISOString();
    const beginning = await deps.repository.beginPublication({
      publicationId: deps.newUuid(),
      companyId,
      connectionId: connection.id,
      jobId,
      idempotencyKey,
      message,
      messageSha256,
      actorAuthUserId: access.actorAuthUserId,
      actorName: access.actorName,
      actorRole: access.actorRole,
      timestamp,
    });

    if (!beginning.should_publish) {
      const result = duplicateResult(beginning);
      deps.telemetry.record(safePublishingTelemetry({ action, success: true, code: 'OK', stage, attempts, latencyMs: deps.now() - startedAt }));
      return result;
    }

    stage = 'facebook_publish';
    attempts = 1;
    const controller = deps.timeoutController(deps.config.timeoutMs);
    let providerResult;
    try {
      providerResult = await deps.provider.publishText({
        pageId: connection.facebook_page_id,
        pageAccessToken,
        message,
        signal: controller.signal,
      });
    } catch (error) {
      diagnostic = error?.diagnostic ?? {};
      if (error?.code === 'META_PUBLICATION_DELIVERY_UNKNOWN') {
        stage = 'persist_result';
        await markDeliveryUnknownBestEffort(deps.repository, {
          publicationId: beginning.publication_id,
          companyId,
          actorAuthUserId: access.actorAuthUserId,
          timestamp: new Date(deps.now()).toISOString(),
        });
        throw new MetaPublishingError('META_PUBLICATION_DELIVERY_UNKNOWN', undefined, {
          providerCategory: 'DELIVERY_UNKNOWN',
        });
      }
      stage = 'persist_result';
      const failed = await deps.repository.failPublication({
        publicationId: beginning.publication_id,
        companyId,
        actorAuthUserId: access.actorAuthUserId,
        diagnostic,
        lastErrorCode: error?.code === 'META_PUBLICATION_FAILED'
          ? 'META_PUBLICATION_FAILED'
          : 'META_PUBLICATION_PROVIDER_REJECTED',
        timestamp: new Date(deps.now()).toISOString(),
      });
      throw new MetaPublishingError(failed.last_error_code ?? 'META_PUBLICATION_FAILED', undefined, diagnostic);
    } finally {
      controller.clear();
    }

    stage = 'persist_result';
    let completed;
    try {
      completed = await deps.repository.completePublication({
        publicationId: beginning.publication_id,
        companyId,
        actorAuthUserId: access.actorAuthUserId,
        providerPostId: providerResult.providerPostId,
        timestamp: new Date(deps.now()).toISOString(),
      });
    } catch {
      await markDeliveryUnknownBestEffort(deps.repository, {
        publicationId: beginning.publication_id,
        companyId,
        actorAuthUserId: access.actorAuthUserId,
        timestamp: new Date(deps.now()).toISOString(),
      });
      throw new MetaPublishingError('META_PUBLICATION_DELIVERY_UNKNOWN', undefined, {
        providerCategory: 'DELIVERY_UNKNOWN',
      });
    }
    const result = safePublicationResult(completed);
    deps.telemetry.record(safePublishingTelemetry({ action, success: true, code: 'OK', stage, attempts, latencyMs: deps.now() - startedAt }));
    return result;
  } catch (error) {
    const normalized = normalizePublishingError(error);
    deps.telemetry.record(safePublishingTelemetry({
      action,
      success: false,
      code: normalized.code,
      stage,
      attempts,
      latencyMs: deps.now() - startedAt,
      ...(error?.diagnostic ?? diagnostic),
    }));
    throw normalized;
  }
}

export function normalizePublishingError(error) {
  return error instanceof MetaPublishingError ? error : new MetaPublishingError('INTERNAL_ERROR');
}

export function createTimeoutController(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

function duplicateResult(row) {
  const normalized = {
    status: row.publication_status,
    approved_at: row.publication_approved_at,
    published_at: row.publication_published_at,
    last_error_code: row.publication_last_error_code,
  };
  if (row.publication_status === 'published') return safePublicationResult(normalized);
  if (row.publication_status === 'publishing') throw new MetaPublishingError('META_PUBLICATION_IN_PROGRESS', 409);
  if (row.publication_status === 'delivery_unknown') throw new MetaPublishingError('META_PUBLICATION_DELIVERY_UNKNOWN');
  throw new MetaPublishingError(row.publication_last_error_code ?? 'META_PUBLICATION_FAILED');
}

function requirePageToken(value) {
  if (typeof value !== 'string' || !value || value.length > 4096) {
    throw new MetaPublishingError('META_CONNECTION_NEEDS_REAUTHORIZATION');
  }
  return value;
}

async function sha256Hex(value, cryptoApi) {
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return `\\x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function markDeliveryUnknownBestEffort(repository, input) {
  try {
    await repository.markUnknown(input);
  } catch {
    // The browser must still receive the bounded unknown-delivery result.
  }
}
