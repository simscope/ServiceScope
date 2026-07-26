const prohibitedUnsupportedClaim = /\b(model|serial|voltage|amps?|psi|pressure|temperature|degrees?|refrigerant|warranty|code compliant|manufacturer)\b/i;

export function validateGrounding(result, evidence) {
  const evidenceIds = new Set(evidence.map((claim) => claim.id));
  if (!result.content.body.trim()) throw new Error('GROUNDING_FAILED');
  for (const claim of result.claims) {
    if (!claim.text.trim() || !claim.evidenceIds.length) throw new Error('GROUNDING_FAILED');
    if (!claim.evidenceIds.every((id) => evidenceIds.has(id))) throw new Error('GROUNDING_FAILED');
  }
  if (prohibitedUnsupportedClaim.test(result.content.body) && !evidence.some((claim) => prohibitedUnsupportedClaim.test(claim.text))) {
    throw new Error('GROUNDING_FAILED');
  }
}
