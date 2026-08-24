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
  '20260805213000_meta_publication_audit_provider_id_redaction.sql',
  '20260805223000_meta_facebook_scheduled_publication_foundation.sql',
  '20260807010000_meta_facebook_scheduled_worker_reconciliation.sql',
  '20260808235500_meta_facebook_single_active_schedule.sql',
  '20260817034500_meta_facebook_reel_delivery.sql',
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
  normalizeSqlForParity(extractExactMarkedBlock(canonicalSchema, {
    begin: '-- META_FACEBOOK_SINGLE_ACTIVE_PUBLICATION_INVARIANT_BEGIN',
    end: '-- META_FACEBOOK_SINGLE_ACTIVE_PUBLICATION_INVARIANT_END',
    label: 'Meta Facebook single active publication invariant',
  })),
  normalizeSqlForParity(extractExactMarkedBlock(migrations[16], {
    begin: '-- META_FACEBOOK_SINGLE_ACTIVE_PUBLICATION_INVARIANT_BEGIN',
    end: '-- META_FACEBOOK_SINGLE_ACTIVE_PUBLICATION_INVARIANT_END',
    label: 'Meta Facebook single active publication invariant',
  })),
));
const singleActivePublicationMigration = migrations[16];
check(() => assert.match(singleActivePublicationMigration, /create unique index company_social_publications_one_active_per_job_uidx/i));
check(() => assert.match(singleActivePublicationMigration, /on public\.company_social_publications\s*\(company_id, job_id\)/i));
check(() => assert.equal((singleActivePublicationMigration.match(/where status in \('scheduled', 'publishing', 'delivery_unknown'\)/gi) ?? []).length, 2));
check(() => assert.match(singleActivePublicationMigration, /group by company_id, job_id[\s\S]*having count\(\*\) > 1/i));
check(() => assert.match(singleActivePublicationMigration, /raise exception/i));
check(() => assert.doesNotMatch(singleActivePublicationMigration, /\b(?:delete|update)\b/i));
check(() => assert.doesNotMatch(singleActivePublicationMigration, /'published'|'failed'|'cancelled'/i));
const reelDeliveryMigration = migrations[17];
check(() => assert.equal(
  normalizeSqlForParity(extractExactMarkedBlock(canonicalSchema, {
    begin: '-- META_FACEBOOK_REEL_DELIVERY_BEGIN',
    end: '-- META_FACEBOOK_REEL_DELIVERY_END',
    label: 'Meta Facebook Reel delivery',
  })),
  normalizeSqlForParity(extractExactMarkedBlock(reelDeliveryMigration, {
    begin: '-- META_FACEBOOK_REEL_DELIVERY_BEGIN',
    end: '-- META_FACEBOOK_REEL_DELIVERY_END',
    label: 'Meta Facebook Reel delivery',
  })),
));
check(() => assert.match(reelDeliveryMigration, /publication_kind in \('text_only', 'single_photo', 'reel_video'\)/i));
check(() => assert.match(reelDeliveryMigration, /foreign key \(render_job_id, company_id, job_id\)/i));
check(() => assert.match(reelDeliveryMigration, /output_bucket='company-reel-renders'/i));
check(() => assert.match(reelDeliveryMigration, /video_sha256=p_video_sha256/i));
check(() => assert.match(reelDeliveryMigration, /storage\.buckets[\s\S]*public=false/i));
check(() => assert.match(reelDeliveryMigration, /provider_call_count between 0 and 6/i));
check(() => assert.match(reelDeliveryMigration, /provider_status_checks between 0 and 3/i));
check(() => assert.match(reelDeliveryMigration, /p_status_was_checked boolean/i));
check(() => assert.equal((reelDeliveryMigration.match(/provider_status_checks=provider_status_checks\+case when p_status_was_checked then 1 else 0 end/gi) ?? []).length, 2));
check(() => assert.equal((reelDeliveryMigration.match(/provider_status_checks\+case when p_status_was_checked then 1 else 0 end<=3/gi) ?? []).length, 2));
check(() => assert.match(reelDeliveryMigration, /exception when unique_violation[\s\S]*publication_intent_sha256=p_publication_intent_sha256[\s\S]*false/i));
check(() => assert.match(reelDeliveryMigration, /meta_reel_publication_requested/i));
check(() => assert.doesNotMatch(reelDeliveryMigration, /providerMediaId|providerPostId/i));
check(() => assert.match(reelDeliveryMigration, /revoke all on function public\.begin_company_facebook_reel_publication[\s\S]*from public,anon,authenticated/i));
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
    begin: '-- META_FACEBOOK_SCHEDULED_WORKER_RECONCILIATION_BEGIN',
    end: '-- META_FACEBOOK_SCHEDULED_WORKER_RECONCILIATION_END',
    label: 'Meta Facebook scheduled worker reconciliation',
  })),
  normalizeSqlForParity(extractExactMarkedBlock(migrations[15], {
    begin: '-- META_FACEBOOK_SCHEDULED_WORKER_RECONCILIATION_BEGIN',
    end: '-- META_FACEBOOK_SCHEDULED_WORKER_RECONCILIATION_END',
    label: 'Meta Facebook scheduled worker reconciliation',
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
    begin: '-- META_PUBLICATION_AUDIT_PROVIDER_ID_REDACTION_BEGIN',
    end: '-- META_PUBLICATION_AUDIT_PROVIDER_ID_REDACTION_END',
    label: 'Meta publication audit provider ID redaction',
  })),
  normalizeSqlForParity(extractExactMarkedBlock(migrations[13], {
    begin: '-- META_PUBLICATION_AUDIT_PROVIDER_ID_REDACTION_BEGIN',
    end: '-- META_PUBLICATION_AUDIT_PROVIDER_ID_REDACTION_END',
    label: 'Meta publication audit provider ID redaction',
  })),
));
const scheduledStartDefinition = migrations[14].match(/create or replace function public\.start_scheduled_company_facebook_publication\([\s\S]*?\n\$\$;/)?.[0] ?? '';
check(() => assert.ok(scheduledStartDefinition));
check(() => assert.doesNotMatch(scheduledStartDefinition, /for key share/i));
check(() => assert.match(scheduledStartDefinition, /from public\.company_social_publications[\s\S]*?for update;/i));
check(() => assert.match(scheduledStartDefinition, /from public\.jobs[\s\S]*?for update;/i));
check(() => assert.match(scheduledStartDefinition, /from public\.company_social_connections[\s\S]*?for update;/i));
check(() => assert.match(scheduledStartDefinition, /from public\.job_attachments[\s\S]*?for update;/i));
check(() => assert.match(scheduledStartDefinition, /from public\.company_media_analysis_attachment_results ar[\s\S]*?for update of ar;/i));
check(() => assert.match(scheduledStartDefinition, /from public\.company_social_publication_media_approvals approval[\s\S]*?for update;/i));
const scheduledStartLockOrder = [
  'from public.company_social_publications',
  'from public.jobs',
  'from public.company_social_connections',
  'from public.job_attachments',
  'from public.company_media_analysis_attachment_results ar',
  'from public.company_social_publication_media_approvals approval',
  'from public.company_media_analysis_privacy_findings finding',
].map((fragment) => scheduledStartDefinition.indexOf(fragment));
check(() => assert.equal(scheduledStartLockOrder.every((position) => position >= 0), true));
check(() => assert.equal(scheduledStartLockOrder.every((position, index) => index === 0 || position > scheduledStartLockOrder[index - 1]), true));
check(() => assert.equal(
  normalizeSqlForParity(extractExactMarkedBlock(canonicalSchema, {
    begin: '-- META_FACEBOOK_SCHEDULED_PUBLICATION_FOUNDATION_BEGIN',
    end: '-- META_FACEBOOK_SCHEDULED_PUBLICATION_FOUNDATION_END',
    label: 'Meta Facebook scheduled publication foundation',
  })),
  normalizeSqlForParity(extractExactMarkedBlock(migrations[14], {
    begin: '-- META_FACEBOOK_SCHEDULED_PUBLICATION_FOUNDATION_BEGIN',
    end: '-- META_FACEBOOK_SCHEDULED_PUBLICATION_FOUNDATION_END',
    label: 'Meta Facebook scheduled publication foundation',
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
await db.exec(`
  insert into public.audit_events (
    actor_name, actor_role, category, action, resource_type, resource, resource_id, resource_label, details, metadata
  ) values
    ('Legacy Publisher','admin','access','meta_publication_published','meta_social_publication','Facebook publication','legacy-provider-media','Facebook publication','Legacy published audit.',
      jsonb_build_object('providerMediaId','legacy-media-id','legacySafeKey','keep-media')),
    ('Legacy Publisher','admin','access','meta_publication_published','meta_social_publication','Facebook publication','legacy-provider-post','Facebook publication','Legacy published audit.',
      jsonb_build_object('providerPostId','legacy-post-id','legacySafeKey','keep-post')),
    ('Legacy Publisher','admin','access','meta_publication_published','meta_social_publication','Facebook publication','legacy-both-provider-ids','Facebook publication','Legacy published audit.',
      jsonb_build_object('providerMediaId','legacy-media-id','providerPostId',null,'legacySafeKey','keep-both')),
    ('Legacy Publisher','admin','access','meta_publication_started','meta_social_publication','Facebook publication','unrelated-provider-id-metadata','Facebook publication','Unrelated audit.',
      jsonb_build_object('providerMediaId','unrelated-media-id','providerPostId','unrelated-post-id','legacySafeKey','keep-unrelated'))
`);
await db.exec(migrations[13]);
await db.exec(migrations[13]);
const providerIdCleanup = await db.query(`
  select
    count(*) filter (where action='meta_publication_published' and metadata ?| array['providerMediaId','providerPostId'])::integer as published_provider_id_rows,
    count(*) filter (where action='meta_publication_published' and metadata->>'legacySafeKey' in ('keep-media','keep-post','keep-both'))::integer as preserved_published_metadata_rows,
    count(*) filter (where action='meta_publication_started' and metadata ?& array['providerMediaId','providerPostId'] and metadata->>'legacySafeKey'='keep-unrelated')::integer as unrelated_rows_preserved
  from public.audit_events
`);
check(() => assert.deepEqual(providerIdCleanup.rows[0], {
  published_provider_id_rows: 0,
  preserved_published_metadata_rows: 3,
  unrelated_rows_preserved: 1,
}));
await db.exec(`delete from public.audit_events where actor_name = 'Legacy Publisher'`);
await db.exec(migrations[14]);
await db.exec(migrations[15]);
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
  'schedule_company_facebook_publication',
  'cancel_scheduled_company_facebook_publication',
  'claim_due_company_facebook_publications',
  'release_scheduled_company_facebook_publication_claim',
  'fail_scheduled_company_facebook_publication_preflight',
  'start_scheduled_company_facebook_publication',
  'reconcile_stale_scheduled_company_facebook_publications',
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
  'schedule_company_facebook_publication/17',
  'cancel_scheduled_company_facebook_publication/5',
  'claim_due_company_facebook_publications/2',
  'release_scheduled_company_facebook_publication_claim/4',
  'fail_scheduled_company_facebook_publication_preflight/3',
  'start_scheduled_company_facebook_publication/3',
  'reconcile_stale_scheduled_company_facebook_publications/1',
]) {
  check(() => assert.equal(signatureSet.has(signature), true));
}
for (const name of rpcNames) {
  check(() => assert.equal(rpcShapes.rows.filter((row) => row.proname === name).length, 1));
}
const scheduledRpcParameterSafety = await db.query(`
  select proname,
    not ('p_now' = any(coalesce(proargnames, '{}'::text[]))) as no_caller_now,
    not ('p_timestamp' = any(coalesce(proargnames, '{}'::text[]))) as no_caller_timestamp,
    case when proname = 'fail_scheduled_company_facebook_publication_preflight'
      then not ('p_actor_name' = any(coalesce(proargnames, '{}'::text[])))
        and not ('p_actor_role' = any(coalesce(proargnames, '{}'::text[])))
      else true
    end as immutable_failure_actor
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname = any($1::text[])
`, [[
  'schedule_company_facebook_publication',
  'cancel_scheduled_company_facebook_publication',
  'claim_due_company_facebook_publications',
  'release_scheduled_company_facebook_publication_claim',
  'fail_scheduled_company_facebook_publication_preflight',
  'start_scheduled_company_facebook_publication',
  'reconcile_stale_scheduled_company_facebook_publications',
]]);
check(() => assert.equal(scheduledRpcParameterSafety.rows.length, 7));
for (const row of scheduledRpcParameterSafety.rows) {
  check(() => assert.equal(row.no_caller_now, true));
  check(() => assert.equal(row.no_caller_timestamp, true));
  check(() => assert.equal(row.immutable_failure_actor, true));
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

const scheduleClockBefore = (await db.query(`select clock_timestamp() as database_now`)).rows[0].database_now;
const scheduleFuture = new Date(scheduleClockBefore.getTime() + 24 * 60 * 60 * 1000);
const textScheduleId = '00000000-0000-4000-8000-000000007200';
const textScheduleKey = '00000000-0000-4000-8000-000000007201';
const textSchedule = await scheduleTextPublication(textScheduleId, textScheduleKey, 'Scheduled text-only fixture.', scheduleFuture, 'America/New_York');
const scheduleClockAfter = (await db.query(`select clock_timestamp() as database_now`)).rows[0].database_now;
check(() => assert.equal(textSchedule.should_schedule, true));
check(() => assert.equal(textSchedule.publication_status, 'scheduled'));
const duplicateTextSchedule = await scheduleTextPublication('00000000-0000-4000-8000-000000007202', '00000000-0000-4000-8000-000000007203', 'Scheduled text-only fixture.', scheduleFuture, 'America/New_York');
check(() => assert.equal(duplicateTextSchedule.should_schedule, false));
check(() => assert.equal(duplicateTextSchedule.publication_id, textScheduleId));
const textScheduleRow = await db.query(`select status,attempts,execution_attempts,scheduled_for,scheduled_timezone,scheduled_facebook_page_id,scheduled_by_name,scheduled_by_role,publication_intent_sha256,attachment_id,approved_at,created_at,updated_at from public.company_social_publications where id=$1`, [textScheduleId]);
check(() => assert.equal(textScheduleRow.rows[0].status, 'scheduled'));
check(() => assert.equal(textScheduleRow.rows[0].attempts, 0));
check(() => assert.equal(textScheduleRow.rows[0].execution_attempts, 0));
check(() => assert.equal(textScheduleRow.rows[0].scheduled_timezone, 'America/New_York'));
check(() => assert.equal(textScheduleRow.rows[0].scheduled_facebook_page_id, '10001'));
check(() => assert.equal(textScheduleRow.rows[0].scheduled_by_name, verifiedActor.name));
check(() => assert.equal(textScheduleRow.rows[0].scheduled_by_role, verifiedActor.role));
check(() => assert.equal(textScheduleRow.rows[0].attachment_id, null));
for (const timestamp of [textScheduleRow.rows[0].approved_at, textScheduleRow.rows[0].created_at, textScheduleRow.rows[0].updated_at]) {
  check(() => assert.ok(timestamp >= scheduleClockBefore && timestamp <= scheduleClockAfter));
}
const immediateIntentSource = [
  'facebook_publication_intent_v1', 'meta-facebook-login', 'Facebook', ids.company, ids.job, ids.connection, ids.actor,
  'text_only', 'Scheduled text-only fixture.', '',
].join('\n');
const immediateIntentBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(immediateIntentSource));
const immediateIntent = Buffer.from(immediateIntentBytes).toString('hex');
check(() => assert.notEqual(Buffer.from(textScheduleRow.rows[0].publication_intent_sha256).toString('hex'), immediateIntent));

const photoScheduleId = '00000000-0000-4000-8000-000000007204';
const photoSchedule = await schedulePhotoPublication(photoScheduleId, '00000000-0000-4000-8000-000000007205', 'Scheduled single-photo fixture.', scheduleFuture, 'America/New_York', ids.attachment, mediaHash, ids.analysisRun, ids.analysisResult, approval.rows[0].id);
check(() => assert.equal(photoSchedule.should_schedule, true));
const photoScheduleRow = await db.query(`select status,attempts,media_count,safe_mime_type,scheduled_attachment_sha256,scheduled_analysis_run_id,scheduled_attachment_result_id,scheduled_approval_id,scheduled_facebook_page_id from public.company_social_publications where id=$1`, [photoScheduleId]);
check(() => assert.deepEqual({
  status: photoScheduleRow.rows[0].status,
  attempts: photoScheduleRow.rows[0].attempts,
  media_count: photoScheduleRow.rows[0].media_count,
  safe_mime_type: photoScheduleRow.rows[0].safe_mime_type,
  scheduled_analysis_run_id: photoScheduleRow.rows[0].scheduled_analysis_run_id,
  scheduled_attachment_result_id: photoScheduleRow.rows[0].scheduled_attachment_result_id,
  scheduled_approval_id: photoScheduleRow.rows[0].scheduled_approval_id,
  scheduled_facebook_page_id: photoScheduleRow.rows[0].scheduled_facebook_page_id,
}, {
  status: 'scheduled',
  attempts: 0,
  media_count: 1,
  safe_mime_type: 'image/jpeg',
  scheduled_analysis_run_id: ids.analysisRun,
  scheduled_attachment_result_id: ids.analysisResult,
  scheduled_approval_id: approval.rows[0].id,
  scheduled_facebook_page_id: '10001',
}));
check(() => assert.equal(Buffer.from(photoScheduleRow.rows[0].scheduled_attachment_sha256).toString('hex'), Buffer.from(mediaHash).toString('hex')));

await assertRejectsSql(scheduleTextSql(), ['00000000-0000-4000-8000-000000007206', ids.company, ids.connection, ids.job, crypto.randomUUID(), 'Past schedule fixture.', 'text_only', null, null, null, null, null, ids.actor, verifiedActor.name, verifiedActor.role, new Date(scheduleClockAfter.getTime() - 1000), 'America/New_York']);
await assertRejectsSql(scheduleTextSql(), ['00000000-0000-4000-8000-000000007207', ids.company, ids.connection, ids.job, crypto.randomUUID(), 'Horizon schedule fixture.', 'text_only', null, null, null, null, null, ids.actor, verifiedActor.name, verifiedActor.role, new Date(scheduleClockAfter.getTime() + 367 * 24 * 60 * 60 * 1000), 'America/New_York']);
await assertRejectsSql(scheduleTextSql(), ['00000000-0000-4000-8000-000000007208', ids.company, ids.connection, ids.job, crypto.randomUUID(), 'Timezone schedule fixture.', 'text_only', null, null, null, null, null, ids.actor, verifiedActor.name, verifiedActor.role, scheduleFuture, 'Not/A_Real_Zone']);
await assertRejectsSql(scheduleTextSql(), ['00000000-0000-4000-8000-000000007209', ids.otherCompany, ids.threeScopeConnection, ids.otherJob, crypto.randomUUID(), 'Missing permission schedule fixture.', 'text_only', null, null, null, null, null, ids.actor, verifiedActor.name, verifiedActor.role, scheduleFuture, 'America/New_York']);
await assertRejectsSql(scheduleTextSql(), ['00000000-0000-4000-8000-000000007210', ids.company, ids.connection, ids.otherJob, crypto.randomUUID(), 'Wrong tenant schedule fixture.', 'text_only', null, null, null, null, null, ids.actor, verifiedActor.name, verifiedActor.role, scheduleFuture, 'America/New_York']);
await assertRejectsSql(schedulePhotoSql(), ['00000000-0000-4000-8000-000000007211', ids.company, ids.connection, ids.job, crypto.randomUUID(), 'Bad SHA schedule fixture.', 'single_photo', ids.attachment, new Uint8Array(32).fill(0x12), ids.analysisRun, ids.analysisResult, approval.rows[0].id, ids.actor, verifiedActor.name, verifiedActor.role, scheduleFuture, 'America/New_York']);

const earlySchedule = await scheduleTextPublication('00000000-0000-4000-8000-000000007228', '00000000-0000-4000-8000-000000007229', 'Future schedule gate fixture.', new Date(scheduleClockAfter.getTime() + 60 * 60 * 1000), 'America/New_York');
const earlyClaim = await db.query(`select * from public.claim_due_company_facebook_publications(60,50)`);
check(() => assert.equal(earlyClaim.rows.some((row) => row.publication_id === earlySchedule.publication_id), false));
const syntheticEarlyClaimToken = '00000000-0000-4000-8000-000000007230';
await db.query(`update public.company_social_publications
  set claim_token=$2,claimed_at=clock_timestamp(),claim_expires_at=clock_timestamp()+interval '1 minute'
  where id=$1`, [earlySchedule.publication_id, syntheticEarlyClaimToken]);
await assertRejectsSql(`select * from public.start_scheduled_company_facebook_publication($1,$2,$3)`, [earlySchedule.publication_id, ids.company, syntheticEarlyClaimToken]);
await db.query(`update public.company_social_publications set claim_token=null,claimed_at=null,claim_expires_at=null where id=$1`, [earlySchedule.publication_id]);

const dueScheduleA = await scheduleTextPublication('00000000-0000-4000-8000-000000007212', '00000000-0000-4000-8000-000000007213', 'Due schedule A.', new Date(scheduleClockAfter.getTime() + 2 * 60 * 60 * 1000), 'America/New_York');
const dueScheduleB = await scheduleTextPublication('00000000-0000-4000-8000-000000007214', '00000000-0000-4000-8000-000000007215', 'Due schedule B.', new Date(scheduleClockAfter.getTime() + 3 * 60 * 60 * 1000), 'America/New_York');
check(() => assert.equal(dueScheduleA.should_schedule, true));
check(() => assert.equal(dueScheduleB.should_schedule, true));
await db.query(`update public.company_social_publications
  set scheduled_for=clock_timestamp()-interval '2 minutes',next_attempt_at=clock_timestamp()-interval '2 minutes'
  where id=$1`, [dueScheduleA.publication_id]);
await db.query(`update public.company_social_publications
  set scheduled_for=clock_timestamp()-interval '1 minute',next_attempt_at=clock_timestamp()-interval '1 minute'
  where id=$1`, [dueScheduleB.publication_id]);
const firstClaimClockBefore = (await db.query(`select clock_timestamp() as database_now`)).rows[0].database_now;
const firstClaim = await db.query(`select * from public.claim_due_company_facebook_publications(60,1)`);
const firstClaimClockAfter = (await db.query(`select clock_timestamp() as database_now`)).rows[0].database_now;
check(() => assert.equal(firstClaim.rows.length, 1));
check(() => assert.equal(firstClaim.rows[0].publication_id, dueScheduleA.publication_id));
check(() => assert.equal(firstClaim.rows[0].execution_attempts, 1));
const firstClaimLease = await db.query(`select claimed_at,claim_expires_at from public.company_social_publications where id=$1`, [dueScheduleA.publication_id]);
check(() => assert.ok(firstClaimLease.rows[0].claimed_at >= firstClaimClockBefore && firstClaimLease.rows[0].claimed_at <= firstClaimClockAfter));
check(() => assert.equal(firstClaimLease.rows[0].claim_expires_at.getTime() - firstClaimLease.rows[0].claimed_at.getTime(), 60 * 1000));
const activeLeaseClaim = await db.query(`select * from public.claim_due_company_facebook_publications(60,1)`);
check(() => assert.equal(activeLeaseClaim.rows.length, 1));
check(() => assert.equal(activeLeaseClaim.rows[0].publication_id, dueScheduleB.publication_id));
await assertRejectsSql(`select * from public.release_scheduled_company_facebook_publication_claim($1,$2,$3,clock_timestamp()-interval '1 second')`, [dueScheduleB.publication_id, ids.company, activeLeaseClaim.rows[0].claim_token]);
await assertRejectsSql(`select * from public.release_scheduled_company_facebook_publication_claim($1,$2,$3,clock_timestamp()+interval '25 hours')`, [dueScheduleB.publication_id, ids.company, activeLeaseClaim.rows[0].claim_token]);
await db.query(`select * from public.release_scheduled_company_facebook_publication_claim($1,$2,$3,clock_timestamp()+interval '10 minutes')`, [dueScheduleB.publication_id, ids.company, activeLeaseClaim.rows[0].claim_token]);
const releaseClaim = await db.query(`select status,attempts,execution_attempts,next_attempt_at from public.release_scheduled_company_facebook_publication_claim($1,$2,$3,clock_timestamp()+interval '5 minutes')`, [dueScheduleA.publication_id, ids.company, firstClaim.rows[0].claim_token]);
check(() => assert.equal(releaseClaim.rows[0].status, 'scheduled'));
check(() => assert.equal(releaseClaim.rows[0].attempts, 0));
check(() => assert.equal(releaseClaim.rows[0].execution_attempts, 1));
const notYetClaim = await db.query(`select * from public.claim_due_company_facebook_publications(60,10)`);
check(() => assert.equal(notYetClaim.rows.length, 0));
await db.query(`update public.company_social_publications set next_attempt_at=clock_timestamp()-interval '1 second' where id=$1`, [dueScheduleA.publication_id]);
const reclaimed = await db.query(`select * from public.claim_due_company_facebook_publications(60,10)`);
check(() => assert.equal(reclaimed.rows.length, 1));
check(() => assert.equal(reclaimed.rows[0].publication_id, dueScheduleA.publication_id));
check(() => assert.equal(reclaimed.rows[0].execution_attempts, 2));

const preflightSchedule = await scheduleTextPublication('00000000-0000-4000-8000-000000007216', '00000000-0000-4000-8000-000000007217', 'Preflight failure fixture.', new Date(scheduleClockAfter.getTime() + 4 * 60 * 60 * 1000), 'America/New_York');
await db.query(`update public.company_social_publications set scheduled_for=clock_timestamp()-interval '1 minute',next_attempt_at=clock_timestamp()-interval '1 minute' where id=$1`, [preflightSchedule.publication_id]);
const preflightClaim = await db.query(`select * from public.claim_due_company_facebook_publications(60,1)`);
check(() => assert.equal(preflightClaim.rows[0].publication_id, preflightSchedule.publication_id));
const preflightFailed = await db.query(`select status,attempts,last_error_code,last_scheduler_error_code from public.fail_scheduled_company_facebook_publication_preflight($1,$2,$3)`, [preflightSchedule.publication_id, ids.company, preflightClaim.rows[0].claim_token]);
check(() => assert.deepEqual(preflightFailed.rows[0], {
  status: 'failed',
  attempts: 0,
  last_error_code: 'META_SCHEDULE_REVALIDATION_FAILED',
  last_scheduler_error_code: 'META_SCHEDULE_REVALIDATION_FAILED',
}));
const preflightFailureAudit = await db.query(`select actor_user_id,actor_name,actor_role from public.audit_events where action='meta_publication_schedule_failed' and resource_id=$1`, [preflightSchedule.publication_id]);
check(() => assert.deepEqual(preflightFailureAudit.rows[0], {
  actor_user_id: ids.actor,
  actor_name: verifiedActor.name,
  actor_role: verifiedActor.role,
}));

const startTextSchedule = await scheduleTextPublication('00000000-0000-4000-8000-000000007218', '00000000-0000-4000-8000-000000007219', 'Start text schedule fixture.', new Date(scheduleClockAfter.getTime() + 5 * 60 * 60 * 1000), 'America/New_York');
await db.query(`update public.company_social_publications set scheduled_for=clock_timestamp()-interval '1 minute',next_attempt_at=clock_timestamp()-interval '1 minute' where id=$1`, [startTextSchedule.publication_id]);
const startTextClaim = await db.query(`select * from public.claim_due_company_facebook_publications(60,1)`);
const startedText = await db.query(`select status,attempts,claim_token,next_attempt_at from public.start_scheduled_company_facebook_publication($1,$2,$3)`, [startTextSchedule.publication_id, ids.company, startTextClaim.rows[0].claim_token]);
check(() => assert.deepEqual(startedText.rows[0], { status: 'publishing', attempts: 0, claim_token: null, next_attempt_at: null }));
await assertRejectsSql(`select * from public.start_scheduled_company_facebook_publication($1,$2,$3)`, [startTextSchedule.publication_id, ids.company, startTextClaim.rows[0].claim_token]);
await db.query(`select * from public.complete_company_facebook_publication($1,$2,$3,$4,$5,'10001_77777',null,'{}'::jsonb,$6)`, [startTextSchedule.publication_id, ids.company, ids.actor, verifiedActor.name, verifiedActor.role, scheduleClockAfter]);
const completedStartedText = await db.query(`select status,attempts,provider_post_id from public.company_social_publications where id=$1`, [startTextSchedule.publication_id]);
check(() => assert.deepEqual(completedStartedText.rows[0], { status: 'published', attempts: 1, provider_post_id: '10001_77777' }));

const startPhotoSchedule = await schedulePhotoPublication('00000000-0000-4000-8000-000000007220', '00000000-0000-4000-8000-000000007221', 'Start photo schedule fixture.', new Date(scheduleClockAfter.getTime() + 6 * 60 * 60 * 1000), 'America/New_York', ids.attachment, mediaHash, ids.analysisRun, ids.analysisResult, approval.rows[0].id);
await db.query(`update public.company_social_publications set scheduled_for=clock_timestamp()-interval '1 minute',next_attempt_at=clock_timestamp()-interval '1 minute' where id=$1`, [startPhotoSchedule.publication_id]);
const startPhotoClaim = await db.query(`select * from public.claim_due_company_facebook_publications(60,1)`);
await db.query(`select * from public.start_scheduled_company_facebook_publication($1,$2,$3)`, [startPhotoSchedule.publication_id, ids.company, startPhotoClaim.rows[0].claim_token]);
await db.query(`select * from public.complete_company_facebook_publication($1,$2,$3,$4,$5,null,'10001_photo_77778',jsonb_build_object(
  'attachmentId',$7::text,'analysisRunId',$8::text,'approvalId',$9::text,'approvedAt','2026-08-05T00:00:00.000Z','revoked',false,
  'originalMime','image/jpeg','detectedMime','image/jpeg','sanitizedMime','image/jpeg','originalByteSize',24,'sanitizedByteSize',18,
  'originalHashPrefix','1111111111111111','sanitizedHashPrefix','2222222222222222','width',1,'height',1,
  'metadataStripped',true,'gpsStripped',true,'sanitizer','ImageScript','sanitizerVersion','1.3.0','providerCallCount',1
),$6)`, [startPhotoSchedule.publication_id, ids.company, ids.actor, verifiedActor.name, verifiedActor.role, scheduleClockAfter, ids.attachment, ids.analysisRun, approval.rows[0].id]);
const completedStartedPhoto = await db.query(`select status,attempts,provider_post_id,provider_media_id from public.company_social_publications where id=$1`, [startPhotoSchedule.publication_id]);
check(() => assert.deepEqual(completedStartedPhoto.rows[0], { status: 'published', attempts: 1, provider_post_id: null, provider_media_id: '10001_photo_77778' }));

await db.exec('savepoint scheduled_worker_reconciliation;');
const reconciliationSchedule = await scheduleTextPublication(
  '00000000-0000-4000-8000-000000007241',
  '00000000-0000-4000-8000-000000007242',
  'Scheduled reconciliation fixture.',
  new Date(scheduleClockAfter.getTime() + 11 * 60 * 60 * 1000),
  'America/New_York',
);
await db.query(`update public.company_social_publications set scheduled_for=clock_timestamp()-interval '1 minute',next_attempt_at=clock_timestamp()-interval '1 minute' where id=$1`, [reconciliationSchedule.publication_id]);
const reconciliationClaim = await db.query(`select * from public.claim_due_company_facebook_publications(60,1)`);
check(() => assert.equal(reconciliationClaim.rows[0].publication_id, reconciliationSchedule.publication_id));
await db.query(`select * from public.start_scheduled_company_facebook_publication($1,$2,$3)`, [reconciliationSchedule.publication_id, ids.company, reconciliationClaim.rows[0].claim_token]);

const immediateReconciliationId = '00000000-0000-4000-8000-000000007243';
await beginPublication(
  immediateReconciliationId,
  ids.company,
  ids.connection,
  ids.job,
  '00000000-0000-4000-8000-000000007244',
  'Immediate reconciliation exclusion fixture.',
  ids.actor,
);
await db.query(`update public.company_social_publications set updated_at=clock_timestamp()-interval '11 minutes' where id = any($1::uuid[])`, [[reconciliationSchedule.publication_id, immediateReconciliationId]]);
const reconciledScheduled = await db.query(`select public.reconcile_stale_scheduled_company_facebook_publications(20) as count`);
check(() => assert.equal(reconciledScheduled.rows[0].count, 1));
const reconciliationStates = await db.query(`select id,status,attempts,provider_error_category,last_error_code from public.company_social_publications where id = any($1::uuid[]) order by id`, [[reconciliationSchedule.publication_id, immediateReconciliationId]]);
const scheduledRecoveryState = reconciliationStates.rows.find((row) => row.id === reconciliationSchedule.publication_id);
const immediateRecoveryState = reconciliationStates.rows.find((row) => row.id === immediateReconciliationId);
check(() => assert.deepEqual(scheduledRecoveryState, {
  id: reconciliationSchedule.publication_id,
  status: 'delivery_unknown',
  attempts: 1,
  provider_error_category: 'DELIVERY_UNKNOWN',
  last_error_code: 'META_PUBLICATION_DELIVERY_UNKNOWN',
}));
check(() => assert.deepEqual(immediateRecoveryState, {
  id: immediateReconciliationId,
  status: 'publishing',
  attempts: 0,
  provider_error_category: null,
  last_error_code: null,
}));
const reconciliationAudit = await db.query(`select actor_user_id,actor_name,actor_role,metadata from public.audit_events where action='meta_publication_delivery_unknown' and resource_id=$1`, [reconciliationSchedule.publication_id]);
check(() => assert.equal(reconciliationAudit.rows.length, 1));
check(() => assert.deepEqual({
  actor_user_id: reconciliationAudit.rows[0].actor_user_id,
  actor_name: reconciliationAudit.rows[0].actor_name,
  actor_role: reconciliationAudit.rows[0].actor_role,
}, { actor_user_id: ids.actor, actor_name: verifiedActor.name, actor_role: verifiedActor.role }));
check(() => assert.deepEqual(reconciliationAudit.rows[0].metadata, {
  channel: 'Facebook',
  status: 'delivery_unknown',
  publicationKind: 'text_only',
  mediaCount: 0,
  attachmentId: null,
  providerCallCount: 1,
  deliveryUnknown: true,
  repeatBlocked: true,
  reconciliationRequired: true,
  schedulerRecovery: true,
  intentHashPrefix: reconciliationAudit.rows[0].metadata.intentHashPrefix,
  attempts: 1,
}));
check(() => assert.match(reconciliationAudit.rows[0].metadata.intentHashPrefix, /^[0-9a-f]{16}$/));
check(() => assert.doesNotMatch(JSON.stringify(reconciliationAudit.rows[0].metadata), /10001|providerPostId|providerMediaId|token|storage|Scheduled reconciliation fixture/i));
await assertRejectsSql(`select public.reconcile_stale_scheduled_company_facebook_publications(21)`);
await db.exec('rollback to savepoint scheduled_worker_reconciliation;');
await db.exec('release savepoint scheduled_worker_reconciliation;');

const cancelSchedule = await scheduleTextPublication('00000000-0000-4000-8000-000000007222', '00000000-0000-4000-8000-000000007223', 'Cancel schedule fixture.', scheduleFuture, 'America/New_York');
const cancelled = await db.query(`select status,attempts,cancelled_by,next_attempt_at from public.cancel_scheduled_company_facebook_publication($1,$2,$3,$4,$5)`, [cancelSchedule.publication_id, ids.company, ids.actor, verifiedActor.name, verifiedActor.role]);
check(() => assert.deepEqual(cancelled.rows[0], { status: 'cancelled', attempts: 0, cancelled_by: ids.actor, next_attempt_at: null }));
const cancelledAgain = await db.query(`select status from public.cancel_scheduled_company_facebook_publication($1,$2,$3,$4,$5)`, [cancelSchedule.publication_id, ids.company, ids.actor, verifiedActor.name, verifiedActor.role]);
check(() => assert.equal(cancelledAgain.rows[0].status, 'cancelled'));
await assertRejectsSql(`select * from public.cancel_scheduled_company_facebook_publication($1,$2,$3,$4,$5)`, [startTextSchedule.publication_id, ids.company, ids.actor, verifiedActor.name, verifiedActor.role]);

await db.exec('savepoint scheduled_revoke_wins;');
const revokedBeforeStartSchedule = await schedulePhotoPublication('00000000-0000-4000-8000-000000007235', '00000000-0000-4000-8000-000000007236', 'Revoked before scheduled start.', new Date(scheduleClockAfter.getTime() + 7 * 60 * 60 * 1000), 'America/New_York', ids.attachment, mediaHash, ids.analysisRun, ids.analysisResult, approval.rows[0].id);
await db.query(`update public.company_social_publications set scheduled_for=clock_timestamp()-interval '1 minute',next_attempt_at=clock_timestamp()-interval '1 minute' where id=$1`, [revokedBeforeStartSchedule.publication_id]);
const revokedBeforeStartClaim = await db.query(`select * from public.claim_due_company_facebook_publications(60,1)`);
await db.query(`select * from public.revoke_company_facebook_publication_photo_approval(
  $1,$2,$3,$4,$5,$6,'Scheduled start revoke-wins fixture',clock_timestamp()
)`, [ids.company, ids.job, ids.attachment, ids.actor, verifiedActor.name, verifiedActor.role]);
await assertRejectsSql(`select * from public.start_scheduled_company_facebook_publication($1,$2,$3)`, [revokedBeforeStartSchedule.publication_id, ids.company, revokedBeforeStartClaim.rows[0].claim_token]);
const revokedBeforeStartState = await db.query(`select status from public.company_social_publications where id=$1`, [revokedBeforeStartSchedule.publication_id]);
check(() => assert.equal(revokedBeforeStartState.rows[0].status, 'scheduled'));
await db.exec('rollback to savepoint scheduled_revoke_wins;');
await db.exec('release savepoint scheduled_revoke_wins;');

await db.exec('savepoint scheduled_exclusion_wins;');
const excludedBeforeStartSchedule = await schedulePhotoPublication('00000000-0000-4000-8000-000000007237', '00000000-0000-4000-8000-000000007238', 'Excluded before scheduled start.', new Date(scheduleClockAfter.getTime() + 8 * 60 * 60 * 1000), 'America/New_York', ids.attachment, mediaHash, ids.analysisRun, ids.analysisResult, approval.rows[0].id);
await db.query(`update public.company_social_publications set scheduled_for=clock_timestamp()-interval '1 minute',next_attempt_at=clock_timestamp()-interval '1 minute' where id=$1`, [excludedBeforeStartSchedule.publication_id]);
const excludedBeforeStartClaim = await db.query(`select * from public.claim_due_company_facebook_publications(60,1)`);
await db.query(`select * from public.exclude_company_facebook_publication_photo(
  $1,$2,$3,$4,$5,$6,$7,$8,'Scheduled start exclusion-wins fixture',clock_timestamp()
)`, [ids.company, ids.job, ids.attachment, ids.analysisRun, ids.analysisResult, ids.actor, verifiedActor.name, verifiedActor.role]);
await assertRejectsSql(`select * from public.start_scheduled_company_facebook_publication($1,$2,$3)`, [excludedBeforeStartSchedule.publication_id, ids.company, excludedBeforeStartClaim.rows[0].claim_token]);
const excludedBeforeStartState = await db.query(`select status from public.company_social_publications where id=$1`, [excludedBeforeStartSchedule.publication_id]);
check(() => assert.equal(excludedBeforeStartState.rows[0].status, 'scheduled'));
await db.exec('rollback to savepoint scheduled_exclusion_wins;');
await db.exec('release savepoint scheduled_exclusion_wins;');

await db.exec('savepoint scheduled_start_wins;');
const startWinsSchedule = await schedulePhotoPublication('00000000-0000-4000-8000-000000007239', '00000000-0000-4000-8000-000000007240', 'Scheduled start wins serialization.', new Date(scheduleClockAfter.getTime() + 9 * 60 * 60 * 1000), 'America/New_York', ids.attachment, mediaHash, ids.analysisRun, ids.analysisResult, approval.rows[0].id);
await db.query(`update public.company_social_publications set scheduled_for=clock_timestamp()-interval '1 minute',next_attempt_at=clock_timestamp()-interval '1 minute' where id=$1`, [startWinsSchedule.publication_id]);
const startWinsClaim = await db.query(`select * from public.claim_due_company_facebook_publications(60,1)`);
await db.query(`select * from public.start_scheduled_company_facebook_publication($1,$2,$3)`, [startWinsSchedule.publication_id, ids.company, startWinsClaim.rows[0].claim_token]);
const revokeAfterStart = await db.query(`select * from public.revoke_company_facebook_publication_photo_approval(
  $1,$2,$3,$4,$5,$6,'Scheduled start already won fixture',clock_timestamp()
)`, [ids.company, ids.job, ids.attachment, ids.actor, verifiedActor.name, verifiedActor.role]);
check(() => assert.equal(revokeAfterStart.rows[0].approval_status, 'revoked'));
const excludeAfterStart = await db.query(`select * from public.exclude_company_facebook_publication_photo(
  $1,$2,$3,$4,$5,$6,$7,$8,'Scheduled start already won exclusion fixture',clock_timestamp()
)`, [ids.company, ids.job, ids.attachment, ids.analysisRun, ids.analysisResult, ids.actor, verifiedActor.name, verifiedActor.role]);
check(() => assert.equal(excludeAfterStart.rows[0].excluded, true));
const startWinsState = await db.query(`select status from public.company_social_publications where id=$1`, [startWinsSchedule.publication_id]);
check(() => assert.equal(startWinsState.rows[0].status, 'publishing'));
await db.exec('rollback to savepoint scheduled_start_wins;');
await db.exec('release savepoint scheduled_start_wins;');

const stalePhotoSchedule = await schedulePhotoPublication('00000000-0000-4000-8000-000000007224', '00000000-0000-4000-8000-000000007225', 'Stale photo schedule fixture.', new Date(scheduleClockAfter.getTime() + 7 * 60 * 60 * 1000), 'America/New_York', ids.attachment, mediaHash, ids.analysisRun, ids.analysisResult, approval.rows[0].id);
const newerEvidenceTimestamp = new Date(scheduleClockAfter.getTime() + 8 * 60 * 60 * 1000);
await db.query(`insert into public.company_media_analysis_runs (
  id, company_id, job_id, correlation_id, status, provider, model, analysis_version, completed_at, created_at, updated_at
) values ('00000000-0000-4000-8000-000000007226',$1,$2,'newer-scheduled-evidence','completed','deterministic-fallback','fixture','media-analysis-v1',$3,$3,$3)`, [ids.company, ids.job, newerEvidenceTimestamp]);
await db.query(`insert into public.company_media_analysis_attachment_results (
  id, analysis_run_id, company_id, job_id, attachment_id, attachment_sha256, detected_mime_type,
  analysis_status, privacy_review_status, excluded, created_at
) values ('00000000-0000-4000-8000-000000007227','00000000-0000-4000-8000-000000007226',$1,$2,$3,$4::bytea,'image/jpeg','analyzed','passed',false,$5)`, [ids.company, ids.job, ids.attachment, mediaHash, newerEvidenceTimestamp]);
await db.query(`update public.company_social_publications set scheduled_for=clock_timestamp()-interval '1 minute',next_attempt_at=clock_timestamp()-interval '1 minute' where id=$1`, [stalePhotoSchedule.publication_id]);
const staleClaim = await db.query(`select * from public.claim_due_company_facebook_publications(60,1)`);
check(() => assert.equal(staleClaim.rows[0].publication_id, stalePhotoSchedule.publication_id));
await assertRejectsSql(`select * from public.start_scheduled_company_facebook_publication($1,$2,$3)`, [stalePhotoSchedule.publication_id, ids.company, staleClaim.rows[0].claim_token]);

const highAttemptSchedule = await scheduleTextPublication('00000000-0000-4000-8000-000000007231', '00000000-0000-4000-8000-000000007232', 'High execution attempt fixture.', new Date(scheduleClockAfter.getTime() + 9 * 60 * 60 * 1000), 'America/New_York');
const batchPeerSchedule = await scheduleTextPublication('00000000-0000-4000-8000-000000007233', '00000000-0000-4000-8000-000000007234', 'High execution attempt peer.', new Date(scheduleClockAfter.getTime() + 10 * 60 * 60 * 1000), 'America/New_York');
await db.query(`update public.company_social_publications
  set scheduled_for=clock_timestamp()-interval '2 minutes',next_attempt_at=clock_timestamp()-interval '2 minutes',execution_attempts=100
  where id=$1`, [highAttemptSchedule.publication_id]);
await db.query(`update public.company_social_publications
  set scheduled_for=clock_timestamp()-interval '1 minute',next_attempt_at=clock_timestamp()-interval '1 minute',execution_attempts=7
  where id=$1`, [batchPeerSchedule.publication_id]);
const highAttemptBatch = await db.query(`select * from public.claim_due_company_facebook_publications(60,50)`);
const highAttemptClaim = highAttemptBatch.rows.find((row) => row.publication_id === highAttemptSchedule.publication_id);
const batchPeerClaim = highAttemptBatch.rows.find((row) => row.publication_id === batchPeerSchedule.publication_id);
check(() => assert.equal(highAttemptClaim?.execution_attempts, 101));
check(() => assert.equal(batchPeerClaim?.execution_attempts, 8));

const scheduledAudits = await db.query(`select action,metadata from public.audit_events where action in ('meta_publication_scheduled','meta_publication_schedule_cancelled','meta_publication_schedule_failed') order by created_at,id`);
check(() => assert.ok(scheduledAudits.rows.length >= 4));
for (const audit of scheduledAudits.rows) {
  const serialized = JSON.stringify(audit.metadata);
  check(() => assert.doesNotMatch(serialized, /Scheduled text-only fixture|Start photo schedule fixture|providerPostId|providerMediaId|facebook_page_id|10001|token|ciphertext|storage|11111111111111111111111111111111/i));
  check(() => assert.equal(audit.metadata.providerCallCount, 0));
}

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

const transitions = await db.query(`select status,attempts,provider_post_id,provider_error_category,last_error_code from public.company_social_publications where scheduled_for is null order by id`);
check(() => assert.deepEqual(transitions.rows.map((row) => row.status), ['published', 'failed', 'delivery_unknown', 'published', 'failed']));
check(() => assert.ok(transitions.rows.every((row) => row.attempts === 1)));
check(() => assert.equal(transitions.rows[0].provider_post_id, '10001_20002'));
check(() => assert.equal(transitions.rows[1].provider_error_category, 'MISSING_PERMISSION'));
check(() => assert.equal(transitions.rows[2].last_error_code, 'META_PUBLICATION_DELIVERY_UNKNOWN'));
check(() => assert.equal(transitions.rows[4].provider_error_category, 'RESPONSE_MISSING_MEDIA_ID'));

const audits = await db.query(`select action,actor_user_id,actor_name,actor_role,metadata from public.audit_events where action like 'meta_publication_%' order by created_at,id`);
check(() => assert.deepEqual([...new Set(audits.rows.map((row) => row.action))].sort(), [
  'meta_publication_delivery_unknown', 'meta_publication_failed', 'meta_publication_media_approval_revoked', 'meta_publication_media_approved', 'meta_publication_media_excluded', 'meta_publication_media_false_positive_resolved', 'meta_publication_published',
  'meta_publication_schedule_cancelled', 'meta_publication_schedule_failed', 'meta_publication_scheduled', 'meta_publication_started',
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
check(() => assert.equal(Object.hasOwn(singlePhotoPublishedAudit.metadata, 'providerMediaId'), false));
check(() => assert.equal(Object.hasOwn(singlePhotoPublishedAudit.metadata, 'providerPostId'), false));
check(() => assert.equal(singlePhotoPublishedAudit.metadata.singlePhotoProviderPostIdNull, true));
check(() => assert.equal(singlePhotoPublishedAudit.metadata.analysisRunId, ids.analysisRun));
check(() => assert.equal(singlePhotoPublishedAudit.metadata.metadataStripped, true));
check(() => assert.equal(singlePhotoPublishedAudit.metadata.gpsStripped, true));
check(() => assert.equal(singlePhotoPublishedAudit.metadata.sanitizer, 'ImageScript'));
check(() => assert.equal(singlePhotoPublishedAudit.metadata.sanitizerVersion, '1.3.0'));
const textOnlyPublishedAudit = audits.rows.find((row) => row.action === 'meta_publication_published' && row.metadata.publicationKind === 'text_only');
check(() => assert.equal(textOnlyPublishedAudit.metadata.providerCallCount, 1));
check(() => assert.equal(Object.hasOwn(textOnlyPublishedAudit.metadata, 'providerPostId'), false));
check(() => assert.equal(Object.hasOwn(textOnlyPublishedAudit.metadata, 'providerMediaId'), false));
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
await canonicalDb.exec(migrations[13]);
await canonicalDb.exec(migrations[14]);
await canonicalDb.exec(migrations[15]);
await canonicalDb.exec(migrations[16]);
await canonicalDb.exec(`
  create schema storage;
  create table storage.buckets (id text primary key, public boolean not null);
  create table storage.objects (bucket_id text not null, name text not null, primary key (bucket_id, name));
  create table public.company_reel_render_jobs (
    id uuid primary key,
    company_id uuid not null,
    job_id uuid not null,
    status text not null,
    output_bucket text,
    video_object_path text,
    duration_ms integer,
    width integer,
    height integer,
    fps integer,
    video_codec text,
    pixel_format text,
    audio_streams integer,
    file_size bigint,
    video_sha256 text,
    faststart boolean,
    created_at timestamptz not null default now()
  );
`);
const reelReplayIds = {
  company: '00000000-0000-4000-8000-000000008201',
  actor: '00000000-0000-4000-8000-000000008202',
  connection: '00000000-0000-4000-8000-000000008203',
  textJob: '00000000-0000-4000-8000-000000008204',
  photoJob: '00000000-0000-4000-8000-000000008205',
  attachment: '00000000-0000-4000-8000-000000008206',
  reelJob: '00000000-0000-4000-8000-000000008207',
  render: '00000000-0000-4000-8000-000000008208',
  publication: '00000000-0000-4000-8000-000000008209',
};
await canonicalDb.query(`insert into auth.users (id,email) values ($1,'reel-replay@example.test')`, [reelReplayIds.actor]);
await canonicalDb.query(`insert into public.companies (id,name,owner_email) values ($1,'Reel replay','reel-replay@example.test')`, [reelReplayIds.company]);
await canonicalDb.query(`insert into public.jobs (id,company_id,status,job_number) values
  ($1,$4,'Completed','REPLAY-TEXT'),($2,$4,'Completed','REPLAY-PHOTO'),($3,$4,'Completed','REPLAY-REEL')`,
  [reelReplayIds.textJob, reelReplayIds.photoJob, reelReplayIds.reelJob, reelReplayIds.company]);
await canonicalDb.query(`insert into public.job_attachments
  (id,company_id,job_id,name,mime_type,size_bytes,kind,storage_bucket,storage_path)
  values ($1,$2,$3,'existing.jpg','image/jpeg',128,'photo','job-files','existing.jpg')`,
  [reelReplayIds.attachment, reelReplayIds.company, reelReplayIds.photoJob]);
await canonicalDb.query(`insert into public.company_social_connections (
  id,company_id,provider,status,facebook_page_id,facebook_page_name,granted_scopes,token_envelope,connected_by,connected_at
) values ($1,$2,'meta-facebook-login','connected','10001','Replay Page',
  array['pages_show_list','pages_read_engagement','pages_manage_posts'],$3::jsonb,$4,now())`,
  [reelReplayIds.connection, reelReplayIds.company, envelope, reelReplayIds.actor]);
await canonicalDb.query(`insert into public.company_social_publications (
  id,company_id,connection_id,job_id,provider,channel,status,idempotency_key,
  approved_message,message_sha256,publication_intent_sha256,publication_kind,
  attachment_id,safe_mime_type,media_count,provider_post_id,provider_media_id,
  attempts,approved_by,approved_at,published_at,created_at,updated_at
) values
  ('00000000-0000-4000-8000-000000008210',$1,$2,$3,'meta-facebook-login','Facebook','published',
    '00000000-0000-4000-8000-000000008211','Existing text',decode(repeat('11',32),'hex'),decode(repeat('12',32),'hex'),
    'text_only',null,null,0,'existing-text-post',null,1,$5,now(),now(),now(),now()),
  ('00000000-0000-4000-8000-000000008212',$1,$2,$4,'meta-facebook-login','Facebook','published',
    '00000000-0000-4000-8000-000000008213','Existing photo',decode(repeat('21',32),'hex'),decode(repeat('22',32),'hex'),
    'single_photo',$6,'image/jpeg',1,null,'existing-photo-media',1,$5,now(),now(),now(),now())`,
  [reelReplayIds.company, reelReplayIds.connection, reelReplayIds.textJob, reelReplayIds.photoJob, reelReplayIds.actor, reelReplayIds.attachment]);
await canonicalDb.query(`insert into public.company_reel_render_jobs (
  id,company_id,job_id,status,output_bucket,video_object_path,duration_ms,width,height,fps,
  video_codec,pixel_format,audio_streams,file_size,video_sha256,faststart
) values ($1::uuid,$2::uuid,$3::uuid,'completed','company-reel-renders',$2::uuid::text||'/'||$1::uuid::text||'/reel.mp4',
  12000,1080,1920,30,'h264','yuv420p',0,631574,repeat('a',64),true)`,
  [reelReplayIds.render, reelReplayIds.company, reelReplayIds.reelJob]);
await canonicalDb.exec(`insert into storage.buckets values ('company-reel-renders',false)`);
await canonicalDb.query(`insert into storage.objects values ('company-reel-renders',$1::text||'/'||$2::text||'/reel.mp4')`,
  [reelReplayIds.company, reelReplayIds.render]);
await canonicalDb.exec(migrations[17]);
const canonicalPublication = await canonicalDb.query(`select to_regclass('public.company_social_publications') as relation`);
check(() => assert.equal(canonicalPublication.rows[0].relation, 'company_social_publications'));
const preservedPublications = await canonicalDb.query(`select publication_kind,status from public.company_social_publications order by publication_kind`);
check(() => assert.deepEqual(preservedPublications.rows, [
  { publication_kind: 'single_photo', status: 'published' },
  { publication_kind: 'text_only', status: 'published' },
]));
const reelBeginning = await canonicalDb.query(`select * from public.begin_company_facebook_reel_publication(
  $1,$2,$3,$4,$5,'00000000-0000-4000-8000-000000008214','Reviewed Reel caption',
  decode(repeat('31',32),'hex'),decode(repeat('32',32),'hex'),repeat('a',64),631574,
  $6,'Reel reviewer','owner',now()
)`, [reelReplayIds.publication, reelReplayIds.company, reelReplayIds.connection, reelReplayIds.reelJob, reelReplayIds.render, reelReplayIds.actor]);
check(() => assert.equal(reelBeginning.rows[0].should_publish, true));
for (const [expectedStage, nextStage] of [
  ['upload_initializing', 'uploading'],
  ['uploading', 'finalizing'],
  ['finalizing', 'provider_processing'],
]) {
  await canonicalDb.query(`select * from public.advance_company_facebook_reel_publication(
    $1,$2,$3,'Reel reviewer','owner',$4,$5,'mock-reel-media',now()
  )`, [reelReplayIds.publication, reelReplayIds.company, reelReplayIds.actor, expectedStage, nextStage]);
}
for (let attempt = 0; attempt < 3; attempt += 1) {
  await canonicalDb.query(`select * from public.mark_company_facebook_reel_unknown(
    $1,$2,$3,'Reel reviewer','owner','mock-reel-media',true,true,now()
  )`, [reelReplayIds.publication, reelReplayIds.company, reelReplayIds.actor]);
}
const boundedStatus = await canonicalDb.query(`select status,provider_call_count,provider_status_checks
  from public.company_social_publications where id=$1`, [reelReplayIds.publication]);
check(() => assert.deepEqual(boundedStatus.rows[0], {
  status: 'delivery_unknown', provider_call_count: 6, provider_status_checks: 3,
}));
let fourthStatusRejected = false;
try {
  await canonicalDb.query(`select * from public.mark_company_facebook_reel_unknown(
    $1,$2,$3,'Reel reviewer','owner','mock-reel-media',true,true,now()
  )`, [reelReplayIds.publication, reelReplayIds.company, reelReplayIds.actor]);
} catch {
  fourthStatusRejected = true;
}
check(() => assert.equal(fourthStatusRejected, true));
const leakedProviderAuditKeys = await canonicalDb.query(`select count(*)::integer as count from public.audit_events
  where action like 'meta_%publication_%' and metadata ?| array['providerMediaId','providerPostId']`);
check(() => assert.equal(leakedProviderAuditKeys.rows[0].count, 0));
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

const invariantDb = new PGlite();
await invariantDb.exec(prerequisiteSchema);
for (const migration of migrations.slice(0, 4)) await invariantDb.exec(migration);
await invariantDb.exec('grant all privileges on table public.company_social_publications to service_role;');
for (const migration of migrations.slice(4, 16)) await invariantDb.exec(migration);

const sameCompanyOtherJob = '00000000-0000-4000-8000-000000007300';
await invariantDb.query(`insert into auth.users (id,email) values ($1,'invariant@example.test')`, [ids.actor]);
await invariantDb.query(`insert into public.companies (id,name,owner_email) values
  ($1,'Invariant Primary','primary-invariant@example.test'),
  ($2,'Invariant Other','other-invariant@example.test')`, [ids.company, ids.otherCompany]);
await invariantDb.query(`insert into public.jobs (id,company_id,status,job_number) values
  ($1,$2,'Completed','INV-1'),
  ($3,$2,'Warranty','INV-2'),
  ($4,$5,'Completed','INV-3')`, [ids.job, ids.company, sameCompanyOtherJob, ids.otherJob, ids.otherCompany]);
await invariantDb.query(`insert into public.company_social_connections (
  id,company_id,provider,status,facebook_page_id,facebook_page_name,granted_scopes,token_envelope,connected_by,connected_at
) values
  ($1,$2,'meta-facebook-login','connected','10001','Invariant Page',array['pages_show_list','pages_read_engagement','pages_manage_posts'],$3::jsonb,$4,now()),
  ($5,$6,'meta-facebook-login','connected','10002','Other Invariant Page',array['pages_show_list','pages_read_engagement','pages_manage_posts'],$3::jsonb,$4,now())`,
  [ids.connection, ids.company, envelope, ids.actor, ids.threeScopeConnection, ids.otherCompany]);

const invariantScheduleTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
const scheduleInvariant = async ({ publicationId, companyId = ids.company, connectionId = ids.connection, jobId = ids.job, key, message }) => {
  const result = await invariantDb.query(scheduleTextSql(), [
    publicationId, companyId, connectionId, jobId, key, message, 'text_only',
    null, null, null, null, null, ids.actor, verifiedActor.name, verifiedActor.role,
    invariantScheduleTime, 'America/New_York',
  ]);
  return result.rows[0];
};

const invariantFirstId = '00000000-0000-4000-8000-000000007301';
const invariantSecondId = '00000000-0000-4000-8000-000000007302';
const invariantFirst = await scheduleInvariant({ publicationId: invariantFirstId, key: '00000000-0000-4000-8000-000000007311', message: 'Invariant first schedule.' });
await scheduleInvariant({ publicationId: invariantSecondId, key: '00000000-0000-4000-8000-000000007312', message: 'Invariant second schedule.' });
await invariantDb.query(`update public.company_social_publications
  set scheduled_for=clock_timestamp()-interval '1 minute',next_attempt_at=clock_timestamp()-interval '1 minute'
  where id=$1`, [invariantSecondId]);
const invariantPreflightClaim = await invariantDb.query(`select * from public.claim_due_company_facebook_publications(60,10)`);
const invariantPreflightClaimRow = invariantPreflightClaim.rows.find((row) => row.publication_id === invariantSecondId);
check(() => assert.ok(invariantPreflightClaimRow));
const invariantPreflightStarted = await invariantDb.query(`select * from public.start_scheduled_company_facebook_publication($1,$2,$3)`, [invariantSecondId, ids.company, invariantPreflightClaimRow.claim_token]);
check(() => assert.equal(invariantPreflightStarted.rows[0].status, 'publishing'));
let duplicatePreflightRejected = false;
try {
  await invariantDb.exec(migrations[16]);
} catch {
  duplicatePreflightRejected = true;
}
check(() => assert.equal(duplicatePreflightRejected, true));
const preservedDuplicates = await invariantDb.query(`select count(*)::integer as count from public.company_social_publications
  where company_id=$1 and job_id=$2 and status in ('scheduled','publishing','delivery_unknown')`, [ids.company, ids.job]);
check(() => assert.equal(preservedDuplicates.rows[0].count, 2));
const absentFailedIndex = await invariantDb.query(`select to_regclass('public.company_social_publications_one_active_per_job_uidx') as relation`);
check(() => assert.equal(absentFailedIndex.rows[0].relation, null));

await invariantDb.exec('begin');
await invariantDb.query(`select * from public.mark_company_facebook_publication_unknown($1,$2,$3,$4,$5,'{}'::jsonb,now())`, [invariantSecondId, ids.company, ids.actor, verifiedActor.name, verifiedActor.role]);
let deliveryUnknownPreflightRejected = false;
try {
  await invariantDb.exec(migrations[16]);
} catch {
  deliveryUnknownPreflightRejected = true;
}
await invariantDb.exec('rollback');
check(() => assert.equal(deliveryUnknownPreflightRejected, true));

await invariantDb.query(`select * from public.complete_company_facebook_publication($1,$2,$3,$4,$5,'invariant-preflight-post',null,'{}'::jsonb,now())`, [invariantSecondId, ids.company, ids.actor, verifiedActor.name, verifiedActor.role]);
await invariantDb.exec(migrations[16]);
const invariantIndex = await invariantDb.query(`
  select indexdef
  from pg_indexes
  where schemaname='public'
    and tablename='company_social_publications'
    and indexname='company_social_publications_one_active_per_job_uidx'
`);
check(() => assert.equal(invariantIndex.rows.length, 1));
check(() => assert.match(invariantIndex.rows[0].indexdef, /^CREATE UNIQUE INDEX/i));
check(() => assert.match(invariantIndex.rows[0].indexdef, /\(company_id, job_id\)/i));
for (const status of ['scheduled', 'publishing', 'delivery_unknown']) {
  check(() => assert.match(invariantIndex.rows[0].indexdef, new RegExp(`'${status}'`, 'i')));
}
check(() => assert.doesNotMatch(invariantIndex.rows[0].indexdef, /'published'|'failed'|'cancelled'/i));

const sameIntentReplay = await scheduleInvariant({ publicationId: '00000000-0000-4000-8000-000000007303', key: '00000000-0000-4000-8000-000000007313', message: 'Invariant first schedule.' });
check(() => assert.equal(sameIntentReplay.publication_id, invariantFirst.publication_id));
check(() => assert.equal(sameIntentReplay.should_schedule, false));
const assertInvariantConflict = async (operation) => {
  let collisionCode = '';
  let collisionMessage = '';
  try {
    await operation();
  } catch (error) {
    collisionCode = String(error?.code ?? '');
    collisionMessage = String(error?.message ?? '');
  }
  check(() => assert.equal(collisionCode, '23505'));
  check(() => assert.match(collisionMessage, /company_social_publications_one_active_per_job_uidx/));
};
const beginInvariant = async ({ publicationId, key, message, companyId = ids.company, connectionId = ids.connection, jobId = ids.job }) => {
  const result = await invariantDb.query(beginSql(), [publicationId, companyId, connectionId, jobId, key, message, ids.actor]);
  return result.rows[0];
};

await assertInvariantConflict(() => scheduleInvariant({ publicationId: '00000000-0000-4000-8000-000000007304', key: '00000000-0000-4000-8000-000000007314', message: 'Different invariant schedule.' }));
await assertInvariantConflict(() => beginInvariant({ publicationId: '00000000-0000-4000-8000-000000007308', key: '00000000-0000-4000-8000-000000007318', message: 'Immediate blocked by schedule.' }));

const differentJobSchedule = await scheduleInvariant({ publicationId: '00000000-0000-4000-8000-000000007305', jobId: sameCompanyOtherJob, key: '00000000-0000-4000-8000-000000007315', message: 'Different job schedule.' });
check(() => assert.equal(differentJobSchedule.should_schedule, true));
const differentCompanySchedule = await scheduleInvariant({ publicationId: '00000000-0000-4000-8000-000000007306', companyId: ids.otherCompany, connectionId: ids.threeScopeConnection, jobId: ids.otherJob, key: '00000000-0000-4000-8000-000000007316', message: 'Different company schedule.' });
check(() => assert.equal(differentCompanySchedule.should_schedule, true));

await invariantDb.query(`select * from public.cancel_scheduled_company_facebook_publication($1,$2,$3,$4,$5)`, [invariantFirstId, ids.company, ids.actor, verifiedActor.name, verifiedActor.role]);
const immediatePublicationId = '00000000-0000-4000-8000-000000007307';
const immediateKey = '00000000-0000-4000-8000-000000007317';
const immediatePublishing = await beginInvariant({ publicationId: immediatePublicationId, key: immediateKey, message: 'Immediate after cancellation.' });
check(() => assert.equal(immediatePublishing.publication_status, 'publishing'));
check(() => assert.equal(immediatePublishing.should_publish, true));
const immediateReplay = await beginInvariant({ publicationId: '00000000-0000-4000-8000-000000007309', key: immediateKey, message: 'Immediate after cancellation.' });
check(() => assert.equal(immediateReplay.publication_id, immediatePublicationId));
check(() => assert.equal(immediateReplay.should_publish, false));

await assertInvariantConflict(() => scheduleInvariant({ publicationId: '00000000-0000-4000-8000-000000007320', key: '00000000-0000-4000-8000-000000007321', message: 'Schedule blocked by publishing.' }));
await assertInvariantConflict(() => beginInvariant({ publicationId: '00000000-0000-4000-8000-000000007322', key: '00000000-0000-4000-8000-000000007323', message: 'Second immediate blocked by publishing.' }));

await invariantDb.exec('begin');
await invariantDb.query(`select * from public.mark_company_facebook_publication_unknown($1,$2,$3,$4,$5,'{}'::jsonb,now())`, [immediatePublicationId, ids.company, ids.actor, verifiedActor.name, verifiedActor.role]);
await assertInvariantConflict(() => scheduleInvariant({ publicationId: '00000000-0000-4000-8000-000000007324', key: '00000000-0000-4000-8000-000000007325', message: 'Schedule blocked by unknown delivery.' }));
await invariantDb.exec('rollback');

await invariantDb.exec('begin');
await invariantDb.query(`select * from public.mark_company_facebook_publication_unknown($1,$2,$3,$4,$5,'{}'::jsonb,now())`, [immediatePublicationId, ids.company, ids.actor, verifiedActor.name, verifiedActor.role]);
await assertInvariantConflict(() => beginInvariant({ publicationId: '00000000-0000-4000-8000-000000007326', key: '00000000-0000-4000-8000-000000007327', message: 'Immediate blocked by unknown delivery.' }));
await invariantDb.exec('rollback');

await invariantDb.exec('begin');
await invariantDb.query(`select * from public.complete_company_facebook_publication($1,$2,$3,$4,$5,'invariant-published-post',null,'{}'::jsonb,now())`, [immediatePublicationId, ids.company, ids.actor, verifiedActor.name, verifiedActor.role]);
const afterPublished = await scheduleInvariant({ publicationId: '00000000-0000-4000-8000-000000007328', key: '00000000-0000-4000-8000-000000007329', message: 'Slot released by published.' });
check(() => assert.equal(afterPublished.should_schedule, true));
await invariantDb.exec('rollback');

await invariantDb.exec('begin');
await invariantDb.query(`select * from public.fail_company_facebook_publication($1,$2,$3,$4,$5,403,200,10,'MISSING_PERMISSION',false,'META_PUBLICATION_PROVIDER_REJECTED','{}'::jsonb,now())`, [immediatePublicationId, ids.company, ids.actor, verifiedActor.name, verifiedActor.role]);
const afterFailed = await scheduleInvariant({ publicationId: '00000000-0000-4000-8000-000000007330', key: '00000000-0000-4000-8000-000000007331', message: 'Slot released by failed.' });
check(() => assert.equal(afterFailed.should_schedule, true));
await invariantDb.exec('rollback');

await invariantDb.query(`select * from public.complete_company_facebook_publication($1,$2,$3,$4,$5,'invariant-final-post',null,'{}'::jsonb,now())`, [immediatePublicationId, ids.company, ids.actor, verifiedActor.name, verifiedActor.role]);

const workerPublicationId = '00000000-0000-4000-8000-000000007332';
await scheduleInvariant({ publicationId: workerPublicationId, key: '00000000-0000-4000-8000-000000007333', message: 'Worker same-row completion.' });
await invariantDb.query(`update public.company_social_publications set scheduled_for=clock_timestamp()-interval '1 minute',next_attempt_at=clock_timestamp()-interval '1 minute' where id=$1`, [workerPublicationId]);
const workerClaim = await invariantDb.query(`select * from public.claim_due_company_facebook_publications(60,10)`);
const workerClaimRow = workerClaim.rows.find((row) => row.publication_id === workerPublicationId);
check(() => assert.ok(workerClaimRow));
const claimedWorkerState = await invariantDb.query(`select id,status from public.company_social_publications where id=$1`, [workerPublicationId]);
check(() => assert.deepEqual(claimedWorkerState.rows[0], { id: workerPublicationId, status: 'scheduled' }));
const workerStarted = await invariantDb.query(`select * from public.start_scheduled_company_facebook_publication($1,$2,$3)`, [workerPublicationId, ids.company, workerClaimRow.claim_token]);
check(() => assert.equal(workerStarted.rows[0].status, 'publishing'));
const activeWorkerRows = await invariantDb.query(`select id,status from public.company_social_publications where company_id=$1 and job_id=$2 and status in ('scheduled','publishing','delivery_unknown')`, [ids.company, ids.job]);
check(() => assert.deepEqual(activeWorkerRows.rows, [{ id: workerPublicationId, status: 'publishing' }]));
await invariantDb.query(`select * from public.complete_company_facebook_publication($1,$2,$3,$4,$5,'worker-complete-post',null,'{}'::jsonb,now())`, [workerPublicationId, ids.company, ids.actor, verifiedActor.name, verifiedActor.role]);

const unknownWorkerPublicationId = '00000000-0000-4000-8000-000000007334';
await scheduleInvariant({ publicationId: unknownWorkerPublicationId, key: '00000000-0000-4000-8000-000000007335', message: 'Worker same-row unknown delivery.' });
await invariantDb.query(`update public.company_social_publications set scheduled_for=clock_timestamp()-interval '1 minute',next_attempt_at=clock_timestamp()-interval '1 minute' where id=$1`, [unknownWorkerPublicationId]);
const unknownWorkerClaim = await invariantDb.query(`select * from public.claim_due_company_facebook_publications(60,10)`);
const unknownWorkerClaimRow = unknownWorkerClaim.rows.find((row) => row.publication_id === unknownWorkerPublicationId);
check(() => assert.ok(unknownWorkerClaimRow));
await invariantDb.query(`select * from public.start_scheduled_company_facebook_publication($1,$2,$3)`, [unknownWorkerPublicationId, ids.company, unknownWorkerClaimRow.claim_token]);
await invariantDb.query(`select * from public.mark_company_facebook_publication_unknown($1,$2,$3,$4,$5,'{}'::jsonb,now())`, [unknownWorkerPublicationId, ids.company, ids.actor, verifiedActor.name, verifiedActor.role]);
const unknownWorkerRows = await invariantDb.query(`select id,status from public.company_social_publications where company_id=$1 and job_id=$2 and status in ('scheduled','publishing','delivery_unknown')`, [ids.company, ids.job]);
check(() => assert.deepEqual(unknownWorkerRows.rows, [{ id: unknownWorkerPublicationId, status: 'delivery_unknown' }]));
await assertInvariantConflict(() => scheduleInvariant({ publicationId: '00000000-0000-4000-8000-000000007336', key: '00000000-0000-4000-8000-000000007337', message: 'Unknown worker blocks schedule.' }));
await assertInvariantConflict(() => beginInvariant({ publicationId: '00000000-0000-4000-8000-000000007338', key: '00000000-0000-4000-8000-000000007339', message: 'Unknown worker blocks immediate.' }));
await invariantDb.close();

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

async function scheduleTextPublication(publicationId, key, message, scheduledFor, timezone) {
  const result = await db.query(scheduleTextSql(), [
    publicationId, ids.company, ids.connection, ids.job, key, message, 'text_only',
    null, null, null, null, null, ids.actor, verifiedActor.name, verifiedActor.role,
    scheduledFor, timezone,
  ]);
  return result.rows[0];
}

async function schedulePhotoPublication(publicationId, key, message, scheduledFor, timezone, attachmentId, attachmentHash, analysisRunId, attachmentResultId, approvalId) {
  const result = await db.query(schedulePhotoSql(), [
    publicationId, ids.company, ids.connection, ids.job, key, message, 'single_photo',
    attachmentId, attachmentHash, analysisRunId, attachmentResultId, approvalId,
    ids.actor, verifiedActor.name, verifiedActor.role, scheduledFor, timezone,
  ]);
  return result.rows[0];
}

function scheduleTextSql() {
  return `select * from public.schedule_company_facebook_publication(
    $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,
    $8::uuid,$9::bytea,$10::uuid,$11::uuid,$12::uuid,$13::uuid,$14::text,$15::text,$16::timestamptz,$17::text
  )`;
}

function schedulePhotoSql() {
  return scheduleTextSql();
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
