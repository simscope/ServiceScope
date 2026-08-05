import {
  META_FACEBOOK_PUBLISHING_SCOPE,
  META_PROVIDER,
  PINNED_GRAPH_API_VERSION,
  validEncryptionKey,
} from '../meta-connection/contracts.js';

export const FACEBOOK_PUBLISH_ACTIONS = Object.freeze(['status', 'approve_facebook_publication_photo', 'publish_facebook_text', 'publish_facebook_single_photo']);
export const FACEBOOK_PUBLISH_STAGES = Object.freeze([
  'authorize',
  'validate_request',
  'privacy_review',
  'idempotency_begin',
  'decrypt_connection',
  'facebook_publish',
  'persist_result',
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
      ? ['action', 'companyId', 'jobId', 'attachmentId', 'explicitApproval', 'approvalReason']
      : value.action === 'publish_facebook_single_photo'
        ? ['action', 'companyId', 'jobId', 'attachmentId', 'message', 'idempotencyKey', 'explicitApproval']
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
  return action === 'publish_facebook_single_photo' ? 'single_photo' : 'text_only';
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

export function safePublishingStatus({ config, connection, lastPublication }) {
  const enabled = facebookPublishingEnabled(connection);
  return {
    ok: true,
    configured: config.configured,
    connected: connection?.status === 'connected',
    facebookPageName: safeLabel(connection?.facebook_page_name, 120),
    facebookPublishingEnabled: enabled,
    missingPermissions: enabled ? [] : [META_FACEBOOK_PUBLISHING_SCOPE],
    lastPublication: lastPublication ? {
      status: safePublicationStatus(lastPublication.status),
      approvedAt: safeTimestamp(lastPublication.approved_at),
      publishedAt: safeTimestamp(lastPublication.published_at),
      errorCode: safeCode(lastPublication.last_error_code),
    } : null,
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
  if (code === 'META_PUBLICATION_IN_PROGRESS') return 409;
  if (code === 'META_PUBLISH_NOT_CONFIGURED' || code === 'INTERNAL_ERROR') return 500;
  return 400;
}

export { META_PROVIDER, PINNED_GRAPH_API_VERSION };

function safePublicationStatus(value) {
  return ['publishing', 'published', 'failed', 'delivery_unknown'].includes(value) ? value : 'failed';
}

function safeTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function safeCode(value) {
  return typeof value === 'string' && /^[A-Z0-9_]{2,80}$/.test(value) ? value : null;
}

function safeLabel(value, maxLength) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return clean && clean.length <= maxLength && !/[<>\u0000-\u001f]/.test(clean) ? clean : null;
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
