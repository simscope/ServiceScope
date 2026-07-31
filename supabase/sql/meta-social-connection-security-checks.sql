begin;

-- Transactional Phase 5B schema, ACL, state-consume, and tenant-isolation checks.
do $$
begin
  if to_regclass('public.company_social_connections') is null then
    raise exception 'company_social_connections is missing';
  end if;
  if to_regclass('public.company_social_oauth_states') is null then
    raise exception 'company_social_oauth_states is missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.company_social_connections'::regclass) then
    raise exception 'connection RLS is disabled';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.company_social_oauth_states'::regclass) then
    raise exception 'OAuth state RLS is disabled';
  end if;
  if has_table_privilege('anon', 'public.company_social_connections', 'SELECT')
    or has_table_privilege('authenticated', 'public.company_social_connections', 'SELECT')
    or has_table_privilege('authenticated', 'public.company_social_connections', 'INSERT')
    or has_table_privilege('authenticated', 'public.company_social_connections', 'UPDATE')
    or has_table_privilege('authenticated', 'public.company_social_connections', 'DELETE') then
    raise exception 'browser role can access raw connection rows';
  end if;
  if has_table_privilege('anon', 'public.company_social_oauth_states', 'SELECT')
    or has_table_privilege('authenticated', 'public.company_social_oauth_states', 'SELECT') then
    raise exception 'browser role can access raw OAuth state rows';
  end if;
  if not has_table_privilege('service_role', 'public.company_social_connections', 'SELECT,INSERT,UPDATE,DELETE')
    or not has_table_privilege('service_role', 'public.company_social_oauth_states', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'service role connection path is missing';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.consume_company_social_oauth_state(bytea,uuid,uuid,text,text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated can consume raw OAuth states';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.consume_company_social_oauth_state(bytea,uuid,uuid,text,text)',
    'EXECUTE'
  ) then
    raise exception 'service role cannot consume OAuth states';
  end if;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000005201', 'authenticated', 'authenticated', 'meta-admin-a@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000005202', 'authenticated', 'authenticated', 'meta-manager-a@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000005203', 'authenticated', 'authenticated', 'meta-tech-a@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000005204', 'authenticated', 'authenticated', 'meta-outsider@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.companies (id, name, owner_name, owner_email)
values
  ('00000000-0000-0000-0000-000000005301', 'Meta Tenant A', 'Meta Admin', 'meta-admin-a@example.test'),
  ('00000000-0000-0000-0000-000000005302', 'Meta Tenant B', 'Other Admin', 'other-meta-admin@example.test')
on conflict (id) do nothing;

insert into public.company_users (company_id, auth_user_id, name, email, role, status)
values
  ('00000000-0000-0000-0000-000000005301', '00000000-0000-0000-0000-000000005201', 'Meta Admin', 'meta-admin-a@example.test', 'admin', 'active'),
  ('00000000-0000-0000-0000-000000005301', '00000000-0000-0000-0000-000000005202', 'Meta Manager', 'meta-manager-a@example.test', 'manager', 'active'),
  ('00000000-0000-0000-0000-000000005301', '00000000-0000-0000-0000-000000005203', 'Meta Tech', 'meta-tech-a@example.test', 'technician', 'active')
on conflict (company_id, email) do update
set auth_user_id = excluded.auth_user_id, role = excluded.role, status = excluded.status;

set local role service_role;

insert into public.company_social_oauth_states (
  id, company_id, actor_auth_user_id, provider, state_hash, redirect_uri, return_path, expires_at
) values (
  '00000000-0000-0000-0000-000000005401',
  '00000000-0000-0000-0000-000000005301',
  '00000000-0000-0000-0000-000000005201',
  'meta-facebook-login',
  decode(repeat('ab', 32), 'hex'),
  'https://preview.example.test/auth/meta/callback',
  '/settings/social-connections',
  now() + interval '9 minutes'
);

do $$
declare
  consumed_count integer;
begin
  select count(*) into consumed_count
  from public.consume_company_social_oauth_state(
    decode(repeat('ab', 32), 'hex'),
    '00000000-0000-0000-0000-000000005301',
    '00000000-0000-0000-0000-000000005201',
    'meta-facebook-login',
    'https://preview.example.test/auth/meta/callback'
  );
  if consumed_count <> 1 then raise exception 'valid state was not consumed'; end if;

  select count(*) into consumed_count
  from public.consume_company_social_oauth_state(
    decode(repeat('ab', 32), 'hex'),
    '00000000-0000-0000-0000-000000005301',
    '00000000-0000-0000-0000-000000005201',
    'meta-facebook-login',
    'https://preview.example.test/auth/meta/callback'
  );
  if consumed_count <> 0 then raise exception 'consumed state replay succeeded'; end if;
end;
$$;

insert into public.company_social_connections (
  company_id, provider, status, facebook_page_id, facebook_page_name,
  granted_scopes, token_envelope, connected_by, connected_at
) values (
  '00000000-0000-0000-0000-000000005301',
  'meta-facebook-login',
  'connected',
  '10001',
  'Synthetic Page A',
  array['pages_show_list', 'pages_read_engagement', 'instagram_basic'],
  '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"iv":"safe-test-iv","ciphertext":"safe-test-ciphertext"}'::jsonb,
  '00000000-0000-0000-0000-000000005201',
  now()
);

do $$
begin
  begin
    insert into public.company_social_connections (
      company_id, provider, status, facebook_page_id, facebook_page_name, granted_scopes, token_envelope
    ) values (
      '00000000-0000-0000-0000-000000005301', 'meta-facebook-login', 'connected',
      '10001', 'Duplicate Page', array['pages_show_list'], '{}'::jsonb
    );
    raise exception 'duplicate active asset was allowed';
  exception when unique_violation then null;
  end;

  begin
    insert into public.company_social_connections (
      company_id, provider, status, facebook_page_id, facebook_page_name, granted_scopes, token_envelope
    ) values (
      '00000000-0000-0000-0000-000000005301', 'meta-facebook-login', 'connected',
      '10002', 'Invalid Scope Page', array['pages_manage_posts'], '{}'::jsonb
    );
    raise exception 'publishing scope was allowed';
  exception when check_violation then null;
  end;
end;
$$;

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000005201', true);
do $$
begin
  if not public.can_manage_company('00000000-0000-0000-0000-000000005301') then
    raise exception 'active admin management contract failed';
  end if;
  if public.can_manage_company('00000000-0000-0000-0000-000000005302') then
    raise exception 'cross-tenant management was allowed';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000005202', true);
do $$ begin
  if not public.can_manage_company('00000000-0000-0000-0000-000000005301') then
    raise exception 'active manager management contract failed';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000005203', true);
do $$ begin
  if public.can_manage_company('00000000-0000-0000-0000-000000005301') then
    raise exception 'technician management was allowed';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000005204', true);
do $$ begin
  if public.can_manage_company('00000000-0000-0000-0000-000000005301') then
    raise exception 'outsider management was allowed';
  end if;
end $$;

reset role;
rollback;
