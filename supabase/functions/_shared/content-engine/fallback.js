import { promptVersionByChannel, resultSchemaVersion } from './contracts.js';

export function deterministicFallback(request, context, warning) {
  const find = (id) => context.evidence.find((item) => item.id === id)?.text;
  const materials = context.evidence.filter((item) => item.source === 'Installed material').map((item) => item.text);
  const lines = [
    request.channel === 'Instagram' ? 'Hook: Service update from the field.' : `Service update for ${request.channel}.`,
    find('complaint') ? `Issue: ${find('complaint')}.` : '',
    find('diagnosis') ? `Finding: ${find('diagnosis')}.` : '',
    find('repair-performed') ? `Work: ${find('repair-performed')}.` : '',
    materials.length ? `Parts: ${materials.join(', ')}.` : '',
    find('final-result') ? `Result: ${find('final-result')}.` : '',
    'CTA: Need documented service support? Reach out to schedule a visit.',
  ].filter(Boolean);
  return {
    schemaVersion: resultSchemaVersion,
    channel: request.channel,
    promptVersion: promptVersionByChannel[request.channel],
    provider: 'deterministic-fallback',
    content: {
      body: lines.join('\n'),
      hashtags: request.channel === 'Instagram' ? ['#ServiceUpdate', '#FieldService', '#Maintenance'] : [],
      callToAction: 'Need documented service support? Reach out to schedule a visit.',
    },
    claims: context.evidence.map((item) => ({ text: item.text, evidenceIds: [item.id] })),
    warnings: [warning, { code: 'FALLBACK_USED', message: 'Deterministic fallback was used for this draft.' }],
    missingInformation: context.missingInformation,
    safety: { ok: true, privacy: 'passed', grounding: 'passed', blockedReasons: [] },
  };
}
