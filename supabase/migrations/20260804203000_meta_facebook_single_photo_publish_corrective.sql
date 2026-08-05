-- META_FACEBOOK_SINGLE_PHOTO_PUBLISH_CORRECTIVE_BEGIN
alter table public.company_social_publications
  add column if not exists publication_intent_sha256 bytea;

update public.company_social_publications
set publication_intent_sha256 = sha256(convert_to(concat_ws(E'\n',
  'facebook_publication_intent_v1',
  'meta-facebook-login',
  'Facebook',
  company_id::text,
  job_id::text,
  connection_id::text,
  approved_by::text,
  coalesce(publication_kind, 'text_only'),
  approved_message,
  case when coalesce(publication_kind, 'text_only') = 'single_photo' then attachment_id::text else '' end
), 'UTF8'))
where publication_intent_sha256 is null;

alter table public.company_social_publications
  alter column publication_intent_sha256 set not null,
  add constraint company_social_publications_intent_sha256_check
    check (octet_length(publication_intent_sha256) = 32);

create unique index if not exists company_social_publications_company_intent_unique
  on public.company_social_publications (company_id, publication_intent_sha256);

alter table public.company_social_publications
  drop constraint if exists company_social_publications_media_count_check,
  add constraint company_social_publications_media_count_check
  check (
    (publication_kind = 'text_only' and media_count = 0 and attachment_id is null and safe_mime_type is null)
    or (publication_kind = 'single_photo' and media_count = 1 and attachment_id is not null and safe_mime_type in ('image/jpeg', 'image/png'))
  );

create table if not exists public.company_social_publication_media_approvals (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  attachment_id uuid not null references public.job_attachments(id) on delete restrict,
  analysis_run_id uuid,
  approval_status text not null,
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null,
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  approval_reason text,
  attachment_sha256 bytea not null,
  attachment_mime_type text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_social_publication_media_approvals_status_check
    check (approval_status in ('approved', 'revoked')),
  constraint company_social_publication_media_approvals_sha256_check
    check (octet_length(attachment_sha256) = 32),
  constraint company_social_publication_media_approvals_mime_check
    check (attachment_mime_type in ('image/jpeg', 'image/png')),
  constraint company_social_publication_media_approvals_reason_check
    check (approval_reason is null or (char_length(approval_reason) <= 240 and approval_reason !~ '[[:cntrl:]<>]')),
  constraint company_social_publication_media_approvals_revocation_check
    check ((approval_status = 'approved' and revoked_by is null and revoked_at is null) or (approval_status = 'revoked' and revoked_by is not null and revoked_at is not null))
);

alter table public.company_social_publication_media_approvals enable row level security;
revoke all on public.company_social_publication_media_approvals from public, anon, authenticated;
grant select, insert, update on public.company_social_publication_media_approvals to service_role;

create unique index if not exists company_social_publication_media_approvals_current_unique
  on public.company_social_publication_media_approvals (company_id, job_id, attachment_id, attachment_sha256)
  where approval_status = 'approved' and revoked_at is null;

drop function if exists public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, uuid, text, text, timestamptz);
drop function if exists public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, text, uuid, text, smallint, uuid, text, text, timestamptz);
drop function if exists public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, timestamptz);
drop function if exists public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, timestamptz);

create or replace function public.approve_company_facebook_publication_photo(
  p_approval_id uuid,
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_attachment_sha256 bytea,
  p_attachment_mime_type text,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_approval_reason text,
  p_timestamp timestamptz
)
returns setof public.company_social_publication_media_approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_attachment public.job_attachments%rowtype;
  approved_row public.company_social_publication_media_approvals%rowtype;
begin
  if octet_length(p_attachment_sha256) <> 32
    or p_attachment_mime_type not in ('image/jpeg', 'image/png')
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or (p_approval_reason is not null and (char_length(p_approval_reason) > 240 or p_approval_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid media approval request';
  end if;

  perform 1 from public.jobs where id = p_job_id and company_id = p_company_id and status::text in ('Completed', 'Warranty') for update;
  if not found then raise exception 'invalid approval job'; end if;

  select * into selected_attachment
  from public.job_attachments
  where id = p_attachment_id and company_id = p_company_id and job_id = p_job_id
  for key share;
  if not found
    or selected_attachment.kind::text = 'video'
    or lower(selected_attachment.mime_type) <> p_attachment_mime_type
    or selected_attachment.size_bytes < 1
    or selected_attachment.size_bytes > 12000000
    or selected_attachment.storage_bucket is null
    or selected_attachment.storage_path is null then
    raise exception 'invalid approval attachment';
  end if;

  update public.company_social_publication_media_approvals
  set approval_status = 'revoked',
      revoked_by = p_actor_id,
      revoked_at = p_timestamp,
      updated_at = p_timestamp
  where company_id = p_company_id
    and job_id = p_job_id
    and attachment_id = p_attachment_id
    and approval_status = 'approved'
    and revoked_at is null
    and attachment_sha256 <> p_attachment_sha256;

  insert into public.company_social_publication_media_approvals (
    id, company_id, job_id, attachment_id, approval_status, approved_by, approved_at,
    approval_reason, attachment_sha256, attachment_mime_type, created_at, updated_at
  ) values (
    p_approval_id, p_company_id, p_job_id, p_attachment_id, 'approved', p_actor_id, p_timestamp,
    p_approval_reason, p_attachment_sha256, p_attachment_mime_type, p_timestamp, p_timestamp
  )
  on conflict (company_id, job_id, attachment_id, attachment_sha256)
  where approval_status = 'approved' and revoked_at is null
  do update set approved_by = excluded.approved_by,
                approved_at = excluded.approved_at,
                approval_reason = excluded.approval_reason,
                updated_at = excluded.updated_at
  returning * into approved_row;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_approved', 'job_attachment', 'Facebook publication media approval',
    p_attachment_id::text, 'Facebook photo approval',
    'Meta publication media approval completed.',
    jsonb_build_object('channel', 'Facebook', 'publicationKind', 'single_photo', 'mediaCount', 1)
  );
  return next approved_row;
end;
$$;

create or replace function public.begin_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_job_id uuid,
  p_idempotency_key uuid,
  p_approved_message text,
  p_message_sha256 bytea,
  p_publication_intent_sha256 bytea,
  p_publication_kind text,
  p_attachment_id uuid,
  p_safe_mime_type text,
  p_media_count smallint,
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
  selected_attachment public.job_attachments%rowtype;
  created_publication public.company_social_publications%rowtype;
  expected_intent bytea;
begin
  expected_intent := sha256(convert_to(concat_ws(E'\n',
    'facebook_publication_intent_v1', 'meta-facebook-login', 'Facebook',
    p_company_id::text, p_job_id::text, p_connection_id::text, p_actor_id::text,
    p_publication_kind, p_approved_message,
    case when p_publication_kind = 'single_photo' then p_attachment_id::text else '' end
  ), 'UTF8'));

  if p_approved_message is null
    or p_approved_message <> btrim(p_approved_message)
    or char_length(p_approved_message) not between 1 and 5000
    or translate(p_approved_message, E'\n', '') ~ '[[:cntrl:]]'
    or lower(p_approved_message) like '%[private]%'
    or octet_length(p_message_sha256) <> 32
    or p_message_sha256 <> sha256(convert_to(p_approved_message, 'UTF8'))
    or octet_length(p_publication_intent_sha256) <> 32
    or p_publication_intent_sha256 <> expected_intent
    or p_publication_kind not in ('text_only', 'single_photo')
    or (p_publication_kind = 'text_only' and (p_attachment_id is not null or p_safe_mime_type is not null or p_media_count <> 0))
    or (p_publication_kind = 'single_photo' and (p_attachment_id is null or p_safe_mime_type not in ('image/jpeg', 'image/png') or p_media_count <> 1))
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
  where company_id = p_company_id and publication_intent_sha256 = p_publication_intent_sha256;

  if found then
    return query select
      existing_publication.id, existing_publication.status, existing_publication.approved_at,
      existing_publication.published_at, existing_publication.last_error_code,
      existing_publication.provider_http_status, existing_publication.provider_error_code,
      existing_publication.provider_error_subcode, existing_publication.provider_error_category,
      existing_publication.provider_is_transient, false;
    return;
  end if;

  perform 1 from public.jobs where id = p_job_id and company_id = p_company_id and status::text in ('Completed', 'Warranty') for update;
  if not found then raise exception 'invalid publication job'; end if;

  if p_publication_kind = 'single_photo' then
    select * into selected_attachment
    from public.job_attachments
    where id = p_attachment_id and company_id = p_company_id and job_id = p_job_id
    for key share;
    if not found
      or selected_attachment.kind::text = 'video'
      or lower(selected_attachment.mime_type) <> p_safe_mime_type
      or selected_attachment.size_bytes < 1
      or selected_attachment.size_bytes > 12000000
      or selected_attachment.storage_bucket is null
      or selected_attachment.storage_path is null then
      raise exception 'invalid publication attachment';
    end if;
  end if;

  select * into selected_connection
  from public.company_social_connections
  where id = p_connection_id and company_id = p_company_id and provider = 'meta-facebook-login'
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
    idempotency_key, publication_intent_sha256, approved_message, message_sha256,
    publication_kind, attachment_id, safe_mime_type, media_count, approved_by,
    approved_at, created_at, updated_at
  ) values (
    p_publication_id, p_company_id, p_connection_id, p_job_id, 'meta-facebook-login', 'Facebook', 'publishing',
    p_idempotency_key, p_publication_intent_sha256, p_approved_message, p_message_sha256,
    p_publication_kind, p_attachment_id, p_safe_mime_type, p_media_count, p_actor_id,
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
      'channel', 'Facebook', 'status', 'publishing', 'publicationKind', p_publication_kind,
      'mediaCount', p_media_count, 'messageCharacterCount', char_length(p_approved_message),
      'attachmentId', case when p_publication_kind = 'single_photo' then p_attachment_id::text else null end,
      'intentHashPrefix', encode(substring(p_publication_intent_sha256 from 1 for 8), 'hex'),
      'requestCorrelationId', p_idempotency_key::text, 'attempts', 0
    )
  );

  return query select
    created_publication.id, created_publication.status, created_publication.approved_at,
    created_publication.published_at, created_publication.last_error_code,
    created_publication.provider_http_status, created_publication.provider_error_code,
    created_publication.provider_error_subcode, created_publication.provider_error_category,
    created_publication.provider_is_transient, true;
end;
$$;

create or replace function public.complete_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider_post_id text,
  p_provider_media_id text,
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
  select * into locked_publication
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id
  for update;
  if not found or locked_publication.status <> 'publishing' then
    raise exception 'invalid publication transition';
  end if;

  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or (locked_publication.publication_kind = 'text_only' and (
      p_provider_post_id is null or char_length(btrim(p_provider_post_id)) not between 1 and 200 or p_provider_post_id ~ '[[:cntrl:]]' or p_provider_media_id is not null
    ))
    or (locked_publication.publication_kind = 'single_photo' and (
      p_provider_post_id is not null or p_provider_media_id is null or char_length(btrim(p_provider_media_id)) not between 1 and 200 or p_provider_media_id ~ '[[:cntrl:]]'
    )) then
    raise exception 'invalid provider ids';
  end if;

  update public.company_social_publications
  set status = 'published',
      provider_post_id = case when locked_publication.publication_kind = 'text_only' then btrim(p_provider_post_id) else null end,
      provider_media_id = case when locked_publication.publication_kind = 'single_photo' then btrim(p_provider_media_id) else null end,
      attempts = 1,
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
      'channel', 'Facebook', 'status', 'published', 'publicationKind', updated_publication.publication_kind,
      'mediaCount', updated_publication.media_count,
      'messageCharacterCount', char_length(updated_publication.approved_message),
      'attachmentId', case when updated_publication.publication_kind = 'single_photo' then updated_publication.attachment_id::text else null end,
      'intentHashPrefix', encode(substring(updated_publication.publication_intent_sha256 from 1 for 8), 'hex'),
      'attempts', 1
    )
  );
  return next updated_publication;
end;
$$;

revoke all on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, timestamptz) to service_role;
grant execute on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, timestamptz) to service_role;

comment on column public.company_social_publications.publication_intent_sha256 is
  'Server-derived SHA-256 of the canonical publication intent. Browser UUIDs are correlation only.';
comment on table public.company_social_publication_media_approvals is
  'Server-only durable human approval for exact single-photo publication attachments and checksums.';
-- META_FACEBOOK_SINGLE_PHOTO_PUBLISH_CORRECTIVE_END
