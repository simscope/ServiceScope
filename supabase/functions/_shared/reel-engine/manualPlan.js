import { buildAuthorizedContext } from '../content-engine/context.js';
import { normalizeLocale } from '../content-engine/schemas.js';
import {
  reelLimits,
  reelManualRequestSchemaVersion,
  reelSceneCategoryLabels,
} from './contracts.js';
import {
  buildReelContext,
  finalizePlan,
  persistCreativePlan,
  ReelHttpError,
} from './director.js';
import {
  assertManualSceneAuthority,
  buildManualReelAuthority,
  buildManualReelPlan,
  defaultManualScenes,
  hasRequiredManualRoles,
  isManualCategoryLabel,
  isManualRole,
  validateManualReelPlan,
} from './manualPlanContract.js';

export {
  buildManualReelAuthority,
  buildManualReelPlan,
  defaultManualScenes,
  manualFactsFromAuthoritativeMedia,
  validateManualReelPlan,
  validateManualReelPlanForRender,
} from './manualPlanContract.js';

const requestFields = new Set([
  'schemaVersion',
  'operation',
  'jobId',
  'locale',
  'mediaPlan',
  'scenes',
  'planningRevision',
  'idempotencyKey',
]);
const mediaFields = new Set(['attachmentId', 'position']);
const sceneFields = new Set([
  'attachmentId',
  'position',
  'role',
  'categoryLabel',
  'primaryText',
  'supportingText',
]);

export async function handleManualReelGeneration({ rawBody, authorization, auth, repository, guards, telemetry }) {
  if (!authorization?.startsWith('Bearer ')) throw new ReelHttpError('AUTH_REQUIRED', 401);
  if (byteLength(rawBody) > reelLimits.maxRequestBytes) throw new ReelHttpError('INVALID_REQUEST', 400);
  let request;
  try {
    request = validateManualReelRequest(JSON.parse(rawBody || '{}'));
  } catch (error) {
    throw new ReelHttpError(error instanceof Error ? error.message : 'INVALID_REQUEST', 400);
  }

  const session = await auth.resolveSession(authorization);
  const contentRequest = {
    schemaVersion: 'content-generation-request-v1',
    jobId: request.jobId,
    channel: 'Short Video',
    tone: 'Professional',
    locale: request.locale,
    promptVersion: 'manual-reel-plan-v1',
    idempotencyKey: request.idempotencyKey,
    localFacts: {},
    mediaState: request.mediaPlan.map((item) => ({ id: item.attachmentId, selected: true, order: item.position - 1 })),
  };
  const baseContext = await buildAuthorizedContext({ request: contentRequest, session, repository });
  if (baseContext.accessLevel !== 'full') throw new ReelHttpError('FORBIDDEN', 403);
  const context = await buildReelContext(request, baseContext, repository, { requireManualSelection: true });
  const cacheKey = [context.companyId, context.actorId, request.jobId, 'Manual Reel', request.operation, request.planningRevision, request.idempotencyKey].join(':');
  const cached = guards.get(cacheKey);
  if (cached) return cached;
  if (!guards.allow(`${context.companyId}:${context.actorId}`)) throw new ReelHttpError('RATE_LIMITED', 429);

  const scenes = request.operation === 'preview'
    ? defaultManualScenes(context)
    : request.scenes;
  assertManualSceneAuthority(scenes, context.safeMedia);
  const { localFacts, context: groundedContext } = buildManualReelAuthority(context);
  const plan = buildManualReelPlan(scenes, groundedContext);
  try {
    validateManualReelPlan(plan, scenes, groundedContext);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INVALID_REQUEST';
    throw new ReelHttpError(code, manualStatusForCode(code));
  }
  const finalized = finalizePlan(plan, { ...request, localFacts }, groundedContext);
  const result = request.operation === 'create'
    ? await persistCreativePlan(finalized, { ...request, localFacts }, groundedContext, repository)
    : finalized;
  guards.set(cacheKey, result);
  telemetry?.record?.({
    correlationId: request.idempotencyKey,
    provider: 'deterministic-manual',
    model: 'none',
    channel: 'AI Reel',
    promptVersion: 'manual-reel-plan-v1',
    success: true,
    code: 'OK',
    latencyMs: 0,
    attempts: 0,
  });
  return result;
}

export function validateManualReelRequest(value) {
  const body = exactObject(value, requestFields);
  if (body.schemaVersion !== reelManualRequestSchemaVersion
    || !['preview', 'create'].includes(body.operation)) fail('INVALID_REQUEST');
  const mediaPlan = parseMediaPlan(body.mediaPlan);
  const scenes = parseManualScenes(body.scenes);
  if (body.operation === 'preview' && scenes.length !== 0) fail('INVALID_REQUEST');
  if (body.operation === 'create' && scenes.length !== mediaPlan.length) fail('INVALID_REQUEST');
  if (scenes.length) {
    const roles = new Set(scenes.map((scene) => scene.role));
    if (!hasRequiredManualRoles(roles)) fail('INVALID_REQUEST');
    scenes.forEach((scene, index) => {
      if (scene.attachmentId !== mediaPlan[index].attachmentId || scene.position !== mediaPlan[index].position) fail('INVALID_REQUEST');
    });
  }
  return {
    schemaVersion: reelManualRequestSchemaVersion,
    operation: body.operation,
    jobId: exactId(body.jobId, 128),
    locale: normalizeLocale(String(body.locale ?? 'en-US')),
    mediaPlan,
    scenes,
    planningRevision: exactId(body.planningRevision, 180),
    idempotencyKey: exactId(body.idempotencyKey, 180),
  };
}

function parseMediaPlan(value) {
  if (!Array.isArray(value) || value.length < 3 || value.length > reelLimits.maxMediaItems) fail('INVALID_REQUEST');
  const seen = new Set();
  return value.map((item, index) => {
    const row = exactObject(item, mediaFields);
    const attachmentId = exactId(row.attachmentId, 128);
    if (seen.has(attachmentId) || row.position !== index + 1) fail('INVALID_REQUEST');
    seen.add(attachmentId);
    return { attachmentId, position: row.position };
  });
}

function parseManualScenes(value) {
  if (!Array.isArray(value) || value.length > reelLimits.maxMediaItems) fail('INVALID_REQUEST');
  const roles = new Set();
  return value.map((item, index) => {
    const row = exactObject(item, sceneFields);
    if (!isManualRole(row.role) || roles.has(row.role) || row.position !== index + 1) fail('INVALID_REQUEST');
    if (!reelSceneCategoryLabels.includes(row.categoryLabel)
      || !isManualCategoryLabel(row.role, row.categoryLabel)) fail('INVALID_REQUEST');
    roles.add(row.role);
    const primaryText = boundedText(row.primaryText, reelLimits.maxOverlayLength, true);
    const supportingText = boundedText(row.supportingText, reelLimits.maxSecondaryLength, false);
    const words = wordCount(primaryText);
    if (words < 2 || words > (row.role === 'problem' ? 7 : 8)) fail('INVALID_REQUEST');
    return {
      attachmentId: exactId(row.attachmentId, 128),
      position: row.position,
      role: row.role,
      categoryLabel: row.categoryLabel,
      primaryText,
      supportingText,
    };
  });
}

function exactObject(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_REQUEST');
  const keys = Object.keys(value);
  if (keys.length !== fields.size || keys.some((key) => !fields.has(key))) fail('INVALID_REQUEST');
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(value, field)) fail('INVALID_REQUEST');
  return value;
}

function boundedText(value, limit, required) {
  if (typeof value !== 'string' || value !== value.trim() || value.length > limit || /[<>\u0000-\u001f\u007f]/.test(value)) fail('INVALID_REQUEST');
  if (required && !value) fail('INVALID_REQUEST');
  return value;
}

function exactId(value, limit) {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > limit || !/^[A-Za-z0-9:_-]+$/.test(value)) fail('INVALID_REQUEST');
  return value;
}

function wordCount(value) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

function fail(code) {
  throw new Error(code);
}

function manualStatusForCode(code) {
  if (code === 'REEL_MEDIA_UNAVAILABLE'
    || code === 'REEL_MEDIA_SELECTION_NOT_READY'
    || code === 'REEL_MEDIA_SELECTION_CONFLICT'
    || code === 'REEL_ANALYSIS_REQUIRED'
    || code === 'REEL_ANALYSIS_STALE'
    || code === 'REEL_PRIVACY_REVIEW_REQUIRED') return 409;
  return 400;
}
