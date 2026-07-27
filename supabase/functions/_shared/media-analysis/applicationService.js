import { buildAuthorizedMediaContext } from './authorization.js';
import { analysisVersion, maxRequestBytes, maxVisionPhotos } from './contracts.js';
import { MediaAnalysisError, httpError, normalizeMediaErrorCode, statusForMediaCode } from './errors.js';
import { assertNoPrivateValues, assertNoUnsafeClientMediaInput } from './privacy.js';
import {
  buildMediaAnalysisResult,
  parseProviderMediaResult,
  validateMediaAnalysisRequestBody,
  validateMediaAnalysisResultShape,
} from './schemas.js';
import { safeMediaTelemetryPayload } from './telemetry.js';

export async function handleMediaAnalysis({ rawBody, authorization, auth, repository, provider, guards, config, telemetry, clock = Date }) {
  if (!authorization?.startsWith('Bearer ')) throw httpError('AUTH_REQUIRED', 401);
  if (byteLength(rawBody) > maxRequestBytes) throw httpError('MEDIA_REQUEST_TOO_LARGE');
  const request = validateMediaAnalysisRequestBody(parseJson(rawBody));
  assertNoUnsafeClientMediaInput(request);
  const session = await auth.resolveSession(authorization);
  const context = await buildAuthorizedMediaContext({ request, session, repository });
  assertNoPrivateValues(context.attachments, context.privateValues);
  const visionPhotos = context.attachments.filter((attachment) => attachment.mediaKind === 'photo');
  if (visionPhotos.length > maxVisionPhotos) throw httpError('MEDIA_REQUEST_TOO_LARGE');

  const fingerprint = mediaFingerprint({ request, context, config });
  const cacheKey = [context.companyId, context.actorId, fingerprint, request.idempotencyKey].join(':');
  const cached = guards?.get?.(cacheKey);
  if (cached) return cached;

  const start = clock.now();
  const result = provider && visionPhotos.length
    ? await analyzeWithProvider({ request, context, provider, config, telemetry, clock, start })
    : buildMediaAnalysisResult({
        request,
        context,
        provider: 'deterministic-fallback',
        model: config?.model ?? 'not-configured',
        code: 'MEDIA_PROVIDER_NOT_CONFIGURED',
        latencyMs: clock.now() - start,
        attempts: 0,
      });

  assertNoPrivateValues(result, context.privateValues);
  validateMediaAnalysisResultShape(result);
  emitTelemetry(telemetry, {
    correlationId: request.idempotencyKey,
    provider: result.provider,
    model: result.model,
    analysisVersion,
    analysisMode: request.analysisMode,
    success: result.safety.ok,
    code: result.warnings[0]?.code ?? 'OK',
    latencyMs: result.telemetry.latencyMs,
    attempts: result.telemetry.attempts,
    attachments: context.attachments,
  });
  guards?.set?.(cacheKey, result);
  return result;
}

export { MediaAnalysisError as HttpError };

async function analyzeWithProvider({ request, context, provider, config, telemetry, clock, start }) {
  try {
    const mediaInputs = await buildSignedMediaInputs({ context, repository: config.repository });
    const response = await callWithRetry(provider, { request, context, mediaInputs }, config);
    const result = parseProviderMediaResult(response.result.rawJson, {
      request,
      context,
      provider: response.result.provider ?? provider.id,
      model: response.result.model ?? config?.model ?? 'unknown',
      usage: response.result.usage,
      attempts: response.attempts,
      latencyMs: clock.now() - start,
    });
    assertNoPrivateValues(result, context.privateValues);
    return result;
  } catch (error) {
    const code = normalizeMediaErrorCode(error);
    emitTelemetry(telemetry, {
      correlationId: request.idempotencyKey,
      provider: provider?.id ?? 'unknown',
      model: config?.model ?? 'unknown',
      analysisVersion,
      analysisMode: request.analysisMode,
      success: false,
      code,
      latencyMs: clock.now() - start,
      attempts: error?.attempts ?? 1,
      httpStatus: error?.httpStatus,
      providerRequestId: error?.providerRequestId,
      providerErrorType: error?.providerErrorType,
      providerErrorCode: error?.providerErrorCode,
      attachments: context.attachments,
    });
    return buildMediaAnalysisResult({
      request,
      context,
      provider: 'deterministic-fallback',
      model: config?.model ?? 'unknown',
      code,
      latencyMs: clock.now() - start,
      attempts: error?.attempts ?? 1,
    });
  }
}

async function callWithRetry(provider, providerRequest, config = {}) {
  const maxAttempts = Math.min(3, Math.max(1, Number(config.maxAttempts) || 1));
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(config.timeoutMs) || 10_000);
    try {
      const result = await provider.analyze(providerRequest, { signal: controller.signal, timeoutMs: config.timeoutMs, maxOutputTokens: config.maxOutputTokens });
      return { result, attempts: attempt };
    } catch (error) {
      lastError = controller.signal.aborted ? new MediaAnalysisError('MEDIA_PROVIDER_TIMEOUT', { retryable: true }) : error;
      lastError.attempts = attempt;
      if (!shouldRetry(lastError) || attempt === maxAttempts) break;
      await wait(150 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function shouldRetry(error) {
  return Boolean(error?.retryable) || ['MEDIA_PROVIDER_RATE_LIMITED', 'MEDIA_PROVIDER_TIMEOUT', 'MEDIA_PROVIDER_UNAVAILABLE'].includes(error?.code ?? error?.message);
}

async function buildSignedMediaInputs({ context, repository }) {
  const photoAttachments = context.attachments.filter((attachment) => attachment.mediaKind === 'photo');
  const inputs = [];
  for (const attachment of photoAttachments) {
    const signedUrl = await repository.createSignedMediaUrl(attachment);
    if (!signedUrl) throw httpError('MEDIA_PROVIDER_UNAVAILABLE');
    inputs.push({
      attachmentId: attachment.id,
      mimeType: attachment.mimeType,
      kind: attachment.mediaKind,
      imageUrl: signedUrl,
    });
  }
  return inputs;
}

export function mediaFingerprint({ request, context, config = {} }) {
  const attachmentVersion = context.attachments
    .map((attachment) => [
      attachment.id,
      attachment.storagePath,
      attachment.updatedAt || attachment.createdAt || '',
      attachment.sizeBytes,
      attachment.mimeType,
    ].join('@'))
    .sort()
    .join('|');
  return [
    context.companyId,
    context.jobId,
    request.analysisMode,
    analysisVersion,
    config.providerId ?? 'deterministic-fallback',
    config.model ?? 'unknown',
    attachmentVersion,
  ].join(':');
}

function emitTelemetry(telemetry, event) {
  telemetry?.record?.(safeMediaTelemetryPayload(event));
}

function parseJson(rawBody) {
  try {
    return JSON.parse(rawBody || '{}');
  } catch {
    throw httpError('INVALID_REQUEST');
  }
}

function byteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function statusForCode(code) {
  return statusForMediaCode(code);
}
