import { withReelEvidenceCapability } from './evidenceCapabilities.js';
import { reelLimits, reelPlanSchemaVersion } from './contracts.js';
import {
  assertStatementEvidenceCoverage,
  parseReelPlanShape,
  validateReelPlanReferencesAndPrivacy,
} from './schemas.js';

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

export function isManualRole(role) {
  return manualRoles.has(role);
}

export function isManualCategoryLabel(role, label) {
  return categoryLabelsByRole[role]?.has(label) === true;
}

export function hasRequiredManualRoles(roles) {
  return requiredRoles.every((role) => roles.has(role));
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
  assertManualSceneAuthority(scenes, context.safeMedia);

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

export function assertManualSceneAuthority(scenes, safeMedia) {
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
  if (!hasRequiredManualRoles(roles)) fail('REEL_MEDIA_SELECTION_NOT_READY');
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

function fail(code) {
  throw new Error(code);
}
