import {
  META_FACEBOOK_PUBLISHING_SCOPE,
  META_PROVIDER,
  PINNED_GRAPH_API_VERSION,
  validEncryptionKey,
} from '../meta-connection/contracts.js';

export const FACEBOOK_PUBLISH_ACTIONS = Object.freeze([
  'status',
  'approve_facebook_publication_photo',
  'revoke_facebook_publication_photo_approval',
  'exclude_facebook_publication_photo',
  'resolve_facebook_publication_photo_false_positive',
  'publish_facebook_text',
  'publish_facebook_single_photo',
  'schedule_facebook_text',
  'schedule_facebook_single_photo',
  'cancel_facebook_scheduled_publication',
]);
export const FACEBOOK_PUBLISH_STAGES = Object.freeze([
  'authorize',
  'validate_request',
  'privacy_review',
  'idempotency_begin',
  'decrypt_connection',
  'facebook_publish',
  'persist_result',
  'schedule_persist',
  'cancel_schedule',
]);
export const FACEBOOK_PROVIDER_CATEGORIES = Object.freeze([
  'INVALID_TOKEN',
  'MISSING_PERMISSION',
  'PAGE_UNAVAILABLE',
  'RATE_LIMITED',
  'PROVIDER_TEMPORARY_ERROR',
  'PROVIDER_REJECTED',
  'DELIVERY_UNKNOWN',
  'RESPONSE_MISSING_POST_ID',
  'RESPONSE_MISSING_MEDIA_ID',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SINGLE_ACTIVE_SCHEDULE_INDEX = 'company_social_publications_one_scheduled_per_job_uidx';
const SAFE_CODES = new Set([
  'OK',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'INVALID_REQUEST',
  'META_PUBLISH_NOT_CONFIGURED',
  'META_PUBLISHING_PERMISSION_MISSING',
  'META_CONNECTION_NEEDS_REAUTHORIZATION',
  'META_PUBLICATION_PRIVACY_REVIEW_REQUIRED',
  'META_PUBLICATION_IN_PROGRESS',
  'META_PUBLICATION_FAILED',
  'META_PUBLICATION_DELIVERY_UNKNOWN',
  'META_PUBLICATION_PROVIDER_REJECTED',
  'META_PUBLICATION_MEDIA_REQUIRED',
  'META_PUBLICATION_MEDIA_UNSUPPORTED',
  'META_PUBLICATION_MEDIA_TOO_LARGE',
  'META_PUBLICATION_MEDIA_PRIVACY_REVIEW_REQUIRED',
  'META_SCHEDULE_ALREADY_ACTIVE',
  'META_SCHEDULE_CANCELLATION_UNAVAILABLE',
  'INTERNAL_ERROR',
]);

export class MetaPublishingError extends Error {
  constructor(code, status = statusForCode(code), diagnostic = null) {
    super(SAFE_CODES.has(code) ? code : 'INTERNAL_ERROR');
    this.name = 'MetaPublishingError';
    this.code = SAFE_CODES.has(code) ? code : 'INTERNAL_ERROR';
    this.status = status;
    this.diagnostic = sanitizeProviderDiagnostic(diagnostic);
  }
}

export function parsePublishingRequest(rawBody, maxBytes = 24_000) {
  if (typeof rawBody !== 'string' || new TextEncoder().encode(rawBody).byteLength > maxBytes) {
    throw new MetaPublishingError('INVALID_REQUEST');
  }
  let value;
  try {
    value = JSON.parse(rawBody || '{}');
  } catch {
    throw new MetaPublishingError('INVALID_REQUEST');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !FACEBOOK_PUBLISH_ACTIONS.includes(value.action)) {
    throw new MetaPublishingError('INVALID_REQUEST');
  }
  const allowed = value.action === 'status'
    ? ['action', 'companyId', 'jobId']
    : value.action === 'approve_facebook_publication_photo'
      ? ['action', 'companyId', 'jobId', 'attachmentId', 'analysisRunId', 'attachmentResultId', 'explicitApproval', 'approvalReason']
      : value.action === 'revoke_facebook_publication_photo_approval'
        ? ['action', 'companyId', 'jobId', 'attachmentId', 'explicitApproval', 'revocationReason']
        : value.action === 'exclude_facebook_publication_photo'
          ? ['action', 'companyId', 'jobId', 'attachmentId', 'analysisRunId', 'attachmentResultId', 'explicitApproval', 'exclusionReason']
          : value.action === 'resolve_facebook_publication_photo_false_positive'
            ? ['action', 'companyId', 'jobId', 'attachmentId', 'analysisRunId', 'attachmentResultId', 'findingIds', 'explicitApproval', 'resolutionReason']
            : value.action === 'cancel_facebook_scheduled_publication'
              ? ['action', 'companyId', 'publicationId', 'explicitApproval']
              : value.action === 'publish_facebook_single_photo'
              ? ['action', 'companyId', 'jobId', 'attachmentId', 'message', 'idempotencyKey', 'explicitApproval']
              : value.action === 'schedule_facebook_single_photo'
                ? ['action', 'companyId', 'jobId', 'attachmentId', 'message', 'idempotencyKey', 'explicitApproval', 'scheduledFor', 'scheduledTimezone']
                : value.action === 'schedule_facebook_text'
                  ? ['action', 'companyId', 'jobId', 'message', 'idempotencyKey', 'explicitApproval', 'scheduledFor', 'scheduledTimezone']
                  : ['action', 'companyId', 'jobId', 'message', 'idempotencyKey', 'explicitApproval'];
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new MetaPublishingError('INVALID_REQUEST');
  return value;
}

export function requireUuid(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!UUID_PATTERN.test(clean)) throw new MetaPublishingError('INVALID_REQUEST');
  return clean;
}

export function normalizeApprovedMessage(value) {
  const canonicalLineEndings = typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    : '';
  if (/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(canonicalLineEndings)) {
    throw new MetaPublishingError('INVALID_REQUEST');
  }
  const clean = canonicalLineEndings.trim();
  const characterCount = Array.from(clean).length;
  if (
    characterCount < 1
    || characterCount > 5000
    || /\[private\]/i.test(clean)
  ) {
    throw new MetaPublishingError('INVALID_REQUEST');
  }
  return clean;
}

export function assertExplicitApproval(value) {
  if (value !== true) throw new MetaPublishingError('INVALID_REQUEST');
}

export function mapActiveSchedulePersistenceError(error) {
  if (String(error?.code ?? '') !== '23505') return null;
  const constraint = typeof error?.constraint === 'string' ? error.constraint : '';
  if (constraint && constraint !== SINGLE_ACTIVE_SCHEDULE_INDEX) return null;
  const message = String(error?.message ?? '').toLowerCase();
  const exactConstraint = `unique constraint "${SINGLE_ACTIVE_SCHEDULE_INDEX}"`;
  const exactIndex = `unique index "${SINGLE_ACTIVE_SCHEDULE_INDEX}"`;
  if (constraint !== SINGLE_ACTIVE_SCHEDULE_INDEX && !message.includes(exactConstraint) && !message.includes(exactIndex)) {
    return null;
  }
  return new MetaPublishingError('META_SCHEDULE_ALREADY_ACTIVE', 409);
}

export function normalizeScheduledPublicationTime(value, timezone, nowMs) {
  const rawScheduledFor = typeof value === 'string' ? value : '';
  const rawScheduledTimezone = typeof timezone === 'string' ? timezone : '';
  const scheduledFor = rawScheduledFor.trim();
  const scheduledTimezone = rawScheduledTimezone.trim();
  if (
    rawScheduledFor !== scheduledFor
    || rawScheduledTimezone !== scheduledTimezone
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(scheduledFor)
    || !Number.isFinite(nowMs)
    || !/^[A-Za-z][A-Za-z0-9_./+-]{0,79}$/.test(scheduledTimezone)
    || scheduledTimezone.includes('..')
    || /[\u0000-\u001f\u007f]/.test(scheduledTimezone)
  ) {
    throw new MetaPublishingError('INVALID_REQUEST');
  }
  const scheduledMs = Date.parse(scheduledFor);
  if (!Number.isFinite(scheduledMs) || scheduledMs <= nowMs || scheduledMs > nowMs + 366 * 24 * 60 * 60 * 1000) {
    throw new MetaPublishingError('INVALID_REQUEST');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: scheduledTimezone }).format(new Date(scheduledMs));
  } catch {
    throw new MetaPublishingError('INVALID_REQUEST');
  }
  return { scheduledFor: new Date(scheduledMs).toISOString(), scheduledTimezone };
}

export function facebookPublishingEnabled(connection) {
  return Boolean(
    connection?.status === 'connected'
      && Array.isArray(connection.granted_scopes)
      && connection.granted_scopes.includes(META_FACEBOOK_PUBLISHING_SCOPE),
  );
}

export const supportedFacebookPhotoMimeTypes = new Set(['image/jpeg', 'image/png']);
export const maxFacebookPhotoBytes = 12_000_000;

export function normalizeApprovalReason(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!clean) return null;
  if (clean.length > 240 || /[<>\u0000-\u001f]/.test(clean)) throw new MetaPublishingError('INVALID_REQUEST');
  return clean;
}

export function normalizeFindingIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new MetaPublishingError('INVALID_REQUEST');
  const ids = value.map((item) => (typeof item === 'string' ? item.trim() : ''));
  if (ids.some((item) => !item || item.length > 120 || !/^[A-Za-z0-9_.:-]+$/.test(item))) {
    throw new MetaPublishingError('INVALID_REQUEST');
  }
  return [...new Set(ids)];
}

export function publicationIntentSource({
  companyId,
  jobId,
  connectionId,
  actorAuthUserId,
  publicationKind,
  approvedMessage,
  attachmentId,
}) {
  return [
    'facebook_publication_intent_v1',
    'meta-facebook-login',
    'Facebook',
    companyId,
    jobId,
    connectionId,
    actorAuthUserId,
    publicationKind,
    approvedMessage,
    publicationKind === 'single_photo' ? attachmentId : '',
  ].join('\n');
}

export function publicationKindForAction(action) {
  return ['publish_facebook_single_photo', 'schedule_facebook_single_photo'].includes(action) ? 'single_photo' : 'text_only';
}

export function runtimePublishingConfig(getEnv) {
  const graphApiVersion = cleanEnv(getEnv('META_GRAPH_API_VERSION'));
  const appSecret = cleanEnv(getEnv('META_APP_SECRET'));
  const encryptionKey = cleanEnv(getEnv('META_TOKEN_ENCRYPTION_KEY_V1'));
  return {
    configured: graphApiVersion === PINNED_GRAPH_API_VERSION && Boolean(appSecret) && validEncryptionKey(encryptionKey),
    graphApiVersion,
    appSecret,
    encryptionKey,
    timeoutMs: boundedNumber(getEnv('META_REQUEST_TIMEOUT_MS'), 3000, 15_000, 8000),
  };
}

export function safePublishingStatus({ config, connection, lastPublication, activeScheduledPublication, eligiblePhotos = [] }) {
  const enabled = facebookPublishingEnabled(connection);
  return {
    ok: true,
    configured: config.configured,
    connected: connection?.status === 'connected',
    facebookPageName: safeLabel(connection?.facebook_page_name, 120),
    facebookPublishingEnabled: enabled,
    missingPermissions: enabled ? [] : [META_FACEBOOK_PUBLISHING_SCOPE],
    lastPublication: lastPublication ? safePublicationSummary(lastPublication) : null,
    activeScheduledPublication: safeActiveScheduledPublication(activeScheduledPublication),
    eligiblePhotos: Array.isArray(eligiblePhotos) ? eligiblePhotos.map(safeEligiblePhoto).filter(Boolean) : [],
  };
}

export function safeScheduledPublicationResult(row, publicationKind = row?.publication_kind) {
  const status = safePublicationStatus(row?.publication_status ?? row?.status);
  const publicationId = safeUuid(row?.publication_id ?? row?.id);
  return {
    ok: true,
    status,
    publicationId: status === 'scheduled' ? publicationId : null,
    scheduledFor: safeTimestamp(row?.publication_scheduled_for ?? row?.scheduled_for),
    scheduledTimezone: safeTimezone(row?.scheduled_timezone),
    publicationKind: safePublicationKind(publicationKind),
    errorCode: safeCode(row?.publication_last_error_code ?? row?.last_error_code),
  };
}

export function safePublicationResult(row) {
  return {
    ok: row?.status === 'published',
    status: safePublicationStatus(row?.status),
    approvedAt: safeTimestamp(row?.approved_at),
    publishedAt: safeTimestamp(row?.published_at),
    errorCode: safeCode(row?.last_error_code),
  };
}

export function sanitizeProviderDiagnostic(value) {
  return {
    providerHttpStatus: safeInteger(value?.providerHttpStatus, 100, 599),
    providerCode: safeInteger(value?.providerCode, -2_147_483_648, 2_147_483_647),
    providerSubcode: safeInteger(value?.providerSubcode, -2_147_483_648, 2_147_483_647),
    providerCategory: FACEBOOK_PROVIDER_CATEGORIES.includes(value?.providerCategory) ? value.providerCategory : null,
    providerIsTransient: typeof value?.providerIsTransient === 'boolean' ? value.providerIsTransient : null,
  };
}

export function safePublishingTelemetry(event) {
  const diagnostic = sanitizeProviderDiagnostic(event);
  return {
    event: 'meta-social-publish',
    action: FACEBOOK_PUBLISH_ACTIONS.includes(event?.action) ? event.action : 'unknown',
    success: event?.success === true,
    code: safeCode(event?.code) ?? 'INTERNAL_ERROR',
    stage: FACEBOOK_PUBLISH_STAGES.includes(event?.stage) ? event.stage : 'authorize',
    attempts: event?.attempts === 1 ? 1 : 0,
    latencyMs: Number.isFinite(event?.latencyMs) ? Math.max(0, Math.round(event.latencyMs)) : 0,
    ...diagnostic,
  };
}

export function statusForCode(code) {
  if (code === 'AUTH_REQUIRED') return 401;
  if (code === 'FORBIDDEN') return 403;
  if (code === 'META_PUBLICATION_IN_PROGRESS' || code === 'META_SCHEDULE_ALREADY_ACTIVE') return 409;
  if (code === 'META_PUBLISH_NOT_CONFIGURED' || code === 'INTERNAL_ERROR') return 500;
  return 400;
}

export { META_PROVIDER, PINNED_GRAPH_API_VERSION };

function safePublicationSummary(value) {
  const status = safePublicationStatus(value?.status);
  return {
    status,
    approvedAt: safeTimestamp(value?.approved_at),
    publishedAt: safeTimestamp(value?.published_at),
    errorCode: safeCode(value?.last_error_code),
    publicationId: status === 'scheduled' ? safeUuid(value?.id) : null,
    scheduledFor: safeTimestamp(value?.scheduled_for),
    scheduledTimezone: safeTimezone(value?.scheduled_timezone),
    publicationKind: safePublicationKind(value?.publication_kind),
  };
}

function safeActiveScheduledPublication(value) {
  if (value?.status !== 'scheduled') return null;
  const summary = safePublicationSummary(value);
  return {
    status: summary.status,
    publicationId: summary.publicationId,
    scheduledFor: summary.scheduledFor,
    scheduledTimezone: summary.scheduledTimezone,
    publicationKind: summary.publicationKind,
    errorCode: summary.errorCode,
  };
}

function safePublicationStatus(value) {
  return ['scheduled', 'publishing', 'published', 'failed', 'delivery_unknown', 'cancelled'].includes(value) ? value : 'failed';
}

function safeTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function safeCode(value) {
  return typeof value === 'string' && /^[A-Z0-9_]{2,80}$/.test(value) ? value : null;
}

function safeUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

function safeTimezone(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z][A-Za-z0-9_./+-]{0,79}$/.test(clean) && !clean.includes('..') ? clean : null;
}

function safePublicationKind(value) {
  return ['text_only', 'single_photo'].includes(value) ? value : null;
}

function safeLabel(value, maxLength) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return clean && clean.length <= maxLength && !/[<>\u0000-\u001f]/.test(clean) ? clean : null;
}

function safeUrl(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!clean || clean.length > 2048 || /[\u0000-\u001f<>]/.test(clean)) return null;
  try {
    const url = new URL(clean);
    return url.protocol === 'https:' ? clean : null;
  } catch {
    return null;
  }
}

function safeEligiblePhoto(value) {
  const attachmentId = typeof value?.attachmentId === 'string' && UUID_PATTERN.test(value.attachmentId) ? value.attachmentId : null;
  if (!attachmentId) return null;
  return {
    attachmentId,
    displayName: safeLabel(value?.displayName, 120) ?? 'Approved photo',
    previewUrl: safeUrl(value?.previewUrl),
    mimeType: supportedFacebookPhotoMimeTypes.has(value?.mimeType) ? value.mimeType : 'image/jpeg',
    approvalStatus: ['approved', 'revoked', 'pending'].includes(value?.approvalStatus) ? value.approvalStatus : 'pending',
    approvedAt: safeTimestamp(value?.approvedAt),
    revokedAt: safeTimestamp(value?.revokedAt),
    analysisRunId: typeof value?.analysisRunId === 'string' && UUID_PATTERN.test(value.analysisRunId) ? value.analysisRunId : null,
    attachmentResultId: typeof value?.attachmentResultId === 'string' && UUID_PATTERN.test(value.attachmentResultId) ? value.attachmentResultId : null,
    analysisStatus: ['completed', 'missing', 'failed'].includes(value?.analysisStatus) ? value.analysisStatus : 'missing',
    privacyReviewStatus: ['passed', 'blocked', 'resolved_false_positive'].includes(value?.privacyReviewStatus) ? value.privacyReviewStatus : 'blocked',
    checksumMatch: value?.checksumMatch === true,
    eligibleForFacebookPublication: value?.eligibleForFacebookPublication === true,
  };
}

function cleanEnv(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function boundedNumber(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function safeInteger(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}
