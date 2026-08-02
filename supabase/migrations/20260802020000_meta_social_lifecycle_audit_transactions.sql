-- META_SOCIAL_LIFECYCLE_AUDIT_SCHEMA_BEGIN
create or replace function public.create_company_social_oauth_state_with_audit(
  p_company_id uuid,
  p_actor_auth_user_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider text,
  p_state_hash bytea,
  p_redirect_uri text,
  p_return_path text,
  p_expires_at timestamptz,
  p_timestamp timestamptz
)
returns setof public.company_social_oauth_states
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_state public.company_social_oauth_states%rowtype;
begin
  if p_provider <> 'meta-facebook-login'
    or octet_length(p_state_hash) <> 32
    or p_redirect_uri <> 'https://servicescope-inky.vercel.app/auth/meta/callback'
    or p_return_path <> '/settings/social-connections'
    or p_expires_at <= p_timestamp
    or p_expires_at > p_timestamp + interval '10 minutes' then
    raise exception 'invalid OAuth state request';
  end if;

  insert into public.company_social_oauth_states (
    company_id, actor_auth_user_id, provider, state_hash, redirect_uri,
    return_path, expires_at, created_at, updated_at
  ) values (
    p_company_id, p_actor_auth_user_id, p_provider, p_state_hash, p_redirect_uri,
    p_return_path, p_expires_at, p_timestamp, p_timestamp
  )
  returning * into created_state;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details
  ) values (
    p_company_id, p_actor_auth_user_id, p_actor_name, p_actor_role, 'access',
    'meta_connection_started', 'meta_social_authorization', 'Meta social connection',
    created_state.id::text, 'Meta authorization',
    'Meta connection lifecycle action completed.'
  );

  return next created_state;
end;
$$;

create or replace function public.save_company_social_oauth_discovery_with_audit(
  p_oauth_state_id uuid,
  p_company_id uuid,
  p_actor_auth_user_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider text,
  p_encrypted_pending_token_bundle jsonb,
  p_discovered_assets jsonb,
  p_timestamp timestamptz
)
returns setof public.company_social_oauth_states
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_state public.company_social_oauth_states%rowtype;
  updated_state public.company_social_oauth_states%rowtype;
begin
  if p_provider <> 'meta-facebook-login'
    or p_encrypted_pending_token_bundle is null
    or p_discovered_assets is null
    or jsonb_typeof(p_discovered_assets) <> 'array' then
    raise exception 'invalid OAuth discovery request';
  end if;

  select * into locked_state
  from public.company_social_oauth_states
  where id = p_oauth_state_id
    and company_id = p_company_id
    and actor_auth_user_id = p_actor_auth_user_id
    and provider = p_provider
  for update;

  if not found
    or locked_state.consumed_at is null
    or locked_state.expires_at <= p_timestamp
    or locked_state.encrypted_pending_token_bundle is not null
    or locked_state.discovered_assets is not null then
    raise exception 'invalid OAuth discovery state';
  end if;

  update public.company_social_oauth_states
  set encrypted_pending_token_bundle = p_encrypted_pending_token_bundle,
      discovered_assets = p_discovered_assets,
      updated_at = p_timestamp
  where id = locked_state.id
  returning * into updated_state;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details
  ) values (
    p_company_id, p_actor_auth_user_id, p_actor_name, p_actor_role, 'access',
    'meta_oauth_completed', 'meta_social_authorization', 'Meta social connection',
    updated_state.id::text, 'Meta authorization',
    'Meta connection lifecycle action completed.'
  );

  return next updated_state;
end;
$$;

create or replace function public.update_company_social_connection_health_with_audit(
  p_connection_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider text,
  p_status text,
  p_last_error_code text,
  p_granted_scopes text[],
  p_audit_action text,
  p_timestamp timestamptz
)
returns setof public.company_social_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_connection public.company_social_connections%rowtype;
  updated_connection public.company_social_connections%rowtype;
begin
  if p_provider <> 'meta-facebook-login'
    or p_audit_action not in ('meta_health_checked', 'meta_connection_needs_reauthorization')
    or p_status not in ('connected', 'needs_reauthorization', 'error')
    or p_granted_scopes is null
    or not (array['pages_show_list', 'pages_read_engagement', 'instagram_basic']::text[] <@ p_granted_scopes)
    or not (p_granted_scopes <@ array['pages_show_list', 'pages_read_engagement', 'instagram_basic']::text[])
    or (p_last_error_code is not null and p_last_error_code !~ '^[A-Z0-9_]{2,80}$') then
    raise exception 'invalid health update request';
  end if;

  select * into locked_connection
  from public.company_social_connections
  where id = p_connection_id
    and company_id = p_company_id
    and provider = p_provider
  for update;

  if not found
    or locked_connection.status = 'revoked'
    or locked_connection.status not in ('connected', 'needs_reauthorization', 'error')
    or (p_status <> locked_connection.status and p_status not in ('connected', 'needs_reauthorization'))
    or (p_audit_action = 'meta_connection_needs_reauthorization'
      and (p_status <> 'needs_reauthorization' or p_last_error_code is null)) then
    raise exception 'invalid health transition';
  end if;

  update public.company_social_connections
  set status = p_status,
      last_checked_at = p_timestamp,
      last_error_code = p_last_error_code,
      granted_scopes = p_granted_scopes,
      updated_at = p_timestamp
  where id = locked_connection.id
  returning * into updated_connection;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details
  ) values (
    p_company_id, p_actor_id, p_actor_name, p_actor_role, 'access', p_audit_action,
    'meta_social_connection', 'Meta social connection', updated_connection.id::text,
    locked_connection.facebook_page_name, 'Meta connection lifecycle action completed.'
  );

  return next updated_connection;
end;
$$;

revoke all on function public.create_company_social_oauth_state_with_audit(uuid, uuid, text, text, text, bytea, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.save_company_social_oauth_discovery_with_audit(uuid, uuid, uuid, text, text, text, jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.update_company_social_connection_health_with_audit(uuid, uuid, uuid, text, text, text, text, text, text[], text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_company_social_oauth_state_with_audit(uuid, uuid, text, text, text, bytea, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.save_company_social_oauth_discovery_with_audit(uuid, uuid, uuid, text, text, text, jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.update_company_social_connection_health_with_audit(uuid, uuid, uuid, text, text, text, text, text, text[], text, timestamptz) to service_role;

comment on function public.create_company_social_oauth_state_with_audit(uuid, uuid, text, text, text, bytea, text, text, timestamptz, timestamptz) is
  'Creates a bounded Meta OAuth state and its fixed-label lifecycle audit atomically. Service role only.';
comment on function public.save_company_social_oauth_discovery_with_audit(uuid, uuid, uuid, text, text, text, jsonb, jsonb, timestamptz) is
  'Saves consumed Meta OAuth discovery material and its fixed-label lifecycle audit atomically. Service role only.';
comment on function public.update_company_social_connection_health_with_audit(uuid, uuid, uuid, text, text, text, text, text, text[], text, timestamptz) is
  'Updates a locked Meta connection health state and writes a server-derived-label lifecycle audit atomically. Service role only.';
-- META_SOCIAL_LIFECYCLE_AUDIT_SCHEMA_END
