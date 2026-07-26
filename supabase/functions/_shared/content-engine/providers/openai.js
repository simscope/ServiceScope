export function createOpenAiProvider({ apiKey, model, fetchImpl = fetch }) {
  if (!apiKey || !model) return null;
  return {
    id: 'openai',
    capabilities: { structuredJson: true, timeoutSignal: true, usageMetadata: true, futureStreaming: true },
    async generate(request, options) {
      const response = await fetchImpl('https://api.openai.com/v1/responses', {
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
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 429 || response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REJECTED');
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
