export function scrubText(text, privateValues) {
  return privateValues.reduce((current, value) => {
    const clean = String(value ?? '').trim();
    return clean.length > 1 ? current.replace(new RegExp(escapeRegExp(clean), 'gi'), '[private]') : current;
  }, String(text ?? ''));
}

export function assertNoPrivateValues(value, privateValues) {
  const text = JSON.stringify(value);
  for (const privateValue of privateValues) {
    const clean = String(privateValue ?? '').trim();
    if (clean.length > 1 && new RegExp(escapeRegExp(clean), 'i').test(text)) {
      throw new Error('PRIVACY_FAILED');
    }
  }
}

export function safeTelemetryPayload(event) {
  const {
    correlationId,
    provider,
    model,
    channel,
    promptVersion,
    success,
    code,
    latencyMs,
    attempts,
    httpStatus,
    providerRequestId,
    providerErrorType,
    providerErrorCode,
  } = event;
  return {
    correlationId,
    provider,
    model,
    channel,
    promptVersion,
    success,
    code,
    latencyMs,
    attempts,
    httpStatus,
    providerRequestId,
    providerErrorType,
    providerErrorCode,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
