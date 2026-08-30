export type FacebookPublicationStatus = 'scheduled' | 'publishing' | 'published' | 'failed' | 'delivery_unknown' | 'cancelled';
export type FacebookPublicationKind = 'text_only' | 'single_photo' | 'reel_video';
export type FacebookReelProviderStage = 'upload_initializing' | 'uploading' | 'finalizing' | 'provider_processing' | 'published' | 'failed' | 'delivery_unknown';

export type FacebookPublicationSummary = {
  status: FacebookPublicationStatus;
  approvedAt: string | null;
  publishedAt: string | null;
  errorCode: string | null;
  publicationId?: string | null;
  scheduledFor?: string | null;
  scheduledTimezone?: string | null;
  publicationKind?: FacebookPublicationKind | null;
  providerStage?: FacebookReelProviderStage | null;
  renderJobId?: string | null;
};

export type FacebookActiveScheduledPublication = {
  status: 'scheduled';
  publicationId: string | null;
  scheduledFor: string | null;
  scheduledTimezone: string | null;
  publicationKind: FacebookPublicationKind | null;
  errorCode: string | null;
};

export type FacebookPublishingSnapshot = {
  ok: true;
  configured: boolean;
  connected: boolean;
  facebookPageName: string | null;
  facebookPublishingEnabled: boolean;
  missingPermissions: string[];
  lastPublication: FacebookPublicationSummary | null;
  activeScheduledPublication: FacebookActiveScheduledPublication | null;
  eligiblePhotos: Array<{
    attachmentId: string;
    displayName: string;
    previewUrl: string | null;
    mimeType: 'image/jpeg' | 'image/png';
    approvalStatus: 'approved' | 'revoked' | 'pending';
    approvedAt: string | null;
    revokedAt: string | null;
    analysisRunId: string | null;
    attachmentResultId: string | null;
    analysisStatus: 'completed' | 'missing' | 'failed';
    privacyReviewStatus: 'passed' | 'blocked' | 'resolved_false_positive';
    checksumMatch: boolean;
    eligibleForFacebookPublication: boolean;
  }>;
};

export type FacebookPublishResult = FacebookPublicationSummary & {
  ok: boolean;
};

export type FacebookReelPublishResult = FacebookPublishResult & {
  publicationId: string | null;
  publicationKind: 'reel_video';
  providerStage: FacebookReelProviderStage | null;
};

export type FacebookScheduledPublicationResult = FacebookPublicationSummary & {
  ok: true;
  publicationId: string | null;
  scheduledFor: string | null;
  scheduledTimezone: string | null;
  publicationKind: FacebookPublicationKind | null;
};

export const FACEBOOK_PUBLISH_ERROR_MESSAGES: Record<string, string> = {
  META_PUBLISHING_PERMISSION_MISSING: 'Publishing permission is not enabled. Reconnect Meta to add Facebook Page publishing access.',
  META_CONNECTION_NEEDS_REAUTHORIZATION: 'The Facebook Page connection needs to be reauthorized.',
  META_PUBLICATION_PRIVACY_REVIEW_REQUIRED: 'The final text contains information that requires privacy review.',
  META_PUBLICATION_IN_PROGRESS: 'This publication is already in progress.',
  META_PUBLICATION_FAILED: 'Facebook did not accept this publication.',
  META_PUBLICATION_PROVIDER_REJECTED: 'Facebook rejected this publication.',
  META_PUBLICATION_DELIVERY_UNKNOWN: 'Facebook did not confirm whether the post was published. Check the Page before attempting any new publication.',
  META_PUBLICATION_MEDIA_REQUIRED: 'Select one approved photo before publishing.',
  META_PUBLICATION_MEDIA_UNSUPPORTED: 'The selected photo type is not supported for Facebook publishing.',
  META_PUBLICATION_MEDIA_TOO_LARGE: 'The selected photo exceeds the publishing limit.',
  META_PUBLICATION_MEDIA_PRIVACY_REVIEW_REQUIRED: 'The selected photo needs privacy review before publishing.',
  META_PUBLICATION_ACTIVE_CONFLICT: 'Another Facebook publication for this job is already scheduled, publishing, or awaiting delivery confirmation.',
  META_REEL_RENDER_REQUIRED: 'A completed Reel render is required before publishing.',
  META_REEL_RENDER_INVALID: 'The completed Reel no longer matches its verified artifact.',
  META_REEL_STATUS_CHECK_LIMIT_REACHED: 'Facebook processing still needs manual review. No additional automatic checks will run.',
  META_REEL_PUBLICATION_ABANDONED: 'This Reel attempt was closed locally after delivery could not be confirmed. A new publication requires fresh approval.',
  META_SCHEDULE_CANCELLATION_UNAVAILABLE: 'This scheduled publication can no longer be cancelled.',
};

const UNSAFE_PUBLISHING_CONTROL_PATTERN = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/;

export function normalizeFacebookPublishingMessage(value: string) {
  const withCanonicalLineEndings = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (UNSAFE_PUBLISHING_CONTROL_PATTERN.test(withCanonicalLineEndings)) throw new Error('INVALID_REQUEST');
  const normalized = withCanonicalLineEndings.trim();
  const characterCount = Array.from(normalized).length;
  if (
    characterCount < 1
    || characterCount > 5000
    || /\[private\]/i.test(normalized)
  ) {
    throw new Error('INVALID_REQUEST');
  }
  return normalized;
}

export function facebookPublishingCharacterCount(value: string) {
  return Array.from(value).length;
}

export function publishingErrorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : 'INTERNAL_ERROR';
}

export function normalizePublishingError(error: unknown) {
  const code = publishingErrorCode(error);
  return FACEBOOK_PUBLISH_ERROR_MESSAGES[code] ?? 'The Facebook publication could not be completed.';
}

export function browserFacebookScheduleTimezone() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return timezone || 'UTC';
}

export function facebookScheduledForUtc(localDateTime: string) {
  const clean = localDateTime.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(clean)) return null;
  const parsed = new Date(clean);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function formatFacebookScheduledTime(scheduledFor: string, timezone: string) {
  const parsed = new Date(scheduledFor);
  if (!Number.isFinite(parsed.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parsed);
  } catch {
    return '';
  }
}
