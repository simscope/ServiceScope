import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { extractExactMarkedBlock, normalizeSqlForParity } from './meta-canonical-schema.mjs';

const migration = await readFile(new URL('../supabase/migrations/20260926010000_reel_media_selection.sql', import.meta.url), 'utf8');
const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const markers = { begin: '-- REEL_MEDIA_SELECTION_BEGIN', end: '-- REEL_MEDIA_SELECTION_END', label: 'Reel media selection' };
const block = extractExactMarkedBlock(migration, markers);
const canonical = extractExactMarkedBlock(schema, markers);
let checks = 0;
const check = (fn) => { fn(); checks += 1; };
check(() => assert.equal(normalizeSqlForParity(canonical), normalizeSqlForParity(block)));

const db = new PGlite();
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-4000-8000-000000009001'::uuid $$;
  create table public.companies (id uuid primary key);
  create table public.jobs (id uuid primary key, company_id uuid not null references public.companies(id), status text not null);
  create unique index jobs_id_company_reel_render_jobs_uidx on public.jobs (id, company_id);
  create table public.job_attachments (
    id uuid primary key, company_id uuid not null references public.companies(id), job_id uuid not null references public.jobs(id),
    name text not null, mime_type text not null, size_bytes bigint not null, kind text not null,
    storage_bucket text, storage_path text, created_at timestamptz not null default now()
  );
  create table public.company_media_analysis_runs (
    id uuid primary key, company_id uuid not null, job_id uuid not null, status text not null, completed_at timestamptz
  );
  create table public.company_media_analysis_attachment_results (
    id uuid primary key, analysis_run_id uuid not null, company_id uuid not null, job_id uuid not null,
    attachment_id uuid not null, analysis_status text not null, privacy_review_status text not null,
    excluded boolean not null default false, created_at timestamptz not null default now()
  );
  create table public.company_media_analysis_privacy_findings (
    id uuid primary key, analysis_run_id uuid not null, attachment_result_id uuid not null,
    company_id uuid not null, job_id uuid not null, attachment_id uuid not null,
    resolved_as_false_positive boolean not null default false
  );
  create function public.can_access_company_ai_assistant(uuid) returns boolean language sql stable as $$ select true $$;
  create function public.can_manage_company_ai_assistant(uuid) returns boolean language sql stable as $$ select true $$;
`);
await db.exec(block);

const ids = {
  user: '00000000-0000-4000-8000-000000009001',
  company: '00000000-0000-4000-8000-000000009101',
  job: '00000000-0000-4000-8000-000000009201',
  attachments: [1, 2, 3, 4].map((value) => `00000000-0000-4000-8000-00000000930${value}`),
};
await db.query('insert into auth.users(id) values ($1)', [ids.user]);
await db.query('insert into public.companies(id) values ($1)', [ids.company]);
await db.query("insert into public.jobs(id,company_id,status) values ($1,$2,'Completed')", [ids.job, ids.company]);
for (let index = 0; index < ids.attachments.length; index += 1) {
  await db.query(`insert into public.job_attachments(id,company_id,job_id,name,mime_type,size_bytes,kind,storage_bucket,storage_path)
    values ($1,$2,$3,$4,'image/jpeg',100,'photo','job-files',$5)`,
  [ids.attachments[index], ids.company, ids.job, `photo-${index + 1}.jpg`, `photo-${index + 1}.jpg`]);
}

const initial = await db.query('select count(*)::integer count from public.company_reel_media_selections');
check(() => assert.equal(initial.rows[0].count, 0));

for (let index = 0; index < 3; index += 1) {
  const runId = `00000000-0000-4000-8000-00000000940${index + 1}`;
  const resultId = `00000000-0000-4000-8000-00000000950${index + 1}`;
  await db.query("insert into public.company_media_analysis_runs(id,company_id,job_id,status,completed_at) values ($1,$2,$3,'completed',now())", [runId, ids.company, ids.job]);
  await db.query(`insert into public.company_media_analysis_attachment_results
    (id,analysis_run_id,company_id,job_id,attachment_id,analysis_status,privacy_review_status,excluded)
    values ($1,$2,$3,$4,$5,'analyzed','passed',false)`, [resultId, runId, ids.company, ids.job, ids.attachments[index]]);
}

const selected = [
  { attachmentId: ids.attachments[0], role: 'problem', position: 1 },
  { attachmentId: ids.attachments[1], role: 'process', position: 2 },
  { attachmentId: ids.attachments[2], role: 'result', position: 3 },
];
const saved = await db.query('select public.replace_company_reel_media_selection($1,$2::jsonb) value', [ids.job, JSON.stringify(selected)]);
check(() => assert.equal(saved.rows[0].value.ready, true));
check(() => assert.equal(saved.rows[0].value.canManage, true));
check(() => assert.equal(saved.rows[0].value.items.filter((item) => item.position !== null).length, 3));
check(() => assert.equal(saved.rows[0].value.items.filter((item) => item.privacyState === 'passed').length, 3));
check(() => assert.equal(saved.rows[0].value.items.find((item) => item.attachmentId === ids.attachments[3]).privacyState, 'not_analyzed'));

const supportingInsteadOfProblem = selected.map((item) => item.role === 'problem' ? { ...item, role: 'supporting' } : item);
const supportingOnly = await db.query('select public.replace_company_reel_media_selection($1,$2::jsonb) value', [ids.job, JSON.stringify(supportingInsteadOfProblem)]);
check(() => assert.equal(supportingOnly.rows[0].value.ready, false));
await db.query('select public.replace_company_reel_media_selection($1,$2::jsonb)', [ids.job, JSON.stringify(selected)]);

const persisted = await db.query(`select role,position,selected_by,created_at,updated_at
  from public.company_reel_media_selections order by position`);
check(() => assert.deepEqual(persisted.rows.map((row) => row.role), ['problem', 'process', 'result']));
check(() => assert.deepEqual(persisted.rows.map((row) => row.position), [1, 2, 3]));
check(() => assert.ok(persisted.rows.every((row) => row.selected_by === ids.user && row.created_at && row.updated_at)));

await assert.rejects(() => db.query('select public.replace_company_reel_media_selection($1,$2::jsonb)', [ids.job, JSON.stringify([
  { attachmentId: ids.attachments[0], role: 'invalid', position: 1 },
])]));
checks += 1;
await assert.rejects(() => db.query('select public.replace_company_reel_media_selection($1,$2::jsonb)', [ids.job, JSON.stringify([
  { attachmentId: ids.attachments[0], role: 'problem', position: 1 },
  { attachmentId: ids.attachments[0], role: 'result', position: 2 },
])]));
checks += 1;
await assert.rejects(() => db.query('select public.replace_company_reel_media_selection($1,$2::jsonb)', [ids.job, JSON.stringify([
  ...selected,
  { attachmentId: ids.attachments[3], role: 'supporting', position: 4 },
  { attachmentId: crypto.randomUUID(), role: 'supporting', position: 5 },
])]));
checks += 1;

await db.query(`insert into public.company_media_analysis_privacy_findings
  (id,analysis_run_id,attachment_result_id,company_id,job_id,attachment_id,resolved_as_false_positive)
  values ('00000000-0000-4000-8000-000000009601','00000000-0000-4000-8000-000000009401','00000000-0000-4000-8000-000000009501',$1,$2,$3,false)`,
[ids.company, ids.job, ids.attachments[0]]);
const blocked = await db.query('select public.get_company_reel_media_selector($1) value', [ids.job]);
check(() => assert.equal(blocked.rows[0].value.ready, false));
check(() => assert.equal(blocked.rows[0].value.items.find((item) => item.attachmentId === ids.attachments[0]).privacyState, 'needs_review'));

const privileges = await db.query(`select
  has_table_privilege('authenticated','public.company_reel_media_selections','INSERT') direct_insert,
  has_function_privilege('authenticated','public.replace_company_reel_media_selection(uuid,jsonb)','EXECUTE') replace_rpc,
  has_function_privilege('authenticated','public.list_company_reel_media_selection_for_planning(uuid,uuid)','EXECUTE') planning_rpc`);
check(() => assert.equal(privileges.rows[0].direct_insert, false));
check(() => assert.equal(privileges.rows[0].replace_rpc, true));
check(() => assert.equal(privileges.rows[0].planning_rpc, false));

await db.exec('create or replace function public.can_manage_company_ai_assistant(uuid) returns boolean language sql stable as $$ select false $$');
await assert.rejects(() => db.query("select public.replace_company_reel_media_selection($1,'[]'::jsonb)", [ids.job]), /FORBIDDEN/);
checks += 1;
const afterForbidden = await db.query('select count(*)::integer count from public.company_reel_media_selections');
check(() => assert.equal(afterForbidden.rows[0].count, 3));

const otherCompany = '00000000-0000-4000-8000-000000009102';
const otherJob = '00000000-0000-4000-8000-000000009202';
const otherAttachment = '00000000-0000-4000-8000-000000009305';
await db.query('insert into public.companies(id) values ($1)', [otherCompany]);
await db.query("insert into public.jobs(id,company_id,status) values ($1,$2,'Completed')", [otherJob, otherCompany]);
await db.query(`insert into public.job_attachments(id,company_id,job_id,name,mime_type,size_bytes,kind,storage_bucket,storage_path)
  values ($1,$2,$3,'other.jpg','image/jpeg',100,'photo','job-files','other.jpg')`,
[otherAttachment, otherCompany, otherJob]);
await assert.rejects(() => db.query(`insert into public.company_reel_media_selections
  (company_id,job_id,attachment_id,role,position,selected_by)
  values ($1,$2,$3,'supporting',4,$4)`, [ids.company, ids.job, otherAttachment, ids.user]));
checks += 1;

await db.exec('create or replace function public.can_access_company_ai_assistant(uuid) returns boolean language sql stable as $$ select false $$');
await assert.rejects(() => db.query('select public.get_company_reel_media_selector($1)', [ids.job]), /FORBIDDEN/);
checks += 1;

console.log(`Reel media selector SQL checks passed: ${checks}`);
