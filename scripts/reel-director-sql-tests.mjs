import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { extractExactMarkedBlock, normalizeSqlForParity } from './meta-canonical-schema.mjs';

const migration = await readFile(new URL('../supabase/migrations/20260809013000_reel_authoritative_media_findings.sql', import.meta.url), 'utf8');
const canonicalSchema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const parityMarkers = {
  begin: '-- REEL_AUTHORITATIVE_MEDIA_FINDINGS_BEGIN',
  end: '-- REEL_AUTHORITATIVE_MEDIA_FINDINGS_END',
  label: 'Reel authoritative media findings',
};
const migrationBlock = extractExactMarkedBlock(migration, parityMarkers);
const canonicalBlock = extractExactMarkedBlock(canonicalSchema, parityMarkers);
const db = new PGlite();
let checks = 0;
const check = (fn) => { fn(); checks += 1; };

check(() => assert.equal(normalizeSqlForParity(canonicalBlock), normalizeSqlForParity(migrationBlock)));

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create table public.companies (id uuid primary key);
  create table public.jobs (id uuid primary key, company_id uuid not null references public.companies(id));
  create table public.job_attachments (
    id uuid primary key,
    company_id uuid not null references public.companies(id),
    job_id uuid not null references public.jobs(id),
    name text not null default '',
    mime_type text not null,
    size_bytes integer not null,
    kind text not null,
    storage_bucket text,
    storage_path text,
    created_at timestamptz not null default now()
  );
  create table public.company_media_analysis_runs (
    id uuid primary key,
    company_id uuid not null references public.companies(id),
    job_id uuid not null references public.jobs(id),
    correlation_id text not null,
    status text not null,
    provider text not null,
    model text,
    analysis_version text not null,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table public.company_media_analysis_attachment_results (
    id uuid primary key,
    analysis_run_id uuid not null references public.company_media_analysis_runs(id) on delete cascade,
    company_id uuid not null references public.companies(id),
    job_id uuid not null references public.jobs(id),
    attachment_id uuid not null references public.job_attachments(id),
    attachment_sha256 bytea not null,
    detected_mime_type text not null,
    analysis_status text not null,
    privacy_review_status text not null,
    excluded boolean not null default false,
    created_at timestamptz not null default now(),
    unique (analysis_run_id, attachment_id)
  );
  create table public.company_media_analysis_privacy_findings (
    id uuid primary key,
    analysis_run_id uuid not null references public.company_media_analysis_runs(id) on delete cascade,
    attachment_result_id uuid not null references public.company_media_analysis_attachment_results(id) on delete cascade,
    company_id uuid not null references public.companies(id),
    job_id uuid not null references public.jobs(id),
    attachment_id uuid not null references public.job_attachments(id),
    finding_id text not null,
    finding_category text not null,
    risk_level text not null,
    resolved_as_false_positive boolean not null default false,
    resolved_by uuid references auth.users(id),
    resolved_at timestamptz,
    created_at timestamptz not null default now(),
    unique (attachment_result_id, finding_id)
  );
`);
await db.exec(canonicalBlock);

const ids = {
  company: '00000000-0000-4000-8000-000000008001',
  otherCompany: '00000000-0000-4000-8000-000000008002',
  job: '00000000-0000-4000-8000-000000008101',
  otherJob: '00000000-0000-4000-8000-000000008102',
  attachment: '00000000-0000-4000-8000-000000008201',
  historicalAttachment: '00000000-0000-4000-8000-000000008202',
};
await db.query('insert into public.companies(id) values ($1),($2)', [ids.company, ids.otherCompany]);
await db.query('insert into public.jobs(id,company_id) values ($1,$2),($3,$4)', [ids.job, ids.company, ids.otherJob, ids.otherCompany]);
await db.query(`insert into public.job_attachments(id,company_id,job_id,mime_type,size_bytes,kind,storage_bucket,storage_path)
  values ($1,$2,$3,'image/jpeg',100,'photo','job-attachments','current.jpg'),
         ($4,$2,$3,'image/jpeg',100,'photo','job-attachments','historical.jpg')`,
  [ids.attachment, ids.company, ids.job, ids.historicalAttachment]);

const tableInfo = await db.query(`select relrowsecurity from pg_class where oid='public.company_media_analysis_content_findings'::regclass`);
check(() => assert.equal(tableInfo.rows[0].relrowsecurity, true));
const constraints = await db.query(`select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.company_media_analysis_content_findings'::regclass`);
const constraintText = constraints.rows.map((row) => row.definition).join('\n');
check(() => assert.match(constraintText, /FOREIGN KEY \(analysis_run_id\).*company_media_analysis_runs/i));
check(() => assert.match(constraintText, /FOREIGN KEY \(attachment_result_id\).*company_media_analysis_attachment_results/i));
check(() => assert.match(constraintText, /UNIQUE \(attachment_result_id, finding_id\)/i));
for (const category of ['equipment_overview','possible_problem_detail','repair_process','replacement_part','finished_result','low_information','duplicate_candidate','unclear']) {
  check(() => assert.match(constraintText, new RegExp(`'${category}'`)));
}
check(() => assert.doesNotMatch(constraintText, /possible_face|unknown_privacy_risk/));
check(() => assert.match(constraintText, /confidence >= .*0.*confidence <= .*1/i));
const privileges = await db.query(`select
  has_table_privilege('anon','public.company_media_analysis_content_findings','SELECT') anon_select,
  has_table_privilege('authenticated','public.company_media_analysis_content_findings','SELECT') authenticated_select,
  has_table_privilege('service_role','public.company_media_analysis_content_findings','SELECT') service_select,
  has_function_privilege('anon','public.list_company_reel_media_analysis_candidates(uuid,uuid,uuid[])','EXECUTE') anon_rpc,
  has_function_privilege('authenticated','public.list_company_reel_media_analysis_candidates(uuid,uuid,uuid[])','EXECUTE') authenticated_rpc,
  has_function_privilege('service_role','public.list_company_reel_media_analysis_candidates(uuid,uuid,uuid[])','EXECUTE') service_rpc`);
check(() => assert.equal(privileges.rows[0].anon_select, false));
check(() => assert.equal(privileges.rows[0].authenticated_select, false));
check(() => assert.equal(privileges.rows[0].service_select, true));
check(() => assert.equal(privileges.rows[0].anon_rpc, false));
check(() => assert.equal(privileges.rows[0].authenticated_rpc, false));
check(() => assert.equal(privileges.rows[0].service_rpc, true));

const hash = `\\x${'11'.repeat(32)}`;
const contentFinding = {
  findingId: 'finding-detail',
  findingCategory: 'possible_problem_detail',
  evidenceType: 'visual_suggestion',
  confidence: 0.94,
  explanation: 'A burned relay is visible in the equipment detail.',
  riskLevel: 'low',
  requiresUserApproval: true,
};
const privacyFinding = { findingId: 'finding-face', findingCategory: 'possible_face', riskLevel: 'high' };

async function persist(runId, attachmentId, options = {}) {
  const payload = {
    attachmentId,
    attachmentSha256: hash,
    detectedMimeType: 'image/jpeg',
    analysisStatus: options.analysisStatus ?? 'analyzed',
    privacyFindings: options.privacyFindings ?? [],
  };
  if (options.includeContent !== false) payload.contentFindings = options.contentFindings ?? [contentFinding];
  return db.query(`select * from public.record_company_media_analysis_result(
    $1,$2,$3,$4,$5,'openai','test','media-analysis-v1',$6::jsonb,$7::timestamptz)`, [
    runId, ids.company, ids.job, `correlation-${runId.slice(-4)}`, options.status ?? 'completed', JSON.stringify([payload]), options.timestamp ?? '2026-08-09T01:00:00Z',
  ]);
}

const firstRun = '00000000-0000-4000-8000-000000008301';
await persist(firstRun, ids.attachment, { privacyFindings: [privacyFinding] });
const persisted = await db.query(`select
  (select count(*)::integer from public.company_media_analysis_content_findings where analysis_run_id=$1) content_count,
  (select count(*)::integer from public.company_media_analysis_privacy_findings where analysis_run_id=$1) privacy_count,
  (select explanation from public.company_media_analysis_content_findings where analysis_run_id=$1) explanation,
  (select confidence from public.company_media_analysis_content_findings where analysis_run_id=$1) confidence`, [firstRun]);
check(() => assert.equal(persisted.rows[0].content_count, 1));
check(() => assert.equal(persisted.rows[0].privacy_count, 1));
check(() => assert.equal(persisted.rows[0].explanation, contentFinding.explanation));
check(() => assert.equal(persisted.rows[0].confidence, contentFinding.confidence));

const legacyRun = '00000000-0000-4000-8000-000000008302';
await persist(legacyRun, ids.historicalAttachment, { includeContent: false, timestamp: '2026-08-09T01:01:00Z' });
const legacy = await db.query('select count(*)::integer count from public.company_media_analysis_content_findings where analysis_run_id=$1', [legacyRun]);
check(() => assert.equal(legacy.rows[0].count, 0));

async function rejectsFinding(findingPatch, privacyFindings = []) {
  const runId = crypto.randomUUID();
  await assert.rejects(() => persist(runId, ids.attachment, {
    contentFindings: [{ ...contentFinding, ...findingPatch }],
    privacyFindings,
    timestamp: new Date().toISOString(),
  }));
  checks += 1;
}
await rejectsFinding({ findingCategory: 'possible_face' });
await rejectsFinding({ findingCategory: 'invented_category' });
await rejectsFinding({ confidence: 1.1 });
await rejectsFinding({ extraProviderField: 'forbidden' });
await assert.rejects(() => persist(crypto.randomUUID(), ids.attachment, {
  contentFindings: [contentFinding, contentFinding],
  timestamp: new Date().toISOString(),
}));
checks += 1;
await assert.rejects(() => persist(crypto.randomUUID(), ids.attachment, {
  contentFindings: [],
  privacyFindings: [{ ...privacyFinding, findingCategory: 'finished_result' }],
  timestamp: new Date().toISOString(),
}));
checks += 1;

const failedRun = '00000000-0000-4000-8000-000000008303';
await persist(failedRun, ids.attachment, { status: 'failed', timestamp: '2026-08-09T01:02:00Z' });
const reelRows = await db.query(`select * from public.list_company_reel_media_analysis_candidates($1,$2,$3::uuid[])`, [ids.company, ids.job, [ids.attachment]]);
check(() => assert.equal(reelRows.rows.length, 1));
check(() => assert.equal(reelRows.rows[0].analysis_run_id, firstRun));
check(() => assert.equal(reelRows.rows[0].finding_id, contentFinding.findingId));
check(() => assert.equal(reelRows.rows[0].privacy_review_status, 'blocked'));
check(() => assert.equal(Number(reelRows.rows[0].unresolved_privacy_count), 1));
check(() => assert.equal(Object.hasOwn(reelRows.rows[0], 'approval_id'), false));

const historicalRows = await db.query(`select * from public.list_company_reel_media_analysis_candidates($1,$2,$3::uuid[])`, [ids.company, ids.job, [ids.historicalAttachment]]);
check(() => assert.equal(historicalRows.rows.length, 1));
check(() => assert.equal(historicalRows.rows[0].finding_id, null));
await assert.rejects(() => db.query(`select * from public.list_company_reel_media_analysis_candidates($1,$2,$3::uuid[])`, [ids.otherCompany, ids.job, [ids.attachment]]));
checks += 1;

check(() => assert.doesNotMatch(migration, /\b(?:update|delete)\s+public\.company_media_analysis_/i));
check(() => assert.doesNotMatch(migration, /insert into public\.company_media_analysis_content_findings\s*\([^;]+?\)\s*select\b/i));

await db.close();
console.log(`AI Reel Director SQL regression tests passed (${checks}/${checks}).`);
