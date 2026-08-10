import type { AssistantLocalFacts } from '../ai-assistant/assistantModel';
import type { MediaPlanningRole } from '../media-planning/planningState';

export const REEL_REQUEST_SCHEMA_VERSION = 'reel-creative-request-v1';
export const REEL_PLAN_SCHEMA_VERSION = 'reel-creative-plan-v1';

export type ReelDecision = 'create_reel' | 'needs_more_media' | 'skip';
export type ReelMarketingAngle =
  | 'diagnostic_reveal'
  | 'before_after'
  | 'hidden_problem'
  | 'failure_explainer'
  | 'repair_process'
  | 'replacement_part'
  | 'transformation'
  | 'maintenance_tip'
  | 'technician_insight'
  | 'unusual_failure';
export type ReelMotionPreset = 'slow_zoom_in' | 'slow_zoom_out' | 'pan_left' | 'pan_right' | 'focus_detail' | 'static';
export type ReelCropStrategy = 'cover_center' | 'subject_center' | 'detail_crop';
export type ReelTransition = 'cut' | 'crossfade' | 'quick_fade';

export type ReelCreativeRequestV1 = {
  schemaVersion: typeof REEL_REQUEST_SCHEMA_VERSION;
  jobId: string;
  locale: string;
  localFacts: AssistantLocalFacts;
  mediaPlan: ReelMediaPlanItem[];
  planningRevision: string;
  idempotencyKey: string;
};

export type ReelMediaPlanItem = {
  attachmentId: string;
  position: number;
};

export type ReelCreativePlanV1 = {
  schemaVersion: typeof REEL_PLAN_SCHEMA_VERSION;
  revision: string;
  creativePlanId?: string;
  decision: ReelDecision;
  qualityScore: number;
  qualityReasons: string[];
  marketingAngle: ReelMarketingAngle;
  hook: { text: string; evidenceIds: string[] };
  cover: { title: string; attachmentId: string | null };
  scenes: ReelSceneV1[];
  caption: { text: string; evidenceIds: string[] };
  voiceover: { enabled: boolean; script: string; evidenceIds: string[] };
  missingShots: string[];
  claims: Array<{ id: string; text: string; evidenceIds: string[] }>;
  safety: {
    ok: boolean;
    privacy: 'passed' | 'failed';
    grounding: 'passed' | 'failed';
    quality: 'passed' | 'failed';
    blockedReasons: string[];
  };
  brand: {
    enabled: boolean;
    displayName: string;
    cta: string;
    durationMs: number;
    evidenceIds: string[];
  };
  audio: { musicMode: 'none' | 'future_library' };
};

export type ReelSceneV1 = {
  id: string;
  position: number;
  attachmentId: string;
  sceneRole: MediaPlanningRole;
  durationMs: number;
  overlayText: string;
  secondaryText?: string;
  motionPreset: ReelMotionPreset;
  cropStrategy: ReelCropStrategy;
  transitionOut: ReelTransition;
  evidenceIds: string[];
  voiceoverLine?: string;
};

export const REEL_ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: 'Sign in again to generate a Reel.',
  FORBIDDEN: 'AI Reel is unavailable for this workspace.',
  JOB_NOT_FOUND: 'The selected job is unavailable.',
  UNSUPPORTED_STATUS: 'AI Reel is available for Completed and Warranty jobs.',
  INVALID_REQUEST: 'The Reel request needs to be refreshed.',
  REEL_MEDIA_UNAVAILABLE: 'Approved media changed. Review the current media before generating again.',
  REEL_ANALYSIS_REQUIRED: 'Current media analysis is required before creating this Reel.',
  REEL_ANALYSIS_STALE: 'Selected media changed and must be analyzed again.',
  REEL_PRIVACY_REVIEW_REQUIRED: 'Selected photos need privacy review before AI Reel can use them.',
  REEL_PRIVACY_FAILED: 'Private information was detected. The Reel was not created.',
  REEL_GROUNDING_FAILED: 'The proposed story could not be supported by current job evidence.',
  REEL_QUALITY_FAILED: 'The proposed Reel did not meet the creative quality threshold.',
  INVALID_REEL_PROVIDER_OUTPUT: 'The Reel story could not be safely validated.',
  ENGINE_NOT_CONFIGURED: 'AI Reel generation is temporarily unavailable.',
  PROVIDER_TIMEOUT: 'AI Reel generation timed out. Try again shortly.',
  PROVIDER_RATE_LIMITED: 'AI Reel generation is temporarily busy. Try again shortly.',
  PROVIDER_UNAVAILABLE: 'AI Reel generation is temporarily unavailable.',
  REEL_GENERATION_FAILED: 'Reel generation is temporarily unavailable.',
};

export function reelErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const code = Object.keys(REEL_ERROR_MESSAGES).find((item) => message.includes(item));
  return code ? REEL_ERROR_MESSAGES[code] : REEL_ERROR_MESSAGES.REEL_GENERATION_FAILED;
}
