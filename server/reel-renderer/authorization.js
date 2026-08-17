import { parseReelPlanShape, validateReelPlan } from '../../supabase/functions/_shared/reel-engine/schemas.js';
import { ReelRenderError } from './errors.js';

const authorizedPlans = new WeakMap();
const validationErrorCodes = new Set([
  'REEL_GROUNDING_FAILED',
  'REEL_PRIVACY_FAILED',
  'REEL_QUALITY_FAILED',
  'REEL_MEDIA_UNAVAILABLE',
]);
const invalidPlanErrorCodes = new Set(['INVALID_REEL_PROVIDER_OUTPUT', 'INVALID_REQUEST']);

export function authorizeReelForRender({ plan, context }) {
  try {
    if (!validAuthorityContext(context)) throw new ReelRenderError('REEL_RENDER_CONTEXT_STALE');
    if (!plainObject(plan) || typeof plan.revision !== 'string' || !/^[A-Za-z0-9:_-]{1,180}$/.test(plan.revision)) {
      throw new ReelRenderError('REEL_RENDER_INVALID_PLAN');
    }
    const { revision, ...providerPlan } = plan;
    const canonicalPlan = parseReelPlanShape(providerPlan);
    validateReelPlan(canonicalPlan, context);
    if (canonicalPlan.audio.musicMode !== 'none' || canonicalPlan.voiceover.enabled || canonicalPlan.voiceover.script !== '') {
      throw new ReelRenderError('REEL_RENDER_AUDIO_UNSUPPORTED');
    }

    const authorization = Object.freeze(Object.create(null));
    authorizedPlans.set(authorization, deepFreeze({ ...canonicalPlan, revision }));
    return authorization;
  } catch (error) {
    if (error instanceof ReelRenderError) throw error;
    if (validationErrorCodes.has(error?.message)) throw new ReelRenderError(error.message);
    if (invalidPlanErrorCodes.has(error?.message)) throw new ReelRenderError('REEL_RENDER_INVALID_PLAN');
    throw new ReelRenderError('REEL_RENDER_FAILED');
  }
}

export function requireAuthorizedReelPlan(authorization) {
  const plan = authorizedPlans.get(authorization);
  if (!plan) throw new ReelRenderError('REEL_RENDER_UNAUTHORIZED');
  return plan;
}

// This in-process capability cannot be serialized. A future render worker needs
// an independently authenticated durable authorization mechanism.
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validAuthorityContext(value) {
  return plainObject(value)
    && Array.isArray(value.privateValuesForLeakDetection)
    && Array.isArray(value.evidence)
    && Array.isArray(value.safeMedia)
    && plainObject(value.companyVoice);
}
