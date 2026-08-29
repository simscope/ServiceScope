import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [
  edge,
  service,
  provider,
  contracts,
  imageProcessor,
  photoPreparation,
  privacy,
  mediaAnalysisEdge,
  client,
  panel,
  aiPage,
  migration,
  reviewMigration,
  exactReviewMigration,
  runtimeClosureMigration,
  persistenceClosureMigration,
  providerIdRedactionMigration,
  scheduledFoundationMigration,
  scheduledWorkerMigration,
  singleActivePublicationMigration,
  scheduledWorkerEdge,
  scheduledWorker,
  scheduledRepository,
  scheduledWorkerAuth,
  aclMigration,
  schema,
  config,
  ciWorkflow,
  denoSanitizerTests,
  denoScheduledWorkerTests,
  reelDeliveryService,
  reelPreparation,
  reelPanel,
  reelDeliveryMigration,
  reelReconciliationMigration,
  reelLocalClosureMigration,
] = await Promise.all([
  read('supabase/functions/meta-social-publish/index.ts'),
  read('supabase/functions/_shared/meta-publishing/service.js'),
  read('supabase/functions/_shared/meta-publishing/provider.js'),
  read('supabase/functions/_shared/meta-publishing/contracts.js'),
  read('supabase/functions/_shared/meta-publishing/imageProcessor.js'),
  read('supabase/functions/_shared/meta-publishing/photoPreparation.js'),
  read('supabase/functions/_shared/meta-publishing/privacy.js'),
  read('supabase/functions/ai-media-analyze/index.ts'),
  read('src/features/meta-publishing/clientApi.ts'),
  read('src/components/portal/FacebookPublishPanel.tsx'),
  read('src/components/portal/AiAssistantPage.tsx'),
  read('supabase/migrations/20260803193000_meta_facebook_publish_foundation.sql'),
  read('supabase/migrations/20260805002000_meta_facebook_single_photo_publish_review_fix.sql'),
  read('supabase/migrations/20260805183000_meta_facebook_single_photo_exact_review.sql'),
  read('supabase/migrations/20260805193000_meta_facebook_single_photo_runtime_closure.sql'),
  read('supabase/migrations/20260805203000_meta_facebook_single_photo_persistence_closure.sql'),
  read('supabase/migrations/20260805213000_meta_publication_audit_provider_id_redaction.sql'),
  read('supabase/migrations/20260805223000_meta_facebook_scheduled_publication_foundation.sql'),
  read('supabase/migrations/20260807010000_meta_facebook_scheduled_worker_reconciliation.sql'),
  read('supabase/migrations/20260808235500_meta_facebook_single_active_schedule.sql'),
  read('supabase/functions/meta-social-publish-scheduled-worker/index.ts'),
  read('supabase/functions/_shared/meta-publishing/scheduledWorker.js'),
  read('supabase/functions/_shared/meta-publishing/scheduledRepository.js'),
  read('supabase/functions/_shared/meta-publishing/scheduledWorkerAuth.js'),
  read('supabase/migrations/20260804011000_meta_facebook_publish_service_role_acl_fix.sql'),
  read('supabase/schema.sql'),
  read('supabase/config.toml'),
  read('.github/workflows/ci.yml'),
  read('scripts/meta-image-sanitizer-deno-tests.ts'),
  read('scripts/meta-scheduled-worker-deno-tests.ts'),
  read('supabase/functions/_shared/meta-publishing/reelDeliveryService.js'),
  read('supabase/functions/_shared/meta-publishing/reelPreparation.js'),
  read('src/components/portal/FacebookReelPublishPanel.tsx'),
  read('supabase/migrations/20260817034500_meta_facebook_reel_delivery.sql'),
  read('supabase/migrations/20260824040000_meta_facebook_reel_reconciliation_claim.sql'),
  read('supabase/migrations/20260829014000_meta_facebook_reel_local_closure.sql'),
]);

const browserSources = `${client}\n${panel}\n${reelPanel}\n${aiPage}`;
const scheduleClient = client.slice(client.indexOf('export function scheduleFacebookText'));
const scheduleService = service.slice(service.indexOf('if (scheduledAction)'), service.indexOf("stage = 'decrypt_connection'"));
const serverSources = `${edge}\n${service}\n${provider}\n${contracts}\n${privacy}\n${imageProcessor}\n${photoPreparation}\n${reelDeliveryService}\n${reelPreparation}\n${mediaAnalysisEdge}\n${scheduledWorkerEdge}\n${scheduledWorker}\n${scheduledRepository}\n${scheduledWorkerAuth}`;
const combinedMigrations = `${migration}\n${reviewMigration}\n${exactReviewMigration}\n${runtimeClosureMigration}\n${persistenceClosureMigration}\n${providerIdRedactionMigration}`;
const providerIdRedactionFunction = providerIdRedactionMigration.match(/create or replace function private\.complete_company_facebook_publication_unvalidated_20260805[\s\S]+?revoke all on function private\.complete_company_facebook_publication_unvalidated_20260805/)?.[0] ?? '';
let checks = 0;
const check = (fn) => { fn(); checks += 1; };

check(() => assert.doesNotMatch(browserSources, /graph\.facebook\.com/i));
check(() => assert.doesNotMatch(browserSources, /access[_-]?token|token_envelope|ciphertext|appsecret_proof/i));
check(() => assert.doesNotMatch(browserSources, /META_APP_SECRET|META_TOKEN_ENCRYPTION_KEY|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY/));
check(() => assert.doesNotMatch(browserSources, /company_social_publications/));
check(() => assert.doesNotMatch(browserSources, /providerPostId|provider_post_id|facebookPageId|facebook_page_id/));
check(() => assert.doesNotMatch(browserSources, /instagram_content_publish|publish_instagram/i));
check(() => assert.doesNotMatch(reelPanel, /pageAccessToken|uploadUrl|storagePath|graphApiVersion|providerMediaId/));
check(() => assert.match(reelPanel, /explicitApproval: true/));
check(() => assert.match(reelPanel, /Publish this exact completed video and caption/));
check(() => assert.match(reelPanel, /message: reviewedCaption/));
check(() => assert.match(reelPanel, /facebook-publish-preview">\{reviewedCaption\}/));
check(() => assert.match(reelDeliveryService, /assertPublicationPrivacy[\s\S]*prepareFacebookReel[\s\S]*decryptPageToken[\s\S]*beginReelPublication/));
check(() => assert.match(reelPreparation, /video_object_path !== `\$\{companyId\}\/\$\{render\.id\}\/reel\.mp4`/));
check(() => assert.match(reelPreparation, /actualSha256 !== String\(render\.video_sha256\)/));
check(() => assert.doesNotMatch(`${reelDeliveryService}\n${reelPreparation}`, /signedUrl|createSignedUrl|publicUrl/));
check(() => assert.match(provider, /https:\/\/rupload\.facebook\.com\/video-upload\/\$\{config\.graphApiVersion\}/));
check(() => assert.equal((provider.match(/redirect: 'error'/g) ?? []).length, 4));
check(() => assert.match(provider, /PROVIDER_TEMPORARY_ERROR'[\s\S]*META_PUBLICATION_DELIVERY_UNKNOWN/));
check(() => assert.doesNotMatch(reelDeliveryMigration, /providerMediaId|providerPostId/));
check(() => assert.match(reelDeliveryMigration, /provider_call_count between 0 and 6/));
check(() => assert.match(reelDeliveryMigration, /provider_status_checks between 0 and 3/));
check(() => assert.match(reelDeliveryMigration, /p_status_was_checked boolean/));
check(() => assert.equal((reelDeliveryMigration.match(/provider_status_checks=provider_status_checks\+case when p_status_was_checked then 1 else 0 end/g) ?? []).length, 2));
check(() => assert.match(reelDeliveryService, /provider_status_checks\) >= MAX_REEL_STATUS_CHECKS/));
check(() => assert.match(reelDeliveryService, /statusWasChecked \|\|[\s\S]*markReelUnknown/));
check(() => assert.match(reelDeliveryMigration, /grant execute on function public\.begin_company_facebook_reel_publication[\s\S]*to service_role/));
check(() => assert.doesNotMatch(reelReconciliationMigration, /providerMediaId|providerPostId|access[_-]?token|authorization/i));
check(() => assert.match(reelReconciliationMigration, /create or replace function public\.claim_company_facebook_reel_status_check/i));
check(() => assert.match(reelReconciliationMigration, /status='delivery_unknown'[\s\S]*provider_delivery_stage='delivery_unknown'/i));
check(() => assert.match(reelReconciliationMigration, /provider_call_count=provider_call_count\+1,provider_status_checks=provider_status_checks\+1/i));
check(() => assert.match(reelReconciliationMigration, /revoke all on function public\.claim_company_facebook_reel_status_check[\s\S]*from public,anon,authenticated/i));
check(() => assert.match(reelReconciliationMigration, /grant execute on function public\.claim_company_facebook_reel_status_check[\s\S]*to service_role/i));
check(() => assert.match(reelDeliveryService, /claimReelStatusCheck[\s\S]*providerCall/));
check(() => assert.match(reelDeliveryService, /callAlreadyCounted: true/));
check(() => assert.doesNotMatch(reelDeliveryService, /for\s*\([^)]*retry|while\s*\([^)]*provider/i));
const reelLocalClosureFunction = reelLocalClosureMigration.match(/create or replace function public\.close_exhausted_company_facebook_reel_publication[\s\S]*?\n\$\$;/i)?.[0] ?? '';
const reelLocalClosureUpdate = reelLocalClosureFunction.match(/update public\.company_social_publications set([\s\S]*?)\n  where id=p_publication_id/i)?.[1] ?? '';
check(() => assert.ok(reelLocalClosureFunction));
check(() => assert.ok(reelLocalClosureUpdate));
check(() => assert.match(reelLocalClosureFunction, /status='failed',attempts=1,provider_delivery_stage='failed'/i));
check(() => assert.match(reelLocalClosureFunction, /provider_status_checks=3 and updated_at=p_expected_updated_at/i));
check(() => assert.match(reelLocalClosureFunction, /localClosure',true,'providerCallMade',false,'statusCheckMade',false/i));
check(() => assert.match(reelLocalClosureFunction, /providerAuthorityRetained',true,'published',false,'repeatBlocked',true/i));
check(() => assert.doesNotMatch(reelLocalClosureUpdate, /reel_provider_media_id\s*=|provider_call_count\s*=|provider_status_checks\s*=|provider_last_checked_at\s*=/i));
check(() => assert.doesNotMatch(reelLocalClosureMigration, /providerMediaId|providerPostId|access[_-]?token|authorization/i));
check(() => assert.match(reelLocalClosureMigration, /revoke all on function public\.close_exhausted_company_facebook_reel_publication[\s\S]*from public,anon,authenticated/i));
check(() => assert.match(reelLocalClosureMigration, /grant execute on function public\.close_exhausted_company_facebook_reel_publication[\s\S]*to service_role/i));
check(() => assert.doesNotMatch(browserSources, /\bFormData\b|multipart\/form-data/i));
check(() => assert.doesNotMatch(browserSources, /password/i));
check(() => assert.match(client, /supabaseFunction<.*>\(functionName/s));
check(() => assert.match(client, /action: 'publish_facebook_text'/));
check(() => assert.match(client, /action: 'publish_facebook_single_photo'/));
check(() => assert.match(client, /action: 'schedule_facebook_text'/));
check(() => assert.match(client, /action: 'schedule_facebook_single_photo'/));
check(() => assert.match(client, /action: 'cancel_facebook_scheduled_publication'/));
check(() => assert.match(client, /action: 'approve_facebook_publication_photo'/));
check(() => assert.match(client, /action: 'revoke_facebook_publication_photo_approval'/));
check(() => assert.match(client, /explicitApproval: true/));
check(() => assert.match(client, /idempotencyKey: string/));
check(() => assert.doesNotMatch(client, /mediaUrl|storagePath|base64|pageId|connectionId|accessToken/i));
check(() => assert.doesNotMatch(scheduleClient, /pageId|connectionId|analysisRunId|attachmentResultId|approvalId|sha256|providerId|claimToken|executionAttempts/i));
check(() => assert.doesNotMatch(browserSources, /meta_scheduled_publisher|SUPABASE_SECRET_KEYS|vault\.decrypted_secrets/i));
check(() => assert.match(panel, /crypto\.randomUUID\(\)/));
check(() => assert.match(panel, /workspace\.submitting/));
check(() => assert.match(panel, /invalidateFacebookPublishApproval/));
check(() => assert.match(panel, /loadFacebookPublishingStatus\(companyId, jobId\)/));
check(() => assert.match(panel, /currentFacebookPublication\(workspace, snapshot\)/));
check(() => assert.match(panel, /currentFacebookActiveSchedule\(workspace, snapshot\)/));
check(() => assert.match(panel, /reconcileFacebookPublishWorkspaceFromStatus/));
check(() => assert.match(panel, /FACEBOOK_STATUS_REFRESH_MS = 45_000/));
check(() => assert.match(panel, /window\.setTimeout\(refreshStatus, FACEBOOK_STATUS_REFRESH_MS\)/));
check(() => assert.match(panel, /window\.clearTimeout\(timeoutId\)/));
check(() => assert.match(panel, /snapshot\?\.eligiblePhotos/));
check(() => assert.match(panel, /eligibleForFacebookPublication/));
check(() => assert.match(panel, /checksumMatch/));
check(() => assert.doesNotMatch(panel, /pageCheckAcknowledged|I checked the Facebook Page/));
check(() => assert.match(panel, /blocked until a reconciliation workflow resolves the unknown delivery state/i));
check(() => assert.match(panel, /Text-only - selected photos and videos will not be uploaded/i));
check(() => assert.match(panel, /Exactly one approved selected photo will be used/i));
check(() => assert.match(panel, /Publish now/));
check(() => assert.match(panel, /Schedule for later/));
check(() => assert.match(panel, /Schedule publication/));
check(() => assert.match(panel, /Cancel scheduled publication/));
check(() => assert.match(panel, /META_PUBLICATION_DELIVERY_UNKNOWN|normalizePublishingError/));
check(() => assert.doesNotMatch(panel, /retry/i));
const statusPollingSource = panel.slice(panel.indexOf('const refreshStatus = async'), panel.indexOf('function openConfirmation'));
check(() => assert.equal((statusPollingSource.match(/loadFacebookPublishingStatus/g) ?? []).length, 1));
check(() => assert.doesNotMatch(statusPollingSource, /scheduleFacebook|cancelFacebook|publishFacebook|provider|decrypt/i));

check(() => assert.match(config, /\[functions\.meta-social-publish\]\s+verify_jwt = true/));
check(() => assert.doesNotMatch(config, /\[functions\.meta-social-publish\]\s+verify_jwt = false/));
check(() => assert.match(edge, /const jwt = requireBearerJwt\(authorization\)/));
check(() => assert.match(edge, /auth\.getUser\(jwt\)/));
check(() => assert.match(edge, /requireVerifiedAuthUserId\(authResult\)/));
check(() => assert.match(edge, /\.eq\('company_id', companyId\)[\s\S]*\.eq\('status', 'scheduled'\)/));
check(() => assert.match(edge, /activeScheduleQuery = activeScheduleQuery\.eq\('job_id', jobId\)/));
check(() => assert.match(edge, /mapActivePublicationPersistenceError\(error\)/));
check(() => assert.match(edge, /name === 'begin_company_facebook_publication'[\s\S]*mapActivePublicationPersistenceError\(error\)/));
check(() => assert.match(edge, /name === 'schedule_company_facebook_publication'[\s\S]*mapActivePublicationPersistenceError\(error\)/));
check(() => assert.match(contracts, /META_PUBLICATION_ACTIVE_CONFLICT/));
check(() => assert.match(contracts, /String\(error\?\.code \?\? ''\) !== '23505'/));
check(() => assert.match(contracts, /company_social_publications_one_active_per_job_uidx/));
check(() => assert.doesNotMatch(contracts, /one_scheduled_per_job_uidx/));
check(() => assert.doesNotMatch(edge, /jsonResponse\([^\n]*(error\?\.(?:message|details|hint)|activePublicationConflict)/i));
check(() => assert.match(edge, /app_current_session/));
check(() => assert.match(edge, /can_manage_company/));
check(() => assert.match(edge, /\.eq\('job_id', jobId\)/));
check(() => assert.match(edge, /assertMetaAccessRole\(session, companyId\)/));
check(() => assert.doesNotMatch(`${service}\n${contracts}`, /body\.actor|requestBody\.actor|value\.actor/));
check(() => assert.doesNotMatch(edge, /console\.[a-z]+\([^\n]*(authorization|jwt|token|message|page|job)/i));
check(() => assert.match(edge, /Cache-Control': 'no-store'/));

check(() => assert.match(service, /buildPrivateValues\(publicationContext\)/));
check(() => assert.match(service, /assertPublicationPrivacy\(message, privateValues\)/));
check(() => assert.match(service, /decryptTokenBundle/));
check(() => assert.match(service, /connectionEnvelopeContext/));
check(() => assert.match(service, /beginPublication/));
check(() => assert.match(service, /publicationIntentSha256/));
check(() => assert.match(service, /revalidatePublicationPhotoEligibility/));
check(() => assert.match(service, /deriveFacebookPublicationPhotoScheduleEvidence/));
check(() => assert.match(service, /schedulePublication/));
check(() => assert.match(service, /cancelScheduledPublication/));
check(() => assert.doesNotMatch(scheduleService, /publishText|publishSinglePhoto|beginPublication|decryptTokenBundle/));
check(() => assert.match(singleActivePublicationMigration, /create unique index company_social_publications_one_active_per_job_uidx/i));
check(() => assert.equal((singleActivePublicationMigration.match(/where status in \('scheduled', 'publishing', 'delivery_unknown'\)/gi) ?? []).length, 2));
check(() => assert.match(singleActivePublicationMigration, /group by company_id, job_id[\s\S]*having count\(\*\) > 1[\s\S]*raise exception/i));
check(() => assert.doesNotMatch(singleActivePublicationMigration, /\b(?:delete|update)\b/i));
check(() => assert.doesNotMatch(singleActivePublicationMigration, /'published'|'failed'|'cancelled'/i));
check(() => assert.match(schema, /create unique index company_social_publications_one_active_per_job_uidx[\s\S]*where status in \('scheduled', 'publishing', 'delivery_unknown'\)/i));
check(() => assert.doesNotMatch(`${schema}\n${singleActivePublicationMigration}`, /one_scheduled_per_job_uidx/));
check(() => assert.match(edge, /p_publication_audit_metadata: input\.publicationAuditMetadata/));
check(() => assert.match(edge, /list_company_facebook_publication_photo_candidates/));
check(() => assert.match(service, /revokePublicationPhotoApproval/));
check(() => assert.match(photoPreparation, /deps\.imageProcessor/));
check(() => assert.match(photoPreparation, /processor\.sanitize/));
check(() => assert.match(service, /if \(!beginning\.should_publish\)/));
check(() => assert.ok(service.indexOf('await deps.repository.beginPublication') < service.indexOf('await deps.provider.publish')));
check(() => assert.match(service, /markUnknown/));
check(() => assert.match(service, /META_PUBLICATION_DELIVERY_UNKNOWN/));
check(() => assert.match(service, /maxBodyBytes/));
check(() => assert.match(contracts, /new TextEncoder\(\)\.encode\(rawBody\)\.byteLength > maxBytes/));
check(() => assert.match(contracts, /Array\.from\(clean\)\.length/));
check(() => assert.match(contracts, /replace\(\/\\r\\n\/g, '\\n'\)\.replace\(\/\\r\/g, '\\n'\)/));
check(() => assert.match(contracts, /\[\\u0000-\\u0009\\u000b\\u000c\\u000e-\\u001f\\u007f\]/));
check(() => assert.match(contracts, /value !== true/));
check(() => assert.match(contracts, /\['action', 'companyId', 'jobId', 'attachmentId', 'message', 'idempotencyKey', 'explicitApproval'\]/));
check(() => assert.match(contracts, /\['action', 'companyId', 'jobId', 'attachmentId', 'explicitApproval', 'revocationReason'\]/));
check(() => assert.match(contracts, /analysisRunId', 'attachmentResultId/));
check(() => assert.match(contracts, /\['action', 'companyId', 'jobId', 'message', 'idempotencyKey', 'explicitApproval'\]/));
check(() => assert.match(contracts, /schedule_facebook_text/));
check(() => assert.match(contracts, /schedule_facebook_single_photo/));
check(() => assert.match(contracts, /cancel_facebook_scheduled_publication/));
check(() => assert.doesNotMatch(contracts, /instagram|mediaIds|mediaUrl|storagePath|base64/));
check(() => assert.doesNotMatch(contracts.match(/const allowed[\s\S]*?;/)?.[0] ?? '', /pageId|connectionId/));

check(() => assert.match(provider, /https:\/\/graph\.facebook\.com\/\$\{config\.graphApiVersion\}/));
check(() => assert.match(provider, /Authorization: `Bearer \$\{pageAccessToken\}`/));
check(() => assert.match(provider, /'Content-Type': 'application\/x-www-form-urlencoded'/));
check(() => assert.match(provider, /new URLSearchParams\(\{ message, appsecret_proof: proof \}\)/));
check(() => assert.match(provider, /\$\{encodeURIComponent\(pageId\)\}\/photos/));
check(() => assert.match(provider, /form\.set\('caption', message\)/));
check(() => assert.match(provider, /form\.set\('published', 'true'\)/));
check(() => assert.match(provider, /form\.set\('source', new Blob/));
check(() => assert.doesNotMatch(provider, /access_token/));
check(() => assert.doesNotMatch(provider, /searchParams|\?access/));
check(() => assert.doesNotMatch(provider, /for\s*\(|while\s*\(|setInterval|setTimeout/));
check(() => assert.doesNotMatch(provider, /console\./));
check(() => assert.doesNotMatch(provider, /rawMessage|fbtrace_id|x-fb-debug/));
check(() => assert.doesNotMatch(provider, /return\s*\{[^}]*\b(?:message|payload|response|request|body|url|pageId)\s*:/s));
check(() => assert.match(provider, /RESPONSE_MISSING_MEDIA_ID/));

check(() => assert.match(imageProcessor, /imagescript@1\.3\.0/));
check(() => assert.match(imageProcessor, /inspectImageHeader\(input\)/));
check(() => assert.ok(imageProcessor.indexOf('inspectImageHeader(input)') < imageProcessor.indexOf('decodeImage(input)')));
check(() => assert.match(imageProcessor, /preflight\.width > maxWidth/));
check(() => assert.match(imageProcessor, /preflight\.width \* preflight\.height > maxPixels/));
check(() => assert.match(imageProcessor, /preflight\.mimeType !== mimeType/));
check(() => assert.match(imageProcessor, /type === 'acTL' \|\| type === 'fcTL' \|\| type === 'fdAT'/));
check(() => assert.doesNotMatch(imageProcessor, /coordinates|xmpmeta|Exif\0|GPS\0/i));

check(() => assert.match(denoSanitizerTests, /createImageScriptProcessor\(\)/));
check(() => assert.match(denoSanitizerTests, /imagescript@1\.3\.0/));
check(() => assert.match(denoSanitizerTests, /JPEG.*EXIF|Exif/s));
check(() => assert.match(denoSanitizerTests, /GPS/));
check(() => assert.match(denoSanitizerTests, /xmpmeta/));
check(() => assert.match(denoSanitizerTests, /tEXt/));
check(() => assert.match(denoSanitizerTests, /providerCalls\.length, 0/));

check(() => assert.match(mediaAnalysisEdge, /recordMediaAnalysisResult/));
check(() => assert.match(mediaAnalysisEdge, /record_company_media_analysis_result/));
check(() => assert.match(mediaAnalysisEdge, /resultIdByAttachment\.size !== persistenceAttachments\.length/));
check(() => assert.match(mediaAnalysisEdge, /attachmentSha256/));
check(() => assert.doesNotMatch(mediaAnalysisEdge, /signedUrl.*insert|primary_email.*insert/i));
check(() => assert.match(mediaAnalysisEdge, /contentFindings:[\s\S]*explanation: String\(finding\.explanation\)\.trim\(\)/));
check(() => assert.doesNotMatch(mediaAnalysisEdge.match(/privacyFindings:[\s\S]*?\}\)\),/)?.[0] ?? '', /explanation/));
check(() => assert.match(runtimeClosureMigration, /record_company_media_analysis_result/));
check(() => assert.match(runtimeClosureMigration, /begin_company_facebook_publication_unvalidated_20260805/));
check(() => assert.match(runtimeClosureMigration, /meta_facebook_publication_audit_metadata_valid\(p_publication_kind, 'begin'/));
check(() => assert.match(runtimeClosureMigration, /meta_facebook_publication_audit_metadata_valid\(selected_kind, 'complete'/));
check(() => assert.match(runtimeClosureMigration, /meta_facebook_publication_audit_metadata_valid\(selected_kind, 'fail'/));
check(() => assert.match(runtimeClosureMigration, /meta_facebook_publication_audit_metadata_valid\(selected_kind, 'unknown'/));
check(() => assert.match(persistenceClosureMigration, /set schema private/));
check(() => assert.match(persistenceClosureMigration, /revoke all on function private\.begin_company_facebook_publication_unvalidated_20260805[\s\S]*service_role/));
check(() => assert.match(persistenceClosureMigration, /possible_phone_or_email/));
check(() => assert.doesNotMatch(persistenceClosureMigration, /possible_email|possible_phone'/));
check(() => assert.match(persistenceClosureMigration, /image\/webp/));
check(() => assert.match(persistenceClosureMigration, /jsonb_array_length\(p_attachments\) > 4/));
check(() => assert.match(persistenceClosureMigration, /total_privacy_count > 24/));
check(() => assert.match(persistenceClosureMigration, /company_media_analysis_attachment_results_run_attachment_unique/));
check(() => assert.match(persistenceClosureMigration, /company_media_analysis_privacy_findings_result_finding_unique/));

check(() => assert.match(migration, /alter table public\.company_social_publications enable row level security/));
check(() => assert.match(migration, /revoke all on public\.company_social_publications from public, anon, authenticated/));
check(() => assert.match(migration, /grant select, insert, update on public\.company_social_publications to service_role/));
check(() => assert.doesNotMatch(migration, /grant[^;]+company_social_publications[^;]+(?:anon|authenticated)/i));
check(() => assert.match(migration, /unique index company_social_publications_company_idempotency_unique/));
check(() => assert.match(combinedMigrations, /status in \('publishing', 'published', 'failed', 'delivery_unknown'\)/));
check(() => assert.match(migration, /octet_length\(message_sha256\) = 32/));
check(() => assert.match(migration, /sha256\(convert_to\(p_approved_message, 'UTF8'\)\)/));
check(() => assert.match(migration, /char_length\(approved_message\) between 1 and 5000/));
check(() => assert.match(migration, /translate\(approved_message, E'\\n', ''\) !~ '\[\[:cntrl:\]\]'/));
check(() => assert.match(migration, /lower\(approved_message\) not like '%\[private\]%'/));
check(() => assert.match(combinedMigrations, /attempts between 0 and 1/));
check(() => assert.match(migration, /meta_publication_started/));
check(() => assert.match(migration, /meta_publication_published/));
check(() => assert.match(migration, /meta_publication_failed/));
check(() => assert.match(migration, /meta_publication_delivery_unknown/));
check(() => assert.match(reviewMigration, /META_FACEBOOK_SINGLE_PHOTO_PUBLISH_REVIEW_FIX_BEGIN/));
check(() => assert.match(reviewMigration, /company_media_analysis_runs/));
check(() => assert.match(reviewMigration, /company_media_analysis_attachment_results/));
check(() => assert.match(reviewMigration, /company_media_analysis_privacy_findings/));
check(() => assert.match(reviewMigration, /provider_media_id is not null/));
check(() => assert.match(reviewMigration, /provider_post_id is null/));
check(() => assert.match(reviewMigration, /RESPONSE_MISSING_MEDIA_ID/));
check(() => assert.match(reviewMigration, /revoke_company_facebook_publication_photo_approval/));
check(() => assert.match(reviewMigration, /p_publication_audit_metadata jsonb/));
check(() => assert.match(reviewMigration, /providerCallCount/));
check(() => assert.match(reviewMigration, /providerMediaId/));
check(() => assert.match(reviewMigration, /singlePhotoProviderPostIdNull/));
check(() => assert.match(reviewMigration, /metadataStripped/));
check(() => assert.match(reviewMigration, /gpsStripped/));
check(() => assert.match(reviewMigration, /sanitizerVersion/));
check(() => assert.match(providerIdRedactionMigration, /META_PUBLICATION_AUDIT_PROVIDER_ID_REDACTION_BEGIN/));
check(() => assert.match(providerIdRedactionMigration, /metadata = metadata - 'providerMediaId' - 'providerPostId'/));
check(() => assert.match(providerIdRedactionMigration, /where action = 'meta_publication_published'\s+and metadata \?\| array\['providerMediaId', 'providerPostId'\]/));
check(() => assert.match(providerIdRedactionMigration, /raise exception 'meta publication published audit provider ids remain'/));
check(() => assert.match(providerIdRedactionFunction, /provider_post_id = case when locked_publication\.publication_kind = 'text_only' then btrim\(p_provider_post_id\) else null end/));
check(() => assert.match(providerIdRedactionFunction, /provider_media_id = case when locked_publication\.publication_kind = 'single_photo' then btrim\(p_provider_media_id\) else null end/));
check(() => assert.doesNotMatch(providerIdRedactionFunction, /'providerMediaId'|'providerPostId'/));
check(() => assert.match(`${service}\n${contracts}`, /facebook_publication_intent_v1/));
check(() => assert.match(scheduledFoundationMigration, /facebook_scheduled_publication_intent_v1/));
check(() => assert.doesNotMatch(scheduledFoundationMigration, /facebook_publication_intent_v1/));
check(() => assert.match(scheduledFoundationMigration, /FOR UPDATE SKIP LOCKED/i));
check(() => assert.match(scheduledFoundationMigration, /execution_attempts = publication\.execution_attempts \+ 1/));
check(() => assert.match(scheduledFoundationMigration, /company_social_publications_execution_attempts_check\s+check \(execution_attempts >= 0\)/));
check(() => assert.doesNotMatch(scheduledFoundationMigration, /execution_attempts between 0 and 100/));
check(() => assert.match(scheduledFoundationMigration, /last_scheduler_error_code = 'META_SCHEDULE_REVALIDATION_FAILED'/));
check(() => assert.match(scheduledFoundationMigration, /attempts = 0/));
check(() => assert.match(scheduledFoundationMigration, /scheduled_facebook_page_id/));
check(() => assert.match(scheduledFoundationMigration, /selected_connection\.facebook_page_id <> locked_publication\.scheduled_facebook_page_id/));
check(() => assert.match(scheduledFoundationMigration, /revoke all on function public\.claim_due_company_facebook_publications\(integer, integer\) from public, anon, authenticated/));
check(() => assert.match(scheduledFoundationMigration, /grant execute on function public\.claim_due_company_facebook_publications\(integer, integer\) to service_role/));
check(() => assert.doesNotMatch(scheduledFoundationMigration, /grant execute on function public\.(?:schedule_company_facebook_publication|cancel_scheduled_company_facebook_publication|claim_due_company_facebook_publications|release_scheduled_company_facebook_publication_claim|fail_scheduled_company_facebook_publication_preflight|start_scheduled_company_facebook_publication)[\s\S]*?to\s+(?:anon|authenticated|public)/i));
const scheduledRpcDefinitions = [
  'schedule_company_facebook_publication',
  'cancel_scheduled_company_facebook_publication',
  'claim_due_company_facebook_publications',
  'release_scheduled_company_facebook_publication_claim',
  'fail_scheduled_company_facebook_publication_preflight',
  'start_scheduled_company_facebook_publication',
].map((name) => scheduledFoundationMigration.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))?.[0] ?? '');
check(() => assert.equal(scheduledRpcDefinitions.every(Boolean), true));
check(() => assert.doesNotMatch(scheduledRpcDefinitions.join('\n'), /\bp_now\b|\bp_timestamp\b/));
check(() => assert.ok((scheduledFoundationMigration.match(/database_now := clock_timestamp\(\)/g) ?? []).length >= 6));
check(() => assert.match(scheduledRpcDefinitions[0], /p_scheduled_for <= database_now/));
check(() => assert.match(scheduledRpcDefinitions[0], /p_scheduled_for > database_now \+ interval '366 days'/));
check(() => assert.match(scheduledRpcDefinitions[2], /publication\.scheduled_for <= database_now/));
check(() => assert.match(scheduledRpcDefinitions[2], /claimed_at = database_now/));
check(() => assert.match(scheduledRpcDefinitions[2], /claim_expires_at = database_now \+ make_interval/));
check(() => assert.match(scheduledRpcDefinitions[3], /p_next_attempt_at <= database_now/));
check(() => assert.match(scheduledRpcDefinitions[3], /p_next_attempt_at > database_now \+ interval '1 day'/));
check(() => assert.doesNotMatch(scheduledRpcDefinitions[4], /\bp_actor_name\b|\bp_actor_role\b/));
check(() => assert.match(scheduledRpcDefinitions[4], /locked_publication\.approved_by, locked_publication\.scheduled_by_name,\s+locked_publication\.scheduled_by_role/));
check(() => assert.match(scheduledRpcDefinitions[5], /claim_expires_at > database_now/));
check(() => assert.match(scheduledRpcDefinitions[5], /scheduled_for <= database_now/));
check(() => assert.doesNotMatch(scheduledRpcDefinitions[5], /for key share/i));
check(() => assert.match(scheduledRpcDefinitions[5], /from public\.jobs[\s\S]*?for update;/i));
check(() => assert.match(scheduledRpcDefinitions[5], /from public\.company_social_connections[\s\S]*?for update;/i));
check(() => assert.match(scheduledRpcDefinitions[5], /from public\.job_attachments[\s\S]*?for update;/i));
check(() => assert.match(scheduledRpcDefinitions[5], /from public\.company_media_analysis_attachment_results ar[\s\S]*?for update of ar;/i));
check(() => assert.match(scheduledRpcDefinitions[5], /from public\.company_social_publication_media_approvals approval[\s\S]*?for update;/i));
const scheduledStartLockOrder = [
  'from public.company_social_publications',
  'from public.jobs',
  'from public.company_social_connections',
  'from public.job_attachments',
  'from public.company_media_analysis_attachment_results ar',
  'from public.company_social_publication_media_approvals approval',
  'from public.company_media_analysis_privacy_findings finding',
].map((fragment) => scheduledRpcDefinitions[5].indexOf(fragment));
check(() => assert.equal(scheduledStartLockOrder.every((position) => position >= 0), true));
check(() => assert.equal(scheduledStartLockOrder.every((position, index) => index === 0 || position > scheduledStartLockOrder[index - 1]), true));
check(() => assert.match(scheduledFoundationMigration, /meta_publication_scheduled/));
check(() => assert.match(scheduledFoundationMigration, /meta_publication_schedule_cancelled/));
check(() => assert.match(scheduledFoundationMigration, /meta_publication_schedule_failed/));
const scheduledAuditSection = scheduledFoundationMigration.match(/meta_publication_scheduled[\s\S]*?return query select created_publication/)?.[0] ?? '';
check(() => assert.doesNotMatch(scheduledAuditSection, /scheduled_facebook_page_id|facebook_page_id|providerPostId|providerMediaId|storage_bucket|storage_path|token_envelope|ciphertext|'approvedMessage'|'message'/i));
const scheduledCancelAuditSection = scheduledFoundationMigration.match(/meta_publication_schedule_cancelled[\s\S]*?return next updated_publication/)?.[0] ?? '';
check(() => assert.doesNotMatch(scheduledCancelAuditSection, /scheduled_facebook_page_id|facebook_page_id|providerPostId|providerMediaId|storage_bucket|storage_path|token_envelope|ciphertext|'approvedMessage'|'message'/i));
const scheduledFailureAuditSection = scheduledFoundationMigration.match(/meta_publication_schedule_failed[\s\S]*?return next updated_publication/)?.[0] ?? '';
check(() => assert.doesNotMatch(scheduledFailureAuditSection, /scheduled_facebook_page_id|facebook_page_id|providerPostId|providerMediaId|storage_bucket|storage_path|token_envelope|ciphertext|'approvedMessage'|'message'/i));
check(() => assert.match(config, /\[functions\.meta-social-publish-scheduled-worker\]\s+verify_jwt = false/));
check(() => assert.doesNotMatch(scheduledWorkerEdge, /Access-Control-Allow-Origin|corsHeaders|OPTIONS/));
check(() => assert.match(scheduledWorkerEdge, /request\.headers\.get\('apikey'\)/));
check(() => assert.match(scheduledWorkerEdge, /SUPABASE_SERVICE_ROLE_KEY/));
check(() => assert.match(scheduledWorkerEdge, /createClient\(supabaseUrl, serviceRoleKey/));
check(() => assert.doesNotMatch(scheduledWorkerEdge, /createClient\(supabaseUrl, workerSecretKey/));
check(() => assert.match(scheduledWorkerAuth, /SCHEDULED_WORKER_SECRET_NAME = 'meta_scheduled_publisher'/));
check(() => assert.doesNotMatch(
  `${scheduledWorkerAuth}\n${denoScheduledWorkerTests}`,
  new RegExp(['meta', 'scheduled', 'publisher'].join('-')),
));
check(() => assert.match(scheduledWorkerEdge, /SUPABASE_SECRET_KEYS/));
check(() => assert.match(scheduledWorkerAuth, /sb_secret_/));
check(() => assert.match(scheduledWorkerAuth, /authorization[\s\S]*AUTH_REQUIRED/));
check(() => assert.match(scheduledWorkerAuth, /Object\.keys\(value\)\.length !== 0/));
check(() => assert.doesNotMatch(`${scheduledWorkerEdge}\n${scheduledWorker}\n${scheduledRepository}`, /handleMetaPublishing|begin_company_facebook_publication|beginPublication/));
check(() => assert.doesNotMatch(`${scheduledWorkerEdge}\n${scheduledWorker}\n${scheduledRepository}`, /console\.|logger\.|telemetry/));
check(() => assert.match(scheduledWorker, /SCHEDULED_CLAIM_BATCH_SIZE = 3/));
check(() => assert.match(scheduledWorker, /SCHEDULED_CLAIM_LEASE_SECONDS = 300/));
check(() => assert.match(scheduledWorker, /for \(const claim of claims\) await processClaim/));
check(() => assert.match(scheduledWorker, /reconcileStale\(SCHEDULED_RECONCILIATION_BATCH_SIZE\)[\s\S]*claimDue/));
check(() => assert.match(scheduledWorker, /getExactConnection/));
check(() => assert.match(scheduledWorker, /scheduled_facebook_page_id/));
check(() => assert.match(scheduledWorker, /assertPublicationPrivacy\(message, privateValues\)/));
check(() => assert.match(scheduledWorker, /expectedOriginalSha256: publication\.scheduled_attachment_sha256/));
check(() => assert.match(scheduledWorker, /startScheduled[\s\S]*publishSinglePhoto|startScheduled[\s\S]*publishText/));
check(() => assert.match(scheduledWorker, /scheduledRetryDelayMs/));
check(() => assert.doesNotMatch(scheduledWorker, /setInterval|while\s*\(|for\s*\([^)]*attempt/i));
check(() => assert.match(scheduledRepository, /\.eq\('id', input\.connectionId\)/));
check(() => assert.doesNotMatch(scheduledRepository, /company_social_connections[\s\S]{0,300}order\('updated_at'/));
check(() => assert.match(scheduledWorkerMigration, /create or replace function public\.reconcile_stale_scheduled_company_facebook_publications/));
check(() => assert.match(scheduledWorkerMigration, /database_now := clock_timestamp\(\)/));
check(() => assert.match(scheduledWorkerMigration, /for update skip locked/i));
check(() => assert.match(scheduledWorkerMigration, /scheduled_for is not null/));
check(() => assert.match(scheduledWorkerMigration, /publication\.status = 'publishing'/));
check(() => assert.match(scheduledWorkerMigration, /publication\.attempts = 0/));
check(() => assert.match(scheduledWorkerMigration, /updated_at < database_now - interval '10 minutes'/));
check(() => assert.match(scheduledWorkerMigration, /status = 'delivery_unknown'/));
check(() => assert.match(scheduledWorkerMigration, /revoke all on function public\.reconcile_stale_scheduled_company_facebook_publications\(integer\)[\s\S]*from public, anon, authenticated, service_role/));
check(() => assert.match(scheduledWorkerMigration, /grant execute on function public\.reconcile_stale_scheduled_company_facebook_publications\(integer\)[\s\S]*to service_role/));
check(() => assert.doesNotMatch(scheduledWorkerMigration, /\bp_now\b|\bp_timestamp\b/));
const reconciliationAuditSection = scheduledWorkerMigration.match(/insert into public\.audit_events[\s\S]*?reconciled_count :=/)?.[0] ?? '';
check(() => assert.match(reconciliationAuditSection, /updated_publication\.approved_by[\s\S]*updated_publication\.scheduled_by_name[\s\S]*updated_publication\.scheduled_by_role/));
check(() => assert.match(reconciliationAuditSection, /'schedulerRecovery', true/));
check(() => assert.doesNotMatch(reconciliationAuditSection, /facebook_page_id|providerPostId|providerMediaId|token_envelope|storage_path|'message'/i));
check(() => assert.match(ciWorkflow, /meta-social-publish-scheduled-worker/));
check(() => assert.match(ciWorkflow, /meta-scheduled-worker-deno-tests\.ts/));
check(() => assert.match(denoScheduledWorkerTests, /dependencyCalls, 0/));
check(() => assert.match(reviewMigration, /if exists \(\s*select 1\s+from public\.company_media_analysis_privacy_findings/s));
check(() => assert.doesNotMatch(migration, /'Authenticated user', 'publisher'/));
check(() => assert.match(combinedMigrations, /p_actor_id, btrim\(p_actor_name\), btrim\(p_actor_role\)/));
check(() => assert.doesNotMatch(combinedMigrations, /raw provider|access token|app secret|fbtrace/i));
check(() => assert.match(schema, /-- META_FACEBOOK_PUBLISH_SCHEMA_BEGIN/));
check(() => assert.match(schema, /-- META_FACEBOOK_PUBLISH_SCHEMA_END/));
check(() => assert.match(schema, /-- META_FACEBOOK_SINGLE_PHOTO_PUBLISH_REVIEW_FIX_BEGIN/));
check(() => assert.match(schema, /-- META_FACEBOOK_SINGLE_PHOTO_PUBLISH_REVIEW_FIX_END/));
check(() => assert.match(aclMigration, /-- META_FACEBOOK_PUBLISH_ACL_FIX_BEGIN/));
check(() => assert.match(aclMigration, /-- META_FACEBOOK_PUBLISH_ACL_FIX_END/));
check(() => assert.match(aclMigration, /revoke all privileges\s+on table public\.company_social_publications\s+from service_role;/i));
check(() => assert.match(aclMigration, /grant select, insert, update\s+on table public\.company_social_publications\s+to service_role;/i));
check(() => assert.match(aclMigration, /revoke all privileges\s+on table public\.company_social_publications\s+from public, anon, authenticated;/i));
check(() => assert.ok(
  aclMigration.indexOf('from service_role;') < aclMigration.indexOf('grant select, insert, update'),
));
const serviceRoleGrantStatements = aclMigration.match(/grant[\s\S]*?to service_role;/gi) ?? [];
check(() => assert.equal(serviceRoleGrantStatements.length, 1));
check(() => assert.doesNotMatch(serviceRoleGrantStatements[0], /\b(?:delete|truncate|references|trigger|maintain)\b/i));
check(() => assert.doesNotMatch(aclMigration, /grant all(?: privileges)?[\s\S]*?service_role/i));
check(() => assert.doesNotMatch(aclMigration, /alter default privileges/i));
check(() => assert.match(schema, /-- META_FACEBOOK_PUBLISH_ACL_FIX_BEGIN/));
check(() => assert.match(schema, /-- META_FACEBOOK_PUBLISH_ACL_FIX_END/));
check(() => assert.match(schema, /publication_intent_sha256 bytea/));
check(() => assert.match(schema, /company_social_publication_media_approvals/));
check(() => assert.match(schema, /company_social_publications_company_intent_unique/));
check(() => assert.match(schema, /company_media_analysis_runs/));
check(() => assert.match(schema, /-- META_FACEBOOK_SCHEDULED_PUBLICATION_FOUNDATION_BEGIN/));
check(() => assert.match(schema, /-- META_FACEBOOK_SCHEDULED_PUBLICATION_FOUNDATION_END/));

check(() => assert.match(ciWorkflow, /permissions:\s+contents: read/s));
check(() => assert.match(ciWorkflow, /meta-publishing-node:/));
check(() => assert.match(ciWorkflow, /meta-publishing-sql:/));
check(() => assert.match(ciWorkflow, /meta-image-sanitizer-deno:/));
check(() => assert.match(ciWorkflow, /full-build:/));
check(() => assert.match(ciWorkflow, /node-version: '22\.17\.1'/));
check(() => assert.match(ciWorkflow, /denoland\/setup-deno@v2/));
check(() => assert.match(ciWorkflow, /deno-version: '2\.1\.4'/));
check(() => assert.match(ciWorkflow, /deno check .*imageProcessor\.js/));
check(() => assert.match(ciWorkflow, /deno test .*--allow-net=deno\.land.*meta-image-sanitizer-deno-tests\.ts/));
check(() => assert.match(ciWorkflow, /npm run test:meta-publishing-sql/));
check(() => assert.match(ciWorkflow, /npm run build/));
check(() => assert.doesNotMatch(ciWorkflow, /deploy|supabase db push|supabase functions deploy|production|secrets\./i));

const telemetryShape = service.match(/safePublishingTelemetry\(\{([\s\S]*?)\}\)/g) ?? [];
check(() => assert.ok(telemetryShape.length >= 3));
for (const shape of telemetryShape) {
  check(() => assert.doesNotMatch(shape, /\b(?:message|messageSha256|pageId|jobId|publicationId|actorId|token|endpoint|request|response|body)\s*:/));
}

const distPath = new URL('../dist', import.meta.url);
if (await exists(distPath)) {
  const bundle = await readTree(fileURLToPath(distPath));
  for (const forbidden of [
    /META_APP_SECRET/,
    /META_TOKEN_ENCRYPTION_KEY/,
    /SUPABASE_SERVICE_ROLE_KEY/,
    /fake-page-token-sensitive/,
    /appsecret_proof/,
    /company_social_publications/,
  ]) {
    check(() => assert.doesNotMatch(bundle, forbidden));
  }
}

console.log(`Meta publishing security scan passed: ${checks}`);

async function exists(url) {
  try { await stat(url); return true; } catch { return false; }
}

async function readTree(directory) {
  let output = '';
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output += await readTree(path);
    else if (/\.(?:js|css|html|map)$/i.test(entry.name)) output += await readFile(path, 'utf8');
  }
  return output;
}
