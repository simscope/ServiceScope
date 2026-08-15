import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { extractExactMarkedBlock, normalizeSqlForParity } from './meta-canonical-schema.mjs';
import { reelRendererVersion } from '../server/reel-render-jobs/contracts.js';

const migration = await readFile('supabase/migrations/20260809234500_reel_render_jobs.sql', 'utf8');
const upgradeMigration = await readFile('supabase/migrations/20260811022000_reel_renderer_v2_contract.sql', 'utf8');
const controlledPipelineMigration = await readFile('supabase/migrations/20260814143000_reel_render_controlled_pipeline.sql', 'utf8');
const schema = await readFile('supabase/schema.sql', 'utf8');
const markers = { begin: '-- REEL_RENDER_JOBS_BEGIN', end: '-- REEL_RENDER_JOBS_END', label: 'Reel render jobs' };
const block = extractExactMarkedBlock(migration, markers);
let checks = 0;
const check = (fn) => { fn(); checks += 1; };
const checkAsync = async (fn) => { await fn(); checks += 1; };
const beginFunction = (sql) => sql.match(/create or replace function public\.begin_company_reel_render_request[\s\S]*?\$\$;/i)?.[0] ?? '';
const namedFunction = (sql, name) => sql.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`, 'i'))?.[0] ?? '';
const constraintVersion = (sql) => sql.match(/company_reel_render_jobs_renderer_check\s+check \(renderer_version = '([^']+)'\)/i)?.[1];
const rendererConstantVersion = (sql) => sql.match(/current_renderer_version constant text :=\s*'([^']+)'/i)?.[1];
const currentSchemaBlock = extractExactMarkedBlock(schema, markers);
const normalizedUpgradeMigration = upgradeMigration.trim();
const normalizedControlledPipelineMigration = controlledPipelineMigration.trim();
const transactionBeginStatements = normalizedUpgradeMigration.match(/^\s*begin\s*;\s*$/gim) ?? [];
const transactionCommitStatements = normalizedUpgradeMigration.match(/^\s*commit\s*;\s*$/gim) ?? [];
const transactionRollbackStatements = normalizedUpgradeMigration.match(/^\s*rollback\s*;\s*$/gim) ?? [];
const transactionBeginIndex = normalizedUpgradeMigration.search(/^begin\s*;/i);
const lockIndex = normalizedUpgradeMigration.search(/lock table public\.company_reel_render_jobs in access exclusive mode/i);
const emptyTableGuardIndex = normalizedUpgradeMigration.search(/if exists \(select 1 from public\.company_reel_render_jobs\)/i);
const constraintChangeIndex = normalizedUpgradeMigration.search(/alter table public\.company_reel_render_jobs/i);
const rpcChangeIndex = normalizedUpgradeMigration.search(/create or replace function public\.begin_company_reel_render_request/i);
const transactionCommitIndex = normalizedUpgradeMigration.search(/\ncommit\s*;\s*$/i);
check(() => assert.equal(reelRendererVersion, 'servicescope-reel-renderer-v2'));
check(() => assert.equal(constraintVersion(migration), 'servicescope-reel-renderer-v1'));
check(() => assert.doesNotMatch(migration, /servicescope-reel-renderer-v2/));
check(() => assert.equal(constraintVersion(upgradeMigration), reelRendererVersion));
check(() => assert.equal(constraintVersion(currentSchemaBlock), reelRendererVersion));
check(() => assert.equal(rendererConstantVersion(upgradeMigration), reelRendererVersion));
check(() => assert.equal(rendererConstantVersion(currentSchemaBlock), reelRendererVersion));
check(() => assert.equal(normalizeSqlForParity(beginFunction(controlledPipelineMigration)), normalizeSqlForParity(beginFunction(currentSchemaBlock))));
check(() => assert.equal(normalizeSqlForParity(namedFunction(controlledPipelineMigration, 'can_manage_company_ai_assistant')), normalizeSqlForParity(namedFunction(currentSchemaBlock, 'can_manage_company_ai_assistant'))));
check(() => assert.equal(normalizeSqlForParity(namedFunction(controlledPipelineMigration, 'protect_company_reel_render_job_transition')), normalizeSqlForParity(namedFunction(currentSchemaBlock, 'protect_company_reel_render_job_transition'))));
check(() => assert.match(currentSchemaBlock, /company_reel_creative_plan_approvals/));
check(() => assert.match(currentSchemaBlock, /company_reel_render_jobs_artifact_integrity_check/));
check(() => assert.match(beginFunction(upgradeMigration), /current_renderer_version, 'reel-presentation-v1'/));
check(() => assert.match(beginFunction(upgradeMigration), /fingerprint, current_renderer_version/));
check(() => assert.match(normalizedUpgradeMigration, /^begin\s*;/i));
check(() => assert.match(normalizedUpgradeMigration, /commit\s*;$/i));
check(() => assert.equal(transactionBeginStatements.length, 1));
check(() => assert.equal(transactionCommitStatements.length, 1));
check(() => assert.equal(transactionRollbackStatements.length, 0));
check(() => assert.ok(transactionBeginIndex === 0));
check(() => assert.ok(transactionBeginIndex < lockIndex));
check(() => assert.ok(lockIndex < emptyTableGuardIndex));
check(() => assert.ok(emptyTableGuardIndex < constraintChangeIndex));
check(() => assert.ok(constraintChangeIndex < rpcChangeIndex));
check(() => assert.ok(rpcChangeIndex < transactionCommitIndex));
check(() => assert.match(normalizedControlledPipelineMigration, /^begin\s*;/i));
check(() => assert.match(normalizedControlledPipelineMigration, /commit\s*;$/i));
check(() => assert.equal((normalizedControlledPipelineMigration.match(/^\s*begin\s*;\s*$/gim) ?? []).length, 1));
check(() => assert.equal((normalizedControlledPipelineMigration.match(/^\s*commit\s*;\s*$/gim) ?? []).length, 1));
check(() => assert.doesNotMatch(controlledPipelineMigration, /\b(?:drop table|drop column|truncate|delete from)\b|disable row level security|\bcascade\b/i));

const baseDatabaseSql = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.email',true),'') $$;
  create table public.companies(id uuid primary key, owner_email text not null);
  create table public.company_profiles(company_id uuid primary key references public.companies(id), access_rules jsonb not null default '{}'::jsonb);
  create table public.company_users(
    id uuid primary key, company_id uuid not null references public.companies(id), auth_user_id uuid references auth.users(id),
    name text not null, email text not null, role text not null, status text not null,
    portal_access_rules jsonb not null default '{}'::jsonb
  );
  create table public.jobs(id uuid primary key, company_id uuid not null references public.companies(id));
  create table public.job_attachments(id uuid primary key, company_id uuid not null references public.companies(id), job_id uuid not null references public.jobs(id));
  create table storage.buckets(id text primary key,name text not null,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create function public.can_access_company(target uuid) returns boolean language sql stable as $$
    select target::text = current_setting('test.company_id',true)
  $$;
`;

async function historicalDatabase() {
  const database = new PGlite();
  await database.exec(baseDatabaseSql);
  await database.exec(block);
  return database;
}

const guardDb = await historicalDatabase();
await guardDb.exec(`
  insert into auth.users values ('00000000-0000-4000-8000-000000008001');
  insert into public.companies values ('00000000-0000-4000-8000-000000008002','guard@example.com');
  insert into public.jobs values ('00000000-0000-4000-8000-000000008003','00000000-0000-4000-8000-000000008002');
  insert into public.company_reel_creative_plans (
    id,company_id,job_id,created_by,schema_version,plan_revision,locale,planning_revision,local_facts,media_plan,plan_json
  ) values (
    '00000000-0000-4000-8000-000000008004','00000000-0000-4000-8000-000000008002',
    '00000000-0000-4000-8000-000000008003','00000000-0000-4000-8000-000000008001',
    'reel-creative-plan-v1','reel-v1-guard','en-US','reel-input-guard','{}',
    '[{"attachmentId":"a","position":1},{"attachmentId":"b","position":2}]',
    '{"schemaVersion":"reel-creative-plan-v1","revision":"reel-v1-guard","decision":"create_reel"}'
  );
  insert into public.company_reel_render_jobs (
    company_id,job_id,creative_plan_id,requested_by,status,render_fingerprint,renderer_version
  ) values (
    '00000000-0000-4000-8000-000000008002','00000000-0000-4000-8000-000000008003',
    '00000000-0000-4000-8000-000000008004','00000000-0000-4000-8000-000000008001',
    'queued','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','servicescope-reel-renderer-v1'
  );
`);
const guardBefore = (await guardDb.query('select renderer_version,render_fingerprint,count(*) over ()::int row_count from public.company_reel_render_jobs')).rows[0];
await checkAsync(() => assert.rejects(
  guardDb.exec(upgradeMigration),
  /REEL_RENDERER_V2_MIGRATION_REQUIRES_EMPTY_RENDER_JOBS/,
));
await guardDb.exec('rollback');
const guardAfter = (await guardDb.query('select renderer_version,render_fingerprint,count(*) over ()::int row_count from public.company_reel_render_jobs')).rows[0];
check(() => assert.deepEqual(guardAfter, guardBefore));
const guardedConstraintVersion = await databaseConstraintVersion(guardDb);
check(() => assert.equal(guardedConstraintVersion, 'servicescope-reel-renderer-v1'));
await guardDb.close();

const db = await historicalDatabase();
await db.exec(upgradeMigration);
await db.exec(controlledPipelineMigration);
const upgradedConstraintVersion = await databaseConstraintVersion(db);
check(() => assert.equal(upgradedConstraintVersion, reelRendererVersion));

async function databaseConstraintVersion(database) {
  const result = await database.query("select pg_get_constraintdef(oid) definition from pg_constraint where conname='company_reel_render_jobs_renderer_check'");
  return result.rows[0]?.definition.match(/renderer_version = '([^']+)'/)?.[1];
}

const ids = {
  company: '00000000-0000-4000-8000-000000009001', otherCompany: '00000000-0000-4000-8000-000000009002',
  job: '00000000-0000-4000-8000-000000009101', user: '00000000-0000-4000-8000-000000009201',
  otherUser: '00000000-0000-4000-8000-000000009202',
  manager: '00000000-0000-4000-8000-000000009203', dispatcher: '00000000-0000-4000-8000-000000009204',
  technician: '00000000-0000-4000-8000-000000009205', technicianFull: '00000000-0000-4000-8000-000000009206',
  explicitOff: '00000000-0000-4000-8000-000000009207', disabled: '00000000-0000-4000-8000-000000009208',
  readOnly: '00000000-0000-4000-8000-000000009209',
  plan: '00000000-0000-4000-8000-000000009301',
  otherJob: '00000000-0000-4000-8000-000000009102',
  attachment1: '00000000-0000-4000-8000-000000009401', attachment2: '00000000-0000-4000-8000-000000009402',
  attachment3: '00000000-0000-4000-8000-000000009403',
  otherAttachment1: '00000000-0000-4000-8000-000000009404', otherAttachment2: '00000000-0000-4000-8000-000000009405',
};
await db.query('insert into auth.users(id) select unnest($1::uuid[])', [[
  ids.user, ids.otherUser, ids.manager, ids.dispatcher, ids.technician, ids.technicianFull, ids.explicitOff, ids.disabled, ids.readOnly,
]]);
await db.query("insert into public.companies values($1,'owner@example.com'),($2,'other@example.com')", [ids.company, ids.otherCompany]);
await db.query("insert into public.company_profiles values($1,'{\"aiAssistant\":\"full\"}'::jsonb),($2,'{\"aiAssistant\":\"full\"}'::jsonb)", [ids.company, ids.otherCompany]);
await db.query(`insert into public.company_users(id,company_id,auth_user_id,name,email,role,status,portal_access_rules) values
  ($1,$9,$1,'Manager','manager@example.com','manager','active','{"aiAssistant":"full"}'),
  ($2,$9,$2,'Dispatcher','dispatcher@example.com','dispatcher','active','{}'),
  ($3,$9,$3,'Technician','technician@example.com','technician','active','{}'),
  ($4,$9,$4,'Technician Full','technician-full@example.com','technician','active','{"aiAssistant":"full"}'),
  ($5,$9,$5,'Explicit Off','off@example.com','manager','active','{"aiAssistant":"off"}'),
  ($6,$9,$6,'Disabled','disabled@example.com','manager','disabled','{"aiAssistant":"full"}'),
  ($7,$10,$7,'Other Manager','other@example.com','manager','active','{"aiAssistant":"full"}'),
  ($8,$9,$8,'Read Only','readonly@example.com','manager','active','{"aiAssistant":"readonly"}')`,
  [ids.manager, ids.dispatcher, ids.technician, ids.technicianFull, ids.explicitOff, ids.disabled, ids.otherUser, ids.readOnly, ids.company, ids.otherCompany]);
await db.query('insert into public.jobs values($1,$2),($3,$4)', [ids.job, ids.company, ids.otherJob, ids.otherCompany]);
await db.query('insert into public.job_attachments values($1,$2,$3),($4,$2,$3),($5,$2,$3),($6,$7,$8),($9,$7,$8)',
  [ids.attachment1, ids.company, ids.job, ids.attachment2, ids.attachment3, ids.otherAttachment1, ids.otherCompany, ids.otherJob, ids.otherAttachment2]);
await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email','owner@example.com',false),set_config('test.company_id',$2,false)", [ids.user, ids.company]);

async function setActor(userId, email) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)", [userId, email]);
}
async function aiAccess(companyId = ids.company) {
  return (await db.query('select public.can_access_company_ai_assistant($1) allowed', [companyId])).rows[0].allowed;
}
async function aiManage(companyId = ids.company) {
  return (await db.query('select public.can_manage_company_ai_assistant($1) allowed', [companyId])).rows[0].allowed;
}
await checkAsync(async () => assert.equal(await aiAccess(), true));
await checkAsync(async () => assert.equal(await aiManage(), true));
await setActor(ids.manager, 'manager@example.com'); await checkAsync(async () => assert.equal(await aiAccess(), true));
await checkAsync(async () => assert.equal(await aiManage(), true));
await setActor(ids.dispatcher, 'dispatcher@example.com'); await checkAsync(async () => assert.equal(await aiAccess(), true));
await setActor(ids.technician, 'technician@example.com'); await checkAsync(async () => assert.equal(await aiAccess(), false));
await setActor(ids.technicianFull, 'technician-full@example.com'); await checkAsync(async () => assert.equal(await aiAccess(), true));
await setActor(ids.readOnly, 'readonly@example.com'); await checkAsync(async () => assert.equal(await aiAccess(), true));
await checkAsync(async () => assert.equal(await aiManage(), false));
await setActor(ids.explicitOff, 'off@example.com'); await checkAsync(async () => assert.equal(await aiAccess(), false));
await setActor(ids.disabled, 'disabled@example.com'); await checkAsync(async () => assert.equal(await aiAccess(), false));
await setActor(ids.manager, 'manager@example.com'); await checkAsync(async () => assert.equal(await aiAccess(ids.otherCompany), false));
await db.query("update public.company_profiles set access_rules='{\"aiAssistant\":\"off\"}'::jsonb where company_id=$1", [ids.company]);
await checkAsync(async () => assert.equal(await aiAccess(), false));
await db.query("update public.company_profiles set access_rules='{\"aiAssistant\":\"full\"}'::jsonb where company_id=$1", [ids.company]);
await setActor(ids.user, 'owner@example.com');

const localFacts = { diagnosis: 'A failed relay stopped cooling.', repairPerformed: 'The relay was replaced.', finalResult: 'Cooling was restored.' };
const mediaPlan = [{ attachmentId: ids.attachment1, position: 1 }, { attachmentId: ids.attachment2, position: 2 }];
const plan = { schemaVersion: 'reel-creative-plan-v1', revision: 'reel-v1-12345678', decision: 'create_reel' };
async function persist(value = plan, revision = plan.revision, options = {}) {
  const companyId = options.companyId ?? ids.company;
  const jobId = options.jobId ?? ids.job;
  const userId = options.userId ?? ids.user;
  const selectedMediaPlan = options.mediaPlan ?? mediaPlan;
  const result = await db.query(`select public.persist_company_reel_creative_plan($1,$2,$3,'reel-creative-plan-v1',$4,'en-US','reel-input-12345678',$5::jsonb,$6::jsonb,$7::jsonb) id`,
    [companyId, jobId, userId, revision, JSON.stringify(localFacts), JSON.stringify(selectedMediaPlan), JSON.stringify(value)]);
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

await assert.rejects(() => db.query(`insert into public.company_reel_render_jobs (
  company_id,job_id,creative_plan_id,requested_by,status,render_fingerprint,renderer_version
) values ($1,$2,$3,$4,'queued',$5,'servicescope-reel-renderer-v1')`,
  [ids.company, ids.job, planId, ids.user, 'b'.repeat(64)])); checks += 1;
await db.exec('begin');
await db.query(`insert into public.company_reel_render_jobs (
  company_id,job_id,creative_plan_id,requested_by,status,render_fingerprint,renderer_version
) values ($1,$2,$3,$4,'queued',$5,$6)`,
  [ids.company, ids.job, planId, ids.user, 'c'.repeat(64), reelRendererVersion]);
const directV2 = await db.query("select renderer_version from public.company_reel_render_jobs where render_fingerprint=$1", ['c'.repeat(64)]);
check(() => assert.equal(directV2.rows[0].renderer_version, reelRendererVersion));
await db.exec('rollback');

async function begin(expected = plan.revision, creativePlanId = planId) {
  const result = await db.query('select * from public.begin_company_reel_render_request($1,$2)', [creativePlanId, expected]);
  return result.rows[0];
}
async function approve(expected = plan.revision, creativePlanId = planId) {
  const result = await db.query('select * from public.approve_company_reel_creative_plan($1,$2)', [creativePlanId, expected]);
  return result.rows[0];
}
await assert.rejects(() => begin(), /REEL_RENDER_APPROVAL_REQUIRED/); checks += 1;
await setActor(ids.readOnly, 'readonly@example.com');
await assert.rejects(() => approve(), /REEL_RENDER_PLAN_UNAVAILABLE/); checks += 1;
await assert.rejects(() => begin(), /REEL_RENDER_PLAN_UNAVAILABLE/); checks += 1;
await setActor(ids.user, 'owner@example.com');
const planApproval = await approve();
check(() => assert.equal(planApproval.creative_plan_id, planId));
check(() => assert.equal(planApproval.plan_revision, plan.revision));
const repeatedApproval = await approve();
check(() => assert.equal(repeatedApproval.creative_plan_id, planApproval.creative_plan_id));
const first = await begin();
check(() => assert.equal(first.status, 'queued'));
check(() => assert.match(first.render_job_id, /^[0-9a-f-]{36}$/));
const repeatedBegin = await begin();
check(() => assert.equal(repeatedBegin.render_job_id, first.render_job_id));
const renderJobCount = await db.query('select count(*)::int count from public.company_reel_render_jobs');
check(() => assert.equal(renderJobCount.rows[0].count, 1));
const renderFingerprint = await db.query('select render_fingerprint,renderer_version from public.company_reel_render_jobs');
check(() => assert.match(renderFingerprint.rows[0].render_fingerprint, /^[0-9a-f]{64}$/));
check(() => assert.equal(renderFingerprint.rows[0].renderer_version, reelRendererVersion));
const v1Fingerprint = await db.query(`select encode(sha256(convert_to(concat_ws(E'\\n',
  'reel-render-fingerprint-v1', plan_revision, plan_json::text,
  'servicescope-reel-renderer-v1', 'reel-presentation-v1', 'mp4-h264-yuv420p-faststart-v1'
), 'UTF8')), 'hex') fingerprint from public.company_reel_creative_plans where id=$1`, [planId]);
check(() => assert.match(v1Fingerprint.rows[0].fingerprint, /^[0-9a-f]{64}$/));
check(() => assert.notEqual(v1Fingerprint.rows[0].fingerprint, renderFingerprint.rows[0].render_fingerprint));

const changedMediaRevision = 'reel-v1-changed-media';
const changedMediaPlan = [{ attachmentId: ids.attachment1, position: 1 }, { attachmentId: ids.attachment3, position: 2 }];
const changedMediaPlanId = await persist({ ...plan, revision: changedMediaRevision }, changedMediaRevision, { mediaPlan: changedMediaPlan });
await assert.rejects(() => begin(changedMediaRevision, changedMediaPlanId), /REEL_RENDER_APPROVAL_REQUIRED/); checks += 1;
await approve(changedMediaRevision, changedMediaPlanId);
const changedMediaJob = await begin(changedMediaRevision, changedMediaPlanId);
check(() => assert.notEqual(changedMediaJob.render_job_id, first.render_job_id));
const changedMediaFingerprint = (await db.query('select render_fingerprint from public.company_reel_render_jobs where id=$1', [changedMediaJob.render_job_id])).rows[0].render_fingerprint;
check(() => assert.notEqual(changedMediaFingerprint, renderFingerprint.rows[0].render_fingerprint));

await setActor(ids.otherUser, 'other@example.com');
const otherMediaPlan = [{ attachmentId: ids.otherAttachment1, position: 1 }, { attachmentId: ids.otherAttachment2, position: 2 }];
const otherPlanId = await persist(plan, plan.revision, { companyId: ids.otherCompany, jobId: ids.otherJob, userId: ids.otherUser, mediaPlan: otherMediaPlan });
await approve(plan.revision, otherPlanId);
const otherRenderJob = await begin(plan.revision, otherPlanId);
check(() => assert.notEqual(otherRenderJob.render_job_id, first.render_job_id));
await setActor(ids.user, 'owner@example.com');

await assert.rejects(() => db.query('update public.company_reel_render_jobs set requested_by=$1 where id=$2', [ids.otherUser, first.render_job_id])); checks += 1;
const workspace = await db.query('select * from public.get_company_reel_workspace($1)', [ids.job]);
check(() => assert.equal(workspace.rows[0].creative_plan_id, changedMediaPlanId));
check(() => assert.ok(!Object.hasOwn(workspace.rows[0], 'local_facts')));
await setActor(ids.explicitOff, 'off@example.com');
await assert.rejects(() => begin()); checks += 1;
await assert.rejects(() => db.query('select * from public.get_company_reel_workspace($1)', [ids.job])); checks += 1;
await setActor(ids.user, 'owner@example.com');
await assert.rejects(() => begin('reel-v1-wrong')); checks += 1;
await db.query("select set_config('test.company_id',$1,false),set_config('request.jwt.claim.email','other@example.com',false)", [ids.otherCompany]);
await assert.rejects(() => begin()); checks += 1;
await assert.rejects(() => db.query('select * from public.get_company_reel_workspace($1)', [ids.job])); checks += 1;
await db.query("select set_config('test.company_id',$1,false),set_config('request.jwt.claim.email','owner@example.com',false)", [ids.company]);

const claimAttempts = await Promise.all([
  db.query('select * from public.claim_company_reel_render_job($1)', [first.render_job_id]),
  db.query('select * from public.claim_company_reel_render_job($1,60)', [first.render_job_id]),
]);
check(() => assert.equal(claimAttempts.reduce((total, result) => total + result.rows.length, 0), 1));
const claim1 = claimAttempts.find((result) => result.rows.length === 1);
check(() => assert.equal(claim1.rows.length, 1));
check(() => assert.equal(claim1.rows[0].attempt_count, 1));
check(() => assert.ok(new Date(claim1.rows[0].leased_until).getTime() - Date.now() > 350_000));
const token1 = claim1.rows[0].lease_token;
const concurrentClaim = await db.query('select * from public.claim_company_reel_render_job($1,60)', [first.render_job_id]);
check(() => assert.equal(concurrentClaim.rows.length, 0));
const released = await db.query('select * from public.release_company_reel_render_job_for_retry($1,$2)', [first.render_job_id, token1]);
check(() => assert.equal(released.rows.length, 1));
check(() => assert.equal(released.rows[0].attempt_count, 1));
check(() => assert.equal(released.rows[0].started_at.toISOString(), claim1.rows[0].started_at.toISOString()));
const releasedComplete = await db.query(`select * from public.complete_company_reel_render_job($1,$2,'company-reel-renders',$3,$4,13800,1080,1920,30,'h264','yuv420p',0,702252,12000,$5,$6,true)`, [first.render_job_id, token1, `${ids.company}/${first.render_job_id}/reel.mp4`, `${ids.company}/${first.render_job_id}/cover.jpg`, 'a'.repeat(64), 'b'.repeat(64)]);
check(() => assert.equal(releasedComplete.rows.length, 0));
const releasedFail = await db.query("select * from public.fail_company_reel_render_job($1,$2,'REEL_RENDER_FAILED')", [first.render_job_id, token1]);
check(() => assert.equal(releasedFail.rows.length, 0));
const claim2 = await db.query('select * from public.claim_company_reel_render_job($1,60)', [first.render_job_id]);
check(() => assert.equal(claim2.rows[0].attempt_count, 2));
check(() => assert.notEqual(claim2.rows[0].lease_token, token1));
const token2 = claim2.rows[0].lease_token;
const paths = [`${ids.company}/${first.render_job_id}/reel.mp4`, `${ids.company}/${first.render_job_id}/cover.jpg`];
const wrongComplete = await db.query(`select * from public.complete_company_reel_render_job($1,$2,'company-reel-renders',$3,$4,13800,1080,1920,30,'h264','yuv420p',0,702252,12000,$5,$6,true)`, [first.render_job_id, token1, ...paths, 'a'.repeat(64), 'b'.repeat(64)]);
check(() => assert.equal(wrongComplete.rows.length, 0));
const complete = await db.query(`select * from public.complete_company_reel_render_job($1,$2,'company-reel-renders',$3,$4,13800,1080,1920,30,'h264','yuv420p',0,702252,12000,$5,$6,true)`, [first.render_job_id, token2, ...paths, 'a'.repeat(64), 'b'.repeat(64)]);
check(() => assert.equal(complete.rows[0].status, 'completed'));
check(() => assert.equal(complete.rows[0].video_sha256, 'a'.repeat(64)));
check(() => assert.equal(complete.rows[0].cover_sha256, 'b'.repeat(64)));
check(() => assert.equal(Number(complete.rows[0].cover_file_size), 12000));
await assert.rejects(() => db.query("update public.company_reel_render_jobs set video_sha256=$1 where id=$2", ['c'.repeat(64), first.render_job_id]), /transition is invalid/); checks += 1;
await assert.rejects(() => db.query("update public.company_reel_render_jobs set status='rendering' where id=$1", [first.render_job_id]), /transition is invalid/); checks += 1;
const completedClaim = await db.query('select * from public.claim_company_reel_render_job($1,60)', [first.render_job_id]);
check(() => assert.equal(completedClaim.rows.length, 0));

const failedRevision = 'reel-v1-87654321';
const failedPlanId = await persist({ ...plan, revision: failedRevision }, failedRevision);
await approve(failedRevision, failedPlanId);
const failedJob = await begin(failedRevision, failedPlanId);
const failedClaim = (await db.query('select * from public.claim_company_reel_render_job($1,60)', [failedJob.render_job_id])).rows[0];
const wrongFail = await db.query("select * from public.fail_company_reel_render_job($1,$2,'REEL_RENDER_MEDIA_MISSING')", [failedJob.render_job_id, token2]);
check(() => assert.equal(wrongFail.rows.length, 0));
await assert.rejects(() => db.query("select * from public.fail_company_reel_render_job($1,$2,'RAW_INTERNAL_ERROR')", [failedJob.render_job_id, failedClaim.lease_token])); checks += 1;
const failed = await db.query("select * from public.fail_company_reel_render_job($1,$2,'REEL_RENDER_MEDIA_MISSING')", [failedJob.render_job_id, failedClaim.lease_token]);
check(() => assert.equal(failed.rows[0].status, 'failed'));
check(() => assert.equal(failed.rows[0].error_code, 'REEL_RENDER_MEDIA_MISSING'));
await assert.rejects(() => db.query("update public.company_reel_render_jobs set error_code='REEL_RENDER_FAILED' where id=$1", [failedJob.render_job_id]), /transition is invalid/); checks += 1;

const crashRevision = 'reel-v1-crash-reclaim';
const crashPlanId = await persist({ ...plan, revision: crashRevision }, crashRevision);
await approve(crashRevision, crashPlanId);
const crashJob = await begin(crashRevision, crashPlanId);
const crashClaim1 = (await db.query('select * from public.claim_company_reel_render_job($1,360)', [crashJob.render_job_id])).rows[0];
await db.query("update public.company_reel_render_jobs set leased_until=clock_timestamp()-interval '1 second' where id=$1", [crashJob.render_job_id]);
const crashClaim2 = (await db.query('select * from public.claim_company_reel_render_job($1,360)', [crashJob.render_job_id])).rows[0];
check(() => assert.equal(crashClaim1.attempt_count, 1));
check(() => assert.equal(crashClaim2.attempt_count, 2));
check(() => assert.notEqual(crashClaim2.lease_token, crashClaim1.lease_token));

const maxRevision = 'reel-v1-max-attempts';
const maxPlanId = await persist({ ...plan, revision: maxRevision }, maxRevision);
await approve(maxRevision, maxPlanId);
const maxJob = await begin(maxRevision, maxPlanId);
let maxClaim;
for (let attempt = 1; attempt <= 5; attempt += 1) {
  maxClaim = (await db.query('select * from public.claim_company_reel_render_job($1,60)', [maxJob.render_job_id])).rows[0];
  check(() => assert.equal(maxClaim.attempt_count, attempt));
  if (attempt < 5) {
    const retryRelease = await db.query('select * from public.release_company_reel_render_job_for_retry($1,$2)', [maxJob.render_job_id, maxClaim.lease_token]);
    check(() => assert.equal(retryRelease.rows.length, 1));
  }
}
const fifthRelease = await db.query('select * from public.release_company_reel_render_job_for_retry($1,$2)', [maxJob.render_job_id, maxClaim.lease_token]);
check(() => assert.equal(fifthRelease.rows.length, 0));
await db.query("update public.company_reel_render_jobs set leased_until=clock_timestamp()-interval '1 second' where id=$1", [maxJob.render_job_id]);
const sixthClaim = await db.query('select * from public.claim_company_reel_render_job($1,60)', [maxJob.render_job_id]);
check(() => assert.equal(sixthClaim.rows.length, 0));
const maxTerminal = (await db.query('select status,error_code,attempt_count from public.company_reel_render_jobs where id=$1', [maxJob.render_job_id])).rows[0];
check(() => assert.deepEqual(maxTerminal, { status: 'failed', error_code: 'REEL_RENDER_FAILED', attempt_count: 5 }));

const tableSecurity = await db.query(`select
  (select relrowsecurity from pg_class where oid='public.company_reel_creative_plans'::regclass) plans_rls,
  (select relrowsecurity from pg_class where oid='public.company_reel_creative_plan_approvals'::regclass) approvals_rls,
  (select relrowsecurity from pg_class where oid='public.company_reel_render_jobs'::regclass) jobs_rls,
  has_table_privilege('authenticated','public.company_reel_creative_plans','SELECT') auth_plan_select,
  has_table_privilege('authenticated','public.company_reel_creative_plan_approvals','SELECT') auth_approval_select,
  has_table_privilege('authenticated','public.company_reel_render_jobs','UPDATE') auth_job_update,
  has_function_privilege('authenticated','public.get_company_reel_workspace(uuid)','EXECUTE') auth_read,
  has_function_privilege('anon','public.get_company_reel_workspace(uuid)','EXECUTE') anon_read,
  has_function_privilege('authenticated','public.begin_company_reel_render_request(uuid,text)','EXECUTE') auth_begin,
  has_function_privilege('authenticated','public.approve_company_reel_creative_plan(uuid,text)','EXECUTE') auth_approve,
  has_function_privilege('anon','public.begin_company_reel_render_request(uuid,text)','EXECUTE') anon_begin,
  has_function_privilege('authenticated','public.claim_company_reel_render_job(uuid,integer)','EXECUTE') auth_claim,
  has_function_privilege('service_role','public.claim_company_reel_render_job(uuid,integer)','EXECUTE') service_claim,
  has_function_privilege('authenticated','public.release_company_reel_render_job_for_retry(uuid,uuid)','EXECUTE') auth_release,
  has_function_privilege('service_role','public.release_company_reel_render_job_for_retry(uuid,uuid)','EXECUTE') service_release,
  has_function_privilege('authenticated','public.can_access_company_ai_assistant(uuid)','EXECUTE') auth_ai_helper,
  has_function_privilege('service_role','public.can_access_company_ai_assistant(uuid)','EXECUTE') service_ai_helper,
  has_function_privilege('authenticated','public.can_manage_company_ai_assistant(uuid)','EXECUTE') auth_manage_helper,
  has_function_privilege('service_role','public.can_manage_company_ai_assistant(uuid)','EXECUTE') service_manage_helper`);
for (const key of ['plans_rls','approvals_rls','jobs_rls','auth_read','auth_begin','auth_approve','service_claim','service_release','service_ai_helper','service_manage_helper']) check(() => assert.equal(tableSecurity.rows[0][key], true));
for (const key of ['auth_plan_select','auth_approval_select','auth_job_update','auth_claim','auth_release','auth_ai_helper','auth_manage_helper','anon_read','anon_begin']) check(() => assert.equal(tableSecurity.rows[0][key], false));
const functionSecurity = await db.query(`select proname, prosecdef, proconfig, pg_get_function_arguments(oid) arguments
  from pg_proc where oid in (
    'public.can_access_company_ai_assistant(uuid)'::regprocedure,
    'public.can_manage_company_ai_assistant(uuid)'::regprocedure,
    'public.get_company_reel_workspace(uuid)'::regprocedure,
    'public.approve_company_reel_creative_plan(uuid,text)'::regprocedure,
    'public.begin_company_reel_render_request(uuid,text)'::regprocedure,
    'public.claim_company_reel_render_job(uuid,integer)'::regprocedure,
    'public.release_company_reel_render_job_for_retry(uuid,uuid)'::regprocedure,
    'public.complete_company_reel_render_job(uuid,uuid,text,text,text,integer,integer,integer,integer,text,text,integer,bigint,bigint,text,text,boolean)'::regprocedure,
    'public.fail_company_reel_render_job(uuid,uuid,text)'::regprocedure
  ) order by proname`);
check(() => assert.equal(functionSecurity.rows.length, 9));
for (const row of functionSecurity.rows) {
  check(() => assert.equal(row.prosecdef, true));
  check(() => assert.deepEqual(row.proconfig, ['search_path=""']));
}
check(() => assert.match(functionSecurity.rows.find((row) => row.proname === 'claim_company_reel_render_job').arguments, /default 360/i));
const tenantConstraints = await db.query(`select conname from pg_constraint where conname in (
  'company_reel_creative_plans_job_tenant_fk','company_reel_render_jobs_job_tenant_fk',
  'company_reel_render_jobs_plan_tenant_fk','company_reel_creative_plans_tenant_identity_unique',
  'company_reel_creative_plan_approvals_plan_tenant_fk'
)`);
check(() => assert.equal(tenantConstraints.rows.length, 5));
const safeWorkspaceColumns = await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='company_reel_creative_plans'");
check(() => assert.ok(safeWorkspaceColumns.rows.some((row) => row.column_name === 'local_facts')));
check(() => assert.ok(!block.match(/returns table \([^)]*local_facts/is)));
const bucket = await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='company-reel-renders'");
check(() => assert.equal(bucket.rows[0].public, false));
check(() => assert.equal(Number(bucket.rows[0].file_size_limit), 104857600));
check(() => assert.deepEqual(bucket.rows[0].allowed_mime_types, ['video/mp4','image/jpeg']));
check(() => assert.doesNotMatch(migration, /create policy[\s\S]*company-reel-renders/i));
check(() => assert.doesNotMatch(migration, /\b(?:update|delete)\s+public\.(?:jobs|job_attachments|company_social)/i));
check(() => assert.match(upgradeMigration, /lock table public\.company_reel_render_jobs in access exclusive mode/));
check(() => assert.match(upgradeMigration, /if exists \(select 1 from public\.company_reel_render_jobs\)/));
check(() => assert.doesNotMatch(upgradeMigration, /\b(?:update|delete)\s+public\.company_reel_render_jobs/i));
check(() => assert.match(controlledPipelineMigration, /REEL_RENDER_APPROVAL_REQUIRED/));
check(() => assert.match(controlledPipelineMigration, /company_reel_render_jobs_artifact_integrity_check/));
check(() => assert.match(controlledPipelineMigration, /video_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/));
check(() => assert.match(controlledPipelineMigration, /company_reel_render_jobs_transition_guard/));
check(() => assert.match(controlledPipelineMigration, /can_manage_company_ai_assistant/));

await db.close();
console.log(`Reel render job SQL regression tests passed (${checks}/${checks}).`);
