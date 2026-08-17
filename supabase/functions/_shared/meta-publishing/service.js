import { buildPrivateValues } from '../content-engine/context.js';
import { connectionEnvelopeContext, decryptTokenBundle } from '../meta-connection/crypto.js';
import {
  MetaPublishingError,
  assertExplicitApproval,
  facebookPublishingEnabled,
  maxFacebookPhotoBytes,
  normalizeApprovalReason,
  normalizeApprovedMessage,
  normalizeFindingIds,
  normalizeScheduledPublicationTime,
  parsePublishingRequest,
  publicationIntentSource,
  publicationKindForAction,
  requireUuid,
  safePublicationResult,
  safeScheduledPublicationResult,
  safePublishingStatus,
  safePublishingTelemetry,
} from './contracts.js';
import { assertPublicationPrivacy } from './privacy.js';
import {
  deriveFacebookPublicationPhotoScheduleEvidence,
  prepareFacebookPublicationPhoto,
  sha256Hex,
  validateFacebookPublicationPhotoAttachment,
} from './photoPreparation.js';
import { handleFacebookReelDelivery } from './reelDeliveryService.js';

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
      const jobId = body.jobId === undefined ? undefined : requireUuid(body.jobId);
      const snapshot = await deps.repository.getStatus(companyId, jobId);
      const result = safePublishingStatus({ config: deps.config, ...snapshot });
      deps.telemetry.record(safePublishingTelemetry({ action, success: true, code: 'OK', stage, attempts, latencyMs: deps.now() - startedAt }));
      return result;
    }

    if (action === 'cancel_facebook_scheduled_publication') {
      stage = 'cancel_schedule';
      assertExplicitApproval(body.explicitApproval);
      const publicationId = requireUuid(body.publicationId);
      const cancelled = await deps.repository.cancelScheduledPublication({
        publicationId,
        companyId,
        actorAuthUserId: access.actorAuthUserId,
        actorName: access.actorName,
        actorRole: access.actorRole,
      });
      const result = safeScheduledPublicationResult(cancelled);
      deps.telemetry.record(safePublishingTelemetry({ action, success: true, code: 'OK', stage, attempts, latencyMs: deps.now() - startedAt }));
      return result;
    }

    if (['publish_facebook_reel', 'reconcile_facebook_reel'].includes(action)) {
      stage = action === 'publish_facebook_reel' ? 'reel_artifact_validation' : 'reel_status';
      const result = await handleFacebookReelDelivery({ body, companyId, access, deps });
      deps.telemetry.record(safePublishingTelemetry({ action, success: true, code: 'OK', stage, attempts, latencyMs: deps.now() - startedAt }));
      return result;
    }

    if (action === 'approve_facebook_publication_photo') {
      stage = 'privacy_review';
      assertExplicitApproval(body.explicitApproval);
      const jobId = requireUuid(body.jobId);
      const attachmentId = requireUuid(body.attachmentId);
      const analysisRunId = requireUuid(body.analysisRunId);
      const attachmentResultId = requireUuid(body.attachmentResultId);
      const publicationContext = await deps.repository.getPublicationContext(companyId, jobId);
      if (!publicationContext?.job || String(publicationContext.job.company_id) !== companyId) {
        throw new MetaPublishingError('FORBIDDEN');
      }
      if (!['Completed', 'Warranty'].includes(String(publicationContext.job.status))) {
        throw new MetaPublishingError('INVALID_REQUEST');
      }
      const privateValues = buildPrivateValues(publicationContext);
      let photo = await deps.repository.getPublicationAttachment(companyId, jobId, attachmentId);
      photo = validateFacebookPublicationPhotoAttachment({ photo, companyId, jobId, privateValues });
      const originalBytes = await deps.repository.downloadAttachmentBytes({
        storageBucket: String(photo.storage_bucket),
        storagePath: String(photo.storage_path),
        maxBytes: maxFacebookPhotoBytes,
      });
      const attachmentSha256 = await sha256Hex(originalBytes, deps.cryptoApi);
      const row = await deps.repository.approvePublicationPhoto({
        approvalId: deps.newUuid(),
        companyId,
        jobId,
        attachmentId,
        analysisRunId,
        attachmentResultId,
        attachmentSha256,
        attachmentMimeType: photo.mimeType,
        actorAuthUserId: access.actorAuthUserId,
        actorName: access.actorName,
        actorRole: access.actorRole,
        approvalReason: normalizeApprovalReason(body.approvalReason),
        timestamp: new Date(deps.now()).toISOString(),
      });
      deps.telemetry.record(safePublishingTelemetry({ action, success: true, code: 'OK', stage, attempts, latencyMs: deps.now() - startedAt }));
      return { ok: true, attachmentId: String(row.attachment_id ?? attachmentId), approvalStatus: 'approved', approvedAt: row.approved_at ?? null };
    }

    if (action === 'revoke_facebook_publication_photo_approval') {
      stage = 'privacy_review';
      assertExplicitApproval(body.explicitApproval);
      const jobId = requireUuid(body.jobId);
      const attachmentId = requireUuid(body.attachmentId);
      const publicationContext = await deps.repository.getPublicationContext(companyId, jobId);
      if (!publicationContext?.job || String(publicationContext.job.company_id) !== companyId) {
        throw new MetaPublishingError('FORBIDDEN');
      }
      const photo = await deps.repository.getPublicationAttachment(companyId, jobId, attachmentId);
      if (!photo || String(photo.company_id) !== companyId || String(photo.job_id) !== jobId) throw new MetaPublishingError('FORBIDDEN');
      const row = await deps.repository.revokePublicationPhotoApproval({
        companyId,
        jobId,
        attachmentId,
        actorAuthUserId: access.actorAuthUserId,
        actorName: access.actorName,
        actorRole: access.actorRole,
        revocationReason: normalizeApprovalReason(body.revocationReason),
        timestamp: new Date(deps.now()).toISOString(),
      });
      deps.telemetry.record(safePublishingTelemetry({ action, success: true, code: 'OK', stage, attempts, latencyMs: deps.now() - startedAt }));
      return { ok: true, attachmentId: String(row.attachment_id ?? attachmentId), approvalStatus: 'revoked', revokedAt: row.revoked_at ?? null };
    }

    if (action === 'exclude_facebook_publication_photo') {
      stage = 'privacy_review';
      assertExplicitApproval(body.explicitApproval);
      const jobId = requireUuid(body.jobId);
      const attachmentId = requireUuid(body.attachmentId);
      const analysisRunId = requireUuid(body.analysisRunId);
      const attachmentResultId = requireUuid(body.attachmentResultId);
      const publicationContext = await deps.repository.getPublicationContext(companyId, jobId);
      if (!publicationContext?.job || String(publicationContext.job.company_id) !== companyId) {
        throw new MetaPublishingError('FORBIDDEN');
      }
      const photo = await deps.repository.getPublicationAttachment(companyId, jobId, attachmentId);
      if (!photo || String(photo.company_id) !== companyId || String(photo.job_id) !== jobId) throw new MetaPublishingError('FORBIDDEN');
      const row = await deps.repository.excludePublicationPhoto({
        companyId,
        jobId,
        attachmentId,
        analysisRunId,
        attachmentResultId,
        actorAuthUserId: access.actorAuthUserId,
        actorName: access.actorName,
        actorRole: access.actorRole,
        exclusionReason: normalizeApprovalReason(body.exclusionReason),
        timestamp: new Date(deps.now()).toISOString(),
      });
      deps.telemetry.record(safePublishingTelemetry({ action, success: true, code: 'OK', stage, attempts, latencyMs: deps.now() - startedAt }));
      return {
        ok: true,
        attachmentId: String(row.attachment_id ?? attachmentId),
        excluded: true,
        approvalStatus: row.revoked_approval_id ? 'revoked' : 'pending',
      };
    }

    if (action === 'resolve_facebook_publication_photo_false_positive') {
      stage = 'privacy_review';
      assertExplicitApproval(body.explicitApproval);
      const jobId = requireUuid(body.jobId);
      const attachmentId = requireUuid(body.attachmentId);
      const analysisRunId = requireUuid(body.analysisRunId);
      const attachmentResultId = requireUuid(body.attachmentResultId);
      const findingIds = normalizeFindingIds(body.findingIds);
      const publicationContext = await deps.repository.getPublicationContext(companyId, jobId);
      if (!publicationContext?.job || String(publicationContext.job.company_id) !== companyId) {
        throw new MetaPublishingError('FORBIDDEN');
      }
      const photo = await deps.repository.getPublicationAttachment(companyId, jobId, attachmentId);
      if (!photo || String(photo.company_id) !== companyId || String(photo.job_id) !== jobId) throw new MetaPublishingError('FORBIDDEN');
      const row = await deps.repository.resolvePublicationPhotoFalsePositive({
        companyId,
        jobId,
        attachmentId,
        analysisRunId,
        attachmentResultId,
        findingIds,
        actorAuthUserId: access.actorAuthUserId,
        actorName: access.actorName,
        actorRole: access.actorRole,
        resolutionReason: normalizeApprovalReason(body.resolutionReason),
        timestamp: new Date(deps.now()).toISOString(),
      });
      deps.telemetry.record(safePublishingTelemetry({ action, success: true, code: 'OK', stage, attempts, latencyMs: deps.now() - startedAt }));
      return {
        ok: true,
        attachmentId: String(row.attachment_id ?? attachmentId),
        privacyReviewStatus: row.privacy_review_status === 'resolved_false_positive' ? 'resolved_false_positive' : 'blocked',
        resolvedFindingCount: Number(row.resolved_finding_count) || 0,
      };
    }

    stage = 'validate_request';
    if (!deps.config.configured) throw new MetaPublishingError('META_PUBLISH_NOT_CONFIGURED');
    assertExplicitApproval(body.explicitApproval);
    const jobId = requireUuid(body.jobId);
    const publicationKind = publicationKindForAction(action);
    const scheduledAction = ['schedule_facebook_text', 'schedule_facebook_single_photo'].includes(action);
    const attachmentId = publicationKind === 'single_photo' ? requireUuid(body.attachmentId) : null;
    const idempotencyKey = requireUuid(body.idempotencyKey);
    const message = normalizeApprovedMessage(body.message);
    const schedule = scheduledAction
      ? normalizeScheduledPublicationTime(body.scheduledFor, body.scheduledTimezone, deps.now())
      : null;
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
    let photo = null;
    let schedulePhotoEvidence = null;
    if (publicationKind === 'single_photo') {
      photo = await deps.repository.getPublicationAttachment(companyId, jobId, attachmentId);
      if (scheduledAction) {
        schedulePhotoEvidence = await deriveFacebookPublicationPhotoScheduleEvidence({
          photo,
          companyId,
          jobId,
          privateValues,
          deps,
        });
      } else {
        photo = await prepareFacebookPublicationPhoto({
          photo,
          companyId,
          jobId,
          privateValues,
          deps,
          revalidateEligibility: (originalSha256) => deps.repository.revalidatePublicationPhotoEligibility(
            companyId,
            jobId,
            photo.id,
            originalSha256,
          ),
        });
      }
    }

    if (scheduledAction) {
      stage = 'schedule_persist';
      const scheduled = await deps.repository.schedulePublication({
        publicationId: deps.newUuid(),
        companyId,
        connectionId: String(connection.id),
        jobId,
        idempotencyKey,
        message,
        publicationKind,
        attachmentId: schedulePhotoEvidence?.attachmentId ?? null,
        attachmentSha256: schedulePhotoEvidence?.attachmentSha256 ?? null,
        analysisRunId: schedulePhotoEvidence?.analysisRunId ?? null,
        attachmentResultId: schedulePhotoEvidence?.attachmentResultId ?? null,
        approvalId: schedulePhotoEvidence?.approvalId ?? null,
        actorAuthUserId: access.actorAuthUserId,
        actorName: access.actorName,
        actorRole: access.actorRole,
        scheduledFor: schedule.scheduledFor,
        scheduledTimezone: schedule.scheduledTimezone,
      });
      const result = safeScheduledPublicationResult({
        ...scheduled,
        scheduled_timezone: schedule.scheduledTimezone,
      }, publicationKind);
      deps.telemetry.record(safePublishingTelemetry({ action, success: true, code: 'OK', stage, attempts, latencyMs: deps.now() - startedAt }));
      return result;
    }

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
    const publicationIntentSha256 = await sha256Hex(publicationIntentSource({
      companyId,
      jobId,
      connectionId: connection.id,
      actorAuthUserId: access.actorAuthUserId,
      publicationKind,
      approvedMessage: message,
      attachmentId,
    }), deps.cryptoApi);
    const timestamp = new Date(deps.now()).toISOString();
    const beginning = await deps.repository.beginPublication({
      publicationId: deps.newUuid(),
      companyId,
      connectionId: connection.id,
      jobId,
      idempotencyKey,
      message,
      messageSha256,
      publicationIntentSha256,
      publicationKind,
      attachmentId,
      safeMimeType: photo?.mimeType ?? null,
      mediaCount: photo ? 1 : 0,
      publicationAuditMetadata: photo?.auditMetadata ?? {},
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
      providerResult = publicationKind === 'single_photo'
        ? await deps.provider.publishSinglePhoto({
            pageId: connection.facebook_page_id,
            pageAccessToken,
            message,
            photoBytes: photo.bytes,
            mimeType: photo.mimeType,
            signal: controller.signal,
          })
        : await deps.provider.publishText({
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
          actorName: access.actorName,
          actorRole: access.actorRole,
          publicationAuditMetadata: photo ? { ...photo.auditMetadata, providerCallCount: 1 } : {},
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
        actorName: access.actorName,
        actorRole: access.actorRole,
        diagnostic,
        publicationAuditMetadata: photo ? { ...photo.auditMetadata, providerCallCount: 1 } : {},
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
        actorName: access.actorName,
        actorRole: access.actorRole,
        providerPostId: providerResult.providerPostId,
        providerMediaId: providerResult.providerMediaId ?? null,
        publicationAuditMetadata: photo ? { ...photo.auditMetadata, providerCallCount: 1 } : {},
        timestamp: new Date(deps.now()).toISOString(),
      });
    } catch {
      await markDeliveryUnknownBestEffort(deps.repository, {
        publicationId: beginning.publication_id,
        companyId,
        actorAuthUserId: access.actorAuthUserId,
        actorName: access.actorName,
        actorRole: access.actorRole,
        publicationAuditMetadata: photo ? { ...photo.auditMetadata, providerCallCount: 1 } : {},
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

async function markDeliveryUnknownBestEffort(repository, input) {
  try {
    await repository.markUnknown(input);
  } catch {
    // The browser must still receive the bounded unknown-delivery result.
  }
}
