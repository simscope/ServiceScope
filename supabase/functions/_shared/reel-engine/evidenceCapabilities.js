export const reelEvidenceCapabilities = Object.freeze({
  fact: 'fact',
  visual: 'visual',
  brand: 'brand',
  unknown: 'unknown',
});

const factEvidenceIds = new Set([
  'system-equipment',
  'complaint',
  'diagnosis',
  'repair-performed',
  'final-result',
]);

export function reelEvidenceCapabilityForId(value) {
  const id = String(value ?? '');
  if (factEvidenceIds.has(id) || id.startsWith('installed-material-')) return reelEvidenceCapabilities.fact;
  if (id.startsWith('media:')) return reelEvidenceCapabilities.visual;
  if (id === 'company-public-display-name' || id.startsWith('company-voice-')) return reelEvidenceCapabilities.brand;
  return reelEvidenceCapabilities.unknown;
}

export function withReelEvidenceCapability(evidence) {
  return { ...evidence, capability: reelEvidenceCapabilityForId(evidence.id) };
}
