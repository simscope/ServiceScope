import { buildProviderNeutralMediaResponseFormat } from '../schemas.js';
import { MediaAnalysisError } from '../errors.js';
import { providerPayloadSchemaVersion } from '../contracts.js';

const openAiResponsesUrl = 'https://api.openai.com/v1/responses';

export function createOpenAiMediaProvider({ apiKey, model, fetchImpl = fetch }) {
  if (!apiKey || !model) return null;
  return {
    id: 'openai',
    model,
    async analyze(providerRequest, options = {}) {
      const body = buildOpenAiMediaRequest({ model, providerRequest, maxOutputTokens: options.maxOutputTokens });
      const response = await fetchImpl(openAiResponsesUrl, {
        method: 'POST',
        signal: options.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const providerRequestId = response.headers?.get?.('x-request-id') ?? undefined;
      let payload;
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }
      if (!response.ok) throw mapOpenAiMediaError(response, payload, providerRequestId);
      const outputText = extractResponsesOutputText(payload, providerRequestId);
      let rawJson;
      try {
        rawJson = JSON.parse(outputText);
      } catch (error) {
        throw new MediaAnalysisError('MEDIA_INVALID_PROVIDER_OUTPUT', { retryable: false, providerRequestId, cause: error });
      }
      return {
        provider: 'openai',
        model,
        rawJson,
        usage: normalizeUsage(payload.usage),
        providerRequestId,
      };
    },
  };
}

export function createMediaProviderFromEnv(getEnv, fetchImpl = fetch) {
  const providerId = String(getEnv('AI_MEDIA_PROVIDER') ?? '').trim().toLowerCase();
  const model = String(getEnv('AI_MEDIA_MODEL') ?? 'gpt-4.1-mini').trim();
  if (providerId !== 'openai') return { provider: null, providerId: providerId || 'deterministic-fallback', model };
  return {
    provider: createOpenAiMediaProvider({ apiKey: getEnv('OPENAI_API_KEY'), model, fetchImpl }),
    providerId,
    model,
  };
}

export function buildOpenAiMediaRequest({ model, providerRequest, maxOutputTokens = 900 }) {
  return {
    model,
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: buildMediaPrompt(providerRequest) },
        ...providerRequest.mediaInputs.map((input) => ({
          type: 'input_image',
          image_url: input.imageUrl,
          detail: 'low',
        })),
      ],
    }],
    text: { format: buildProviderNeutralMediaResponseFormat() },
    max_output_tokens: Math.min(1400, Math.max(300, Number(maxOutputTokens) || 900)),
    store: false,
  };
}

export function buildMediaPrompt({ request, context, mediaInputs }) {
  const attachmentLines = mediaInputs.map((input) => `- attachmentId: ${input.attachmentId}; MIME: ${input.mimeType}`).join('\n');
  return [
    `Return strict JSON matching schemaVersion ${providerPayloadSchemaVersion}.`,
    'Analyze only the attached photos listed by attachmentId.',
    'Findings are suggestions, not facts. Every finding requires user review.',
    'Never diagnose equipment from an image.',
    'Never claim repair success from an image.',
    'Never confirm brand, model, serial, measurement, or technical identity.',
    'Do not transcribe visible private text. Do not return OCR text.',
    'Do not return names, addresses, phone numbers, email, serial values, license plates, barcodes, or document text.',
    'Use neutral explanations. Uncertainty must be explicit.',
    'Allowed explanations include: "May contain a serial or nameplate.", "Possible repair-process image.", "Could be useful as an overview."',
    'Disallowed claims include: "Serial number is 12345.", "The compressor failed.", "The repair fixed the system."',
    'Use only the exact enum categories and risk levels from the JSON schema.',
    `Analysis mode: ${request.analysisMode}. Job status: ${context.status}.`,
    'Photo attachments:',
    attachmentLines,
  ].join('\n');
}

export function extractResponsesOutputText(value, providerRequestId) {
  if (value?.status === 'incomplete') {
    throw new MediaAnalysisError('MEDIA_ANALYSIS_INCOMPLETE', {
      retryable: false,
      providerRequestId,
      providerErrorType: 'incomplete',
      providerErrorCode: value?.incomplete_details?.reason,
    });
  }
  if (typeof value?.output_text === 'string' && value.output_text.trim()) return value.output_text;
  for (const item of value?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === 'refusal') {
        throw new MediaAnalysisError('MEDIA_REFUSAL', { retryable: false, providerRequestId, providerErrorType: 'refusal' });
      }
      if (content?.type === 'output_text' && typeof content.text === 'string' && content.text.trim()) return content.text;
    }
  }
  throw new MediaAnalysisError('MEDIA_INVALID_PROVIDER_OUTPUT', { retryable: false, providerRequestId });
}

export function mapOpenAiMediaError(response, body = {}, providerRequestId = response?.headers?.get?.('x-request-id') ?? undefined) {
  const status = Number(response?.status) || 0;
  const type = body?.error?.type;
  const code = body?.error?.code;
  if (status === 401) return providerError('MEDIA_PROVIDER_AUTH_FAILED', status, type, code, providerRequestId, false);
  if (status === 403) return providerError('MEDIA_PROVIDER_ACCESS_DENIED', status, type, code, providerRequestId, false);
  if (status === 404 || code === 'model_not_found') return providerError('MEDIA_PROVIDER_ACCESS_DENIED', status, type, code, providerRequestId, false);
  if (status === 429 && (type === 'insufficient_quota' || code === 'insufficient_quota')) return providerError('MEDIA_PROVIDER_QUOTA_EXCEEDED', status, type, code, providerRequestId, false);
  if (status === 429) return providerError('MEDIA_PROVIDER_RATE_LIMITED', status, type, code, providerRequestId, true);
  if (status >= 500) return providerError('MEDIA_PROVIDER_UNAVAILABLE', status, type, code, providerRequestId, true);
  return providerError('MEDIA_PROVIDER_UNAVAILABLE', status, type, code, providerRequestId, true);
}

function providerError(code, httpStatus, providerErrorType, providerErrorCode, providerRequestId, retryable) {
  return new MediaAnalysisError(code, { httpStatus, providerErrorType, providerErrorCode, providerRequestId, retryable });
}

function normalizeUsage(usage = {}) {
  return {
    inputTokens: Number(usage.input_tokens) || undefined,
    outputTokens: Number(usage.output_tokens) || undefined,
    totalTokens: Number(usage.total_tokens) || undefined,
  };
}
