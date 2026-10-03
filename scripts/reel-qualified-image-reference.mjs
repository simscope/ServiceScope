import assert from 'node:assert/strict';

const digestPattern = /^sha256:[0-9a-f]{64}$/;
const referencePattern = /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*servicescope-reel-renderer@(sha256:[0-9a-f]{64})$/;

export function verifyQualifiedRendererImage(reference, expectedDigest) {
  assert.equal(typeof expectedDigest, 'string');
  assert.match(expectedDigest, digestPattern, 'Verified renderer digest must be immutable sha256.');
  assert.equal(typeof reference, 'string');
  const match = referencePattern.exec(reference);
  assert.ok(match, 'Renderer Sandbox must use the exact renderer basename and an immutable digest.');
  assert.equal(match[1], expectedDigest, 'Renderer Sandbox must use the verified digest.');
  return { basename: 'servicescope-reel-renderer', digest: match[1] };
}
