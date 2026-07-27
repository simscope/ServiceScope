import { ProviderError, isRetryableProviderCode } from '../errors.js';

export function createOpenAiProvider({ apiKey, model, fetchImpl = fetch }) {
  if (!apiKey || !model) return null;
  return {
    id: 'openai',
    capabilities: { structuredJson: true, timeoutSignal: true, usageMetadata: true, futureStreaming: true },
    async generate(request, options) {
      let response;
      try {
        response = await fetchImpl('https://api.openai.com/v1/responses', {
          method: 'POST',
          signal: options.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            input: request.prompt,
            text: { format: { type: 'json_object' } },
            max_output_tokens: 1200,
          }),
        });
      } catch (error) {
        throw providerError('PROVIDER_UNAVAILABLE', { retryable: true, cause: error });
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw mapOpenAiError(response, payload);
      const text = payload.output_text ?? payload.output?.[0]?.content?.[0]?.text ?? '';
      return {
        provider: 'openai',
        model,
        providerRequestId: response.headers.get('x-request-id') ?? undefined,
        rawJson: JSON.parse(text),
        usage: payload.usage ? {
          inputTokens: payload.usage.input_tokens,
          outputTokens: payload.usage.output_tokens,
          totalTokens: payload.usage.total_tokens,
        } : undefined,
      };
    },
  };
}

export async function preflightOpenAiCredentials({ apiKey, model, fetchImpl = fetch, signal } = {}) {
  if (!apiKey || !model) {
    return { ok: false, provider: 'openai', model: model ?? '', code: 'ENGINE_NOT_CONFIGURED' };
  }
  let response;
  try {
    response = await fetchImpl(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
      method: 'GET',
      signal,
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (error) {
    const mapped = providerError('PROVIDER_UNAVAILABLE', { retryable: true, cause: error });
    return safePreflightResult({ provider: 'openai', model, error: mapped });
  }
  const payload = await response.json().catch(() => ({}));
  if (response.ok) {
    return {
      ok: true,
      provider: 'openai',
      model,
      code: 'OK',
      httpStatus: response.status,
      providerRequestId: response.headers?.get?.('x-request-id') ?? undefined,
    };
  }
  return safePreflightResult({ provider: 'openai', model, error: mapOpenAiError(response, payload) });
}

export function createPreflightFromEnv(readEnv, fetchImpl = fetch) {
  const providerId = readEnv('AI_CONTENT_PROVIDER') ?? '';
  const model = readEnv('AI_CONTENT_MODEL') ?? '';
  return async ({ signal } = {}) => {
    if (providerId !== 'openai') return { ok: false, provider: providerId, model, code: 'ENGINE_NOT_CONFIGURED' };
    return preflightOpenAiCredentials({ apiKey: readEnv('OPENAI_API_KEY') ?? '', model, fetchImpl, signal });
  };
}

export function createProviderFromEnv(readEnv, fetchImpl = fetch) {
  const providerId = readEnv('AI_CONTENT_PROVIDER') ?? '';
  const model = readEnv('AI_CONTENT_MODEL') ?? '';
  if (providerId !== 'openai') return { provider: null, providerId, model };
  return {
    provider: createOpenAiProvider({ apiKey: readEnv('OPENAI_API_KEY') ?? '', model, fetchImpl }),
    providerId,
    model,
  };
}

export function mapOpenAiError(response, payload = {}) {
  const httpStatus = Number(response.status) || undefined;
  const providerRequestId = response.headers?.get?.('x-request-id') ?? undefined;
  const error = payload && typeof payload === 'object' && !Array.isArray(payload) && payload.error && typeof payload.error === 'object'
    ? payload.error
    : {};
  const providerErrorType = typeof error.type === 'string' ? error.type : undefined;
  const providerErrorCode = typeof error.code === 'string' ? error.code : undefined;
  const code = normalizeOpenAiErrorCode(httpStatus, providerErrorType, providerErrorCode);
  return providerError(code, {
    httpStatus,
    providerRequestId,
    providerErrorType,
    providerErrorCode,
    retryable: isRetryableProviderCode(code),
  });
}

export function normalizeOpenAiErrorCode(httpStatus, providerErrorType, providerErrorCode) {
  if (httpStatus === 401) return 'PROVIDER_AUTH_FAILED';
  if (httpStatus === 403) return 'PROVIDER_ACCESS_DENIED';
  if (httpStatus === 404 || providerErrorCode === 'model_not_found') return 'PROVIDER_MODEL_UNAVAILABLE';
  if (httpStatus === 429 && providerErrorCode === 'insufficient_quota') return 'PROVIDER_QUOTA_EXCEEDED';
  if (httpStatus === 429 && (providerErrorCode === 'rate_limit_exceeded' || providerErrorType === 'rate_limit_exceeded')) return 'PROVIDER_RATE_LIMITED';
  if (httpStatus === 429) return 'PROVIDER_RATE_LIMITED';
  if (httpStatus && httpStatus >= 500) return 'PROVIDER_UNAVAILABLE';
  return 'PROVIDER_UNAVAILABLE';
}

function providerError(code, details) {
  return new ProviderError(code, details);
}

function safePreflightResult({ provider, model, error }) {
  return {
    ok: false,
    provider,
    model,
    code: error.code ?? 'PROVIDER_UNAVAILABLE',
    httpStatus: error.httpStatus,
    providerRequestId: error.providerRequestId,
    providerErrorType: error.providerErrorType,
    providerErrorCode: error.providerErrorCode,
  };
}
