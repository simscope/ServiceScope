import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { extractExactMarkedBlock, normalizeSqlForParity } from './meta-canonical-schema.mjs';

const migration = await readFile('supabase/migrations/20260809234500_reel_render_jobs.sql', 'utf8');
const schema = await readFile('supabase/schema.sql', 'utf8');
const markers = { begin: '-- REEL_RENDER_JOBS_BEGIN', end: '-- REEL_RENDER_JOBS_END', label: 'Reel render jobs' };
const block = extractExactMarkedBlock(migration, markers);
let checks = 0;
const check = (fn) => { fn(); checks += 1; };
check(() => assert.equal(normalizeSqlForParity(block), normalizeSqlForParity(extractExactMarkedBlock(schema, markers))));

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.email',true),'') $$;
  create table public.companies(id uuid primary key, owner_email text not null);
  create table public.jobs(id uuid primary key, company_id uuid not null references public.companies(id));
  create table public.job_attachments(id uuid primary key, company_id uuid not null references public.companies(id), job_id uuid not null references public.jobs(id));
  create table storage.buckets(id text primary key,name text not null,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create function public.can_access_company(target uuid) returns boolean language sql stable as $$
    select target::text = current_setting('test.company_id',true)
  $$;
`);
await db.exec(block);

const ids = {
  company: '00000000-0000-4000-8000-000000009001', otherCompany: '00000000-0000-4000-8000-000000009002',
  job: '00000000-0000-4000-8000-000000009101', user: '00000000-0000-4000-8000-000000009201',
  otherUser: '00000000-0000-4000-8000-000000009202',
  plan: '00000000-0000-4000-8000-000000009301', attachment1: '00000000-0000-4000-8000-000000009401',
  attachment2: '00000000-0000-4000-8000-000000009402',
};
await db.query('insert into auth.users(id) values($1),($2)', [ids.user, ids.otherUser]);
await db.query("insert into public.companies values($1,'owner@example.com'),($2,'other@example.com')", [ids.company, ids.otherCompany]);
await db.query('insert into public.jobs values($1,$2)', [ids.job, ids.company]);
await db.query('insert into public.job_attachments values($1,$2,$3),($4,$2,$3)', [ids.attachment1, ids.company, ids.job, ids.attachment2]);
await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email','owner@example.com',false),set_config('test.company_id',$2,false)", [ids.user, ids.company]);

const localFacts = { diagnosis: 'A failed relay stopped cooling.', repairPerformed: 'The relay was replaced.', finalResult: 'Cooling was restored.' };
const mediaPlan = [{ attachmentId: ids.attachment1, position: 1 }, { attachmentId: ids.attachment2, position: 2 }];
const plan = { schemaVersion: 'reel-creative-plan-v1', revision: 'reel-v1-12345678', decision: 'create_reel' };
async function persist(value = plan, revision = plan.revision) {
  const result = await db.query(`select public.persist_company_reel_creative_plan($1,$2,$3,'reel-creative-plan-v1',$4,'en-US','reel-input-12345678',$5::jsonb,$6::jsonb,$7::jsonb) id`,
    [ids.company, ids.job, ids.user, revision, JSON.stringify(localFacts), JSON.stringify(mediaPlan), JSON.stringify(value)]);
  return result.rows[0].id;
}
const planId = await persist();
check(() => assert.ok(planId));
const repeatedPlanId = await persist();
check(() => assert.equal(repeatedPlanId, planId));
await assert.rejects(() => db.query("update public.company_reel_creative_plans set locale='fr-FR' where id=$1", [planId])); checks += 1;
const planCount = await db.query('select count(*)::int count from public.company_reel_creative_plans');
check(() => assert.equal(planCount.rows[0].count, 1));
await assert.rejects(() => persist({ ...plan, hook: 'changed' })); checks += 1;
await assert.rejects(() => db.query(`select public.persist_company_reel_creative_plan($1,$2,$3,'reel-creative-plan-v1','reel-v1-badmedia','en-US','reel-input-12345678',$4::jsonb,$5::jsonb,$6::jsonb)`,
  [ids.company, ids.job, ids.user, JSON.stringify(localFacts), JSON.stringify([{ attachmentId: ids.attachment1, position: 2 }]), JSON.stringify({ ...plan, revision: 'reel-v1-badmedia' })])); checks += 1;

async function begin(expected = plan.revision, creativePlanId = planId) {
  const result = await db.query('select * from public.begin_company_reel_render_request($1,$2)', [creativePlanId, expected]);
  return result.rows[0];
}
const first = await begin();
check(() => assert.equal(first.status, 'queued'));
check(() => assert.match(first.render_job_id, /^[0-9a-f-]{36}$/));
const repeatedBegin = await begin();
check(() => assert.equal(repeatedBegin.render_job_id, first.render_job_id));
const renderJobCount = await db.query('select count(*)::int count from public.company_reel_render_jobs');
check(() => assert.equal(renderJobCount.rows[0].count, 1));
const renderFingerprint = await db.query('select render_fingerprint from public.company_reel_render_jobs');
check(() => assert.match(renderFingerprint.rows[0].render_fingerprint, /^[0-9a-f]{64}$/));
await assert.rejects(() => db.query('update public.company_reel_render_jobs set requested_by=$1 where id=$2', [ids.otherUser, first.render_job_id])); checks += 1;
const workspace = await db.query('select * from public.get_company_reel_workspace($1)', [ids.job]);
check(() => assert.equal(workspace.rows[0].creative_plan_id, planId));
check(() => assert.ok(!Object.hasOwn(workspace.rows[0], 'local_facts')));
await assert.rejects(() => begin('reel-v1-wrong')); checks += 1;
await db.query("select set_config('test.company_id',$1,false),set_config('request.jwt.claim.email','other@example.com',false)", [ids.otherCompany]);
await assert.rejects(() => begin()); checks += 1;
await assert.rejects(() => db.query('select * from public.get_company_reel_workspace($1)', [ids.job])); checks += 1;
await db.query("select set_config('test.company_id',$1,false),set_config('request.jwt.claim.email','owner@example.com',false)", [ids.company]);

const claim1 = await db.query('select * from public.claim_company_reel_render_job($1,60)', [first.render_job_id]);
check(() => assert.equal(claim1.rows.length, 1));
check(() => assert.equal(claim1.rows[0].attempt_count, 1));
const token1 = claim1.rows[0].lease_token;
const concurrentClaim = await db.query('select * from public.claim_company_reel_render_job($1,60)', [first.render_job_id]);
check(() => assert.equal(concurrentClaim.rows.length, 0));
await db.query("update public.company_reel_render_jobs set leased_until=clock_timestamp()-interval '1 second' where id=$1", [first.render_job_id]);
const claim2 = await db.query('select * from public.claim_company_reel_render_job($1,60)', [first.render_job_id]);
check(() => assert.equal(claim2.rows[0].attempt_count, 2));
check(() => assert.notEqual(claim2.rows[0].lease_token, token1));
const token2 = claim2.rows[0].lease_token;
const paths = [`${ids.company}/${first.render_job_id}/reel.mp4`, `${ids.company}/${first.render_job_id}/cover.jpg`];
const wrongComplete = await db.query(`select * from public.complete_company_reel_render_job($1,$2,'company-reel-renders',$3,$4,13800,1080,1920,30,'h264','yuv420p',0,702252,true)`, [first.render_job_id, token1, ...paths]);
check(() => assert.equal(wrongComplete.rows.length, 0));
const complete = await db.query(`select * from public.complete_company_reel_render_job($1,$2,'company-reel-renders',$3,$4,13800,1080,1920,30,'h264','yuv420p',0,702252,true)`, [first.render_job_id, token2, ...paths]);
check(() => assert.equal(complete.rows[0].status, 'completed'));
const completedClaim = await db.query('select * from public.claim_company_reel_render_job($1,60)', [first.render_job_id]);
check(() => assert.equal(completedClaim.rows.length, 0));

const failedRevision = 'reel-v1-87654321';
const failedPlanId = await persist({ ...plan, revision: failedRevision }, failedRevision);
const failedJob = await begin(failedRevision, failedPlanId);
const failedClaim = (await db.query('select * from public.claim_company_reel_render_job($1,60)', [failedJob.render_job_id])).rows[0];
const wrongFail = await db.query("select * from public.fail_company_reel_render_job($1,$2,'REEL_RENDER_MEDIA_MISSING')", [failedJob.render_job_id, token2]);
check(() => assert.equal(wrongFail.rows.length, 0));
await assert.rejects(() => db.query("select * from public.fail_company_reel_render_job($1,$2,'RAW_INTERNAL_ERROR')", [failedJob.render_job_id, failedClaim.lease_token])); checks += 1;
const failed = await db.query("select * from public.fail_company_reel_render_job($1,$2,'REEL_RENDER_MEDIA_MISSING')", [failedJob.render_job_id, failedClaim.lease_token]);
check(() => assert.equal(failed.rows[0].status, 'failed'));
check(() => assert.equal(failed.rows[0].error_code, 'REEL_RENDER_MEDIA_MISSING'));

const tableSecurity = await db.query(`select
  (select relrowsecurity from pg_class where oid='public.company_reel_creative_plans'::regclass) plans_rls,
  (select relrowsecurity from pg_class where oid='public.company_reel_render_jobs'::regclass) jobs_rls,
  has_table_privilege('authenticated','public.company_reel_creative_plans','SELECT') auth_plan_select,
  has_table_privilege('authenticated','public.company_reel_render_jobs','UPDATE') auth_job_update,
  has_function_privilege('authenticated','public.get_company_reel_workspace(uuid)','EXECUTE') auth_read,
  has_function_privilege('anon','public.get_company_reel_workspace(uuid)','EXECUTE') anon_read,
  has_function_privilege('authenticated','public.claim_company_reel_render_job(uuid,integer)','EXECUTE') auth_claim,
  has_function_privilege('service_role','public.claim_company_reel_render_job(uuid,integer)','EXECUTE') service_claim`);
for (const key of ['plans_rls','jobs_rls','auth_read','service_claim']) check(() => assert.equal(tableSecurity.rows[0][key], true));
for (const key of ['auth_plan_select','auth_job_update','auth_claim','anon_read']) check(() => assert.equal(tableSecurity.rows[0][key], false));
const tenantConstraints = await db.query(`select conname from pg_constraint where conname in (
  'company_reel_creative_plans_job_tenant_fk','company_reel_render_jobs_job_tenant_fk',
  'company_reel_render_jobs_plan_tenant_fk','company_reel_creative_plans_tenant_identity_unique'
)`);
check(() => assert.equal(tenantConstraints.rows.length, 4));
const safeWorkspaceColumns = await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='company_reel_creative_plans'");
check(() => assert.ok(safeWorkspaceColumns.rows.some((row) => row.column_name === 'local_facts')));
check(() => assert.ok(!block.match(/returns table \([^)]*local_facts/is)));
const bucket = await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='company-reel-renders'");
check(() => assert.equal(bucket.rows[0].public, false));
check(() => assert.equal(Number(bucket.rows[0].file_size_limit), 104857600));
check(() => assert.deepEqual(bucket.rows[0].allowed_mime_types, ['video/mp4','image/jpeg']));
check(() => assert.doesNotMatch(migration, /create policy[\s\S]*company-reel-renders/i));
check(() => assert.doesNotMatch(migration, /\b(?:update|delete)\s+public\.(?:jobs|job_attachments|company_social)/i));

await db.close();
console.log(`Reel render job SQL regression tests passed (${checks}/${checks}).`);
