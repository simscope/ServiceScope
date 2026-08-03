import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import {
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
};

const db = new PGlite();
await db.exec(prerequisiteSchema);
for (const migration of migrations) await db.exec(migration);
await db.exec('begin;');

await db.query(`insert into auth.users (id, email) values ($1, 'publisher@example.test'), ($2, 'other@example.test')`, [ids.actor, ids.otherActor]);
await db.query(`insert into public.companies (id, name, owner_email) values ($1, 'Primary', 'primary@example.test'), ($2, 'Other', 'other@example.test')`, [ids.company, ids.otherCompany]);
await db.query(`insert into public.jobs (id, company_id, status, job_number) values ($1, $2, 'Completed', 'TEST-1'), ($3, $4, 'Warranty', 'TEST-2')`, [ids.job, ids.company, ids.otherJob, ids.otherCompany]);

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
    has_table_privilege('anon', 'public.company_social_publications', 'SELECT') as anon_select,
    has_table_privilege('authenticated', 'public.company_social_publications', 'SELECT') as authenticated_select
`);
check(() => assert.equal(grants.rows[0].service_select, true));
check(() => assert.equal(grants.rows[0].service_insert, true));
check(() => assert.equal(grants.rows[0].service_update, true));
check(() => assert.equal(grants.rows[0].service_delete, false));
check(() => assert.equal(grants.rows[0].anon_select, false));
check(() => assert.equal(grants.rows[0].authenticated_select, false));

const rpcNames = ['begin_company_facebook_publication', 'complete_company_facebook_publication', 'fail_company_facebook_publication', 'mark_company_facebook_publication_unknown'];
const rpcGrants = await db.query(`
  select p.proname,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service_allowed,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_allowed,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_allowed
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname = any($1::text[])
`, [rpcNames]);
check(() => assert.equal(rpcGrants.rows.length, 4));
for (const row of rpcGrants.rows) {
  check(() => assert.equal(row.service_allowed, true));
  check(() => assert.equal(row.anon_allowed, false));
  check(() => assert.equal(row.authenticated_allowed, false));
}

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

await db.query(`select * from public.complete_company_facebook_publication($1,$2,$3,'10001_20002',now())`, [publicationA, ids.company, ids.actor]);
const publishedDuplicate = await beginPublication('00000000-0000-4000-8000-000000007014', ids.company, ids.connection, ids.job, keyA, messageA, ids.actor);
check(() => assert.equal(publishedDuplicate.should_publish, false));
check(() => assert.equal(publishedDuplicate.publication_status, 'published'));

const publicationB = '00000000-0000-4000-8000-000000007020';
const keyB = '00000000-0000-4000-8000-000000007021';
await beginPublication(publicationB, ids.company, ids.connection, ids.job, keyB, 'Measured airflow is within specification.', ids.actor);
await db.query(`select * from public.fail_company_facebook_publication($1,$2,$3,403,200,10,'MISSING_PERMISSION',false,'META_PUBLICATION_PROVIDER_REJECTED',now())`, [publicationB, ids.company, ids.actor]);
const failedDuplicate = await beginPublication('00000000-0000-4000-8000-000000007022', ids.company, ids.connection, ids.job, keyB, 'Measured airflow is within specification.', ids.actor);
check(() => assert.equal(failedDuplicate.should_publish, false));
check(() => assert.equal(failedDuplicate.publication_status, 'failed'));
await assertRejectsSql(`update public.company_social_publications set provider_http_status=99 where id=$1`, [publicationB]);
await assertRejectsSql(`update public.company_social_publications set provider_error_category='UNBOUNDED_VALUE' where id=$1`, [publicationB]);

const publicationC = '00000000-0000-4000-8000-000000007030';
const keyC = '00000000-0000-4000-8000-000000007031';
await beginPublication(publicationC, ids.company, ids.connection, ids.job, keyC, 'System start-up completed successfully.', ids.actor);
await db.query(`select * from public.mark_company_facebook_publication_unknown($1,$2,$3,now())`, [publicationC, ids.company, ids.actor]);
const unknownDuplicate = await beginPublication('00000000-0000-4000-8000-000000007032', ids.company, ids.connection, ids.job, keyC, 'System start-up completed successfully.', ids.actor);
check(() => assert.equal(unknownDuplicate.should_publish, false));
check(() => assert.equal(unknownDuplicate.publication_status, 'delivery_unknown'));

const transitions = await db.query(`select status,attempts,provider_post_id,provider_error_category,last_error_code from public.company_social_publications order by id`);
check(() => assert.deepEqual(transitions.rows.map((row) => row.status), ['published', 'failed', 'delivery_unknown']));
check(() => assert.ok(transitions.rows.every((row) => row.attempts === 1)));
check(() => assert.equal(transitions.rows[0].provider_post_id, '10001_20002'));
check(() => assert.equal(transitions.rows[1].provider_error_category, 'MISSING_PERMISSION'));
check(() => assert.equal(transitions.rows[2].last_error_code, 'META_PUBLICATION_DELIVERY_UNKNOWN'));

const audits = await db.query(`select action,metadata from public.audit_events where action like 'meta_publication_%' order by created_at,id`);
check(() => assert.deepEqual([...new Set(audits.rows.map((row) => row.action))].sort(), [
  'meta_publication_delivery_unknown', 'meta_publication_failed', 'meta_publication_published', 'meta_publication_started',
]));
for (const audit of audits.rows) {
  check(() => assert.deepEqual(Object.keys(audit.metadata).sort(), ['attempts', 'channel', 'messageCharacterCount', 'status'].sort()));
}

await assertRejectsSql(beginSql(), ['00000000-0000-4000-8000-000000007040', ids.company, ids.connection, ids.otherJob, '00000000-0000-4000-8000-000000007041', 'Tenant mismatch.', ids.actor]);
await assertRejectsSql(beginSql(), ['00000000-0000-4000-8000-000000007042', ids.otherCompany, ids.threeScopeConnection, ids.otherJob, '00000000-0000-4000-8000-000000007043', 'Missing capability.', ids.actor]);
const actorIsolationPublication = '00000000-0000-4000-8000-000000007044';
await beginPublication(actorIsolationPublication, ids.company, ids.connection, ids.job, '00000000-0000-4000-8000-000000007045', 'Actor isolation verified.', ids.actor);
await assertRejectsSql(`select * from public.complete_company_facebook_publication($1,$2,$3,'10001_99999',now())`, [actorIsolationPublication, ids.company, ids.otherActor]);

for (const invalidMessage of ['', ' leading', 'trailing ', '[private]', `bad\u0000control`, 'x'.repeat(5001)]) {
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
const canonicalPublication = await canonicalDb.query(`select to_regclass('public.company_social_publications') as relation`);
check(() => assert.equal(canonicalPublication.rows[0].relation, 'company_social_publications'));
await canonicalDb.close();

console.log(`Meta publishing SQL checks passed: ${checks}; rollback artifacts: 0`);

function beginSql() {
  return `select * from public.begin_company_facebook_publication(
    $1,$2,$3,$4,$5,$6,sha256(convert_to($6,'UTF8')),$7,'Publisher','admin',now()
  )`;
}

async function beginPublication(publicationId, companyId, connectionId, jobId, key, message, actorId) {
  const result = await db.query(beginSql(), [publicationId, companyId, connectionId, jobId, key, message, actorId]);
  return result.rows[0];
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
