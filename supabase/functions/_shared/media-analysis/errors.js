import { mediaErrorCodes, nonRetryableProviderCodes, retryableProviderCodes } from './contracts.js';

export class MediaAnalysisError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    this.status = details.status ?? statusForMediaCode(code);
    this.retryable = details.retryable ?? isRetryableMediaCode(code);
    this.httpStatus = details.httpStatus;
    this.providerRequestId = details.providerRequestId;
    this.providerErrorType = details.providerErrorType;
    this.providerErrorCode = details.providerErrorCode;
    this.attempts = details.attempts;
    this.latencyMs = details.latencyMs;
    this.details = details.details;
    if (details.cause) this.cause = details.cause;
  }
}

export function normalizeMediaErrorCode(error) {
  const code = error?.code ?? (error instanceof Error ? error.message : String(error));
  if (mediaErrorCodes.includes(code)) return code;
  if (code === 'AUTH_REQUIRED') return 'AUTH_REQUIRED';
  if (code === 'FORBIDDEN') return 'FORBIDDEN';
  if (code === 'UNSUPPORTED_STATUS') return 'UNSUPPORTED_STATUS';
  if (code === 'INVALID_REQUEST') return 'INVALID_REQUEST';
  return 'MEDIA_PROVIDER_UNAVAILABLE';
}

export function isRetryableMediaCode(code) {
  if (retryableProviderCodes.has(code)) return true;
  if (nonRetryableProviderCodes.has(code)) return false;
  return false;
}

export function statusForMediaCode(code) {
  if (code === 'AUTH_REQUIRED') return 401;
  if (code === 'FORBIDDEN' || code === 'MEDIA_WRONG_TENANT') return 404;
  if (code === 'MEDIA_NOT_FOUND') return 404;
  if (code === 'MEDIA_REQUEST_TOO_LARGE') return 413;
  if (code === 'MEDIA_PROVIDER_NOT_CONFIGURED') return 503;
  if (code === 'MEDIA_PROVIDER_AUTH_FAILED' || code === 'MEDIA_PROVIDER_ACCESS_DENIED') return 502;
  if (code === 'MEDIA_PROVIDER_QUOTA_EXCEEDED' || code === 'MEDIA_PROVIDER_RATE_LIMITED') return 429;
  if (code === 'MEDIA_PROVIDER_TIMEOUT') return 504;
  if (code === 'MEDIA_PROVIDER_UNAVAILABLE') return 503;
  return 400;
}

export function httpError(code, status = statusForMediaCode(code), details = {}) {
  return new MediaAnalysisError(code, { ...details, status });
}
