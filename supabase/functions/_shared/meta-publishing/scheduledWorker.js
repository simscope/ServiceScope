import { buildPrivateValues } from '../content-engine/context.js';
import { connectionEnvelopeContext, decryptTokenBundle } from '../meta-connection/crypto.js';
import {
  MetaPublishingError,
  facebookPublishingEnabled,
} from './contracts.js';
import { prepareFacebookPublicationPhoto, sha256Hex } from './photoPreparation.js';
import { assertPublicationPrivacy } from './privacy.js';

export const SCHEDULED_CLAIM_BATCH_SIZE = 3;
export const SCHEDULED_CLAIM_LEASE_SECONDS = 300;
export const SCHEDULED_RECONCILIATION_BATCH_SIZE = 20;

export class ScheduledWorkerError extends Error {
  constructor(code, kind = 'transient') {
    super(code);
    this.name = 'ScheduledWorkerError';
    this.code = code;
    this.kind = kind;
  }
}

export async function runScheduledFacebookWorker(deps) {
  if (!deps.config?.configured) throw new ScheduledWorkerError('META_PUBLISH_NOT_CONFIGURED', 'fatal');
  const counters = emptyCounters();
  counters.reconciledUnknown = await deps.repository.reconcileStale(SCHEDULED_RECONCILIATION_BATCH_SIZE);
  const claims = await deps.repository.claimDue(SCHEDULED_CLAIM_LEASE_SECONDS, SCHEDULED_CLAIM_BATCH_SIZE);
  if (!Array.isArray(claims) || claims.length > SCHEDULED_CLAIM_BATCH_SIZE) {
    throw new ScheduledWorkerError('SCHEDULED_WORKER_INVALID_CLAIM_BATCH', 'fatal');
  }
  counters.claimed = claims.length;
  for (const claim of claims) await processClaim(claim, deps, counters);
  return counters;
}

export function scheduledRetryDelayMs(executionAttempts) {
  if (executionAttempts <= 1) return 60_000;
  if (executionAttempts === 2) return 120_000;
  return 300_000;
}

async function processClaim(claim, deps, counters) {
  let prepared;
  try {
    prepared = await prepareClaim(claim, deps);
  } catch (error) {
    await handlePreStartFailure(claim, error, deps, counters);
    return;
  }

  let started;
  try {
    started = await deps.repository.startScheduled(claimIdentity(claim));
    if (!started || started.status !== 'publishing') {
      throw new ScheduledWorkerError('SCHEDULED_CLAIM_LOST', 'claim_lost');
    }
  } catch (error) {
    await handlePreStartFailure(claim, error, deps, counters);
    return;
  }

  const actor = {
    actorAuthUserId: String(prepared.publication.approved_by),
    actorName: String(prepared.publication.scheduled_by_name),
    actorRole: String(prepared.publication.scheduled_by_role),
  };
  const auditMetadata = prepared.photo
    ? { ...prepared.photo.auditMetadata, providerCallCount: 1 }
    : {};
  const controller = deps.timeoutController(deps.config.timeoutMs);
  let providerResult;
  try {
    providerResult = prepared.publication.publication_kind === 'single_photo'
      ? await deps.provider.publishSinglePhoto({
          pageId: prepared.connection.facebook_page_id,
          pageAccessToken: prepared.pageAccessToken,
          message: prepared.message,
          photoBytes: prepared.photo.bytes,
          mimeType: prepared.photo.mimeType,
          signal: controller.signal,
        })
      : await deps.provider.publishText({
          pageId: prepared.connection.facebook_page_id,
          pageAccessToken: prepared.pageAccessToken,
          message: prepared.message,
          signal: controller.signal,
        });
  } catch (error) {
    controller.clear();
    if (error?.code === 'META_PUBLICATION_DELIVERY_UNKNOWN') {
      await markUnknownBestEffort(deps.repository, terminalInput(prepared.publication, actor, auditMetadata, deps));
      counters.deliveryUnknown += 1;
      return;
    }
    try {
      await deps.repository.failPublication({
        ...terminalInput(prepared.publication, actor, auditMetadata, deps),
        diagnostic: error?.diagnostic ?? {},
        lastErrorCode: error?.code === 'META_PUBLICATION_FAILED'
          ? 'META_PUBLICATION_FAILED'
          : 'META_PUBLICATION_PROVIDER_REJECTED',
      });
      counters.providerFailed += 1;
    } catch {
      await markUnknownBestEffort(deps.repository, terminalInput(prepared.publication, actor, auditMetadata, deps));
      counters.deliveryUnknown += 1;
    }
    return;
  }
  controller.clear();

  try {
    await deps.repository.completePublication({
      ...terminalInput(prepared.publication, actor, auditMetadata, deps),
      providerPostId: providerResult.providerPostId,
      providerMediaId: providerResult.providerMediaId ?? null,
    });
    counters.published += 1;
  } catch {
    await markUnknownBestEffort(deps.repository, terminalInput(prepared.publication, actor, auditMetadata, deps));
    counters.deliveryUnknown += 1;
  }
}

async function prepareClaim(claim, deps) {
  assertClaimShape(claim);
  const publication = await deps.repository.getClaimedPublication(claimIdentity(claim));
  if (!publication) throw new ScheduledWorkerError('SCHEDULED_CLAIM_LOST', 'claim_lost');
  if (
    String(publication.id) !== String(claim.publication_id)
    || String(publication.company_id) !== String(claim.company_id)
    || String(publication.connection_id) !== String(claim.connection_id)
    || String(publication.job_id) !== String(claim.job_id)
    || String(publication.publication_kind) !== String(claim.publication_kind)
    || String(publication.attachment_id ?? '') !== String(claim.attachment_id ?? '')
    || String(publication.claim_token) !== String(claim.claim_token)
  ) {
    throw new ScheduledWorkerError('SCHEDULED_SNAPSHOT_INVALID', 'permanent');
  }
  const message = typeof publication.approved_message === 'string' ? publication.approved_message : '';
  if (!message || !['text_only', 'single_photo'].includes(publication.publication_kind)) {
    throw new ScheduledWorkerError('SCHEDULED_SNAPSHOT_INVALID', 'permanent');
  }
  const actualMessageSha256 = await sha256Hex(message, deps.cryptoApi);
  if (actualMessageSha256 !== publication.message_sha256) {
    throw new ScheduledWorkerError('SCHEDULED_MESSAGE_SHA_MISMATCH', 'permanent');
  }

  const connection = await deps.repository.getExactConnection({
    companyId: String(publication.company_id),
    connectionId: String(publication.connection_id),
  });
  if (
    !connection
    || connection.status !== 'connected'
    || String(connection.id) !== String(publication.connection_id)
    || String(connection.facebook_page_id) !== String(publication.scheduled_facebook_page_id)
    || !facebookPublishingEnabled(connection)
    || !connection.token_envelope
  ) {
    throw new ScheduledWorkerError('SCHEDULED_CONNECTION_INVALID', 'permanent');
  }

  const publicationContext = await deps.repository.getPrivacyContext(
    String(publication.company_id),
    String(publication.job_id),
  );
  if (!publicationContext?.job || !['Completed', 'Warranty'].includes(String(publicationContext.job.status))) {
    throw new ScheduledWorkerError('SCHEDULED_JOB_INVALID', 'permanent');
  }
  const privateValues = buildPrivateValues(publicationContext);
  try {
    assertPublicationPrivacy(message, privateValues);
  } catch {
    throw new ScheduledWorkerError('SCHEDULED_PRIVACY_REVALIDATION_FAILED', 'permanent');
  }

  let tokenBundle;
  try {
    tokenBundle = await decryptTokenBundle(
      connection.token_envelope,
      deps.config.encryptionKey,
      connectionEnvelopeContext({
        companyId: String(publication.company_id),
        connectionId: String(publication.connection_id),
        pageId: String(publication.scheduled_facebook_page_id),
      }),
      deps.cryptoApi,
    );
  } catch {
    throw new ScheduledWorkerError('SCHEDULED_TOKEN_INVALID', 'permanent');
  }
  const pageAccessToken = requirePageToken(tokenBundle?.pageAccessToken);

  let photo = null;
  if (publication.publication_kind === 'single_photo') {
    const attachment = await deps.repository.getExactAttachment({
      companyId: String(publication.company_id),
      jobId: String(publication.job_id),
      attachmentId: String(publication.attachment_id),
    });
    if (
      !attachment
      || String(attachment.kind ?? '').toLowerCase() !== 'photo'
      || String(attachment.mime_type ?? '').trim().toLowerCase() !== String(publication.safe_mime_type)
    ) {
      throw new ScheduledWorkerError('SCHEDULED_ATTACHMENT_INVALID', 'permanent');
    }
    const approval = await deps.repository.getExactApproval({
      companyId: String(publication.company_id),
      jobId: String(publication.job_id),
      attachmentId: String(publication.attachment_id),
      approvalId: String(publication.scheduled_approval_id),
    });
    if (!approval) throw new ScheduledWorkerError('SCHEDULED_APPROVAL_INVALID', 'permanent');
    try {
      photo = await prepareFacebookPublicationPhoto({
        photo: attachment,
        companyId: String(publication.company_id),
        jobId: String(publication.job_id),
        privateValues,
        deps,
        expectedOriginalSha256: publication.scheduled_attachment_sha256,
        approval: {
          id: String(publication.scheduled_approval_id),
          analysis_run_id: String(publication.scheduled_analysis_run_id),
          approved_at: approval.approved_at,
        },
      });
    } catch (error) {
      if (error instanceof MetaPublishingError) {
        throw new ScheduledWorkerError(error.code, 'permanent');
      }
      throw error;
    }
  } else if (
    publication.attachment_id !== null
    || publication.scheduled_attachment_sha256 !== null
    || publication.scheduled_approval_id !== null
  ) {
    throw new ScheduledWorkerError('SCHEDULED_SNAPSHOT_INVALID', 'permanent');
  }

  return { publication, connection, message, pageAccessToken, photo };
}

async function handlePreStartFailure(claim, error, deps, counters) {
  if (error?.kind === 'permanent') {
    try {
      await deps.repository.failPreflight(claimIdentity(claim));
      counters.preflightFailed += 1;
    } catch (failureError) {
      if (failureError?.kind === 'claim_lost') await classifyLostClaim(claim, deps, counters);
      else await releaseForRetry(claim, deps, counters);
    }
    return;
  }
  if (error?.kind === 'claim_lost') {
    await classifyLostClaim(claim, deps, counters);
    return;
  }
  await releaseForRetry(claim, deps, counters);
}

async function releaseForRetry(claim, deps, counters) {
  const delayMs = scheduledRetryDelayMs(Number(claim.execution_attempts) || 1);
  try {
    await deps.repository.releaseClaim({
      ...claimIdentity(claim),
      nextAttemptAt: new Date(deps.now() + delayMs).toISOString(),
    });
    counters.released += 1;
  } catch {
    await classifyLostClaim(claim, deps, counters);
  }
}

async function classifyLostClaim(claim, deps, counters) {
  try {
    const status = await deps.repository.getPublicationState(String(claim.publication_id), String(claim.company_id));
    if (status === 'cancelled') counters.cancelled += 1;
    else counters.released += 1;
  } catch {
    counters.released += 1;
  }
}

function assertClaimShape(claim) {
  if (!claim || !claim.publication_id || !claim.company_id || !claim.claim_token) {
    throw new ScheduledWorkerError('SCHEDULED_WORKER_INVALID_CLAIM', 'transient');
  }
}

function claimIdentity(claim) {
  return {
    publicationId: String(claim.publication_id),
    companyId: String(claim.company_id),
    claimToken: String(claim.claim_token),
  };
}

function requirePageToken(value) {
  if (typeof value !== 'string' || !value || value.length > 4096) {
    throw new ScheduledWorkerError('SCHEDULED_TOKEN_INVALID', 'permanent');
  }
  return value;
}

function terminalInput(publication, actor, publicationAuditMetadata, deps) {
  return {
    publicationId: String(publication.id),
    companyId: String(publication.company_id),
    ...actor,
    publicationAuditMetadata,
    timestamp: new Date(deps.now()).toISOString(),
  };
}

async function markUnknownBestEffort(repository, input) {
  try {
    await repository.markUnknown(input);
  } catch {
    // Reconciliation will conservatively close any remaining scheduled publishing row.
  }
}

function emptyCounters() {
  return {
    claimed: 0,
    published: 0,
    preflightFailed: 0,
    providerFailed: 0,
    deliveryUnknown: 0,
    released: 0,
    cancelled: 0,
    reconciledUnknown: 0,
  };
}
