export const reelRequestSchemaVersion = 'reel-creative-request-v1';
export const reelPlanSchemaVersion = 'reel-creative-plan-v1';

export const reelDecisions = Object.freeze(['create_reel', 'needs_more_media', 'skip']);
export const reelMarketingAngles = Object.freeze([
  'diagnostic_reveal',
  'before_after',
  'hidden_problem',
  'failure_explainer',
  'repair_process',
  'replacement_part',
  'transformation',
  'maintenance_tip',
  'technician_insight',
  'unusual_failure',
]);
export const reelSceneRoles = Object.freeze([
  'overview',
  'detail',
  'repair_process',
  'replacement_part',
  'finished_result',
  'supporting_image',
]);
export const reelMotionPresets = Object.freeze([
  'slow_zoom_in',
  'slow_zoom_out',
  'pan_left',
  'pan_right',
  'focus_detail',
  'static',
]);
export const reelCropStrategies = Object.freeze(['cover_center', 'subject_center', 'detail_crop']);
export const reelTransitions = Object.freeze(['cut', 'crossfade', 'quick_fade']);
export const reelPrivacyStatuses = Object.freeze(['passed', 'reviewed']);
export const reelMusicModes = Object.freeze(['none', 'future_library']);

export const reelLimits = Object.freeze({
  maxRequestBytes: 28_000,
  maxMediaItems: 4,
  minCreateScenes: 2,
  maxCreateScenes: 7,
  minSceneDurationMs: 1_500,
  maxSceneDurationMs: 8_000,
  minTotalDurationMs: 12_000,
  maxTotalDurationMs: 25_000,
  minBrandDurationMs: 1_500,
  maxBrandDurationMs: 2_500,
  maxOverlayLength: 45,
  maxSecondaryLength: 80,
  maxCaptionLength: 350,
  maxVoiceoverLength: 900,
  maxMissingShots: 3,
  maxClaims: 24,
});

export const genericCreativePattern = /^(?:job completed(?: successfully)?|service (?:call )?(?:is )?(?:now )?complete(?:d)?|repair completed|another service visit(?: completed)?|work finished|technician completed the (?:repair|work)|our technician completed the (?:repair|work)|this post documents(?: the job)?|we successfully completed|completed appliance service)(?:\b|[.!?:-])/i;

export function decisionForQualityScore(score) {
  if (score >= 70) return 'create_reel';
  if (score >= 45) return 'needs_more_media';
  return 'skip';
}
