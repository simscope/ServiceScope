import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  MetaPublishingError,
  ACTIVE_PUBLICATION_INDEX,
  mapActivePublicationPersistenceError,
  normalizeScheduledPublicationTime,
  parsePublishingRequest,
  runtimePublishingConfig,
} from '../supabase/functions/_shared/meta-publishing/contracts.js';
import { handleMetaPublishing } from '../supabase/functions/_shared/meta-publishing/service.js';

const compiledRoot = process.env.META_PUBLISHING_COMPILED_ROOT;
if (!compiledRoot) throw new Error('META_PUBLISHING_COMPILED_ROOT is required');
const workspace = await import(pathToFileURL(join(compiledRoot, 'workspaceState.js')).href);
const browserContracts = await import(pathToFileURL(join(compiledRoot, 'contracts.js')).href);

const ids = {
  company: '00000000-0000-4000-8000-000000009001',
  otherCompany: '00000000-0000-4000-8000-000000009002',
  actor: '00000000-0000-4000-8000-000000009003',
  job: '00000000-0000-4000-8000-000000009004',
  otherJob: '00000000-0000-4000-8000-000000009005',
  connection: '00000000-0000-4000-8000-000000009006',
  attachment: '00000000-0000-4000-8000-000000009007',
  analysisRun: '00000000-0000-4000-8000-000000009008',
  attachmentResult: '00000000-0000-4000-8000-000000009009',
  approval: '00000000-0000-4000-8000-000000009010',
};
const nowMs = Date.parse('2026-08-08T12:00:00.000Z');
const scheduledFor = '2026-08-09T15:30:00.000Z';
const timezone = 'America/New_York';
const jwt = 'synthetic-header.synthetic-payload.synthetic-signature';
const config = runtimePublishingConfig((key) => ({
  META_GRAPH_API_VERSION: 'v25.0',
  META_APP_SECRET: 'test-app-secret',
  META_TOKEN_ENCRYPTION_KEY_V1: Buffer.alloc(32, 12).toString('base64'),
}[key] ?? ''));

let checks = 0;
const check = (fn) => { fn(); checks += 1; };
const checkAsync = async (fn) => { await fn(); checks += 1; };

contractChecks();
workspaceChecks();
await scheduleServiceChecks();
await cancellationAndStatusChecks();
await sourceChecks();

console.log(`Meta scheduled UI/API regression checks passed: ${checks}`);

function contractChecks() {
  for (const body of [scheduleTextRequest(), schedulePhotoRequest(), cancelRequest(ids.approval)]) {
    check(() => assert.equal(parsePublishingRequest(JSON.stringify(body)).action, body.action));
  }
  for (const forbidden of [
    ['connectionId', ids.connection],
    ['pageId', '10001'],
    ['facebookPageId', '10001'],
    ['attachmentSha256', 'not-browser-owned'],
    ['analysisRunId', ids.analysisRun],
    ['attachmentResultId', ids.attachmentResult],
    ['approvalId', ids.approval],
    ['claimToken', ids.approval],
    ['executionAttempts', 0],
  ]) {
    check(() => assert.throws(
      () => parsePublishingRequest(JSON.stringify({ ...scheduleTextRequest(), [forbidden[0]]: forbidden[1] })),
      /INVALID_REQUEST/,
    ));
  }
  check(() => assert.throws(
    () => parsePublishingRequest(JSON.stringify({ ...cancelRequest(ids.approval), jobId: ids.job })),
    /INVALID_REQUEST/,
  ));
  check(() => assert.deepEqual(
    normalizeScheduledPublicationTime(scheduledFor, timezone, nowMs),
    { scheduledFor, scheduledTimezone: timezone },
  ));
  for (const [value, zone] of [
    ['invalid', timezone],
    [new Date(nowMs).toISOString(), timezone],
    [new Date(nowMs - 1).toISOString(), timezone],
    [new Date(nowMs + 367 * 24 * 60 * 60 * 1000).toISOString(), timezone],
    [scheduledFor, 'Mars/Olympus'],
    [scheduledFor, 'America/../New_York'],
    [scheduledFor, 'America/New_York\n'],
  ]) {
    check(() => assert.throws(() => normalizeScheduledPublicationTime(value, zone, nowMs), /INVALID_REQUEST/));
  }
  check(() => assert.equal(browserContracts.facebookScheduledForUtc('2026-08-09T11:30')?.endsWith('Z'), true));
  check(() => assert.equal(browserContracts.facebookScheduledForUtc('invalid'), null));
  check(() => assert.ok(browserContracts.formatFacebookScheduledTime(scheduledFor, timezone)));

  const exactConflict = mapActivePublicationPersistenceError({
    code: '23505',
    message: `duplicate key value violates unique constraint "${ACTIVE_PUBLICATION_INDEX}"`,
    details: 'private database collision detail',
  });
  check(() => assert.equal(exactConflict?.code, 'META_PUBLICATION_ACTIVE_CONFLICT'));
  check(() => assert.equal(exactConflict?.status, 409));
  check(() => assert.equal(exactConflict?.message, 'META_PUBLICATION_ACTIVE_CONFLICT'));
  check(() => assert.doesNotMatch(JSON.stringify({ code: exactConflict?.code }), /constraint|collision|database/i));
  check(() => assert.equal(mapActivePublicationPersistenceError({
    code: '23505',
    message: 'duplicate key value violates unique constraint "company_social_publications_company_intent_unique"',
  }), null));
  check(() => assert.equal(mapActivePublicationPersistenceError({
    code: '22000',
    message: `unique constraint "${ACTIVE_PUBLICATION_INDEX}"`,
  }), null));
  check(() => assert.equal(
    browserContracts.FACEBOOK_PUBLISH_ERROR_MESSAGES.META_PUBLICATION_ACTIVE_CONFLICT,
    'Another Facebook publication for this job is already scheduled, publishing, or awaiting delivery confirmation.',
  ));
}

function workspaceChecks() {
  const opened = workspace.openFacebookPublishConfirmation(
    'Exact scheduled text', ids.approval, 'single_photo', ids.attachment, 'scheduled', scheduledFor, timezone,
  );
  check(() => assert.equal(opened.delivery, 'scheduled'));
  check(() => assert.equal(opened.approvedScheduledFor, scheduledFor));
  check(() => assert.equal(workspace.beginFacebookPublishSubmission(opened).shouldSubmit, false));
  const approved = { ...opened, approved: true };
  check(() => assert.equal(workspace.beginFacebookPublishSubmission(approved).shouldSubmit, true));
  check(() => assert.equal(workspace.beginFacebookPublishSubmission(workspace.beginFacebookPublishSubmission(approved).state).shouldSubmit, false));
  for (const args of [
    ['Changed text', 'single_photo', ids.attachment, 'scheduled', scheduledFor, timezone],
    ['Exact scheduled text', 'text_only', null, 'scheduled', scheduledFor, timezone],
    ['Exact scheduled text', 'single_photo', ids.otherJob, 'scheduled', scheduledFor, timezone],
    ['Exact scheduled text', 'single_photo', ids.attachment, 'now', null, null],
    ['Exact scheduled text', 'single_photo', ids.attachment, 'scheduled', '2026-08-10T15:30:00.000Z', timezone],
    ['Exact scheduled text', 'single_photo', ids.attachment, 'scheduled', scheduledFor, 'UTC'],
  ]) {
    check(() => assert.equal(workspace.invalidateFacebookPublishApproval(approved, ...args).confirmationOpen, false));
  }
  const immediate = workspace.openFacebookPublishConfirmation('Publish now text', ids.approval);
  check(() => assert.equal(immediate.delivery, 'now'));
  const cancellation = workspace.openFacebookScheduleCancellation({ ...approved, confirmationOpen: false });
  check(() => assert.equal(cancellation.cancelConfirmationOpen, true));
  check(() => assert.equal(workspace.beginFacebookScheduleCancellation(cancellation).shouldSubmit, false));
  check(() => assert.equal(workspace.beginFacebookScheduleCancellation({ ...cancellation, approved: true }).shouldSubmit, true));

  const optimisticSchedule = {
    ...workspace.resetFacebookPublishWorkspace(),
    result: scheduledSummary(),
    cancelConfirmationOpen: true,
    approved: true,
  };
  check(() => assert.equal(workspace.currentFacebookActiveSchedule(optimisticSchedule, publishingSnapshot(null, null))?.status, 'scheduled'));
  for (const status of ['published', 'failed', 'delivery_unknown']) {
    const terminal = {
      status,
      approvedAt: new Date(nowMs).toISOString(),
      publishedAt: status === 'published' ? new Date(nowMs + 60_000).toISOString() : null,
      errorCode: status === 'failed' ? 'META_PUBLICATION_FAILED' : status === 'delivery_unknown' ? 'META_PUBLICATION_DELIVERY_UNKNOWN' : null,
    };
    const refreshedSnapshot = publishingSnapshot(terminal, null);
    const reconciled = workspace.reconcileFacebookPublishWorkspaceFromStatus(optimisticSchedule, refreshedSnapshot);
    check(() => assert.equal(reconciled.result, null));
    check(() => assert.equal(workspace.currentFacebookPublication(reconciled, refreshedSnapshot)?.status, status));
    check(() => assert.equal(workspace.currentFacebookActiveSchedule(reconciled, refreshedSnapshot), null));
    check(() => assert.equal(reconciled.cancelConfirmationOpen, false));
  }
}

async function scheduleServiceChecks() {
  const text = await makeDependencies();
  const textResult = await invoke(text, scheduleTextRequest('  Exact scheduled text\r\nSecond line  '));
  check(() => assert.equal(textResult.status, 'scheduled'));
  check(() => assert.equal(textResult.publicationId, text.scheduledRows[0].publication_id));
  check(() => assert.equal(textResult.scheduledFor, scheduledFor));
  check(() => assert.equal(textResult.scheduledTimezone, timezone));
  check(() => assert.equal(text.scheduleInputs.length, 1));
  check(() => assert.equal(text.scheduleInputs[0].connectionId, ids.connection));
  check(() => assert.deepEqual(actorOnly(text.scheduleInputs[0]), { actorAuthUserId: ids.actor, actorName: 'Schedule Owner', actorRole: 'admin' }));
  check(() => assert.equal(text.scheduleInputs[0].message, 'Exact scheduled text\nSecond line'));
  check(() => assert.equal(text.scheduleInputs[0].publicationKind, 'text_only'));
  check(() => assert.equal(text.scheduleInputs[0].attachmentId, null));
  check(() => assert.equal(text.providerCalls, 0));
  check(() => assert.equal(text.beginCalls, 0));
  check(() => assert.equal(text.sanitizerCalls, 0));
  check(() => assert.equal(text.downloadCalls, 0));
  check(() => assert.doesNotThrow(() => JSON.stringify(textResult)));
  check(() => assert.doesNotMatch(JSON.stringify(textResult), /10001|connection|analysis|approval|sha|token/i));

  const duplicate = await invoke(text, scheduleTextRequest('  Exact scheduled text\r\nSecond line  '));
  check(() => assert.equal(duplicate.publicationId, textResult.publicationId));
  check(() => assert.equal(text.scheduleInputs.length, 2));
  check(() => assert.equal(text.scheduledRows.length, 1));
  check(() => assert.equal(text.providerCalls, 0));
  await checkAsync(() => assert.rejects(
    invoke(text, { ...scheduleTextRequest('Different concurrent schedule intent.'), idempotencyKey: ids.otherJob }),
    (error) => error?.code === 'META_PUBLICATION_ACTIVE_CONFLICT' && error?.status === 409,
  ));
  check(() => assert.equal(text.scheduledRows.length, 1));

  for (const activePublicationStatus of ['publishing', 'delivery_unknown']) {
    const conflict = await makeDependencies({ activePublicationStatus });
    await checkAsync(() => assert.rejects(
      invoke(conflict, scheduleTextRequest(`Schedule blocked by ${activePublicationStatus}.`)),
      (error) => error?.code === 'META_PUBLICATION_ACTIVE_CONFLICT' && error?.status === 409,
    ));
    check(() => assert.equal(conflict.scheduledRows.length, 1));
    check(() => assert.equal(conflict.providerCalls, 0));
  }

  const differentJob = await makeDependencies({ allowOtherJob: true });
  await invoke(differentJob, scheduleTextRequest('First job schedule.'));
  const otherJobResult = await invoke(differentJob, {
    ...scheduleTextRequest('Different job schedule.'),
    jobId: ids.otherJob,
    idempotencyKey: ids.otherJob,
  });
  check(() => assert.equal(otherJobResult.status, 'scheduled'));
  check(() => assert.equal(differentJob.scheduledRows.length, 2));

  const replacement = await makeDependencies();
  const replaced = await invoke(replacement, scheduleTextRequest('Original active schedule.'));
  await invoke(replacement, cancelRequest(replaced.publicationId));
  const replacementResult = await invoke(replacement, {
    ...scheduleTextRequest('Replacement after cancellation.'),
    idempotencyKey: ids.otherJob,
  });
  check(() => assert.equal(replacementResult.status, 'scheduled'));
  check(() => assert.equal(replacement.scheduledRows.filter((row) => row.status === 'scheduled').length, 1));

  const photo = await makeDependencies();
  const photoResult = await invoke(photo, schedulePhotoRequest());
  const expectedSha = `\\x${Buffer.from(await webcrypto.subtle.digest('SHA-256', attachmentBytes())).toString('hex')}`;
  check(() => assert.equal(photoResult.status, 'scheduled'));
  check(() => assert.equal(photo.scheduleInputs[0].publicationKind, 'single_photo'));
  check(() => assert.equal(photo.scheduleInputs[0].attachmentId, ids.attachment));
  check(() => assert.equal(photo.scheduleInputs[0].attachmentSha256, expectedSha));
  check(() => assert.equal(photo.scheduleInputs[0].analysisRunId, ids.analysisRun));
  check(() => assert.equal(photo.scheduleInputs[0].attachmentResultId, ids.attachmentResult));
  check(() => assert.equal(photo.scheduleInputs[0].approvalId, ids.approval));
  check(() => assert.equal(photo.downloadCalls, 1));
  check(() => assert.equal(photo.sanitizerCalls, 0));
  check(() => assert.equal(photo.providerCalls, 0));
  check(() => assert.equal(photo.beginCalls, 0));

  const invalidCases = [
    [{ explicitApproval: false }, {}, 'INVALID_REQUEST'],
    [{ scheduledFor: new Date(nowMs).toISOString() }, {}, 'INVALID_REQUEST'],
    [{ scheduledFor: new Date(nowMs + 367 * 24 * 60 * 60 * 1000).toISOString() }, {}, 'INVALID_REQUEST'],
    [{ scheduledTimezone: 'Invalid/Timezone' }, {}, 'INVALID_REQUEST'],
    [{ jobId: ids.otherJob }, { missingJob: true }, 'FORBIDDEN'],
    [{}, { jobStatus: 'In progress' }, 'INVALID_REQUEST'],
    [{}, { connectionStatus: 'revoked' }, 'META_CONNECTION_NEEDS_REAUTHORIZATION'],
    [{}, { missingPermission: true }, 'META_PUBLISHING_PERMISSION_MISSING'],
    [{ message: 'Contact private@example.test.' }, {}, 'META_PUBLICATION_PRIVACY_REVIEW_REQUIRED'],
  ];
  for (const [requestPatch, options, code] of invalidCases) {
    const deps = await makeDependencies(options);
    await checkAsync(() => assert.rejects(invoke(deps, { ...scheduleTextRequest(), ...requestPatch }), new RegExp(code)));
    check(() => assert.equal(deps.providerCalls, 0));
  }

  for (const options of [
    { privatePhotoName: true },
    { revokedApproval: true },
    { staleAnalysis: true },
    { checksumMismatch: true },
    { unresolvedPrivacy: true },
  ]) {
    const deps = await makeDependencies(options);
    await checkAsync(() => assert.rejects(invoke(deps, schedulePhotoRequest()), /META_PUBLICATION_MEDIA_PRIVACY_REVIEW_REQUIRED/));
    check(() => assert.equal(deps.scheduleInputs.length, 0));
    check(() => assert.equal(deps.providerCalls, 0));
  }

  const crossCompany = await makeDependencies({ allowAnyCompanyAccess: true, wrongContextCompany: true });
  await checkAsync(() => assert.rejects(invoke(crossCompany, scheduleTextRequest()), /FORBIDDEN/));
}

async function cancellationAndStatusChecks() {
  const deps = await makeDependencies();
  const scheduled = await invoke(deps, scheduleTextRequest());
  const status = await invoke(deps, { action: 'status', companyId: ids.company, jobId: ids.job });
  check(() => assert.equal(status.lastPublication.status, 'scheduled'));
  check(() => assert.equal(status.activeScheduledPublication.status, 'scheduled'));
  check(() => assert.equal(status.activeScheduledPublication.publicationId, scheduled.publicationId));
  check(() => assert.deepEqual(
    Object.keys(status.activeScheduledPublication).sort(),
    ['errorCode', 'publicationId', 'publicationKind', 'scheduledFor', 'scheduledTimezone', 'status'].sort(),
  ));
  check(() => assert.equal(status.lastPublication.publicationId, scheduled.publicationId));
  check(() => assert.equal(status.lastPublication.scheduledFor, scheduledFor));
  check(() => assert.equal(status.lastPublication.scheduledTimezone, timezone));
  check(() => assert.equal(status.lastPublication.publicationKind, 'text_only'));
  check(() => assert.doesNotMatch(JSON.stringify(status), /10001|analysisRun|attachmentResult|approvalId|sha256|token_envelope/i));

  const cancelled = await invoke(deps, cancelRequest(scheduled.publicationId));
  check(() => assert.equal(cancelled.status, 'cancelled'));
  check(() => assert.deepEqual(actorOnly(deps.cancelInputs[0]), { actorAuthUserId: ids.actor, actorName: 'Schedule Owner', actorRole: 'admin' }));
  const cancelledStatus = await invoke(deps, { action: 'status', companyId: ids.company, jobId: ids.job });
  check(() => assert.equal(cancelledStatus.lastPublication.status, 'cancelled'));
  check(() => assert.equal(cancelledStatus.lastPublication.publicationId, null));
  check(() => assert.equal(cancelledStatus.activeScheduledPublication, null));

  const newerTerminal = await makeDependencies();
  const stillActive = await invoke(newerTerminal, scheduleTextRequest());
  newerTerminal.scheduledRows.push({
    ...newerTerminal.scheduledRows[0],
    id: ids.otherJob,
    publication_id: ids.otherJob,
    status: 'published',
    scheduled_for: null,
    scheduled_timezone: null,
    published_at: new Date(nowMs + 120_000).toISOString(),
    provider_post_id: 'must-not-leak',
    token_envelope: 'must-not-leak',
  });
  const mixedStatus = await invoke(newerTerminal, { action: 'status', companyId: ids.company, jobId: ids.job });
  check(() => assert.equal(mixedStatus.lastPublication.status, 'published'));
  check(() => assert.equal(mixedStatus.activeScheduledPublication.status, 'scheduled'));
  check(() => assert.equal(mixedStatus.activeScheduledPublication.publicationId, stillActive.publicationId));
  check(() => assert.doesNotMatch(JSON.stringify(mixedStatus.activeScheduledPublication), /page|connection|analysis|result|approval|sha|claim|token|provider/i));

  const changed = await makeDependencies();
  const changedSchedule = await invoke(changed, scheduleTextRequest());
  changed.scheduledRows[0].status = 'publishing';
  await checkAsync(() => assert.rejects(invoke(changed, cancelRequest(changedSchedule.publicationId)), /META_SCHEDULE_CANCELLATION_UNAVAILABLE/));

  const otherCompany = await makeDependencies({ allowAnyCompanyAccess: true });
  const otherSchedule = await invoke(otherCompany, scheduleTextRequest());
  await checkAsync(() => assert.rejects(
    invoke(otherCompany, { ...cancelRequest(otherSchedule.publicationId), companyId: ids.otherCompany }),
    /FORBIDDEN/,
  ));
  check(() => assert.equal(otherCompany.providerCalls, 0));
}

async function sourceChecks() {
  const [service, edge, client, panel, workspaceSource, sharedContracts] = await Promise.all([
    readFile(new URL('../supabase/functions/_shared/meta-publishing/service.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/meta-social-publish/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/meta-publishing/clientApi.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/portal/FacebookPublishPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/meta-publishing/workspaceState.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/_shared/meta-publishing/contracts.js', import.meta.url), 'utf8'),
  ]);
  const scheduleClient = client.slice(client.indexOf('export function scheduleFacebookText'));
  check(() => assert.match(scheduleClient, /action: 'schedule_facebook_text'/));
  check(() => assert.match(scheduleClient, /action: 'schedule_facebook_single_photo'/));
  check(() => assert.match(scheduleClient, /action: 'cancel_facebook_scheduled_publication'/));
  check(() => assert.doesNotMatch(scheduleClient, /connectionId|pageId|analysisRunId|attachmentResultId|approvalId|sha256|token|SUPABASE_SECRET_KEYS|vault/i));
  check(() => assert.match(service, /schedulePublication/));
  check(() => assert.match(service, /deriveFacebookPublicationPhotoScheduleEvidence/));
  check(() => assert.ok(service.indexOf("if (scheduledAction)") < service.indexOf("stage = 'decrypt_connection'")));
  const scheduleBranch = service.slice(service.indexOf('if (scheduledAction)'), service.indexOf("stage = 'decrypt_connection'"));
  check(() => assert.doesNotMatch(scheduleBranch, /publishText|publishSinglePhoto|beginPublication|decryptTokenBundle/));
  check(() => assert.match(edge, /schedule_company_facebook_publication/));
  check(() => assert.match(edge, /cancel_scheduled_company_facebook_publication/));
  check(() => assert.match(edge, /mapActivePublicationPersistenceError\(error\)/));
  check(() => assert.match(edge, /name === 'begin_company_facebook_publication'[\s\S]*mapActivePublicationPersistenceError\(error\)/));
  check(() => assert.match(edge, /name === 'schedule_company_facebook_publication'[\s\S]*mapActivePublicationPersistenceError\(error\)/));
  check(() => assert.doesNotMatch(edge, /error\.(message|details|hint)[\s\S]{0,120}jsonResponse/));
  check(() => assert.match(edge, /activeScheduledPublication/));
  check(() => assert.match(edge, /\.eq\('company_id', companyId\)[\s\S]*\.eq\('status', 'scheduled'\)/));
  check(() => assert.match(edge, /activeScheduleQuery = activeScheduleQuery\.eq\('job_id', jobId\)/));
  check(() => assert.match(sharedContracts, /activeScheduledPublication: safeActiveScheduledPublication/));
  check(() => assert.match(sharedContracts, /function safeActiveScheduledPublication/));
  check(() => assert.doesNotMatch(panel, /providerPostId|providerMediaId|facebookPageId|connectionId|analysisRunId|attachmentResultId|approvalId|sha256|token_envelope/));
  check(() => assert.match(panel, /Publish now/));
  check(() => assert.match(panel, /Schedule for later/));
  check(() => assert.match(panel, /Schedule publication/));
  check(() => assert.match(panel, /Scheduling\.\.\./));
  check(() => assert.match(panel, /I reviewed the exact final text, media and scheduled time and approve scheduling this Facebook publication\./));
  check(() => assert.match(panel, /Cancel scheduled publication/));
  check(() => assert.match(panel, /FACEBOOK_STATUS_REFRESH_MS = 45_000/));
  check(() => assert.match(panel, /window\.setTimeout\(refreshStatus, FACEBOOK_STATUS_REFRESH_MS\)/));
  check(() => assert.match(panel, /window\.clearTimeout\(timeoutId\)/));
  check(() => assert.match(panel, /reconcileFacebookPublishWorkspaceFromStatus/));
  check(() => assert.match(workspaceSource, /result: null/));
  const pollingSource = panel.slice(panel.indexOf('const refreshStatus = async'), panel.indexOf('function openConfirmation'));
  check(() => assert.equal((pollingSource.match(/loadFacebookPublishingStatus/g) ?? []).length, 1));
  check(() => assert.doesNotMatch(pollingSource, /scheduleFacebook|cancelFacebook|publishFacebook|provider|decrypt/i));
  const cancelSource = panel.slice(panel.indexOf('async function cancelScheduledPublication'), panel.indexOf('const durableScheduledTime'));
  check(() => assert.equal((cancelSource.match(/cancelFacebookScheduledPublication/g) ?? []).length, 1));
  check(() => assert.match(cancelSource, /catch \(error\)[\s\S]*loadFacebookPublishingStatus/));
  check(() => assert.doesNotMatch(cancelSource, /while\s*\(|setTimeout|setInterval/));
  const submissionSource = panel.slice(panel.indexOf('async function submitPublication'), panel.indexOf('async function cancelScheduledPublication'));
  check(() => assert.match(submissionSource, /META_PUBLICATION_ACTIVE_CONFLICT/));
  check(() => assert.equal((submissionSource.match(/loadFacebookPublishingStatus/g) ?? []).length, 1));
  check(() => assert.doesNotMatch(submissionSource, /while\s*\(|setTimeout|setInterval|retry/i));
}

async function makeDependencies(options = {}) {
  const connection = {
    id: ids.connection,
    company_id: ids.company,
    status: options.connectionStatus ?? 'connected',
    facebook_page_id: '10001',
    facebook_page_name: 'ServiceScope',
    granted_scopes: options.missingPermission ? ['pages_show_list'] : ['pages_show_list', 'pages_manage_posts'],
    token_envelope: { intentionallyInvalid: true },
  };
  const context = options.missingJob ? null : {
    job: {
      id: ids.job,
      company_id: options.wrongContextCompany ? ids.otherCompany : ids.company,
      status: options.jobStatus ?? 'Completed',
      job_number: 'JOB-PR3',
      notes: '',
      service_call_fee_cents: 0,
      labor_cents: 0,
    },
    connection,
    customer: { organization: '', primary_name: '', primary_email: 'private@example.test', primary_phone: '', notes: '' },
    location: { address: '' },
    invoices: [],
    comments: [],
  };
  const photo = {
    id: ids.attachment,
    company_id: ids.company,
    job_id: ids.job,
    name: options.privatePhotoName ? 'private@example.test' : 'approved-photo.jpg',
    mime_type: 'image/jpeg',
    size_bytes: attachmentBytes().byteLength,
    kind: 'photo',
    storage_bucket: 'job-files',
    storage_path: `${ids.company}/${ids.job}/approved-photo.jpg`,
  };
  const scheduledRows = [];
  const scheduleInputs = [];
  const cancelInputs = [];
  let providerCalls = 0;
  let beginCalls = 0;
  let sanitizerCalls = 0;
  let downloadCalls = 0;

  if (options.activePublicationStatus) {
    scheduledRows.push({
      publication_id: ids.otherJob,
      id: ids.otherJob,
      company_id: ids.company,
      job_id: ids.job,
      connection_id: ids.connection,
      approved_message: 'Existing active publication.',
      status: options.activePublicationStatus,
      scheduled_for: options.activePublicationStatus === 'scheduled' ? scheduledFor : null,
      scheduled_timezone: options.activePublicationStatus === 'scheduled' ? timezone : null,
      publication_kind: 'text_only',
      attachment_id: null,
      last_error_code: options.activePublicationStatus === 'delivery_unknown' ? 'META_PUBLICATION_DELIVERY_UNKNOWN' : null,
      approved_at: new Date(nowMs - 60_000).toISOString(),
      published_at: null,
    });
  }

  const deps = {
    context,
    scheduledRows,
    scheduleInputs,
    cancelInputs,
    get providerCalls() { return providerCalls; },
    get beginCalls() { return beginCalls; },
    get sanitizerCalls() { return sanitizerCalls; },
    get downloadCalls() { return downloadCalls; },
    auth: {
      resolveSession: async () => ({ kind: 'company', role: 'admin', company_id: ids.company }),
      assertCompanyAccess: async (_session, companyId) => {
        if (!options.allowAnyCompanyAccess && companyId !== ids.company) throw new MetaPublishingError('FORBIDDEN');
        return { actorAuthUserId: ids.actor, actorName: 'Schedule Owner', actorRole: 'admin' };
      },
    },
    repository: {
      getPublicationContext: async (_companyId, jobId) => {
        if (jobId === ids.job) return context;
        if (options.allowOtherJob && jobId === ids.otherJob && context) {
          return { ...context, job: { ...context.job, id: ids.otherJob } };
        }
        return null;
      },
      getPublicationAttachment: async (companyId, jobId, attachmentId) => (
        companyId === ids.company && jobId === ids.job && attachmentId === ids.attachment ? photo : null
      ),
      downloadAttachmentBytes: async () => { downloadCalls += 1; return attachmentBytes(); },
      revalidatePublicationPhotoEligibility: async (_companyId, _jobId, _attachmentId, sha256) => {
        const expected = `\\x${Buffer.from(await webcrypto.subtle.digest('SHA-256', attachmentBytes())).toString('hex')}`;
        if (
          options.revokedApproval
          || options.staleAnalysis
          || options.unresolvedPrivacy
          || options.checksumMismatch
          || sha256 !== expected
        ) return null;
        return {
          attachmentId: ids.attachment,
          analysisRunId: ids.analysisRun,
          attachmentResultId: ids.attachmentResult,
          eligibleForFacebookPublication: true,
          approval: { id: ids.approval, analysis_run_id: ids.analysisRun, approved_at: '2026-08-08T11:00:00.000Z' },
        };
      },
      schedulePublication: async (input) => {
        scheduleInputs.push(input);
        const existing = scheduledRows.find((row) => (
          row.connection_id === input.connectionId
          && row.approved_message === input.message
          && row.scheduled_for === input.scheduledFor
          && row.scheduled_timezone === input.scheduledTimezone
          && row.publication_kind === input.publicationKind
          && row.attachment_id === input.attachmentId
        ));
        if (existing) return scheduleRpcRow(existing, false);
        const activeForJob = scheduledRows.find((row) => (
          row.company_id === input.companyId
          && row.job_id === input.jobId
          && ['scheduled', 'publishing', 'delivery_unknown'].includes(row.status)
        ));
        if (activeForJob) {
          throw mapActivePublicationPersistenceError({
            code: '23505',
            message: `duplicate key value violates unique constraint "${ACTIVE_PUBLICATION_INDEX}"`,
          });
        }
        const row = {
          publication_id: input.publicationId,
          id: input.publicationId,
          company_id: input.companyId,
          job_id: input.jobId,
          connection_id: input.connectionId,
          approved_message: input.message,
          status: 'scheduled',
          scheduled_for: input.scheduledFor,
          scheduled_timezone: input.scheduledTimezone,
          publication_kind: input.publicationKind,
          attachment_id: input.attachmentId,
          last_error_code: null,
          approved_at: new Date(nowMs).toISOString(),
          published_at: null,
        };
        scheduledRows.push(row);
        return scheduleRpcRow(row, true);
      },
      cancelScheduledPublication: async (input) => {
        cancelInputs.push(input);
        const row = scheduledRows.find((item) => item.id === input.publicationId && item.company_id === input.companyId);
        if (!row) throw new MetaPublishingError('FORBIDDEN');
        if (row.status !== 'scheduled') throw new MetaPublishingError('META_SCHEDULE_CANCELLATION_UNAVAILABLE', 409);
        row.status = 'cancelled';
        return row;
      },
      getStatus: async (companyId, jobId) => {
        if (companyId !== ids.company || (jobId && jobId !== ids.job)) throw new MetaPublishingError('FORBIDDEN');
        const lastPublication = [...scheduledRows].reverse().find((row) => !jobId || row.job_id === jobId) ?? null;
        const activeScheduledPublication = scheduledRows.find((row) => (
          row.status === 'scheduled' && (!jobId || row.job_id === jobId)
        )) ?? null;
        return { connection, lastPublication, activeScheduledPublication, eligiblePhotos: [] };
      },
      beginPublication: async () => { beginCalls += 1; throw new Error('immediate path must not run'); },
    },
    provider: {
      publishText: async () => { providerCalls += 1; throw new Error('provider must not run'); },
      publishSinglePhoto: async () => { providerCalls += 1; throw new Error('provider must not run'); },
    },
    imageProcessor: {
      sanitize: async () => { sanitizerCalls += 1; throw new Error('schedule must not sanitize'); },
    },
    config,
    cryptoApi: webcrypto,
    maxBodyBytes: 24_000,
    newUuid: () => `00000000-0000-4000-8000-${String(9000 + scheduledRows.length + 20).padStart(12, '0')}`,
    timeoutController: () => ({ signal: new AbortController().signal, clear() {} }),
    now: () => nowMs,
    telemetry: { record() {} },
  };
  return deps;
}

function scheduleRpcRow(row, shouldSchedule) {
  return {
    publication_id: row.publication_id,
    publication_status: row.status,
    publication_scheduled_for: row.scheduled_for,
    publication_last_error_code: row.last_error_code,
    scheduled_timezone: row.scheduled_timezone,
    should_schedule: shouldSchedule,
  };
}

function invoke(deps, body) {
  return handleMetaPublishing({ rawBody: JSON.stringify(body), authorization: `Bearer ${jwt}`, deps });
}

function scheduleTextRequest(message = 'Exact scheduled text') {
  return {
    action: 'schedule_facebook_text',
    companyId: ids.company,
    jobId: ids.job,
    message,
    idempotencyKey: ids.approval,
    explicitApproval: true,
    scheduledFor,
    scheduledTimezone: timezone,
  };
}

function schedulePhotoRequest() {
  return { ...scheduleTextRequest('Exact scheduled photo text'), action: 'schedule_facebook_single_photo', attachmentId: ids.attachment };
}

function cancelRequest(publicationId) {
  return { action: 'cancel_facebook_scheduled_publication', companyId: ids.company, publicationId, explicitApproval: true };
}

function attachmentBytes() {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x11, 0x22, 0xff, 0xd9]);
}

function actorOnly(value) {
  return { actorAuthUserId: value.actorAuthUserId, actorName: value.actorName, actorRole: value.actorRole };
}

function scheduledSummary() {
  return {
    status: 'scheduled',
    publicationId: ids.approval,
    scheduledFor,
    scheduledTimezone: timezone,
    publicationKind: 'text_only',
    approvedAt: new Date(nowMs).toISOString(),
    publishedAt: null,
    errorCode: null,
  };
}

function publishingSnapshot(lastPublication, activeScheduledPublication) {
  return {
    ok: true,
    configured: true,
    connected: true,
    facebookPageName: 'ServiceScope',
    facebookPublishingEnabled: true,
    missingPermissions: [],
    lastPublication,
    activeScheduledPublication,
    eligiblePhotos: [],
  };
}
