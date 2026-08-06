-- META_PUBLICATION_AUDIT_PROVIDER_ID_REDACTION_BEGIN

create or replace function private.complete_company_facebook_publication_unvalidated_20260805(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider_post_id text,
  p_provider_media_id text,
  p_publication_audit_metadata jsonb,
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
  safe_metadata jsonb := coalesce(p_publication_audit_metadata, '{}'::jsonb);
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
    or jsonb_typeof(safe_metadata) <> 'object'
    or safe_metadata::text ~* '(token|secret|signed|storage|private@example|coordinates|latitude|longitude)'
    or (locked_publication.publication_kind = 'single_photo' and not (
      safe_metadata ?& array[
        'analysisRunId', 'approvalId', 'approvedAt', 'revoked',
        'originalMime', 'detectedMime', 'sanitizedMime',
        'originalByteSize', 'sanitizedByteSize',
        'originalHashPrefix', 'sanitizedHashPrefix',
        'width', 'height', 'metadataStripped', 'gpsStripped',
        'sanitizer', 'sanitizerVersion', 'providerCallCount'
      ]
    ))
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
      'channel', 'Facebook', 'status', 'published',
      'publicationKind', updated_publication.publication_kind,
      'mediaCount', updated_publication.media_count,
      'messageCharacterCount', char_length(updated_publication.approved_message),
      'attachmentId', case when updated_publication.publication_kind = 'single_photo' then updated_publication.attachment_id::text else null end,
      'providerCallCount', 1,
      'singlePhotoProviderPostIdNull', updated_publication.publication_kind = 'single_photo' and updated_publication.provider_post_id is null,
      'intentHashPrefix', encode(substring(updated_publication.publication_intent_sha256 from 1 for 8), 'hex'),
      'attempts', 1
    ) || safe_metadata
  );
  return next updated_publication;
end;
$$;

revoke all on function private.complete_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated, service_role;

update public.audit_events
set metadata = metadata - 'providerMediaId' - 'providerPostId'
where action = 'meta_publication_published'
  and metadata ?| array['providerMediaId', 'providerPostId'];

do $$
begin
  if exists (
    select 1
    from public.audit_events
    where action = 'meta_publication_published'
      and metadata ?| array['providerMediaId', 'providerPostId']
  ) then
    raise exception 'meta publication published audit provider ids remain';
  end if;
end;
$$;

-- META_PUBLICATION_AUDIT_PROVIDER_ID_REDACTION_END
