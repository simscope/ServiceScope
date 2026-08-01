begin;

-- The PGlite runner reads assertion labels and rolls this transaction back.
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
    or has_table_privilege('authenticated', 'public.company_social_connections', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'browser role can access connection rows';
  end if;
  if has_table_privilege('anon', 'public.company_social_oauth_states', 'SELECT')
    or has_table_privilege('authenticated', 'public.company_social_oauth_states', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'browser role can access OAuth state rows';
  end if;
  if not has_table_privilege('service_role', 'public.company_social_connections', 'SELECT,INSERT,UPDATE,DELETE')
    or not has_table_privilege('service_role', 'public.company_social_oauth_states', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'service role table privileges are incomplete';
  end if;
end;
$$;

insert into meta_sql_assertions(label) values
  ('connections table exists'),
  ('oauth states table exists'),
  ('connections RLS enabled'),
  ('oauth states RLS enabled'),
  ('anon raw table access denied'),
  ('authenticated raw table access denied'),
  ('service role raw table access allowed');

do $$
declare
  signature text;
begin
  foreach signature in array array[
    'public.consume_company_social_oauth_state(bytea,uuid,uuid,text,text)',
    'public.cleanup_company_social_oauth_states(uuid,text,timestamp with time zone,integer)',
    'public.replace_company_social_connection(uuid,uuid,text,text,text,text,text,text,text[],jsonb,timestamp with time zone,uuid,text,text,timestamp with time zone)',
    'public.disconnect_company_social_connection(uuid,uuid,text,uuid,text,text,timestamp with time zone)'
  ] loop
    if has_function_privilege('anon', signature, 'EXECUTE')
      or has_function_privilege('authenticated', signature, 'EXECUTE') then
      raise exception 'browser role can execute %', signature;
    end if;
    if not has_function_privilege('service_role', signature, 'EXECUTE') then
      raise exception 'service role cannot execute %', signature;
    end if;
  end loop;
end;
$$;

insert into meta_sql_assertions(label) values
  ('consume RPC ACL'),
  ('cleanup RPC ACL'),
  ('replace RPC ACL'),
  ('disconnect RPC ACL');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000005201', 'meta-admin-a@example.test'),
  ('00000000-0000-0000-0000-000000005202', 'meta-manager-a@example.test'),
  ('00000000-0000-0000-0000-000000005203', 'meta-tech-a@example.test'),
  ('00000000-0000-0000-0000-000000005204', 'meta-outsider@example.test'),
  ('00000000-0000-0000-0000-000000005205', 'meta-admin-b@example.test');

insert into public.companies (id, name) values
  ('00000000-0000-0000-0000-000000005301', 'Meta Tenant A'),
  ('00000000-0000-0000-0000-000000005302', 'Meta Tenant B'),
  ('00000000-0000-0000-0000-000000005303', 'Meta Constraint Fixture');

insert into public.company_users (company_id, auth_user_id, role, status) values
  ('00000000-0000-0000-0000-000000005301', '00000000-0000-0000-0000-000000005201', 'admin', 'active'),
  ('00000000-0000-0000-0000-000000005301', '00000000-0000-0000-0000-000000005202', 'manager', 'active'),
  ('00000000-0000-0000-0000-000000005301', '00000000-0000-0000-0000-000000005203', 'technician', 'active'),
  ('00000000-0000-0000-0000-000000005302', '00000000-0000-0000-0000-000000005205', 'admin', 'active');

insert into meta_sql_assertions(label) values ('isolated fixtures created');

insert into public.company_social_oauth_states (
  id, company_id, actor_auth_user_id, provider, state_hash, redirect_uri, return_path, expires_at, created_at
) values
  (
    '00000000-0000-0000-0000-000000005401',
    '00000000-0000-0000-0000-000000005301',
    '00000000-0000-0000-0000-000000005201',
    'meta-facebook-login', decode(repeat('a1', 32), 'hex'),
    'https://preview.example.test/auth/meta/callback', '/settings/social-connections', now() + interval '9 minutes', now()
  ),
  (
    '00000000-0000-0000-0000-000000005402',
    '00000000-0000-0000-0000-000000005301',
    '00000000-0000-0000-0000-000000005201',
    'meta-facebook-login', decode(repeat('a2', 32), 'hex'),
    'https://preview.example.test/auth/meta/callback', '/settings/social-connections', now() - interval '1 minute', now() - interval '10 minutes'
  );

do $$
declare
  matched integer;
begin
  select count(*) into matched from public.consume_company_social_oauth_state(
    decode(repeat('a1', 32), 'hex'), '00000000-0000-0000-0000-000000005301',
    '00000000-0000-0000-0000-000000005202', 'meta-facebook-login',
    'https://preview.example.test/auth/meta/callback'
  );
  if matched <> 0 then raise exception 'wrong actor consumed state'; end if;

  select count(*) into matched from public.consume_company_social_oauth_state(
    decode(repeat('a1', 32), 'hex'), '00000000-0000-0000-0000-000000005301',
    '00000000-0000-0000-0000-000000005201', 'meta-facebook-login',
    'https://wrong.example.test/auth/meta/callback'
  );
  if matched <> 0 then raise exception 'wrong redirect consumed state'; end if;

  select count(*) into matched from public.consume_company_social_oauth_state(
    decode(repeat('a1', 32), 'hex'), '00000000-0000-0000-0000-000000005301',
    '00000000-0000-0000-0000-000000005201', 'other-provider',
    'https://preview.example.test/auth/meta/callback'
  );
  if matched <> 0 then raise exception 'wrong provider consumed state'; end if;

  select count(*) into matched from public.consume_company_social_oauth_state(
    decode(repeat('a2', 32), 'hex'), '00000000-0000-0000-0000-000000005301',
    '00000000-0000-0000-0000-000000005201', 'meta-facebook-login',
    'https://preview.example.test/auth/meta/callback'
  );
  if matched <> 0 then raise exception 'expired state was consumed'; end if;

  select count(*) into matched from public.consume_company_social_oauth_state(
    decode(repeat('a1', 32), 'hex'), '00000000-0000-0000-0000-000000005301',
    '00000000-0000-0000-0000-000000005201', 'meta-facebook-login',
    'https://preview.example.test/auth/meta/callback'
  );
  if matched <> 1 then raise exception 'valid state was not consumed once'; end if;

  select count(*) into matched from public.consume_company_social_oauth_state(
    decode(repeat('a1', 32), 'hex'), '00000000-0000-0000-0000-000000005301',
    '00000000-0000-0000-0000-000000005201', 'meta-facebook-login',
    'https://preview.example.test/auth/meta/callback'
  );
  if matched <> 0 then raise exception 'state replay succeeded'; end if;
end;
$$;

insert into meta_sql_assertions(label) values
  ('state actor binding'),
  ('state redirect binding'),
  ('state provider binding'),
  ('expired state rejected'),
  ('valid state consumed once'),
  ('state replay rejected');

insert into public.company_social_oauth_states (
  id, company_id, actor_auth_user_id, provider, state_hash, redirect_uri, return_path, expires_at, created_at
) values
  ('00000000-0000-0000-0000-000000005403', '00000000-0000-0000-0000-000000005301', '00000000-0000-0000-0000-000000005201', 'meta-facebook-login', decode(repeat('a3', 32), 'hex'), 'https://preview.example.test/auth/meta/callback', '/settings/social-connections', now() - interval '1 minute', now() - interval '10 minutes'),
  ('00000000-0000-0000-0000-000000005404', '00000000-0000-0000-0000-000000005301', '00000000-0000-0000-0000-000000005201', 'meta-facebook-login', decode(repeat('a4', 32), 'hex'), 'https://preview.example.test/auth/meta/callback', '/settings/social-connections', now() + interval '9 minutes', now()),
  ('00000000-0000-0000-0000-000000005405', '00000000-0000-0000-0000-000000005302', '00000000-0000-0000-0000-000000005205', 'meta-facebook-login', decode(repeat('a5', 32), 'hex'), 'https://preview.example.test/auth/meta/callback', '/settings/social-connections', now() - interval '1 minute', now() - interval '10 minutes');

do $$
declare
  removed integer;
begin
  removed := public.cleanup_company_social_oauth_states(
    '00000000-0000-0000-0000-000000005301', 'meta-facebook-login', now(), 50
  );
  if removed <> 2 then raise exception 'bounded cleanup removed % rows instead of 2', removed; end if;
  if not exists (select 1 from public.company_social_oauth_states where id = '00000000-0000-0000-0000-000000005404') then
    raise exception 'cleanup removed live state';
  end if;
  if not exists (select 1 from public.company_social_oauth_states where id = '00000000-0000-0000-0000-000000005405') then
    raise exception 'cleanup crossed tenant boundary';
  end if;
end;
$$;

insert into meta_sql_assertions(label) values
  ('bounded expired-state cleanup'),
  ('live state retained'),
  ('cleanup tenant isolation');

do $$
begin
  begin
    perform public.cleanup_company_social_oauth_states(
      '00000000-0000-0000-0000-000000005301', 'meta-facebook-login', now(), 101
    );
    raise exception 'cleanup accepted oversized limit';
  exception when raise_exception then
    if sqlerrm = 'cleanup accepted oversized limit' then raise; end if;
  end;
end;
$$;
insert into meta_sql_assertions(label) values ('cleanup limit enforced');

do $$
begin
  begin
    insert into public.company_social_connections (
      company_id, provider, status, facebook_page_id, facebook_page_name, granted_scopes, token_envelope
    ) values (
      '00000000-0000-0000-0000-000000005303', 'meta-facebook-login', 'connected', '99901', 'Malformed',
      array['pages_show_list'], '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"purpose":"meta-connection","iv":"too-short","ciphertext":"too-short"}'::jsonb
    );
    raise exception 'malformed final envelope accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.company_social_oauth_states (
      company_id, actor_auth_user_id, provider, state_hash, redirect_uri, return_path, expires_at,
      consumed_at, encrypted_pending_token_bundle, discovered_assets
    ) values (
      '00000000-0000-0000-0000-000000005303', '00000000-0000-0000-0000-000000005204',
      'meta-facebook-login', decode(repeat('af', 32), 'hex'), 'https://preview.example.test/auth/meta/callback',
      '/settings/social-connections', now() + interval '9 minutes', now(),
      '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"purpose":"meta-connection","iv":"AAAAAAAAAAAAAAAA","ciphertext":"AAAAAAAAAAAAAAAAAAAAAAA"}'::jsonb, '[]'::jsonb
    );
    raise exception 'wrong pending purpose accepted';
  exception when check_violation then null;
  end;
end;
$$;

insert into meta_sql_assertions(label) values
  ('malformed final envelope rejected'),
  ('wrong pending envelope purpose rejected');

insert into public.company_social_oauth_states (
  id, company_id, actor_auth_user_id, provider, state_hash, redirect_uri, return_path, expires_at,
  consumed_at, encrypted_pending_token_bundle, discovered_assets
) values
  ('00000000-0000-0000-0000-000000005411', '00000000-0000-0000-0000-000000005301', '00000000-0000-0000-0000-000000005201', 'meta-facebook-login', decode(repeat('b1', 32), 'hex'), 'https://preview.example.test/auth/meta/callback', '/settings/social-connections', now() + interval '9 minutes', now(), '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"purpose":"meta-pending","iv":"AAAAAAAAAAAAAAAA","ciphertext":"AAAAAAAAAAAAAAAAAAAAAAA"}'::jsonb, '[]'::jsonb),
  ('00000000-0000-0000-0000-000000005412', '00000000-0000-0000-0000-000000005301', '00000000-0000-0000-0000-000000005202', 'meta-facebook-login', decode(repeat('b2', 32), 'hex'), 'https://preview.example.test/auth/meta/callback', '/settings/social-connections', now() + interval '9 minutes', now(), '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"purpose":"meta-pending","iv":"AAAAAAAAAAAAAAAA","ciphertext":"AAAAAAAAAAAAAAAAAAAAAAA"}'::jsonb, '[]'::jsonb),
  ('00000000-0000-0000-0000-000000005413', '00000000-0000-0000-0000-000000005302', '00000000-0000-0000-0000-000000005205', 'meta-facebook-login', decode(repeat('b3', 32), 'hex'), 'https://preview.example.test/auth/meta/callback', '/settings/social-connections', now() + interval '9 minutes', now(), '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"purpose":"meta-pending","iv":"AAAAAAAAAAAAAAAA","ciphertext":"AAAAAAAAAAAAAAAAAAAAAAA"}'::jsonb, '[]'::jsonb);

select * from public.replace_company_social_connection(
  '00000000-0000-0000-0000-000000005501', '00000000-0000-0000-0000-000000005302',
  'meta-facebook-login', '20001', 'Tenant B Page', null, null, null,
  array['pages_show_list', 'pages_read_engagement', 'instagram_basic'],
  '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"purpose":"meta-connection","iv":"AAAAAAAAAAAAAAAA","ciphertext":"AAAAAAAAAAAAAAAAAAAAAAA"}'::jsonb,
  now() + interval '60 days', '00000000-0000-0000-0000-000000005205', 'Meta Admin B', 'admin', now()
);

insert into public.company_social_oauth_states (
  id, company_id, actor_auth_user_id, provider, state_hash, redirect_uri, return_path, expires_at
) values (
  '00000000-0000-0000-0000-000000005417', '00000000-0000-0000-0000-000000005302',
  '00000000-0000-0000-0000-000000005205', 'meta-facebook-login', decode(repeat('b7', 32), 'hex'),
  'https://preview.example.test/auth/meta/callback', '/settings/social-connections', now() + interval '9 minutes'
);

select * from public.replace_company_social_connection(
  '00000000-0000-0000-0000-000000005502', '00000000-0000-0000-0000-000000005301',
  'meta-facebook-login', '10001', 'Tenant A Page', null, null, null,
  array['pages_show_list', 'pages_read_engagement', 'instagram_basic'],
  '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"purpose":"meta-connection","iv":"AAAAAAAAAAAAAAAA","ciphertext":"AAAAAAAAAAAAAAAAAAAAAAA"}'::jsonb,
  now() + interval '60 days', '00000000-0000-0000-0000-000000005201', 'Meta Admin A', 'admin', now()
);

do $$
begin
  if (select count(*) from public.company_social_connections where company_id = '00000000-0000-0000-0000-000000005301' and status <> 'revoked') <> 1 then
    raise exception 'first replacement did not create exactly one active connection';
  end if;
  if exists (select 1 from public.company_social_oauth_states where company_id = '00000000-0000-0000-0000-000000005301') then
    raise exception 'replacement did not clear all tenant pending states';
  end if;
  if not exists (select 1 from public.company_social_connections where id = '00000000-0000-0000-0000-000000005501' and status = 'connected') then
    raise exception 'replacement crossed tenant boundary';
  end if;
  if not exists (select 1 from public.company_social_oauth_states where id = '00000000-0000-0000-0000-000000005417') then
    raise exception 'replacement removed other tenant state';
  end if;
  if not exists (select 1 from public.audit_events where action = 'meta_asset_selected' and resource_id = '00000000-0000-0000-0000-000000005502') then
    raise exception 'replacement audit missing';
  end if;
end;
$$;

insert into meta_sql_assertions(label) values
  ('first atomic replacement'),
  ('replacement clears multi-actor pending states'),
  ('replacement connection tenant isolation'),
  ('replacement pending-state tenant isolation'),
  ('replacement audit atomic');

insert into public.company_social_oauth_states (
  id, company_id, actor_auth_user_id, provider, state_hash, redirect_uri, return_path, expires_at
) values (
  '00000000-0000-0000-0000-000000005414', '00000000-0000-0000-0000-000000005301',
  '00000000-0000-0000-0000-000000005202', 'meta-facebook-login', decode(repeat('b4', 32), 'hex'),
  'https://preview.example.test/auth/meta/callback', '/settings/social-connections', now() + interval '9 minutes'
);

select * from public.replace_company_social_connection(
  '00000000-0000-0000-0000-000000005503', '00000000-0000-0000-0000-000000005301',
  'meta-facebook-login', '10001', 'Tenant A Page Refreshed', null, null, null,
  array['pages_show_list', 'pages_read_engagement', 'instagram_basic'],
  '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"purpose":"meta-connection","iv":"BBBBBBBBBBBBBBBB","ciphertext":"BBBBBBBBBBBBBBBBBBBBBBB"}'::jsonb,
  now() + interval '60 days', '00000000-0000-0000-0000-000000005202', 'Meta Manager A', 'manager', now()
);

select * from public.replace_company_social_connection(
  '00000000-0000-0000-0000-000000005504', '00000000-0000-0000-0000-000000005301',
  'meta-facebook-login', '10002', 'Tenant A Different Page', '30001', 'tenant_a_ig', 'BUSINESS',
  array['pages_show_list', 'pages_read_engagement', 'instagram_basic'],
  '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"purpose":"meta-connection","iv":"CCCCCCCCCCCCCCCC","ciphertext":"CCCCCCCCCCCCCCCCCCCCCCC"}'::jsonb,
  now() + interval '60 days', '00000000-0000-0000-0000-000000005201', 'Meta Admin A', 'admin', now()
);

do $$
begin
  if (select count(*) from public.company_social_connections where company_id = '00000000-0000-0000-0000-000000005301' and status <> 'revoked') <> 1 then
    raise exception 'successive replacement left hidden active records';
  end if;
  if not exists (select 1 from public.company_social_connections where id = '00000000-0000-0000-0000-000000005504' and status = 'connected' and facebook_page_id = '10002') then
    raise exception 'different-page replacement is not active';
  end if;
  if exists (select 1 from public.company_social_connections where company_id = '00000000-0000-0000-0000-000000005301' and id <> '00000000-0000-0000-0000-000000005504' and (status <> 'revoked' or token_envelope is not null)) then
    raise exception 'replaced records retained active status or token material';
  end if;
  if exists (select 1 from public.company_social_oauth_states where id = '00000000-0000-0000-0000-000000005414') then
    raise exception 'successive replacement retained pending state';
  end if;
end;
$$;

insert into meta_sql_assertions(label) values
  ('same-page replacement'),
  ('different-page replacement'),
  ('one active provider invariant'),
  ('replaced tokens cleared'),
  ('successive replacement clears pending');

do $$
begin
  begin
    insert into public.company_social_connections (
      company_id, provider, status, facebook_page_id, facebook_page_name, granted_scopes, token_envelope
    ) values (
      '00000000-0000-0000-0000-000000005301', 'meta-facebook-login', 'connected', '10003', 'Duplicate Active',
      array['pages_show_list', 'pages_read_engagement', 'instagram_basic'],
      '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"purpose":"meta-connection","iv":"DDDDDDDDDDDDDDDD","ciphertext":"DDDDDDDDDDDDDDDDDDDDDDD"}'::jsonb
    );
    raise exception 'duplicate active connection accepted';
  exception when unique_violation then null;
  end;
end;
$$;
insert into meta_sql_assertions(label) values ('duplicate active connection rejected');

insert into public.company_social_oauth_states (
  id, company_id, actor_auth_user_id, provider, state_hash, redirect_uri, return_path, expires_at
) values
  ('00000000-0000-0000-0000-000000005415', '00000000-0000-0000-0000-000000005301', '00000000-0000-0000-0000-000000005201', 'meta-facebook-login', decode(repeat('b5', 32), 'hex'), 'https://preview.example.test/auth/meta/callback', '/settings/social-connections', now() + interval '9 minutes'),
  ('00000000-0000-0000-0000-000000005416', '00000000-0000-0000-0000-000000005301', '00000000-0000-0000-0000-000000005202', 'meta-facebook-login', decode(repeat('b6', 32), 'hex'), 'https://preview.example.test/auth/meta/callback', '/settings/social-connections', now() + interval '9 minutes');

select * from public.disconnect_company_social_connection(
  '00000000-0000-0000-0000-000000005504', '00000000-0000-0000-0000-000000005301',
  'meta-facebook-login', '00000000-0000-0000-0000-000000005201', 'Meta Admin A', 'admin', now()
);

do $$
begin
  if not exists (select 1 from public.company_social_connections where id = '00000000-0000-0000-0000-000000005504' and status = 'revoked' and token_envelope is null) then
    raise exception 'disconnect did not revoke and clear token';
  end if;
  if exists (select 1 from public.company_social_connections where company_id = '00000000-0000-0000-0000-000000005301' and status <> 'revoked') then
    raise exception 'disconnect left active connection';
  end if;
  if exists (select 1 from public.company_social_oauth_states where company_id = '00000000-0000-0000-0000-000000005301') then
    raise exception 'disconnect did not clear multi-actor pending states';
  end if;
  if not exists (select 1 from public.audit_events where action = 'meta_connection_disconnected' and resource_id = '00000000-0000-0000-0000-000000005504') then
    raise exception 'disconnect audit missing';
  end if;
  if not exists (select 1 from public.company_social_connections where id = '00000000-0000-0000-0000-000000005501' and status = 'connected') then
    raise exception 'disconnect crossed tenant boundary';
  end if;
end;
$$;

insert into meta_sql_assertions(label) values
  ('local disconnect revokes connection'),
  ('local disconnect clears token'),
  ('local disconnect clears multi-actor pending states'),
  ('local disconnect audit atomic'),
  ('local disconnect tenant isolation');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000005201', true);
do $$ begin
  if not public.can_manage_company('00000000-0000-0000-0000-000000005301') then raise exception 'admin denied'; end if;
  if public.can_manage_company('00000000-0000-0000-0000-000000005302') then raise exception 'admin crossed tenant'; end if;
end $$;
insert into meta_sql_assertions(label) values ('admin management capability'), ('management tenant isolation');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000005202', true);
do $$ begin
  if not public.can_manage_company('00000000-0000-0000-0000-000000005301') then raise exception 'manager denied'; end if;
end $$;
insert into meta_sql_assertions(label) values ('manager management capability');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000005203', true);
do $$ begin
  if public.can_manage_company('00000000-0000-0000-0000-000000005301') then raise exception 'technician allowed'; end if;
end $$;
insert into meta_sql_assertions(label) values ('technician management denied');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000005204', true);
do $$ begin
  if public.can_manage_company('00000000-0000-0000-0000-000000005301') then raise exception 'outsider allowed'; end if;
end $$;
insert into meta_sql_assertions(label) values ('outsider management denied');
