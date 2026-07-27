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
import { ProviderError } from './errors.js';

const requestFields = new Set(['schemaVersion', 'jobId', 'channel', 'tone', 'locale', 'promptVersion', 'localFacts', 'mediaState', 'idempotencyKey']);
const providerRootFields = ['schemaVersion', 'channel', 'content', 'claims', 'warnings', 'missingInformation'];
const providerContentFields = ['headline', 'body', 'hashtags', 'callToAction'];
const providerClaimFields = ['text', 'evidenceIds'];
const providerOutputSchemaName = 'service_scope_content_generation_v1';

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
  const value = assertProviderPayload(rawJson);
  const diagnostics = validateProviderPayloadShape(value, expectedChannel);
  if (diagnostics.providerOutputSubreason) throw invalidProviderOutput(diagnostics);
  const content = value.content;
  const body = content.body.trim();
  const hashtags = content.hashtags.map(normalizeHashtag).filter(Boolean);
  const claims = value.claims.map((claim) => ({
    text: claim.text.trim().slice(0, 600),
    evidenceIds: claim.evidenceIds.slice(0, 8),
  }));
  return {
    schemaVersion: resultSchemaVersion,
    channel: expectedChannel,
    promptVersion: promptVersionByChannel[expectedChannel],
    provider,
    model,
    content: {
      headline: content.headline === null ? undefined : content.headline.trim().slice(0, 160),
      body,
      hashtags: Array.from(new Set(hashtags)).slice(0, 6),
      callToAction: content.callToAction === null ? undefined : content.callToAction.trim().slice(0, 240),
    },
    claims,
    warnings: [],
    missingInformation: [],
    safety: { ok: true, privacy: 'passed', grounding: 'passed', blockedReasons: [] },
    usage,
  };
}

export function buildProviderOutputJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: providerRootFields,
    properties: {
      schemaVersion: { type: 'string', enum: [resultSchemaVersion] },
      channel: { type: 'string', enum: channels },
      content: {
        type: 'object',
        additionalProperties: false,
        required: providerContentFields,
        properties: {
          headline: { type: ['string', 'null'], maxLength: 160 },
          body: { type: 'string', minLength: 1, maxLength: maxOutputBytes },
          hashtags: {
            type: 'array',
            maxItems: 12,
            items: { type: 'string', minLength: 1, maxLength: 80 },
          },
          callToAction: { type: ['string', 'null'], maxLength: 240 },
        },
      },
      claims: {
        type: 'array',
        maxItems: 24,
        items: {
          type: 'object',
          additionalProperties: false,
          required: providerClaimFields,
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 600 },
            evidenceIds: {
              type: 'array',
              minItems: 1,
              maxItems: 8,
              items: { type: 'string', pattern: '^[A-Za-z0-9:_-]{1,160}$' },
            },
          },
        },
      },
      warnings: {
        type: 'array',
        maxItems: 12,
        items: { type: 'string', maxLength: 160 },
      },
      missingInformation: {
        type: 'array',
        maxItems: 12,
        items: { type: 'string', maxLength: 160 },
      },
    },
  };
}

export function buildProviderOutputResponseFormat() {
  return {
    type: 'json_schema',
    name: providerOutputSchemaName,
    strict: true,
    schema: buildProviderOutputJsonSchema(),
  };
}

export function getProviderOutputSchemaName() {
  return providerOutputSchemaName;
}

export function validateProviderPayloadShape(value, expectedChannel) {
  const diagnostics = {
    missingFields: [],
    unexpectedFields: [],
    invalidTypePaths: [],
    parsedJsonBytes: safeJsonByteLength(value),
  };
  if (!isPlainObject(value)) return withSubreason(diagnostics, 'INVALID_PROVIDER_OUTPUT_TYPE_MISMATCH', ['$']);
  collectObjectDiagnostics(value, providerRootFields, '$', diagnostics);
  if (value.schemaVersion !== resultSchemaVersion) diagnostics.invalidTypePaths.push('$.schemaVersion');
  if (value.channel !== expectedChannel || !channels.includes(value.channel)) diagnostics.invalidTypePaths.push('$.channel');
  if (!isPlainObject(value.content)) {
    diagnostics.invalidTypePaths.push('$.content');
  } else {
    collectObjectDiagnostics(value.content, providerContentFields, '$.content', diagnostics);
    if (!(typeof value.content.headline === 'string' || value.content.headline === null)) diagnostics.invalidTypePaths.push('$.content.headline');
    if (typeof value.content.body !== 'string') {
      diagnostics.invalidTypePaths.push('$.content.body');
    } else if (!value.content.body.trim()) {
      return withSubreason(diagnostics, 'INVALID_PROVIDER_OUTPUT_EMPTY_BODY', ['$.content.body']);
    } else if (byteLength(value.content.body.trim()) > maxOutputBytes) {
      diagnostics.invalidTypePaths.push('$.content.body');
    }
    if (!Array.isArray(value.content.hashtags) || value.content.hashtags.some((item) => typeof item !== 'string')) diagnostics.invalidTypePaths.push('$.content.hashtags');
    if (!(typeof value.content.callToAction === 'string' || value.content.callToAction === null)) diagnostics.invalidTypePaths.push('$.content.callToAction');
  }
  if (!Array.isArray(value.claims)) {
    diagnostics.invalidTypePaths.push('$.claims');
  } else {
    value.claims.forEach((claim, index) => {
      const path = `$.claims[${index}]`;
      if (!isPlainObject(claim)) {
        diagnostics.invalidTypePaths.push(path);
        return;
      }
      collectObjectDiagnostics(claim, providerClaimFields, path, diagnostics);
      if (typeof claim.text !== 'string' || !claim.text.trim()) diagnostics.invalidTypePaths.push(`${path}.text`);
      if (!Array.isArray(claim.evidenceIds) || !claim.evidenceIds.length || claim.evidenceIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(id))) {
        diagnostics.invalidTypePaths.push(`${path}.evidenceIds`);
      }
    });
  }
  if (!Array.isArray(value.warnings) || value.warnings.some((item) => typeof item !== 'string')) diagnostics.invalidTypePaths.push('$.warnings');
  if (!Array.isArray(value.missingInformation) || value.missingInformation.some((item) => typeof item !== 'string')) diagnostics.invalidTypePaths.push('$.missingInformation');
  if (diagnostics.missingFields.length) return withSubreason(diagnostics, 'INVALID_PROVIDER_OUTPUT_MISSING_FIELD');
  if (diagnostics.unexpectedFields.length) return withSubreason(diagnostics, 'INVALID_PROVIDER_OUTPUT_UNKNOWN_FIELD');
  if (diagnostics.invalidTypePaths.length) return withSubreason(diagnostics, 'INVALID_PROVIDER_OUTPUT_TYPE_MISMATCH');
  return diagnostics;
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

function assertProviderPayload(rawJson) {
  if (!isPlainObject(rawJson)) throw invalidProviderOutput({
    providerOutputSubreason: 'INVALID_PROVIDER_OUTPUT_TYPE_MISMATCH',
    invalidTypePaths: ['$'],
    parsedJsonBytes: safeJsonByteLength(rawJson),
  });
  return rawJson;
}

function collectObjectDiagnostics(value, allowedFields, path, diagnostics) {
  const allowed = new Set(allowedFields);
  for (const field of allowedFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) diagnostics.missingFields.push(`${path}.${field}`);
  }
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) diagnostics.unexpectedFields.push(`${path}.${field}`);
  }
}

function withSubreason(diagnostics, providerOutputSubreason, extraInvalidPaths = []) {
  diagnostics.providerOutputSubreason = providerOutputSubreason;
  diagnostics.invalidTypePaths.push(...extraInvalidPaths);
  diagnostics.missingFields = uniqueSorted(diagnostics.missingFields);
  diagnostics.unexpectedFields = uniqueSorted(diagnostics.unexpectedFields);
  diagnostics.invalidTypePaths = uniqueSorted(diagnostics.invalidTypePaths);
  return diagnostics;
}

function invalidProviderOutput(diagnostics = {}) {
  return new ProviderError('INVALID_PROVIDER_OUTPUT', {
    retryable: false,
    providerOutputSubreason: diagnostics.providerOutputSubreason ?? 'INVALID_PROVIDER_OUTPUT_TYPE_MISMATCH',
    missingFields: uniqueSorted(diagnostics.missingFields ?? []),
    unexpectedFields: uniqueSorted(diagnostics.unexpectedFields ?? []),
    invalidTypePaths: uniqueSorted(diagnostics.invalidTypePaths ?? []),
    parsedJsonBytes: diagnostics.parsedJsonBytes,
    responseStatus: diagnostics.responseStatus,
    incompleteReason: diagnostics.incompleteReason,
    providerRequestId: diagnostics.providerRequestId,
  });
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function safeJsonByteLength(value) {
  try {
    return byteLength(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}
