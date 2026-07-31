begin;

-- Company AI voice validation, function privilege, and RLS checks.
-- This suite is transactional and must leave no test artifacts.

do $$
declare
  function_signature text;
  function_oid oid;
begin
  foreach function_signature in array array[
    'public.company_ai_voice_text_valid(text,integer,boolean)',
    'public.company_ai_voice_text_array_valid(text[],integer,integer)',
    'public.company_ai_channel_defaults_valid(jsonb)'
  ]
  loop
    function_oid := to_regprocedure(function_signature);
    if function_oid is null then
      raise exception 'company voice validator function is missing: %', function_signature;
    end if;

    if has_function_privilege('anon', function_signature, 'EXECUTE') then
      raise exception 'anonymous validator execute privilege was allowed: %', function_signature;
    end if;
    if not has_function_privilege('authenticated', function_signature, 'EXECUTE') then
      raise exception 'authenticated validator execute privilege is missing: %', function_signature;
    end if;
    if not has_function_privilege('service_role', function_signature, 'EXECUTE') then
      raise exception 'service-role validator execute privilege is missing: %', function_signature;
    end if;

    if exists (
      select 1
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) privilege
      left join pg_roles grantee_role on grantee_role.oid = privilege.grantee
      where procedure.oid = function_oid
        and namespace.nspname = 'public'
        and privilege.privilege_type = 'EXECUTE'
        and (
          privilege.grantee = 0
          or grantee_role.rolname = 'anon'
        )
    ) then
      raise exception 'PUBLIC or anon validator ACL entry exists: %', function_signature;
    end if;

    if (
      select count(distinct grantee_role.rolname)
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) privilege
      join pg_roles grantee_role on grantee_role.oid = privilege.grantee
      where procedure.oid = function_oid
        and namespace.nspname = 'public'
        and privilege.privilege_type = 'EXECUTE'
        and grantee_role.rolname in ('authenticated', 'service_role')
    ) <> 2 then
      raise exception 'authenticated or service-role validator ACL entry is missing: %', function_signature;
    end if;
  end loop;
end;
$$;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000005001', 'authenticated', 'authenticated', 'voice-admin@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000005002', 'authenticated', 'authenticated', 'voice-tech@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000005003', 'authenticated', 'authenticated', 'voice-outsider@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000005004', 'authenticated', 'authenticated', 'voice-platform-owner@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.platform_users (auth_user_id, name, email, role, status)
values ('00000000-0000-0000-0000-000000005004', 'Voice Platform Owner', 'voice-platform-owner@example.test', 'owner', 'active')
on conflict (email) do update
set auth_user_id = excluded.auth_user_id, role = excluded.role, status = excluded.status;

insert into public.companies (id, name, owner_name, owner_email)
values
  ('00000000-0000-0000-0000-000000005101', 'Voice Tenant A', 'Voice Admin', 'voice-admin@example.test'),
  ('00000000-0000-0000-0000-000000005102', 'Voice Tenant B', 'Other Owner', 'other-owner@example.test'),
  ('00000000-0000-0000-0000-000000005103', 'Voice Validation Tenant', 'Validation Owner', 'validation-owner@example.test')
on conflict (id) do nothing;

-- Contact-bearing public display names fail closed on both insert and update.
do $$
begin
  begin
    insert into public.company_profiles (company_id, ai_public_display_name)
    values ('00000000-0000-0000-0000-000000005103', 'contact@example.test');
    raise exception 'contact-bearing public display name insert was allowed';
  exception when check_violation then
    null;
  end;
end;
$$;

insert into public.company_users (company_id, auth_user_id, name, email, role, status)
values
  ('00000000-0000-0000-0000-000000005101', '00000000-0000-0000-0000-000000005001', 'Voice Admin', 'voice-admin@example.test', 'admin', 'active'),
  ('00000000-0000-0000-0000-000000005101', '00000000-0000-0000-0000-000000005002', 'Voice Tech', 'voice-tech@example.test', 'technician', 'active')
on conflict (company_id, email) do update
set auth_user_id = excluded.auth_user_id, role = excluded.role, status = excluded.status;

insert into public.company_profiles (company_id, ai_voice_enabled, ai_public_display_name)
values
  ('00000000-0000-0000-0000-000000005101', true, 'Tenant A Public'),
  ('00000000-0000-0000-0000-000000005102', true, 'Tenant B Public')
on conflict (company_id) do update
set ai_voice_enabled = excluded.ai_voice_enabled,
    ai_public_display_name = excluded.ai_public_display_name;

do $$
declare
  invalid_display_name text;
  column_name text;
  invalid_array text[];
begin
  foreach invalid_display_name in array array[
    'contact@example.test',
    '+1 202 555 0199',
    '123 Example Street'
  ]
  loop
    begin
      update public.company_profiles
      set ai_public_display_name = invalid_display_name
      where company_id = '00000000-0000-0000-0000-000000005101';
      raise exception 'contact-bearing public display name update was allowed';
    exception when check_violation then
      null;
    end;
  end loop;

  foreach column_name in array array['ai_service_areas', 'ai_hashtag_guidance']
  loop
    for invalid_array in
      select candidate
      from (values
        (array[null]::text[]),
        (array['North County', null]::text[]),
        (array['']::text[]),
        (array['   ']::text[]),
        (array[' North County']::text[])
      ) as invalid_cases(candidate)
    loop
      begin
        execute format(
          'update public.company_profiles set %I = $1 where company_id = $2',
          column_name
        ) using invalid_array, '00000000-0000-0000-0000-000000005101'::uuid;
        raise exception 'invalid text array was allowed for %', column_name;
      exception when check_violation then
        null;
      end;
    end loop;

    execute format(
      'update public.company_profiles set %I = $1 where company_id = $2',
      column_name
    ) using array['North County']::text[], '00000000-0000-0000-0000-000000005101'::uuid;
    execute format(
      'update public.company_profiles set %I = $1 where company_id = $2',
      column_name
    ) using array[]::text[], '00000000-0000-0000-0000-000000005101'::uuid;
  end loop;
end;
$$;

set local role authenticated;

-- Authorized company admin can read and update its company profile.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000005001', true);
do $$
begin
  if (select count(*) from public.company_profiles where company_id = '00000000-0000-0000-0000-000000005101') <> 1 then
    raise exception 'authorized same-company read failed';
  end if;
  update public.company_profiles
  set ai_default_tone = 'Friendly'
  where company_id = '00000000-0000-0000-0000-000000005101';
  if not found then raise exception 'authorized same-company update failed'; end if;
end;
$$;

-- Cross-tenant read returns no row and cross-tenant update changes no row.
do $$
begin
  if (select count(*) from public.company_profiles where company_id = '00000000-0000-0000-0000-000000005102') <> 0 then
    raise exception 'cross-tenant read was allowed';
  end if;
  update public.company_profiles
  set ai_default_tone = 'Technical'
  where company_id = '00000000-0000-0000-0000-000000005102';
  if found then raise exception 'cross-tenant update was allowed'; end if;
end;
$$;

-- Technician can read the company profile but cannot update company settings.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000005002', true);
do $$
begin
  if (select count(*) from public.company_profiles where company_id = '00000000-0000-0000-0000-000000005101') <> 1 then
    raise exception 'same-company technician read failed';
  end if;
  begin
    update public.company_profiles
    set ai_default_tone = 'Marketing'
    where company_id = '00000000-0000-0000-0000-000000005101';
    if found then raise exception 'unauthorized technician update was allowed'; end if;
  end;
end;
$$;

-- User without membership cannot read or update either company.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000005003', true);
do $$
begin
  if (select count(*) from public.company_profiles) <> 0 then
    raise exception 'missing-membership read was allowed';
  end if;
  update public.company_profiles set ai_voice_enabled = false;
  if found then raise exception 'missing-membership update was allowed'; end if;
end;
$$;

-- Platform owner behavior follows the existing can_access/can_manage helpers.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000005004', true);
do $$
begin
  if (select count(*) from public.company_profiles where company_id in (
    '00000000-0000-0000-0000-000000005101',
    '00000000-0000-0000-0000-000000005102'
  )) <> 2 then
    raise exception 'platform owner read failed';
  end if;
  update public.company_profiles
  set ai_default_tone = 'Educational'
  where company_id = '00000000-0000-0000-0000-000000005102';
  if not found then raise exception 'platform owner update failed'; end if;
end;
$$;

reset role;
rollback;
