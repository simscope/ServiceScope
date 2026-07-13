-- Supabase grants EXECUTE to browser roles when functions are created. Revoke
-- both direct and inherited privileges from compatibility trigger functions.

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
    execute format('revoke execute on function %s from public, anon, authenticated', function_record.oid::regprocedure);
  end loop;
end;
$$;
