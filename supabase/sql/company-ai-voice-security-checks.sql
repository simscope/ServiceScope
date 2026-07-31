-- Company AI voice RLS checks.
-- Run against a disposable/local database after migration 20260731020000.
begin;

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
  ('00000000-0000-0000-0000-000000005102', 'Voice Tenant B', 'Other Owner', 'other-owner@example.test')
on conflict (id) do nothing;

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
