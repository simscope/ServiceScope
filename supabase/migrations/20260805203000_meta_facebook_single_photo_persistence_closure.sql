-- META_FACEBOOK_SINGLE_PHOTO_PERSISTENCE_CLOSURE_BEGIN

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

alter function public.begin_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz)
  set schema private;
alter function public.complete_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz)
  set schema private;
alter function public.fail_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz)
  set schema private;
alter function public.mark_company_facebook_publication_unknown_unvalidated_20260805(uuid, uuid, uuid, text, text, jsonb, timestamptz)
  set schema private;

revoke all on function private.begin_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.complete_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.fail_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.mark_company_facebook_publication_unknown_unvalidated_20260805(uuid, uuid, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated, service_role;

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
  p_publication_audit_metadata jsonb,
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
begin
  if not public.meta_facebook_publication_audit_metadata_valid(p_publication_kind, 'begin', coalesce(p_publication_audit_metadata, '{}'::jsonb), 0) then
    raise exception 'invalid publication audit metadata';
  end if;

  return query select * from private.begin_company_facebook_publication_unvalidated_20260805(
    p_publication_id, p_company_id, p_connection_id, p_job_id, p_idempotency_key,
    p_approved_message, p_message_sha256, p_publication_intent_sha256, p_publication_kind,
    p_attachment_id, p_safe_mime_type, p_media_count, p_actor_id, p_actor_name, p_actor_role,
    p_publication_audit_metadata, p_timestamp
  );
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
  p_publication_audit_metadata jsonb,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_kind text;
begin
  select publication_kind into selected_kind
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id;

  if found and not public.meta_facebook_publication_audit_metadata_valid(selected_kind, 'complete', coalesce(p_publication_audit_metadata, '{}'::jsonb), 1) then
    raise exception 'invalid publication audit metadata';
  end if;

  return query select * from private.complete_company_facebook_publication_unvalidated_20260805(
    p_publication_id, p_company_id, p_actor_id, p_actor_name, p_actor_role,
    p_provider_post_id, p_provider_media_id, p_publication_audit_metadata, p_timestamp
  );
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
  p_publication_audit_metadata jsonb,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_kind text;
begin
  select publication_kind into selected_kind
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id;

  if found and not public.meta_facebook_publication_audit_metadata_valid(selected_kind, 'fail', coalesce(p_publication_audit_metadata, '{}'::jsonb), 1) then
    raise exception 'invalid publication audit metadata';
  end if;

  return query select * from private.fail_company_facebook_publication_unvalidated_20260805(
    p_publication_id, p_company_id, p_actor_id, p_actor_name, p_actor_role,
    p_provider_http_status, p_provider_error_code, p_provider_error_subcode,
    p_provider_error_category, p_provider_is_transient, p_last_error_code,
    p_publication_audit_metadata, p_timestamp
  );
end;
$$;

create or replace function public.mark_company_facebook_publication_unknown(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_publication_audit_metadata jsonb,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_kind text;
begin
  select publication_kind into selected_kind
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id;

  if found and not public.meta_facebook_publication_audit_metadata_valid(selected_kind, 'unknown', coalesce(p_publication_audit_metadata, '{}'::jsonb), 1) then
    raise exception 'invalid publication audit metadata';
  end if;

  return query select * from private.mark_company_facebook_publication_unknown_unvalidated_20260805(
    p_publication_id, p_company_id, p_actor_id, p_actor_name, p_actor_role,
    p_publication_audit_metadata, p_timestamp
  );
end;
$$;

alter table public.company_media_analysis_attachment_results
  drop constraint if exists company_media_analysis_attachment_mime_check;
alter table public.company_media_analysis_attachment_results
  add constraint company_media_analysis_attachment_mime_check
    check (detected_mime_type in ('image/jpeg', 'image/png', 'image/webp'));

do $$
begin
  if exists (
    select 1
    from public.company_media_analysis_attachment_results
    group by analysis_run_id, attachment_id
    having count(*) > 1
  ) then
    raise exception 'duplicate media analysis attachment results exist';
  end if;
  if exists (
    select 1
    from public.company_media_analysis_privacy_findings
    group by attachment_result_id, finding_id
    having count(*) > 1
  ) then
    raise exception 'duplicate media analysis privacy findings exist';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'company_media_analysis_attachment_results_run_attachment_unique'
      and conrelid = 'public.company_media_analysis_attachment_results'::regclass
  ) then
    alter table public.company_media_analysis_attachment_results
      add constraint company_media_analysis_attachment_results_run_attachment_unique
      unique (analysis_run_id, attachment_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'company_media_analysis_privacy_findings_result_finding_unique'
      and conrelid = 'public.company_media_analysis_privacy_findings'::regclass
  ) then
    alter table public.company_media_analysis_privacy_findings
      add constraint company_media_analysis_privacy_findings_result_finding_unique
      unique (attachment_result_id, finding_id);
  end if;
end;
$$;

create or replace function public.record_company_media_analysis_result(
  p_run_id uuid,
  p_company_id uuid,
  p_job_id uuid,
  p_correlation_id text,
  p_status text,
  p_provider text,
  p_model text,
  p_analysis_version text,
  p_attachments jsonb,
  p_timestamp timestamptz
)
returns table (
  attachment_id uuid,
  analysis_run_id uuid,
  attachment_result_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  finding jsonb;
  result_id uuid;
  attachment_row public.job_attachments%rowtype;
  privacy_count integer;
  total_privacy_count integer := 0;
  seen_attachment_ids text[] := array[]::text[];
  seen_finding_ids text[];
  item_keys text[];
  finding_keys text[];
  attachment_id_text text;
  checksum_text text;
  detected_mime text;
begin
  if p_status not in ('completed','failed')
    or p_correlation_id is null or char_length(p_correlation_id) not between 8 and 160 or p_correlation_id ~ '[[:cntrl:]<>]'
    or p_provider is null or char_length(p_provider) not between 1 and 120 or p_provider ~ '[[:cntrl:]<>]'
    or (p_model is not null and (char_length(p_model) > 120 or p_model ~ '[[:cntrl:]<>]'))
    or p_analysis_version <> 'media-analysis-v1'
    or p_timestamp is null
    or jsonb_typeof(p_attachments) <> 'array'
    or jsonb_array_length(p_attachments) > 4 then
    raise exception 'invalid media analysis persistence request';
  end if;
  perform 1 from public.jobs where id = p_job_id and company_id = p_company_id for key share;
  if not found then raise exception 'invalid media analysis job'; end if;

  insert into public.company_media_analysis_runs (
    id, company_id, job_id, correlation_id, status, provider, model, analysis_version,
    completed_at, created_at, updated_at
  ) values (
    p_run_id, p_company_id, p_job_id, p_correlation_id, p_status, p_provider, p_model, p_analysis_version,
    p_timestamp, p_timestamp, p_timestamp
  );

  for item in select value from jsonb_array_elements(p_attachments) value loop
    select coalesce(array_agg(key order by key), array[]::text[]) into item_keys from jsonb_object_keys(item) key;
    attachment_id_text := item->>'attachmentId';
    checksum_text := item->>'attachmentSha256';
    detected_mime := lower(item->>'detectedMimeType');

    if jsonb_typeof(item) <> 'object'
      or item_keys <> array['analysisStatus','attachmentId','attachmentSha256','detectedMimeType','privacyFindings']
      or jsonb_typeof(item->'attachmentId') <> 'string'
      or attachment_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or attachment_id_text = any(seen_attachment_ids)
      or jsonb_typeof(item->'attachmentSha256') <> 'string'
      or checksum_text !~ '^\\x[0-9a-f]{64}$'
      or jsonb_typeof(item->'detectedMimeType') <> 'string'
      or detected_mime not in ('image/jpeg','image/png','image/webp')
      or jsonb_typeof(item->'analysisStatus') <> 'string'
      or (item->>'analysisStatus') not in ('analyzed','metadata_only','manual_review')
      or jsonb_typeof(item->'privacyFindings') <> 'array'
      or jsonb_array_length(item->'privacyFindings') > 6 then
      raise exception 'invalid media analysis attachment payload';
    end if;

    select * into attachment_row
    from public.job_attachments
    where id = attachment_id_text::uuid
      and company_id = p_company_id
      and job_id = p_job_id
    for key share;
    if not found
      or attachment_row.kind::text <> 'photo'
      or lower(attachment_row.mime_type) <> detected_mime
      or attachment_row.size_bytes not between 1 and 12000000
      or attachment_row.storage_bucket is null
      or attachment_row.storage_path is null then
      raise exception 'invalid media analysis attachment';
    end if;

    seen_attachment_ids := array_append(seen_attachment_ids, attachment_id_text);
    result_id := gen_random_uuid();
    privacy_count := jsonb_array_length(item->'privacyFindings');
    total_privacy_count := total_privacy_count + privacy_count;
    if total_privacy_count > 24 then
      raise exception 'invalid media analysis finding payload';
    end if;

    insert into public.company_media_analysis_attachment_results (
      id, analysis_run_id, company_id, job_id, attachment_id, attachment_sha256,
      detected_mime_type, analysis_status, privacy_review_status, excluded, created_at
    ) values (
      result_id, p_run_id, p_company_id, p_job_id, attachment_row.id,
      decode(substring(checksum_text from 3), 'hex'),
      detected_mime, item->>'analysisStatus',
      case when privacy_count > 0 then 'blocked' else 'passed' end,
      false, p_timestamp
    );

    seen_finding_ids := array[]::text[];
    for finding in select value from jsonb_array_elements(item->'privacyFindings') value loop
      select coalesce(array_agg(key order by key), array[]::text[]) into finding_keys from jsonb_object_keys(finding) key;
      if jsonb_typeof(finding) <> 'object'
        or finding_keys <> array['findingCategory','findingId','riskLevel']
        or jsonb_typeof(finding->'findingId') <> 'string'
        or jsonb_typeof(finding->'findingCategory') <> 'string'
        or jsonb_typeof(finding->'riskLevel') <> 'string'
        or char_length(finding->>'findingId') not between 1 and 120
        or (finding->>'findingId') !~ '^[A-Za-z0-9_.:-]+$'
        or (finding->>'findingId') = any(seen_finding_ids)
        or (finding->>'findingCategory') not in (
          'possible_face','possible_address','possible_phone_or_email','possible_license_plate',
          'possible_customer_document','possible_screen','possible_barcode',
          'possible_serial_or_nameplate','possible_personal_identifier','unknown_privacy_risk'
        )
        or (finding->>'riskLevel') not in ('low','medium','high') then
        raise exception 'invalid media analysis finding payload';
      end if;
      seen_finding_ids := array_append(seen_finding_ids, finding->>'findingId');
      insert into public.company_media_analysis_privacy_findings (
        id, analysis_run_id, attachment_result_id, company_id, job_id, attachment_id,
        finding_id, finding_category, risk_level, resolved_as_false_positive, created_at
      ) values (
        gen_random_uuid(), p_run_id, result_id, p_company_id, p_job_id, attachment_row.id,
        finding->>'findingId', finding->>'findingCategory', finding->>'riskLevel', false, p_timestamp
      );
    end loop;

    attachment_id := attachment_row.id;
    analysis_run_id := p_run_id;
    attachment_result_id := result_id;
    return next;
  end loop;
end;
$$;

revoke all on function public.record_company_media_analysis_result(uuid, uuid, uuid, text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.record_company_media_analysis_result(uuid, uuid, uuid, text, text, text, text, text, jsonb, timestamptz) to service_role;

comment on function public.record_company_media_analysis_result(uuid, uuid, uuid, text, text, text, text, text, jsonb, timestamptz) is
  'Atomically records bounded media-analysis photo results with exact attachment validation, WebP persistence, canonical privacy categories, and durable id mapping.';

-- META_FACEBOOK_SINGLE_PHOTO_PERSISTENCE_CLOSURE_END
