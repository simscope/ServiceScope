import {
  channels,
  tones,
  mediaLabels,
  promptVersionByChannel,
  requestSchemaVersion,
  resultSchemaVersion,
  maxLocalFactLength,
  maxMediaItems,
  maxOutputBytes,
  idempotencyKeyPattern,
} from './contracts.js';

const requestFields = new Set(['schemaVersion', 'jobId', 'channel', 'tone', 'locale', 'promptVersion', 'localFacts', 'mediaState', 'idempotencyKey']);

export function validateRequestBody(value) {
  const body = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  for (const key of Object.keys(body)) {
    if (!requestFields.has(key)) throw new Error('INVALID_REQUEST');
  }
  if (body.schemaVersion !== requestSchemaVersion) throw new Error('INVALID_REQUEST');
  if (typeof body.jobId !== 'string' || !body.jobId.trim()) throw new Error('INVALID_REQUEST');
  if (typeof body.channel !== 'string' || !channels.includes(body.channel)) throw new Error('INVALID_REQUEST');
  const tone = body.tone ?? 'Professional';
  if (typeof tone !== 'string' || !tones.includes(tone)) throw new Error('INVALID_REQUEST');
  const promptVersion = String(body.promptVersion ?? promptVersionByChannel[body.channel]);
  if (promptVersion !== promptVersionByChannel[body.channel]) throw new Error('INVALID_REQUEST');
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (!idempotencyKeyPattern.test(idempotencyKey)) throw new Error('INVALID_REQUEST');
  return {
    schemaVersion: requestSchemaVersion,
    jobId: body.jobId.trim(),
    channel: body.channel,
    tone,
    locale: normalizeLocale(String(body.locale ?? 'en-US')),
    promptVersion,
    idempotencyKey,
    localFacts: cleanLocalFacts(body.localFacts),
    mediaState: cleanMediaState(body.mediaState),
  };
}

export function parseProviderResult(rawJson, expectedChannel, provider, model, usage) {
  const value = rawJson && typeof rawJson === 'object' && !Array.isArray(rawJson) ? rawJson : {};
  if (value.schemaVersion !== resultSchemaVersion) throw new Error('INVALID_PROVIDER_OUTPUT');
  if (value.channel !== expectedChannel) throw new Error('INVALID_PROVIDER_OUTPUT');
  const content = value.content && typeof value.content === 'object' && !Array.isArray(value.content) ? value.content : {};
  const body = typeof content.body === 'string' ? content.body.trim() : '';
  if (!body || byteLength(body) > maxOutputBytes) throw new Error('INVALID_PROVIDER_OUTPUT');
  const hashtags = Array.isArray(content.hashtags) ? content.hashtags.filter((item) => typeof item === 'string').map(normalizeHashtag).filter(Boolean) : [];
  const claims = Array.isArray(value.claims) ? value.claims.map((claim) => {
    const row = claim && typeof claim === 'object' && !Array.isArray(claim) ? claim : {};
    return {
      text: typeof row.text === 'string' ? row.text.trim().slice(0, 600) : '',
      evidenceIds: Array.isArray(row.evidenceIds) ? row.evidenceIds.filter((id) => typeof id === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(id)).slice(0, 8) : [],
    };
  }) : [];
  return {
    schemaVersion: resultSchemaVersion,
    channel: expectedChannel,
    promptVersion: promptVersionByChannel[expectedChannel],
    provider,
    model,
    content: {
      headline: typeof content.headline === 'string' ? content.headline.trim().slice(0, 160) : undefined,
      body,
      hashtags: Array.from(new Set(hashtags)).slice(0, 6),
      callToAction: typeof content.callToAction === 'string' ? content.callToAction.trim().slice(0, 240) : undefined,
    },
    claims,
    warnings: [],
    missingInformation: [],
    safety: { ok: true, privacy: 'passed', grounding: 'passed', blockedReasons: [] },
    usage,
  };
}

export function normalizeLocale(value) {
  try {
    const [locale] = Intl.getCanonicalLocales(value.trim() || 'en-US');
    return locale ?? 'en-US';
  } catch {
    throw new Error('INVALID_REQUEST');
  }
}

export function cleanLocalFacts(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    diagnosis: cleanText(input.diagnosis, maxLocalFactLength),
    repairPerformed: cleanText(input.repairPerformed, maxLocalFactLength),
    finalResult: cleanText(input.finalResult, maxLocalFactLength),
  };
}

export function cleanMediaState(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxMediaItems).map((item, index) => {
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
    return {
      id: typeof row.id === 'string' ? row.id.trim().slice(0, 128) : '',
      selected: typeof row.selected === 'boolean' ? row.selected : undefined,
      order: Number.isFinite(Number(row.order)) ? Number(row.order) : index,
      label: typeof row.label === 'string' && mediaLabels.includes(row.label) ? row.label : undefined,
    };
  }).filter((item) => item.id);
}

export function cleanText(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function normalizeHashtag(value) {
  const clean = value.trim().replace(/^#+/, '').replace(/[^\w]/g, '');
  return clean ? `#${clean}` : '';
}

function byteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}
