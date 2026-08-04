-- META_FACEBOOK_PUBLISH_SCHEMA_BEGIN
alter table public.company_social_connections
  drop constraint company_social_connections_scopes_check;

alter table public.company_social_connections
  add constraint company_social_connections_scopes_check
  check (
    granted_scopes <@ array[
      'pages_show_list',
      'pages_read_engagement',
      'instagram_basic',
      'pages_manage_posts'
    ]::text[]
    and array_position(granted_scopes, null) is null
  );

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
    or not (p_granted_scopes <@ array['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'pages_manage_posts']::text[])
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
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details
  ) values (
    p_company_id, p_actor_id, p_actor_name, p_actor_role, 'access', 'meta_asset_selected',
    'meta_social_connection', 'Meta social connection', p_connection_id::text,
    p_facebook_page_name, 'Meta connection lifecycle action completed.'
  );

  return query select * from public.company_social_connections where id = p_connection_id;
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
    or not (p_granted_scopes <@ array['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'pages_manage_posts']::text[])
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

create table public.company_social_publications (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null references public.company_social_connections(id) on delete restrict,
  job_id uuid not null references public.jobs(id) on delete restrict,
  provider text not null,
  channel text not null,
  status text not null,
  idempotency_key uuid not null,
  approved_message text not null,
  message_sha256 bytea not null,
  provider_post_id text,
  attempts smallint not null default 0,
  provider_http_status integer,
  provider_error_code integer,
  provider_error_subcode integer,
  provider_error_category text,
  provider_is_transient boolean,
  last_error_code text,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null,
  published_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint company_social_publications_provider_check
    check (provider = 'meta-facebook-login'),
  constraint company_social_publications_channel_check
    check (channel = 'Facebook'),
  constraint company_social_publications_status_check
    check (status in ('publishing', 'published', 'failed', 'delivery_unknown')),
  constraint company_social_publications_message_check
    check (
      approved_message = btrim(approved_message)
      and char_length(approved_message) between 1 and 5000
      and translate(approved_message, E'\n', '') !~ '[[:cntrl:]]'
      and lower(approved_message) not like '%[private]%'
    ),
  constraint company_social_publications_message_hash_check
    check (octet_length(message_sha256) = 32),
  constraint company_social_publications_attempts_check
    check (attempts between 0 and 1),
  constraint company_social_publications_http_status_check
    check (provider_http_status is null or provider_http_status between 100 and 599),
  constraint company_social_publications_error_code_check
    check (provider_error_code is null or provider_error_code between -2147483648 and 2147483647),
  constraint company_social_publications_error_subcode_check
    check (provider_error_subcode is null or provider_error_subcode between -2147483648 and 2147483647),
  constraint company_social_publications_error_category_check
    check (provider_error_category is null or provider_error_category in (
      'INVALID_TOKEN',
      'MISSING_PERMISSION',
      'PAGE_UNAVAILABLE',
      'RATE_LIMITED',
      'PROVIDER_TEMPORARY_ERROR',
      'PROVIDER_REJECTED',
      'DELIVERY_UNKNOWN',
      'RESPONSE_MISSING_POST_ID'
    )),
  constraint company_social_publications_last_error_code_check
    check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{2,80}$'),
  constraint company_social_publications_provider_post_id_check
    check (provider_post_id is null or (
      char_length(provider_post_id) between 1 and 200
      and provider_post_id !~ '[[:cntrl:]]'
    )),
  constraint company_social_publications_state_shape_check
    check (
      (status = 'publishing'
        and attempts = 0
        and provider_post_id is null
        and published_at is null
        and provider_http_status is null
        and provider_error_code is null
        and provider_error_subcode is null
        and provider_error_category is null
        and provider_is_transient is null
        and last_error_code is null)
      or (status = 'published'
        and attempts = 1
        and provider_post_id is not null
        and published_at is not null
        and provider_http_status is null
        and provider_error_code is null
        and provider_error_subcode is null
        and provider_error_category is null
        and provider_is_transient is null
        and last_error_code is null)
      or (status = 'failed'
        and attempts = 1
        and provider_post_id is null
        and published_at is null
        and provider_error_category is not null
        and last_error_code is not null)
      or (status = 'delivery_unknown'
        and attempts = 1
        and provider_post_id is null
        and published_at is null
        and provider_error_category = 'DELIVERY_UNKNOWN'
        and last_error_code = 'META_PUBLICATION_DELIVERY_UNKNOWN')
    )
);

create unique index company_social_publications_company_idempotency_unique
  on public.company_social_publications (company_id, idempotency_key);

create index company_social_publications_company_created_idx
  on public.company_social_publications (company_id, created_at desc);

alter table public.company_social_publications enable row level security;
revoke all on public.company_social_publications from public, anon, authenticated;
grant select, insert, update on public.company_social_publications to service_role;

create or replace function public.begin_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_job_id uuid,
  p_idempotency_key uuid,
  p_approved_message text,
  p_message_sha256 bytea,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_timestamp timestamptz
)
returns table (
  publication_id uuid,
  publication_status text,
  publication_approved_at timestamptz,
  publication_published_at timestamptz,
  publication_last_error_code text,
  publication_provider_http_status integer,
  publication_provider_error_code integer,
  publication_provider_error_subcode integer,
  publication_provider_error_category text,
  publication_provider_is_transient boolean,
  should_publish boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_publication public.company_social_publications%rowtype;
  selected_connection public.company_social_connections%rowtype;
  created_publication public.company_social_publications%rowtype;
begin
  if p_approved_message is null
    or p_approved_message <> btrim(p_approved_message)
    or char_length(p_approved_message) not between 1 and 5000
    or translate(p_approved_message, E'\n', '') ~ '[[:cntrl:]]'
    or lower(p_approved_message) like '%[private]%'
    or octet_length(p_message_sha256) <> 32
    or p_message_sha256 <> sha256(convert_to(p_approved_message, 'UTF8'))
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80 then
    raise exception 'invalid publication request';
  end if;

  perform 1 from public.companies where id = p_company_id for update;
  if not found then raise exception 'company not found'; end if;

  select * into existing_publication
  from public.company_social_publications
  where company_id = p_company_id and idempotency_key = p_idempotency_key;

  if found then
    if existing_publication.connection_id <> p_connection_id
      or existing_publication.job_id <> p_job_id
      or existing_publication.approved_by <> p_actor_id
      or existing_publication.approved_message <> p_approved_message
      or existing_publication.message_sha256 <> p_message_sha256 then
      raise exception 'idempotency payload mismatch';
    end if;
    return query select
      existing_publication.id,
      existing_publication.status,
      existing_publication.approved_at,
      existing_publication.published_at,
      existing_publication.last_error_code,
      existing_publication.provider_http_status,
      existing_publication.provider_error_code,
      existing_publication.provider_error_subcode,
      existing_publication.provider_error_category,
      existing_publication.provider_is_transient,
      false;
    return;
  end if;

  perform 1 from public.jobs
  where id = p_job_id
    and company_id = p_company_id
    and status::text in ('Completed', 'Warranty')
  for update;
  if not found then raise exception 'invalid publication job'; end if;

  select * into selected_connection
  from public.company_social_connections
  where id = p_connection_id
    and company_id = p_company_id
    and provider = 'meta-facebook-login'
  for update;

  if not found
    or selected_connection.status <> 'connected'
    or selected_connection.facebook_page_id is null
    or selected_connection.facebook_page_name is null
    or selected_connection.token_envelope is null
    or not ('pages_manage_posts' = any(selected_connection.granted_scopes)) then
    raise exception 'facebook publishing unavailable';
  end if;

  insert into public.company_social_publications (
    id, company_id, connection_id, job_id, provider, channel, status,
    idempotency_key, approved_message, message_sha256, approved_by,
    approved_at, created_at, updated_at
  ) values (
    p_publication_id, p_company_id, p_connection_id, p_job_id,
    'meta-facebook-login', 'Facebook', 'publishing', p_idempotency_key,
    p_approved_message, p_message_sha256, p_actor_id,
    p_timestamp, p_timestamp, p_timestamp
  )
  returning * into created_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_started', 'meta_social_publication', 'Facebook publication',
    created_publication.id::text, 'Facebook publication',
    'Meta publication lifecycle action completed.',
    jsonb_build_object(
      'channel', 'Facebook',
      'status', 'publishing',
      'messageCharacterCount', char_length(p_approved_message),
      'attempts', 0
    )
  );

  return query select
    created_publication.id,
    created_publication.status,
    created_publication.approved_at,
    created_publication.published_at,
    created_publication.last_error_code,
    created_publication.provider_http_status,
    created_publication.provider_error_code,
    created_publication.provider_error_subcode,
    created_publication.provider_error_category,
    created_publication.provider_is_transient,
    true;
end;
$$;

create or replace function public.complete_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider_post_id text,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
begin
  if p_provider_post_id is null
    or char_length(btrim(p_provider_post_id)) not between 1 and 200
    or p_provider_post_id ~ '[[:cntrl:]]'
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80 then
    raise exception 'invalid provider post id';
  end if;

  select * into locked_publication
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id
  for update;
  if not found or locked_publication.status <> 'publishing' then
    raise exception 'invalid publication transition';
  end if;

  update public.company_social_publications
  set status = 'published', provider_post_id = btrim(p_provider_post_id), attempts = 1,
      provider_http_status = null, provider_error_code = null,
      provider_error_subcode = null, provider_error_category = null,
      provider_is_transient = null, last_error_code = null,
      published_at = p_timestamp, updated_at = p_timestamp
  where id = locked_publication.id
  returning * into updated_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_published', 'meta_social_publication', 'Facebook publication',
    updated_publication.id::text, 'Facebook publication',
    'Meta publication lifecycle action completed.',
    jsonb_build_object(
      'channel', 'Facebook', 'status', 'published',
      'messageCharacterCount', char_length(updated_publication.approved_message),
      'attempts', 1
    )
  );
  return next updated_publication;
end;
$$;

create or replace function public.fail_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider_http_status integer,
  p_provider_error_code integer,
  p_provider_error_subcode integer,
  p_provider_error_category text,
  p_provider_is_transient boolean,
  p_last_error_code text,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
begin
  if p_provider_error_category not in (
      'INVALID_TOKEN', 'MISSING_PERMISSION', 'PAGE_UNAVAILABLE', 'RATE_LIMITED',
      'PROVIDER_TEMPORARY_ERROR', 'PROVIDER_REJECTED', 'RESPONSE_MISSING_POST_ID'
    )
    or p_last_error_code is null
    or p_last_error_code !~ '^[A-Z0-9_]{2,80}$'
    or (p_provider_http_status is not null and p_provider_http_status not between 100 and 599)
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80 then
    raise exception 'invalid publication failure';
  end if;

  select * into locked_publication
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id
  for update;
  if not found or locked_publication.status <> 'publishing' then
    raise exception 'invalid publication transition';
  end if;

  update public.company_social_publications
  set status = 'failed', attempts = 1, provider_post_id = null,
      provider_http_status = p_provider_http_status,
      provider_error_code = p_provider_error_code,
      provider_error_subcode = p_provider_error_subcode,
      provider_error_category = p_provider_error_category,
      provider_is_transient = p_provider_is_transient,
      last_error_code = p_last_error_code,
      published_at = null, updated_at = p_timestamp
  where id = locked_publication.id
  returning * into updated_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_failed', 'meta_social_publication', 'Facebook publication',
    updated_publication.id::text, 'Facebook publication',
    'Meta publication lifecycle action completed.',
    jsonb_build_object(
      'channel', 'Facebook', 'status', 'failed',
      'messageCharacterCount', char_length(updated_publication.approved_message),
      'attempts', 1
    )
  );
  return next updated_publication;
end;
$$;

create or replace function public.mark_company_facebook_publication_unknown(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
begin
  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80 then
    raise exception 'invalid publication actor';
  end if;

  select * into locked_publication
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id
  for update;
  if not found or locked_publication.status <> 'publishing' then
    raise exception 'invalid publication transition';
  end if;

  update public.company_social_publications
  set status = 'delivery_unknown', attempts = 1, provider_post_id = null,
      provider_http_status = null, provider_error_code = null,
      provider_error_subcode = null, provider_error_category = 'DELIVERY_UNKNOWN',
      provider_is_transient = null,
      last_error_code = 'META_PUBLICATION_DELIVERY_UNKNOWN',
      published_at = null, updated_at = p_timestamp
  where id = locked_publication.id
  returning * into updated_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_delivery_unknown', 'meta_social_publication', 'Facebook publication',
    updated_publication.id::text, 'Facebook publication',
    'Meta publication lifecycle action completed.',
    jsonb_build_object(
      'channel', 'Facebook', 'status', 'delivery_unknown',
      'messageCharacterCount', char_length(updated_publication.approved_message),
      'attempts', 1
    )
  );
  return next updated_publication;
end;
$$;

revoke all on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated;

grant execute on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, uuid, text, text, timestamptz) to service_role;
grant execute on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, timestamptz) to service_role;
grant execute on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, timestamptz) to service_role;

comment on table public.company_social_publications is
  'Server-only Facebook Page text publication history. Browser roles have no direct access.';
comment on column public.company_social_publications.approved_message is
  'Exact human-approved normalized text. Never expose through status or telemetry.';
comment on column public.company_social_publications.provider_post_id is
  'Server-only Meta post identifier. Never return to browser clients.';
comment on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, uuid, text, text, timestamptz) is
  'Validates and begins one idempotent Facebook Page text publication with an atomic safe audit.';
comment on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, timestamptz) is
  'Marks an exact publishing row published and writes its safe audit atomically.';
comment on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, timestamptz) is
  'Marks a definite provider rejection failed using normalized diagnostics and a safe atomic audit.';
comment on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, timestamptz) is
  'Marks an indeterminate provider delivery result without retry and writes its safe audit atomically.';
-- META_FACEBOOK_PUBLISH_SCHEMA_END
