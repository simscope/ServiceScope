import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');
const [
  client, browserContracts, producer, worker, repository, contracts, artifacts,
  requestApi, queueApi, migration, schema, packageJson, vercel, aiEdge, director,
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
  read('supabase/schema.sql'),
  read('package.json'),
  read('vercel.json'),
  read('supabase/functions/ai-content-generate/index.ts'),
  read('supabase/functions/_shared/reel-engine/director.js'),
]);

let checks = 0;
const check = (fn) => { fn(); checks += 1; };
const renderRequestBody = client.match(/'\/api\/reel-render-request',\s*\{([^}]+)\}/)?.[1] ?? '';
check(() => assert.match(renderRequestBody, /creativePlanId/));
check(() => assert.match(renderRequestBody, /expectedPlanRevision/));
for (const forbidden of ['companyId', 'jobId', 'localFacts', 'plan', 'scenes', 'bucket', 'outputPath', 'manifest']) {
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
check(() => assert.match(worker, /repository\.loadAuthority\(claim\)/));
check(() => assert.match(worker, /authorize\(\{ plan: authority\.plan, context: authority\.context \}\)/));
check(() => assert.match(worker, /mkdtemp\(join\(tmpdir\(\)/));
check(() => assert.match(worker, /writeFile\(join\(stagingRoot/));
check(() => assert.doesNotMatch(worker, /https?:\/\/|signedURL|fetch\(/));
check(() => assert.match(repository, /company_reel_creative_plans/));
check(() => assert.match(repository, /localFacts: planRow\.local_facts/));
check(() => assert.match(repository, /createHash\('sha256'\)/));
check(() => assert.match(repository, /current_checksum_matches/));
check(() => assert.match(repository, /storage_bucket: undefined/));
check(() => assert.match(repository, /storage_path: undefined/));
check(() => assert.doesNotMatch(browserContracts, /output_bucket|object_path|lease_token|leased_until|local_facts/));
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
check(() => assert.doesNotMatch(`${worker}\n${repository}\n${producer}\n${migration}`, /meta_social|facebook|graph\.facebook|\/feed|\/photos/i));
check(() => assert.doesNotMatch(packageJson, /ffmpeg-static|ffprobe-static/));
check(() => assert.match(packageJson, /"@vercel\/queue": "\^0\.4\.0"/));
check(() => assert.match(vercel, /"topic"\s*:\s*"servicescope-reel-render-v1"/));
check(() => assert.match(vercel, /"source"\s*:\s*"\/auth\/meta\/callback"/));

const begin = migration.match(/create or replace function public\.begin_company_reel_render_request[\s\S]*?\$\$;/)?.[0] ?? '';
check(() => assert.doesNotMatch(begin, /p_company_id|p_job_id|p_plan_json|p_render_fingerprint|p_output/));
check(() => assert.match(begin, /auth\.uid\(\)/));
const safeRead = migration.match(/create or replace function public\.get_company_reel_workspace[\s\S]*?\$\$;/)?.[0] ?? '';
check(() => assert.doesNotMatch(safeRead.match(/returns table \([\s\S]*?\)/)?.[0] ?? '', /local_facts|media_plan|output_bucket|object_path|lease/));
check(() => assert.equal((schema.match(/-- REEL_RENDER_JOBS_BEGIN/g) ?? []).length, 1));
check(() => assert.equal((schema.match(/-- REEL_RENDER_JOBS_END/g) ?? []).length, 1));

console.log(`Reel render job security scan passed (${checks}/${checks}).`);
