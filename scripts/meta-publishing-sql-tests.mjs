import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import {
  META_FACEBOOK_PUBLISH_ACL_FIX_MARKERS,
  META_FACEBOOK_PUBLISH_MARKERS,
  extractExactMarkedBlock,
  extractMetaCanonicalBlocks,
  normalizeSqlForParity,
} from './meta-canonical-schema.mjs';

const migrationNames = [
  '20260731220000_meta_social_connection_foundation.sql',
  '20260802020000_meta_social_lifecycle_audit_transactions.sql',
  '20260802203000_meta_social_oauth_state_ttl_30_minutes.sql',
  '20260803193000_meta_facebook_publish_foundation.sql',
  '20260804011000_meta_facebook_publish_service_role_acl_fix.sql',
  '20260804193000_meta_facebook_single_photo_publish.sql',
  '20260804203000_meta_facebook_single_photo_publish_corrective.sql',
  '20260805002000_meta_facebook_single_photo_publish_review_fix.sql',
  '20260805024500_meta_facebook_single_photo_review_closure.sql',
  '20260805153000_meta_facebook_single_photo_latest_authority.sql',
  '20260805183000_meta_facebook_single_photo_exact_review.sql',
  '20260805193000_meta_facebook_single_photo_runtime_closure.sql',
  '20260805203000_meta_facebook_single_photo_persistence_closure.sql',
];
const migrations = await Promise.all(migrationNames.map((name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')));
const canonicalSchema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const canonicalBlocks = extractMetaCanonicalBlocks(canonicalSchema);
let checks = 0;
const check = (fn) => { fn(); checks += 1; };

check(() => assert.equal(
  normalizeSqlForParity(canonicalBlocks.publishing),
  normalizeSqlForParity(extractExactMarkedBlock(migrations[3], META_FACEBOOK_PUBLISH_MARKERS)),
));
check(() => assert.equal(
  normalizeSqlForParity(canonicalBlocks.publishingAclFix),
  normalizeSqlForParity(extractExactMarkedBlock(migrations[4], META_FACEBOOK_PUBLISH_ACL_FIX_MARKERS)),
));
check(() => assert.equal(
  normalizeSqlForParity(extractExactMarkedBlock(canonicalSchema, {
    begin: '-- META_FACEBOOK_SINGLE_PHOTO_REVIEW_CLOSURE_BEGIN',
    end: '-- META_FACEBOOK_SINGLE_PHOTO_REVIEW_CLOSURE_END',
    label: 'Meta Facebook single-photo review closure',
  })),
  normalizeSqlForParity(extractExactMarkedBlock(migrations[8], {
    begin: '-- META_FACEBOOK_SINGLE_PHOTO_REVIEW_CLOSURE_BEGIN',
    end: '-- META_FACEBOOK_SINGLE_PHOTO_REVIEW_CLOSURE_END',
    label: 'Meta Facebook single-photo review closure',
  })),
));
check(() => assert.equal(
  normalizeSqlForParity(extractExactMarkedBlock(canonicalSchema, {
    begin: '-- META_FACEBOOK_SINGLE_PHOTO_RUNTIME_CLOSURE_BEGIN',
    end: '-- META_FACEBOOK_SINGLE_PHOTO_RUNTIME_CLOSURE_END',
    label: 'Meta Facebook single-photo runtime closure',
  })),
  normalizeSqlForParity(extractExactMarkedBlock(migrations[11], {
    begin: '-- META_FACEBOOK_SINGLE_PHOTO_RUNTIME_CLOSURE_BEGIN',
    end: '-- META_FACEBOOK_SINGLE_PHOTO_RUNTIME_CLOSURE_END',
    label: 'Meta Facebook single-photo runtime closure',
  })),
));
check(() => assert.equal(
  normalizeSqlForParity(extractExactMarkedBlock(canonicalSchema, {
    begin: '-- META_FACEBOOK_SINGLE_PHOTO_PERSISTENCE_CLOSURE_BEGIN',
    end: '-- META_FACEBOOK_SINGLE_PHOTO_PERSISTENCE_CLOSURE_END',
    label: 'Meta Facebook single-photo persistence closure',
  })),
  normalizeSqlForParity(extractExactMarkedBlock(migrations[12], {
    begin: '-- META_FACEBOOK_SINGLE_PHOTO_PERSISTENCE_CLOSURE_BEGIN',
    end: '-- META_FACEBOOK_SINGLE_PHOTO_PERSISTENCE_CLOSURE_END',
    label: 'Meta Facebook single-photo persistence closure',
  })),
));
check(() => assert.equal(
  normalizeSqlForParity(extractExactMarkedBlock(canonicalSchema, {
    begin: '-- META_FACEBOOK_SINGLE_PHOTO_LATEST_AUTHORITY_BEGIN',
    end: '-- META_FACEBOOK_SINGLE_PHOTO_LATEST_AUTHORITY_END',
    label: 'Meta Facebook single-photo latest authority',
  })),
  normalizeSqlForParity(extractExactMarkedBlock(migrations[9], {
    begin: '-- META_FACEBOOK_SINGLE_PHOTO_LATEST_AUTHORITY_BEGIN',
    end: '-- META_FACEBOOK_SINGLE_PHOTO_LATEST_AUTHORITY_END',
    label: 'Meta Facebook single-photo latest authority',
  })),
));
check(() => assert.equal(
  normalizeSqlForParity(extractExactMarkedBlock(canonicalSchema, {
    begin: '-- META_FACEBOOK_SINGLE_PHOTO_EXACT_REVIEW_BEGIN',
    end: '-- META_FACEBOOK_SINGLE_PHOTO_EXACT_REVIEW_END',
    label: 'Meta Facebook single-photo exact review',
  })),
  normalizeSqlForParity(extractExactMarkedBlock(migrations[10], {
    begin: '-- META_FACEBOOK_SINGLE_PHOTO_EXACT_REVIEW_BEGIN',
    end: '-- META_FACEBOOK_SINGLE_PHOTO_EXACT_REVIEW_END',
    label: 'Meta Facebook single-photo exact review',
  })),
));

const prerequisiteSchema = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text unique);
  create table public.companies (id uuid primary key, name text not null, owner_name text not null default '', owner_email text not null);
  create table public.jobs (
    id uuid primary key,
    company_id uuid not null references public.companies(id),
    status text not null,
    job_number text not null default '',
    notes text not null default '',
    service_call_fee_cents integer not null default 0,
    labor_cents integer not null default 0
  );
  create table public.job_attachments (
    id uuid primary key,
    company_id uuid not null references public.companies(id),
    job_id uuid not null references public.jobs(id),
    name text not null default '',
    mime_type text not null default '',
    size_bytes integer not null default 0,
    kind text not null default 'photo',
    storage_bucket text,
    storage_path text,
    created_at timestamptz not null default now()
  );
  create table public.audit_events (
    id uuid primary key default gen_random_uuid(),
    company_id uuid references public.companies(id),
    category text not null,
    action text not null,
    actor_user_id uuid references auth.users(id),
    actor_name text not null,
    actor_role text,
    resource_type text,
    resource_id text,
    resource text not null default 'Unknown resource',
    resource_label text not null,
    details text not null default '',
    metadata jsonb not null default '{}'::jsonb,
    user_agent text,
    created_at timestamptz not null default now()
  );
`;

const ids = {
  company: '00000000-0000-4000-8000-000000007001',
  otherCompany: '00000000-0000-4000-8000-000000007002',
  actor: '00000000-0000-4000-8000-000000007003',
  otherActor: '00000000-0000-4000-8000-000000007004',
  job: '00000000-0000-4000-8000-000000007005',
  otherJob: '00000000-0000-4000-8000-000000007006',
  connection: '00000000-0000-4000-8000-000000007007',
  threeScopeConnection: '00000000-0000-4000-8000-000000007008',
  attachment: '00000000-0000-4000-8000-000000007085',
  analysisRun: '00000000-0000-4000-8000-000000007090',
  analysisResult: '00000000-0000-4000-8000-000000007091',
};
const verifiedActor = { name: 'Verified Publisher', role: 'manager' };
const privacyCategories = [
  'possible_face',
  'possible_address',
  'possible_phone_or_email',
  'possible_license_plate',
  'possible_customer_document',
  'possible_screen',
  'possible_barcode',
  'possible_serial_or_nameplate',
  'possible_personal_identifier',
  'unknown_privacy_risk',
];

const db = new PGlite();
await db.exec(prerequisiteSchema);
for (const migration of migrations.slice(0, 4)) await db.exec(migration);
await db.exec('grant all privileges on table public.company_social_publications to service_role;');
const simulatedDefaultAcl = await directTablePrivileges(db, 'service_role');
for (const privilege of ['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']) {
  check(() => assert.ok(simulatedDefaultAcl.includes(privilege)));
}
await db.exec(migrations[4]);
await db.exec(migrations[5]);
await db.exec(migrations[6]);
await db.exec(migrations[7]);
await db.exec(migrations[8]);
await db.exec(migrations[9]);
await db.exec(migrations[10]);
await db.exec(migrations[11]);
await db.exec(migrations[12]);
await db.exec('begin;');

await db.query(`insert into auth.users (id, email) values ($1, 'publisher@example.test'), ($2, 'other@example.test')`, [ids.actor, ids.otherActor]);
await db.query(`insert into public.companies (id, name, owner_email) values ($1, 'Primary', 'primary@example.test'), ($2, 'Other', 'other@example.test')`, [ids.company, ids.otherCompany]);
await db.query(`insert into public.jobs (id, company_id, status, job_number) values ($1, $2, 'Completed', 'TEST-1'), ($3, $4, 'Warranty', 'TEST-2')`, [ids.job, ids.company, ids.otherJob, ids.otherCompany]);
await db.query(`insert into public.job_attachments (id, company_id, job_id, name, mime_type, size_bytes, kind, storage_bucket, storage_path)
  values ($1,$2,$3,'approved-photo.jpg','image/jpeg',1024,'photo','job-files','safe/photo.jpg')`, [ids.attachment, ids.company, ids.job]);

const envelope = JSON.stringify({
  schemaVersion: 'encrypted-social-token-v1', algorithm: 'AES-GCM', keyVersion: 1,
  purpose: 'meta-connection', iv: 'abcdefghijklmnop', ciphertext: 'abcdefghijklmnopqrstuvw',
});
await db.query(`
  insert into public.company_social_connections (
    id, company_id, provider, status, facebook_page_id, facebook_page_name,
    granted_scopes, token_envelope, connected_by, connected_at
  ) values
    ($1, $2, 'meta-facebook-login', 'connected', '10001', 'Primary Page',
      array['pages_show_list','pages_read_engagement','instagram_basic','pages_manage_posts'], $3::jsonb, $4, now()),
    ($5, $6, 'meta-facebook-login', 'connected', '10002', 'Other Page',
      array['pages_show_list','pages_read_engagement','instagram_basic'], $3::jsonb, $4, now())
`, [ids.connection, ids.company, envelope, ids.actor, ids.threeScopeConnection, ids.otherCompany]);

const scopeConstraint = await db.query(`select pg_get_constraintdef(oid) as definition from pg_constraint where conname = 'company_social_connections_scopes_check'`);
check(() => assert.equal(scopeConstraint.rows.length, 1));
check(() => assert.match(scopeConstraint.rows[0].definition, /pages_manage_posts/));
check(() => assert.doesNotMatch(scopeConstraint.rows[0].definition, /business_management|instagram_content_publish|pages_manage_metadata/));

await assertRejectsSql(`insert into public.company_social_connections (
  id,company_id,provider,status,facebook_page_id,facebook_page_name,granted_scopes,token_envelope
) values ('00000000-0000-4000-8000-000000007099',$1,'meta-facebook-login','connected','9','Bad',array['unknown_scope'],$2::jsonb)`, [ids.company, envelope]);

await assertRejectsSql(beginSql(), [crypto.randomUUID(), ids.company, crypto.randomUUID(), ids.job, crypto.randomUUID(), 'Disconnected connection.', ids.actor]);
await db.query(`update public.company_social_connections
  set status='revoked', token_envelope=null, revoked_at=now(), granted_scopes=array['pages_show_list','pages_read_engagement','instagram_basic','pages_manage_posts']
  where id=$1`, [ids.threeScopeConnection]);
await assertRejectsSql(beginSql(), [crypto.randomUUID(), ids.otherCompany, ids.threeScopeConnection, ids.otherJob, crypto.randomUUID(), 'Revoked connection.', ids.actor]);
await db.query(`update public.company_social_connections
  set status='connected', token_envelope=$2::jsonb, revoked_at=null, granted_scopes=array['pages_show_list','pages_read_engagement','instagram_basic']
  where id=$1`, [ids.threeScopeConnection, envelope]);

const grants = await db.query(`
  select
    has_table_privilege('service_role', 'public.company_social_publications', 'SELECT') as service_select,
    has_table_privilege('service_role', 'public.company_social_publications', 'INSERT') as service_insert,
    has_table_privilege('service_role', 'public.company_social_publications', 'UPDATE') as service_update,
    has_table_privilege('service_role', 'public.company_social_publications', 'DELETE') as service_delete,
    has_table_privilege('service_role', 'public.company_social_publications', 'TRUNCATE') as service_truncate,
    has_table_privilege('service_role', 'public.company_social_publications', 'REFERENCES') as service_references,
    has_table_privilege('service_role', 'public.company_social_publications', 'TRIGGER') as service_trigger,
    has_table_privilege('anon', 'public.company_social_publications', 'SELECT') as anon_select,
    has_table_privilege('authenticated', 'public.company_social_publications', 'SELECT') as authenticated_select
`);
check(() => assert.equal(grants.rows[0].service_select, true));
check(() => assert.equal(grants.rows[0].service_insert, true));
check(() => assert.equal(grants.rows[0].service_update, true));
check(() => assert.equal(grants.rows[0].service_delete, false));
check(() => assert.equal(grants.rows[0].service_truncate, false));
check(() => assert.equal(grants.rows[0].service_references, false));
check(() => assert.equal(grants.rows[0].service_trigger, false));
check(() => assert.equal(grants.rows[0].anon_select, false));
check(() => assert.equal(grants.rows[0].authenticated_select, false));

const maintainPrivilege = await optionalTablePrivilege(db, 'service_role', 'MAINTAIN');
if (maintainPrivilege.supported) check(() => assert.equal(maintainPrivilege.allowed, false));
const serviceDirectPrivileges = await directTablePrivileges(db, 'service_role');
check(() => assert.deepEqual(serviceDirectPrivileges, ['INSERT', 'SELECT', 'UPDATE']));
for (const role of ['anon', 'authenticated']) {
  const roleDirectPrivileges = await directTablePrivileges(db, role);
  check(() => assert.deepEqual(roleDirectPrivileges, []));
  const browserPrivileges = await db.query(`select
    has_table_privilege($1, 'public.company_social_publications', 'SELECT') as can_select,
    has_table_privilege($1, 'public.company_social_publications', 'INSERT') as can_insert,
    has_table_privilege($1, 'public.company_social_publications', 'UPDATE') as can_update,
    has_table_privilege($1, 'public.company_social_publications', 'DELETE') as can_delete,
    has_table_privilege($1, 'public.company_social_publications', 'TRUNCATE') as can_truncate,
    has_table_privilege($1, 'public.company_social_publications', 'REFERENCES') as can_references,
    has_table_privilege($1, 'public.company_social_publications', 'TRIGGER') as can_trigger
  `, [role]);
  check(() => assert.ok(Object.values(browserPrivileges.rows[0]).every((allowed) => allowed === false)));
}
const publicTableAcl = await db.query(`
  select a.privilege_type
  from pg_class c
  cross join lateral aclexplode(c.relacl) a
  where c.oid='public.company_social_publications'::regclass and a.grantee=0
`);
check(() => assert.deepEqual(publicTableAcl.rows, []));

const rpcNames = [
  'approve_company_facebook_publication_photo',
  'revoke_company_facebook_publication_photo_approval',
  'exclude_company_facebook_publication_photo',
  'resolve_company_media_analysis_false_positive',
  'list_company_facebook_publication_photo_candidates',
  'meta_facebook_publication_audit_metadata_valid',
  'record_company_media_analysis_result',
  'begin_company_facebook_publication',
  'complete_company_facebook_publication',
  'fail_company_facebook_publication',
  'mark_company_facebook_publication_unknown',
];
const rpcGrants = await db.query(`
  select p.proname,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service_allowed,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_allowed,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_allowed,
    coalesce((select bool_or(a.privilege_type='EXECUTE') from aclexplode(p.proacl) a where a.grantee=0), false) as public_allowed
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname = any($1::text[])
`, [rpcNames]);
check(() => assert.ok(rpcGrants.rows.length >= 8));
for (const row of rpcGrants.rows) {
  check(() => assert.equal(row.service_allowed, true));
  check(() => assert.equal(row.anon_allowed, false));
  check(() => assert.equal(row.authenticated_allowed, false));
  check(() => assert.equal(row.public_allowed, false));
}
const rpcShapes = await db.query(`
  select proname, pronargs
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname = any($1::text[])
`, [rpcNames]);
const signatureSet = new Set(rpcShapes.rows.map((row) => `${row.proname}/${row.pronargs}`));
for (const signature of [
  'approve_company_facebook_publication_photo/13',
  'revoke_company_facebook_publication_photo_approval/8',
  'exclude_company_facebook_publication_photo/10',
  'resolve_company_media_analysis_false_positive/11',
  'list_company_facebook_publication_photo_candidates/3',
  'meta_facebook_publication_audit_metadata_valid/4',
  'record_company_media_analysis_result/10',
  'begin_company_facebook_publication/17',
  'complete_company_facebook_publication/9',
  'fail_company_facebook_publication/13',
  'mark_company_facebook_publication_unknown/7',
]) {
  check(() => assert.equal(signatureSet.has(signature), true));
}
for (const name of rpcNames) {
  check(() => assert.equal(rpcShapes.rows.filter((row) => row.proname === name).length, 1));
}
const legacySignatures = await db.query(`
  select
    to_regprocedure('public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, uuid, text, text, timestamptz)') as old_begin_foundation,
    to_regprocedure('public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, text, uuid, text, smallint, uuid, text, text, timestamptz)') as old_begin_single_photo,
    to_regprocedure('public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, timestamptz)') as old_begin_review_fix,
    to_regprocedure('public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, timestamptz)') as old_fail,
    to_regprocedure('public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, timestamptz)') as old_unknown,
    to_regprocedure('public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, timestamptz)') as old_complete_7,
    to_regprocedure('public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, timestamptz)') as old_complete_8,
    to_regprocedure('public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, text, text, text, timestamptz)') as old_exclude,
    to_regprocedure('public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz)') as old_false_positive,
    to_regprocedure('public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz)') as old_approve,
    to_regprocedure('public.begin_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz)') as public_begin_helper,
    to_regprocedure('public.complete_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz)') as public_complete_helper,
    to_regprocedure('public.fail_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz)') as public_fail_helper,
    to_regprocedure('public.mark_company_facebook_publication_unknown_unvalidated_20260805(uuid, uuid, uuid, text, text, jsonb, timestamptz)') as public_unknown_helper
`);
check(() => assert.ok(Object.values(legacySignatures.rows[0]).every((value) => value === null)));

const privateHelperGrants = await db.query(`
  select p.proname,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service_allowed,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_allowed,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_allowed,
    coalesce((select bool_or(a.privilege_type='EXECUTE') from aclexplode(p.proacl) a where a.grantee=0), false) as public_allowed
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname = any($1::text[])
`, [[
  'begin_company_facebook_publication_unvalidated_20260805',
  'complete_company_facebook_publication_unvalidated_20260805',
  'fail_company_facebook_publication_unvalidated_20260805',
  'mark_company_facebook_publication_unknown_unvalidated_20260805',
]]);
check(() => assert.equal(privateHelperGrants.rows.length, 4));
for (const row of privateHelperGrants.rows) {
  check(() => assert.equal(row.service_allowed, false));
  check(() => assert.equal(row.anon_allowed, false));
  check(() => assert.equal(row.authenticated_allowed, false));
  check(() => assert.equal(row.public_allowed, false));
}

await db.exec('savepoint media_persistence_contracts;');
const webpAttachment = '00000000-0000-4000-8000-000000007087';
const categoryAttachmentA = '00000000-0000-4000-8000-000000007088';
const categoryAttachmentB = '00000000-0000-4000-8000-000000007089';
await db.query(`insert into public.job_attachments (id, company_id, job_id, name, mime_type, size_bytes, kind, storage_bucket, storage_path)
  values
    ($1,$4,$5,'webp-photo.webp','image/webp',2048,'photo','job-files','safe/webp.webp'),
    ($2,$4,$5,'category-a.jpg','image/jpeg',2048,'photo','job-files','safe/category-a.jpg'),
    ($3,$4,$5,'category-b.png','image/png',2048,'photo','job-files','safe/category-b.png')`, [webpAttachment, categoryAttachmentA, categoryAttachmentB, ids.company, ids.job]);
const categoryRows = await recordMediaAnalysis('00000000-0000-4000-8000-000000007130', [
  mediaPayload(categoryAttachmentA, 'image/jpeg', new Uint8Array(32).fill(0x41), privacyCategories.slice(0, 5)),
  mediaPayload(categoryAttachmentB, 'image/png', new Uint8Array(32).fill(0x42), privacyCategories.slice(5)),
]);
check(() => assert.equal(categoryRows.length, 2));
const storedCategories = await db.query(`select finding_category from public.company_media_analysis_privacy_findings
  where analysis_run_id='00000000-0000-4000-8000-000000007130' order by finding_category`);
check(() => assert.deepEqual(storedCategories.rows.map((row) => row.finding_category), [...privacyCategories].sort()));
const webpRows = await recordMediaAnalysis('00000000-0000-4000-8000-000000007131', [
  mediaPayload(webpAttachment, 'image/webp', new Uint8Array(32).fill(0x43), []),
]);
check(() => assert.equal(webpRows.length, 1));
check(() => assert.equal(webpRows[0].analysis_run_id, '00000000-0000-4000-8000-000000007131'));
check(() => assert.ok(/^[0-9a-f-]{36}$/i.test(webpRows[0].attachment_result_id)));
await assertRejectsSql(approvePhotoSql(), [crypto.randomUUID(), ids.company, ids.job, webpAttachment, webpRows[0].analysis_run_id, webpRows[0].attachment_result_id, new Uint8Array(32).fill(0x43), ids.actor, verifiedActor.name, verifiedActor.role, 'WebP Facebook approval must reject']);
const webpCandidates = await db.query(`select * from public.list_company_facebook_publication_photo_candidates($1,$2,$3)`, [ids.company, ids.job, webpAttachment]);
check(() => assert.equal(webpCandidates.rows.length, 0));
for (const [label, payloads] of [
  ['unknown category', [mediaPayload(categoryAttachmentA, 'image/jpeg', new Uint8Array(32).fill(0x44), ['unknown_category'])]],
  ['mime mismatch', [mediaPayload(categoryAttachmentA, 'image/png', new Uint8Array(32).fill(0x45), [])]],
  ['duplicate attachment', [
    mediaPayload(categoryAttachmentA, 'image/jpeg', new Uint8Array(32).fill(0x46), []),
    mediaPayload(categoryAttachmentA, 'image/jpeg', new Uint8Array(32).fill(0x47), []),
  ]],
  ['duplicate finding', [{
    ...mediaPayload(categoryAttachmentA, 'image/jpeg', new Uint8Array(32).fill(0x48), ['possible_face']),
    privacyFindings: [
      { findingId: 'duplicate-finding', findingCategory: 'possible_face', riskLevel: 'high' },
      { findingId: 'duplicate-finding', findingCategory: 'possible_address', riskLevel: 'medium' },
    ],
  }]],
  ['too many attachments', [
    mediaPayload(categoryAttachmentA, 'image/jpeg', new Uint8Array(32).fill(0x49), []),
    mediaPayload(categoryAttachmentB, 'image/png', new Uint8Array(32).fill(0x4a), []),
    mediaPayload(webpAttachment, 'image/webp', new Uint8Array(32).fill(0x4b), []),
    mediaPayload(ids.attachment, 'image/jpeg', new Uint8Array(32).fill(0x4c), []),
    { ...mediaPayload(ids.attachment, 'image/jpeg', new Uint8Array(32).fill(0x4d), []), attachmentId: crypto.randomUUID() },
  ]],
]) {
  const runId = crypto.randomUUID();
  await assertRejectsSql(recordMediaAnalysisSql(), [
    runId, ids.company, ids.job, `failure-${label}-${runId}`, 'completed', 'deterministic-fallback', 'fixture', 'media-analysis-v1', JSON.stringify(payloads),
  ]);
  const rollback = await db.query(`select
    (select count(*)::integer from public.company_media_analysis_runs where id=$1) as runs,
    (select count(*)::integer from public.company_media_analysis_attachment_results where analysis_run_id=$1) as results,
    (select count(*)::integer from public.company_media_analysis_privacy_findings where analysis_run_id=$1) as findings
  `, [runId]);
  check(() => assert.deepEqual(rollback.rows[0], { runs: 0, results: 0, findings: 0 }));
}
await db.query(`insert into public.job_attachments (id, company_id, job_id, name, mime_type, size_bytes, kind, storage_bucket, storage_path)
  values ('00000000-0000-4000-8000-000000007132',$1,$2,'bad-video.mp4','video/mp4',2048,'video','job-files','safe/video.mp4')`, [ids.company, ids.job]);
const videoRunId = crypto.randomUUID();
await assertRejectsSql(recordMediaAnalysisSql(), [
  videoRunId, ids.company, ids.job, 'video-as-photo-test', 'completed', 'deterministic-fallback', 'fixture', 'media-analysis-v1',
  JSON.stringify([mediaPayload('00000000-0000-4000-8000-000000007132', 'video/mp4', new Uint8Array(32).fill(0x4e), [])]),
]);
const videoRollback = await db.query(`select
  (select count(*)::integer from public.company_media_analysis_runs where id=$1) as runs,
  (select count(*)::integer from public.company_media_analysis_attachment_results where analysis_run_id=$1) as results,
  (select count(*)::integer from public.company_media_analysis_privacy_findings where analysis_run_id=$1) as findings
`, [videoRunId]);
check(() => assert.deepEqual(videoRollback.rows[0], { runs: 0, results: 0, findings: 0 }));
await db.exec('rollback to savepoint media_persistence_contracts;');
await db.exec('release savepoint media_persistence_contracts;');

const multilineMessage = [
  'Service story: our team documented work for a rooftop unit.',
  'The reported issue was: insufficient cooling.',
  '',
  'Recorded work performed: replaced the failed contactor.',
  'Final result: normal operation verified.',
].join('\n');
await db.exec('savepoint multiline_contract;');
const multilinePublication = '00000000-0000-4000-8000-000000007009';
const multilineKey = '00000000-0000-4000-8000-000000007019';
await beginPublication(multilinePublication, ids.company, ids.connection, ids.job, multilineKey, multilineMessage, ids.actor);
const storedMultiline = await db.query(`select approved_message, encode(message_sha256, 'hex') as message_hash from public.company_social_publications where id=$1`, [multilinePublication]);
const multilineHash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(multilineMessage))).toString('hex');
check(() => assert.equal(storedMultiline.rows[0].approved_message, multilineMessage));
check(() => assert.equal(storedMultiline.rows[0].message_hash, multilineHash));
await db.exec('rollback to savepoint multiline_contract;');
await db.exec('release savepoint multiline_contract;');

const publicationA = '00000000-0000-4000-8000-000000007010';
const keyA = '00000000-0000-4000-8000-000000007011';
const messageA = 'Replaced the contactor and verified normal operation.';
const beginA = await beginPublication(publicationA, ids.company, ids.connection, ids.job, keyA, messageA, ids.actor);
check(() => assert.equal(beginA.should_publish, true));
check(() => assert.equal(beginA.publication_status, 'publishing'));
const duplicateA = await beginPublication('00000000-0000-4000-8000-000000007012', ids.company, ids.connection, ids.job, keyA, messageA, ids.actor);
check(() => assert.equal(duplicateA.should_publish, false));
check(() => assert.equal(duplicateA.publication_status, 'publishing'));
await assertRejectsSql(beginSql(), ['00000000-0000-4000-8000-000000007013', ids.company, ids.connection, ids.job, keyA, 'Different payload', ids.actor]);

await db.query(`select * from public.complete_company_facebook_publication($1,$2,$3,$4,$5,'10001_20002',null,'{}'::jsonb,now())`, [publicationA, ids.company, ids.actor, verifiedActor.name, verifiedActor.role]);
const publishedDuplicate = await beginPublication('00000000-0000-4000-8000-000000007014', ids.company, ids.connection, ids.job, keyA, messageA, ids.actor);
check(() => assert.equal(publishedDuplicate.should_publish, false));
check(() => assert.equal(publishedDuplicate.publication_status, 'published'));

const publicationB = '00000000-0000-4000-8000-000000007020';
const keyB = '00000000-0000-4000-8000-000000007021';
await beginPublication(publicationB, ids.company, ids.connection, ids.job, keyB, 'Measured airflow is within specification.', ids.actor);
await db.query(`select * from public.fail_company_facebook_publication($1,$2,$3,$4,$5,403,200,10,'MISSING_PERMISSION',false,'META_PUBLICATION_PROVIDER_REJECTED','{}'::jsonb,now())`, [publicationB, ids.company, ids.actor, verifiedActor.name, verifiedActor.role]);
const failedDuplicate = await beginPublication('00000000-0000-4000-8000-000000007022', ids.company, ids.connection, ids.job, keyB, 'Measured airflow is within specification.', ids.actor);
check(() => assert.equal(failedDuplicate.should_publish, false));
check(() => assert.equal(failedDuplicate.publication_status, 'failed'));
await assertRejectsSql(`update public.company_social_publications set provider_http_status=99 where id=$1`, [publicationB]);
await assertRejectsSql(`update public.company_social_publications set provider_error_category='UNBOUNDED_VALUE' where id=$1`, [publicationB]);

const publicationC = '00000000-0000-4000-8000-000000007030';
const keyC = '00000000-0000-4000-8000-000000007031';
await beginPublication(publicationC, ids.company, ids.connection, ids.job, keyC, 'System start-up completed successfully.', ids.actor);
await db.query(`select * from public.mark_company_facebook_publication_unknown($1,$2,$3,$4,$5,'{}'::jsonb,now())`, [publicationC, ids.company, ids.actor, verifiedActor.name, verifiedActor.role]);
const unknownDuplicate = await beginPublication('00000000-0000-4000-8000-000000007032', ids.company, ids.connection, ids.job, keyC, 'System start-up completed successfully.', ids.actor);
check(() => assert.equal(unknownDuplicate.should_publish, false));
check(() => assert.equal(unknownDuplicate.publication_status, 'delivery_unknown'));

const mediaHash = new Uint8Array(32).fill(0x11);
await db.query(`insert into public.company_media_analysis_runs (
  id, company_id, job_id, correlation_id, status, provider, model, analysis_version, completed_at
) values ($1,$2,$3,'media-analysis-fixture','completed','deterministic-fallback','fixture','media-analysis-v1',now())`, [ids.analysisRun, ids.company, ids.job]);
await db.query(`insert into public.company_media_analysis_attachment_results (
  id, analysis_run_id, company_id, job_id, attachment_id, attachment_sha256, detected_mime_type,
  analysis_status, privacy_review_status, excluded
) values ($1,$2,$3,$4,$5,$6::bytea,'image/jpeg','analyzed','passed',false)`, [ids.analysisResult, ids.analysisRun, ids.company, ids.job, ids.attachment, mediaHash]);
const approval = await approvePhoto(ids.attachment, ids.analysisRun, ids.analysisResult, mediaHash, 'SQL approval fixture');
check(() => assert.equal(approval.rows[0].analysis_run_id, ids.analysisRun));
check(() => assert.equal(approval.rows[0].approval_status, 'approved'));

await assertRejectsSql(approvePhotoSql(), [crypto.randomUUID(), ids.company, ids.job, ids.attachment, ids.analysisRun, ids.analysisResult, new Uint8Array(32).fill(0x12), ids.actor, verifiedActor.name, verifiedActor.role, 'Checksum mismatch fixture']);

const blockedAnalysisRun = '00000000-0000-4000-8000-000000007092';
const blockedAnalysisResult = '00000000-0000-4000-8000-000000007093';
const blockedAttachment = '00000000-0000-4000-8000-000000007086';
const blockedHash = new Uint8Array(32).fill(0x22);
await db.query(`insert into public.job_attachments (
  id, company_id, job_id, name, mime_type, size_bytes, kind, storage_bucket, storage_path
) values ($1,$2,$3,'blocked-photo.jpg','image/jpeg',24,'photo','job-files','fixture/blocked-photo.jpg')`, [blockedAttachment, ids.company, ids.job]);
await db.query(`insert into public.company_media_analysis_runs (
  id, company_id, job_id, correlation_id, status, provider, model, analysis_version, completed_at
) values ($1,$2,$3,'blocked-media-analysis','completed','deterministic-fallback','fixture','media-analysis-v1',now())`, [blockedAnalysisRun, ids.company, ids.job]);
await db.query(`insert into public.company_media_analysis_attachment_results (
  id, analysis_run_id, company_id, job_id, attachment_id, attachment_sha256, detected_mime_type,
  analysis_status, privacy_review_status, excluded
) values ($1,$2,$3,$4,$5,$6::bytea,'image/jpeg','analyzed','blocked',false)`, [blockedAnalysisResult, blockedAnalysisRun, ids.company, ids.job, blockedAttachment, blockedHash]);
await db.query(`insert into public.company_media_analysis_privacy_findings (
  id, analysis_run_id, attachment_result_id, company_id, job_id, attachment_id, finding_id, finding_category, risk_level
) values (gen_random_uuid(),$1,$2,$3,$4,$5,'finding-1','possible_license_plate','high')`, [blockedAnalysisRun, blockedAnalysisResult, ids.company, ids.job, blockedAttachment]);
await assertRejectsSql(approvePhotoSql(), [crypto.randomUUID(), ids.company, ids.job, blockedAttachment, blockedAnalysisRun, blockedAnalysisResult, blockedHash, ids.actor, verifiedActor.name, verifiedActor.role, 'Blocked privacy fixture']);
for (const findingIds of [
  `array['finding-1','finding-1']::text[]`,
  `array['finding-1','unknown-finding']::text[]`,
]) {
  await assertRejectsSql(`select * from public.resolve_company_media_analysis_false_positive(
    $1,$2,$3,$4,$5,${findingIds},$6,$7,$8,'Partial false positive must reject',now()
  )`, [ids.company, ids.job, blockedAttachment, blockedAnalysisRun, blockedAnalysisResult, ids.actor, verifiedActor.name, verifiedActor.role]);
  const partialFindingRollback = await db.query(`select
    (select count(*)::integer from public.company_media_analysis_privacy_findings where attachment_result_id=$1 and resolved_as_false_positive=false) as unresolved,
    (select privacy_review_status from public.company_media_analysis_attachment_results where id=$1) as status,
    (select count(*)::integer from public.audit_events where action='meta_publication_media_false_positive_resolved' and resource_id=$2) as audits
  `, [blockedAnalysisResult, blockedAttachment]);
  check(() => assert.deepEqual(partialFindingRollback.rows[0], { unresolved: 1, status: 'blocked', audits: 0 }));
}
const falsePositive = await db.query(`select * from public.resolve_company_media_analysis_false_positive(
  $1,$2,$3,$4,$5,array['finding-1']::text[],$6,$7,$8,'False positive SQL fixture',now()
)`, [ids.company, ids.job, blockedAttachment, blockedAnalysisRun, blockedAnalysisResult, ids.actor, verifiedActor.name, verifiedActor.role]);
check(() => assert.equal(falsePositive.rows[0].privacy_review_status, 'resolved_false_positive'));
const resolvedApproval = await approvePhoto(blockedAttachment, blockedAnalysisRun, blockedAnalysisResult, blockedHash, 'Resolved false positive approval fixture');
check(() => assert.equal(resolvedApproval.rows[0].approval_status, 'approved'));
const excluded = await db.query(`select * from public.exclude_company_facebook_publication_photo(
  $1,$2,$3,$4,$5,$6,$7,$8,'Exclude SQL fixture',now()
)`, [ids.company, ids.job, blockedAttachment, blockedAnalysisRun, blockedAnalysisResult, ids.actor, verifiedActor.name, verifiedActor.role]);
check(() => assert.equal(excluded.rows[0].excluded, true));
const excludedApprovalReason = await db.query(`select approval_reason, exclusion_reason from public.company_social_publication_media_approvals where id=$1`, [resolvedApproval.rows[0].id]);
check(() => assert.equal(excludedApprovalReason.rows[0].approval_reason, 'Resolved false positive approval fixture'));
check(() => assert.equal(excludedApprovalReason.rows[0].exclusion_reason, 'Exclude SQL fixture'));
await assertRejectsSql(approvePhotoSql(), [crypto.randomUUID(), ids.company, ids.job, blockedAttachment, blockedAnalysisRun, blockedAnalysisResult, blockedHash, ids.actor, verifiedActor.name, verifiedActor.role, 'Excluded approval fixture']);

await db.exec('savepoint newest_analysis_authority;');
const newestAttachment = '00000000-0000-4000-8000-000000007120';
const newestOldRun = '00000000-0000-4000-8000-000000007121';
const newestOldResult = '00000000-0000-4000-8000-000000007122';
const newestNewRun = '00000000-0000-4000-8000-000000007123';
const newestNewResult = '00000000-0000-4000-8000-000000007124';
const newestHash = new Uint8Array(32).fill(0x33);
await db.query(`insert into public.job_attachments (
  id, company_id, job_id, name, mime_type, size_bytes, kind, storage_bucket, storage_path
) values ($1,$2,$3,'newest-authority.jpg','image/jpeg',24,'photo','job-files','fixture/newest-authority.jpg')`, [newestAttachment, ids.company, ids.job]);
await db.query(`insert into public.company_media_analysis_runs (
  id, company_id, job_id, correlation_id, status, provider, model, analysis_version, completed_at, created_at
) values ($1,$2,$3,'newest-old-passed','completed','deterministic-fallback','fixture','media-analysis-v1',now(),now() - interval '2 minutes')`, [newestOldRun, ids.company, ids.job]);
await db.query(`insert into public.company_media_analysis_attachment_results (
  id, analysis_run_id, company_id, job_id, attachment_id, attachment_sha256, detected_mime_type,
  analysis_status, privacy_review_status, excluded, created_at
) values ($1,$2,$3,$4,$5,$6::bytea,'image/jpeg','analyzed','passed',false,now() - interval '2 minutes')`, [newestOldResult, newestOldRun, ids.company, ids.job, newestAttachment, newestHash]);
const newestOldApproval = await approvePhoto(newestAttachment, newestOldRun, newestOldResult, newestHash, 'Old approval before new evidence');
check(() => assert.equal(newestOldApproval.rows[0].approval_status, 'approved'));
await db.query(`insert into public.company_media_analysis_runs (
  id, company_id, job_id, correlation_id, status, provider, model, analysis_version, completed_at, created_at
) values ($1,$2,$3,'newest-blocked','completed','deterministic-fallback','fixture','media-analysis-v1',now(),now())`, [newestNewRun, ids.company, ids.job]);
await db.query(`insert into public.company_media_analysis_attachment_results (
  id, analysis_run_id, company_id, job_id, attachment_id, attachment_sha256, detected_mime_type,
  analysis_status, privacy_review_status, excluded, created_at
) values ($1,$2,$3,$4,$5,$6::bytea,'image/jpeg','analyzed','blocked',false,now())`, [newestNewResult, newestNewRun, ids.company, ids.job, newestAttachment, newestHash]);
await assertRejectsSql(approvePhotoSql(), [crypto.randomUUID(), ids.company, ids.job, newestAttachment, newestNewRun, newestNewResult, newestHash, ids.actor, verifiedActor.name, verifiedActor.role, 'Newest blocked must reject']);
await db.query(`update public.company_media_analysis_runs set status='failed' where id=$1`, [newestNewRun]);
await assertRejectsSql(approvePhotoSql(), [crypto.randomUUID(), ids.company, ids.job, newestAttachment, newestNewRun, newestNewResult, newestHash, ids.actor, verifiedActor.name, verifiedActor.role, 'Newest failed must reject']);
await db.query(`update public.company_media_analysis_runs set status='completed' where id=$1`, [newestNewRun]);
await db.query(`update public.company_media_analysis_attachment_results set privacy_review_status='passed', excluded=true where id=$1`, [newestNewResult]);
await assertRejectsSql(approvePhotoSql(), [crypto.randomUUID(), ids.company, ids.job, newestAttachment, newestNewRun, newestNewResult, newestHash, ids.actor, verifiedActor.name, verifiedActor.role, 'Newest excluded must reject']);
await db.query(`update public.company_media_analysis_attachment_results set excluded=false, attachment_sha256=$2::bytea where id=$1`, [newestNewResult, new Uint8Array(32).fill(0x34)]);
await assertRejectsSql(approvePhotoSql(), [crypto.randomUUID(), ids.company, ids.job, newestAttachment, newestNewRun, newestNewResult, newestHash, ids.actor, verifiedActor.name, verifiedActor.role, 'Newest checksum mismatch must reject']);
await db.query(`update public.company_media_analysis_attachment_results set attachment_sha256=$2::bytea, created_at=now() where id=$1`, [newestNewResult, newestHash]);
await assertRejectsSql(`select * from public.exclude_company_facebook_publication_photo(
  $1,$2,$3,$4,$5,$6,$7,$8,'Stale exclude must reject',now()
)`, [ids.company, ids.job, newestAttachment, newestOldRun, newestOldResult, ids.actor, verifiedActor.name, verifiedActor.role]);
await assertRejectsSql(`select * from public.resolve_company_media_analysis_false_positive(
  $1,$2,$3,$4,$5,array['stale-finding']::text[],$6,$7,$8,'Stale false positive must reject',now()
)`, [ids.company, ids.job, newestAttachment, newestOldRun, newestOldResult, ids.actor, verifiedActor.name, verifiedActor.role]);
await db.query(`update public.company_social_publication_media_approvals set approval_status='revoked', revoked_by=$2, revoked_at=now(), updated_at=now() where id=$1`, [newestOldApproval.rows[0].id, ids.actor]);
const newestActiveApprovalBeforeFreshApproval = await db.query(`select count(*)::integer as count from public.company_social_publication_media_approvals
  where company_id=$1 and job_id=$2 and attachment_id=$3 and approval_status='approved' and revoked_at is null`, [ids.company, ids.job, newestAttachment]);
check(() => assert.equal(newestActiveApprovalBeforeFreshApproval.rows[0].count, 0));
await assertRejectsSql(approvePhotoSql(), [crypto.randomUUID(), ids.company, ids.job, newestAttachment, newestOldRun, newestOldResult, newestHash, ids.actor, verifiedActor.name, verifiedActor.role, 'Stale displayed approval must reject']);
const newestFreshApproval = await approvePhoto(newestAttachment, newestNewRun, newestNewResult, newestHash, 'Fresh approval for newest result');
check(() => assert.equal(newestFreshApproval.rows[0].analysis_run_id, newestNewRun));
const newestCandidates = await db.query(`select attachment_id, attachment_result_id, analysis_run_id, attachment_sha256
  from public.list_company_facebook_publication_photo_candidates($1,$2,$3)`, [ids.company, ids.job, newestAttachment]);
check(() => assert.equal(newestCandidates.rows.length, 1));
check(() => assert.equal(newestCandidates.rows[0].attachment_result_id, newestNewResult));
check(() => assert.equal(newestCandidates.rows[0].analysis_run_id, newestNewRun));
const newestAllowed = await beginSinglePhotoPublication('00000000-0000-4000-8000-000000007127', ids.company, ids.connection, ids.job, '00000000-0000-4000-8000-000000007128', 'Newest approved publication.', ids.actor, newestAttachment);
check(() => assert.equal(newestAllowed.should_publish, true));
await db.exec('rollback to savepoint newest_analysis_authority;');
await db.exec('release savepoint newest_analysis_authority;');

const revoked = await db.query(`select * from public.revoke_company_facebook_publication_photo_approval(
  $1,$2,$3,$4,$5,$6,'SQL revocation fixture',now()
)`, [ids.company, ids.job, ids.attachment, ids.actor, verifiedActor.name, verifiedActor.role]);
check(() => assert.equal(revoked.rows[0].approval_status, 'revoked'));
check(() => assert.equal(revoked.rows[0].approval_reason, 'SQL approval fixture'));
check(() => assert.equal(revoked.rows[0].revocation_reason, 'SQL revocation fixture'));
await assertRejectsSql(`select * from public.revoke_company_facebook_publication_photo_approval(
  $1,$2,$3,$4,$5,$6,'SQL duplicate revocation fixture',now()
)`, [ids.company, ids.job, ids.attachment, ids.actor, verifiedActor.name, verifiedActor.role]);

await db.exec('savepoint strict_audit_metadata;');
const strictAuditPublication = '00000000-0000-4000-8000-000000007057';
await beginSinglePhotoPublication(strictAuditPublication, ids.company, ids.connection, ids.job, '00000000-0000-4000-8000-000000007058', 'Strict audit metadata fixture.', ids.actor, ids.attachment);
for (const invalidMetadata of [
  `jsonb_build_object('attachmentId',$6::text,'analysisRunId',$7::text,'approvalId',$8::text,'approvedAt','2026-08-05T00:00:00.000Z','revoked','false','originalMime','image/jpeg','detectedMime','image/jpeg','sanitizedMime','image/jpeg','originalByteSize',24,'sanitizedByteSize',18,'originalHashPrefix','1111111111111111','sanitizedHashPrefix','2222222222222222','width',1,'height',1,'metadataStripped',true,'gpsStripped',true,'sanitizer','ImageScript','sanitizerVersion','1.3.0','providerCallCount',1)`,
  `jsonb_build_object('attachmentId',$6::text,'analysisRunId',$7::text,'approvalId',$8::text,'approvedAt','2026-08-05T00:00:00.000Z','revoked',false,'originalMime','image/jpeg','detectedMime','image/jpeg','sanitizedMime','image/jpeg','originalByteSize','1','sanitizedByteSize',18,'originalHashPrefix','1111111111111111','sanitizedHashPrefix','2222222222222222','width',1,'height',1,'metadataStripped',true,'gpsStripped',true,'sanitizer','ImageScript','sanitizerVersion','1.3.0','providerCallCount',1)`,
  `jsonb_build_object('attachmentId',$6::text,'analysisRunId',$7::text,'approvalId',$8::text,'approvedAt','2026-02-31T00:00:00.000Z','revoked',false,'originalMime','image/jpeg','detectedMime','image/jpeg','sanitizedMime','image/jpeg','originalByteSize',24,'sanitizedByteSize',18,'originalHashPrefix','1111111111111111','sanitizedHashPrefix','2222222222222222','width',1,'height',1,'metadataStripped',true,'gpsStripped',true,'sanitizer','ImageScript','sanitizerVersion','1.3.0','providerCallCount',1)`,
  `jsonb_build_object('attachmentId',$6::text,'analysisRunId',$7::text,'approvalId',$8::text,'approvedAt','2026-08-05T00:00:00.000Z','revoked',false,'originalMime','image/jpeg','detectedMime','image/jpeg','sanitizedMime','image/jpeg','originalByteSize',24.5,'sanitizedByteSize',18,'originalHashPrefix','1111111111111111','sanitizedHashPrefix','2222222222222222','width',1,'height',1,'metadataStripped',true,'gpsStripped',true,'sanitizer','ImageScript','sanitizerVersion','1.3.0','providerCallCount',1)`,
  `jsonb_build_object('attachmentId',$6::text,'analysisRunId',$7::text,'approvalId',$8::text,'approvedAt','2026-08-05T00:00:00.000Z','revoked',false,'originalMime','image/jpeg','detectedMime','image/jpeg','sanitizedMime','image/jpeg','originalByteSize',24,'sanitizedByteSize',18,'originalHashPrefix','1111111111111111','sanitizedHashPrefix','2222222222222222','width',1,'height',1,'metadataStripped',true,'gpsStripped',true,'sanitizer','ImageScript','sanitizerVersion','1.3.0','providerCallCount',0)`,
  `jsonb_build_object('attachmentId',$6::text,'analysisRunId',$7::text,'approvalId',$8::text,'approvedAt','2026-08-05T00:00:00.000Z','revoked',true,'originalMime','image/jpeg','detectedMime','image/jpeg','sanitizedMime','image/jpeg','originalByteSize',24,'sanitizedByteSize',18,'originalHashPrefix','1111111111111111','sanitizedHashPrefix','2222222222222222','width',1,'height',1,'metadataStripped',true,'gpsStripped',true,'sanitizer','ImageScript','sanitizerVersion','1.3.0','providerCallCount',1)`,
  `jsonb_build_object('attachmentId',$6::text,'analysisRunId',$7::text,'approvalId',$8::text,'approvedAt','2026-08-05T00:00:00.000Z','revoked',false,'originalMime','image/jpeg','detectedMime','image/jpeg','sanitizedMime','image/jpeg','originalByteSize',24,'sanitizedByteSize',18,'originalHashPrefix','1111111111111111','sanitizedHashPrefix','2222222222222222','width',1,'height',1,'metadataStripped',true,'gpsStripped',true,'sanitizer','ImageScript','sanitizerVersion','1.3.0','providerCallCount',1,'extra','nope')`,
  `jsonb_build_object('attachmentId',$6::text,'analysisRunId',$7::text,'approvalId',$8::text,'approvedAt','2026-08-05T00:00:00.000Z','revoked',false,'originalMime','image/jpeg','detectedMime','image/jpeg','sanitizedMime','image/jpeg','originalByteSize',24,'sanitizedByteSize',18,'originalHashPrefix','1111111111111111','sanitizedHashPrefix','2222222222222222','width',1,'height',1,'metadataStripped',true,'gpsStripped',true,'sanitizer','ImageScript','sanitizerVersion','1.3.0','providerCallCount',1,'nested',jsonb_build_object('bad',true))`,
]) {
  await assertRejectsSql(`select * from public.complete_company_facebook_publication(
    $1,$2,$3,$4,$5,null,'10001_photo_invalid',${invalidMetadata},now()
  )`, [strictAuditPublication, ids.company, ids.actor, verifiedActor.name, verifiedActor.role, ids.attachment, ids.analysisRun, approval.rows[0].id], 'invalid publication audit metadata');
}
await db.exec('rollback to savepoint strict_audit_metadata;');
await db.exec('release savepoint strict_audit_metadata;');

const singlePhotoPublication = '00000000-0000-4000-8000-000000007060';
const singlePhotoKey = '00000000-0000-4000-8000-000000007061';
const singlePhotoMessage = 'Photo publication constraint fixture.';
const singleBegin = await beginSinglePhotoPublication(singlePhotoPublication, ids.company, ids.connection, ids.job, singlePhotoKey, singlePhotoMessage, ids.actor, ids.attachment);
check(() => assert.equal(singleBegin.should_publish, true));
const singleStartedAudit = await db.query(`select metadata from public.audit_events
  where action='meta_publication_started' and resource_id=$1
  order by created_at desc limit 1`, [singlePhotoPublication]);
check(() => assert.equal(singleStartedAudit.rows.length, 1));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.publicationKind, 'single_photo'));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.analysisRunId, ids.analysisRun));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.approvalId, '00000000-0000-4000-8000-000000007190'));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.approvedAt, '2026-08-05T00:00:00.000Z'));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.originalMime, 'image/jpeg'));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.detectedMime, 'image/jpeg'));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.sanitizedMime, 'image/jpeg'));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.originalByteSize, 24));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.sanitizedByteSize, 18));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.originalHashPrefix, '1111111111111111'));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.sanitizedHashPrefix, '2222222222222222'));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.width, 1));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.height, 1));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.metadataStripped, true));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.gpsStripped, true));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.sanitizer, 'ImageScript'));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.sanitizerVersion, '1.3.0'));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.providerCallCount, 0));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.attachmentId, ids.attachment));
check(() => assert.match(singleStartedAudit.rows[0].metadata.intentHashPrefix, /^[0-9a-f]{16}$/));
check(() => assert.equal(singleStartedAudit.rows[0].metadata.requestCorrelationId, singlePhotoKey));
await db.query(`select * from public.complete_company_facebook_publication(
  $1,$2,$3,$4,$5,null,'10001_photo_30003',
  jsonb_build_object(
    'attachmentId',$8::text,
    'analysisRunId',$6::text,
    'approvalId',$7::text,
    'approvedAt',now(),
    'revoked',false,
    'originalMime','image/jpeg',
    'detectedMime','image/jpeg',
    'sanitizedMime','image/jpeg',
    'originalByteSize',24,
    'sanitizedByteSize',18,
    'originalHashPrefix','1111111111111111',
    'sanitizedHashPrefix','2222222222222222',
    'width',1,
    'height',1,
    'metadataStripped',true,
    'gpsStripped',true,
    'sanitizer','ImageScript',
    'sanitizerVersion','1.3.0',
    'providerCallCount',1
  ),
  now()
)`, [singlePhotoPublication, ids.company, ids.actor, verifiedActor.name, verifiedActor.role, ids.analysisRun, approval.rows[0].id, ids.attachment]);
const singlePublished = await db.query(`select status, provider_post_id, provider_media_id, published_at from public.company_social_publications where id=$1`, [singlePhotoPublication]);
check(() => assert.equal(singlePublished.rows[0].status, 'published'));
check(() => assert.equal(singlePublished.rows[0].provider_post_id, null));
check(() => assert.equal(singlePublished.rows[0].provider_media_id, '10001_photo_30003'));
check(() => assert.ok(singlePublished.rows[0].published_at));

const mediaIdFailurePublication = '00000000-0000-4000-8000-000000007062';
await beginSinglePhotoPublication(mediaIdFailurePublication, ids.company, ids.connection, ids.job, '00000000-0000-4000-8000-000000007063', 'Missing media id fixture.', ids.actor, ids.attachment);
await db.query(`select * from public.fail_company_facebook_publication(
  $1,$2,$3,$4,$5,null,null,null,'RESPONSE_MISSING_MEDIA_ID',null,'META_PUBLICATION_FAILED',
  jsonb_build_object(
    'attachmentId',$8::text,
    'analysisRunId',$6::text,
    'approvalId',$7::text,
    'approvedAt','2026-08-05T00:00:00.000Z',
    'revoked',false,
    'originalMime','image/jpeg',
    'detectedMime','image/jpeg',
    'sanitizedMime','image/jpeg',
    'originalByteSize',24,
    'sanitizedByteSize',18,
    'originalHashPrefix','1111111111111111',
    'sanitizedHashPrefix','2222222222222222',
    'width',1,
    'height',1,
    'metadataStripped',true,
    'gpsStripped',true,
    'sanitizer','ImageScript',
    'sanitizerVersion','1.3.0',
    'providerCallCount',1
  ),
  now()
)`, [mediaIdFailurePublication, ids.company, ids.actor, verifiedActor.name, verifiedActor.role, ids.analysisRun, approval.rows[0].id, ids.attachment]);
const mediaIdFailure = await db.query(`select status, attempts, provider_error_category, last_error_code from public.company_social_publications where id=$1`, [mediaIdFailurePublication]);
check(() => assert.deepEqual(mediaIdFailure.rows[0], {
  status: 'failed',
  attempts: 1,
  provider_error_category: 'RESPONSE_MISSING_MEDIA_ID',
  last_error_code: 'META_PUBLICATION_FAILED',
}));

const transitions = await db.query(`select status,attempts,provider_post_id,provider_error_category,last_error_code from public.company_social_publications order by id`);
check(() => assert.deepEqual(transitions.rows.map((row) => row.status), ['published', 'failed', 'delivery_unknown', 'published', 'failed']));
check(() => assert.ok(transitions.rows.every((row) => row.attempts === 1)));
check(() => assert.equal(transitions.rows[0].provider_post_id, '10001_20002'));
check(() => assert.equal(transitions.rows[1].provider_error_category, 'MISSING_PERMISSION'));
check(() => assert.equal(transitions.rows[2].last_error_code, 'META_PUBLICATION_DELIVERY_UNKNOWN'));
check(() => assert.equal(transitions.rows[4].provider_error_category, 'RESPONSE_MISSING_MEDIA_ID'));

const audits = await db.query(`select action,actor_user_id,actor_name,actor_role,metadata from public.audit_events where action like 'meta_publication_%' order by created_at,id`);
check(() => assert.deepEqual([...new Set(audits.rows.map((row) => row.action))].sort(), [
  'meta_publication_delivery_unknown', 'meta_publication_failed', 'meta_publication_media_approval_revoked', 'meta_publication_media_approved', 'meta_publication_media_excluded', 'meta_publication_media_false_positive_resolved', 'meta_publication_published', 'meta_publication_started',
]));
for (const audit of audits.rows) {
  check(() => assert.equal(audit.actor_user_id, ids.actor));
  check(() => assert.equal(audit.actor_name, verifiedActor.name));
  check(() => assert.equal(audit.actor_role, verifiedActor.role));
  check(() => assert.ok(['Facebook', undefined].includes(audit.metadata.channel)));
  check(() => assert.doesNotMatch(JSON.stringify(audit.metadata), /token|secret|signed|storage|coordinates|latitude|longitude|private@example/i));
}
const singlePhotoPublishedAudit = audits.rows.find((row) => row.action === 'meta_publication_published' && row.metadata.publicationKind === 'single_photo');
check(() => assert.equal(singlePhotoPublishedAudit.metadata.providerCallCount, 1));
check(() => assert.equal(singlePhotoPublishedAudit.metadata.providerMediaId, '10001_photo_30003'));
check(() => assert.equal(singlePhotoPublishedAudit.metadata.providerPostId, null));
check(() => assert.equal(singlePhotoPublishedAudit.metadata.singlePhotoProviderPostIdNull, true));
check(() => assert.equal(singlePhotoPublishedAudit.metadata.analysisRunId, ids.analysisRun));
check(() => assert.equal(singlePhotoPublishedAudit.metadata.metadataStripped, true));
check(() => assert.equal(singlePhotoPublishedAudit.metadata.gpsStripped, true));
check(() => assert.equal(singlePhotoPublishedAudit.metadata.sanitizer, 'ImageScript'));
check(() => assert.equal(singlePhotoPublishedAudit.metadata.sanitizerVersion, '1.3.0'));
const excludedAudit = audits.rows.find((row) => row.action === 'meta_publication_media_excluded');
check(() => assert.equal(excludedAudit.metadata.exclusionReason, 'Exclude SQL fixture'));
const falsePositiveAudit = audits.rows.find((row) => row.action === 'meta_publication_media_false_positive_resolved');
check(() => assert.equal(falsePositiveAudit.metadata.resolutionReason, 'False positive SQL fixture'));
const revokedAudit = audits.rows.find((row) => row.action === 'meta_publication_media_approval_revoked');
check(() => assert.equal(revokedAudit.metadata.revocationReason, 'SQL revocation fixture'));

await assertRejectsSql(beginSql(), ['00000000-0000-4000-8000-000000007040', ids.company, ids.connection, ids.otherJob, '00000000-0000-4000-8000-000000007041', 'Tenant mismatch.', ids.actor]);
await assertRejectsSql(beginSql(), ['00000000-0000-4000-8000-000000007042', ids.otherCompany, ids.threeScopeConnection, ids.otherJob, '00000000-0000-4000-8000-000000007043', 'Missing capability.', ids.actor]);
const actorIsolationPublication = '00000000-0000-4000-8000-000000007044';
await beginPublication(actorIsolationPublication, ids.company, ids.connection, ids.job, '00000000-0000-4000-8000-000000007045', 'Actor isolation verified.', ids.actor);
await assertRejectsSql(`select * from public.complete_company_facebook_publication($1,$2,$3,$4,$5,'10001_99999',null,'{}'::jsonb,now())`, [actorIsolationPublication, ids.company, ids.otherActor, verifiedActor.name, verifiedActor.role]);

for (const invalidMessage of [
  '',
  ' leading',
  'trailing ',
  '[private]',
  `bad\u0000control`,
  'bad\tcontrol',
  `bad\u000bcontrol`,
  `bad\u001fcontrol`,
  `bad\u007fcontrol`,
  'bad\rcontrol',
  'x'.repeat(5001),
]) {
  await assertRejectsSql(beginSql(), [crypto.randomUUID(), ids.company, ids.connection, ids.job, crypto.randomUUID(), invalidMessage, ids.actor]);
}
await assertRejectsSql(`insert into public.company_social_publications (
  id,company_id,connection_id,job_id,provider,channel,status,idempotency_key,approved_message,message_sha256,approved_by,approved_at,created_at,updated_at
) values ($1,$2,$3,$4,'meta-facebook-login','Facebook','publishing',$5,'Valid text','\\x00',$6,now(),now(),now())`, [crypto.randomUUID(), ids.company, ids.connection, ids.job, crypto.randomUUID(), ids.actor]);

await db.exec(`
  create function public.reject_meta_publication_audit_fixture()
  returns trigger language plpgsql as $$
  begin
    if new.action = 'meta_publication_started' then
      raise exception 'synthetic audit failure';
    end if;
    return new;
  end;
  $$;
  create trigger reject_meta_publication_audit_fixture
    before insert on public.audit_events
    for each row execute function public.reject_meta_publication_audit_fixture();
`);
const rollbackPublicationId = '00000000-0000-4000-8000-000000007080';
await assertRejectsSql(beginSql(), [rollbackPublicationId, ids.company, ids.connection, ids.job, crypto.randomUUID(), 'Audit rollback fixture.', ids.actor]);
const rolledBackPublication = await db.query(`select count(*)::integer as count from public.company_social_publications where id=$1`, [rollbackPublicationId]);
check(() => assert.equal(rolledBackPublication.rows[0].count, 0));
await db.exec(`
  drop trigger reject_meta_publication_audit_fixture on public.audit_events;
  drop function public.reject_meta_publication_audit_fixture();
`);

const shape = await db.query(`select count(*)::integer as count from pg_constraint where conrelid='public.company_social_publications'::regclass`);
check(() => assert.ok(shape.rows[0].count >= 10));
const publicationColumns = await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='company_social_publications'`);
check(() => assert.ok(publicationColumns.rows.some((row) => row.column_name === 'provider_post_id')));

await db.exec('rollback;');
const artifacts = await db.query(`select
  (select count(*)::integer from public.company_social_publications) as publications,
  (select count(*)::integer from public.company_social_connections) as connections,
  (select count(*)::integer from public.audit_events) as audits,
  (select count(*)::integer from public.companies) as companies,
  (select count(*)::integer from public.jobs) as jobs,
  (select count(*)::integer from auth.users) as users
`);
check(() => assert.deepEqual(artifacts.rows[0], { publications: 0, connections: 0, audits: 0, companies: 0, jobs: 0, users: 0 }));
await db.close();

const canonicalDb = new PGlite();
await canonicalDb.exec(prerequisiteSchema);
await canonicalDb.exec(canonicalBlocks.foundation);
await canonicalDb.exec(canonicalBlocks.lifecycle);
await canonicalDb.exec(canonicalBlocks.ttl);
await canonicalDb.exec(canonicalBlocks.publishing);
await canonicalDb.exec('grant all privileges on table public.company_social_publications to service_role;');
await canonicalDb.exec(canonicalBlocks.publishingAclFix);
await canonicalDb.exec(migrations[5]);
await canonicalDb.exec(migrations[6]);
await canonicalDb.exec(migrations[7]);
await canonicalDb.exec(migrations[8]);
await canonicalDb.exec(migrations[9]);
await canonicalDb.exec(migrations[10]);
await canonicalDb.exec(migrations[11]);
await canonicalDb.exec(migrations[12]);
const canonicalPublication = await canonicalDb.query(`select to_regclass('public.company_social_publications') as relation`);
check(() => assert.equal(canonicalPublication.rows[0].relation, 'company_social_publications'));
const canonicalDirectPrivileges = await directTablePrivileges(canonicalDb, 'service_role');
check(() => assert.deepEqual(canonicalDirectPrivileges, ['INSERT', 'SELECT', 'UPDATE']));
await canonicalDb.close();

const isolationDb = new PGlite();
await isolationDb.exec(prerequisiteSchema);
for (const migration of migrations.slice(0, 4)) await isolationDb.exec(migration);
await isolationDb.exec('grant all privileges on table public.company_social_publications to service_role;');
await isolationDb.query(`insert into auth.users (id,email) values ($1,'acl-hotfix@example.test')`, [ids.actor]);
await isolationDb.query(`insert into public.companies (id,name,owner_email) values ($1,'ACL fixture','acl-hotfix@example.test')`, [ids.company]);
await isolationDb.query(`insert into public.company_social_connections (
  id,company_id,provider,status,facebook_page_id,facebook_page_name,granted_scopes,token_envelope,connected_by,connected_at
) values ($1,$2,'meta-facebook-login','connected','10001','ACL fixture Page',array['pages_show_list','pages_read_engagement','instagram_basic'],$3::jsonb,$4,now())`, [ids.connection, ids.company, envelope, ids.actor]);
await isolationDb.query(`insert into public.audit_events (
  company_id,category,action,actor_user_id,actor_name,actor_role,resource_type,resource_id,resource,resource_label,details
) select $1,'access','meta_acl_fixture_' || value::text,$2,'ACL fixture','manager','meta_social_connection',value::text,'Meta social connection','ACL fixture','Fixture audit'
  from generate_series(1,8) value`, [ids.company, ids.actor]);

const isolationBefore = await captureIsolationState(isolationDb);
check(() => assert.deepEqual(isolationBefore.counts, { connections: 1, states: 0, audits: 8, publications: 0 }));
await isolationDb.exec(migrations[4]);
const isolationAfter = await captureIsolationState(isolationDb);
check(() => assert.deepEqual(isolationAfter, isolationBefore));
const isolationDirectPrivileges = await directTablePrivileges(isolationDb, 'service_role');
check(() => assert.deepEqual(isolationDirectPrivileges, ['INSERT', 'SELECT', 'UPDATE']));
await isolationDb.exec(migrations[4]);
const repeatedDirectPrivileges = await directTablePrivileges(isolationDb, 'service_role');
const isolationAfterRepeat = await captureIsolationState(isolationDb);
check(() => assert.deepEqual(repeatedDirectPrivileges, ['INSERT', 'SELECT', 'UPDATE']));
check(() => assert.deepEqual(isolationAfterRepeat, isolationBefore));
await isolationDb.close();

console.log(`Meta publishing SQL checks passed: ${checks}; rollback artifacts: 0`);

function beginSql() {
  return `select * from public.begin_company_facebook_publication(
    $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,sha256(convert_to($6::text,'UTF8')),
    sha256(convert_to(concat_ws(E'\\n','facebook_publication_intent_v1','meta-facebook-login','Facebook',$2::uuid::text,$4::uuid::text,$3::uuid::text,$7::uuid::text,'text_only',$6::text,''),'UTF8')),
    'text_only',null::uuid,null::text,0::smallint,$7::uuid,'${verifiedActor.name}','${verifiedActor.role}','{}'::jsonb,now()
  )`;
}

async function beginPublication(publicationId, companyId, connectionId, jobId, key, message, actorId) {
  const result = await db.query(beginSql(), [publicationId, companyId, connectionId, jobId, key, message, actorId]);
  return result.rows[0];
}

async function beginSinglePhotoPublication(publicationId, companyId, connectionId, jobId, key, message, actorId, attachmentId) {
  const result = await db.query(beginSinglePhotoPublicationSql(), [publicationId, companyId, connectionId, jobId, key, message, actorId, attachmentId]);
  return result.rows[0];
}

async function approvePhoto(attachmentId, analysisRunId, attachmentResultId, attachmentHash, reason) {
  return db.query(approvePhotoSql(), [
    crypto.randomUUID(), ids.company, ids.job, attachmentId, analysisRunId, attachmentResultId,
    attachmentHash, ids.actor, verifiedActor.name, verifiedActor.role, reason,
  ]);
}

function approvePhotoSql() {
  return `select * from public.approve_company_facebook_publication_photo(
    $1,$2,$3,$4,$5,$6,$7::bytea,'image/jpeg',$8,$9,$10,$11,now()
  )`;
}

async function recordMediaAnalysis(runId, payloads) {
  const result = await db.query(recordMediaAnalysisSql(), [
    runId, ids.company, ids.job, `media-${runId}`, 'completed', 'deterministic-fallback', 'fixture', 'media-analysis-v1', JSON.stringify(payloads),
  ]);
  return result.rows;
}

function recordMediaAnalysisSql() {
  return `select * from public.record_company_media_analysis_result(
    $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now()
  )`;
}

function mediaPayload(attachmentId, detectedMimeType, checksum, categories) {
  return {
    attachmentId,
    attachmentSha256: `\\x${Buffer.from(checksum).toString('hex')}`,
    detectedMimeType,
    analysisStatus: 'analyzed',
    privacyFindings: categories.map((category, index) => ({
      findingId: `finding-${index + 1}`,
      findingCategory: category,
      riskLevel: 'high',
    })),
  };
}

function beginSinglePhotoPublicationSql() {
  return `select * from public.begin_company_facebook_publication(
    $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,sha256(convert_to($6::text,'UTF8')),
    sha256(convert_to(concat_ws(E'\\n','facebook_publication_intent_v1','meta-facebook-login','Facebook',$2::uuid::text,$4::uuid::text,$3::uuid::text,$7::uuid::text,'single_photo',$6::text,$8::uuid::text),'UTF8')),
    'single_photo',$8::uuid,'image/jpeg',1::smallint,$7::uuid,'${verifiedActor.name}','${verifiedActor.role}',
    jsonb_build_object(
      'attachmentId',$8::uuid::text,
      'analysisRunId','00000000-0000-4000-8000-000000007090',
      'approvalId','00000000-0000-4000-8000-000000007190',
      'approvedAt','2026-08-05T00:00:00.000Z',
      'revoked',false,
      'originalMime','image/jpeg',
      'detectedMime','image/jpeg',
      'sanitizedMime','image/jpeg',
      'originalByteSize',24,
      'sanitizedByteSize',18,
      'originalHashPrefix','1111111111111111',
      'sanitizedHashPrefix','2222222222222222',
      'width',1,
      'height',1,
      'metadataStripped',true,
      'gpsStripped',true,
      'sanitizer','ImageScript',
      'sanitizerVersion','1.3.0',
      'providerCallCount',0
    ),
    now()
  )`;
}

async function assertRejectsSql(sql, params = []) {
  let rejected = false;
  await db.exec('savepoint meta_expected_rejection;');
  try {
    await db.query(sql, params);
  } catch {
    rejected = true;
    await db.exec('rollback to savepoint meta_expected_rejection;');
  }
  await db.exec('release savepoint meta_expected_rejection;');
  check(() => assert.equal(rejected, true));
}

async function directTablePrivileges(database, role) {
  const result = await database.query(`
    select distinct a.privilege_type
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
    join pg_roles r on r.oid=a.grantee
    where c.oid='public.company_social_publications'::regclass and r.rolname=$1
    order by a.privilege_type
  `, [role]);
  return result.rows.map((row) => row.privilege_type);
}

async function optionalTablePrivilege(database, role, privilege) {
  try {
    const result = await database.query(`select has_table_privilege($1, 'public.company_social_publications', $2) as allowed`, [role, privilege]);
    return { supported: true, allowed: result.rows[0].allowed };
  } catch {
    return { supported: false, allowed: false };
  }
}

async function captureIsolationState(database) {
  const counts = await database.query(`select
    (select count(*)::integer from public.company_social_connections) as connections,
    (select count(*)::integer from public.company_social_oauth_states) as states,
    (select count(*)::integer from public.audit_events) as audits,
    (select count(*)::integer from public.company_social_publications) as publications
  `);
  const connection = await database.query(`select provider,status,facebook_page_name,granted_scopes,token_envelope::text,connected_by from public.company_social_connections order by id`);
  const rls = await database.query(`select relrowsecurity from pg_class where oid='public.company_social_publications'::regclass`);
  const constraints = await database.query(`select conname,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.company_social_publications'::regclass order by conname`);
  const indexes = await database.query(`select indexname,indexdef from pg_indexes where schemaname='public' and tablename='company_social_publications' order by indexname`);
  const functions = await database.query(`select p.proname,pg_get_functiondef(p.oid) as definition,p.proacl::text as acl
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any($1::text[]) order by p.proname`, [rpcNames]);
  return {
    counts: counts.rows[0],
    connection: connection.rows,
    rls: rls.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    functions: functions.rows,
  };
}
