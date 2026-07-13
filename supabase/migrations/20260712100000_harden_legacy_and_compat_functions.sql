-- Preserve the historical hvac-app import for audit/migration purposes, but do
-- not expose its tables or RPC surface to browser roles. ServiceScope uses the
-- tenant-scoped public schema and compatibility views instead.

do $$
declare
  policy_record record;
  table_record record;
begin
  for policy_record in
    select policyname, tablename
    from pg_policies
    where schemaname = 'legacy_import'
  loop
    execute format('drop policy if exists %I on legacy_import.%I', policy_record.policyname, policy_record.tablename);
  end loop;

  for table_record in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'legacy_import'
      and c.relkind in ('r', 'p')
  loop
    execute format('alter table legacy_import.%I enable row level security', table_record.relname);
  end loop;
end;
$$;

revoke usage on schema legacy_import from anon, authenticated;
revoke all privileges on all tables in schema legacy_import from anon, authenticated;

-- Keep the legacy cleanup/chat helpers deterministic until the import can be
-- removed completely.
do $$
declare
  function_record record;
begin
  for function_record in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'legacy_import'
      and p.proname in (
        'cleanup_3days',
        'cleanup_cron_logs',
        'cleanup_tech_locations',
        'enqueue_push',
        'is_chat_member',
        'is_chat_member_of'
      )
  loop
    execute format('alter function %s set search_path = legacy_import, public, pg_temp', function_record.oid::regprocedure);
  end loop;
end;
$$;

-- These functions are trigger implementations for public compatibility views.
-- Browser roles do not need direct RPC execution privileges.
do $$
declare
  function_record record;
begin
  for function_record in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.proname in (
        'clients_compat_insert',
        'clients_compat_update',
        'comments_compat_insert',
        'current_company_id',
        'invoices_compat_delete',
        'materials_compat_delete',
        'materials_compat_insert',
        'materials_compat_update'
      )
  loop
    execute format('revoke execute on function %s from public', function_record.oid::regprocedure);
  end loop;
end;
$$;
