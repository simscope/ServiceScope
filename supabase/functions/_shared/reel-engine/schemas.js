import {
  genericCreativePattern,
  reelCropStrategies,
  reelDecisions,
  reelLimits,
  reelMarketingAngles,
  reelMotionPresets,
  reelMusicModes,
  reelPlanSchemaVersion,
  reelRequestSchemaVersion,
  reelSceneRoles,
  reelTransitions,
} from './contracts.js';
import { normalizeLocale } from '../content-engine/schemas.js';
import { reelEvidenceCapabilityForId, reelEvidenceCapabilities } from './evidenceCapabilities.js';

const requestFields = new Set([
  'schemaVersion',
  'jobId',
  'locale',
  'localFacts',
  'mediaPlan',
  'planningRevision',
  'idempotencyKey',
]);
const requestMediaFields = new Set([
  'attachmentId',
  'position',
]);
const rootFields = [
  'schemaVersion',
  'decision',
  'qualityScore',
  'qualityReasons',
  'marketingAngle',
  'hook',
  'cover',
  'scenes',
  'caption',
  'voiceover',
  'missingShots',
  'claims',
  'safety',
  'brand',
  'audio',
];
const hookFields = ['text', 'evidenceIds'];
const coverFields = ['title', 'attachmentId'];
const sceneFields = [
  'id',
  'position',
  'attachmentId',
  'sceneRole',
  'durationMs',
  'overlayText',
  'secondaryText',
  'motionPreset',
  'cropStrategy',
  'transitionOut',
  'evidenceIds',
  'voiceoverLine',
];
const captionFields = ['text', 'evidenceIds'];
const voiceoverFields = ['enabled', 'script', 'evidenceIds'];
const claimFields = ['id', 'text', 'evidenceIds'];
const safetyFields = ['ok', 'privacy', 'grounding', 'quality', 'blockedReasons'];
const brandFields = ['enabled', 'displayName', 'cta', 'durationMs', 'evidenceIds'];
const audioFields = ['musicMode'];

export function validateReelRequestBody(value) {
  const body = plainObject(value);
  assertExactFields(body, requestFields);
  if (body.schemaVersion !== reelRequestSchemaVersion) fail('INVALID_REQUEST');
  const jobId = exactId(body.jobId, 128);
  const idempotencyKey = exactId(body.idempotencyKey, 180);
  const planningRevision = exactId(body.planningRevision, 180);
  const localFacts = cleanLocalFacts(body.localFacts);
  if (!Array.isArray(body.mediaPlan) || body.mediaPlan.length > reelLimits.maxMediaItems) fail('INVALID_REQUEST');
  const seen = new Set();
  const mediaPlan = body.mediaPlan.map((item, index) => {
    const row = plainObject(item);
    assertNoUnknownFields(row, requestMediaFields);
    for (const field of ['attachmentId', 'position']) {
      if (!Object.prototype.hasOwnProperty.call(row, field)) fail('INVALID_REQUEST');
    }
    const attachmentId = exactId(row.attachmentId, 128);
    if (seen.has(attachmentId)) fail('INVALID_REQUEST');
    seen.add(attachmentId);
    if (!Number.isInteger(row.position) || row.position !== index + 1) fail('INVALID_REQUEST');
    return {
      attachmentId,
      position: row.position,
    };
  });
  return {
    schemaVersion: reelRequestSchemaVersion,
    jobId,
    locale: normalizeLocale(String(body.locale ?? 'en-US')),
    localFacts,
    mediaPlan,
    planningRevision,
    idempotencyKey,
  };
}

export function parseReelProviderResult(rawJson, context) {
  const value = plainObject(rawJson, 'INVALID_REEL_PROVIDER_OUTPUT');
  assertExactFields(value, new Set(rootFields), 'INVALID_REEL_PROVIDER_OUTPUT');
  if (value.schemaVersion !== reelPlanSchemaVersion) fail('INVALID_REEL_PROVIDER_OUTPUT');
  if (!reelDecisions.includes(value.decision)) fail('INVALID_REEL_PROVIDER_OUTPUT');
  if (!Number.isInteger(value.qualityScore) || value.qualityScore < 0 || value.qualityScore > 100) fail('INVALID_REEL_PROVIDER_OUTPUT');
  if (!Array.isArray(value.qualityReasons) || value.qualityReasons.length < 1 || value.qualityReasons.length > 5) fail('INVALID_REEL_PROVIDER_OUTPUT');
  const qualityReasons = value.qualityReasons.map((item) => requiredText(item, 180));
  if (!reelMarketingAngles.includes(value.marketingAngle)) fail('INVALID_REEL_PROVIDER_OUTPUT');
  const hook = parseHook(value.hook);
  const cover = parseCover(value.cover);
  const scenes = parseScenes(value.scenes);
  const caption = parseCaption(value.caption);
  const voiceover = parseVoiceover(value.voiceover);
  const missingShots = parseMissingShots(value.missingShots);
  const claims = parseClaims(value.claims);
  const safety = parseSafety(value.safety);
  const brand = parseBrand(value.brand);
  const audio = parseAudio(value.audio);
  const result = {
    schemaVersion: reelPlanSchemaVersion,
    decision: value.decision,
    qualityScore: value.qualityScore,
    qualityReasons,
    marketingAngle: value.marketingAngle,
    hook,
    cover,
    scenes,
    caption,
    voiceover,
    missingShots,
    claims,
    safety,
    brand,
    audio,
  };
  validateReelPlan(result, context);
  return result;
}

export function validateReelPlan(plan, context) {
  const evidenceById = new Map(context.evidence.map((item) => [item.id, item]));
  const safeMediaById = new Map(context.safeMedia.map((item) => [item.attachmentId, item]));
  const allEvidenceLists = [
    plan.hook.evidenceIds,
    plan.caption.evidenceIds,
    plan.voiceover.evidenceIds,
    plan.brand.evidenceIds,
    ...plan.scenes.map((scene) => scene.evidenceIds),
    ...plan.claims.map((claim) => claim.evidenceIds),
  ];
  for (const evidenceIds of allEvidenceLists) {
    if (!evidenceIds.every((id) => evidenceById.has(id))) fail('REEL_GROUNDING_FAILED');
  }
  assertNoPrivateOrForbiddenText(plan, context.privateValues);

  const scoreDecision = plan.qualityScore >= 70
    ? 'create_reel'
    : plan.qualityScore >= 45
      ? 'needs_more_media'
      : 'skip';
  if (scoreDecision !== plan.decision) fail('REEL_QUALITY_FAILED');

  if (plan.decision === 'create_reel') {
    assertClaimSupport(plan.claims, evidenceById);
    assertClaimSupport([
      { text: plan.hook.text, evidenceIds: plan.hook.evidenceIds },
      { text: plan.cover.title, evidenceIds: plan.hook.evidenceIds },
      { text: plan.caption.text, evidenceIds: plan.caption.evidenceIds },
      ...plan.scenes.flatMap((scene) => [
        { text: scene.overlayText, evidenceIds: scene.evidenceIds },
        { text: scene.secondaryText ?? '', evidenceIds: scene.evidenceIds },
        { text: scene.voiceoverLine ?? '', evidenceIds: scene.evidenceIds },
      ]),
      ...(plan.voiceover.enabled ? [{ text: plan.voiceover.script, evidenceIds: plan.voiceover.evidenceIds }] : []),
      ...(plan.brand.enabled ? [{ text: plan.brand.cta, evidenceIds: plan.brand.evidenceIds }] : []),
    ], evidenceById);
    if (!plan.safety.ok || plan.safety.privacy !== 'passed' || plan.safety.grounding !== 'passed' || plan.safety.quality !== 'passed') fail('REEL_QUALITY_FAILED');
    if (genericCreativePattern.test(plan.hook.text) || genericCaptionStart(plan.caption.text)) fail('REEL_QUALITY_FAILED');
    if (wordCount(plan.hook.text) < 3 || wordCount(plan.hook.text) > 8) fail('REEL_QUALITY_FAILED');
    if (plan.caption.text.length < 80 || countHashtags(plan.caption.text) > 5) fail('REEL_QUALITY_FAILED');
    if (plan.hook.evidenceIds.length < 1) fail('REEL_GROUNDING_FAILED');
    if (safeMediaById.size < 2) fail('REEL_QUALITY_FAILED');
    if (plan.scenes.length < reelLimits.minCreateScenes || plan.scenes.length > reelLimits.maxCreateScenes) fail('REEL_QUALITY_FAILED');
    const attachmentIds = plan.scenes.map((scene) => scene.attachmentId);
    if (new Set(attachmentIds).size < 2 || new Set(attachmentIds).size !== attachmentIds.length) fail('REEL_QUALITY_FAILED');
    if (!plan.cover.attachmentId || !safeMediaById.has(plan.cover.attachmentId)) fail('REEL_MEDIA_UNAVAILABLE');
    if (plan.cover.title.length < 2 || wordCount(plan.cover.title) < 2 || wordCount(plan.cover.title) > 7) fail('REEL_QUALITY_FAILED');
    const sceneIds = new Set();
    let totalDuration = plan.brand.enabled ? plan.brand.durationMs : 0;
    plan.scenes.forEach((scene, index) => {
      if (sceneIds.has(scene.id)) fail('INVALID_REEL_PROVIDER_OUTPUT');
      sceneIds.add(scene.id);
      if (scene.position !== index + 1 || !safeMediaById.has(scene.attachmentId)) fail('REEL_MEDIA_UNAVAILABLE');
      if (safeMediaById.get(scene.attachmentId).role !== scene.sceneRole) fail('REEL_GROUNDING_FAILED');
      const mediaEvidencePrefix = `media:${scene.attachmentId}:`;
      if (!scene.evidenceIds.some((id) => id.startsWith(mediaEvidencePrefix))) fail('REEL_GROUNDING_FAILED');
      if (wordCount(scene.overlayText) < 2 || wordCount(scene.overlayText) > 8) fail('REEL_QUALITY_FAILED');
      totalDuration += scene.durationMs;
    });
    if (plan.scenes[0].overlayText.toLocaleLowerCase() !== plan.hook.text.toLocaleLowerCase()) fail('REEL_QUALITY_FAILED');
    if (totalDuration < reelLimits.minTotalDurationMs || totalDuration > reelLimits.maxTotalDurationMs) fail('REEL_QUALITY_FAILED');
    if (plan.brand.enabled) {
      if (!context.companyVoice?.enabled || plan.brand.displayName !== context.companyVoice.publicDisplayName) fail('REEL_GROUNDING_FAILED');
      if (!plan.brand.evidenceIds.includes('company-public-display-name')) fail('REEL_GROUNDING_FAILED');
    }
    assertAngleSupport(plan.marketingAngle, evidenceById, context.safeMedia);
  } else {
    if (plan.scenes.length || plan.cover.attachmentId !== null || plan.brand.enabled) fail('REEL_QUALITY_FAILED');
    if (plan.decision === 'needs_more_media' && plan.missingShots.length < 1) fail('REEL_QUALITY_FAILED');
  }
  return plan;
}

export function buildReelProviderOutputJsonSchema() {
  const stringIds = { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', pattern: '^[A-Za-z0-9:_-]{1,180}$' } };
  const optionalIds = { type: 'array', maxItems: 8, items: { type: 'string', pattern: '^[A-Za-z0-9:_-]{1,180}$' } };
  return {
    type: 'object',
    additionalProperties: false,
    required: rootFields,
    properties: {
      schemaVersion: { type: 'string', enum: [reelPlanSchemaVersion] },
      decision: { type: 'string', enum: reelDecisions },
      qualityScore: { type: 'integer', minimum: 0, maximum: 100 },
      qualityReasons: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', minLength: 1, maxLength: 180 } },
      marketingAngle: { type: 'string', enum: reelMarketingAngles },
      hook: objectSchema(hookFields, {
        text: { type: 'string', minLength: 1, maxLength: 60 },
        evidenceIds: optionalIds,
      }),
      cover: objectSchema(coverFields, {
        title: { type: 'string', maxLength: 60 },
        attachmentId: { type: ['string', 'null'], maxLength: 128 },
      }),
      scenes: {
        type: 'array',
        maxItems: reelLimits.maxCreateScenes,
        items: objectSchema(sceneFields, {
          id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' },
          position: { type: 'integer', minimum: 1, maximum: reelLimits.maxCreateScenes },
          attachmentId: { type: 'string', minLength: 1, maxLength: 128 },
          sceneRole: { type: 'string', enum: reelSceneRoles },
          durationMs: { type: 'integer', minimum: reelLimits.minSceneDurationMs, maximum: reelLimits.maxSceneDurationMs },
          overlayText: { type: 'string', minLength: 1, maxLength: reelLimits.maxOverlayLength },
          secondaryText: { type: ['string', 'null'], maxLength: reelLimits.maxSecondaryLength },
          motionPreset: { type: 'string', enum: reelMotionPresets },
          cropStrategy: { type: 'string', enum: reelCropStrategies },
          transitionOut: { type: 'string', enum: reelTransitions },
          evidenceIds: stringIds,
          voiceoverLine: { type: ['string', 'null'], maxLength: 220 },
        }),
      },
      caption: objectSchema(captionFields, { text: { type: 'string', maxLength: reelLimits.maxCaptionLength }, evidenceIds: optionalIds }),
      voiceover: objectSchema(voiceoverFields, { enabled: { type: 'boolean' }, script: { type: 'string', maxLength: reelLimits.maxVoiceoverLength }, evidenceIds: optionalIds }),
      missingShots: { type: 'array', maxItems: reelLimits.maxMissingShots, items: { type: 'string', minLength: 1, maxLength: 160 } },
      claims: { type: 'array', maxItems: reelLimits.maxClaims, items: objectSchema(claimFields, { id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,80}$' }, text: { type: 'string', minLength: 1, maxLength: 300 }, evidenceIds: stringIds }) },
      safety: objectSchema(safetyFields, { ok: { type: 'boolean' }, privacy: { type: 'string', enum: ['passed', 'failed'] }, grounding: { type: 'string', enum: ['passed', 'failed'] }, quality: { type: 'string', enum: ['passed', 'failed'] }, blockedReasons: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 160 } } }),
      brand: objectSchema(brandFields, { enabled: { type: 'boolean' }, displayName: { type: 'string', maxLength: 80 }, cta: { type: 'string', maxLength: 160 }, durationMs: { type: 'integer', minimum: 0, maximum: reelLimits.maxBrandDurationMs }, evidenceIds: optionalIds }),
      audio: objectSchema(audioFields, { musicMode: { type: 'string', enum: reelMusicModes } }),
    },
  };
}

export function buildReelProviderOutputResponseFormat() {
  return { type: 'json_schema', name: 'service_scope_reel_creative_plan_v1', strict: true, schema: buildReelProviderOutputJsonSchema() };
}

function parseHook(value) {
  const row = exactObject(value, hookFields);
  return { text: requiredText(row.text, 60), evidenceIds: ids(row.evidenceIds, true) };
}

function parseCover(value) {
  const row = exactObject(value, coverFields);
  return { title: cleanText(row.title, 60), attachmentId: row.attachmentId === null ? null : exactId(row.attachmentId, 128) };
}

function parseScenes(value) {
  if (!Array.isArray(value) || value.length > reelLimits.maxCreateScenes) fail('INVALID_REEL_PROVIDER_OUTPUT');
  return value.map((item) => {
    const row = exactObject(item, sceneFields);
    if (!Number.isInteger(row.position) || !Number.isInteger(row.durationMs) || row.durationMs < reelLimits.minSceneDurationMs || row.durationMs > reelLimits.maxSceneDurationMs) fail('INVALID_REEL_PROVIDER_OUTPUT');
    if (!reelSceneRoles.includes(row.sceneRole) || !reelMotionPresets.includes(row.motionPreset) || !reelCropStrategies.includes(row.cropStrategy) || !reelTransitions.includes(row.transitionOut)) fail('INVALID_REEL_PROVIDER_OUTPUT');
    return {
      id: exactId(row.id, 80),
      position: row.position,
      attachmentId: exactId(row.attachmentId, 128),
      sceneRole: row.sceneRole,
      durationMs: row.durationMs,
      overlayText: requiredText(row.overlayText, reelLimits.maxOverlayLength),
      secondaryText: row.secondaryText === null ? undefined : cleanText(row.secondaryText, reelLimits.maxSecondaryLength),
      motionPreset: row.motionPreset,
      cropStrategy: row.cropStrategy,
      transitionOut: row.transitionOut,
      evidenceIds: ids(row.evidenceIds, true),
      voiceoverLine: row.voiceoverLine === null ? undefined : cleanText(row.voiceoverLine, 220),
    };
  });
}

function parseCaption(value) {
  const row = exactObject(value, captionFields);
  return { text: cleanText(row.text, reelLimits.maxCaptionLength), evidenceIds: ids(row.evidenceIds) };
}

function parseVoiceover(value) {
  const row = exactObject(value, voiceoverFields);
  if (typeof row.enabled !== 'boolean') fail('INVALID_REEL_PROVIDER_OUTPUT');
  const script = cleanText(row.script, reelLimits.maxVoiceoverLength);
  if (row.enabled !== Boolean(script)) fail('INVALID_REEL_PROVIDER_OUTPUT');
  return { enabled: row.enabled, script, evidenceIds: ids(row.evidenceIds) };
}

function parseMissingShots(value) {
  if (!Array.isArray(value) || value.length > reelLimits.maxMissingShots) fail('INVALID_REEL_PROVIDER_OUTPUT');
  return value.map((item) => requiredText(item, 160));
}

function parseClaims(value) {
  if (!Array.isArray(value) || value.length > reelLimits.maxClaims) fail('INVALID_REEL_PROVIDER_OUTPUT');
  const seen = new Set();
  return value.map((item) => {
    const row = exactObject(item, claimFields);
    const id = exactId(row.id, 80);
    if (seen.has(id)) fail('INVALID_REEL_PROVIDER_OUTPUT');
    seen.add(id);
    return { id, text: requiredText(row.text, 300), evidenceIds: ids(row.evidenceIds, true) };
  });
}

function parseSafety(value) {
  const row = exactObject(value, safetyFields);
  if (typeof row.ok !== 'boolean' || !['passed', 'failed'].includes(row.privacy) || !['passed', 'failed'].includes(row.grounding) || !['passed', 'failed'].includes(row.quality)) fail('INVALID_REEL_PROVIDER_OUTPUT');
  if (!Array.isArray(row.blockedReasons) || row.blockedReasons.length > 8) fail('INVALID_REEL_PROVIDER_OUTPUT');
  return { ok: row.ok, privacy: row.privacy, grounding: row.grounding, quality: row.quality, blockedReasons: row.blockedReasons.map((item) => requiredText(item, 160)) };
}

function parseBrand(value) {
  const row = exactObject(value, brandFields);
  if (typeof row.enabled !== 'boolean' || !Number.isInteger(row.durationMs)) fail('INVALID_REEL_PROVIDER_OUTPUT');
  if (row.enabled && (row.durationMs < reelLimits.minBrandDurationMs || row.durationMs > reelLimits.maxBrandDurationMs)) fail('INVALID_REEL_PROVIDER_OUTPUT');
  if (!row.enabled && row.durationMs !== 0) fail('INVALID_REEL_PROVIDER_OUTPUT');
  return { enabled: row.enabled, displayName: cleanText(row.displayName, 80), cta: cleanText(row.cta, 160), durationMs: row.durationMs, evidenceIds: ids(row.evidenceIds) };
}

function parseAudio(value) {
  const row = exactObject(value, audioFields);
  if (!reelMusicModes.includes(row.musicMode)) fail('INVALID_REEL_PROVIDER_OUTPUT');
  return { musicMode: row.musicMode };
}

function assertNoPrivateOrForbiddenText(plan, privateValues) {
  const text = JSON.stringify(plan);
  for (const privateValue of privateValues) {
    const clean = String(privateValue ?? '').trim();
    if (clean.length > 1 && new RegExp(escapeRegExp(clean), 'i').test(text)) fail('REEL_PRIVACY_FAILED');
  }
  const blockedPatterns = [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/,
    /\b\d{1,6}\s+[A-Za-z0-9.' -]{2,60}\s(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd|court|ct|way)\b/i,
    /\b(?:job|work order)\s*(?:#|number|no\.?)\s*[A-Z0-9-]{2,}\b/i,
    /\bserial(?: number| no\.?| #)?\s*[:#-]?\s*[A-Z0-9-]{2,}\b/i,
    /\b(?:invoice|payment|credit card|customer name|customer company)\b/i,
  ];
  if (blockedPatterns.some((pattern) => pattern.test(text))) fail('REEL_PRIVACY_FAILED');
}

export function assertClaimSupport(claims, evidenceById) {
  const technicalTerms = /\b(capacitor|compressor|relay|motor|refrigerant|leak|clog|burner|thermostat|sensor|bearing|wiring|control board|replaced|repaired|restored|back in service|fixed|failed component|stopped heating|not heating|not cooling|failure)\b/gi;
  for (const claim of claims) {
    if (!claim.text) continue;
    const referencedEvidence = claim.evidenceIds.map((id) => evidenceById.get(id)).filter(Boolean);
    const factEvidence = referencedEvidence.filter((item) => reelEvidenceCapabilityForId(item.id) === reelEvidenceCapabilities.fact);
    assertStatementEvidenceCoverage(claim, evidenceById);
    const referenced = (requiresFactOnlyLexicalSupport(claim.text) ? factEvidence : referencedEvidence)
      .map((item) => item.text ?? '')
      .join(' ');
    const terms = claim.text.match(technicalTerms) ?? [];
    if (terms.some((term) => !referenced.toLowerCase().includes(term.toLowerCase()))) fail('REEL_GROUNDING_FAILED');
  }
}

export function assertStatementEvidenceCoverage(statement, evidenceById) {
  const text = String(statement.text ?? '').trim();
  if (!text) return;
  const referencedEvidence = statement.evidenceIds.map((id) => evidenceById.get(id)).filter(Boolean);
  const factEvidence = referencedEvidence.filter((item) => reelEvidenceCapabilityForId(item.id) === reelEvidenceCapabilities.fact);
  const visualEvidence = referencedEvidence.filter((item) => reelEvidenceCapabilityForId(item.id) === reelEvidenceCapabilities.visual);
  const brandEvidence = referencedEvidence.filter((item) => reelEvidenceCapabilityForId(item.id) === reelEvidenceCapabilities.brand);
  assertRequiredFactCapabilities(text, factEvidence);

  if (brandEvidence.length && !factEvidence.length && !visualEvidence.length) {
    const brandTokens = evidenceTokenSet(brandEvidence);
    if (meaningfulEvidenceTokens(text).some((token) => !brandTokens.has(token) && !brandCtaTokens.has(token))) {
      fail('REEL_GROUNDING_FAILED');
    }
    return;
  }

  const factIds = new Set(factEvidence.map((item) => item.id));
  const hasDiagnosis = factIds.has('diagnosis');
  if (!hasDiagnosis) {
    const statementTokens = meaningfulEvidenceTokens(text);
    const supportedTokens = evidenceTokenSet([...factEvidence, ...visualEvidence]);
    const capabilityTokens = allowedCapabilityTokens(factIds);
    if (statementTokens.some((token) => !supportedTokens.has(token) && !capabilityTokens.has(token))) {
      fail('REEL_GROUNDING_FAILED');
    }

    if (visualEvidence.length) {
      const visualTokens = evidenceTokenSet(visualEvidence);
      const symptomTokens = evidenceTokenSet(factEvidence.filter((item) => ['complaint', 'system-equipment'].includes(item.id)));
      const usesVisualMeaning = statementTokens.some((token) => visualTokens.has(token));
      const usesSymptomMeaning = statementTokens.some((token) => symptomTokens.has(token) && !visualTokens.has(token));
      if (usesVisualMeaning && usesSymptomMeaning) fail('REEL_GROUNDING_FAILED');
    }
  }

  assertLiteralFactCoverage(text, factEvidence);
}

export function assertAngleSupport(angle, evidenceById, safeMedia) {
  const ids = new Set(evidenceById.keys());
  const roles = new Set(safeMedia.map((item) => item.role));
  const has = (...values) => values.some((value) => ids.has(value));
  if (['diagnostic_reveal', 'hidden_problem', 'unusual_failure', 'failure_explainer'].includes(angle) && !has('diagnosis')) fail('REEL_GROUNDING_FAILED');
  if (['before_after', 'transformation'].includes(angle) && !(has('final-result') && roles.has('finished_result') && (roles.has('overview') || roles.has('repair_process')))) fail('REEL_GROUNDING_FAILED');
  if (angle === 'repair_process' && !has('repair-performed')) fail('REEL_GROUNDING_FAILED');
  if (angle === 'replacement_part' && !has('repair-performed') && !Array.from(ids).some((id) => id.startsWith('installed-material-'))) fail('REEL_GROUNDING_FAILED');
  if (angle === 'technician_insight' && !has('diagnosis', 'repair-performed', 'final-result')) fail('REEL_GROUNDING_FAILED');
}

function assertRequiredFactCapabilities(text, factEvidence) {
  const factIds = new Set(factEvidence.map((item) => item.id));
  const hasInstalledMaterial = factEvidence.some((item) => String(item.id).startsWith('installed-material-'));
  if (diagnosisClaimPattern.test(text) && !factIds.has('diagnosis')) fail('REEL_GROUNDING_FAILED');
  if (replacementClaimPattern.test(text) && !factIds.has('repair-performed') && !hasInstalledMaterial) fail('REEL_GROUNDING_FAILED');
  if (repairClaimPattern.test(text) && !factIds.has('repair-performed')) fail('REEL_GROUNDING_FAILED');
  if (resultClaimPattern.test(text) && !factIds.has('final-result')) fail('REEL_GROUNDING_FAILED');
  if (measurementClaimPattern.test(text) && !factIds.has('diagnosis')) fail('REEL_GROUNDING_FAILED');
  if (safetyOrSavingsClaimPattern.test(text) && !factIds.has('final-result')) fail('REEL_GROUNDING_FAILED');
  if (technicianActionPattern.test(text) && !factIds.has('diagnosis') && !factIds.has('repair-performed')) fail('REEL_GROUNDING_FAILED');
}

function requiresFactOnlyLexicalSupport(text) {
  return diagnosisClaimPattern.test(text)
    || replacementClaimPattern.test(text)
    || repairClaimPattern.test(text)
    || resultClaimPattern.test(text)
    || measurementClaimPattern.test(text)
    || safetyOrSavingsClaimPattern.test(text)
    || technicianActionPattern.test(text);
}

const componentPattern = '(?:capacitor|compressor|relay|motor|burner|thermostat|sensor|bearing|wiring|control board)';
const diagnosisClaimPattern = new RegExp(`\\b(?:caus(?:e|ed|es|ing)|because of|due to|diagnos(?:e|ed|is)|failed component|(?:problem|failure) (?:was|is)|failure was hiding|failed ${componentPattern}|${componentPattern} (?:failed|failure))\\b`, 'i');
const replacementClaimPattern = /\b(?:replaced|installed|swapped|replacement (?:was|is) (?:installed|completed|performed))\b/i;
const repairClaimPattern = /\b(?:we|our technician|the technician|our team)\s+(?:repaired|fixed|cleaned|adjusted|rewired|sealed|serviced|tested|inspected)\b|\b(?:was|were) repaired\b|\brepairs? (?:were |was )?(?:completed|performed)\b/i;
const resultClaimPattern = /\b(?:back in service|restored|working again|operating normally|now (?:works|working)|problem resolved|issue resolved|fixed)\b/i;
const measurementClaimPattern = /\b\d+(?:\.\d+)?\s*(?:v|volts?|amps?|psi|ohms?|percent|%|degrees?|°[cf])\b/i;
const safetyOrSavingsClaimPattern = /\b(?:safe to use|safety (?:verified|confirmed|passed)|saved? (?:money|energy|cost)|reduced? (?:cost|bill|usage))\b/i;
const technicianActionPattern = /\b(?:our technician|the technician|our team)\s+(?:found|diagnosed|repaired|replaced|installed|fixed|restored|tested|inspected|cleaned|adjusted)\b|\bwe\s+(?:found(?!\s+inside\b)|diagnosed|repaired|replaced|installed|fixed|restored|tested|inspected|cleaned|adjusted)\b/i;

const neutralPresentationTokens = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'of', 'to', 'in', 'on', 'at', 'for', 'from', 'with', 'and', 'or', 'but', 'our', 'your',
  'their', 'its', 'it', 'why', 'what', 'how', 'when', 'where', 'here', 'inside', 'close', 'up',
  'look', 'shown', 'visible', 'detail', 'view', 'scene', 'photo', 'image', 'unit', 'equipment',
  'component', 'we', 'found', 'one', 'small', 'having', 'similar', 'send', 'message', 'us',
]);

const brandCtaTokens = new Set([
  'issue', 'help', 'contact', 'call', 'book', 'schedule', 'today', 'learn', 'more', 'get', 'touch',
]);

function meaningfulEvidenceTokens(value) {
  return (String(value ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .map(normalizeEvidenceToken)
    .filter((token) => token && !neutralPresentationTokens.has(token));
}

function normalizeEvidenceToken(token) {
  const exact = {
    burned: 'burn', burning: 'burn', heating: 'heat', cooling: 'cool', stopped: 'stop',
    replaced: 'replace', replacing: 'replace', repaired: 'repair', repairing: 'repair',
    restored: 'restore', restoring: 'restore', installed: 'install', installing: 'install',
  };
  return exact[token] ?? token;
}

function evidenceTokenSet(evidence) {
  return new Set(evidence.flatMap((item) => meaningfulEvidenceTokens(item.text)));
}

function allowedCapabilityTokens(factIds) {
  const result = new Set();
  if (factIds.has('repair-performed')) ['repair', 'replace', 'install', 'fix', 'service', 'test'].forEach((token) => result.add(token));
  if (Array.from(factIds).some((id) => id.startsWith('installed-material-'))) ['replace', 'install', 'replacement', 'part', 'material'].forEach((token) => result.add(token));
  if (factIds.has('final-result')) ['restore', 'working', 'operation', 'back', 'service', 'result'].forEach((token) => result.add(token));
  return result;
}

function assertLiteralFactCoverage(text, factEvidence) {
  const factText = factEvidence.map((item) => String(item.text ?? '').toLowerCase()).join(' ');
  const measurements = text.toLowerCase().match(/\b\d+(?:\.\d+)?\s*(?:v|volts?|amps?|psi|ohms?|percent|%|degrees?)\b/g) ?? [];
  if (measurements.some((measurement) => !factText.includes(measurement))) fail('REEL_GROUNDING_FAILED');
  if (safetyOrSavingsClaimPattern.test(text)) {
    const factualTokens = evidenceTokenSet(factEvidence);
    if (meaningfulEvidenceTokens(text).some((token) => !factualTokens.has(token))) fail('REEL_GROUNDING_FAILED');
  }
}

function genericCaptionStart(value) {
  const firstSentence = value.trim().split(/[!?\.]/, 1)[0]?.trim() ?? '';
  return genericCreativePattern.test(firstSentence);
}

function cleanLocalFacts(value) {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const allowed = new Set(['diagnosis', 'repairPerformed', 'finalResult']);
  assertNoUnknownFields(row, allowed);
  return {
    diagnosis: cleanText(row.diagnosis, 700),
    repairPerformed: cleanText(row.repairPerformed, 700),
    finalResult: cleanText(row.finalResult, 700),
  };
}

function exactObject(value, fields) {
  const row = plainObject(value, 'INVALID_REEL_PROVIDER_OUTPUT');
  assertExactFields(row, new Set(fields), 'INVALID_REEL_PROVIDER_OUTPUT');
  return row;
}

function objectSchema(required, properties) {
  return { type: 'object', additionalProperties: false, required, properties };
}

function ids(value, required = false) {
  if (!Array.isArray(value) || (required && !value.length) || value.length > 8) fail('INVALID_REEL_PROVIDER_OUTPUT');
  const result = value.map((item) => exactId(item, 180));
  if (new Set(result).size !== result.length) fail('INVALID_REEL_PROVIDER_OUTPUT');
  return result;
}

function requiredText(value, limit) {
  const text = cleanText(value, limit);
  if (!text) fail('INVALID_REEL_PROVIDER_OUTPUT');
  return text;
}

function cleanText(value, limit) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value !== value.trim() || value.length > limit || /[<>\u0000-\u001f\u007f]/.test(value)) fail('INVALID_REEL_PROVIDER_OUTPUT');
  return value;
}

function exactId(value, limit) {
  if (typeof value !== 'string' || value !== value.trim() || !value || value.length > limit || !/^[A-Za-z0-9:_-]+$/.test(value)) fail('INVALID_REQUEST');
  return value;
}

function assertExactFields(value, allowed, code = 'INVALID_REQUEST') {
  assertNoUnknownFields(value, allowed, code);
  for (const key of allowed) if (!Object.prototype.hasOwnProperty.call(value, key)) fail(code);
}

function assertNoUnknownFields(value, allowed, code = 'INVALID_REQUEST') {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(code);
}

function plainObject(value, code = 'INVALID_REQUEST') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function wordCount(value) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function countHashtags(value) {
  return (value.match(/(?:^|\s)#[\p{L}\p{N}_-]+/gu) ?? []).length;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fail(code) {
  throw new Error(code);
}
