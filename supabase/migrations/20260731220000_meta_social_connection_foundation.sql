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
  constraint company_social_connections_error_code_check
    check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{2,80}$')
);

create unique index company_social_connections_active_asset_unique
  on public.company_social_connections (company_id, provider, facebook_page_id)
  where status <> 'revoked' and facebook_page_id is not null;

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
    check (return_path in ('/settings/social-connections')),
  constraint company_social_oauth_states_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  constraint company_social_oauth_states_assets_check
    check (discovered_assets is null or jsonb_typeof(discovered_assets) = 'array'),
  constraint company_social_oauth_states_pending_shape_check
    check (
      (encrypted_pending_token_bundle is null and discovered_assets is null)
      or (consumed_at is not null and encrypted_pending_token_bundle is not null and discovered_assets is not null)
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

revoke all on function public.consume_company_social_oauth_state(bytea, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.consume_company_social_oauth_state(bytea, uuid, uuid, text, text) to service_role;

comment on table public.company_social_connections is
  'Server-only Meta connection records. Browser roles have no direct access to encrypted token material.';
comment on table public.company_social_oauth_states is
  'Server-only one-time OAuth state hashes and short-lived pending encrypted authorization bundles.';
comment on column public.company_social_connections.token_envelope is
  'Versioned AES-256-GCM envelope. Never return this column to browser clients or telemetry.';
comment on column public.company_social_oauth_states.state_hash is
  'SHA-256 hash of the one-time OAuth state. Raw OAuth state is never stored.';
