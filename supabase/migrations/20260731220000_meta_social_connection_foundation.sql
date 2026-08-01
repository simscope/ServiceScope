-- META_SOCIAL_CONNECTION_SCHEMA_BEGIN
create table public.company_social_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null,
  status text not null default 'pending_asset_selection',
  facebook_page_id text,
  facebook_page_name text,
  instagram_account_id text,
  instagram_username text,
  instagram_account_type text,
  granted_scopes text[] not null default '{}'::text[],
  token_envelope jsonb,
  token_expires_at timestamptz,
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz,
  last_checked_at timestamptz,
  last_error_code text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_social_connections_provider_check
    check (provider = 'meta-facebook-login'),
  constraint company_social_connections_status_check
    check (status in ('pending_asset_selection', 'connected', 'needs_reauthorization', 'error', 'revoked')),
  constraint company_social_connections_page_shape_check
    check (
      (status = 'pending_asset_selection' and facebook_page_id is null and facebook_page_name is null)
      or (status <> 'pending_asset_selection' and facebook_page_id is not null and facebook_page_name is not null)
    ),
  constraint company_social_connections_instagram_shape_check
    check (
      (instagram_account_id is null and instagram_username is null and instagram_account_type is null)
      or (
        instagram_account_id is not null
        and instagram_username is not null
        and instagram_account_type in ('BUSINESS', 'CREATOR')
      )
    ),
  constraint company_social_connections_scopes_check
    check (
      granted_scopes <@ array['pages_show_list', 'pages_read_engagement', 'instagram_basic']::text[]
      and array_position(granted_scopes, null) is null
    ),
  constraint company_social_connections_token_state_check
    check (
      (status in ('connected', 'needs_reauthorization', 'error') and token_envelope is not null)
      or (status in ('pending_asset_selection', 'revoked') and token_envelope is null)
    ),
  constraint company_social_connections_token_envelope_shape_check
    check (
      token_envelope is null or (
        jsonb_typeof(token_envelope) = 'object'
        and token_envelope ?& array['schemaVersion', 'algorithm', 'keyVersion', 'purpose', 'iv', 'ciphertext']
        and token_envelope ->> 'schemaVersion' = 'encrypted-social-token-v1'
        and token_envelope ->> 'algorithm' = 'AES-GCM'
        and token_envelope ->> 'purpose' = 'meta-connection'
        and jsonb_typeof(token_envelope -> 'keyVersion') = 'number'
        and token_envelope ->> 'keyVersion' = '1'
        and token_envelope ->> 'iv' ~ '^[A-Za-z0-9_-]+$'
        and length(token_envelope ->> 'iv') between 16 and 128
        and token_envelope ->> 'ciphertext' ~ '^[A-Za-z0-9_-]+$'
        and length(token_envelope ->> 'ciphertext') between 23 and 32768
        and token_envelope - 'schemaVersion' - 'algorithm' - 'keyVersion' - 'purpose' - 'iv' - 'ciphertext' = '{}'::jsonb
      )
    ),
  constraint company_social_connections_error_code_check
    check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{2,80}$')
);

create unique index company_social_connections_active_provider_unique
  on public.company_social_connections (company_id, provider)
  where status <> 'revoked';

create index company_social_connections_company_status_idx
  on public.company_social_connections (company_id, status, updated_at desc);

create table public.company_social_oauth_states (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_auth_user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  state_hash bytea not null unique,
  redirect_uri text not null,
  return_path text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  encrypted_pending_token_bundle jsonb,
  discovered_assets jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_social_oauth_states_provider_check
    check (provider = 'meta-facebook-login'),
  constraint company_social_oauth_states_hash_check
    check (octet_length(state_hash) = 32),
  constraint company_social_oauth_states_redirect_check
    check (redirect_uri ~ '^https://[^[:space:]]+$' or redirect_uri ~ '^http://127\\.0\\.0\\.1(:[0-9]+)?/[^[:space:]]*$'),
  constraint company_social_oauth_states_return_path_check
    check (return_path = '/settings/social-connections'),
  constraint company_social_oauth_states_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  constraint company_social_oauth_states_assets_check
    check (discovered_assets is null or jsonb_typeof(discovered_assets) = 'array'),
  constraint company_social_oauth_states_pending_shape_check
    check (
      (encrypted_pending_token_bundle is null and discovered_assets is null)
      or (consumed_at is not null and encrypted_pending_token_bundle is not null and discovered_assets is not null)
    ),
  constraint company_social_oauth_states_pending_envelope_shape_check
    check (
      encrypted_pending_token_bundle is null or (
        jsonb_typeof(encrypted_pending_token_bundle) = 'object'
        and encrypted_pending_token_bundle ?& array['schemaVersion', 'algorithm', 'keyVersion', 'purpose', 'iv', 'ciphertext']
        and encrypted_pending_token_bundle ->> 'schemaVersion' = 'encrypted-social-token-v1'
        and encrypted_pending_token_bundle ->> 'algorithm' = 'AES-GCM'
        and encrypted_pending_token_bundle ->> 'purpose' = 'meta-pending'
        and jsonb_typeof(encrypted_pending_token_bundle -> 'keyVersion') = 'number'
        and encrypted_pending_token_bundle ->> 'keyVersion' = '1'
        and encrypted_pending_token_bundle ->> 'iv' ~ '^[A-Za-z0-9_-]+$'
        and length(encrypted_pending_token_bundle ->> 'iv') between 16 and 128
        and encrypted_pending_token_bundle ->> 'ciphertext' ~ '^[A-Za-z0-9_-]+$'
        and length(encrypted_pending_token_bundle ->> 'ciphertext') between 23 and 32768
        and encrypted_pending_token_bundle - 'schemaVersion' - 'algorithm' - 'keyVersion' - 'purpose' - 'iv' - 'ciphertext' = '{}'::jsonb
      )
    )
);

create index company_social_oauth_states_company_actor_idx
  on public.company_social_oauth_states (company_id, actor_auth_user_id, created_at desc);

create index company_social_oauth_states_expiry_idx
  on public.company_social_oauth_states (expires_at);

alter table public.company_social_connections enable row level security;
alter table public.company_social_oauth_states enable row level security;

revoke all on public.company_social_connections from public, anon, authenticated;
revoke all on public.company_social_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on public.company_social_connections to service_role;
grant select, insert, update, delete on public.company_social_oauth_states to service_role;

create or replace function public.consume_company_social_oauth_state(
  p_state_hash bytea,
  p_company_id uuid,
  p_actor_auth_user_id uuid,
  p_provider text,
  p_redirect_uri text
)
returns setof public.company_social_oauth_states
language sql
security definer
set search_path = ''
as $$
  update public.company_social_oauth_states
  set consumed_at = clock_timestamp(), updated_at = clock_timestamp()
  where state_hash = p_state_hash
    and company_id = p_company_id
    and actor_auth_user_id = p_actor_auth_user_id
    and provider = p_provider
    and redirect_uri = p_redirect_uri
    and consumed_at is null
    and expires_at > clock_timestamp()
  returning *;
$$;

create or replace function public.cleanup_company_social_oauth_states(
  p_company_id uuid,
  p_provider text,
  p_now timestamptz,
  p_limit integer default 50
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if p_provider <> 'meta-facebook-login' or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid cleanup request';
  end if;
  with doomed as (
    select id
    from public.company_social_oauth_states
    where company_id = p_company_id
      and provider = p_provider
      and expires_at <= p_now
    order by expires_at, id
    limit p_limit
    for update skip locked
  ), deleted as (
    delete from public.company_social_oauth_states state
    using doomed
    where state.id = doomed.id
    returning state.id
  )
  select count(*)::integer into deleted_count from deleted;
  return deleted_count;
end;
$$;

create or replace function public.replace_company_social_connection(
  p_connection_id uuid,
  p_company_id uuid,
  p_provider text,
  p_facebook_page_id text,
  p_facebook_page_name text,
  p_instagram_account_id text,
  p_instagram_username text,
  p_instagram_account_type text,
  p_granted_scopes text[],
  p_token_envelope jsonb,
  p_token_expires_at timestamptz,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_timestamp timestamptz
)
returns setof public.company_social_connections
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_provider <> 'meta-facebook-login'
    or p_facebook_page_id !~ '^[0-9]{1,40}$'
    or p_facebook_page_name is null
    or length(p_facebook_page_name) not between 1 and 120
    or p_granted_scopes is null
    or not (array['pages_show_list', 'pages_read_engagement', 'instagram_basic']::text[] <@ p_granted_scopes)
    or not (p_granted_scopes <@ array['pages_show_list', 'pages_read_engagement', 'instagram_basic']::text[])
    or p_token_envelope is null then
    raise exception 'invalid replacement request';
  end if;

  perform 1 from public.companies where id = p_company_id for update;
  if not found then raise exception 'company not found'; end if;

  update public.company_social_connections
  set status = 'revoked', token_envelope = null, revoked_at = p_timestamp,
      last_error_code = null, updated_at = p_timestamp
  where company_id = p_company_id and provider = p_provider and status <> 'revoked';

  insert into public.company_social_connections (
    id, company_id, provider, status, facebook_page_id, facebook_page_name,
    instagram_account_id, instagram_username, instagram_account_type,
    granted_scopes, token_envelope, token_expires_at, connected_by,
    connected_at, last_error_code, revoked_at, created_at, updated_at
  ) values (
    p_connection_id, p_company_id, p_provider, 'connected', p_facebook_page_id, p_facebook_page_name,
    p_instagram_account_id, p_instagram_username, p_instagram_account_type,
    p_granted_scopes, p_token_envelope, p_token_expires_at, p_actor_id,
    p_timestamp, null, null, p_timestamp, p_timestamp
  );

  delete from public.company_social_oauth_states
  where company_id = p_company_id and provider = p_provider;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action, resource, resource_id, details
  ) values (
    p_company_id, p_actor_id, p_actor_name, p_actor_role, 'access', 'meta_asset_selected',
    'Meta social connection', p_connection_id::text, 'Meta connection lifecycle action completed.'
  );

  return query select * from public.company_social_connections where id = p_connection_id;
end;
$$;

create or replace function public.disconnect_company_social_connection(
  p_connection_id uuid,
  p_company_id uuid,
  p_provider text,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_timestamp timestamptz
)
returns setof public.company_social_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  disconnected public.company_social_connections%rowtype;
begin
  if p_provider <> 'meta-facebook-login' then raise exception 'invalid provider'; end if;
  perform 1 from public.companies where id = p_company_id for update;
  if not found then raise exception 'company not found'; end if;

  update public.company_social_connections
  set status = 'revoked', token_envelope = null, revoked_at = p_timestamp,
      last_error_code = null, last_checked_at = p_timestamp, updated_at = p_timestamp
  where id = p_connection_id and company_id = p_company_id and provider = p_provider and status <> 'revoked'
  returning * into disconnected;
  if not found then return; end if;

  delete from public.company_social_oauth_states
  where company_id = p_company_id and provider = p_provider;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action, resource, resource_id, details
  ) values (
    p_company_id, p_actor_id, p_actor_name, p_actor_role, 'access', 'meta_connection_disconnected',
    'Meta social connection', p_connection_id::text, 'Meta connection lifecycle action completed.'
  );

  return next disconnected;
end;
$$;

revoke all on function public.consume_company_social_oauth_state(bytea, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.cleanup_company_social_oauth_states(uuid, text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.replace_company_social_connection(uuid, uuid, text, text, text, text, text, text, text[], jsonb, timestamptz, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.disconnect_company_social_connection(uuid, uuid, text, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.consume_company_social_oauth_state(bytea, uuid, uuid, text, text) to service_role;
grant execute on function public.cleanup_company_social_oauth_states(uuid, text, timestamptz, integer) to service_role;
grant execute on function public.replace_company_social_connection(uuid, uuid, text, text, text, text, text, text, text[], jsonb, timestamptz, uuid, text, text, timestamptz) to service_role;
grant execute on function public.disconnect_company_social_connection(uuid, uuid, text, uuid, text, text, timestamptz) to service_role;

comment on table public.company_social_connections is
  'Server-only Meta connection records. Browser roles have no direct access to encrypted token material.';
comment on table public.company_social_oauth_states is
  'Server-only one-time OAuth state hashes and short-lived pending encrypted authorization bundles.';
comment on column public.company_social_connections.token_envelope is
  'Versioned and context-bound AES-256-GCM envelope. Never return this column to browser clients or telemetry.';
comment on column public.company_social_oauth_states.state_hash is
  'SHA-256 hash of the one-time OAuth state. Raw OAuth state is never stored.';
comment on function public.disconnect_company_social_connection(uuid, uuid, text, uuid, text, text, timestamptz) is
  'Company-local disconnect only. Global Meta deauthorization is intentionally deferred.';
-- META_SOCIAL_CONNECTION_SCHEMA_END
