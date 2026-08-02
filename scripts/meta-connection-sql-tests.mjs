import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const foundationMigration = await readFile(new URL('../supabase/migrations/20260731220000_meta_social_connection_foundation.sql', import.meta.url), 'utf8');
const lifecycleAuditMigration = await readFile(new URL('../supabase/migrations/20260802020000_meta_social_lifecycle_audit_transactions.sql', import.meta.url), 'utf8');
const suite = await readFile(new URL('../supabase/sql/meta-social-connection-security-checks.sql', import.meta.url), 'utf8');
const db = new PGlite();

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text unique);
  create table public.companies (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    owner_name text not null default '',
    owner_email text not null
  );
  create table public.company_users (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
    auth_user_id uuid references auth.users(id) on delete set null,
    name text not null,
    email text not null,
    role text not null default 'technician',
    status text not null default 'invited',
    portal_access_rules jsonb not null default '{}'::jsonb,
    last_active_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (company_id, email)
  );
  create table public.audit_events (
    id uuid primary key default gen_random_uuid(),
    company_id uuid references public.companies(id) on delete set null,
    category text not null,
    action text not null,
    actor_user_id uuid references auth.users(id) on delete set null,
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
  create or replace function public.can_manage_company(target_company_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
  as $$
    select exists (
      select 1 from public.company_users
      where company_id = target_company_id
        and auth_user_id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        and status = 'active'
        and role in ('admin', 'manager')
    );
  $$;
`);

await db.exec(foundationMigration);
await db.exec(lifecycleAuditMigration);
await db.exec('create temp table meta_sql_assertions (label text primary key);');

let assertionCount = 0;
try {
  await db.exec(suite);
  const assertions = await db.query('select count(*)::integer as count from meta_sql_assertions');
  assertionCount = assertions.rows[0].count;
  assert.ok(assertionCount >= 30, `Expected at least 30 SQL assertions, received ${assertionCount}`);
  await db.exec('rollback;');
} catch (error) {
  try { await db.exec('rollback;'); } catch {}
  throw error;
}

const artifacts = await db.query(`
  select
    (select count(*)::integer from public.company_social_connections) as connections,
    (select count(*)::integer from public.company_social_oauth_states) as oauth_states,
    (select count(*)::integer from public.audit_events) as audits,
    (select count(*)::integer from public.companies) as companies,
    (select count(*)::integer from auth.users) as auth_users
`);
const counts = artifacts.rows[0];
assert.deepEqual(counts, { connections: 0, oauth_states: 0, audits: 0, companies: 0, auth_users: 0 });

await db.close();
console.log(`Meta SQL security checks passed: ${assertionCount}; rollback artifacts: 0`);
