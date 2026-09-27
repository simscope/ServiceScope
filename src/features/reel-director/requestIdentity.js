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

export async function manualReelPlanIdempotencyKey(operation, authoritativeSelectionRevision) {
  if (!manualReelOperations.has(operation)
    || typeof authoritativeSelectionRevision !== 'string'
    || !authoritativeSelectionRevision) {
    throw new Error('INVALID_MANUAL_REEL_REQUEST_IDENTITY');
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(authoritativeSelectionRevision),
  );
  const token = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `manual-plan:${operation}:sha256-${token}`;
}
