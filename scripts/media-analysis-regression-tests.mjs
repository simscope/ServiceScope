import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { buildAuthorizedMediaContext, mediaKindFor } from '../supabase/functions/_shared/media-analysis/authorization.js';
import { handleMediaAnalysis, mediaFingerprint } from '../supabase/functions/_shared/media-analysis/applicationService.js';
import {
  buildProviderNeutralMediaResponseFormat,
  parseProviderMediaResult,
  validateMediaAnalysisRequestBody,
  validateMediaAnalysisResultShape,
  validateProviderPayloadShape,
} from '../supabase/functions/_shared/media-analysis/schemas.js';
import { MediaAnalysisError } from '../supabase/functions/_shared/media-analysis/errors.js';
import {
  buildMediaPrompt,
  buildOpenAiMediaRequest,
  createMediaProviderFromEnv,
  createOpenAiMediaProvider,
  extractResponsesOutputText,
  mapOpenAiMediaError,
} from '../supabase/functions/_shared/media-analysis/providers/openai.js';
import { createMemoryGuards } from '../supabase/functions/_shared/content-engine/rateLimit.js';
import {
  contentFindingCategories,
  privacyFindingCategories,
} from '../supabase/functions/_shared/media-analysis/contracts.js';
import {
  assertNoPrivateValues,
  buildKnownPrivateValues,
  collectPrivacyDiagnostics,
} from '../supabase/functions/_shared/media-analysis/privacy.js';

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

const [edgeIndex, aiPage, publicContracts, openAiAdapter, appService, supabaseRest, appShell] = await Promise.all([
  readFile('supabase/functions/ai-media-analyze/index.ts', 'utf8'),
  readFile('src/components/portal/AiAssistantPage.tsx', 'utf8'),
  readFile('src/features/content-engine/contracts.ts', 'utf8'),
  readFile('supabase/functions/_shared/media-analysis/providers/openai.js', 'utf8'),
  readFile('supabase/functions/_shared/media-analysis/applicationService.js', 'utf8'),
  readFile('src/services/supabaseRest.ts', 'utf8'),
  readFile('src/App.tsx', 'utf8'),
]);
const [mediaClientApi, mediaClientContracts, mediaWorkspaceState] = await Promise.all([
  readFile('src/features/media-analysis/clientApi.ts', 'utf8'),
  readFile('src/features/media-analysis/contracts.ts', 'utf8'),
  readFile('src/features/media-analysis/workspaceState.ts', 'utf8'),
]);

assert.match(edgeIndex, /handleMediaAnalysis/);
assert.match(edgeIndex, /privacyFindingCategories/);
assert.match(edgeIndex, /privacyFindingCategorySet\.has/);
assert.doesNotMatch(edgeIndex, /startsWith\('possible_'\)/);
assert.match(edgeIndex, /createMediaProviderFromEnv/);
assert.match(edgeIndex, /createSignedUrl\(attachment\.storagePath, signedUrlTtlSeconds\)/);
assert.match(edgeIndex, /safeTopLevelFailureEvent/);
assert.match(edgeIndex, /providerCallStarted: false/);
assert.doesNotMatch(edgeIndex, /console\.info\([^)]*['"]ai-media-analysis['"],\s*(?:rawBody|request|authorization|signedUrl)/i);
assert.doesNotMatch(edgeIndex, /api\.openai\.com|OPENAI_API_KEY|buildMediaPrompt|text: \{ format|Vision|storyboard|carousel/i);
assert.match(openAiAdapter, /api\.openai\.com\/v1\/responses/);
assert.match(openAiAdapter, /OPENAI_API_KEY|json_schema|input_image/);
assert.doesNotMatch(appService, /api\.openai\.com|OPENAI_API_KEY|input_image|buildMediaPrompt/);
assert.doesNotMatch(appService, /assertNoPrivateValues\(context\.attachments/);
assert.match(appService, /buildProviderSafeRequest/);
assert.doesNotMatch(`${aiPage}\n${publicContracts}\n${mediaClientApi}\n${mediaClientContracts}\n${mediaWorkspaceState}`, /AI_MEDIA_PROVIDER|AI_MEDIA_MODEL|api\.openai\.com|OPENAI_API_KEY|signed URL|storage service-role/i);
assert.match(supabaseRest, /parsed\.code/);
assert.match(supabaseRest, /\$\{normalizedCode\}: \$\{clean\}/);
assert.match(mediaClientApi, /supabaseFunction<MediaAnalysisResult>\('ai-media-analyze'/);
assert.doesNotMatch(mediaClientApi, /companyId|mediaUrl|dataUrl|base64|filename|approval|findings|provider|model/i);
assert.match(aiPage, /Analyze selected media/);
assert.match(aiPage, /Media Findings Review/);
assert.match(aiPage, /Approve for use/);
assert.match(aiPage, /Mark false positive/);
assert.match(aiPage, /Up to \{MEDIA_ANALYSIS_MAX_PHOTOS\} photos per request/);
assert.doesNotMatch(supabaseRest, /Authorization:\s*`Bearer \$\{accessToken \|\| supabaseAnonKey\}`/);
assert.doesNotMatch(supabaseRest, /console\.(?:log|info|warn|error)\([^)]*(?:accessToken|refreshToken|access_token|refresh_token)/i);
assert.match(appShell, /addEventListener\(SUPABASE_AUTH_EXPIRED_EVENT, handleSupabaseAuthExpired\)/);
assert.match(appShell, /setAuthNotice\(SUPABASE_AUTH_EXPIRED_MESSAGE\)/);
assert.match(appShell, /replaceState\(null, '', '#login'\)/);

const authTestSource = supabaseRest
  .replace(
    "const supabaseUrl = viteEnv.VITE_SUPABASE_URL?.replace(/\\/$/, '') ?? '';",
    "const supabaseUrl = 'https://auth-test.supabase.co';",
  )
  .replace(
    "const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY ?? '';",
    "const supabaseAnonKey = 'test-anon-key';",
  );
assert.doesNotMatch(authTestSource, /const supabaseUrl = viteEnv|const supabaseAnonKey = viteEnv/);
const authTestModuleSource = ts.transpileModule(authTestSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const authClient = await import(`data:text/javascript;base64,${Buffer.from(authTestModuleSource).toString('base64')}`);
const authStorage = new Map();
const authEvents = [];
const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
globalThis.window = {
  localStorage: {
    getItem(key) { return authStorage.get(key) ?? null; },
    setItem(key, value) { authStorage.set(key, String(value)); },
    removeItem(key) { authStorage.delete(key); },
  },
  setTimeout: originalSetTimeout,
  clearTimeout: originalClearTimeout,
  dispatchEvent(event) {
    authEvents.push(event.type);
    return true;
  },
};

function resetAuthHarness() {
  authStorage.clear();
  authEvents.length = 0;
}

function authResponse(status, body = {}) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return text; },
  };
}

resetAuthHarness();
authClient.setSupabaseAuthTokens('valid-user-token', 'valid-refresh-token', 3600);
let validRefreshCalls = 0;
let validFunctionCalls = 0;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('grant_type=refresh_token')) validRefreshCalls += 1;
  if (String(url).includes('/functions/v1/ai-media-analyze')) {
    validFunctionCalls += 1;
    assert.equal(init.headers.apikey, 'test-anon-key');
    assert.equal(init.headers.Authorization, 'Bearer valid-user-token');
    return authResponse(200, { ok: true });
  }
  throw new Error('Unexpected auth test endpoint');
};
await authClient.supabaseFunction('ai-media-analyze', { test: true });
assert.equal(validRefreshCalls, 0);
assert.equal(validFunctionCalls, 1);

resetAuthHarness();
authClient.setSupabaseAuthTokens('expiring-user-token', 'refresh-once-token', 30);
let expiringRefreshCalls = 0;
let expiringFunctionCalls = 0;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('grant_type=refresh_token')) {
    expiringRefreshCalls += 1;
    assert.equal(init.headers.apikey, 'test-anon-key');
    assert.equal(Object.hasOwn(init.headers, 'Authorization'), false);
    return authResponse(200, {
      access_token: 'refreshed-user-token',
      refresh_token: 'next-refresh-token',
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: 'user-1' },
    });
  }
  if (String(url).includes('/functions/v1/ai-media-analyze')) {
    expiringFunctionCalls += 1;
    assert.equal(init.headers.Authorization, 'Bearer refreshed-user-token');
    return authResponse(200, { ok: true });
  }
  throw new Error('Unexpected auth test endpoint');
};
await authClient.supabaseFunction('ai-media-analyze', { test: true });
assert.equal(expiringRefreshCalls, 1);
assert.equal(expiringFunctionCalls, 1);

resetAuthHarness();
authClient.setSupabaseAuthTokens('concurrent-expiring-token', 'concurrent-refresh-token', 30);
let concurrentRefreshCalls = 0;
let concurrentFunctionCalls = 0;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('grant_type=refresh_token')) {
    concurrentRefreshCalls += 1;
    await new Promise((resolve) => originalSetTimeout(resolve, 5));
    return authResponse(200, {
      access_token: 'concurrent-refreshed-token',
      refresh_token: 'concurrent-next-refresh-token',
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: 'user-1' },
    });
  }
  if (String(url).includes('/functions/v1/ai-media-analyze')) {
    concurrentFunctionCalls += 1;
    assert.equal(init.headers.Authorization, 'Bearer concurrent-refreshed-token');
    return authResponse(200, { ok: true });
  }
  throw new Error('Unexpected auth test endpoint');
};
await Promise.all([
  authClient.supabaseFunction('ai-media-analyze', { request: 1 }),
  authClient.supabaseFunction('ai-media-analyze', { request: 2 }),
]);
assert.equal(concurrentRefreshCalls, 1);
assert.equal(concurrentFunctionCalls, 2);

resetAuthHarness();
let missingTokenFetchCalls = 0;
globalThis.fetch = async () => {
  missingTokenFetchCalls += 1;
  return authResponse(500);
};
const missingTokenError = await assert.rejects(
  () => authClient.supabaseFunction('ai-media-analyze', { test: true }),
  /Your session expired/,
);
assert.equal(missingTokenError.name, authClient.SUPABASE_AUTH_EXPIRED_CODE);
assert.equal(missingTokenFetchCalls, 0);
assert.equal(authEvents.filter((event) => event === authClient.SUPABASE_AUTH_EXPIRED_EVENT).length, 1);

resetAuthHarness();
authClient.setSupabaseAuthTokens('refresh-failure-user-token', 'refresh-failure-token', 30);
let refreshFailureCalls = 0;
let refreshFailureFunctionCalls = 0;
globalThis.fetch = async (url) => {
  if (String(url).includes('grant_type=refresh_token')) {
    refreshFailureCalls += 1;
    return authResponse(400, { error: 'refresh_failed' });
  }
  refreshFailureFunctionCalls += 1;
  return authResponse(200, { ok: true });
};
const refreshFailureError = await assert.rejects(
  () => authClient.supabaseFunction('ai-media-analyze', { test: true }),
  /Your session expired/,
);
assert.equal(refreshFailureError.name, authClient.SUPABASE_AUTH_EXPIRED_CODE);
assert.equal(refreshFailureCalls, 1);
assert.equal(refreshFailureFunctionCalls, 0);
assert.equal(authStorage.has('servicescope.supabaseAccessToken'), false);
assert.equal(authEvents.filter((event) => event === authClient.SUPABASE_AUTH_EXPIRED_EVENT).length, 1);
assert.doesNotMatch(String(refreshFailureError), /refresh-failure-user-token|refresh-failure-token/);

resetAuthHarness();
authClient.setSupabaseAuthTokens('rejected-user-token', 'rejected-refresh-token', 3600);
let unauthorizedFunctionCalls = 0;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('/functions/v1/ai-media-analyze')) {
    unauthorizedFunctionCalls += 1;
    assert.equal(init.headers.Authorization, 'Bearer rejected-user-token');
    return authResponse(401, { message: 'Invalid JWT' });
  }
  throw new Error('Unexpected auth test endpoint');
};
const unauthorizedError = await assert.rejects(
  () => authClient.supabaseFunction('ai-media-analyze', { test: true }),
  /Your session expired/,
);
assert.equal(unauthorizedError.name, authClient.SUPABASE_AUTH_EXPIRED_CODE);
assert.equal(unauthorizedFunctionCalls, 1);
assert.equal(authStorage.has('servicescope.supabaseAccessToken'), false);
assert.equal(authEvents.filter((event) => event === authClient.SUPABASE_AUTH_EXPIRED_EVENT).length, 1);
assert.doesNotMatch(String(unauthorizedError), /rejected-user-token|rejected-refresh-token/);

resetAuthHarness();
let passwordGrantCalls = 0;
globalThis.fetch = async (url, init) => {
  passwordGrantCalls += 1;
  assert.match(String(url), /auth\/v1\/token\?grant_type=password/);
  assert.equal(init.headers.apikey, 'test-anon-key');
  assert.equal(Object.hasOwn(init.headers, 'Authorization'), false);
  return authResponse(200, {
    access_token: 'signed-in-user-token',
    refresh_token: 'signed-in-refresh-token',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: 'user-1' },
  });
};
await authClient.signInWithSupabasePassword('synthetic@example.test', 'synthetic-password');
const savedSignInSession = JSON.parse(authStorage.get('servicescope.supabaseAccessToken'));
assert.equal(passwordGrantCalls, 1);
assert.equal(savedSignInSession.accessToken, 'signed-in-user-token');
assert.equal(savedSignInSession.refreshToken, 'signed-in-refresh-token');
assert.ok(savedSignInSession.expiresAt > Date.now());

globalThis.fetch = originalFetch;
if (originalWindow === undefined) delete globalThis.window;
else globalThis.window = originalWindow;

execFileSync(process.execPath, [
  'node_modules/typescript/bin/tsc',
  'src/features/media-analysis/contracts.ts',
  'src/features/media-analysis/workspaceState.ts',
  '--target',
  'ES2020',
  '--module',
  'NodeNext',
  '--moduleResolution',
  'NodeNext',
  '--outDir',
  '.tmp/media-analysis-client-tests',
  '--skipLibCheck',
], { stdio: 'pipe' });
const clientContracts = await import('../.tmp/media-analysis-client-tests/features/media-analysis/contracts.js');
const clientState = await import('../.tmp/media-analysis-client-tests/features/media-analysis/workspaceState.js');

const clientRequest = clientContracts.buildMediaAnalysisRequest({
  jobId: 'job-1',
  attachmentIds: ['photo-1'],
  idempotencyKey: 'media-request-1',
});
assert.deepEqual(Object.keys(clientRequest).sort(), ['analysisMode', 'attachmentIds', 'idempotencyKey', 'jobId', 'schemaVersion']);
assert.equal(clientRequest.schemaVersion, 'media-analysis-request-v1');
assert.equal(clientRequest.analysisMode, 'media_review');
assert.doesNotMatch(JSON.stringify(clientRequest), /companyId|mediaUrl|dataUrl|base64|filename|approval|findings/i);
assert.deepEqual(clientContracts.MEDIA_ANALYSIS_CLIENT_REQUEST_KEYS, ['schemaVersion', 'jobId', 'attachmentIds', 'analysisMode', 'idempotencyKey']);
assert.equal(clientContracts.normalizeMediaAnalysisError(new Error('MEDIA_PROVIDER_QUOTA_EXCEEDED: quota')).message, 'Media analysis quota is unavailable. Manual review is required.');
assert.equal(clientContracts.normalizeMediaAnalysisError(new Error('MEDIA_NOT_SELECTED: Media analysis request was rejected.')).message, 'Select at least one photo or video.');
assert.equal(clientContracts.normalizeMediaAnalysisError(new Error('INVALID_REQUEST: Media analysis request was rejected.')).message, 'Media analysis request was rejected.');
assert.equal(clientContracts.normalizeMediaAnalysisError(new Error('vendor raw error')).message, 'Media analysis is temporarily unavailable.');

const selectedMedia = [
  { id: 'photo-1', kind: 'photo', selected: true },
  { id: 'video-1', kind: 'file', selected: true },
];
assert.deepEqual(clientContracts.validateMediaAnalysisSelection(selectedMedia).attachmentIds, ['photo-1', 'video-1']);
assert.equal(clientContracts.validateMediaAnalysisSelection(selectedMedia.map((item) => ({ ...item, selected: false }))).code, 'MEDIA_NOT_SELECTED');
assert.equal(clientContracts.validateMediaAnalysisSelection(['1', '2', '3', '4', '5'].map((id) => ({ id, kind: 'photo', selected: true }))).code, 'MEDIA_REQUEST_TOO_LARGE');

const pageWorkspace = {
  technicianFacts: { diagnosis: 'safe diagnosis' },
  draftWorkspace: { drafts: { Instagram: 'Generated', Facebook: 'Manual edit' }, statuses: { Instagram: 'generated', Facebook: 'edited' } },
  selectedChannels: ['Instagram'],
  mediaState: [{ id: 'photo-1', selected: true, order: 2, label: 'Overview' }],
};
let analysisState = clientState.createMediaAnalysisWorkspaceState('job-1');
const firstStart = clientState.beginMediaAnalysisRequest(analysisState, 'request-1');
assert.equal(firstStart.shouldRequest, true);
const secondStart = clientState.beginMediaAnalysisRequest(firstStart.state, 'request-2');
assert.equal(secondStart.shouldRequest, false);
const successfulAnalysis = mediaAnalysisResultFixture();
analysisState = clientState.applyMediaAnalysisResult(firstStart.state, successfulAnalysis, 'request-1', 'job-1');
assert.equal(analysisState.status, 'succeeded');
assert.equal(pageWorkspace.technicianFacts.diagnosis, 'safe diagnosis');
assert.equal(pageWorkspace.draftWorkspace.drafts.Instagram, 'Generated');
assert.equal(pageWorkspace.draftWorkspace.drafts.Facebook, 'Manual edit');
assert.equal(pageWorkspace.draftWorkspace.statuses.Facebook, 'edited');
assert.deepEqual(pageWorkspace.selectedChannels, ['Instagram']);
assert.deepEqual(pageWorkspace.mediaState, [{ id: 'photo-1', selected: true, order: 2, label: 'Overview' }]);
assert.equal(analysisState.approvals['photo-1'], 'pending');
assert.equal(analysisState.approvals['video-1'], 'pending');
assert.equal(clientState.setMediaApproval(analysisState, 'photo-1', 'approved').approvals['photo-1'], 'approved');
assert.equal(clientState.setMediaApproval(analysisState, 'photo-1', 'excluded').approvals['photo-1'], 'excluded');
assert.equal(clientState.setMediaApproval(analysisState, 'photo-1', 'false_positive').approvals['photo-1'], 'false_positive');
assert.equal(analysisState.approvals['photo-1'], 'pending');
const staleBase = clientState.beginMediaAnalysisRequest(clientState.createMediaAnalysisWorkspaceState('job-1'), 'request-stale').state;
const staleApplied = clientState.applyMediaAnalysisResult(staleBase, { ...successfulAnalysis, jobId: 'old-job' }, 'request-stale', 'new-job');
assert.equal(staleApplied.status, 'pending');
assert.equal(clientState.resetMediaAnalysisWorkspace('job-2').result, undefined);
assert.equal(clientState.mediaStatusMessage('metadata_only', false), 'Visual analysis was not completed. Review this media manually.');
assert.equal(clientState.mediaStatusMessage('video_analysis_not_supported_v1', false), 'Video visual analysis is not supported in this version.');
assert.equal(clientState.mediaStatusLabel('metadata_only'), 'metadata only');
assert.equal(clientContracts.privacyRiskPriority('possible_face'), 'High');
assert.equal(clientContracts.privacyRiskPriority('possible_serial_or_nameplate'), 'Medium');
assert.doesNotMatch(`${aiPage}\n${mediaWorkspaceState}`, /raw provider JSON|raw prompt|OCR text|storage path|signed URL/i);

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
assert.equal(providerSchema.name, 'service_scope_media_analysis_v1');
assert.equal(providerSchema.strict, true);
assert.equal(providerSchema.schema.additionalProperties, false);
assert.deepEqual(providerSchema.schema.required, ['schemaVersion', 'attachments', 'recommendations', 'missingShots']);
assert.equal(providerSchema.schema.properties.attachments.items.additionalProperties, false);
assert.equal(providerSchema.schema.properties.attachments.items.properties.findings.items.additionalProperties, false);
assert.doesNotMatch(JSON.stringify(providerSchema), /"detectedText"|"ocrText"|"serialNumber"|"addressText"|"phone"|"email"|"plateNumber"|"personName"/);

assert.equal(mediaKindFor('photo', 'image/jpeg'), 'photo');
assert.equal(mediaKindFor('file', 'image/png'), 'photo');
assert.equal(mediaKindFor('file', 'image/webp'), 'photo');
assert.equal(mediaKindFor('file', 'image/heic'), null);
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
assert.doesNotMatch(JSON.stringify(context.attachments), /Jane Customer|123 Market|JOB-74|Gate code|photo\.jpg/);

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
await assertNoProviderCall('more than four photos', {
  payload: { ...basePayload, attachmentIds: ['photo-1', 'photo-2', 'photo-3', 'photo-4', 'photo-5'] },
  attachments: ['photo-1', 'photo-2', 'photo-3', 'photo-4', 'photo-5'].map((id) => attachment({ id })),
}, /MEDIA_REQUEST_TOO_LARGE/);

const telemetryEvents = [];
const fallback = await handleMediaAnalysis(makeDependencies({
  telemetry: { record: (event) => telemetryEvents.push(event) },
}));
assert.equal(fallback.provider, 'deterministic-fallback');
assert.match(fallback.warnings.map((warning) => warning.code).join(','), /MEDIA_PROVIDER_NOT_CONFIGURED/);
validateMediaAnalysisResultShape(fallback);
assert.equal(fallback.attachments[0].status, 'metadata_only');
assert.equal(fallback.attachments[0].visualAnalysisPerformed, false);
assert.equal(fallback.attachments[1].status, 'video_analysis_not_supported_v1');
assert.equal(fallback.attachments[1].visualAnalysisPerformed, false);
assert.deepEqual(fallback.attachments.flatMap((item) => item.findings), []);
assert.equal(telemetryEvents.length, 1);
assert.equal(telemetryEvents[0].attachmentCount, 2);
assert.equal(telemetryEvents[0].mediaKindCounts.photo, 1);
assert.equal(telemetryEvents[0].mediaKindCounts.video, 1);
assert.doesNotMatch(JSON.stringify(telemetryEvents[0]), /photo\.jpg|storage|signed|Jane Customer|123 Market|JOB-74|Gate code|prompt|response|jwt|key/i);

const technicalAttachmentId = '11111111-2222-4333-8444-555555555555';
const technicalCompanyId = '22222222-3333-4444-8555-666666666666';
const technicalJobId = '33333333-4444-4555-8666-777777777777';
const technicalActorId = '44444444-5555-4666-8777-888888888888';
const technicalStoragePath = `${technicalCompanyId}/${technicalJobId}/20260728031908000000/${technicalAttachmentId}`;
let technicalProviderCalls = 0;
let capturedProviderRequest;
const technicalBoundaryResult = await handleMediaAnalysis(makeDependencies({
  payload: {
    ...basePayload,
    jobId: technicalJobId,
    attachmentIds: [technicalAttachmentId],
    idempotencyKey: 'technical-boundary-1',
  },
  job: {
    ...baseJob,
    id: technicalJobId,
    company_id: technicalCompanyId,
  },
  company: {
    id: technicalCompanyId,
    owner_email: 'synthetic-owner@example.test',
    access_rules: { aiAssistant: 'full' },
  },
  companyUser: {
    id: technicalActorId,
    company_id: technicalCompanyId,
    status: 'active',
    role: 'manager',
    portal_access_rules: { aiAssistant: 'full' },
  },
  session: {
    kind: 'company',
    company_id: technicalCompanyId,
    user_id: technicalActorId,
    email: 'synthetic-user@example.test',
  },
  attachments: [attachment({
    id: technicalAttachmentId,
    company_id: technicalCompanyId,
    job_id: technicalJobId,
    storage_bucket: 'synthetic-media-bucket',
    storage_path: technicalStoragePath,
    size_bytes: 769000,
    created_at: '2026-07-28T03:00:00Z',
    updated_at: '2026-07-28T03:10:00Z',
  })],
  repositoryOverrides: {
    async createSignedMediaUrl() {
      return `https://signed.example.test/${technicalAttachmentId}?token=synthetic`;
    },
  },
  provider: {
    id: 'mock-media-provider',
    async analyze(providerRequest) {
      technicalProviderCalls += 1;
      capturedProviderRequest = providerRequest;
      return providerRawResult(providerPayload({
        attachments: [{
          attachmentId: technicalAttachmentId,
          findings: [{
            category: 'equipment_overview',
            confidence: 0.71,
            explanation: 'Could be useful as an equipment overview.',
            riskLevel: 'low',
          }],
        }],
      }));
    },
  },
}));
assert.equal(technicalProviderCalls, 1);
assert.equal(technicalBoundaryResult.provider, 'mock-media-provider');
assert.equal(technicalBoundaryResult.attachments[0].status, 'analyzed');
assert.deepEqual(Object.keys(capturedProviderRequest).sort(), ['context', 'mediaInputs', 'request']);
assert.deepEqual(capturedProviderRequest.request, { analysisMode: 'media_review' });
assert.deepEqual(capturedProviderRequest.context, { status: 'Completed' });
assert.equal(capturedProviderRequest.mediaInputs.length, 1);
assert.deepEqual(
  Object.keys(capturedProviderRequest.mediaInputs[0]).sort(),
  ['attachmentId', 'imageUrl', 'kind', 'mimeType'],
);
assert.equal(capturedProviderRequest.mediaInputs[0].attachmentId, technicalAttachmentId);
assert.equal(capturedProviderRequest.mediaInputs[0].mimeType, 'image/jpeg');
assert.equal(capturedProviderRequest.mediaInputs[0].kind, 'photo');
assert.ok(
  String(capturedProviderRequest.mediaInputs[0].imageUrl).startsWith('https://signed.example.test/'),
  'Expected a signed image URL only in the provider image input',
);
const redactedProviderBoundary = {
  ...capturedProviderRequest,
  mediaInputs: capturedProviderRequest.mediaInputs.map((input) => ({ ...input, imageUrl: '[redacted]' })),
};
assert.doesNotMatch(
  JSON.stringify(redactedProviderBoundary),
  /privateValues|companyId|actorId|jobId|idempotencyKey|storageBucket|storagePath|createdAt|updatedAt|sizeBytes|customer|invoice|comment/i,
);

const syntheticPromptPrivateValues = [
  'Synthetic Private Customer',
  'private-customer@example.test',
  '555-867-5309',
  '987 Synthetic Avenue',
  'Synthetic private job note',
  'SYNTH-INVOICE-9001',
  'Synthetic private comment',
];
const promptBoundary = buildMediaPrompt({
  request: {
    analysisMode: 'media_review',
    jobId: technicalJobId,
    privateValues: syntheticPromptPrivateValues,
  },
  context: {
    status: 'Completed',
    companyId: technicalCompanyId,
    jobId: technicalJobId,
    privateValues: syntheticPromptPrivateValues,
    jobNote: syntheticPromptPrivateValues[4],
    invoiceNumber: syntheticPromptPrivateValues[5],
    comment: syntheticPromptPrivateValues[6],
  },
  mediaInputs: [{
    attachmentId: technicalAttachmentId,
    mimeType: 'image/jpeg',
    kind: 'photo',
    imageUrl: 'https://signed.example.test/private-image?token=synthetic',
    storageBucket: 'synthetic-media-bucket',
    storagePath: technicalStoragePath,
    filename: 'synthetic-private-filename.png',
    sizeBytes: 769000,
  }],
});
assert.match(promptBoundary, new RegExp(technicalAttachmentId));
for (const privateValue of syntheticPromptPrivateValues) {
  assert.ok(!promptBoundary.includes(privateValue), 'Prompt must not contain synthetic private values');
}
for (const technicalValue of [
  technicalCompanyId,
  technicalJobId,
  technicalStoragePath,
  'synthetic-media-bucket',
  'synthetic-private-filename.png',
  'signed.example.test',
]) {
  assert.ok(!promptBoundary.includes(technicalValue), 'Prompt must not contain non-prompt technical metadata');
}

const preProviderTelemetryEvents = [];
let preProviderTelemetryProviderCalls = 0;
await assert.rejects(() => handleMediaAnalysis(makeDependencies({
  payload: { ...basePayload, attachmentIds: ['photo-1'] },
  attachments: [attachment({ id: 'photo-1' })],
  repositoryOverrides: {
    async getCustomer() {
      return { organization: 'media review' };
    },
  },
  telemetry: { record: (event) => preProviderTelemetryEvents.push(event) },
  provider: {
    id: 'mock-media-provider',
    async analyze() {
      preProviderTelemetryProviderCalls += 1;
      return providerRawResult(providerPayload());
    },
  },
})), /MEDIA_PRIVACY_VALIDATION_FAILED/);
assert.equal(preProviderTelemetryProviderCalls, 0);
assert.equal(preProviderTelemetryEvents.length, 1);
assert.equal(preProviderTelemetryEvents[0].stage, 'pre-provider-validation');
assert.equal(preProviderTelemetryEvents[0].code, 'MEDIA_PRIVACY_VALIDATION_FAILED');
assert.equal(preProviderTelemetryEvents[0].providerCallStarted, false);
assert.equal(preProviderTelemetryEvents[0].httpStatus, 400);
assert.equal(preProviderTelemetryEvents[0].attachmentCount, 1);
assert.equal(preProviderTelemetryEvents[0].privacyDiagnostics[0].subreason, 'KNOWN_PRIVATE_VALUE_MATCH');
assert.equal(preProviderTelemetryEvents[0].privacyDiagnostics[0].path, '$.analysisMode');
assert.doesNotMatch(JSON.stringify(preProviderTelemetryEvents[0]), /media review|synthetic|storage|signed|token|prompt|response/i);

let providerCalls = 0;
let signedUrlCalls = 0;
const providerResult = await handleMediaAnalysis(makeDependencies({
  repositoryOverrides: {
    async createSignedMediaUrl(item) {
      signedUrlCalls += 1;
      assert.equal(item.id, 'photo-1');
      return 'https://signed.example.test/photo-1?token=secret';
    },
  },
  provider: {
    id: 'mock-media-provider',
    async analyze(providerRequest) {
      providerCalls += 1;
      assert.equal(providerRequest.mediaInputs.length, 1);
      assert.equal(providerRequest.mediaInputs[0].attachmentId, 'photo-1');
      assert.equal(providerRequest.mediaInputs[0].imageUrl, 'https://signed.example.test/photo-1?token=secret');
      assert.doesNotMatch(JSON.stringify(providerRequest.mediaInputs), /video-1/);
      return providerRawResult(providerPayload());
    },
  },
}));
assert.equal(providerCalls, 1);
assert.equal(signedUrlCalls, 1);
assert.equal(providerResult.provider, 'mock-media-provider');
assert.equal(providerResult.attachments[0].status, 'analyzed');
assert.equal(providerResult.attachments[0].findings[0].findingId, 'finding-1');
assert.equal(providerResult.attachments[0].findings[0].requiresUserApproval, true);
assert.equal(providerResult.attachments[1].status, 'video_analysis_not_supported_v1');
assert.doesNotMatch(JSON.stringify(providerResult), /signed\.example|token=secret|photo\.jpg|Jane Customer|123 Market|JOB-74|Gate code/);

const contentClassificationCapture = createDurableClassificationCapture();
const contentClassification = await handleMediaAnalysis(makeDependencies({
  payload: { ...basePayload, attachmentIds: ['photo-1', 'photo-2'] },
  attachments: [attachment({ id: 'photo-1' }), attachment({ id: 'photo-2' })],
  repositoryOverrides: contentClassificationCapture.repositoryOverrides,
  provider: {
    id: 'mock-media-provider',
    async analyze() {
      return providerRawResult(providerPayload({
        attachments: [
          { attachmentId: 'photo-1', findings: contentFindingCategories.slice(0, 4).map(classificationFinding) },
          { attachmentId: 'photo-2', findings: contentFindingCategories.slice(4).map(classificationFinding) },
        ],
      }));
    },
  },
}));
assert.equal(contentClassification.attachments[0].analysisRunId, '00000000-0000-4000-8000-000000008900');
assert.ok(/^[0-9a-f-]{36}$/i.test(contentClassification.attachments[0].attachmentResultId));
assert.ok(/^[0-9a-f-]{36}$/i.test(contentClassification.attachments[1].attachmentResultId));
assert.equal(contentClassificationCapture.attachmentResults.length, 2);
assert.ok(contentClassificationCapture.attachmentResults.every((row) => row.privacy_review_status === 'passed'));
assert.equal(contentClassificationCapture.privacyFindings.length, 0);
assert.equal(contentClassification.attachments.flatMap((item) => item.findings).some((finding) => finding.category === 'possible_problem_detail'), true);
assert.equal(contentClassificationCapture.persisted, true);

const privacyClassificationCapture = createDurableClassificationCapture('00000000-0000-4000-8000-000000008901');
await handleMediaAnalysis(makeDependencies({
  payload: { ...basePayload, attachmentIds: ['photo-1', 'photo-2'] },
  attachments: [attachment({ id: 'photo-1' }), attachment({ id: 'photo-2' })],
  repositoryOverrides: privacyClassificationCapture.repositoryOverrides,
  provider: {
    id: 'mock-media-provider',
    async analyze() {
      return providerRawResult(providerPayload({
        attachments: [
          { attachmentId: 'photo-1', findings: privacyFindingCategories.slice(0, 5).map(classificationFinding) },
          { attachmentId: 'photo-2', findings: privacyFindingCategories.slice(5).map(classificationFinding) },
        ],
      }));
    },
  },
}));
assert.deepEqual(privacyClassificationCapture.privacyFindings.map((row) => row.finding_category).sort(), [...privacyFindingCategories].sort());
assert.ok(privacyClassificationCapture.attachmentResults.every((row) => row.privacy_review_status === 'blocked'));

const mixedClassificationCapture = createDurableClassificationCapture('00000000-0000-4000-8000-000000008902');
const mixedClassification = await handleMediaAnalysis(makeDependencies({
  payload: { ...basePayload, attachmentIds: ['photo-1'] },
  attachments: [attachment({ id: 'photo-1' })],
  repositoryOverrides: mixedClassificationCapture.repositoryOverrides,
  provider: {
    id: 'mock-media-provider',
    async analyze() {
      return providerRawResult(providerPayload({
        attachments: [{
          attachmentId: 'photo-1',
          findings: [
            classificationFinding('possible_problem_detail'),
            classificationFinding('possible_face'),
          ],
        }],
      }));
    },
  },
}));
assert.equal(mixedClassification.attachments[0].analysisRunId, '00000000-0000-4000-8000-000000008902');
assert.deepEqual(mixedClassificationCapture.privacyFindings.map((row) => row.finding_category), ['possible_face']);
assert.equal(mixedClassificationCapture.privacyFindings.some((row) => row.finding_category === 'possible_problem_detail'), false);
assert.equal(mixedClassificationCapture.privacyFindings.some((row) => row.finding_category === 'unknown_privacy_risk'), false);

const parsed = parseProviderMediaResult(providerPayload(), {
  request: validated,
  context,
  provider: 'mock-media-provider',
  model: 'mock-media-model',
  attempts: 1,
  latencyMs: 1,
});
assert.equal(parsed.safety.grounding, 'passed');
assert.equal(parsed.attachments[0].findings[0].evidenceType, 'visual_suggestion');

const invalidPayloads = [
  ['unknown attachment', { attachments: [{ attachmentId: 'not-real', findings: [] }] }],
  ['unknown category', { attachments: [{ attachmentId: 'photo-1', findings: [{ category: 'new_category', confidence: 0.4, explanation: 'Possible overview image.', riskLevel: 'low' }] }] }],
  ['negative confidence', { attachments: [{ attachmentId: 'photo-1', findings: [{ category: 'unclear', confidence: -0.1, explanation: 'Unclear image.', riskLevel: 'low' }] }] }],
  ['too high confidence', { attachments: [{ attachmentId: 'photo-1', findings: [{ category: 'unclear', confidence: 1.1, explanation: 'Unclear image.', riskLevel: 'low' }] }] }],
  ['empty explanation', { attachments: [{ attachmentId: 'photo-1', findings: [{ category: 'unclear', confidence: 0.4, explanation: ' ', riskLevel: 'low' }] }] }],
  ['ocr field', { attachments: [{ attachmentId: 'photo-1', findings: [{ category: 'possible_screen', confidence: 0.5, explanation: 'Possible screen.', riskLevel: 'medium', detectedText: '12345' }] }] }],
  ['email output', { attachments: [{ attachmentId: 'photo-1', findings: [{ category: 'possible_phone_or_email', confidence: 0.5, explanation: 'Shows jane@example.test.', riskLevel: 'high' }] }] }],
  ['phone output', { attachments: [{ attachmentId: 'photo-1', findings: [{ category: 'possible_phone_or_email', confidence: 0.5, explanation: 'Shows 555-123-4567.', riskLevel: 'high' }] }] }],
  ['serial output', { attachments: [{ attachmentId: 'photo-1', findings: [{ category: 'possible_serial_or_nameplate', confidence: 0.5, explanation: 'Shows AB1234567.', riskLevel: 'high' }] }] }],
  ['private known value', { attachments: [{ attachmentId: 'photo-1', findings: [{ category: 'possible_address', confidence: 0.5, explanation: 'Shows 123 Market Street.', riskLevel: 'high' }] }] }],
  ['too many findings', { attachments: [{ attachmentId: 'photo-1', findings: Array.from({ length: 7 }, () => ({ category: 'unclear', confidence: 0.5, explanation: 'Unclear image.', riskLevel: 'low' })) }] }],
];
for (const [label, override] of invalidPayloads) {
  assert.throws(() => validateProviderPayloadShape(providerPayload(override), context), /MEDIA_INVALID_PROVIDER_OUTPUT|MEDIA_PRIVACY_VALIDATION_FAILED/, label);
}

const safeFindingPayloads = [
  ['equipment overview', { category: 'equipment_overview', confidence: 0.73, explanation: 'Could be useful as an equipment overview.', riskLevel: 'low' }],
  ['possible problem detail without diagnosis', { category: 'possible_problem_detail', confidence: 0.61, explanation: 'Possible area for technician review near the connection.', riskLevel: 'medium' }],
  ['pipe dimensions', { category: 'equipment_overview', confidence: 0.54, explanation: 'Pipe sizes may include 1/2 and 3/4 inch sections.', riskLevel: 'low' }],
  ['temperature and pressure values', { category: 'equipment_overview', confidence: 0.44, explanation: 'May show gauge context around 72F and 120 psi.', riskLevel: 'low' }],
  ['confidence decimal wording', { category: 'unclear', confidence: 0.42, explanation: 'Confidence is limited because part of the equipment is unclear.', riskLevel: 'low' }],
  ['possible serial without transcription', { category: 'possible_serial_or_nameplate', confidence: 0.52, explanation: 'May contain a serial or nameplate.', riskLevel: 'medium' }],
  ['possible screen without OCR', { category: 'possible_screen', confidence: 0.48, explanation: 'Possible screen visible. Review for identifying information.', riskLevel: 'medium' }],
  ['generic pipe wording', { category: 'equipment_overview', confidence: 0.66, explanation: 'Pipe and equipment connection may be useful for manual review.', riskLevel: 'low' }],
];
for (const [label, finding] of safeFindingPayloads) {
  const safePayload = providerPayload({ attachments: [{ attachmentId: 'photo-1', findings: [finding] }] });
  const parsedSafe = validateProviderPayloadShape(safePayload, context);
  assert.equal(parsedSafe.attachments[0].findings[0].category, finding.category, `${label} should pass`);
}

const unsafeFindingPayloads = [
  ['known customer name', { category: 'possible_personal_identifier', confidence: 0.5, explanation: 'Shows Jane Customer.', riskLevel: 'high' }, 'KNOWN_PRIVATE_VALUE_MATCH'],
  ['organization', { category: 'possible_customer_document', confidence: 0.5, explanation: 'Shows Private Org.', riskLevel: 'high' }, 'KNOWN_PRIVATE_VALUE_MATCH'],
  ['email', { category: 'possible_phone_or_email', confidence: 0.5, explanation: 'Shows jane@example.test.', riskLevel: 'high' }, 'EMAIL_PATTERN'],
  ['phone', { category: 'possible_phone_or_email', confidence: 0.5, explanation: 'Shows 555-123-4567.', riskLevel: 'high' }, 'PHONE_PATTERN'],
  ['full address', { category: 'possible_address', confidence: 0.5, explanation: 'Shows 123 Market Street.', riskLevel: 'high' }, 'ADDRESS_PATTERN'],
  ['long serial digits', { category: 'possible_serial_or_nameplate', confidence: 0.5, explanation: 'Serial number may be 123456789.', riskLevel: 'high' }, 'LONG_DIGIT_SEQUENCE'],
  ['barcode transcription', { category: 'possible_barcode', confidence: 0.5, explanation: 'Barcode reads 9876543210.', riskLevel: 'high' }, 'OCR_LIKE_TRANSCRIPTION'],
  ['ocr sentence', { category: 'possible_screen', confidence: 0.5, explanation: 'Screen says service code ready.', riskLevel: 'high' }, 'OCR_LIKE_TRANSCRIPTION'],
  ['confirmed brand model serial', { category: 'possible_serial_or_nameplate', confidence: 0.5, explanation: 'Model is XR95 and serial number is AB1234567.', riskLevel: 'high' }, 'FORBIDDEN_CONFIRMED_IDENTITY'],
  ['diagnosis', { category: 'possible_problem_detail', confidence: 0.5, explanation: 'Diagnosed a failed compressor.', riskLevel: 'high' }, 'FORBIDDEN_DIAGNOSTIC_CLAIM'],
  ['repair success', { category: 'finished_result', confidence: 0.5, explanation: 'Repair completed and verified operation.', riskLevel: 'high' }, 'FORBIDDEN_DIAGNOSTIC_CLAIM'],
];
for (const [label, finding, subreason] of unsafeFindingPayloads) {
  const error = assert.throws(() => validateProviderPayloadShape(providerPayload({ attachments: [{ attachmentId: 'photo-1', findings: [finding] }] }), context), /MEDIA_PRIVACY_VALIDATION_FAILED/);
  assert.equal(error.code, 'MEDIA_PRIVACY_VALIDATION_FAILED', `${label} should fail privacy validation`);
  assert.equal(error.details.privacyDiagnostics[0].subreason, subreason, `${label} should report safe subreason`);
  assert.equal(error.details.privacyDiagnostics[0].path, '$.attachments[0].findings[0].explanation');
  assert.equal(error.details.privacyDiagnostics[0].attachmentId, 'photo-1');
  assert.equal(error.details.privacyDiagnostics[0].findingCategory, finding.category);
  assert.doesNotMatch(JSON.stringify(error.details.privacyDiagnostics), /Jane Customer|Private Org|jane@example|123 Market|123456789|AB1234567|failed compressor|Repair completed/i);
}

assert.deepEqual(buildKnownPrivateValues(['', null, 0, '0', 'in', 'job', 'open', 'Completed', 'Appliance', 'pipe', '120']), []);
assert.deepEqual(buildKnownPrivateValues(['Jane Customer', 'Private Org', '123 Market Street']).sort(), ['123 Market Street', 'Jane Customer', 'Private Org'].sort());
assertNoPrivateValues('Open pipe and equipment overview.', ['', null, 0, '0', 'in', 'job', 'open', 'Completed', 'Appliance', 'pipe', '120']);
assert.throws(() => assertNoPrivateValues('Technician noted jane customer near paperwork.', ['Jane Customer']), /MEDIA_PRIVACY_VALIDATION_FAILED/);
assert.throws(() => assertNoPrivateValues('Technician noted JANE CUSTOMER near paperwork.', ['Jane Customer']), /MEDIA_PRIVACY_VALIDATION_FAILED/);
assert.throws(() => assertNoPrivateValues('Technician noted Jane-Customer near paperwork.', ['Jane Customer']), /MEDIA_PRIVACY_VALIDATION_FAILED/);
const safeDiagnostics = collectPrivacyDiagnostics('Screen says service code ready.', ['Jane Customer'], { path: '$.attachments[0].findings[0].explanation', attachmentId: 'photo-1', findingCategory: 'possible_screen' });
assert.equal(safeDiagnostics[0].subreason, 'OCR_LIKE_TRANSCRIPTION');
assert.deepEqual(Object.keys(safeDiagnostics[0]).sort(), ['attachmentId', 'detector', 'findingCategory', 'path', 'patternClass', 'stringLengthBucket', 'subreason'].sort());
assert.doesNotMatch(JSON.stringify(safeDiagnostics), /service code ready|Jane Customer/i);

const prompt = buildMediaPrompt({ request: validated, context, mediaInputs: [{ attachmentId: 'photo-1', mimeType: 'image/jpeg' }] });
assert.match(prompt, /suggestions, not facts/);
assert.match(prompt, /Never diagnose equipment/);
assert.match(prompt, /Do not transcribe visible private text/);
assert.match(prompt, /Every finding requires user review/);
assert.doesNotMatch(prompt, /Jane Customer|123 Market|JOB-74|Gate code/);

const openAiRequest = buildOpenAiMediaRequest({
  model: 'gpt-4.1-mini',
  providerRequest: {
    request: { analysisMode: validated.analysisMode },
    context: { status: context.status },
    mediaInputs: [
      { attachmentId: 'photo-1', mimeType: 'image/jpeg', imageUrl: 'https://signed.example.test/photo-1?token=secret' },
    ],
  },
});
assert.equal(openAiRequest.model, 'gpt-4.1-mini');
assert.equal(openAiRequest.text.format.type, 'json_schema');
assert.equal(openAiRequest.text.format.strict, true);
assert.equal(openAiRequest.input[0].content.filter((item) => item.type === 'input_image').length, 1);
assert.match(JSON.stringify(openAiRequest), /https:\/\/signed\.example\.test/);

const openAiProvider = createOpenAiMediaProvider({
  apiKey: 'server-only-key',
  model: 'gpt-4.1-mini',
  async fetchImpl(url, init) {
    assert.match(url, /api\.openai\.com\/v1\/responses/);
    assert.match(init.headers.Authorization, /server-only-key/);
    const body = JSON.parse(init.body);
    assert.equal(body.text.format.name, 'service_scope_media_analysis_v1');
    assert.equal(body.text.format.strict, true);
    assert.equal(body.input[0].content.filter((item) => item.type === 'input_image').length, 1);
    return mockResponse(200, {
      status: 'completed',
      output_text: JSON.stringify(providerPayload()),
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });
  },
});
const openAiResult = await openAiProvider.analyze({
  request: { analysisMode: validated.analysisMode },
  context: { status: context.status },
  mediaInputs: [{ attachmentId: 'photo-1', mimeType: 'image/jpeg', imageUrl: 'https://signed.example.test/photo-1?token=secret' }],
}, { signal: new AbortController().signal });
assert.equal(openAiResult.provider, 'openai');
assert.equal(openAiResult.model, 'gpt-4.1-mini');
assert.equal(openAiResult.usage.totalTokens, 15);

assert.match(extractResponsesOutputText({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(providerPayload()) }] }] }, 'req-nested'), /media-analysis-provider-output-v1/);
await assert.rejects(() => Promise.resolve(extractResponsesOutputText({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }, 'req-refusal')), /MEDIA_REFUSAL/);
await assert.rejects(() => Promise.resolve(extractResponsesOutputText({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 'req-incomplete')), /MEDIA_ANALYSIS_INCOMPLETE/);
await assert.rejects(() => Promise.resolve(extractResponsesOutputText({ status: 'completed', output: [] }, 'req-empty')), /MEDIA_INVALID_PROVIDER_OUTPUT/);

const malformedProvider = createOpenAiMediaProvider({
  apiKey: 'server-only-key',
  model: 'gpt-4.1-mini',
  async fetchImpl() {
    return mockResponse(200, { status: 'completed', output_text: '{"schemaVersion":' });
  },
});
await assert.rejects(() => malformedProvider.analyze({
  request: { analysisMode: validated.analysisMode },
  context: { status: context.status },
  mediaInputs: [{ attachmentId: 'photo-1', mimeType: 'image/jpeg', imageUrl: 'https://signed.example.test/photo-1?token=secret' }],
}, { signal: new AbortController().signal }), /MEDIA_INVALID_PROVIDER_OUTPUT/);

const providerMappings = [
  { status: 401, body: { error: { type: 'invalid_request_error', code: 'invalid_api_key' } }, code: 'MEDIA_PROVIDER_AUTH_FAILED', retryable: false },
  { status: 403, body: { error: { type: 'insufficient_permissions', code: 'access_denied' } }, code: 'MEDIA_PROVIDER_ACCESS_DENIED', retryable: false },
  { status: 429, body: { error: { type: 'insufficient_quota', code: 'insufficient_quota' } }, code: 'MEDIA_PROVIDER_QUOTA_EXCEEDED', retryable: false },
  { status: 429, body: { error: { type: 'rate_limit_exceeded', code: 'rate_limit_exceeded' } }, code: 'MEDIA_PROVIDER_RATE_LIMITED', retryable: true },
  { status: 500, body: { error: { type: 'server_error', code: 'server_error' } }, code: 'MEDIA_PROVIDER_UNAVAILABLE', retryable: true },
];
for (const row of providerMappings) {
  const mappedError = mapOpenAiMediaError(mockResponse(row.status), row.body);
  assert.equal(mappedError.code, row.code);
  assert.equal(mappedError.retryable, row.retryable);
  assert.equal(mappedError.httpStatus, row.status);
  assert.equal(mappedError.providerRequestId, 'req-test');
}

for (const row of providerMappings.filter((item) => !item.retryable)) {
  let calls = 0;
  const result = await handleMediaAnalysis(makeDependencies({
    provider: {
      id: 'mock-media-provider',
      async analyze() {
        calls += 1;
        throw mapOpenAiMediaError(mockResponse(row.status), row.body);
      },
    },
    config: { maxAttempts: 3 },
  }));
  assert.equal(calls, 1, `${row.code} should not be retried`);
  assert.equal(result.provider, 'deterministic-fallback');
  assert.match(result.warnings.map((warning) => warning.code).join(','), new RegExp(row.code));
}

let retryCalls = 0;
const retried = await handleMediaAnalysis(makeDependencies({
  provider: {
    id: 'mock-media-provider',
    async analyze() {
      retryCalls += 1;
      if (retryCalls === 1) throw new MediaAnalysisError('MEDIA_PROVIDER_RATE_LIMITED', { retryable: true, httpStatus: 429 });
      return providerRawResult(providerPayload());
    },
  },
  config: { maxAttempts: 2 },
}));
assert.equal(retryCalls, 2);
assert.equal(retried.provider, 'mock-media-provider');

const refusalFallback = await handleMediaAnalysis(makeDependencies({
  provider: { id: 'mock-media-provider', async analyze() { throw new MediaAnalysisError('MEDIA_REFUSAL', { retryable: false }); } },
}));
assert.equal(refusalFallback.provider, 'deterministic-fallback');
assert.match(refusalFallback.warnings.map((warning) => warning.code).join(','), /MEDIA_REFUSAL/);

const incompleteFallback = await handleMediaAnalysis(makeDependencies({
  provider: { id: 'mock-media-provider', async analyze() { throw new MediaAnalysisError('MEDIA_ANALYSIS_INCOMPLETE', { retryable: false }); } },
}));
assert.equal(incompleteFallback.provider, 'deterministic-fallback');
assert.match(incompleteFallback.warnings.map((warning) => warning.code).join(','), /MEDIA_ANALYSIS_INCOMPLETE/);

const unsafeTelemetryEvents = [];
let unsafeOutputProviderCalls = 0;
const unsafeOutputFallback = await handleMediaAnalysis(makeDependencies({
  payload: {
    ...basePayload,
    idempotencyKey: '00000000-0000-4000-8000-000000000374:media:1785201639885:090cc74b-4ada-4581-b776-fb533b7a8c2e',
  },
  telemetry: { record: (event) => unsafeTelemetryEvents.push(event) },
  provider: {
    id: 'mock-media-provider',
    async analyze() {
      unsafeOutputProviderCalls += 1;
      return providerRawResult(providerPayload({
        attachments: [{
          attachmentId: 'photo-1',
          findings: [{
            category: 'possible_phone_or_email',
            confidence: 0.5,
            explanation: 'Shows boundary-private@example.test.',
            riskLevel: 'high',
          }],
        }],
      }));
    },
  },
}));
assert.equal(unsafeOutputProviderCalls, 1);
assert.equal(unsafeOutputFallback.provider, 'deterministic-fallback');
assert.match(unsafeOutputFallback.warnings.map((warning) => warning.code).join(','), /MEDIA_INVALID_PROVIDER_OUTPUT|MEDIA_PRIVACY_VALIDATION_FAILED/);
assert.equal(unsafeOutputFallback.attachments[0].visualAnalysisPerformed, false);
assert.deepEqual(unsafeOutputFallback.attachments.flatMap((item) => item.findings), []);
assert.equal(unsafeTelemetryEvents[0].privacyDiagnostics[0].subreason, 'EMAIL_PATTERN');
assert.deepEqual(Object.keys(unsafeTelemetryEvents[0].privacyDiagnostics[0]).sort(), ['attachmentId', 'detector', 'findingCategory', 'path', 'patternClass', 'stringLengthBucket', 'subreason'].sort());
assert.doesNotMatch(JSON.stringify(unsafeTelemetryEvents[0]), /boundary-private|Jane Customer|Private Org|prompt|response|signed|token/i);

let videoOnlyCalls = 0;
const videoOnly = await handleMediaAnalysis(makeDependencies({
  payload: { ...basePayload, attachmentIds: ['video-1'] },
  provider: { id: 'mock-media-provider', async analyze() { videoOnlyCalls += 1; return providerRawResult(providerPayload()); } },
}));
assert.equal(videoOnlyCalls, 0);
assert.equal(videoOnly.attachments[0].status, 'video_analysis_not_supported_v1');
assert.equal(videoOnly.attachments[0].visualAnalysisPerformed, false);

const sharedGuards = createMemoryGuards();
let idempotentCalls = 0;
const idempotentProvider = {
  id: 'mock-media-provider',
  async analyze() {
    idempotentCalls += 1;
    return providerRawResult(providerPayload());
  },
};
await handleMediaAnalysis(makeDependencies({ guards: sharedGuards, provider: idempotentProvider, config: { providerId: 'mock-media-provider', model: 'mock-media-model' } }));
await handleMediaAnalysis(makeDependencies({ guards: sharedGuards, provider: idempotentProvider, config: { providerId: 'mock-media-provider', model: 'mock-media-model' } }));
assert.equal(idempotentCalls, 1);
await handleMediaAnalysis(makeDependencies({
  guards: sharedGuards,
  provider: idempotentProvider,
  config: { providerId: 'mock-media-provider', model: 'mock-media-model' },
  attachments: [
    attachment({ id: 'photo-1', created_at: '2026-07-27T00:00:00Z' }),
    attachment({ id: 'video-1', mime_type: 'video/mp4', size_bytes: 2000000, kind: 'file' }),
  ],
}));
assert.equal(idempotentCalls, 2);
const fp = mediaFingerprint({ request: validated, context, config: { providerId: 'mock-media-provider', model: 'mock-media-model' } });
assert.doesNotMatch(fp, /signed|secret|photo\.jpg|Jane Customer|123 Market|JOB-74|Gate code/);

const configured = createMediaProviderFromEnv((key) => ({
  AI_MEDIA_PROVIDER: 'openai',
  AI_MEDIA_MODEL: 'gpt-4.1-mini',
  OPENAI_API_KEY: 'server-only-key',
}[key]), async () => mockResponse(200, { status: 'completed', output_text: JSON.stringify(providerPayload()) }));
assert.equal(configured.providerId, 'openai');
assert.equal(configured.model, 'gpt-4.1-mini');
assert.ok(configured.provider);

console.log('media analysis regression checks passed');

function makeDependencies(overrides = {}) {
  const repository = makeRepository(overrides);
  return {
    rawBody: JSON.stringify(overrides.payload ?? basePayload),
    authorization: overrides.authorization ?? 'Bearer token',
    auth: overrides.auth ?? { async resolveSession() { return overrides.session ?? companySession(); } },
    repository,
    provider: overrides.provider ?? null,
    guards: overrides.guards ?? createMemoryGuards(),
    config: { providerId: 'mock-media-provider', model: 'mock-media-model', timeoutMs: 1000, maxAttempts: 1, maxOutputTokens: 900, repository, ...(overrides.config ?? {}) },
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
    async createSignedMediaUrl(item) {
      if (overrides.repositoryOverrides?.createSignedMediaUrl) return overrides.repositoryOverrides.createSignedMediaUrl(item);
      return `https://signed.example.test/${item.id}?token=secret`;
    },
    ...(overrides.repositoryOverrides ?? {}),
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
    created_at: overrides.created_at ?? '2026-07-26T00:00:00Z',
    updated_at: overrides.updated_at,
  };
}

async function assertNoProviderCall(_label, overrides, pattern) {
  let called = false;
  await assert.rejects(() => handleMediaAnalysis(makeDependencies({
    ...overrides,
    provider: { id: 'mock-media-provider', async analyze() { called = true; return providerRawResult(providerPayload()); } },
  })), pattern);
  assert.equal(called, false);
}

function providerRawResult(payload) {
  return { provider: 'mock-media-provider', model: 'mock-media-model', rawJson: payload, usage: { totalTokens: 1 } };
}

function providerPayload(overrides = {}) {
  return {
    schemaVersion: 'media-analysis-provider-output-v1',
    attachments: [
      {
        attachmentId: 'photo-1',
        findings: [
          { category: 'equipment_overview', confidence: 0.73, explanation: 'Could be useful as an overview.', riskLevel: 'low' },
          { category: 'possible_serial_or_nameplate', confidence: 0.42, explanation: 'May contain a serial or nameplate.', riskLevel: 'medium' },
        ],
      },
    ],
    recommendations: ['Review findings before using selected photos.'],
    missingShots: ['Finished result photo may be useful if available.'],
    ...overrides,
  };
}

function mediaAnalysisResultFixture() {
  return {
    schemaVersion: 'media-analysis-result-v1',
    analysisVersion: 'media-analysis-v1',
    analysisMode: 'media_review',
    jobId: 'job-1',
    provider: 'mock-media-provider',
    model: 'mock-media-model',
    requiresUserApproval: true,
    attachments: [
      {
        id: 'photo-1',
        kind: 'photo',
        mimeType: 'image/jpeg',
        sizeBytes: 500000,
        status: 'analyzed',
        visualAnalysisPerformed: true,
        manualReviewRequired: true,
        findings: [
          {
            findingId: 'finding-1',
            evidenceType: 'visual_suggestion',
            category: 'equipment_overview',
            confidence: 0.73,
            explanation: 'Could be useful as an overview.',
            riskLevel: 'low',
            requiresUserApproval: true,
          },
          {
            findingId: 'finding-2',
            evidenceType: 'privacy_risk_suggestion',
            category: 'possible_serial_or_nameplate',
            confidence: 0.42,
            explanation: 'May contain a serial or nameplate.',
            riskLevel: 'medium',
            requiresUserApproval: true,
          },
        ],
      },
      {
        id: 'video-1',
        kind: 'video',
        mimeType: 'video/mp4',
        sizeBytes: 2000000,
        status: 'video_analysis_not_supported_v1',
        visualAnalysisPerformed: false,
        manualReviewRequired: true,
        findings: [],
      },
    ],
    recommendations: ['Review findings before using selected photos.'],
    missingShots: ['Finished result photo may be useful if available.'],
    warnings: [],
    safety: { ok: true, privacy: 'passed', grounding: 'passed', blockedReasons: [] },
    telemetry: { correlationId: 'request-1', attempts: 1, latencyMs: 1 },
  };
}

function classificationFinding(category) {
  return {
    category,
    confidence: 0.52,
    explanation: 'May require manual review before use.',
    riskLevel: privacyFindingCategories.includes(category) ? 'high' : 'low',
  };
}

function createDurableClassificationCapture(runId = '00000000-0000-4000-8000-000000008900') {
  const privacyCategorySet = new Set(privacyFindingCategories);
  const capture = {
    persisted: false,
    attachmentResults: [],
    privacyFindings: [],
    repositoryOverrides: {
      async recordMediaAnalysisResult({ result }) {
        capture.persisted = true;
        for (const [index, item] of result.attachments.entries()) {
          if (item.kind !== 'photo') continue;
          const attachmentResultId = `00000000-0000-4000-8000-${String(8901 + index).padStart(12, '0')}`;
          const privacyFindings = (item.findings ?? []).filter((finding) => privacyCategorySet.has(finding.category));
          capture.attachmentResults.push({
            attachment_id: item.id,
            analysis_run_id: runId,
            attachment_result_id: attachmentResultId,
            privacy_review_status: privacyFindings.length ? 'blocked' : 'passed',
          });
          for (const finding of privacyFindings) {
            capture.privacyFindings.push({
              attachment_id: item.id,
              finding_id: finding.findingId,
              finding_category: finding.category,
            });
          }
          item.analysisRunId = runId;
          item.attachmentResultId = attachmentResultId;
        }
      },
    },
  };
  return capture;
}

function mockResponse(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (String(name).toLowerCase() === 'x-request-id' ? 'req-test' : undefined) },
    async json() { return body; },
  };
}
