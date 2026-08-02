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
    'public.disconnect_company_social_connection(uuid,uuid,text,uuid,text,text,timestamp with time zone)',
    'public.create_company_social_oauth_state_with_audit(uuid,uuid,text,text,text,bytea,text,text,timestamp with time zone,timestamp with time zone)',
    'public.save_company_social_oauth_discovery_with_audit(uuid,uuid,uuid,text,text,text,jsonb,jsonb,timestamp with time zone)',
    'public.update_company_social_connection_health_with_audit(uuid,uuid,uuid,text,text,text,text,text,text[],text,timestamp with time zone)'
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
  ('disconnect RPC ACL'),
  ('transactional start RPC ACL'),
  ('transactional completion RPC ACL'),
  ('transactional health RPC ACL');

do $$
declare
  signature text;
  proc_record record;
begin
  foreach signature in array array[
    'public.create_company_social_oauth_state_with_audit(uuid,uuid,text,text,text,bytea,text,text,timestamp with time zone,timestamp with time zone)',
    'public.save_company_social_oauth_discovery_with_audit(uuid,uuid,uuid,text,text,text,jsonb,jsonb,timestamp with time zone)',
    'public.update_company_social_connection_health_with_audit(uuid,uuid,uuid,text,text,text,text,text,text[],text,timestamp with time zone)'
  ] loop
    select prosecdef, proconfig, prosrc, coalesce(array_to_string(proacl, ','), '') as acl
    into proc_record
    from pg_proc
    where oid = signature::regprocedure;

    if not proc_record.prosecdef then raise exception '% is not SECURITY DEFINER', signature; end if;
    if proc_record.proconfig is null or not ('search_path=""' = any(proc_record.proconfig)) then
      raise exception '% does not have an empty search_path', signature;
    end if;
    if proc_record.prosrc ~* '\mexecute\M' then raise exception '% contains dynamic SQL', signature; end if;
    if proc_record.acl ~ '(^|,)=X/' then raise exception 'PUBLIC can execute %', signature; end if;
  end loop;
end;
$$;

insert into meta_sql_assertions(label) values
  ('transactional RPC SECURITY DEFINER'),
  ('transactional RPC empty search_path'),
  ('transactional RPC no dynamic SQL'),
  ('transactional RPC PUBLIC denied');

do $$
declare
  constraint_count integer;
  constraint_definition text;
  function_definition text;
begin
  select count(*)::integer, max(pg_get_constraintdef(oid))
  into constraint_count, constraint_definition
  from pg_constraint
  where conrelid = 'public.company_social_oauth_states'::regclass
    and conname = 'company_social_oauth_states_expiry_check';

  if constraint_count <> 1 then raise exception 'OAuth state expiry constraint count is %', constraint_count; end if;
  if constraint_definition !~* 'expires_at > created_at' then raise exception 'OAuth state expiry lower bound is missing'; end if;
  if constraint_definition !~* '(00:30:00|30 minutes)' then raise exception 'OAuth state 30-minute bound is missing'; end if;
  if constraint_definition ~* '(00:10:00|10 minutes)' then raise exception 'OAuth state 10-minute bound remains effective'; end if;

  select pg_get_functiondef(
    'public.create_company_social_oauth_state_with_audit(uuid,uuid,text,text,text,bytea,text,text,timestamp with time zone,timestamp with time zone)'::regprocedure
  ) into function_definition;
  if function_definition !~* 'interval ''30 minutes''' then raise exception 'transactional start 30-minute bound is missing'; end if;
  if function_definition ~* 'interval ''10 minutes''' then raise exception 'transactional start 10-minute bound remains effective'; end if;
end;
$$;

insert into meta_sql_assertions(label) values
  ('expiry constraint exact name and singleton'),
  ('expiry constraint lower bound preserved'),
  ('expiry constraint 30-minute maximum'),
  ('expiry constraint 10-minute maximum removed'),
  ('transactional start RPC 30-minute maximum'),
  ('transactional start RPC 10-minute maximum removed');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000005201', 'meta-admin-a@example.test'),
  ('00000000-0000-0000-0000-000000005202', 'meta-manager-a@example.test'),
  ('00000000-0000-0000-0000-000000005203', 'meta-tech-a@example.test'),
  ('00000000-0000-0000-0000-000000005204', 'meta-outsider@example.test'),
  ('00000000-0000-0000-0000-000000005205', 'meta-admin-b@example.test'),
  ('00000000-0000-0000-0000-000000005206', 'meta-lifecycle@example.test');

insert into public.companies (id, name, owner_name, owner_email) values
  ('00000000-0000-0000-0000-000000005301', 'Meta Tenant A', 'Meta Owner A', 'meta-owner-a@example.test'),
  ('00000000-0000-0000-0000-000000005302', 'Meta Tenant B', 'Meta Owner B', 'meta-owner-b@example.test'),
  ('00000000-0000-0000-0000-000000005303', 'Meta Constraint Fixture', 'Meta Constraint Owner', 'meta-constraint@example.test'),
  ('00000000-0000-0000-0000-000000005304', 'Meta Lifecycle Fixture', 'Meta Lifecycle Owner', 'meta-lifecycle-owner@example.test');

insert into public.company_users (company_id, auth_user_id, name, email, role, status) values
  ('00000000-0000-0000-0000-000000005301', '00000000-0000-0000-0000-000000005201', 'Meta Admin A', 'meta-admin-a@example.test', 'admin', 'active'),
  ('00000000-0000-0000-0000-000000005301', '00000000-0000-0000-0000-000000005202', 'Meta Manager A', 'meta-manager-a@example.test', 'manager', 'active'),
  ('00000000-0000-0000-0000-000000005301', '00000000-0000-0000-0000-000000005203', 'Meta Technician A', 'meta-tech-a@example.test', 'technician', 'active'),
  ('00000000-0000-0000-0000-000000005302', '00000000-0000-0000-0000-000000005205', 'Meta Admin B', 'meta-admin-b@example.test', 'admin', 'active'),
  ('00000000-0000-0000-0000-000000005304', '00000000-0000-0000-0000-000000005206', 'Meta Lifecycle Admin', 'meta-lifecycle@example.test', 'admin', 'active');

insert into meta_sql_assertions(label) values ('isolated fixtures created');

do $$
begin
  begin
    insert into public.audit_events (company_id, category, action, actor_name, resource)
    values (
      '00000000-0000-0000-0000-000000005303', 'access', 'meta_fixture_missing_label',
      'Meta SQL Fixture', 'Meta social connection'
    );
    raise exception 'audit insert without resource_label succeeded';
  exception when not_null_violation then null;
  end;
end;
$$;
insert into meta_sql_assertions(label) values ('audit resource_label not-null contract enforced');

do $$
declare
  created_state public.company_social_oauth_states%rowtype;
begin
  select * into created_state
  from public.create_company_social_oauth_state_with_audit(
    '00000000-0000-0000-0000-000000005304',
    '00000000-0000-0000-0000-000000005206',
    'Meta Lifecycle Admin', 'admin', 'meta-facebook-login', decode(repeat('c1', 32), 'hex'),
    'https://servicescope-inky.vercel.app/auth/meta/callback', '/settings/social-connections',
    now() + interval '30 minutes', now()
  );

  if created_state.id is null or octet_length(created_state.state_hash) <> 32 then
    raise exception 'transactional start did not create a valid state';
  end if;
  if created_state.actor_auth_user_id <> '00000000-0000-0000-0000-000000005206'
    or not exists (select 1 from auth.users where id = created_state.actor_auth_user_id) then
    raise exception 'transactional start did not preserve verified Auth UID ownership';
  end if;
  if not exists (
    select 1 from public.audit_events
    where action = 'meta_connection_started'
      and category = 'access'
      and resource_type = 'meta_social_authorization'
      and resource = 'Meta social connection'
      and resource_id = created_state.id::text
      and resource_label = 'Meta authorization'
      and details = 'Meta connection lifecycle action completed.'
  ) then
    raise exception 'transactional start audit is incompatible';
  end if;
end;
$$;

insert into meta_sql_assertions(label) values
  ('transactional start exact 30-minute bound accepted'),
  ('transactional start state success'),
  ('transactional start audit success'),
  ('transactional start resource contract'),
  ('transactional start verified Auth UID FK');

do $$
declare
  near_bound public.company_social_oauth_states%rowtype;
  legacy_bound public.company_social_oauth_states%rowtype;
begin
  select * into near_bound
  from public.create_company_social_oauth_state_with_audit(
    '00000000-0000-0000-0000-000000005304', '00000000-0000-0000-0000-000000005206',
    'Meta Lifecycle Admin', 'admin', 'meta-facebook-login', decode(repeat('cb', 32), 'hex'),
    'https://servicescope-inky.vercel.app/auth/meta/callback', '/settings/social-connections',
    now() + interval '29 minutes 59.999 seconds', now()
  );
  select * into legacy_bound
  from public.create_company_social_oauth_state_with_audit(
    '00000000-0000-0000-0000-000000005304', '00000000-0000-0000-0000-000000005206',
    'Meta Lifecycle Admin', 'admin', 'meta-facebook-login', decode(repeat('cc', 32), 'hex'),
    'https://servicescope-inky.vercel.app/auth/meta/callback', '/settings/social-connections',
    now() + interval '10 minutes', now()
  );
  if near_bound.id is null or legacy_bound.id is null then
    raise exception 'accepted OAuth state bound was not created';
  end if;
end;
$$;
insert into meta_sql_assertions(label) values
  ('transactional start below 30-minute bound accepted'),
  ('existing 10-minute state remains valid');

do $$
begin
  begin
    perform * from public.create_company_social_oauth_state_with_audit(
      '00000000-0000-0000-0000-000000005304', '00000000-0000-0000-0000-000000005206',
      'Meta Lifecycle Admin', 'admin', 'other-provider', decode(repeat('c2', 32), 'hex'),
      'https://servicescope-inky.vercel.app/auth/meta/callback', '/settings/social-connections',
      now() + interval '9 minutes', now()
    );
    raise exception 'transactional start accepted invalid provider';
  exception when raise_exception then
    if sqlerrm = 'transactional start accepted invalid provider' then raise; end if;
  end;
  begin
    perform * from public.create_company_social_oauth_state_with_audit(
      '00000000-0000-0000-0000-000000005304', '00000000-0000-0000-0000-000000005206',
      'Meta Lifecycle Admin', 'admin', 'meta-facebook-login', decode(repeat('c3', 31), 'hex'),
      'https://servicescope-inky.vercel.app/auth/meta/callback', '/settings/social-connections',
      now() + interval '9 minutes', now()
    );
    raise exception 'transactional start accepted invalid hash';
  exception when raise_exception then
    if sqlerrm = 'transactional start accepted invalid hash' then raise; end if;
  end;
  begin
    perform * from public.create_company_social_oauth_state_with_audit(
      '00000000-0000-0000-0000-000000005304', '00000000-0000-0000-0000-000000005206',
      'Meta Lifecycle Admin', 'admin', 'meta-facebook-login', decode(repeat('c4', 32), 'hex'),
      'https://preview.example.test/auth/meta/callback', '/settings/social-connections',
      now() + interval '9 minutes', now()
    );
    raise exception 'transactional start accepted invalid redirect';
  exception when raise_exception then
    if sqlerrm = 'transactional start accepted invalid redirect' then raise; end if;
  end;
  begin
    perform * from public.create_company_social_oauth_state_with_audit(
      '00000000-0000-0000-0000-000000005304', '00000000-0000-0000-0000-000000005206',
      'Meta Lifecycle Admin', 'admin', 'meta-facebook-login', decode(repeat('c5', 32), 'hex'),
      'https://servicescope-inky.vercel.app/auth/meta/callback', '/other',
      now() + interval '9 minutes', now()
    );
    raise exception 'transactional start accepted invalid return path';
  exception when raise_exception then
    if sqlerrm = 'transactional start accepted invalid return path' then raise; end if;
  end;
  begin
    perform * from public.create_company_social_oauth_state_with_audit(
      '00000000-0000-0000-0000-000000005304', '00000000-0000-0000-0000-000000005206',
      'Meta Lifecycle Admin', 'admin', 'meta-facebook-login', decode(repeat('c6', 32), 'hex'),
      'https://servicescope-inky.vercel.app/auth/meta/callback', '/settings/social-connections',
      now() + interval '31 minutes', now()
    );
    raise exception 'transactional start accepted invalid expiry';
  exception when raise_exception then
    if sqlerrm = 'transactional start accepted invalid expiry' then raise; end if;
  end;
  begin
    perform * from public.create_company_social_oauth_state_with_audit(
      '00000000-0000-0000-0000-000000005304', '00000000-0000-0000-0000-000000005206',
      'Meta Lifecycle Admin', 'admin', 'meta-facebook-login', decode(repeat('c8', 32), 'hex'),
      'https://servicescope-inky.vercel.app/auth/meta/callback', '/settings/social-connections',
      now(), now()
    );
    raise exception 'transactional start accepted zero expiry';
  exception when raise_exception then
    if sqlerrm = 'transactional start accepted zero expiry' then raise; end if;
  end;
  begin
    perform * from public.create_company_social_oauth_state_with_audit(
      '00000000-0000-0000-0000-000000005304', '00000000-0000-0000-0000-000000005206',
      'Meta Lifecycle Admin', 'admin', 'meta-facebook-login', decode(repeat('c9', 32), 'hex'),
      'https://servicescope-inky.vercel.app/auth/meta/callback', '/settings/social-connections',
      now() - interval '1 millisecond', now()
    );
    raise exception 'transactional start accepted negative expiry';
  exception when raise_exception then
    if sqlerrm = 'transactional start accepted negative expiry' then raise; end if;
  end;
  begin
    perform * from public.create_company_social_oauth_state_with_audit(
      '00000000-0000-0000-0000-000000005304', '00000000-0000-0000-0000-000000005206',
      'Meta Lifecycle Admin', 'admin', 'meta-facebook-login', decode(repeat('ca', 32), 'hex'),
      'https://servicescope-inky.vercel.app/auth/meta/callback', '/settings/social-connections',
      now() + interval '30 minutes 0.001 seconds', now()
    );
    raise exception 'transactional start accepted over-bound expiry';
  exception when raise_exception then
    if sqlerrm = 'transactional start accepted over-bound expiry' then raise; end if;
  end;
end;
$$;

insert into meta_sql_assertions(label) values
  ('transactional start provider validation'),
  ('transactional start hash validation'),
  ('transactional start redirect validation'),
  ('transactional start return-path validation'),
  ('transactional start 31-minute rejection'),
  ('transactional start zero expiry rejection'),
  ('transactional start negative expiry rejection'),
  ('transactional start minimally over-bound rejection');

create or replace function public.meta_sql_reject_start_audit()
returns trigger
language plpgsql
as $$
begin
  if new.action = 'meta_connection_started' then raise exception 'synthetic start audit failure'; end if;
  return new;
end;
$$;
create trigger meta_sql_reject_start_audit
before insert on public.audit_events
for each row execute function public.meta_sql_reject_start_audit();

do $$
begin
  begin
    perform * from public.create_company_social_oauth_state_with_audit(
      '00000000-0000-0000-0000-000000005304', '00000000-0000-0000-0000-000000005206',
      'Meta Lifecycle Admin', 'admin', 'meta-facebook-login', decode(repeat('c7', 32), 'hex'),
      'https://servicescope-inky.vercel.app/auth/meta/callback', '/settings/social-connections',
      now() + interval '9 minutes', now()
    );
    raise exception 'start unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm = 'start unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'synthetic start audit failure' then raise; end if;
  end;
  if exists (select 1 from public.company_social_oauth_states where state_hash = decode(repeat('c7', 32), 'hex')) then
    raise exception 'start audit failure retained OAuth state';
  end if;
  if exists (select 1 from public.audit_events where action = 'meta_connection_started' and resource_id in (
    select id::text from public.company_social_oauth_states where state_hash = decode(repeat('c7', 32), 'hex')
  )) then
    raise exception 'failed start retained audit row';
  end if;
end;
$$;

insert into meta_sql_assertions(label) values
  ('start audit failure surfaced'),
  ('start audit failure rolls back state'),
  ('failed start rollback artifacts zero');

drop trigger meta_sql_reject_start_audit on public.audit_events;
drop function public.meta_sql_reject_start_audit();

insert into public.company_social_oauth_states (
  id, company_id, actor_auth_user_id, provider, state_hash, redirect_uri, return_path,
  expires_at, consumed_at, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000005461', '00000000-0000-0000-0000-000000005304', '00000000-0000-0000-0000-000000005206', 'meta-facebook-login', decode(repeat('d1', 32), 'hex'), 'https://servicescope-inky.vercel.app/auth/meta/callback', '/settings/social-connections', now() + interval '9 minutes', now(), now(), now()),
  ('00000000-0000-0000-0000-000000005462', '00000000-0000-0000-0000-000000005304', '00000000-0000-0000-0000-000000005206', 'meta-facebook-login', decode(repeat('d2', 32), 'hex'), 'https://servicescope-inky.vercel.app/auth/meta/callback', '/settings/social-connections', now() + interval '9 minutes', now(), now(), now()),
  ('00000000-0000-0000-0000-000000005463', '00000000-0000-0000-0000-000000005304', '00000000-0000-0000-0000-000000005206', 'meta-facebook-login', decode(repeat('d3', 32), 'hex'), 'https://servicescope-inky.vercel.app/auth/meta/callback', '/settings/social-connections', now() - interval '1 minute', now() - interval '2 minutes', now() - interval '10 minutes', now() - interval '2 minutes'),
  ('00000000-0000-0000-0000-000000005464', '00000000-0000-0000-0000-000000005304', '00000000-0000-0000-0000-000000005206', 'meta-facebook-login', decode(repeat('d4', 32), 'hex'), 'https://servicescope-inky.vercel.app/auth/meta/callback', '/settings/social-connections', now() + interval '9 minutes', now(), now(), now()),
  ('00000000-0000-0000-0000-000000005465', '00000000-0000-0000-0000-000000005304', '00000000-0000-0000-0000-000000005206', 'meta-facebook-login', decode(repeat('d5', 32), 'hex'), 'https://servicescope-inky.vercel.app/auth/meta/callback', '/settings/social-connections', now() + interval '9 minutes', null, now(), now());

select * from public.save_company_social_oauth_discovery_with_audit(
  '00000000-0000-0000-0000-000000005461', '00000000-0000-0000-0000-000000005304',
  '00000000-0000-0000-0000-000000005206', 'Meta Lifecycle Admin', 'admin', 'meta-facebook-login',
  '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"purpose":"meta-pending","iv":"EEEEEEEEEEEEEEEE","ciphertext":"EEEEEEEEEEEEEEEEEEEEEEE"}'::jsonb,
  '[{"pageId":"40001","pageName":"Lifecycle Page"}]'::jsonb, now()
);

do $$
begin
  if not exists (
    select 1 from public.company_social_oauth_states
    where id = '00000000-0000-0000-0000-000000005461'
      and encrypted_pending_token_bundle is not null
      and jsonb_array_length(discovered_assets) = 1
  ) then raise exception 'completion did not save exact consumed state'; end if;
  if not exists (
    select 1 from public.audit_events
    where action = 'meta_oauth_completed'
      and resource_type = 'meta_social_authorization'
      and resource_id = '00000000-0000-0000-0000-000000005461'
      and resource_label = 'Meta authorization'
  ) then raise exception 'completion audit missing'; end if;

  begin
    perform * from public.save_company_social_oauth_discovery_with_audit(
      '00000000-0000-0000-0000-000000005462', '00000000-0000-0000-0000-000000005304',
      '00000000-0000-0000-0000-000000005205', 'Meta Admin B', 'admin', 'meta-facebook-login',
      '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"purpose":"meta-pending","iv":"FFFFFFFFFFFFFFFF","ciphertext":"FFFFFFFFFFFFFFFFFFFFFFF"}'::jsonb,
      '[]'::jsonb, now()
    );
    raise exception 'completion accepted wrong actor';
  exception when raise_exception then
    if sqlerrm = 'completion accepted wrong actor' then raise; end if;
  end;

  begin
    perform * from public.save_company_social_oauth_discovery_with_audit(
      '00000000-0000-0000-0000-000000005462', '00000000-0000-0000-0000-000000005301',
      '00000000-0000-0000-0000-000000005206', 'Meta Lifecycle Admin', 'admin', 'meta-facebook-login',
      '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"purpose":"meta-pending","iv":"FFFFFFFFFFFFFFFF","ciphertext":"FFFFFFFFFFFFFFFFFFFFFFF"}'::jsonb,
      '[]'::jsonb, now()
    );
    raise exception 'completion accepted wrong company';
  exception when raise_exception then
    if sqlerrm = 'completion accepted wrong company' then raise; end if;
  end;

  begin
    perform * from public.save_company_social_oauth_discovery_with_audit(
      '00000000-0000-0000-0000-000000005463', '00000000-0000-0000-0000-000000005304',
      '00000000-0000-0000-0000-000000005206', 'Meta Lifecycle Admin', 'admin', 'meta-facebook-login',
      '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"purpose":"meta-pending","iv":"GGGGGGGGGGGGGGGG","ciphertext":"GGGGGGGGGGGGGGGGGGGGGGG"}'::jsonb,
      '[]'::jsonb, now()
    );
    raise exception 'completion accepted expired state';
  exception when raise_exception then
    if sqlerrm = 'completion accepted expired state' then raise; end if;
  end;

  begin
    perform * from public.save_company_social_oauth_discovery_with_audit(
      '00000000-0000-0000-0000-000000005465', '00000000-0000-0000-0000-000000005304',
      '00000000-0000-0000-0000-000000005206', 'Meta Lifecycle Admin', 'admin', 'meta-facebook-login',
      '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"purpose":"meta-pending","iv":"JJJJJJJJJJJJJJJJ","ciphertext":"JJJJJJJJJJJJJJJJJJJJJJJ"}'::jsonb,
      '[]'::jsonb, now()
    );
    raise exception 'completion accepted unconsumed state';
  exception when raise_exception then
    if sqlerrm = 'completion accepted unconsumed state' then raise; end if;
  end;

  begin
    perform * from public.save_company_social_oauth_discovery_with_audit(
      '00000000-0000-0000-0000-000000005461', '00000000-0000-0000-0000-000000005304',
      '00000000-0000-0000-0000-000000005206', 'Meta Lifecycle Admin', 'admin', 'meta-facebook-login',
      '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"purpose":"meta-pending","iv":"KKKKKKKKKKKKKKKK","ciphertext":"KKKKKKKKKKKKKKKKKKKKKKK"}'::jsonb,
      '[]'::jsonb, now()
    );
    raise exception 'completion replaced existing pending material';
  exception when raise_exception then
    if sqlerrm = 'completion replaced existing pending material' then raise; end if;
  end;
end;
$$;

insert into meta_sql_assertions(label) values
  ('transactional completion success'),
  ('transactional completion audit success'),
  ('transactional completion exact-state binding'),
  ('transactional completion actor binding'),
  ('transactional completion company binding'),
  ('transactional completion expiry validation'),
  ('transactional completion consumed-state validation'),
  ('transactional completion pending-material replacement denied');

create or replace function public.meta_sql_reject_completion_audit()
returns trigger
language plpgsql
as $$
begin
  if new.action = 'meta_oauth_completed' then raise exception 'synthetic completion audit failure'; end if;
  return new;
end;
$$;
create trigger meta_sql_reject_completion_audit
before insert on public.audit_events
for each row execute function public.meta_sql_reject_completion_audit();

do $$
begin
  begin
    perform * from public.save_company_social_oauth_discovery_with_audit(
      '00000000-0000-0000-0000-000000005464', '00000000-0000-0000-0000-000000005304',
      '00000000-0000-0000-0000-000000005206', 'Meta Lifecycle Admin', 'admin', 'meta-facebook-login',
      '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"purpose":"meta-pending","iv":"HHHHHHHHHHHHHHHH","ciphertext":"HHHHHHHHHHHHHHHHHHHHHHH"}'::jsonb,
      '[{"pageId":"40002"}]'::jsonb, now()
    );
    raise exception 'completion unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm = 'completion unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'synthetic completion audit failure' then raise; end if;
  end;
  if exists (
    select 1 from public.company_social_oauth_states
    where id = '00000000-0000-0000-0000-000000005464'
      and (encrypted_pending_token_bundle is not null or discovered_assets is not null)
  ) then raise exception 'completion audit failure retained pending material'; end if;
  if exists (select 1 from public.audit_events where action = 'meta_oauth_completed' and resource_id = '00000000-0000-0000-0000-000000005464') then
    raise exception 'failed completion retained audit row';
  end if;
end;
$$;

insert into meta_sql_assertions(label) values
  ('completion audit failure surfaced'),
  ('completion audit failure rolls back envelope'),
  ('completion audit failure rolls back assets'),
  ('failed completion leaves no pending secret material'),
  ('failed completion leaves no audit row');

drop trigger meta_sql_reject_completion_audit on public.audit_events;
drop function public.meta_sql_reject_completion_audit();

insert into public.company_social_connections (
  id, company_id, provider, status, facebook_page_id, facebook_page_name,
  granted_scopes, token_envelope, connected_by, connected_at, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000005561', '00000000-0000-0000-0000-000000005304',
    'meta-facebook-login', 'connected', '40001', 'Lifecycle Page',
    array['pages_show_list', 'pages_read_engagement', 'instagram_basic'],
    '{"schemaVersion":"encrypted-social-token-v1","algorithm":"AES-GCM","keyVersion":1,"purpose":"meta-connection","iv":"IIIIIIIIIIIIIIII","ciphertext":"IIIIIIIIIIIIIIIIIIIIIII"}'::jsonb,
    '00000000-0000-0000-0000-000000005206', now(), now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000005562', '00000000-0000-0000-0000-000000005304',
    'meta-facebook-login', 'revoked', '40002', 'Revoked Lifecycle Page',
    array['pages_show_list', 'pages_read_engagement', 'instagram_basic'], null,
    '00000000-0000-0000-0000-000000005206', now(), now(), now()
  );

select * from public.update_company_social_connection_health_with_audit(
  '00000000-0000-0000-0000-000000005561', '00000000-0000-0000-0000-000000005304',
  '00000000-0000-0000-0000-000000005206', 'Meta Lifecycle Admin', 'admin', 'meta-facebook-login',
  'connected', null, array['pages_show_list', 'pages_read_engagement', 'instagram_basic'],
  'meta_health_checked', now()
);

select * from public.update_company_social_connection_health_with_audit(
  '00000000-0000-0000-0000-000000005561', '00000000-0000-0000-0000-000000005304',
  '00000000-0000-0000-0000-000000005206', 'Meta Lifecycle Admin', 'admin', 'meta-facebook-login',
  'needs_reauthorization', 'META_TOKEN_INVALID', array['pages_show_list', 'pages_read_engagement', 'instagram_basic'],
  'meta_connection_needs_reauthorization', now()
);

select * from public.update_company_social_connection_health_with_audit(
  '00000000-0000-0000-0000-000000005561', '00000000-0000-0000-0000-000000005304',
  '00000000-0000-0000-0000-000000005206', 'Meta Lifecycle Admin', 'admin', 'meta-facebook-login',
  'needs_reauthorization', 'META_RATE_LIMITED', array['pages_show_list', 'pages_read_engagement', 'instagram_basic'],
  'meta_health_checked', now()
);

do $$
begin
  if not exists (
    select 1 from public.company_social_connections
    where id = '00000000-0000-0000-0000-000000005561'
      and status = 'needs_reauthorization'
      and last_error_code = 'META_RATE_LIMITED'
      and last_checked_at is not null
  ) then raise exception 'health transitions were not persisted'; end if;
  if not exists (
    select 1 from public.audit_events
    where resource_id = '00000000-0000-0000-0000-000000005561'
      and action = 'meta_health_checked'
      and resource_type = 'meta_social_connection'
      and resource_label = 'Lifecycle Page'
  ) then raise exception 'health audit did not use locked Page label'; end if;
  if not exists (
    select 1 from public.audit_events
    where resource_id = '00000000-0000-0000-0000-000000005561'
      and action = 'meta_connection_needs_reauthorization'
  ) then raise exception 'reauthorization audit missing'; end if;

  begin
    perform * from public.update_company_social_connection_health_with_audit(
      '00000000-0000-0000-0000-000000005561', '00000000-0000-0000-0000-000000005304',
      '00000000-0000-0000-0000-000000005206', 'Meta Lifecycle Admin', 'admin', 'meta-facebook-login',
      'connected', null, array['pages_show_list', 'pages_read_engagement', 'instagram_basic'],
      'meta_asset_selected', now()
    );
    raise exception 'health accepted invalid audit action';
  exception when raise_exception then
    if sqlerrm = 'health accepted invalid audit action' then raise; end if;
  end;

  begin
    perform * from public.update_company_social_connection_health_with_audit(
      '00000000-0000-0000-0000-000000005561', '00000000-0000-0000-0000-000000005304',
      '00000000-0000-0000-0000-000000005206', 'Meta Lifecycle Admin', 'admin', 'meta-facebook-login',
      'connected', null, array['pages_show_list', 'pages_read_engagement'],
      'meta_health_checked', now()
    );
    raise exception 'health accepted incomplete scopes';
  exception when raise_exception then
    if sqlerrm = 'health accepted incomplete scopes' then raise; end if;
  end;

  begin
    perform * from public.update_company_social_connection_health_with_audit(
      '00000000-0000-0000-0000-000000005561', '00000000-0000-0000-0000-000000005304',
      '00000000-0000-0000-0000-000000005206', 'Meta Lifecycle Admin', 'admin', 'meta-facebook-login',
      'connected', 'bad-code', array['pages_show_list', 'pages_read_engagement', 'instagram_basic'],
      'meta_health_checked', now()
    );
    raise exception 'health accepted non-normalized error code';
  exception when raise_exception then
    if sqlerrm = 'health accepted non-normalized error code' then raise; end if;
  end;

  begin
    perform * from public.update_company_social_connection_health_with_audit(
      '00000000-0000-0000-0000-000000005561', '00000000-0000-0000-0000-000000005304',
      '00000000-0000-0000-0000-000000005206', 'Meta Lifecycle Admin', 'admin', 'meta-facebook-login',
      'error', 'META_PROVIDER_UNAVAILABLE', array['pages_show_list', 'pages_read_engagement', 'instagram_basic'],
      'meta_health_checked', now()
    );
    raise exception 'health accepted invalid status transition';
  exception when raise_exception then
    if sqlerrm = 'health accepted invalid status transition' then raise; end if;
  end;

  begin
    perform * from public.update_company_social_connection_health_with_audit(
      '00000000-0000-0000-0000-000000005562', '00000000-0000-0000-0000-000000005304',
      '00000000-0000-0000-0000-000000005206', 'Meta Lifecycle Admin', 'admin', 'meta-facebook-login',
      'connected', null, array['pages_show_list', 'pages_read_engagement', 'instagram_basic'],
      'meta_health_checked', now()
    );
    raise exception 'health accepted revoked connection';
  exception when raise_exception then
    if sqlerrm = 'health accepted revoked connection' then raise; end if;
  end;
end;
$$;

insert into meta_sql_assertions(label) values
  ('transactional health success'),
  ('transactional needs-reauthorization transition'),
  ('transient health status preservation'),
  ('health Page label server-derived'),
  ('health invalid action rejected'),
  ('health granted scopes validated'),
  ('health normalized error code validated'),
  ('health status transition validated'),
  ('health revoked connection rejected');

create or replace function public.meta_sql_reject_health_audit()
returns trigger
language plpgsql
as $$
begin
  if new.action = 'meta_health_checked' then raise exception 'synthetic health audit failure'; end if;
  return new;
end;
$$;
create trigger meta_sql_reject_health_audit
before insert on public.audit_events
for each row execute function public.meta_sql_reject_health_audit();

do $$
declare
  before_row public.company_social_connections%rowtype;
  audit_count_before integer;
begin
  select * into before_row from public.company_social_connections
  where id = '00000000-0000-0000-0000-000000005561';
  select count(*) into audit_count_before from public.audit_events
  where resource_id = '00000000-0000-0000-0000-000000005561';

  begin
    perform * from public.update_company_social_connection_health_with_audit(
      '00000000-0000-0000-0000-000000005561', '00000000-0000-0000-0000-000000005304',
      '00000000-0000-0000-0000-000000005206', 'Meta Lifecycle Admin', 'admin', 'meta-facebook-login',
      'connected', null, array['pages_show_list', 'pages_read_engagement', 'instagram_basic'],
      'meta_health_checked', now() + interval '1 minute'
    );
    raise exception 'health unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm = 'health unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'synthetic health audit failure' then raise; end if;
  end;

  if not exists (
    select 1 from public.company_social_connections
    where id = before_row.id
      and status = before_row.status
      and last_error_code is not distinct from before_row.last_error_code
      and last_checked_at is not distinct from before_row.last_checked_at
      and granted_scopes = before_row.granted_scopes
      and updated_at is not distinct from before_row.updated_at
  ) then raise exception 'health audit failure did not roll back connection fields'; end if;
  if (select count(*) from public.audit_events where resource_id = before_row.id::text) <> audit_count_before then
    raise exception 'health audit failure retained audit row';
  end if;
end;
$$;

insert into meta_sql_assertions(label) values
  ('health audit failure surfaced'),
  ('health audit failure rolls back status'),
  ('health audit failure rolls back error'),
  ('health audit failure rolls back timestamp'),
  ('health audit failure rolls back scopes'),
  ('failed health leaves no audit row');

drop trigger meta_sql_reject_health_audit on public.audit_events;
drop function public.meta_sql_reject_health_audit();

do $$
begin
  if exists (
    select 1 from public.audit_events
    where action in ('meta_connection_started', 'meta_oauth_completed', 'meta_health_checked', 'meta_connection_needs_reauthorization')
      and concat_ws(' ', action, coalesce(resource_type, ''), resource, coalesce(resource_id, ''), resource_label, details, metadata::text)
        ~* '(encrypted-social-token-v1|meta-pending|eeeeeeeeeeeeeeee|iiiiiiiiiiiiiiii)'
  ) then raise exception 'lifecycle audit contains secret-bearing material'; end if;
end;
$$;
insert into meta_sql_assertions(label) values ('transactional lifecycle audit secret exclusion');

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
    decode(repeat('a1', 32), 'hex'), '00000000-0000-0000-0000-000000005302',
    '00000000-0000-0000-0000-000000005201', 'meta-facebook-login',
    'https://preview.example.test/auth/meta/callback'
  );
  if matched <> 0 then raise exception 'wrong company consumed state'; end if;

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
  ('state company binding'),
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
  if not exists (
    select 1 from public.audit_events
    where action = 'meta_asset_selected'
      and resource_type = 'meta_social_connection'
      and resource = 'Meta social connection'
      and resource_id = '00000000-0000-0000-0000-000000005502'
      and resource_label = 'Tenant A Page'
      and details = 'Meta connection lifecycle action completed.'
  ) then
    raise exception 'replacement audit missing';
  end if;
  if exists (
    select 1 from public.audit_events
    where concat_ws(
      ' ', action, coalesce(resource_type, ''), resource, coalesce(resource_id, ''),
      resource_label, details, metadata::text
    ) ~* '(encrypted-social-token-v1|meta-pending|aaaaaaaaaaaaaaaa)'
  ) then
    raise exception 'replacement audit contains secret-bearing material';
  end if;
end;
$$;

insert into meta_sql_assertions(label) values
  ('first atomic replacement'),
  ('replacement clears multi-actor pending states'),
  ('replacement connection tenant isolation'),
  ('replacement pending-state tenant isolation'),
  ('replacement audit atomic'),
  ('replacement audit resource contract'),
  ('replacement audit secret exclusion');

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

create or replace function public.meta_sql_reject_disconnect_audit()
returns trigger
language plpgsql
as $$
begin
  if new.action = 'meta_connection_disconnected' then
    raise exception 'synthetic audit failure';
  end if;
  return new;
end;
$$;

create trigger meta_sql_reject_disconnect_audit
before insert on public.audit_events
for each row execute function public.meta_sql_reject_disconnect_audit();

do $$
begin
  begin
    perform * from public.disconnect_company_social_connection(
      '00000000-0000-0000-0000-000000005504', '00000000-0000-0000-0000-000000005301',
      'meta-facebook-login', '00000000-0000-0000-0000-000000005201', 'Meta Admin A', 'admin', now()
    );
    raise exception 'disconnect unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm = 'disconnect unexpectedly succeeded' then raise; end if;
    if sqlerrm <> 'synthetic audit failure' then raise; end if;
  end;

  if not exists (
    select 1 from public.company_social_connections
    where id = '00000000-0000-0000-0000-000000005504'
      and status = 'connected'
      and token_envelope is not null
  ) then
    raise exception 'audit failure did not roll back connection mutation';
  end if;
  if (select count(*) from public.company_social_oauth_states where company_id = '00000000-0000-0000-0000-000000005301') <> 2 then
    raise exception 'audit failure did not roll back pending-state cleanup';
  end if;
  if exists (
    select 1 from public.audit_events
    where action = 'meta_connection_disconnected'
      and resource_id = '00000000-0000-0000-0000-000000005504'
  ) then
    raise exception 'failed disconnect retained audit row';
  end if;
end;
$$;

insert into meta_sql_assertions(label) values
  ('disconnect audit failure surfaced'),
  ('disconnect audit failure rolls back status'),
  ('disconnect audit failure rolls back token cleanup'),
  ('disconnect audit failure rolls back pending-state cleanup'),
  ('failed disconnect leaves no audit row');

drop trigger meta_sql_reject_disconnect_audit on public.audit_events;
drop function public.meta_sql_reject_disconnect_audit();

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
  if not exists (
    select 1 from public.audit_events
    where action = 'meta_connection_disconnected'
      and resource_type = 'meta_social_connection'
      and resource = 'Meta social connection'
      and resource_id = '00000000-0000-0000-0000-000000005504'
      and resource_label = 'Tenant A Different Page'
      and details = 'Meta connection lifecycle action completed.'
  ) then
    raise exception 'disconnect audit missing';
  end if;
  if exists (
    select 1 from public.audit_events
    where concat_ws(
      ' ', action, coalesce(resource_type, ''), resource, coalesce(resource_id, ''),
      resource_label, details, metadata::text
    ) ~* '(encrypted-social-token-v1|meta-pending|aaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbb|cccccccccccccccc)'
  ) then
    raise exception 'disconnect audit contains secret-bearing material';
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
  ('local disconnect audit resource contract'),
  ('local disconnect audit secret exclusion'),
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
