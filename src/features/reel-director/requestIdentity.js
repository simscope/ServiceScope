const manualReelOperations = new Set(['preview', 'create']);

export function stableReelFingerprint(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `reel-input-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function manualReelPlanIdempotencyKey(operation, authoritativeSelectionRevision) {
  if (!manualReelOperations.has(operation)
    || typeof authoritativeSelectionRevision !== 'string'
    || !authoritativeSelectionRevision) {
    throw new Error('INVALID_MANUAL_REEL_REQUEST_IDENTITY');
  }
  return `manual-plan:${operation}:${stableReelFingerprint(authoritativeSelectionRevision)}`;
}
