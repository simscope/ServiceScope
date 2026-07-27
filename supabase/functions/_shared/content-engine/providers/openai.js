import { ProviderError, isRetryableProviderCode } from '../errors.js';
import { buildProviderOutputResponseFormat } from '../schemas.js';

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
            text: { format: buildProviderOutputResponseFormat() },
            max_output_tokens: 1200,
          }),
        });
      } catch (error) {
        throw providerError('PROVIDER_UNAVAILABLE', { retryable: true, cause: error });
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw mapOpenAiError(response, payload);
      const providerRequestId = response.headers.get('x-request-id') ?? undefined;
      const text = extractResponsesOutputText(payload, providerRequestId);
      return {
        provider: 'openai',
        model,
        providerRequestId,
        rawJson: parseProviderJsonText(text, { providerRequestId, responseStatus: payload.status }),
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

export function extractResponsesOutputText(payload = {}, providerRequestId) {
  const status = typeof payload.status === 'string' ? payload.status : undefined;
  if (status === 'incomplete') {
    throw providerError('PROVIDER_INCOMPLETE', {
      retryable: isRetryableIncomplete(payload.incomplete_details?.reason),
      providerOutputSubreason: 'PROVIDER_INCOMPLETE',
      responseStatus: status,
      incompleteReason: typeof payload.incomplete_details?.reason === 'string' ? payload.incomplete_details.reason : undefined,
      providerRequestId,
    });
  }
  if (status && status !== 'completed') {
    throw providerError('PROVIDER_UNAVAILABLE', { retryable: true, responseStatus: status, providerRequestId });
  }
  const refusal = findResponsesRefusal(payload);
  if (refusal) {
    throw providerError('PROVIDER_REFUSAL', {
      retryable: false,
      providerOutputSubreason: 'PROVIDER_REFUSAL',
      responseStatus: status,
      providerRequestId,
    });
  }
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  const message = Array.isArray(payload.output) ? payload.output.find((item) => item?.type === 'message') : undefined;
  const outputText = Array.isArray(message?.content)
    ? message.content.find((item) => item?.type === 'output_text' && typeof item.text === 'string')?.text
    : undefined;
  if (typeof outputText === 'string' && outputText.trim()) return outputText;
  throw providerError('INVALID_PROVIDER_OUTPUT', {
    retryable: false,
    providerOutputSubreason: 'INVALID_PROVIDER_OUTPUT_PARSE_FAILED',
    responseStatus: status,
    providerRequestId,
  });
}

export function parseProviderJsonText(text, diagnostics = {}) {
  try {
    return JSON.parse(text);
  } catch {
    throw providerError('INVALID_PROVIDER_OUTPUT', {
      retryable: false,
      providerOutputSubreason: 'INVALID_PROVIDER_OUTPUT_PARSE_FAILED',
      parsedJsonBytes: byteLength(String(text ?? '')),
      responseStatus: diagnostics.responseStatus,
      providerRequestId: diagnostics.providerRequestId,
    });
  }
}

function providerError(code, details) {
  return new ProviderError(code, details);
}

function findResponsesRefusal(payload) {
  if (typeof payload.refusal === 'string' && payload.refusal.trim()) return true;
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.some((item) => Array.isArray(item?.content) && item.content.some((content) => content?.type === 'refusal' || typeof content?.refusal === 'string'));
}

function isRetryableIncomplete(reason) {
  return reason === 'server_error' || reason === 'rate_limit_exceeded';
}

function byteLength(text) {
  return new TextEncoder().encode(text).byteLength;
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
