import { buildPrivateValues } from '../content-engine/context.js';
import { connectionEnvelopeContext, decryptTokenBundle } from '../meta-connection/crypto.js';
import {
  MetaPublishingError,
  assertExplicitApproval,
  facebookPublishingEnabled,
  normalizeApprovedMessage,
  publicationIntentSource,
  requireUuid,
  safeReelPublicationResult,
} from './contracts.js';
import { assertPublicationPrivacy } from './privacy.js';
import { sha256Hex } from './photoPreparation.js';
import { prepareFacebookReel } from './reelPreparation.js';

const MAX_REEL_PROVIDER_CALLS = 6;
const MAX_REEL_STATUS_CHECKS = 3;
const REQUIRED_REEL_SCOPES = Object.freeze(['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']);

export async function handleFacebookReelDelivery({ body, companyId, access, deps }) {
  assertExplicitApproval(body.explicitApproval);
  if (!deps.config.configured) throw new MetaPublishingError('META_PUBLISH_NOT_CONFIGURED');
  return body.action === 'reconcile_facebook_reel'
    ? reconcileFacebookReel({ body, companyId, access, deps })
    : publishFacebookReel({ body, companyId, access, deps });
}

async function publishFacebookReel({ body, companyId, access, deps }) {
  const jobId = requireUuid(body.jobId);
  const renderJobId = requireUuid(body.renderJobId);
  const idempotencyKey = requireUuid(body.idempotencyKey);
  const message = normalizeApprovedMessage(body.message);
  const publicationContext = await deps.repository.getPublicationContext(companyId, jobId);
  assertPublicationContext(publicationContext, companyId);
  const connection = publicationContext.connection;
  assertEligibleConnection(connection);

  assertPublicationPrivacy(message, buildPrivateValues(publicationContext));
  const render = await deps.repository.getCompletedReel(companyId, jobId, renderJobId);
  if (!render) throw new MetaPublishingError('META_REEL_RENDER_REQUIRED');
  const reel = await prepareFacebookReel({ render, companyId, jobId, deps });
  const pageAccessToken = await decryptPageToken({ connection, companyId, deps });
  const messageSha256 = await sha256Hex(message, deps.cryptoApi);
  const publicationIntentSha256 = await sha256Hex(publicationIntentSource({
    companyId,
    jobId,
    connectionId: connection.id,
    actorAuthUserId: access.actorAuthUserId,
    publicationKind: 'reel_video',
    approvedMessage: message,
    renderJobId,
  }), deps.cryptoApi);
  const timestamp = new Date(deps.now()).toISOString();
  const beginning = await deps.repository.beginReelPublication({
    publicationId: deps.newUuid(),
    companyId,
    connectionId: String(connection.id),
    jobId,
    renderJobId,
    idempotencyKey,
    message,
    messageSha256,
    publicationIntentSha256,
    videoSha256: reel.sha256,
    videoBytes: reel.byteLength,
    actorAuthUserId: access.actorAuthUserId,
    actorName: access.actorName,
    actorRole: access.actorRole,
    timestamp,
  });
  if (!beginning.should_publish) return duplicateReelResult(beginning);

  const publicationId = String(beginning.publication_id);
  let providerMediaId = null;
  let statusWasChecked = false;
  try {
    const initialized = await providerCall(deps, (signal) => deps.provider.initializeReel({
      pageId: connection.facebook_page_id,
      pageAccessToken,
      signal,
    }));
    providerMediaId = initialized.providerMediaId;
    await deps.repository.advanceReelPublication({
      publicationId, companyId, actorAuthUserId: access.actorAuthUserId,
      actorName: access.actorName, actorRole: access.actorRole,
      expectedStage: 'upload_initializing', nextStage: 'uploading', providerMediaId,
      timestamp: new Date(deps.now()).toISOString(),
    });

    await providerCall(deps, (signal) => deps.provider.uploadReel({
      providerMediaId,
      pageAccessToken,
      videoBytes: reel.bytes,
      signal,
    }));
    await deps.repository.advanceReelPublication({
      publicationId, companyId, actorAuthUserId: access.actorAuthUserId,
      actorName: access.actorName, actorRole: access.actorRole,
      expectedStage: 'uploading', nextStage: 'finalizing', providerMediaId,
      timestamp: new Date(deps.now()).toISOString(),
    });

    await providerCall(deps, (signal) => deps.provider.finalizeReel({
      pageId: connection.facebook_page_id,
      pageAccessToken,
      providerMediaId,
      message,
      signal,
    }));
    await deps.repository.advanceReelPublication({
      publicationId, companyId, actorAuthUserId: access.actorAuthUserId,
      actorName: access.actorName, actorRole: access.actorRole,
      expectedStage: 'finalizing', nextStage: 'provider_processing', providerMediaId,
      timestamp: new Date(deps.now()).toISOString(),
    });

    statusWasChecked = true;
    const providerStatus = await providerCall(deps, (signal) => deps.provider.getReelStatus({
      providerMediaId,
      pageAccessToken,
      signal,
    }));
    return persistReelStatus({ providerStatus, publicationId, companyId, access, deps });
  } catch (error) {
    if (error?.reelStatePersisted !== true) {
      await persistProviderFailure({ error, publicationId, companyId, providerMediaId, statusWasChecked, access, deps });
    }
    throw error;
  }
}

async function reconcileFacebookReel({ body, companyId, access, deps }) {
  const publicationId = requireUuid(body.publicationId);
  const snapshot = await deps.repository.getReelPublication(companyId, publicationId);
  if (!snapshot || snapshot.publication_kind !== 'reel_video') throw new MetaPublishingError('FORBIDDEN');
  if (snapshot.status === 'published') return safeReelPublicationResult(snapshot);
  if (snapshot.status === 'publishing' && snapshot.provider_delivery_stage === 'provider_processing') {
    throw new MetaPublishingError('META_REEL_STATUS_CHECK_LIMIT_REACHED', 409);
  }
  if (snapshot.status !== 'delivery_unknown') {
    throw new MetaPublishingError(snapshot.last_error_code ?? 'META_PUBLICATION_FAILED');
  }
  if (!snapshot.reel_provider_media_id) throw new MetaPublishingError('META_PUBLICATION_DELIVERY_UNKNOWN');
  if (Number(snapshot.provider_call_count) >= MAX_REEL_PROVIDER_CALLS
    || Number(snapshot.provider_status_checks) >= MAX_REEL_STATUS_CHECKS) {
    throw new MetaPublishingError('META_REEL_STATUS_CHECK_LIMIT_REACHED', 409);
  }
  assertEligibleConnection(snapshot.connection);
  const pageAccessToken = await decryptPageToken({ connection: snapshot.connection, companyId, deps });
  await deps.repository.claimReelStatusCheck({
    publicationId,
    companyId,
    actorAuthUserId: access.actorAuthUserId,
    actorName: access.actorName,
    actorRole: access.actorRole,
    timestamp: new Date(deps.now()).toISOString(),
  });
  let providerStatus;
  try {
    providerStatus = await providerCall(deps, (signal) => deps.provider.getReelStatus({
      providerMediaId: snapshot.reel_provider_media_id,
      pageAccessToken,
      signal,
    }));
  } catch (error) {
    if (error?.reelStatePersisted !== true) {
      await persistProviderFailure({
        error, publicationId, companyId, providerMediaId: snapshot.reel_provider_media_id,
        statusWasChecked: true, callAlreadyCounted: true, access, deps,
      });
    }
    throw error;
  }
  return persistReelStatus({
    providerStatus, publicationId, companyId, access, deps, callAlreadyCounted: true,
  });
}

async function persistReelStatus({
  providerStatus, publicationId, companyId, access, deps, callAlreadyCounted = false,
}) {
  const base = {
    publicationId,
    companyId,
    actorAuthUserId: access.actorAuthUserId,
    actorName: access.actorName,
    actorRole: access.actorRole,
    timestamp: new Date(deps.now()).toISOString(),
  };
  if (providerStatus.state === 'published') {
    try {
      const completed = callAlreadyCounted
        ? await deps.repository.completeReelReconciliation(base)
        : await deps.repository.completeReelPublication(base);
      return safeReelPublicationResult(completed);
    } catch {
      await markUnknownAfterStatus(base, deps, callAlreadyCounted);
      throw persistedError('META_PUBLICATION_DELIVERY_UNKNOWN');
    }
  }
  if (providerStatus.state === 'failed') {
    try {
      const failed = await deps.repository.failReelPublication({
        ...base,
        diagnostic: { providerCategory: 'REEL_PROCESSING_FAILED' },
        lastErrorCode: 'META_PUBLICATION_PROVIDER_REJECTED',
        callWasSent: !callAlreadyCounted,
        statusWasChecked: !callAlreadyCounted,
      });
      throw persistedError(failed.last_error_code ?? 'META_PUBLICATION_PROVIDER_REJECTED');
    } catch (error) {
      if (error?.reelStatePersisted === true) throw error;
      await markUnknownAfterStatus(base, deps, callAlreadyCounted);
      throw persistedError('META_PUBLICATION_DELIVERY_UNKNOWN');
    }
  }
  try {
    return safeReelPublicationResult(await deps.repository.markReelUnknown({
      ...base,
      providerMediaId: null,
      callWasSent: !callAlreadyCounted,
      statusWasChecked: !callAlreadyCounted,
    }));
  } catch {
    await markUnknownAfterStatus(base, deps, callAlreadyCounted);
    throw persistedError('META_PUBLICATION_DELIVERY_UNKNOWN');
  }
}

async function persistProviderFailure({
  error, publicationId, companyId, providerMediaId, statusWasChecked = false,
  callAlreadyCounted = false, access, deps,
}) {
  const input = {
    publicationId,
    companyId,
    actorAuthUserId: access.actorAuthUserId,
    actorName: access.actorName,
    actorRole: access.actorRole,
    providerMediaId,
    diagnostic: error?.diagnostic ?? {},
    timestamp: new Date(deps.now()).toISOString(),
    callWasSent: !callAlreadyCounted,
    statusWasChecked: statusWasChecked && !callAlreadyCounted,
  };
  try {
    if (statusWasChecked || !error?.code || ['META_PUBLICATION_DELIVERY_UNKNOWN', 'INTERNAL_ERROR'].includes(error.code)) {
      await deps.repository.markReelUnknown(input);
    } else {
      await deps.repository.failReelPublication({
        ...input,
        lastErrorCode: error?.code === 'META_PUBLICATION_FAILED'
          ? 'META_PUBLICATION_FAILED'
          : 'META_PUBLICATION_PROVIDER_REJECTED',
      });
    }
  } catch {
    // The caller still receives the bounded provider failure.
  }
}

async function markUnknownAfterStatus(base, deps, callAlreadyCounted = false) {
  try {
    await deps.repository.markReelUnknown({
      ...base,
      providerMediaId: null,
      callWasSent: !callAlreadyCounted,
      statusWasChecked: !callAlreadyCounted,
    });
  } catch {}
}

function persistedError(code) {
  const error = new MetaPublishingError(code);
  error.reelStatePersisted = true;
  return error;
}

async function decryptPageToken({ connection, companyId, deps }) {
  let tokenBundle;
  try {
    tokenBundle = await decryptTokenBundle(
      connection.token_envelope,
      deps.config.encryptionKey,
      connectionEnvelopeContext({ companyId, connectionId: connection.id, pageId: connection.facebook_page_id }),
      deps.cryptoApi,
    );
  } catch {
    throw new MetaPublishingError('META_CONNECTION_NEEDS_REAUTHORIZATION');
  }
  const token = tokenBundle?.pageAccessToken;
  if (typeof token !== 'string' || !token || token.length > 4096) {
    throw new MetaPublishingError('META_CONNECTION_NEEDS_REAUTHORIZATION');
  }
  return token;
}

async function providerCall(deps, invoke) {
  const controller = deps.timeoutController(deps.config.timeoutMs);
  try {
    return await invoke(controller.signal);
  } finally {
    controller.clear();
  }
}

function assertPublicationContext(context, companyId) {
  if (!context?.job || String(context.job.company_id) !== companyId) throw new MetaPublishingError('FORBIDDEN');
  if (!['Completed', 'Warranty'].includes(String(context.job.status))) throw new MetaPublishingError('INVALID_REQUEST');
}

function assertEligibleConnection(connection) {
  if (!connection || connection.status !== 'connected') throw new MetaPublishingError('META_CONNECTION_NEEDS_REAUTHORIZATION');
  if (!facebookPublishingEnabled(connection) || !REQUIRED_REEL_SCOPES.every((scope) => connection.granted_scopes.includes(scope))) {
    throw new MetaPublishingError('META_PUBLISHING_PERMISSION_MISSING');
  }
}

function duplicateReelResult(row) {
  if (row.publication_status === 'published' || row.publication_status === 'publishing') {
    return safeReelPublicationResult(row);
  }
  if (row.publication_status === 'delivery_unknown') throw new MetaPublishingError('META_PUBLICATION_DELIVERY_UNKNOWN');
  throw new MetaPublishingError(row.publication_last_error_code ?? 'META_PUBLICATION_FAILED');
}
