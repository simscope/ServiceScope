export const requestSchemaVersion = 'media-analysis-request-v1';
export const resultSchemaVersion = 'media-analysis-result-v1';
export const analysisVersion = 'media-analysis-v1';
export const providerOutputSchemaName = 'service_scope_media_analysis_v1';

export const analysisModes = ['media_review'];
export const allowedRequestFields = new Set(['schemaVersion', 'jobId', 'attachmentIds', 'analysisMode', 'idempotencyKey']);

export const maxRequestBytes = 12_000;
export const maxAttachments = 12;
export const maxImageBytes = 12_000_000;
export const maxVideoBytes = 80_000_000;
export const maxTotalBytes = 120_000_000;
export const idPattern = /^[A-Za-z0-9:_-]{1,160}$/;
export const idempotencyKeyPattern = /^[A-Za-z0-9:_-]{8,160}$/;

export const supportedImageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export const supportedVideoMimeTypes = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

export const mediaErrorCodes = [
  'MEDIA_NOT_SELECTED',
  'MEDIA_NOT_FOUND',
  'MEDIA_WRONG_TENANT',
  'MEDIA_UNSUPPORTED_TYPE',
  'MEDIA_TOO_LARGE',
  'MEDIA_REQUEST_TOO_LARGE',
  'MEDIA_PROVIDER_NOT_CONFIGURED',
  'MEDIA_PROVIDER_AUTH_FAILED',
  'MEDIA_PROVIDER_ACCESS_DENIED',
  'MEDIA_PROVIDER_QUOTA_EXCEEDED',
  'MEDIA_PROVIDER_RATE_LIMITED',
  'MEDIA_PROVIDER_TIMEOUT',
  'MEDIA_PROVIDER_UNAVAILABLE',
  'MEDIA_INVALID_PROVIDER_OUTPUT',
  'MEDIA_PRIVACY_VALIDATION_FAILED',
  'MEDIA_ANALYSIS_INCOMPLETE',
  'MEDIA_REFUSAL',
];

export const nonRetryableProviderCodes = new Set([
  'MEDIA_PROVIDER_AUTH_FAILED',
  'MEDIA_PROVIDER_ACCESS_DENIED',
  'MEDIA_PROVIDER_QUOTA_EXCEEDED',
  'MEDIA_INVALID_PROVIDER_OUTPUT',
  'MEDIA_PRIVACY_VALIDATION_FAILED',
  'MEDIA_ANALYSIS_INCOMPLETE',
  'MEDIA_REFUSAL',
]);

export const retryableProviderCodes = new Set([
  'MEDIA_PROVIDER_RATE_LIMITED',
  'MEDIA_PROVIDER_TIMEOUT',
  'MEDIA_PROVIDER_UNAVAILABLE',
]);
