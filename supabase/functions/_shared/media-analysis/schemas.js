import {
  allowedRequestFields,
  analysisModes,
  analysisVersion,
  contentFindingCategories,
  evidenceTypes,
  findingCategories,
  idPattern,
  idempotencyKeyPattern,
  maxAttachments,
  maxFindingExplanationLength,
  maxFindingsPerAttachment,
  maxMissingShotCount,
  maxRecommendationCount,
  maxTotalFindings,
  providerOutputSchemaName,
  providerPayloadSchemaVersion,
  requestSchemaVersion,
  resultSchemaVersion,
  riskLevels,
} from './contracts.js';
import { httpError } from './errors.js';
import { assertSafeFindingText } from './privacy.js';

const providerRootFields = ['schemaVersion', 'attachments', 'recommendations', 'missingShots'];
const providerAttachmentFields = ['attachmentId', 'findings'];
const providerFindingFields = ['category', 'confidence', 'explanation', 'riskLevel'];
const forbiddenOcrFields = new Set(['detectedText', 'ocrText', 'serialNumber', 'addressText', 'phone', 'email', 'plateNumber', 'personName']);

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

export function buildMediaAnalysisResult({ request, context, provider, model, code, warnings = [], latencyMs = 0, attempts = 0, usage }) {
  return {
    schemaVersion: resultSchemaVersion,
    analysisVersion,
    analysisMode: request.analysisMode,
    jobId: context.jobId,
    provider,
    model,
    requiresUserApproval: true,
    attachments: context.attachments.map((attachment) => fallbackAttachment(attachment)),
    recommendations: [],
    missingShots: [],
    warnings: warnings.concat(code && code !== 'OK' ? [{ code, message: safeWarningMessage(code) }] : []),
    safety: {
      ok: code === 'OK' || code === 'MEDIA_PROVIDER_NOT_CONFIGURED',
      privacy: 'passed',
      grounding: 'not_applicable',
      blockedReasons: code && code !== 'OK' && code !== 'MEDIA_PROVIDER_NOT_CONFIGURED' ? [code] : [],
    },
    usage,
    telemetry: {
      correlationId: request.idempotencyKey,
      attempts,
      latencyMs,
    },
  };
}

export function parseProviderMediaResult(rawJson, { request, context, provider, model, usage, attempts = 1, latencyMs = 0 }) {
  const payload = validateProviderPayloadShape(rawJson, context);
  const attachmentsById = new Map(context.attachments.map((attachment) => [attachment.id, attachment]));
  let findingIndex = 0;
  const providerAttachmentsById = new Map(payload.attachments.map((attachment) => [attachment.attachmentId, attachment]));
  const enrichedAttachments = context.attachments.map((attachment) => {
    if (attachment.mediaKind === 'video') return videoFallbackAttachment(attachment);
    const providerAttachment = providerAttachmentsById.get(attachment.id);
    const findings = (providerAttachment?.findings ?? []).map((finding) => {
      findingIndex += 1;
      return {
        findingId: `finding-${findingIndex}`,
        evidenceType: contentFindingCategories.includes(finding.category) ? 'visual_suggestion' : 'privacy_risk_suggestion',
        category: finding.category,
        confidence: finding.confidence,
        explanation: finding.explanation.trim(),
        riskLevel: finding.riskLevel,
        requiresUserApproval: true,
      };
    });
    return {
      id: attachment.id,
      analysisRunId: typeof attachment.analysisRunId === 'string' ? attachment.analysisRunId : undefined,
      attachmentResultId: typeof attachment.attachmentResultId === 'string' ? attachment.attachmentResultId : undefined,
      kind: 'photo',
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      status: 'analyzed',
      visualAnalysisPerformed: true,
      manualReviewRequired: true,
      findings,
    };
  });
  return validateMediaAnalysisResultShape({
    schemaVersion: resultSchemaVersion,
    analysisVersion,
    analysisMode: request.analysisMode,
    jobId: context.jobId,
    provider,
    model,
    requiresUserApproval: true,
    attachments: enrichedAttachments,
    recommendations: payload.recommendations,
    missingShots: payload.missingShots,
    warnings: [],
    safety: { ok: true, privacy: 'passed', grounding: 'passed', blockedReasons: [] },
    usage,
    telemetry: { correlationId: request.idempotencyKey, attempts, latencyMs },
  });
}

export function validateProviderPayloadShape(value, context) {
  const diagnostics = { missingFields: [], unexpectedFields: [], invalidTypePaths: [], privacyDiagnostics: [] };
  if (!isPlainObject(value)) throw invalidProviderOutput(withSubreason(diagnostics, ['$']));
  collectObjectDiagnostics(value, providerRootFields, '$', diagnostics);
  rejectForbiddenFields(value, '$', diagnostics);
  if (value.schemaVersion !== providerPayloadSchemaVersion) diagnostics.invalidTypePaths.push('$.schemaVersion');
  const allowedPhotoIds = new Set(context.attachments.filter((attachment) => attachment.mediaKind === 'photo').map((attachment) => attachment.id));
  if (!Array.isArray(value.attachments)) {
    diagnostics.invalidTypePaths.push('$.attachments');
  } else {
    const seenAttachmentIds = new Set();
    let totalFindings = 0;
    value.attachments.forEach((attachment, index) => {
      const path = `$.attachments[${index}]`;
      if (!isPlainObject(attachment)) {
        diagnostics.invalidTypePaths.push(path);
        return;
      }
      collectObjectDiagnostics(attachment, providerAttachmentFields, path, diagnostics);
      rejectForbiddenFields(attachment, path, diagnostics);
      if (typeof attachment.attachmentId !== 'string' || !allowedPhotoIds.has(attachment.attachmentId) || seenAttachmentIds.has(attachment.attachmentId)) {
        diagnostics.invalidTypePaths.push(`${path}.attachmentId`);
      }
      seenAttachmentIds.add(attachment.attachmentId);
      if (!Array.isArray(attachment.findings)) {
        diagnostics.invalidTypePaths.push(`${path}.findings`);
      } else {
        if (attachment.findings.length > maxFindingsPerAttachment) diagnostics.invalidTypePaths.push(`${path}.findings`);
        totalFindings += attachment.findings.length;
        attachment.findings.forEach((finding, findingIndex) => validateProviderFinding(finding, `${path}.findings[${findingIndex}]`, diagnostics, context.privateValues, attachment.attachmentId));
      }
    });
    if (totalFindings > maxTotalFindings) diagnostics.invalidTypePaths.push('$.attachments.findings');
  }
  validateStringArray(value.recommendations, '$.recommendations', diagnostics, maxRecommendationCount, 160);
  validateStringArray(value.missingShots, '$.missingShots', diagnostics, maxMissingShotCount, 120);
  if (diagnostics.privacyDiagnostics.length) throw privacyProviderOutput(diagnostics);
  if (diagnostics.missingFields.length || diagnostics.unexpectedFields.length || diagnostics.invalidTypePaths.length) throw invalidProviderOutput(diagnostics);
  return {
    schemaVersion: providerPayloadSchemaVersion,
    attachments: value.attachments.map((attachment) => ({
      attachmentId: attachment.attachmentId,
      findings: attachment.findings.map((finding) => ({
        category: finding.category,
        confidence: Number(finding.confidence),
        explanation: finding.explanation.trim(),
        riskLevel: finding.riskLevel,
      })),
    })),
    recommendations: value.recommendations.map((item) => item.trim()).filter(Boolean),
    missingShots: value.missingShots.map((item) => item.trim()).filter(Boolean),
  };
}

export function validateMediaAnalysisResultShape(value) {
  const diagnostics = { missingFields: [], unexpectedFields: [], invalidTypePaths: [] };
  if (!isPlainObject(value)) throw httpError('MEDIA_INVALID_PROVIDER_OUTPUT', 500, withSubreason(diagnostics, ['$']));
  collectObjectDiagnostics(value, ['schemaVersion', 'analysisVersion', 'analysisMode', 'jobId', 'provider', 'model', 'requiresUserApproval', 'attachments', 'recommendations', 'missingShots', 'warnings', 'safety', 'usage', 'telemetry'], '$', diagnostics);
  if (value.schemaVersion !== resultSchemaVersion) diagnostics.invalidTypePaths.push('$.schemaVersion');
  if (value.analysisVersion !== analysisVersion) diagnostics.invalidTypePaths.push('$.analysisVersion');
  if (!analysisModes.includes(value.analysisMode)) diagnostics.invalidTypePaths.push('$.analysisMode');
  if (typeof value.jobId !== 'string' || !value.jobId) diagnostics.invalidTypePaths.push('$.jobId');
  if (typeof value.provider !== 'string' || !value.provider) diagnostics.invalidTypePaths.push('$.provider');
  if (typeof value.model !== 'string' || !value.model) diagnostics.invalidTypePaths.push('$.model');
  if (value.requiresUserApproval !== true) diagnostics.invalidTypePaths.push('$.requiresUserApproval');
  if (!Array.isArray(value.attachments)) diagnostics.invalidTypePaths.push('$.attachments');
  if (!Array.isArray(value.recommendations)) diagnostics.invalidTypePaths.push('$.recommendations');
  if (!Array.isArray(value.missingShots)) diagnostics.invalidTypePaths.push('$.missingShots');
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
    required: providerRootFields,
    properties: {
      schemaVersion: { type: 'string', enum: [providerPayloadSchemaVersion] },
      attachments: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: providerAttachmentFields,
          properties: {
            attachmentId: { type: 'string', pattern: '^[A-Za-z0-9:_-]{1,160}$' },
            findings: {
              type: 'array',
              maxItems: maxFindingsPerAttachment,
              items: {
                type: 'object',
                additionalProperties: false,
                required: providerFindingFields,
                properties: {
                  category: { type: 'string', enum: findingCategories },
                  confidence: { type: 'number', minimum: 0, maximum: 1 },
                  explanation: { type: 'string', minLength: 1, maxLength: maxFindingExplanationLength },
                  riskLevel: { type: 'string', enum: riskLevels },
                },
              },
            },
          },
        },
      },
      recommendations: {
        type: 'array',
        maxItems: maxRecommendationCount,
        items: { type: 'string', minLength: 1, maxLength: 160 },
      },
      missingShots: {
        type: 'array',
        maxItems: maxMissingShotCount,
        items: { type: 'string', minLength: 1, maxLength: 120 },
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

function fallbackAttachment(attachment) {
  return attachment.mediaKind === 'video' ? videoFallbackAttachment(attachment) : {
    id: attachment.id,
    kind: 'photo',
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    status: 'metadata_only',
    visualAnalysisPerformed: false,
    manualReviewRequired: true,
    findings: [],
  };
}

function videoFallbackAttachment(attachment) {
  return {
    id: attachment.id,
    kind: 'video',
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    status: 'video_analysis_not_supported_v1',
    visualAnalysisPerformed: false,
    manualReviewRequired: true,
    findings: [],
  };
}

function safeWarningMessage(code) {
  if (code === 'MEDIA_PROVIDER_NOT_CONFIGURED') return 'Media AI provider is not configured; no visual analysis was performed.';
  if (code === 'MEDIA_PRIVACY_VALIDATION_FAILED') return 'Media analysis output failed privacy validation; metadata-only fallback was returned.';
  if (code === 'MEDIA_INVALID_PROVIDER_OUTPUT') return 'Media analysis output was invalid; metadata-only fallback was returned.';
  if (code === 'MEDIA_REFUSAL') return 'Media AI provider refused the request; metadata-only fallback was returned.';
  if (code === 'MEDIA_ANALYSIS_INCOMPLETE') return 'Media AI provider returned an incomplete response; metadata-only fallback was returned.';
  return 'Media analysis could not be completed; metadata-only fallback was returned.';
}

function validateProviderFinding(finding, path, diagnostics, privateValues, attachmentId) {
  if (!isPlainObject(finding)) {
    diagnostics.invalidTypePaths.push(path);
    return;
  }
  collectObjectDiagnostics(finding, providerFindingFields, path, diagnostics);
  rejectForbiddenFields(finding, path, diagnostics);
  if (!findingCategories.includes(finding.category)) diagnostics.invalidTypePaths.push(`${path}.category`);
  const confidence = Number(finding.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) diagnostics.invalidTypePaths.push(`${path}.confidence`);
  if (typeof finding.explanation !== 'string' || !finding.explanation.trim() || finding.explanation.length > maxFindingExplanationLength) {
    diagnostics.invalidTypePaths.push(`${path}.explanation`);
  } else {
    try {
      assertSafeFindingText(finding.explanation, privateValues, {
        path: `${path}.explanation`,
        attachmentId,
        findingCategory: typeof finding.category === 'string' ? finding.category : undefined,
      });
    } catch (error) {
      if (error?.code === 'MEDIA_PRIVACY_VALIDATION_FAILED' && Array.isArray(error?.details?.privacyDiagnostics)) {
        diagnostics.privacyDiagnostics.push(...error.details.privacyDiagnostics);
      } else {
        diagnostics.invalidTypePaths.push(`${path}.explanation`);
      }
    }
  }
  if (!riskLevels.includes(finding.riskLevel)) diagnostics.invalidTypePaths.push(`${path}.riskLevel`);
}

function validateStringArray(value, path, diagnostics, maxItems, maxLength) {
  if (!Array.isArray(value)) {
    diagnostics.invalidTypePaths.push(path);
    return;
  }
  if (value.length > maxItems) diagnostics.invalidTypePaths.push(path);
  value.forEach((item, index) => {
    if (typeof item !== 'string' || item.trim().length < 1 || item.length > maxLength) diagnostics.invalidTypePaths.push(`${path}[${index}]`);
  });
}

function cleanAttachmentIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item && idPattern.test(item));
  return Array.from(new Set(ids));
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

function rejectForbiddenFields(value, path, diagnostics) {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (forbiddenOcrFields.has(key)) diagnostics.unexpectedFields.push(`${path}.${key}`);
  }
}

function invalidProviderOutput(diagnostics) {
  throw httpError('MEDIA_INVALID_PROVIDER_OUTPUT', 500, {
    missingFields: uniqueSorted(diagnostics.missingFields),
    unexpectedFields: uniqueSorted(diagnostics.unexpectedFields),
    invalidTypePaths: uniqueSorted(diagnostics.invalidTypePaths),
  });
}

function privacyProviderOutput(diagnostics) {
  throw httpError('MEDIA_PRIVACY_VALIDATION_FAILED', 500, {
    details: { privacyDiagnostics: uniqueDiagnostics(diagnostics.privacyDiagnostics) },
  });
}

function withSubreason(diagnostics, extraInvalidPaths = []) {
  diagnostics.invalidTypePaths.push(...extraInvalidPaths);
  return diagnostics;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function uniqueDiagnostics(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export { evidenceTypes };
