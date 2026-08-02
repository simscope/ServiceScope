-- META_SOCIAL_OAUTH_STATE_TTL_SCHEMA_BEGIN
alter table public.company_social_oauth_states
  drop constraint company_social_oauth_states_expiry_check;

alter table public.company_social_oauth_states
  add constraint company_social_oauth_states_expiry_check
  check (
    expires_at > created_at
    and expires_at <= created_at + interval '30 minutes'
  );

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
    or p_expires_at > p_timestamp + interval '30 minutes' then
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

revoke all on function public.create_company_social_oauth_state_with_audit(uuid, uuid, text, text, text, bytea, text, text, timestamptz, timestamptz) from public;
revoke all on function public.create_company_social_oauth_state_with_audit(uuid, uuid, text, text, text, bytea, text, text, timestamptz, timestamptz) from anon;
revoke all on function public.create_company_social_oauth_state_with_audit(uuid, uuid, text, text, text, bytea, text, text, timestamptz, timestamptz) from authenticated;
grant execute on function public.create_company_social_oauth_state_with_audit(uuid, uuid, text, text, text, bytea, text, text, timestamptz, timestamptz) to service_role;

comment on function public.create_company_social_oauth_state_with_audit(uuid, uuid, text, text, text, bytea, text, text, timestamptz, timestamptz) is
  'Creates a bounded 30-minute Meta OAuth state and its fixed-label lifecycle audit atomically. Service role only.';
-- META_SOCIAL_OAUTH_STATE_TTL_SCHEMA_END
