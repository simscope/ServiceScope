import {
  MetaPublishingError,
  maxFacebookPhotoBytes,
  supportedFacebookPhotoMimeTypes,
} from './contracts.js';
import { assertPublicationPrivacy } from './privacy.js';

export async function prepareFacebookPublicationPhoto({
  photo,
  companyId,
  jobId,
  privateValues,
  deps,
  expectedOriginalSha256 = null,
  approval = null,
  revalidateEligibility = null,
}) {
  const validated = validateFacebookPublicationPhotoAttachment({ photo, companyId, jobId, privateValues });
  const originalBytes = await deps.repository.downloadAttachmentBytes({
    storageBucket: String(validated.storage_bucket),
    storagePath: String(validated.storage_path),
    maxBytes: maxFacebookPhotoBytes,
  });
  const originalSha256 = await sha256Hex(originalBytes, deps.cryptoApi);
  if (expectedOriginalSha256 !== null && originalSha256 !== expectedOriginalSha256) {
    throw new MetaPublishingError('META_PUBLICATION_MEDIA_PRIVACY_REVIEW_REQUIRED');
  }

  let exactApproval = approval;
  if (revalidateEligibility) {
    const eligibility = await revalidateEligibility(originalSha256);
    if (!eligibility?.eligibleForFacebookPublication || !eligibility.approval) {
      throw new MetaPublishingError('META_PUBLICATION_MEDIA_PRIVACY_REVIEW_REQUIRED');
    }
    exactApproval = eligibility.approval;
  }
  if (!exactApproval) throw new MetaPublishingError('META_PUBLICATION_MEDIA_PRIVACY_REVIEW_REQUIRED');

  const processor = deps.imageProcessor;
  if (!processor?.sanitize) throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
  const sanitized = await processor.sanitize({
    bytes: originalBytes,
    mimeType: validated.mimeType,
    maxBytes: maxFacebookPhotoBytes,
    maxPixels: 40_000_000,
    maxWidth: 10_000,
    maxHeight: 10_000,
  });
  if (!sanitized || !supportedFacebookPhotoMimeTypes.has(sanitized.mimeType) || sanitized.bytes?.byteLength < 1) {
    throw new MetaPublishingError('META_PUBLICATION_MEDIA_UNSUPPORTED');
  }
  if (sanitized.bytes.byteLength > maxFacebookPhotoBytes) {
    throw new MetaPublishingError('META_PUBLICATION_MEDIA_TOO_LARGE');
  }
  const sanitizedSha256 = await sha256Hex(sanitized.bytes, deps.cryptoApi);
  return {
    attachmentId: String(validated.id),
    mimeType: sanitized.mimeType,
    bytes: sanitized.bytes,
    approval: exactApproval,
    originalSha256,
    auditMetadata: {
      attachmentId: String(validated.id),
      analysisRunId: safeAuditString(exactApproval.analysis_run_id),
      approvalId: safeAuditString(exactApproval.id),
      approvedAt: safeAuditString(exactApproval.approved_at),
      revoked: false,
      originalMime: validated.mimeType,
      detectedMime: sanitized.detectedMimeType ?? sanitized.mimeType,
      sanitizedMime: sanitized.mimeType,
      originalByteSize: originalBytes.byteLength,
      sanitizedByteSize: sanitized.bytes.byteLength,
      originalHashPrefix: hexPrefix(originalSha256),
      sanitizedHashPrefix: hexPrefix(sanitizedSha256),
      width: Number(sanitized.width) || null,
      height: Number(sanitized.height) || null,
      metadataStripped: true,
      gpsStripped: true,
      sanitizer: sanitized.sanitizer ?? 'ImageScript',
      sanitizerVersion: sanitized.sanitizerVersion ?? '1.3.0',
      providerCallCount: 0,
    },
  };
}

export function validateFacebookPublicationPhotoAttachment({ photo, companyId, jobId, privateValues }) {
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
  return { ...photo, mimeType };
}

export async function sha256Hex(value, cryptoApi) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
  const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
  return `\\x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function hexPrefix(byteaHex, length = 16) {
  return typeof byteaHex === 'string' && byteaHex.startsWith('\\x') ? byteaHex.slice(2, 2 + length) : null;
}

function safeAuditString(value) {
  return typeof value === 'string' && value.length <= 200 ? value : null;
}
