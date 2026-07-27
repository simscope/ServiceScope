import { buildPrompt } from './prompts.js';
import { deterministicFallback } from './fallback.js';
import { validateGrounding } from './grounding.js';
import { assertNoPrivateValues, safeTelemetryPayload } from './privacy.js';
import { parseProviderResult } from './schemas.js';
import { isRetryableProviderCode, ProviderError } from './errors.js';

export async function generateWithProvider({ request, context, provider, config, telemetry, clock = Date }) {
  const start = clock.now();
  try {
    assertNoPrivateValues(context.evidence, context.privateValues);
    if (!provider) return fallback(request, context, 'ENGINE_NOT_CONFIGURED', 'AI provider is not configured; fallback draft was generated.');
    const providerRequest = buildPrompt(request, context);
    assertNoPrivateValues(providerRequest, context.privateValues);
    const { response, attempts } = await callWithRetry(provider, providerRequest, config);
    const result = parseProviderResult(response.rawJson, request.channel, response.provider, response.model, response.usage);
    validateGrounding(result, context.evidence);
    assertNoPrivateValues(result, context.privateValues);
    result.missingInformation = context.missingInformation;
    emitTelemetry(telemetry, { correlationId: request.idempotencyKey, provider: result.provider, model: result.model, channel: request.channel, promptVersion: request.promptVersion, success: true, code: 'OK', latencyMs: clock.now() - start, attempts });
    return result;
  } catch (error) {
    const code = normalizeErrorCode(error);
    emitTelemetry(telemetry, {
      correlationId: request.idempotencyKey,
      provider: provider?.id ?? 'deterministic-fallback',
      model: config.model,
      channel: request.channel,
      promptVersion: request.promptVersion,
      success: false,
      code,
      latencyMs: clock.now() - start,
      attempts: error?.attempts ?? 1,
      httpStatus: error?.httpStatus,
      providerRequestId: error?.providerRequestId,
      providerErrorType: error?.providerErrorType,
      providerErrorCode: error?.providerErrorCode,
    });
    return fallback(request, context, code, safeMessage(code));
  }
}

async function callWithRetry(provider, providerRequest, config) {
  const maxAttempts = Math.min(3, Math.max(1, config.maxAttempts || 1));
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await provider.generate(providerRequest, {
        signal: controller.signal,
        timeoutMs: config.timeoutMs,
        maxOutputBytes: config.maxOutputBytes,
        correlationId: providerRequest.promptVersion,
      });
      return { response, attempts: attempt };
    } catch (error) {
      lastError = controller.signal.aborted ? new ProviderError('PROVIDER_TIMEOUT', { retryable: true }) : error;
      lastError.attempts = attempt;
      if (!isRetryable(lastError) || attempt === maxAttempts) break;
      await wait(150 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function fallback(request, context, code, message) {
  return deterministicFallback(request, context, { code, message });
}

function emitTelemetry(telemetry, event) {
  telemetry?.record?.(safeTelemetryPayload(event));
}

function normalizeErrorCode(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('PRIVACY_FAILED')) return 'PRIVACY_FAILED';
  if (message.includes('GROUNDING_FAILED')) return 'GROUNDING_FAILED';
  if (message.includes('INVALID_PROVIDER_OUTPUT')) return 'INVALID_PROVIDER_OUTPUT';
  if (message.includes('PROVIDER_TIMEOUT')) return 'PROVIDER_TIMEOUT';
  if (message.includes('PROVIDER_AUTH_FAILED')) return 'PROVIDER_AUTH_FAILED';
  if (message.includes('PROVIDER_ACCESS_DENIED')) return 'PROVIDER_ACCESS_DENIED';
  if (message.includes('PROVIDER_MODEL_UNAVAILABLE')) return 'PROVIDER_MODEL_UNAVAILABLE';
  if (message.includes('PROVIDER_QUOTA_EXCEEDED')) return 'PROVIDER_QUOTA_EXCEEDED';
  if (message.includes('PROVIDER_RATE_LIMITED')) return 'PROVIDER_RATE_LIMITED';
  if (message.includes('RATE_LIMITED')) return 'RATE_LIMITED';
  return 'PROVIDER_UNAVAILABLE';
}

function safeMessage(code) {
  if (code === 'ENGINE_NOT_CONFIGURED') return 'AI provider is not configured; fallback draft was generated.';
  if (code === 'PRIVACY_FAILED') return 'Unsafe private data was detected; fallback draft was generated.';
  if (code === 'GROUNDING_FAILED') return 'AI output could not be grounded to evidence; fallback draft was generated.';
  if (code === 'INVALID_PROVIDER_OUTPUT') return 'AI output was malformed; fallback draft was generated.';
  if (code === 'PROVIDER_TIMEOUT') return 'AI provider timed out; fallback draft was generated.';
  if (code === 'PROVIDER_AUTH_FAILED') return 'AI provider authentication failed; fallback draft was generated.';
  if (code === 'PROVIDER_ACCESS_DENIED') return 'AI provider access was denied; fallback draft was generated.';
  if (code === 'PROVIDER_MODEL_UNAVAILABLE') return 'AI provider model is unavailable; fallback draft was generated.';
  if (code === 'PROVIDER_QUOTA_EXCEEDED') return 'AI provider quota is exhausted; fallback draft was generated.';
  if (code === 'PROVIDER_RATE_LIMITED') return 'AI provider rate limit was reached; fallback draft was generated.';
  return 'AI provider was unavailable; fallback draft was generated.';
}

function isRetryable(error) {
  if (error instanceof ProviderError) return isRetryableProviderCode(error.code);
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('PROVIDER_TIMEOUT') || message.includes('PROVIDER_UNAVAILABLE') || message.includes('PROVIDER_RATE_LIMITED');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
