import { buildAuthorizedContext } from '../content-engine/context.js';
import { applyCompanyVoiceToRequest } from '../content-engine/companyVoice.js';
import { assertNoPrivateValues, safeTelemetryPayload } from '../content-engine/privacy.js';
import { genericCreativePattern, reelLimits, reelPlanSchemaVersion } from './contracts.js';
import { buildReelPrompt } from './prompts.js';
import { parseReelProviderResult, validateReelRequestBody } from './schemas.js';
import { reconstructAuthoritativeReelMedia } from './mediaEvidence.js';
import { withReelEvidenceCapability } from './evidenceCapabilities.js';

export async function handleReelGeneration({ rawBody, authorization, auth, repository, provider, guards, config, telemetry }) {
  if (!authorization?.startsWith('Bearer ')) throw new ReelHttpError('AUTH_REQUIRED', 401);
  if (byteLength(rawBody) > reelLimits.maxRequestBytes) throw new ReelHttpError('INVALID_REQUEST', 400);
  let request;
  try {
    request = validateReelRequestBody(JSON.parse(rawBody || '{}'));
  } catch (error) {
    throw new ReelHttpError(error instanceof Error ? error.message : 'INVALID_REQUEST', 400);
  }
  const session = await auth.resolveSession(authorization);
  const contentRequest = {
    schemaVersion: 'content-generation-request-v1',
    jobId: request.jobId,
    channel: 'Short Video',
    tone: 'Marketing',
    locale: request.locale,
    promptVersion: 'short-video-v1',
    idempotencyKey: request.idempotencyKey,
    localFacts: request.localFacts,
    mediaState: request.mediaPlan.map((item) => ({ id: item.attachmentId, selected: true, order: item.position - 1 })),
  };
  const baseContext = await buildAuthorizedContext({ request: contentRequest, session, repository });
  const voicedRequest = applyCompanyVoiceToRequest(contentRequest, baseContext.companyVoice);
  const context = await buildReelContext(request, baseContext, repository);
  const cacheKey = [context.companyId, context.actorId, request.jobId, 'AI Reel', request.planningRevision, request.idempotencyKey].join(':');
  const cached = guards.get(cacheKey);
  if (cached) return cached;
  if (!guards.allow(`${context.companyId}:${context.actorId}`)) {
    throw new ReelHttpError('RATE_LIMITED', 429);
  }
  const contentDecision = deterministicReelPreGate(context);
  if (contentDecision) {
    const result = finalizePlan(contentDecision, request, context);
    guards.set(cacheKey, result);
    return result;
  }
  const result = await generateReel({ request: { ...request, promptVersion: voicedRequest.promptVersion }, context, provider, config, telemetry });
  const persisted = await persistCreativePlan(result, request, context, repository);
  guards.set(cacheKey, persisted);
  return persisted;
}

export async function generateReel({ request, context, provider, config, telemetry, clock = Date }) {
  const startedAt = clock.now();
  let attempts = 0;
  try {
    assertNoPrivateValues(context.evidence, context.privateValuesForLeakDetection);
    if (!provider) throw new ReelHttpError('ENGINE_NOT_CONFIGURED', 500);
    const providerRequest = buildReelPrompt(request, context);
    assertNoPrivateValues(providerRequest, context.privateValuesForLeakDetection);
    const response = await callProvider(provider, providerRequest, config);
    attempts = response.attempts;
    const plan = parseReelProviderResult(response.result.rawJson, context);
    assertNoPrivateValues(plan, context.privateValuesForLeakDetection);
    telemetry?.record?.(safeTelemetryPayload({
      correlationId: request.idempotencyKey,
      provider: response.result.provider,
      model: response.result.model,
      channel: 'AI Reel',
      promptVersion: 'reel-director-v1',
      success: true,
      code: 'OK',
      latencyMs: clock.now() - startedAt,
      attempts,
    }));
    return finalizePlan(plan, request, context);
  } catch (error) {
    const code = reelErrorCode(error);
    telemetry?.record?.(safeTelemetryPayload({
      correlationId: request.idempotencyKey,
      provider: provider?.id ?? 'deterministic-fallback',
      model: config.model,
      channel: 'AI Reel',
      promptVersion: 'reel-director-v1',
      success: false,
      code,
      latencyMs: clock.now() - startedAt,
      attempts: attempts || error?.attempts || 0,
    }));
    if (error instanceof ReelHttpError) throw error;
    throw new ReelHttpError(code, statusForReelCode(code));
  }
}

export function deterministicReelPreGate(context) {
  const hasStory = context.evidence.some((item) => {
    if (!['complaint', 'diagnosis', 'repair-performed', 'final-result'].includes(item.id)
      && !String(item.id).startsWith('installed-material-')) return false;
    const text = String(item.text ?? '').trim();
    return text.split(/\s+/).filter(Boolean).length >= 3 && !genericCreativePattern.test(text);
  });
  const meaningfulMedia = context.safeMedia.filter((item) => item.meaningful !== false);
  if (hasStory && meaningfulMedia.length >= 2) return null;
  const decision = hasStory ? 'needs_more_media' : 'skip';
  const qualityScore = decision === 'needs_more_media' ? 50 : 30;
  const missingShots = decision === 'needs_more_media'
    ? missingShotInstructions(context.safeMedia)
    : [];
  return {
    schemaVersion: reelPlanSchemaVersion,
    decision,
    qualityScore,
    qualityReasons: [decision === 'needs_more_media' ? 'The service story needs more distinct safe visual coverage.' : 'The available evidence does not support a useful marketing Reel.'],
    marketingAngle: hasStory ? 'failure_explainer' : 'maintenance_tip',
    hook: { text: '', evidenceIds: [] },
    cover: { title: '', attachmentId: null },
    scenes: [],
    caption: { text: '', evidenceIds: [] },
    voiceover: { enabled: false, script: '', evidenceIds: [] },
    missingShots,
    claims: [],
    safety: { ok: true, privacy: 'passed', grounding: 'passed', quality: 'failed', blockedReasons: [] },
    brand: { enabled: false, displayName: '', cta: '', durationMs: 0, evidenceIds: [] },
    audio: { musicMode: 'none' },
  };
}

export function reelPlanRevision(plan, inputRevision) {
  const canonical = JSON.stringify({ inputRevision, plan });
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `reel-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export class ReelHttpError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function buildReelContext(request, baseContext, repository) {
  const authoritativeRows = await repository.listReelMediaCandidates(
    baseContext.companyId,
    request.jobId,
    request.mediaPlan.map((item) => item.attachmentId),
  );
  if (!Array.isArray(authoritativeRows) || authoritativeRows.length > reelLimits.maxMediaItems * 24) {
    throw new ReelHttpError('REEL_MEDIA_UNAVAILABLE', 409);
  }
  let safeMedia;
  try {
    safeMedia = reconstructAuthoritativeReelMedia(request.mediaPlan, authoritativeRows);
  } catch (error) {
    const code = reelErrorCode(error);
    throw new ReelHttpError(code, statusForReelCode(code));
  }
  const mediaEvidence = safeMedia.map((item) => ({
    id: item.evidenceId,
    label: `Approved media: ${item.role}`,
    text: item.evidenceText,
    source: 'Authoritative persisted media analysis',
    attachmentId: item.attachmentId,
  })).map(withReelEvidenceCapability);
  const companyVoiceEvidence = baseContext.companyVoice?.enabled && baseContext.companyVoice.publicDisplayName
    ? [{
        id: 'company-public-display-name',
        label: 'Approved public company name',
        text: baseContext.companyVoice.publicDisplayName,
        source: 'Company voice settings',
      }].map(withReelEvidenceCapability)
    : [];
  const evidence = [
    ...baseContext.evidence
      .filter((item) => !String(item.id).startsWith('attachment-'))
      .map(withReelEvidenceCapability),
    ...mediaEvidence,
    ...companyVoiceEvidence,
  ];
  return { ...baseContext, evidence, safeMedia };
}

async function callProvider(provider, providerRequest, config) {
  const maxAttempts = Math.min(3, Math.max(1, config.maxAttempts || 1));
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const result = await provider.generate(providerRequest, {
        signal: controller.signal,
        timeoutMs: config.timeoutMs,
        maxOutputBytes: config.maxOutputBytes,
        correlationId: providerRequest.promptVersion,
      });
      return { result, attempts: attempt };
    } catch (error) {
      lastError = controller.signal.aborted
        ? new ReelHttpError('PROVIDER_TIMEOUT', 503)
        : error instanceof Error
          ? error
          : new ReelHttpError('PROVIDER_UNAVAILABLE', 503);
      lastError.attempts = attempt;
      if (attempt === maxAttempts || !reelRetryable(lastError)) break;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function finalizePlan(plan, request, context) {
  const safePlan = JSON.parse(JSON.stringify(plan));
  return {
    ...safePlan,
    revision: reelPlanRevision(safePlan, JSON.stringify({
      jobId: request.jobId,
      planningRevision: request.planningRevision,
      media: context.safeMedia.map((item) => [item.attachmentId, item.position, item.role, item.evidenceId]),
      mediaAuthority: context.safeMedia.map((item) => [
        item.attachmentId,
        item.attachmentResultId,
        item.analysisRunId,
        item.attachmentSha256,
        item.evidenceFindingId,
        item.evidenceCategory,
        item.evidenceText,
        item.confidence,
        item.privacyStatus,
      ]),
      evidence: context.evidence.map((item) => [item.id, item.text]),
      companyVoice: context.companyVoice,
    })),
  };
}

async function persistCreativePlan(plan, request, context, repository) {
  if (plan.decision !== 'create_reel' || typeof repository.persistReelCreativePlan !== 'function') return plan;
  const creativePlanId = await repository.persistReelCreativePlan({
    companyId: context.companyId,
    jobId: context.jobId,
    createdBy: context.actorAuthUserId,
    schemaVersion: plan.schemaVersion,
    planRevision: plan.revision,
    locale: request.locale,
    planningRevision: request.planningRevision,
    localFacts: request.localFacts,
    mediaPlan: request.mediaPlan.map(({ attachmentId, position }) => ({ attachmentId, position })),
    plan,
  });
  if (!creativePlanId) throw new ReelHttpError('REEL_GENERATION_FAILED', 503);
  return { ...plan, creativePlanId };
}

function missingShotInstructions(media) {
  const roles = new Set(media.map((item) => item.role));
  const result = [];
  if (!roles.has('overview')) result.push('Capture one wider equipment or work-area shot.');
  if (!roles.has('detail') && !roles.has('replacement_part')) result.push('Capture a clear close-up of the important problem or component.');
  if (!roles.has('finished_result')) result.push('Capture the finished result after the work is complete.');
  return result.slice(0, 3);
}

function reelErrorCode(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('PRIVACY_FAILED')) return 'REEL_PRIVACY_FAILED';
  for (const code of [
    'REEL_ANALYSIS_REQUIRED',
    'REEL_ANALYSIS_STALE',
    'REEL_PRIVACY_REVIEW_REQUIRED',
    'REEL_PRIVACY_FAILED',
    'REEL_GROUNDING_FAILED',
    'REEL_QUALITY_FAILED',
    'REEL_MEDIA_UNAVAILABLE',
    'INVALID_REEL_PROVIDER_OUTPUT',
    'ENGINE_NOT_CONFIGURED',
    'PROVIDER_TIMEOUT',
    'PROVIDER_RATE_LIMITED',
    'PROVIDER_UNAVAILABLE',
    'RATE_LIMITED',
  ]) {
    if (message.includes(code)) return code;
  }
  return 'REEL_GENERATION_FAILED';
}

function statusForReelCode(code) {
  if (code === 'REEL_PRIVACY_REVIEW_REQUIRED' || code === 'REEL_MEDIA_UNAVAILABLE') return 409;
  if (code === 'REEL_ANALYSIS_REQUIRED' || code === 'REEL_ANALYSIS_STALE') return 428;
  if (code === 'PROVIDER_RATE_LIMITED' || code === 'RATE_LIMITED') return 429;
  if (code === 'ENGINE_NOT_CONFIGURED') return 500;
  if (code.startsWith('PROVIDER_') || code === 'REEL_GENERATION_FAILED') return 503;
  return 422;
}

function reelRetryable(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /PROVIDER_(?:TIMEOUT|UNAVAILABLE|RATE_LIMITED)/.test(message);
}

function byteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}
