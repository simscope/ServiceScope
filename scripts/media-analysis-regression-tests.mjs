import { readFile } from 'node:fs/promises';
import { buildAuthorizedMediaContext, mediaKindFor } from '../supabase/functions/_shared/media-analysis/authorization.js';
import { handleMediaAnalysis } from '../supabase/functions/_shared/media-analysis/applicationService.js';
import {
  buildProviderNeutralMediaResponseFormat,
  validateMediaAnalysisRequestBody,
  validateMediaAnalysisResultShape,
} from '../supabase/functions/_shared/media-analysis/schemas.js';
import { MediaAnalysisError } from '../supabase/functions/_shared/media-analysis/errors.js';
import { createMemoryGuards } from '../supabase/functions/_shared/content-engine/rateLimit.js';

const assert = {
  equal(actual, expected, message = `Expected ${actual} to equal ${expected}`) {
    if (actual !== expected) throw new Error(message);
  },
  deepEqual(actual, expected, message = 'Expected values to be deeply equal') {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
  },
  ok(value, message = 'Expected value to be truthy') {
    if (!value) throw new Error(message);
  },
  match(value, pattern, message = `Expected value to match ${pattern}`) {
    if (!pattern.test(value)) throw new Error(message);
  },
  doesNotMatch(value, pattern, message = `Expected value not to match ${pattern}`) {
    if (pattern.test(value)) throw new Error(message);
  },
  throws(fn, pattern) {
    try {
      fn();
    } catch (error) {
      if (pattern && !pattern.test(String(error))) throw error;
      return error;
    }
    throw new Error('Expected function to throw');
  },
  async rejects(fn, pattern) {
    try {
      await fn();
    } catch (error) {
      if (pattern && !pattern.test(String(error))) throw error;
      return error;
    }
    throw new Error('Expected promise to reject');
  },
};

const [
  edgeIndex,
  aiPage,
  publicContracts,
] = await Promise.all([
  readFile('supabase/functions/ai-media-analyze/index.ts', 'utf8'),
  readFile('src/components/portal/AiAssistantPage.tsx', 'utf8'),
  readFile('src/features/content-engine/contracts.ts', 'utf8'),
]);

assert.match(edgeIndex, /handleMediaAnalysis/);
assert.match(edgeIndex, /provider: null/);
assert.doesNotMatch(edgeIndex, /api\.openai\.com|OPENAI_API_KEY|buildPrompt|Vision|storyboard|carousel/i);
assert.doesNotMatch(`${aiPage}\n${publicContracts}`, /ai-media-analyze|AI_MEDIA_PROVIDER|AI_MEDIA_MODEL|api\.openai\.com|OPENAI_API_KEY/);

const basePayload = {
  schemaVersion: 'media-analysis-request-v1',
  jobId: 'job-1',
  attachmentIds: ['photo-1', 'video-1'],
  analysisMode: 'media_review',
  idempotencyKey: 'media-request-1',
};
const baseJob = {
  id: 'job-1',
  company_id: 'company-1',
  job_number: 'JOB-74',
  status: 'Completed',
  notes: 'Gate code 1234',
  service_call_fee_cents: 12000,
  labor_cents: 34000,
  customer_id: 'customer-1',
  customer_location_id: 'location-1',
};
const validated = validateMediaAnalysisRequestBody(basePayload);
assert.deepEqual(validated.attachmentIds, ['photo-1', 'video-1']);
assert.throws(() => validateMediaAnalysisRequestBody({ ...basePayload, mediaUrl: 'https://example.test/file.jpg' }), /INVALID_REQUEST/);
assert.throws(() => validateMediaAnalysisRequestBody({ ...basePayload, imageBase64: 'abc' }), /INVALID_REQUEST/);
assert.throws(() => validateMediaAnalysisRequestBody({ ...basePayload, attachmentIds: [] }), /MEDIA_NOT_SELECTED/);
assert.throws(() => validateMediaAnalysisRequestBody({ ...basePayload, idempotencyKey: 'bad key' }), /INVALID_REQUEST/);

const providerSchema = buildProviderNeutralMediaResponseFormat();
assert.equal(providerSchema.type, 'json_schema');
assert.equal(providerSchema.strict, true);
assert.equal(providerSchema.schema.additionalProperties, false);
assert.equal(providerSchema.schema.properties.attachments.items.additionalProperties, false);
assert.equal(providerSchema.schema.properties.recommendations.items.additionalProperties, false);

assert.equal(mediaKindFor('photo', 'image/jpeg'), 'photo');
assert.equal(mediaKindFor('file', 'video/mp4'), 'video');
assert.equal(mediaKindFor('file', 'application/pdf'), null);

const context = await buildAuthorizedMediaContext({
  request: validated,
  session: companySession(),
  repository: makeRepository(),
});
assert.equal(context.companyId, 'company-1');
assert.equal(context.attachments.length, 2);
assert.equal(context.attachments[0].mediaKind, 'photo');
assert.equal(context.attachments[1].mediaKind, 'video');
assert.doesNotMatch(JSON.stringify(context.attachments), /Jane Customer|123 Market|JOB-74|Gate code/);

await assertNoProviderCall('unauthenticated', { authorization: '' }, /AUTH_REQUIRED/);
await assertNoProviderCall('AI Assistant access off', {
  company: { id: 'company-1', owner_email: 'owner@example.test', access_rules: { aiAssistant: 'off' } },
}, /FORBIDDEN/);
await assertNoProviderCall('wrong company session', {
  session: { kind: 'company', company_id: 'other-company', user_id: 'user-1', email: 'staff@example.test' },
}, /FORBIDDEN/);
await assertNoProviderCall('unsupported job status', {
  job: { ...baseJob, status: 'In progress' },
}, /UNSUPPORTED_STATUS/);
await assertNoProviderCall('unknown attachment', {
  payload: { ...basePayload, attachmentIds: ['missing-photo'] },
}, /MEDIA_NOT_FOUND/);
await assertNoProviderCall('cross-tenant attachment', {
  attachments: [attachment({ id: 'photo-1', company_id: 'other-company' })],
  payload: { ...basePayload, attachmentIds: ['photo-1'] },
}, /MEDIA_WRONG_TENANT/);
await assertNoProviderCall('unsupported attachment type', {
  attachments: [attachment({ id: 'photo-1', mime_type: 'application/pdf', kind: 'file' })],
  payload: { ...basePayload, attachmentIds: ['photo-1'] },
}, /MEDIA_UNSUPPORTED_TYPE/);
await assertNoProviderCall('large image', {
  attachments: [attachment({ id: 'photo-1', size_bytes: 20_000_000 })],
  payload: { ...basePayload, attachmentIds: ['photo-1'] },
}, /MEDIA_TOO_LARGE/);

const telemetryEvents = [];
const fallback = await handleMediaAnalysis(makeDependencies({
  telemetry: { record: (event) => telemetryEvents.push(event) },
}));
assert.equal(fallback.provider, 'deterministic-fallback');
assert.match(fallback.warnings.map((warning) => warning.code).join(','), /MEDIA_PROVIDER_NOT_CONFIGURED/);
validateMediaAnalysisResultShape(fallback);
assert.equal(telemetryEvents.length, 1);
assert.equal(telemetryEvents[0].attachmentCount, 2);
assert.equal(telemetryEvents[0].mediaKindCounts.photo, 1);
assert.equal(telemetryEvents[0].mediaKindCounts.video, 1);
assert.doesNotMatch(JSON.stringify(telemetryEvents[0]), /photo\.jpg|storage|Jane Customer|123 Market|JOB-74|Gate code|prompt|response|jwt|key/i);

const providerResult = await handleMediaAnalysis(makeDependencies({
  provider: {
    id: 'mock-media-provider',
    async analyze() {
      return {
        schemaVersion: 'media-analysis-result-v1',
        analysisVersion: 'media-analysis-v1',
        analysisMode: 'media_review',
        jobId: 'job-1',
        provider: 'mock-media-provider',
        model: 'mock-media-model',
        attachments: [
          { id: 'photo-1', kind: 'photo', mimeType: 'image/jpeg', sizeBytes: 500000, status: 'accepted' },
          { id: 'video-1', kind: 'video', mimeType: 'video/mp4', sizeBytes: 2000000, status: 'accepted' },
        ],
        recommendations: [],
        warnings: [],
        safety: { ok: true, privacy: 'passed', grounding: 'not_applicable', blockedReasons: [] },
        telemetry: { correlationId: 'media-request-1', attempts: 1, latencyMs: 1 },
      };
    },
  },
}));
assert.equal(providerResult.provider, 'mock-media-provider');
assert.equal(providerResult.model, 'mock-media-model');

let authFailures = 0;
const authFailed = await handleMediaAnalysis(makeDependencies({
  provider: {
    id: 'mock-media-provider',
    async analyze() {
      authFailures += 1;
      throw new MediaAnalysisError('MEDIA_PROVIDER_AUTH_FAILED', { retryable: false, httpStatus: 401 });
    },
  },
  config: { maxAttempts: 3 },
}));
assert.equal(authFailures, 1);
assert.equal(authFailed.provider, 'deterministic-fallback');
assert.match(authFailed.warnings.map((warning) => warning.code).join(','), /MEDIA_PROVIDER_AUTH_FAILED/);

let retryableCalls = 0;
const retried = await handleMediaAnalysis(makeDependencies({
  provider: {
    id: 'mock-media-provider',
    async analyze() {
      retryableCalls += 1;
      if (retryableCalls === 1) throw new MediaAnalysisError('MEDIA_PROVIDER_RATE_LIMITED', { retryable: true, httpStatus: 429 });
      return providerResultShape();
    },
  },
  config: { maxAttempts: 2 },
}));
assert.equal(retryableCalls, 2);
assert.equal(retried.provider, 'mock-media-provider');

const sharedGuards = createMemoryGuards();
let idempotentCalls = 0;
const idempotentProvider = {
  id: 'mock-media-provider',
  async analyze() {
    idempotentCalls += 1;
    return providerResultShape();
  },
};
await handleMediaAnalysis(makeDependencies({ guards: sharedGuards, provider: idempotentProvider }));
await handleMediaAnalysis(makeDependencies({ guards: sharedGuards, provider: idempotentProvider }));
assert.equal(idempotentCalls, 1);

console.log('media analysis regression checks passed');

function makeDependencies(overrides = {}) {
  return {
    rawBody: JSON.stringify(overrides.payload ?? basePayload),
    authorization: overrides.authorization ?? 'Bearer token',
    auth: overrides.auth ?? { async resolveSession() { return overrides.session ?? companySession(); } },
    repository: makeRepository(overrides),
    provider: overrides.provider ?? null,
    guards: overrides.guards ?? createMemoryGuards(),
    config: { providerId: 'mock-media-provider', model: 'mock-media-model', timeoutMs: 1000, maxAttempts: 1, ...(overrides.config ?? {}) },
    telemetry: overrides.telemetry ?? { record() {} },
  };
}

function makeRepository(overrides = {}) {
  const job = overrides.job ?? baseJob;
  const company = overrides.company ?? { id: job.company_id, owner_email: 'owner@example.test', access_rules: { aiAssistant: 'full' } };
  const companyUser = overrides.companyUser ?? { id: 'user-1', company_id: company.id, status: 'active', role: 'manager', portal_access_rules: { aiAssistant: 'full' } };
  const attachments = overrides.attachments ?? [
    attachment({ id: 'photo-1', mime_type: 'image/jpeg', size_bytes: 500000, kind: 'photo' }),
    attachment({ id: 'video-1', mime_type: 'video/mp4', size_bytes: 2000000, kind: 'file' }),
  ];
  return {
    async getJob() { return job; },
    async getCompany() { return company; },
    async getCompanyUser() { return companyUser; },
    async getCustomer() { return { organization: 'Private Org', primary_name: 'Jane Customer', primary_email: 'jane@example.test', primary_phone: '555-1234', notes: 'VIP' }; },
    async getLocation() { return { address: '123 Market Street' }; },
    async listInvoices() { return [{ invoice_number: 'INV-JOB-74', amount_cents: 34000, status: 'open' }]; },
    async listComments() { return [{ message: 'Private comment' }]; },
    async listAttachmentsByIds(ids) { return attachments.filter((item) => ids.includes(item.id)); },
  };
}

function companySession() {
  return { kind: 'company', company_id: 'company-1', user_id: 'user-1', email: 'staff@example.test' };
}

function attachment(overrides = {}) {
  return {
    id: overrides.id ?? 'photo-1',
    company_id: overrides.company_id ?? 'company-1',
    job_id: overrides.job_id ?? 'job-1',
    name: overrides.name ?? 'photo.jpg',
    mime_type: overrides.mime_type ?? 'image/jpeg',
    size_bytes: overrides.size_bytes ?? 500000,
    kind: overrides.kind ?? 'photo',
    storage_bucket: overrides.storage_bucket ?? 'job-files',
    storage_path: overrides.storage_path ?? `company-1/job-1/${overrides.id ?? 'photo-1'}`,
    created_at: '2026-07-26T00:00:00Z',
  };
}

async function assertNoProviderCall(_label, overrides, pattern) {
  let called = false;
  await assert.rejects(() => handleMediaAnalysis(makeDependencies({
    ...overrides,
    provider: { id: 'mock-media-provider', async analyze() { called = true; return providerResultShape(); } },
  })), pattern);
  assert.equal(called, false);
}

function providerResultShape() {
  return {
    schemaVersion: 'media-analysis-result-v1',
    analysisVersion: 'media-analysis-v1',
    analysisMode: 'media_review',
    jobId: 'job-1',
    provider: 'mock-media-provider',
    model: 'mock-media-model',
    attachments: [
      { id: 'photo-1', kind: 'photo', mimeType: 'image/jpeg', sizeBytes: 500000, status: 'accepted' },
      { id: 'video-1', kind: 'video', mimeType: 'video/mp4', sizeBytes: 2000000, status: 'accepted' },
    ],
    recommendations: [],
    warnings: [],
    safety: { ok: true, privacy: 'passed', grounding: 'not_applicable', blockedReasons: [] },
    telemetry: { correlationId: 'media-request-1', attempts: 1, latencyMs: 1 },
  };
}
