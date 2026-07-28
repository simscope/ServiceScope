export function safeMediaTelemetryPayload(event) {
  const attachments = Array.isArray(event.attachments) ? event.attachments : [];
  const totalBytes = attachments.reduce((sum, attachment) => sum + (Number(attachment.sizeBytes) || 0), 0);
  return {
    stage: normalizeStage(event.stage),
    providerCallStarted: typeof event.providerCallStarted === 'boolean' ? event.providerCallStarted : undefined,
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
    privacyDiagnostics: safePrivacyDiagnostics(event.privacyDiagnostics),
    attachmentCount: attachments.length,
    mediaKindCounts: countBy(attachments, 'mediaKind'),
    byteBucket: bucketBytes(totalBytes),
  };
}

function normalizeStage(value) {
  return value === 'pre-provider-validation' ? value : undefined;
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

function safePrivacyDiagnostics(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((item) => ({
    subreason: String(item?.subreason ?? 'UNKNOWN_PRIVACY_REASON'),
    path: String(item?.path ?? '$'),
    detector: String(item?.detector ?? 'unknown'),
    patternClass: String(item?.patternClass ?? item?.subreason ?? 'UNKNOWN_PRIVACY_REASON'),
    stringLengthBucket: String(item?.stringLengthBucket ?? 'unknown'),
    attachmentId: typeof item?.attachmentId === 'string' ? item.attachmentId : undefined,
    findingCategory: typeof item?.findingCategory === 'string' ? item.findingCategory : undefined,
  }));
}
