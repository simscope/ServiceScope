-- META_FACEBOOK_SINGLE_PHOTO_PUBLISH_BEGIN
alter table public.company_social_publications
  add column publication_kind text not null default 'text_only',
  add column attachment_id uuid references public.job_attachments(id) on delete restrict,
  add column safe_mime_type text,
  add column provider_media_id text,
  add column media_count smallint not null default 0;

alter table public.company_social_publications
  add constraint company_social_publications_kind_check
  check (publication_kind in ('text_only', 'single_photo')),
  add constraint company_social_publications_media_count_check
  check (
    (publication_kind = 'text_only' and media_count = 0 and attachment_id is null and safe_mime_type is null)
    or (publication_kind = 'single_photo' and media_count = 1 and attachment_id is not null and safe_mime_type in ('image/jpeg', 'image/png', 'image/webp'))
  ),
  add constraint company_social_publications_provider_media_id_check
  check (provider_media_id is null or (
    char_length(provider_media_id) between 1 and 200
    and provider_media_id !~ '[[:cntrl:]]'
  ));

create index company_social_publications_attachment_idx
  on public.company_social_publications (company_id, job_id, attachment_id)
  where attachment_id is not null;

create or replace function public.begin_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_job_id uuid,
  p_idempotency_key uuid,
  p_approved_message text,
  p_message_sha256 bytea,
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
begin
  if p_approved_message is null
    or p_approved_message <> btrim(p_approved_message)
    or char_length(p_approved_message) not between 1 and 5000
    or translate(p_approved_message, E'\n', '') ~ '[[:cntrl:]]'
    or lower(p_approved_message) like '%[private]%'
    or octet_length(p_message_sha256) <> 32
    or p_message_sha256 <> sha256(convert_to(p_approved_message, 'UTF8'))
    or p_publication_kind not in ('text_only', 'single_photo')
    or (p_publication_kind = 'text_only' and (p_attachment_id is not null or p_safe_mime_type is not null or p_media_count <> 0))
    or (p_publication_kind = 'single_photo' and (p_attachment_id is null or p_safe_mime_type not in ('image/jpeg', 'image/png', 'image/webp') or p_media_count <> 1))
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
      or existing_publication.message_sha256 <> p_message_sha256
      or existing_publication.publication_kind <> p_publication_kind
      or existing_publication.attachment_id is distinct from p_attachment_id
      or existing_publication.safe_mime_type is distinct from p_safe_mime_type
      or existing_publication.media_count <> p_media_count then
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

  if p_publication_kind = 'single_photo' then
    select * into selected_attachment
    from public.job_attachments
    where id = p_attachment_id
      and company_id = p_company_id
      and job_id = p_job_id
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
    idempotency_key, approved_message, message_sha256, publication_kind,
    attachment_id, safe_mime_type, media_count, approved_by,
    approved_at, created_at, updated_at
  ) values (
    p_publication_id, p_company_id, p_connection_id, p_job_id,
    'meta-facebook-login', 'Facebook', 'publishing', p_idempotency_key,
    p_approved_message, p_message_sha256, p_publication_kind,
    p_attachment_id, p_safe_mime_type, p_media_count, p_actor_id,
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
      'publicationKind', p_publication_kind,
      'mediaCount', p_media_count,
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
  set status = 'published',
      provider_post_id = btrim(p_provider_post_id),
      provider_media_id = case when locked_publication.publication_kind = 'single_photo' then btrim(p_provider_post_id) else null end,
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
      'channel', 'Facebook', 'status', 'published',
      'publicationKind', updated_publication.publication_kind,
      'mediaCount', updated_publication.media_count,
      'messageCharacterCount', char_length(updated_publication.approved_message),
      'attempts', 1
    )
  );
  return next updated_publication;
end;
$$;

revoke all on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, text, uuid, text, smallint, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, text, uuid, text, smallint, uuid, text, text, timestamptz) to service_role;

comment on column public.company_social_publications.publication_kind is
  'Server-only publication kind: text_only or single_photo.';
comment on column public.company_social_publications.attachment_id is
  'Server-only bounded job attachment reference for single-photo publications.';
comment on column public.company_social_publications.safe_mime_type is
  'Server-validated MIME type used for single-photo publication.';
comment on column public.company_social_publications.provider_media_id is
  'Server-only Meta photo identifier. Never return to browser clients.';
comment on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, text, uuid, text, smallint, uuid, text, text, timestamptz) is
  'Validates and begins one idempotent Facebook Page publication, including optional single-photo metadata, with an atomic safe audit.';
-- META_FACEBOOK_SINGLE_PHOTO_PUBLISH_END
