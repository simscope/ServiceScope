import { buildAuthorizedContext } from '../content-engine/context.js';
import { normalizeLocale } from '../content-engine/schemas.js';
import { withReelEvidenceCapability } from './evidenceCapabilities.js';
import {
  reelLimits,
  reelManualRequestSchemaVersion,
  reelPlanSchemaVersion,
  reelSceneCategoryLabels,
} from './contracts.js';
import {
  buildReelContext,
  finalizePlan,
  persistCreativePlan,
  ReelHttpError,
} from './director.js';
import {
  assertStatementEvidenceCoverage,
  parseReelPlanShape,
  validateReelPlanReferencesAndPrivacy,
} from './schemas.js';

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
const manualRoles = new Set(['problem', 'process', 'result', 'supporting']);
const requiredRoles = ['problem', 'process', 'result'];
const categoryLabelsByRole = Object.freeze({
  problem: new Set(['PROBLEM', 'DETAIL']),
  process: new Set(['SERVICE', 'PROCESS']),
  result: new Set(['RESULT']),
  supporting: new Set(['FIELD NOTE', 'SUPPORTING']),
});
const sceneRoleByManualRole = Object.freeze({
  problem: 'detail',
  process: 'repair_process',
  result: 'finished_result',
  supporting: 'supporting_image',
});
const manualRoleBySceneRole = Object.freeze({
  detail: 'problem',
  repair_process: 'process',
  finished_result: 'result',
  supporting_image: 'supporting',
});
const categoryLabelByRole = Object.freeze({
  problem: 'PROBLEM',
  process: 'SERVICE',
  result: 'RESULT',
  supporting: 'FIELD NOTE',
});
const presentationByRole = Object.freeze({
  problem: { motionPreset: 'focus_detail', cropStrategy: 'detail_crop', transitionOut: 'quick_fade' },
  process: { motionPreset: 'pan_right', cropStrategy: 'subject_center', transitionOut: 'crossfade' },
  result: { motionPreset: 'slow_zoom_out', cropStrategy: 'subject_center', transitionOut: 'quick_fade' },
  supporting: { motionPreset: 'static', cropStrategy: 'cover_center', transitionOut: 'cut' },
});

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
  assertSceneAuthority(scenes, context.safeMedia);
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
    if (requiredRoles.some((role) => !roles.has(role))) fail('INVALID_REQUEST');
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

export function buildManualReelPlan(scenes, context) {
  const problem = scenes.find((scene) => scene.role === 'problem');
  const process = scenes.find((scene) => scene.role === 'process');
  const result = scenes.find((scene) => scene.role === 'result');
  if (!problem || !process || !result) fail('INVALID_REQUEST');
  const mediaById = new Map(context.safeMedia.map((item) => [item.attachmentId, item]));
  const evidenceIdsFor = (scene) => manualEvidenceIdsFor(scene, mediaById);
  const caption = `${problem.primaryText}. ${process.primaryText}. ${result.primaryText}.`;
  if (caption.length < 80 || caption.length > reelLimits.maxCaptionLength) fail('INVALID_REQUEST');
  const brandEnabled = context.companyVoice?.enabled === true && Boolean(context.companyVoice.publicDisplayName);
  return {
    schemaVersion: reelPlanSchemaVersion,
    decision: 'create_reel',
    qualityScore: 100,
    qualityReasons: ['Authorized manual selection supplies a complete problem, service, and result story.'],
    marketingAngle: 'manual_selection',
    hook: { text: problem.primaryText, evidenceIds: evidenceIdsFor(problem) },
    cover: { title: problem.primaryText, attachmentId: problem.attachmentId },
    scenes: scenes.map((scene) => ({
      id: `scene-${scene.position}`,
      position: scene.position,
      attachmentId: scene.attachmentId,
      sceneRole: sceneRoleByManualRole[scene.role],
      categoryLabel: scene.categoryLabel,
      durationMs: 4000,
      overlayText: scene.primaryText,
      secondaryText: scene.supportingText || null,
      ...presentationByRole[scene.role],
      evidenceIds: evidenceIdsFor(scene),
      voiceoverLine: null,
    })),
    caption: { text: caption, evidenceIds: ['diagnosis', 'repair-performed', 'final-result'] },
    voiceover: { enabled: false, script: '', evidenceIds: [] },
    missingShots: [],
    claims: [],
    safety: { ok: true, privacy: 'passed', grounding: 'passed', quality: 'passed', blockedReasons: [] },
    brand: brandEnabled
      ? {
          enabled: true,
          displayName: context.companyVoice.publicDisplayName,
          cta: 'Having a similar issue? Send us a message.',
          durationMs: 2000,
          evidenceIds: ['company-public-display-name'],
        }
      : { enabled: false, displayName: '', cta: '', durationMs: 0, evidenceIds: [] },
    audio: { musicMode: 'none' },
  };
}

export function validateManualReelPlan(plan, scenes, context) {
  const canonicalPlan = parseReelPlanShape(plan);
  return validateCanonicalManualReelPlan(canonicalPlan, scenes, context);
}

function validateCanonicalManualReelPlan(canonicalPlan, scenes, context) {
  const { evidenceById } = validateReelPlanReferencesAndPrivacy(canonicalPlan, context);
  assertSceneAuthority(scenes, context.safeMedia);

  const expectedPlan = parseReelPlanShape(buildManualReelPlan(scenes, context));
  if (JSON.stringify(canonicalPlan) !== JSON.stringify(expectedPlan)) fail('INVALID_REQUEST');

  const mediaById = new Map(context.safeMedia.map((item) => [item.attachmentId, item]));
  for (const scene of scenes) {
    const media = mediaById.get(scene.attachmentId);
    if (!media) fail('REEL_MEDIA_UNAVAILABLE');
    const evidenceIds = manualEvidenceIdsFor(scene, mediaById);
    assertManualTextEvidence(scene.primaryText, scene.role, media.evidenceText, evidenceIds, evidenceById);
    assertManualTextEvidence(scene.supportingText, scene.role, media.evidenceText, evidenceIds, evidenceById);
  }
  return canonicalPlan;
}

export function validateManualReelPlanForRender(plan, context) {
  const canonicalPlan = parseReelPlanShape(plan);
  const scenes = canonicalPlan.scenes.map((scene) => {
    const role = manualRoleBySceneRole[scene.sceneRole];
    if (!role) fail('REEL_GROUNDING_FAILED');
    return {
      attachmentId: scene.attachmentId,
      position: scene.position,
      role,
      categoryLabel: scene.categoryLabel,
      primaryText: scene.overlayText,
      supportingText: scene.secondaryText ?? '',
    };
  });
  return validateCanonicalManualReelPlan(canonicalPlan, scenes, context);
}

export function defaultManualScenes(context) {
  return context.safeMedia.map((media, index) => {
    const role = manualRoleBySceneRole[media.role];
    if (!role) fail('REEL_MEDIA_SELECTION_CONFLICT');
    const text = defaultSceneText(role, media.evidenceText);
    return {
      attachmentId: media.attachmentId,
      position: index + 1,
      role,
      categoryLabel: categoryLabelByRole[role],
      primaryText: text,
      supportingText: '',
    };
  });
}

export function manualFactsFromAuthoritativeMedia(safeMedia) {
  const problem = safeMedia.find((media) => media.role === 'detail');
  const process = safeMedia.find((media) => media.role === 'repair_process');
  const result = safeMedia.find((media) => media.role === 'finished_result');
  const supporting = safeMedia.find((media) => media.role === 'supporting_image');
  return {
    diagnosis: mediaFact(problem),
    repairPerformed: [mediaFact(process), mediaFact(result), mediaFact(supporting)].filter(Boolean).join('. '),
    finalResult: mediaFact(result),
  };
}

export function buildManualReelAuthority(context, expectedLocalFacts) {
  const localFacts = manualFactsFromAuthoritativeMedia(context.safeMedia);
  if (expectedLocalFacts !== undefined && !sameManualFacts(expectedLocalFacts, localFacts)) {
    fail('REEL_GROUNDING_FAILED');
  }
  return { localFacts, context: withManualFacts(context, localFacts) };
}

function mediaFact(media) {
  return String(media?.evidenceText ?? '').trim();
}

function defaultSceneText(role, evidenceText) {
  const valveEvidence = /\bvalves?\b/i.test(evidenceText);
  if (role === 'problem' && valveEvidence && /\b(?:corrod|rust|oxid|worn|wear)/i.test(evidenceText)) {
    return 'Corroded valve and worn connections';
  }
  if (role === 'process' && valveEvidence && /\b(?:replac|install)/i.test(evidenceText)) {
    return 'Valve replacement in progress';
  }
  if (role === 'result' && valveEvidence && /\b(?:replac|install)/i.test(evidenceText)) {
    return 'Replacement valve installed';
  }
  if (role === 'problem') return 'A service problem detail is visible';
  if (role === 'process') return 'Service work is shown in progress';
  if (role === 'result') return 'The completed service result is shown';
  return 'An additional service detail is shown';
}

function assertManualTextEvidence(text, role, evidenceText, evidenceIds, evidenceById) {
  if (!text || text === defaultSceneText(role, evidenceText)) return;
  assertStatementEvidenceCoverage({ text, evidenceIds }, evidenceById);
}

function manualEvidenceIdsFor(scene, mediaById) {
  const mediaEvidenceId = mediaById.get(scene.attachmentId)?.evidenceId;
  if (!mediaEvidenceId) fail('REEL_MEDIA_UNAVAILABLE');
  if (scene.role === 'problem') return [mediaEvidenceId, 'diagnosis'];
  if (scene.role === 'process') return [mediaEvidenceId, 'repair-performed'];
  if (scene.role === 'result') return [mediaEvidenceId, 'repair-performed', 'final-result'];
  return [mediaEvidenceId, 'repair-performed'];
}

function withManualFacts(context, localFacts) {
  const localFactIds = new Set(['diagnosis', 'repair-performed', 'final-result']);
  const manualEvidence = [
    { id: 'diagnosis', label: 'Problem', text: localFacts.diagnosis, source: 'Authoritative selected media analysis' },
    { id: 'repair-performed', label: 'Service', text: localFacts.repairPerformed, source: 'Authoritative selected media analysis' },
    { id: 'final-result', label: 'Result', text: localFacts.finalResult, source: 'Authoritative selected media analysis' },
  ].map(withReelEvidenceCapability);
  return {
    ...context,
    evidence: [
      ...context.evidence.filter((item) => !localFactIds.has(item.id)),
      ...manualEvidence,
    ],
  };
}

function sameManualFacts(left, right) {
  const fields = ['diagnosis', 'repairPerformed', 'finalResult'];
  return Boolean(left && typeof left === 'object' && !Array.isArray(left))
    && Object.keys(left).length === fields.length
    && fields.every((field) => typeof left[field] === 'string' && left[field] === right[field]);
}

function assertSceneAuthority(scenes, safeMedia) {
  if (scenes.length !== safeMedia.length) fail('REEL_MEDIA_SELECTION_CONFLICT');
  const roles = new Set();
  scenes.forEach((scene, index) => {
    const media = safeMedia[index];
    if (scene.position !== index + 1
      || scene.attachmentId !== media?.attachmentId
      || sceneRoleByManualRole[scene.role] !== media?.role
      || roles.has(scene.role)) {
      fail('REEL_MEDIA_SELECTION_CONFLICT');
    }
    roles.add(scene.role);
  });
  if (requiredRoles.some((role) => !roles.has(role))) fail('REEL_MEDIA_SELECTION_NOT_READY');
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
    if (!manualRoles.has(row.role) || roles.has(row.role) || row.position !== index + 1) fail('INVALID_REQUEST');
    if (!reelSceneCategoryLabels.includes(row.categoryLabel)
      || !categoryLabelsByRole[row.role]?.has(row.categoryLabel)) fail('INVALID_REQUEST');
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
