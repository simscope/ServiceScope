export function safeMediaTelemetryPayload(event) {
  const attachments = Array.isArray(event.attachments) ? event.attachments : [];
  const totalBytes = attachments.reduce((sum, attachment) => sum + (Number(attachment.sizeBytes) || 0), 0);
  return {
    correlationId: event.correlationId,
    provider: event.provider,
    model: event.model,
    analysisVersion: event.analysisVersion,
    analysisMode: event.analysisMode,
    success: Boolean(event.success),
    code: event.code,
    latencyMs: event.latencyMs,
    attempts: event.attempts,
    httpStatus: event.httpStatus,
    providerRequestId: event.providerRequestId,
    providerErrorType: event.providerErrorType,
    providerErrorCode: event.providerErrorCode,
    attachmentCount: attachments.length,
    mediaKindCounts: countBy(attachments, 'mediaKind'),
    byteBucket: bucketBytes(totalBytes),
  };
}

export function bucketBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value === 0) return '0';
  if (value <= 1_000_000) return '<=1MB';
  if (value <= 5_000_000) return '<=5MB';
  if (value <= 25_000_000) return '<=25MB';
  if (value <= 100_000_000) return '<=100MB';
  return '>100MB';
}

function countBy(items, field) {
  return items.reduce((acc, item) => {
    const key = String(item?.[field] ?? 'unknown');
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}
