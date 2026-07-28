import type { AssistantMediaItem } from '../ai-assistant/assistantModel.js';

export const MEDIA_ANALYSIS_REQUEST_SCHEMA_VERSION = 'media-analysis-request-v1';
export const MEDIA_ANALYSIS_RESULT_SCHEMA_VERSION = 'media-analysis-result-v1';
export const MEDIA_ANALYSIS_MODE = 'media_review';
export const MEDIA_ANALYSIS_MAX_PHOTOS = 4;

export type MediaAnalysisRequest = {
  schemaVersion: typeof MEDIA_ANALYSIS_REQUEST_SCHEMA_VERSION;
  jobId: string;
  attachmentIds: string[];
  analysisMode: typeof MEDIA_ANALYSIS_MODE;
  idempotencyKey: string;
};

export type MediaAnalysisProviderId = 'openai' | 'deterministic-fallback' | string;

export type MediaAnalysisStatus =
  | 'analyzed'
  | 'metadata_only'
  | 'video_analysis_not_supported_v1'
  | 'failed'
  | 'manual_review';

export type MediaFindingCategory =
  | 'equipment_overview'
  | 'possible_problem_detail'
  | 'repair_process'
  | 'replacement_part'
  | 'finished_result'
  | 'low_information'
  | 'duplicate_candidate'
  | 'unclear'
  | 'possible_face'
  | 'possible_address'
  | 'possible_phone_or_email'
  | 'possible_license_plate'
  | 'possible_customer_document'
  | 'possible_screen'
  | 'possible_barcode'
  | 'possible_serial_or_nameplate'
  | 'possible_personal_identifier'
  | 'unknown_privacy_risk';

export type MediaFindingRiskLevel = 'low' | 'medium' | 'high';
export type MediaEvidenceType = 'visual_suggestion' | 'privacy_risk_suggestion' | 'metadata_only';

export type MediaAnalysisFinding = {
  findingId: string;
  evidenceType: MediaEvidenceType;
  category: MediaFindingCategory;
  confidence: number;
  explanation: string;
  riskLevel: MediaFindingRiskLevel;
  requiresUserApproval: boolean;
};

export type MediaAnalysisAttachmentResult = {
  id: string;
  kind: 'photo' | 'video';
  mimeType: string;
  sizeBytes: number;
  status: MediaAnalysisStatus;
  visualAnalysisPerformed: boolean;
  manualReviewRequired: boolean;
  findings: MediaAnalysisFinding[];
};

export type MediaAnalysisWarning = {
  code: MediaAnalysisErrorCode | string;
  message: string;
};

export type MediaAnalysisResult = {
  schemaVersion: typeof MEDIA_ANALYSIS_RESULT_SCHEMA_VERSION;
  analysisVersion: string;
  analysisMode: typeof MEDIA_ANALYSIS_MODE;
  jobId: string;
  provider: MediaAnalysisProviderId;
  model?: string;
  requiresUserApproval: boolean;
  attachments: MediaAnalysisAttachmentResult[];
  recommendations: string[];
  missingShots: string[];
  warnings: MediaAnalysisWarning[];
  safety: {
    ok: boolean;
    privacy: 'passed' | 'failed';
    grounding: 'passed' | 'failed' | 'not_applicable';
    blockedReasons: string[];
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  telemetry?: {
    correlationId?: string;
    attempts?: number;
    latencyMs?: number;
  };
};

export type MediaAnalysisErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_STATUS'
  | 'MEDIA_NOT_SELECTED'
  | 'MEDIA_NOT_FOUND'
  | 'MEDIA_WRONG_TENANT'
  | 'MEDIA_UNSUPPORTED_TYPE'
  | 'MEDIA_TOO_LARGE'
  | 'MEDIA_REQUEST_TOO_LARGE'
  | 'MEDIA_PROVIDER_NOT_CONFIGURED'
  | 'MEDIA_PROVIDER_AUTH_FAILED'
  | 'MEDIA_PROVIDER_ACCESS_DENIED'
  | 'MEDIA_PROVIDER_QUOTA_EXCEEDED'
  | 'MEDIA_PROVIDER_RATE_LIMITED'
  | 'MEDIA_PROVIDER_TIMEOUT'
  | 'MEDIA_PROVIDER_UNAVAILABLE'
  | 'MEDIA_INVALID_PROVIDER_OUTPUT'
  | 'MEDIA_PRIVACY_VALIDATION_FAILED'
  | 'MEDIA_ANALYSIS_INCOMPLETE'
  | 'MEDIA_REFUSAL'
  | 'UNKNOWN';

export const MEDIA_ANALYSIS_CLIENT_REQUEST_KEYS: Array<keyof MediaAnalysisRequest> = [
  'schemaVersion',
  'jobId',
  'attachmentIds',
  'analysisMode',
  'idempotencyKey',
];

export const MEDIA_ANALYSIS_ERROR_MESSAGES: Record<MediaAnalysisErrorCode, string> = {
  AUTH_REQUIRED: 'Sign in again to analyze media.',
  FORBIDDEN: 'Media analysis is unavailable for this workspace.',
  INVALID_REQUEST: 'Media analysis request was rejected.',
  UNSUPPORTED_STATUS: 'Media analysis is available for Completed and Warranty jobs.',
  MEDIA_NOT_SELECTED: 'Select at least one photo or video.',
  MEDIA_NOT_FOUND: 'Selected media is unavailable. Manual review is required.',
  MEDIA_WRONG_TENANT: 'Selected media is unavailable. Manual review is required.',
  MEDIA_UNSUPPORTED_TYPE: 'One or more selected files are unsupported.',
  MEDIA_TOO_LARGE: 'Selected media exceeds the analysis limit.',
  MEDIA_REQUEST_TOO_LARGE: 'Selected media exceeds the analysis limit.',
  MEDIA_PROVIDER_NOT_CONFIGURED: 'Media analysis is unavailable. Manual review is required.',
  MEDIA_PROVIDER_AUTH_FAILED: 'Media analysis is unavailable. Manual review is required.',
  MEDIA_PROVIDER_ACCESS_DENIED: 'Media analysis is unavailable. Manual review is required.',
  MEDIA_PROVIDER_QUOTA_EXCEEDED: 'Media analysis quota is unavailable. Manual review is required.',
  MEDIA_PROVIDER_RATE_LIMITED: 'Media analysis is temporarily busy.',
  MEDIA_PROVIDER_TIMEOUT: 'Media analysis is temporarily unavailable.',
  MEDIA_PROVIDER_UNAVAILABLE: 'Media analysis is temporarily unavailable.',
  MEDIA_INVALID_PROVIDER_OUTPUT: 'Visual analysis was not accepted. Manual review is required.',
  MEDIA_PRIVACY_VALIDATION_FAILED: 'Visual analysis was not accepted. Manual review is required.',
  MEDIA_ANALYSIS_INCOMPLETE: 'Visual analysis was not accepted. Manual review is required.',
  MEDIA_REFUSAL: 'Visual analysis was not accepted. Manual review is required.',
  UNKNOWN: 'Media analysis is temporarily unavailable.',
};

export const mediaPrivacyHighRiskCategories = new Set<MediaFindingCategory>([
  'possible_face',
  'possible_address',
  'possible_phone_or_email',
  'possible_license_plate',
  'possible_customer_document',
  'possible_screen',
  'possible_personal_identifier',
]);

export const mediaPrivacyMediumRiskCategories = new Set<MediaFindingCategory>([
  'possible_barcode',
  'possible_serial_or_nameplate',
  'unknown_privacy_risk',
]);

export function buildMediaAnalysisRequest(input: {
  jobId: string;
  attachmentIds: string[];
  idempotencyKey: string;
}): MediaAnalysisRequest {
  return {
    schemaVersion: MEDIA_ANALYSIS_REQUEST_SCHEMA_VERSION,
    jobId: input.jobId,
    attachmentIds: input.attachmentIds,
    analysisMode: MEDIA_ANALYSIS_MODE,
    idempotencyKey: input.idempotencyKey,
  };
}

export function normalizeMediaAnalysisError(error: unknown): { code: MediaAnalysisErrorCode; message: string } {
  const text = error instanceof Error ? error.message : String(error ?? '');
  const code = mediaAnalysisErrorCodeFromText(text);
  return { code, message: MEDIA_ANALYSIS_ERROR_MESSAGES[code] };
}

export function mediaAnalysisErrorCodeFromText(text: string): MediaAnalysisErrorCode {
  for (const code of Object.keys(MEDIA_ANALYSIS_ERROR_MESSAGES) as MediaAnalysisErrorCode[]) {
    if (code !== 'UNKNOWN' && text.includes(code)) return code;
  }
  return 'UNKNOWN';
}

export function selectedMediaAnalysisItems(media: AssistantMediaItem[]) {
  return media.filter((item) => item.selected);
}

export function validateMediaAnalysisSelection(media: AssistantMediaItem[]) {
  const selected = selectedMediaAnalysisItems(media);
  if (!selected.length) return { ok: false as const, code: 'MEDIA_NOT_SELECTED' as const };
  const photoCount = selected.filter((item) => item.kind === 'photo').length;
  if (photoCount > MEDIA_ANALYSIS_MAX_PHOTOS) return { ok: false as const, code: 'MEDIA_REQUEST_TOO_LARGE' as const };
  return { ok: true as const, attachmentIds: selected.map((item) => item.id), photoCount };
}

export function isPrivacyFinding(category: MediaFindingCategory) {
  return mediaPrivacyHighRiskCategories.has(category) || mediaPrivacyMediumRiskCategories.has(category);
}

export function privacyRiskPriority(category: MediaFindingCategory) {
  if (mediaPrivacyHighRiskCategories.has(category)) return 'High';
  if (mediaPrivacyMediumRiskCategories.has(category)) return 'Medium';
  return '';
}
