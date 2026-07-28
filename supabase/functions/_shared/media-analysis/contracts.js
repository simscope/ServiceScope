export const requestSchemaVersion = 'media-analysis-request-v1';
export const resultSchemaVersion = 'media-analysis-result-v1';
export const analysisVersion = 'media-analysis-v1';
export const providerOutputSchemaName = 'service_scope_media_analysis_v1';
export const providerPayloadSchemaVersion = 'media-analysis-provider-output-v1';

export const analysisModes = ['media_review'];
export const allowedRequestFields = new Set(['schemaVersion', 'jobId', 'attachmentIds', 'analysisMode', 'idempotencyKey']);

export const maxRequestBytes = 12_000;
export const maxAttachments = 12;
export const maxVisionPhotos = 4;
export const maxImageBytes = 12_000_000;
export const maxVideoBytes = 80_000_000;
export const maxTotalBytes = 120_000_000;
export const maxFindingsPerAttachment = 6;
export const maxTotalFindings = 24;
export const maxRecommendationCount = 8;
export const maxMissingShotCount = 8;
export const maxFindingExplanationLength = 180;
export const signedUrlTtlSeconds = 60;
export const idPattern = /^[A-Za-z0-9:_-]{1,160}$/;
export const idempotencyKeyPattern = /^[A-Za-z0-9:_-]{8,160}$/;

export const supportedImageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
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

export const contentFindingCategories = [
  'equipment_overview',
  'possible_problem_detail',
  'repair_process',
  'replacement_part',
  'finished_result',
  'low_information',
  'duplicate_candidate',
  'unclear',
];

export const privacyFindingCategories = [
  'possible_face',
  'possible_address',
  'possible_phone_or_email',
  'possible_license_plate',
  'possible_customer_document',
  'possible_screen',
  'possible_barcode',
  'possible_serial_or_nameplate',
  'possible_personal_identifier',
  'unknown_privacy_risk',
];

export const findingCategories = [...contentFindingCategories, ...privacyFindingCategories];
export const riskLevels = ['low', 'medium', 'high'];
export const evidenceTypes = ['visual_suggestion', 'privacy_risk_suggestion', 'metadata_only'];
