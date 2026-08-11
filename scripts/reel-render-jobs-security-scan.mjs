import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');
const [
  client, browserContracts, producer, worker, repository, contracts, artifacts,
  requestApi, queueApi, migration, upgradeMigration, schema, packageJson, vercel, aiEdge, director,
  dispatchRecovery, assistantPage, supabaseHttp, queueConsumer, renderState,
] = await Promise.all([
  read('src/features/reel-render-jobs/clientApi.ts'),
  read('src/features/reel-render-jobs/contracts.ts'),
  read('server/reel-render-jobs/producer.js'),
  read('server/reel-render-jobs/worker.js'),
  read('server/reel-render-jobs/repository.js'),
  read('server/reel-render-jobs/contracts.js'),
  read('server/reel-render-jobs/artifacts.js'),
  read('api/reel-render-request.js'),
  read('api/queues/reel-render.js'),
  read('supabase/migrations/20260809234500_reel_render_jobs.sql'),
  read('supabase/migrations/20260811022000_reel_renderer_v2_contract.sql'),
  read('supabase/schema.sql'),
  read('package.json'),
  read('vercel.json'),
  read('supabase/functions/ai-content-generate/index.ts'),
  read('supabase/functions/_shared/reel-engine/director.js'),
  read('src/features/reel-render-jobs/dispatchRecovery.js'),
  read('src/components/portal/AiAssistantPage.tsx'),
  read('server/reel-render-jobs/supabaseHttp.js'),
  read('server/reel-render-jobs/queueConsumer.js'),
  read('src/features/reel-render-jobs/renderState.js'),
]);

let checks = 0;
const check = (fn) => { fn(); checks += 1; };
const renderRequestBody = client.match(/'\/api\/reel-render-request',\s*\{([^}]+)\}/)?.[1] ?? '';
check(() => assert.match(renderRequestBody, /creativePlanId/));
check(() => assert.match(renderRequestBody, /expectedPlanRevision/));
for (const forbidden of ['companyId', 'jobId', 'localFacts', 'plan', 'scenes', 'bucket', 'outputPath', 'manifest', 'rendererVersion', 'renderer_version', 'renderFingerprint', 'render_fingerprint']) {
  check(() => assert.doesNotMatch(renderRequestBody, new RegExp(`\\b${forbidden}\\b`, 'i')));
}
check(() => assert.match(producer, /parseRenderRequest/));
check(() => assert.match(contracts, /new Set\(\['creativePlanId', 'expectedPlanRevision'\]\)/));
check(() => assert.match(contracts, /new Set\(\['schemaVersion', 'renderJobId'\]\)/));
check(() => assert.match(contracts, /return \{ schemaVersion: reelRenderMessageSchema, renderJobId:/));
check(() => assert.doesNotMatch(contracts.match(/function renderMessage[\s\S]*?\n\}/)?.[0] ?? '', /plan|localFacts|companyId|job_id/));
check(() => assert.match(requestApi, /idempotencyKey: renderJobId/));
check(() => assert.match(requestApi, /REEL_RENDER_ENABLED === 'true'/));
check(() => assert.doesNotMatch(requestApi, /=== 'false'|!== 'false'/));
check(() => assert.match(queueApi, /handleNodeCallback/));
check(() => assert.match(queueApi, /REEL_RENDER_ENABLED === 'true'/));
check(() => assert.doesNotMatch(queueApi, /deliveryCount/));
check(() => assert.match(queueApi, /visibilityTimeoutSeconds: reelQueueVisibilitySeconds/));
check(() => assert.match(queueApi, /retry: reelQueueRetry/));
check(() => assert.doesNotMatch(queueApi, /status: 'disabled'/));
check(() => assert.match(queueConsumer, /parseRenderMessage\(message\)/));
check(() => assert.match(queueConsumer, /if \(!enabled\(\)\) throw new RenderJobError\('REEL_RENDER_NOT_CONFIGURED'/));
check(() => assert.match(queueConsumer, /status: 'ignored'/));
check(() => assert.match(queueConsumer, /reelQueueDisabledRetryDelaySeconds/));
check(() => assert.match(queueConsumer, /reelQueueRetryDelaySeconds/));
check(() => assert.ok(queueConsumer.indexOf('parseRenderMessage(message)') < queueConsumer.indexOf('if (!enabled())')));
check(() => assert.match(contracts, /reelRendererVersion = 'servicescope-reel-renderer-v2'/));
check(() => assert.match(worker, /claim\.renderer_version !== reelRendererVersion/));
const mismatchGuard = worker.indexOf('claim.renderer_version !== reelRendererVersion');
check(() => assert.ok(mismatchGuard > worker.indexOf('repository.claim(renderJobId)')));
for (const protectedOperation of ['repository.loadAuthority(claim)', 'createStagingRoot()', 'render({', 'repository.upload(']) {
  check(() => assert.ok(mismatchGuard < worker.indexOf(protectedOperation)));
}
const mismatchFailure = worker.match(/async function failRendererVersionMismatch[\s\S]*?\n\}/)?.[0] ?? '';
check(() => assert.match(mismatchFailure, /repository\.fail\(claim\.id, claim\.lease_token, 'REEL_RENDER_CONTEXT_STALE'\)/));
check(() => assert.match(mismatchFailure, /return retryOrFail\(repository, claim\)/));
check(() => assert.doesNotMatch(mismatchFailure, /renderer_version\s*=/));
check(() => assert.match(worker, /repository\.loadAuthority\(claim\)/));
check(() => assert.match(worker, /authorize\(\{ plan: authority\.plan, context: authority\.context \}\)/));
check(() => assert.match(worker, /mkdtemp\(join\(tmpdir\(\)/));
check(() => assert.match(worker, /writeFile\(join\(stagingRoot/));
check(() => assert.doesNotMatch(worker, /https?:\/\/|signedURL|fetch\(/));
check(() => assert.match(repository, /company_reel_creative_plans/));
check(() => assert.match(repository, /localFacts: planRow\.local_facts/));
check(() => assert.match(repository, /createHash\('sha256'\)/));
check(() => assert.match(repository, /current_checksum_matches/));
check(() => assert.match(repository, /client\.downloadBounded\(row\.storage_bucket, row\.storage_path, reelRenderMaxMediaBytes\)/));
check(() => assert.doesNotMatch(repository, /client\.download\(/));
check(() => assert.match(supabaseHttp, /contentLength > maxBytes/));
check(() => assert.match(supabaseHttp, /response\.body\.getReader\(\)/));
check(() => assert.match(supabaseHttp, /length \+ chunk\.byteLength > maxBytes/));
check(() => assert.match(supabaseHttp, /reader\.cancel\(\)/));
check(() => assert.match(supabaseHttp, /bytes\.subarray\(0, length\)/));
check(() => assert.doesNotMatch(supabaseHttp, /arrayBuffer\(/));
check(() => assert.match(repository, /storage_bucket: undefined/));
check(() => assert.match(repository, /storage_path: undefined/));
check(() => assert.match(repository, /release_company_reel_render_job_for_retry/));
check(() => assert.match(worker, /repository\.release\(claim\.id, claim\.lease_token\)/));
check(() => assert.match(worker, /claim\.attempt_count >= reelRenderMaxAttempts/));
check(() => assert.match(worker, /status === 'completed' \|\| status === 'failed' \|\| status === null/));
check(() => assert.doesNotMatch(browserContracts, /output_bucket|object_path|lease_token|leased_until|local_facts/));
check(() => assert.match(browserContracts, /creativePlanId\?: string/));
check(() => assert.match(browserContracts, /planRevision\?: string/));
check(() => assert.doesNotMatch(client, /SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY/));
check(() => assert.doesNotMatch(browserContracts, /SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY/));
check(() => assert.match(artifacts, /reelArtifactTtlSeconds/));
check(() => assert.match(artifacts, /Cache-Control': 'no-store'/));
check(() => assert.doesNotMatch(migration, /signed_?url|signedURL/i));
check(() => assert.match(migration, /'company-reel-renders', 'company-reel-renders', false/));
check(() => assert.match(migration, /array\['video\/mp4','image\/jpeg'\]/));
check(() => assert.match(migration, /revoke all on public\.company_reel_render_jobs from public, anon, authenticated/));
check(() => assert.match(migration, /company_reel_render_jobs_fingerprint_unique/));
check(() => assert.match(migration, /company_reel_creative_plans_immutable/));
check(() => assert.match(migration, /company_reel_render_jobs_identity_immutable/));
check(() => assert.match(aiEdge, /persist_company_reel_creative_plan/));
check(() => assert.match(director, /plan\.decision !== 'create_reel'/));
check(() => assert.match(director, /mediaPlan: request\.mediaPlan\.map/));
check(() => assert.doesNotMatch(director.match(/async function persistCreativePlan[\s\S]*?\n\}/)?.[0] ?? '', /token|signed|storage|providerRaw|prompt/));
check(() => assert.doesNotMatch(`${worker}\n${repository}\n${producer}`, /stderr|error\.stack|error\.message/));
check(() => assert.doesNotMatch(`${worker}\n${repository}\n${producer}\n${migration}\n${upgradeMigration}`, /meta_social|facebook|graph\.facebook|\/feed|\/photos/i));
check(() => assert.doesNotMatch(packageJson, /ffmpeg-static|ffprobe-static/));
check(() => assert.match(packageJson, /"@vercel\/queue": "\^0\.4\.0"/));
check(() => assert.match(vercel, /"topic"\s*:\s*"servicescope-reel-render-v1"/));
check(() => assert.match(vercel, /"source"\s*:\s*"\/auth\/meta\/callback"/));
check(() => assert.match(vercel, /"maxDuration"\s*:\s*300/));
check(() => assert.match(contracts, /reelWorkerMaxDurationSeconds = 300/));
check(() => assert.match(contracts, /reelWorkerLeaseSeconds = 360/));
check(() => assert.match(contracts, /reelQueueVisibilitySeconds = 360/));
check(() => assert.match(producer, /REEL_RENDER_DISPATCH_FAILED/));
check(() => assert.match(producer, /attempt <= reelDispatchMaxAttempts/));
check(() => assert.match(dispatchRecovery, /REEL_DISPATCH_RECOVERY_INTERVAL_MS = 60_000/));
check(() => assert.match(dispatchRecovery, /workspace\?\.render_status === 'queued'/));
check(() => assert.match(assistantPage, /recoverQueuedReelDispatch\(saved, activeScope\)/));
check(() => assert.match(assistantPage, /reelDispatchRecoveryAtRef/));
check(() => assert.match(renderState, /reconcileReelRenderForPlan/));
check(() => assert.match(renderState, /isReelAsyncScopeCurrent/));
check(() => assert.match(renderState, /sameReelPlanIdentity/));
check(() => assert.match(assistantPage, /return idleReelRender\(nextIdentity\)/));
check(() => assert.match(assistantPage, /sameReelPlanIdentity\(startedScope, savedIdentity\)/));
check(() => assert.match(assistantPage, /activeReelRender\.videoUrl/));
check(() => assert.doesNotMatch(assistantPage, /reelRender\.videoUrl/));
check(() => assert.match(assistantPage, /beginReelRender\(creativePlanId, revision\)/));

check(() => assert.match(migration, /company_reel_render_jobs_renderer_check[\s\S]*servicescope-reel-renderer-v1/));
check(() => assert.doesNotMatch(migration, /servicescope-reel-renderer-v2/));
check(() => assert.match(upgradeMigration, /REEL_RENDERER_V2_MIGRATION_REQUIRES_EMPTY_RENDER_JOBS/));
check(() => assert.match(upgradeMigration, /company_reel_render_jobs_renderer_check[\s\S]*servicescope-reel-renderer-v2/));
check(() => assert.doesNotMatch(upgradeMigration, /servicescope-reel-renderer-v1/));
check(() => assert.match(schema, /company_reel_render_jobs_renderer_check\s+check \(renderer_version = 'servicescope-reel-renderer-v2'\)/));
const begin = upgradeMigration.match(/create or replace function public\.begin_company_reel_render_request[\s\S]*?\$\$;/)?.[0] ?? '';
check(() => assert.doesNotMatch(begin, /p_company_id|p_job_id|p_plan_json|p_render_fingerprint|p_output/));
check(() => assert.match(begin, /auth\.uid\(\)/));
check(() => assert.match(begin, /can_access_company_ai_assistant\(plan\.company_id\)/));
check(() => assert.doesNotMatch(begin, /can_access_company\(/));
check(() => assert.match(begin, /current_renderer_version constant text :=\s*'servicescope-reel-renderer-v2'/));
check(() => assert.match(begin, /current_renderer_version, 'reel-presentation-v1'/));
check(() => assert.match(begin, /fingerprint, current_renderer_version/));
check(() => assert.match(upgradeMigration, /revoke all on function public\.begin_company_reel_render_request\(uuid,text\) from public, anon/));
check(() => assert.match(upgradeMigration, /grant execute on function public\.begin_company_reel_render_request\(uuid,text\) to authenticated/));
const safeRead = migration.match(/create or replace function public\.get_company_reel_workspace[\s\S]*?\$\$;/)?.[0] ?? '';
check(() => assert.doesNotMatch(safeRead.match(/returns table \([\s\S]*?\)/)?.[0] ?? '', /local_facts|media_plan|output_bucket|object_path|lease/));
check(() => assert.match(safeRead, /can_access_company_ai_assistant\(target_company_id\)/));
check(() => assert.doesNotMatch(safeRead, /can_access_company\(/));
const aiAccess = migration.match(/create or replace function public\.can_access_company_ai_assistant[\s\S]*?\$\$;/)?.[0] ?? '';
check(() => assert.match(aiAccess, /company\.owner_email/));
check(() => assert.match(aiAccess, /company_user\.status = 'active'/));
check(() => assert.match(aiAccess, /profile\.access_rules->>'aiAssistant'/));
check(() => assert.match(aiAccess, /company_user\.portal_access_rules->>'aiAssistant'/));
check(() => assert.match(aiAccess, /company_user\.role::text = 'technician' then 'off'/));
check(() => assert.doesNotMatch(aiAccess, /can_access_company\(/));
const release = migration.match(/create or replace function public\.release_company_reel_render_job_for_retry[\s\S]*?\$\$;/)?.[0] ?? '';
check(() => assert.match(release, /job\.lease_token=p_lease_token/));
check(() => assert.match(release, /leased_until=clock_timestamp\(\)/));
check(() => assert.match(migration, /revoke all on function public\.release_company_reel_render_job_for_retry\(uuid,uuid\) from public, anon, authenticated/));
check(() => assert.match(migration, /grant execute on function public\.release_company_reel_render_job_for_retry\(uuid,uuid\) to service_role/));
check(() => assert.equal((schema.match(/-- REEL_RENDER_JOBS_BEGIN/g) ?? []).length, 1));
check(() => assert.equal((schema.match(/-- REEL_RENDER_JOBS_END/g) ?? []).length, 1));

console.log(`Reel render job security scan passed (${checks}/${checks}).`);
