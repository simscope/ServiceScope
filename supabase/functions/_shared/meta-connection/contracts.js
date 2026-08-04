export const META_PROVIDER = 'meta-facebook-login';
export const PINNED_GRAPH_API_VERSION = 'v25.0';
export const META_REQUESTED_SCOPES = Object.freeze([
  'pages_show_list',
  'pages_read_engagement',
  'instagram_basic',
]);
export const META_ACTIONS = Object.freeze([
  'status',
  'start',
  'complete',
  'select_asset',
  'check_health',
  'disconnect',
]);
export const META_FACEBOOK_PUBLISHING_SCOPE = 'pages_manage_posts';
export const META_AUTHORIZATION_INTENTS = Object.freeze(['facebook_publishing']);
export const META_ALLOWED_SCOPES = Object.freeze([
  ...META_REQUESTED_SCOPES,
  META_FACEBOOK_PUBLISHING_SCOPE,
]);
export const META_TOKEN_EXCHANGE_PHASES = Object.freeze([
  'short_token_exchange',
  'long_token_exchange',
]);
export const META_PROVIDER_ERROR_CATEGORIES = Object.freeze([
  'INVALID_CLIENT_CREDENTIALS',
  'REDIRECT_URI_MISMATCH',
  'INVALID_OR_EXPIRED_CODE',
  'CODE_ALREADY_USED',
  'UNSUPPORTED_GRANT_OR_PARAMETER',
  'APP_CONFIGURATION_ERROR',
  'PROVIDER_RATE_LIMIT',
  'PROVIDER_TEMPORARY_ERROR',
  'SUCCESS_RESPONSE_MISSING_TOKEN',
  'UNKNOWN_PROVIDER_REJECTION',
]);
export const META_RETURN_PATHS = Object.freeze(['/settings/social-connections']);
export const META_OAUTH_STATE_TTL_MS = 30 * 60_000;

const AUTH_USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BEARER_JWT_PATTERN = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

const NORMALIZED_CODES = new Set([
  'OK',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'INVALID_REQUEST',
  'META_NOT_CONFIGURED',
  'OAUTH_STATE_INVALID',
  'OAUTH_STATE_EXPIRED',
  'OAUTH_STATE_REPLAYED',
  'OAUTH_PROVIDER_ERROR',
  'OAUTH_CODE_EXCHANGE_FAILED',
  'META_PERMISSION_MISSING',
  'META_NO_PAGES',
  'META_ASSET_NOT_FOUND',
  'META_TOKEN_INVALID',
  'META_RATE_LIMITED',
  'META_PROVIDER_TIMEOUT',
  'META_PROVIDER_UNAVAILABLE',
  'META_PAGE_DISCOVERY_LIMIT',
  'META_PAGE_UNAVAILABLE',
  'META_INSTAGRAM_ACCOUNT_MISMATCH',
  'CONNECTION_NOT_FOUND',
  'CONNECTION_NEEDS_REAUTHORIZATION',
  'INTERNAL_ERROR',
]);

export class MetaConnectionError extends Error {
  constructor(code, status = statusForCode(code), providerDiagnostic = null) {
    super(NORMALIZED_CODES.has(code) ? code : 'INTERNAL_ERROR');
    this.name = 'MetaConnectionError';
    this.code = NORMALIZED_CODES.has(code) ? code : 'INTERNAL_ERROR';
    this.status = status;
    if (providerDiagnostic) Object.assign(this, sanitizeMetaProviderDiagnostic(providerDiagnostic));
  }
}

export function sanitizeMetaProviderDiagnostic(value) {
  return {
    providerPhase: META_TOKEN_EXCHANGE_PHASES.includes(value?.providerPhase) ? value.providerPhase : null,
    providerHttpStatus: safeInteger(value?.providerHttpStatus, 100, 599),
    providerCode: safeInteger(value?.providerCode, -2_147_483_648, 2_147_483_647),
    providerSubcode: safeInteger(value?.providerSubcode, -2_147_483_648, 2_147_483_647),
    providerCategory: META_PROVIDER_ERROR_CATEGORIES.includes(value?.providerCategory) ? value.providerCategory : null,
    providerIsTransient: typeof value?.providerIsTransient === 'boolean' ? value.providerIsTransient : null,
    providerAttempts: value?.providerAttempts === 1 || value?.providerAttempts === 2 ? value.providerAttempts : null,
  };
}

export function statusForCode(code) {
  if (code === 'AUTH_REQUIRED') return 401;
  if (code === 'FORBIDDEN') return 403;
  if (code === 'CONNECTION_NOT_FOUND' || code === 'META_ASSET_NOT_FOUND') return 404;
  if (code === 'META_RATE_LIMITED') return 429;
  if (code === 'META_NOT_CONFIGURED' || code === 'INTERNAL_ERROR') return 500;
  return 400;
}

export function parseActionRequest(rawBody, maxBytes = 32_768) {
  if (typeof rawBody !== 'string' || new TextEncoder().encode(rawBody).byteLength > maxBytes) {
    throw new MetaConnectionError('INVALID_REQUEST');
  }
  let value;
  try {
    value = JSON.parse(rawBody || '{}');
  } catch {
    throw new MetaConnectionError('INVALID_REQUEST');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !META_ACTIONS.includes(value.action)) {
    throw new MetaConnectionError('INVALID_REQUEST');
  }
  const allowedKeys = {
    status: ['action', 'companyId'],
    start: ['action', 'companyId', 'returnPath', 'authorizationIntent'],
    complete: ['action', 'code', 'state', 'providerError', 'providerErrorReason'],
    select_asset: ['action', 'companyId', 'oauthSessionId', 'pageId'],
    check_health: ['action', 'companyId', 'connectionId'],
    disconnect: ['action', 'companyId', 'connectionId'],
  }[value.action];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new MetaConnectionError('INVALID_REQUEST');
  }
  if (
    value.action === 'start'
    && value.authorizationIntent !== undefined
    && !META_AUTHORIZATION_INTENTS.includes(value.authorizationIntent)
  ) {
    throw new MetaConnectionError('INVALID_REQUEST');
  }
  return value;
}

export function requireUuid(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!AUTH_USER_ID_PATTERN.test(clean)) {
    throw new MetaConnectionError('INVALID_REQUEST');
  }
  return clean;
}

export function requireBearerJwt(authorization) {
  const match = typeof authorization === 'string' ? authorization.match(BEARER_JWT_PATTERN) : null;
  if (!match) throw new MetaConnectionError('AUTH_REQUIRED');
  return match[1];
}

export function requireVerifiedAuthUserId(result) {
  const userId = result?.error ? '' : result?.data?.user?.id;
  if (typeof userId !== 'string' || !AUTH_USER_ID_PATTERN.test(userId)) {
    throw new MetaConnectionError('AUTH_REQUIRED');
  }
  return userId;
}

export function requireActiveDomainSession(session, error) {
  if (error || !session?.user_id || session.status !== 'active') {
    throw new MetaConnectionError('AUTH_REQUIRED');
  }
  return session;
}

export function assertMetaAccessRole(session, requestedCompanyId) {
  const kind = String(session?.kind ?? '');
  const role = String(session?.role ?? '');
  if (kind === 'owner' && role === 'owner') return;
  if (
    kind === 'company'
    && String(session?.company_id ?? '') === requestedCompanyId
    && (role === 'admin' || role === 'manager')
  ) return;
  throw new MetaConnectionError('FORBIDDEN');
}

export function optionalUuid(value) {
  if (value === undefined || value === null || value === '') return null;
  return requireUuid(value);
}

export function requireShortString(value, maxLength = 2048) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!clean || clean.length > maxLength || /[\u0000-\u001f]/.test(clean)) {
    throw new MetaConnectionError('INVALID_REQUEST');
  }
  return clean;
}

export function normalizeReturnPath(value) {
  const clean = requireShortString(value, 100);
  if (!META_RETURN_PATHS.includes(clean)) throw new MetaConnectionError('INVALID_REQUEST');
  return clean;
}

export function returnDestinationForPath(value) {
  return normalizeReturnPath(value) === '/settings/social-connections' ? 'social_connections' : null;
}

export function normalizeProviderErrorFields(body) {
  const error = typeof body.providerError === 'string' ? body.providerError.trim().slice(0, 80) : '';
  const reason = typeof body.providerErrorReason === 'string' ? body.providerErrorReason.trim().slice(0, 80) : '';
  return error ? { error, reason } : null;
}

export function runtimeConfigFromEnv(getEnv) {
  const graphApiVersion = cleanEnv(getEnv('META_GRAPH_API_VERSION'));
  const redirectUri = cleanEnv(getEnv('META_OAUTH_REDIRECT_URI'));
  const appId = cleanEnv(getEnv('META_APP_ID'));
  const appSecret = cleanEnv(getEnv('META_APP_SECRET'));
  const loginConfigurationId = cleanEnv(getEnv('META_LOGIN_CONFIGURATION_ID'));
  const encryptionKey = cleanEnv(getEnv('META_TOKEN_ENCRYPTION_KEY_V1'));
  const configured = Boolean(
    validNumericId(appId)
      && appSecret
      && validNumericId(loginConfigurationId)
      && validEncryptionKey(encryptionKey)
      && validRedirectUri(redirectUri)
      && graphApiVersion === PINNED_GRAPH_API_VERSION
  );
  return {
    configured,
    provider: META_PROVIDER,
    graphApiVersion,
    redirectUri,
    appId,
    appSecret,
    loginConfigurationId,
    encryptionKey,
    timeoutMs: boundedNumber(getEnv('META_REQUEST_TIMEOUT_MS'), 3000, 15_000, 8000),
  };
}

export function assertRuntimeConfigured(config) {
  if (!config?.configured) throw new MetaConnectionError('META_NOT_CONFIGURED');
  return config;
}

export function safeAsset(asset) {
  const pageId = safeProviderId(asset?.pageId);
  const pageName = safeLabel(asset?.pageName, 120);
  if (!pageId || !pageName) throw new MetaConnectionError('OAUTH_PROVIDER_ERROR');
  const tasks = Array.isArray(asset?.tasks)
    ? [...new Set(asset.tasks.map((task) => safeScope(task)).filter(Boolean))].slice(0, 30)
    : [];
  const instagram = asset?.instagram && typeof asset.instagram === 'object'
    ? {
        accountId: safeProviderId(asset.instagram.accountId),
        username: safeUsername(asset.instagram.username),
        accountType: asset.instagram.accountType === 'BUSINESS' || asset.instagram.accountType === 'CREATOR'
          ? asset.instagram.accountType
          : null,
      }
    : null;
  const validInstagram = instagram?.accountId && instagram.username && instagram.accountType ? instagram : null;
  return {
    provider: META_PROVIDER,
    pageId,
    pageName,
    permittedTasks: tasks,
    instagram: validInstagram,
    connectionEligibility: validInstagram ? 'facebook_and_instagram' : 'facebook_only',
  };
}

export function normalizeGrantedScopes(scopes) {
  if (!Array.isArray(scopes)) return [];
  return [...new Set(scopes.map((scope) => safeScope(scope)).filter((scope) => META_ALLOWED_SCOPES.includes(scope)))];
}

export function assertRequiredScopes(scopes) {
  const granted = normalizeGrantedScopes(scopes);
  if (META_REQUESTED_SCOPES.some((scope) => !granted.includes(scope))) {
    throw new MetaConnectionError('META_PERMISSION_MISSING');
  }
  return granted;
}

export function safeConnection(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: META_PROVIDER,
    status: row.status,
    facebookPageId: row.facebook_page_id,
    facebookPageName: row.facebook_page_name,
    instagramAccountId: row.instagram_account_id ?? null,
    instagramUsername: row.instagram_username ?? null,
    instagramAccountType: row.instagram_account_type ?? null,
    grantedScopes: normalizeGrantedScopes(row.granted_scopes),
    connectedAt: row.connected_at ?? null,
    lastCheckedAt: row.last_checked_at ?? null,
    lastErrorCode: NORMALIZED_CODES.has(row.last_error_code) ? row.last_error_code : null,
    tokenExpiryStatus: expiryStatus(row.token_expires_at),
  };
}

export function safePending(row) {
  if (!row) return null;
  const assets = Array.isArray(row.discovered_assets) ? row.discovered_assets.map(safeAsset) : [];
  return { oauthSessionId: row.id, status: 'pending_asset_selection', expiresAt: row.expires_at, assets };
}

export function safeTelemetry(event) {
  const providerDiagnostic = event?.action === 'complete'
    ? sanitizeMetaProviderDiagnostic(event)
    : sanitizeMetaProviderDiagnostic(null);
  return {
    event: 'meta-social-connection',
    action: META_ACTIONS.includes(event?.action) ? event.action : 'unknown',
    success: event?.success === true,
    code: NORMALIZED_CODES.has(event?.code) ? event.code : 'INTERNAL_ERROR',
    provider: META_PROVIDER,
    stage: safeLabel(event?.stage, 60) || 'unknown',
    attempts: Number.isInteger(event?.attempts) ? Math.max(0, Math.min(12, event.attempts)) : 0,
    latencyMs: Number.isFinite(event?.latencyMs) ? Math.max(0, Math.round(event.latencyMs)) : 0,
    providerPhase: providerDiagnostic.providerPhase,
    providerHttpStatus: providerDiagnostic.providerHttpStatus,
    providerCode: providerDiagnostic.providerCode,
    providerSubcode: providerDiagnostic.providerSubcode,
    providerCategory: providerDiagnostic.providerCategory,
    providerIsTransient: providerDiagnostic.providerIsTransient,
  };
}

function expiryStatus(value) {
  if (!value) return 'unknown';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'unknown';
  return timestamp <= Date.now() ? 'expired' : 'valid';
}

function validRedirectUri(value) {
  try {
    const url = new URL(value);
    const secureOrigin = url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1');
    return secureOrigin
      && url.pathname === '/auth/meta/callback'
      && !url.search
      && !url.hash
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function decodeEncryptionKey(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!clean || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(clean)) throw new MetaConnectionError('META_NOT_CONFIGURED');
  try {
    const normalized = clean.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new MetaConnectionError('META_NOT_CONFIGURED');
  }
}

export function validEncryptionKey(value) {
  try {
    return decodeEncryptionKey(value).byteLength === 32;
  } catch {
    return false;
  }
}

function safeProviderId(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return /^[0-9]{1,40}$/.test(clean) ? clean : '';
}

function validNumericId(value) {
  return /^[0-9]{5,40}$/.test(value);
}

function safeUsername(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9._]{1,80}$/.test(clean) ? clean : '';
}

function safeScope(value) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_]{1,80}$/.test(clean) ? clean : '';
}

function safeLabel(value, maxLength) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return clean && clean.length <= maxLength && !/[<>\u0000-\u001f]/.test(clean) ? clean : '';
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
