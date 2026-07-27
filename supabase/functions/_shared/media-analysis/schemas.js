import {
  allowedRequestFields,
  analysisModes,
  analysisVersion,
  idPattern,
  idempotencyKeyPattern,
  maxAttachments,
  providerOutputSchemaName,
  requestSchemaVersion,
  resultSchemaVersion,
} from './contracts.js';
import { httpError } from './errors.js';

export function validateMediaAnalysisRequestBody(value) {
  const body = isPlainObject(value) ? value : {};
  for (const key of Object.keys(body)) {
    if (!allowedRequestFields.has(key)) throw httpError('INVALID_REQUEST');
  }
  if (body.schemaVersion !== requestSchemaVersion) throw httpError('INVALID_REQUEST');
  if (typeof body.jobId !== 'string' || !body.jobId.trim() || !idPattern.test(body.jobId.trim())) throw httpError('INVALID_REQUEST');
  const normalizedMode = String(body.analysisMode ?? 'media_review');
  if (!analysisModes.includes(normalizedMode)) throw httpError('INVALID_REQUEST');
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (!idempotencyKeyPattern.test(idempotencyKey)) throw httpError('INVALID_REQUEST');
  const attachmentIds = cleanAttachmentIds(body.attachmentIds);
  if (!attachmentIds.length) throw httpError('MEDIA_NOT_SELECTED');
  if (attachmentIds.length > maxAttachments) throw httpError('MEDIA_REQUEST_TOO_LARGE');
  return {
    schemaVersion: requestSchemaVersion,
    jobId: body.jobId.trim(),
    attachmentIds,
    analysisMode: normalizedMode,
    idempotencyKey,
  };
}

export function buildMediaAnalysisResult({ request, context, provider, model, code, warnings = [], latencyMs = 0, attempts = 0 }) {
  return {
    schemaVersion: resultSchemaVersion,
    analysisVersion,
    analysisMode: request.analysisMode,
    jobId: context.jobId,
    provider,
    model,
    attachments: context.attachments.map(publicAttachment),
    recommendations: [],
    warnings: warnings.concat(code && code !== 'OK' ? [{ code, message: safeWarningMessage(code) }] : []),
    safety: {
      ok: code === 'OK' || code === 'MEDIA_PROVIDER_NOT_CONFIGURED',
      privacy: 'passed',
      grounding: 'not_applicable',
      blockedReasons: code && code !== 'OK' && code !== 'MEDIA_PROVIDER_NOT_CONFIGURED' ? [code] : [],
    },
    telemetry: {
      correlationId: request.idempotencyKey,
      attempts,
      latencyMs,
    },
  };
}

export function validateMediaAnalysisResultShape(value) {
  const diagnostics = { missingFields: [], unexpectedFields: [], invalidTypePaths: [] };
  if (!isPlainObject(value)) throw httpError('MEDIA_INVALID_PROVIDER_OUTPUT', 500, withSubreason(diagnostics, 'MEDIA_INVALID_PROVIDER_OUTPUT', ['$']));
  collectObjectDiagnostics(value, ['schemaVersion', 'analysisVersion', 'analysisMode', 'jobId', 'provider', 'model', 'attachments', 'recommendations', 'warnings', 'safety', 'telemetry'], '$', diagnostics);
  if (value.schemaVersion !== resultSchemaVersion) diagnostics.invalidTypePaths.push('$.schemaVersion');
  if (value.analysisVersion !== analysisVersion) diagnostics.invalidTypePaths.push('$.analysisVersion');
  if (!analysisModes.includes(value.analysisMode)) diagnostics.invalidTypePaths.push('$.analysisMode');
  if (typeof value.jobId !== 'string' || !value.jobId) diagnostics.invalidTypePaths.push('$.jobId');
  if (typeof value.provider !== 'string' || !value.provider) diagnostics.invalidTypePaths.push('$.provider');
  if (typeof value.model !== 'string' || !value.model) diagnostics.invalidTypePaths.push('$.model');
  if (!Array.isArray(value.attachments)) diagnostics.invalidTypePaths.push('$.attachments');
  if (!Array.isArray(value.recommendations)) diagnostics.invalidTypePaths.push('$.recommendations');
  if (!Array.isArray(value.warnings)) diagnostics.invalidTypePaths.push('$.warnings');
  if (!isPlainObject(value.safety)) diagnostics.invalidTypePaths.push('$.safety');
  if (!isPlainObject(value.telemetry)) diagnostics.invalidTypePaths.push('$.telemetry');
  if (diagnostics.missingFields.length || diagnostics.unexpectedFields.length || diagnostics.invalidTypePaths.length) {
    throw httpError('MEDIA_INVALID_PROVIDER_OUTPUT', 500, diagnostics);
  }
  return value;
}

export function buildProviderNeutralMediaSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'analysisVersion', 'analysisMode', 'attachments', 'recommendations', 'warnings'],
    properties: {
      schemaVersion: { type: 'string', enum: [resultSchemaVersion] },
      analysisVersion: { type: 'string', enum: [analysisVersion] },
      analysisMode: { type: 'string', enum: analysisModes },
      attachments: {
        type: 'array',
        maxItems: maxAttachments,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'kind', 'mimeType', 'sizeBytes', 'status'],
          properties: {
            id: { type: 'string', pattern: '^[A-Za-z0-9:_-]{1,160}$' },
            kind: { type: 'string', enum: ['photo', 'video'] },
            mimeType: { type: 'string', maxLength: 120 },
            sizeBytes: { type: 'number', minimum: 0 },
            status: { type: 'string', enum: ['accepted', 'rejected'] },
          },
        },
      },
      recommendations: {
        type: 'array',
        maxItems: 24,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['attachmentId', 'recommendation', 'evidenceIds'],
          properties: {
            attachmentId: { type: 'string', pattern: '^[A-Za-z0-9:_-]{1,160}$' },
            recommendation: { type: 'string', maxLength: 240 },
            evidenceIds: {
              type: 'array',
              maxItems: 8,
              items: { type: 'string', pattern: '^[A-Za-z0-9:_-]{1,160}$' },
            },
          },
        },
      },
      warnings: {
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'message'],
          properties: {
            code: { type: 'string', maxLength: 80 },
            message: { type: 'string', maxLength: 240 },
          },
        },
      },
    },
  };
}

export function buildProviderNeutralMediaResponseFormat() {
  return {
    type: 'json_schema',
    name: providerOutputSchemaName,
    strict: true,
    schema: buildProviderNeutralMediaSchema(),
  };
}

function cleanAttachmentIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item && idPattern.test(item));
  return Array.from(new Set(ids));
}

function publicAttachment(attachment) {
  return {
    id: attachment.id,
    kind: attachment.mediaKind,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    status: 'accepted',
  };
}

function safeWarningMessage(code) {
  if (code === 'MEDIA_PROVIDER_NOT_CONFIGURED') return 'Media AI provider is not configured; no media analysis was performed.';
  return 'Media analysis could not be completed.';
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

function withSubreason(diagnostics, code, extraInvalidPaths = []) {
  diagnostics.code = code;
  diagnostics.invalidTypePaths.push(...extraInvalidPaths);
  return diagnostics;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
