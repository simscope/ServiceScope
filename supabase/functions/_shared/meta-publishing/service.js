import { buildPrivateValues } from '../content-engine/context.js';
import { connectionEnvelopeContext, decryptTokenBundle } from '../meta-connection/crypto.js';
import {
  MetaPublishingError,
  assertExplicitApproval,
  facebookPublishingEnabled,
  maxFacebookPhotoBytes,
  normalizeApprovedMessage,
  parsePublishingRequest,
  publicationKindForAction,
  requireUuid,
  safePublicationResult,
  safePublishingStatus,
  safePublishingTelemetry,
  supportedFacebookPhotoMimeTypes,
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
      const jobId = body.jobId === undefined ? undefined : requireUuid(body.jobId);
      const snapshot = await deps.repository.getStatus(companyId, jobId);
      const result = safePublishingStatus({ config: deps.config, ...snapshot });
      deps.telemetry.record(safePublishingTelemetry({ action, success: true, code: 'OK', stage, attempts, latencyMs: deps.now() - startedAt }));
      return result;
    }

    stage = 'validate_request';
    if (!deps.config.configured) throw new MetaPublishingError('META_PUBLISH_NOT_CONFIGURED');
    assertExplicitApproval(body.explicitApproval);
    const jobId = requireUuid(body.jobId);
    const publicationKind = publicationKindForAction(action);
    const attachmentId = action === 'publish_facebook_single_photo' ? requireUuid(body.attachmentId) : null;
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
    let photo = null;
    if (publicationKind === 'single_photo') {
      photo = await deps.repository.getPublicationAttachment(companyId, jobId, attachmentId);
      photo = await validateAndLoadSinglePhoto({ photo, companyId, jobId, privateValues, deps });
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
    const timestamp = new Date(deps.now()).toISOString();
    const beginning = await deps.repository.beginPublication({
      publicationId: deps.newUuid(),
      companyId,
      connectionId: connection.id,
      jobId,
      idempotencyKey,
      message,
      messageSha256,
      publicationKind,
      attachmentId,
      safeMimeType: photo?.mimeType ?? null,
      mediaCount: photo ? 1 : 0,
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
        timestamp: new Date(deps.now()).toISOString(),
      });
    } catch {
      await markDeliveryUnknownBestEffort(deps.repository, {
        publicationId: beginning.publication_id,
        companyId,
        actorAuthUserId: access.actorAuthUserId,
        actorName: access.actorName,
        actorRole: access.actorRole,
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

async function validateAndLoadSinglePhoto({ photo, companyId, jobId, privateValues, deps }) {
  if (!photo) throw new MetaPublishingError('META_PUBLICATION_MEDIA_REQUIRED');
  if (String(photo.company_id) !== companyId || String(photo.job_id) !== jobId) {
    throw new MetaPublishingError('FORBIDDEN');
  }
  const mimeType = String(photo.mime_type ?? '').trim().toLowerCase();
  const sizeBytes = Math.max(0, Number(photo.size_bytes) || 0);
  if (String(photo.kind ?? '').toLowerCase() === 'video' || !supportedFacebookPhotoMimeTypes.has(mimeType)) {
    throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
  }
  if (sizeBytes < 1 || sizeBytes > maxFacebookPhotoBytes) {
    throw new MetaPublishingError('META_PUBLICATION_MEDIA_TOO_LARGE');
  }
  if (!photo.storage_bucket || !photo.storage_path) throw new MetaPublishingError('META_PUBLICATION_MEDIA_REQUIRED');
  try {
    assertPublicationPrivacy(String(photo.name ?? ''), privateValues);
  } catch {
    throw new MetaPublishingError('META_PUBLICATION_MEDIA_PRIVACY_REVIEW_REQUIRED');
  }
  const originalBytes = await deps.repository.downloadAttachmentBytes({
    storageBucket: String(photo.storage_bucket),
    storagePath: String(photo.storage_path),
    maxBytes: maxFacebookPhotoBytes,
  });
  const stripped = stripImageMetadata(originalBytes, mimeType);
  if (!bytesMatchMime(stripped, mimeType)) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
  if (stripped.byteLength < 1 || stripped.byteLength > maxFacebookPhotoBytes) {
    throw new MetaPublishingError('META_PUBLICATION_MEDIA_TOO_LARGE');
  }
  return { attachmentId: String(photo.id), mimeType, bytes: stripped };
}

function bytesMatchMime(bytes, mimeType) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (mimeType === 'image/jpeg') return view[0] === 0xff && view[1] === 0xd8 && view.at(-2) === 0xff && view.at(-1) === 0xd9;
  if (mimeType === 'image/png') return view.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => view[index] === byte);
  if (mimeType === 'image/webp') return view.length > 12 && ascii(view, 0, 4) === 'RIFF' && ascii(view, 8, 12) === 'WEBP';
  return false;
}

function stripImageMetadata(bytes, mimeType) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (mimeType === 'image/jpeg') return stripJpegMetadata(view);
  if (mimeType === 'image/png') return stripPngMetadata(view);
  if (mimeType === 'image/webp') return stripWebpMetadata(view);
  throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
}

function stripJpegMetadata(view) {
  if (!bytesMatchMime(view, 'image/jpeg')) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
  const chunks = [[view[0], view[1]]];
  let offset = 2;
  while (offset + 4 <= view.length) {
    if (view[offset] !== 0xff) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
    const marker = view[offset + 1];
    if (marker === 0xda) {
      chunks.push([...view.slice(offset)]);
      return new Uint8Array(chunks.flat());
    }
    const length = (view[offset + 2] << 8) + view[offset + 3];
    if (length < 2 || offset + 2 + length > view.length) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) chunks.push([...view.slice(offset, offset + 2 + length)]);
    offset += 2 + length;
  }
  throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
}

function stripPngMetadata(view) {
  if (!bytesMatchMime(view, 'image/png')) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
  const chunks = [...view.slice(0, 8)];
  let offset = 8;
  while (offset + 12 <= view.length) {
    const length = readU32(view, offset);
    const type = ascii(view, offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > view.length) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
    const ancillary = type[0] === type[0].toLowerCase();
    if (!ancillary || type === 'tRNS') chunks.push(...view.slice(offset, end));
    offset = end;
    if (type === 'IEND') return new Uint8Array(chunks);
  }
  throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
}

function stripWebpMetadata(view) {
  if (!bytesMatchMime(view, 'image/webp')) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
  const chunks = [...view.slice(0, 12)];
  let offset = 12;
  while (offset + 8 <= view.length) {
    const type = ascii(view, offset, offset + 4);
    const length = readU32Le(view, offset + 4);
    const end = offset + 8 + length + (length % 2);
    if (end > view.length) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
    if (!['EXIF', 'XMP '].includes(type)) chunks.push(...view.slice(offset, end));
    offset = end;
  }
  const output = new Uint8Array(chunks);
  const size = output.length - 8;
  output[4] = size & 0xff;
  output[5] = (size >> 8) & 0xff;
  output[6] = (size >> 16) & 0xff;
  output[7] = (size >> 24) & 0xff;
  return output;
}

function ascii(view, start, end) {
  return String.fromCharCode(...view.slice(start, end));
}

function readU32(view, offset) {
  return ((view[offset] << 24) | (view[offset + 1] << 16) | (view[offset + 2] << 8) | view[offset + 3]) >>> 0;
}

function readU32Le(view, offset) {
  return (view[offset] | (view[offset + 1] << 8) | (view[offset + 2] << 16) | (view[offset + 3] << 24)) >>> 0;
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
