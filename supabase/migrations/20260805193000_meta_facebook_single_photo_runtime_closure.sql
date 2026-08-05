-- META_FACEBOOK_SINGLE_PHOTO_RUNTIME_CLOSURE_BEGIN

drop function if exists public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz);

create or replace function public.meta_facebook_publication_audit_metadata_valid(
  p_publication_kind text,
  p_stage text,
  p_metadata jsonb,
  p_provider_call_count integer
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  value jsonb := coalesce(p_metadata, '{}'::jsonb);
  allowed_keys text[] := array[
    'attachmentId','analysisRunId','approvalId','approvedAt','revoked',
    'originalMime','detectedMime','sanitizedMime','originalByteSize','sanitizedByteSize',
    'originalHashPrefix','sanitizedHashPrefix','width','height','metadataStripped','gpsStripped',
    'sanitizer','sanitizerVersion','providerCallCount'
  ];
  key text;
  timestamp_value timestamptz;
  expected_call_count integer := case when p_stage = 'begin' then 0 else 1 end;
begin
  if p_publication_kind = 'text_only' then
    return value = '{}'::jsonb and p_provider_call_count = expected_call_count;
  end if;
  if p_publication_kind <> 'single_photo'
    or p_stage not in ('begin', 'complete', 'fail', 'unknown')
    or p_provider_call_count <> expected_call_count
    or jsonb_typeof(value) <> 'object'
    or length(value::text) > 4000
    or value::text ~* '(token|secret|url|https?://|signed|storage|private@example|coordinates|latitude|longitude)' then
    return false;
  end if;
  for key in select jsonb_object_keys(value) loop
    if key <> all(allowed_keys) then return false; end if;
  end loop;
  if not (value ?& allowed_keys) then return false; end if;
  if exists (select 1 from jsonb_each(value) item where jsonb_typeof(item.value) in ('array','object','null')) then return false; end if;
  if jsonb_typeof(value->'attachmentId') <> 'string'
    or jsonb_typeof(value->'analysisRunId') <> 'string'
    or jsonb_typeof(value->'approvalId') <> 'string'
    or jsonb_typeof(value->'approvedAt') <> 'string'
    or jsonb_typeof(value->'originalMime') <> 'string'
    or jsonb_typeof(value->'detectedMime') <> 'string'
    or jsonb_typeof(value->'sanitizedMime') <> 'string'
    or jsonb_typeof(value->'originalHashPrefix') <> 'string'
    or jsonb_typeof(value->'sanitizedHashPrefix') <> 'string'
    or jsonb_typeof(value->'sanitizer') <> 'string'
    or jsonb_typeof(value->'sanitizerVersion') <> 'string'
    or jsonb_typeof(value->'originalByteSize') <> 'number'
    or jsonb_typeof(value->'sanitizedByteSize') <> 'number'
    or jsonb_typeof(value->'width') <> 'number'
    or jsonb_typeof(value->'height') <> 'number'
    or jsonb_typeof(value->'providerCallCount') <> 'number'
    or jsonb_typeof(value->'revoked') <> 'boolean'
    or jsonb_typeof(value->'metadataStripped') <> 'boolean'
    or jsonb_typeof(value->'gpsStripped') <> 'boolean' then
    return false;
  end if;
  if (value->>'attachmentId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (value->>'analysisRunId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (value->>'approvalId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (value->>'originalMime') not in ('image/jpeg','image/png')
    or (value->>'detectedMime') not in ('image/jpeg','image/png')
    or (value->>'sanitizedMime') not in ('image/jpeg','image/png')
    or (value->>'originalHashPrefix') !~ '^[0-9a-f]{16}$'
    or (value->>'sanitizedHashPrefix') !~ '^[0-9a-f]{16}$'
    or value->>'sanitizer' <> 'ImageScript'
    or value->>'sanitizerVersion' <> '1.3.0'
    or (value->>'revoked')::boolean <> false
    or (value->>'metadataStripped')::boolean <> true
    or (value->>'gpsStripped')::boolean <> true then
    return false;
  end if;
  if (value->>'originalByteSize') !~ '^[0-9]+$'
    or (value->>'sanitizedByteSize') !~ '^[0-9]+$'
    or (value->>'width') !~ '^[0-9]+$'
    or (value->>'height') !~ '^[0-9]+$'
    or (value->>'providerCallCount') !~ '^[0-9]+$' then
    return false;
  end if;
  if (value->>'originalByteSize')::bigint not between 1 and 12000000
    or (value->>'sanitizedByteSize')::bigint not between 1 and 12000000
    or (value->>'width')::integer not between 1 and 10000
    or (value->>'height')::integer not between 1 and 10000
    or (value->>'providerCallCount')::integer <> p_provider_call_count then
    return false;
  end if;
  begin
    timestamp_value := (value->>'approvedAt')::timestamptz;
  exception when others then
    return false;
  end;
  return timestamp_value is not null;
end;
$$;

alter function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz)
  rename to begin_company_facebook_publication_unvalidated_20260805;
alter function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz)
  rename to complete_company_facebook_publication_unvalidated_20260805;
alter function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz)
  rename to fail_company_facebook_publication_unvalidated_20260805;
alter function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, jsonb, timestamptz)
  rename to mark_company_facebook_publication_unknown_unvalidated_20260805;

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

  return query select * from public.begin_company_facebook_publication_unvalidated_20260805(
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

  return query select * from public.complete_company_facebook_publication_unvalidated_20260805(
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

  return query select * from public.fail_company_facebook_publication_unvalidated_20260805(
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

  return query select * from public.mark_company_facebook_publication_unknown_unvalidated_20260805(
    p_publication_id, p_company_id, p_actor_id, p_actor_name, p_actor_role,
    p_publication_audit_metadata, p_timestamp
  );
end;
$$;

create or replace function public.approve_company_facebook_publication_photo(
  p_approval_id uuid,
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_analysis_run_id uuid,
  p_attachment_result_id uuid,
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
  selected_result public.company_media_analysis_attachment_results%rowtype;
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

  select ar.* into selected_result
  from public.company_media_analysis_attachment_results ar
  join public.company_media_analysis_runs run on run.id = ar.analysis_run_id
  where ar.id = p_attachment_result_id
    and ar.analysis_run_id = p_analysis_run_id
    and ar.company_id = p_company_id
    and ar.job_id = p_job_id
    and ar.attachment_id = p_attachment_id
    and ar.attachment_sha256 = p_attachment_sha256
    and ar.detected_mime_type = p_attachment_mime_type
    and ar.excluded = false
    and ar.analysis_status in ('analyzed', 'metadata_only')
    and ar.privacy_review_status in ('passed', 'resolved_false_positive')
    and run.company_id = p_company_id
    and run.job_id = p_job_id
    and run.status = 'completed'
    and not exists (
      select 1 from public.company_media_analysis_attachment_results newer
      where newer.company_id = p_company_id
        and newer.job_id = p_job_id
        and newer.attachment_id = p_attachment_id
        and (newer.created_at, newer.id) > (ar.created_at, ar.id)
    )
  for update of ar;
  if not found then raise exception 'media analysis evidence stale or missing'; end if;

  if exists (
    select 1
    from public.company_media_analysis_privacy_findings finding
    where finding.attachment_result_id = selected_result.id
      and finding.company_id = p_company_id
      and finding.job_id = p_job_id
      and finding.attachment_id = p_attachment_id
      and finding.resolved_as_false_positive = false
  ) then
    raise exception 'unresolved media privacy finding';
  end if;

  update public.company_social_publication_media_approvals approval
  set approval_status = 'revoked',
      revoked_by = p_actor_id,
      revoked_at = p_timestamp,
      updated_at = p_timestamp
  where approval.company_id = p_company_id
    and approval.job_id = p_job_id
    and approval.attachment_id = p_attachment_id
    and approval.approval_status = 'approved'
    and approval.revoked_at is null;

  insert into public.company_social_publication_media_approvals (
    id, company_id, job_id, attachment_id, analysis_run_id, approval_status, approved_by, approved_at,
    approval_reason, attachment_sha256, attachment_mime_type, created_at, updated_at
  ) values (
    p_approval_id, p_company_id, p_job_id, p_attachment_id, selected_result.analysis_run_id, 'approved', p_actor_id, p_timestamp,
    p_approval_reason, p_attachment_sha256, p_attachment_mime_type, p_timestamp, p_timestamp
  )
  returning * into approved_row;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_approved', 'job_attachment', 'Facebook publication media approval',
    p_attachment_id::text, 'Facebook photo approval',
    'Meta publication media approval completed.',
    jsonb_build_object(
      'channel', 'Facebook',
      'publicationKind', 'single_photo',
      'mediaCount', 1,
      'attachmentId', p_attachment_id::text,
      'analysisRunId', selected_result.analysis_run_id::text,
      'attachmentResultId', selected_result.id::text,
      'analysisStatus', selected_result.analysis_status,
      'privacyReviewStatus', selected_result.privacy_review_status,
      'checksumMatch', true,
      'approvalId', approved_row.id::text,
      'approvalReason', case when p_approval_reason is null then null else btrim(p_approval_reason) end
    )
  );
  return next approved_row;
end;
$$;

create or replace function public.resolve_company_media_analysis_false_positive(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_analysis_run_id uuid,
  p_attachment_result_id uuid,
  p_finding_ids text[],
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_resolution_reason text,
  p_timestamp timestamptz
)
returns table (
  attachment_id uuid,
  privacy_review_status text,
  resolved_finding_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_result public.company_media_analysis_attachment_results%rowtype;
  unique_finding_count integer;
  unresolved_count integer;
begin
  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or p_finding_ids is null
    or array_length(p_finding_ids, 1) is null
    or array_length(p_finding_ids, 1) > 50
    or exists (select 1 from unnest(p_finding_ids) value where value is null or char_length(value) not between 1 and 120 or value !~ '^[A-Za-z0-9_.:-]+$')
    or (select count(*) from unnest(p_finding_ids) value) <> (select count(distinct value) from unnest(p_finding_ids) value)
    or (p_resolution_reason is not null and (char_length(p_resolution_reason) > 240 or p_resolution_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid false positive resolution request';
  end if;
  select count(distinct value)::integer into unique_finding_count from unnest(p_finding_ids) value;

  select ar.* into selected_result
  from public.company_media_analysis_attachment_results ar
  join public.company_media_analysis_runs run on run.id = ar.analysis_run_id
  where ar.id = p_attachment_result_id
    and ar.analysis_run_id = p_analysis_run_id
    and ar.company_id = p_company_id
    and ar.job_id = p_job_id
    and ar.attachment_id = p_attachment_id
    and ar.excluded = false
    and ar.analysis_status in ('analyzed', 'metadata_only')
    and run.company_id = p_company_id
    and run.job_id = p_job_id
    and run.status = 'completed'
    and not exists (
      select 1
      from public.company_media_analysis_attachment_results newer
      where newer.company_id = p_company_id
        and newer.job_id = p_job_id
        and newer.attachment_id = p_attachment_id
        and (newer.created_at, newer.id) > (ar.created_at, ar.id)
    )
  for update of ar;
  if not found then raise exception 'media analysis evidence stale or missing'; end if;

  if (
    select count(*)::integer
    from public.company_media_analysis_privacy_findings finding
    where finding.attachment_result_id = selected_result.id
      and finding.analysis_run_id = selected_result.analysis_run_id
      and finding.company_id = p_company_id
      and finding.job_id = p_job_id
      and finding.attachment_id = p_attachment_id
      and finding.finding_id = any(p_finding_ids)
      and finding.resolved_as_false_positive = false
  ) <> unique_finding_count then
    raise exception 'privacy finding set mismatch';
  end if;

  update public.company_media_analysis_privacy_findings finding
  set resolved_as_false_positive = true,
      resolved_by = p_actor_id,
      resolved_at = p_timestamp
  where finding.attachment_result_id = selected_result.id
    and finding.analysis_run_id = selected_result.analysis_run_id
    and finding.company_id = p_company_id
    and finding.job_id = p_job_id
    and finding.attachment_id = p_attachment_id
    and finding.finding_id = any(p_finding_ids)
    and finding.resolved_as_false_positive = false;

  get diagnostics resolved_finding_count = row_count;
  if resolved_finding_count <> unique_finding_count then
    raise exception 'privacy finding set mismatch';
  end if;

  select count(*)::integer into unresolved_count
  from public.company_media_analysis_privacy_findings finding
  where finding.attachment_result_id = selected_result.id
    and finding.resolved_as_false_positive = false;

  if unresolved_count = 0 then
    update public.company_media_analysis_attachment_results
    set privacy_review_status = 'resolved_false_positive'
    where id = selected_result.id;
    selected_result.privacy_review_status := 'resolved_false_positive';
  end if;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_false_positive_resolved', 'job_attachment', 'Facebook publication media false positive',
    p_attachment_id::text, 'Facebook photo false positive review',
    'Meta publication media privacy findings were resolved as false positives.',
    jsonb_build_object(
      'channel', 'Facebook',
      'publicationKind', 'single_photo',
      'attachmentId', p_attachment_id::text,
      'analysisRunId', selected_result.analysis_run_id::text,
      'attachmentResultId', selected_result.id::text,
      'resolvedFindingCount', resolved_finding_count,
      'privacyReviewStatus', selected_result.privacy_review_status,
      'resolutionReason', case when p_resolution_reason is null then null else btrim(p_resolution_reason) end
    )
  );

  return query select p_attachment_id, selected_result.privacy_review_status, resolved_finding_count;
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
begin
  if p_status not in ('completed','failed')
    or p_correlation_id is null or char_length(p_correlation_id) not between 1 and 160
    or p_provider is null or char_length(p_provider) not between 1 and 80
    or p_analysis_version <> 'media-analysis-v1'
    or jsonb_typeof(p_attachments) <> 'array'
    or jsonb_array_length(p_attachments) > 15 then
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
    if jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item->'attachmentId') <> 'string'
      or jsonb_typeof(item->'attachmentSha256') <> 'string'
      or jsonb_typeof(item->'detectedMimeType') <> 'string'
      or jsonb_typeof(item->'analysisStatus') <> 'string'
      or jsonb_typeof(item->'privacyFindings') <> 'array'
      or jsonb_array_length(item->'privacyFindings') > 50
      or (item->>'attachmentSha256') !~ '^\\x[0-9a-f]{64}$'
      or (item->>'detectedMimeType') not in ('image/jpeg','image/png','image/webp')
      or (item->>'analysisStatus') not in ('analyzed','metadata_only','manual_review') then
      raise exception 'invalid media analysis attachment payload';
    end if;
    select * into attachment_row
    from public.job_attachments
    where id = (item->>'attachmentId')::uuid
      and company_id = p_company_id
      and job_id = p_job_id
    for key share;
    if not found then raise exception 'invalid media analysis attachment'; end if;

    result_id := gen_random_uuid();
    privacy_count := jsonb_array_length(item->'privacyFindings');
    insert into public.company_media_analysis_attachment_results (
      id, analysis_run_id, company_id, job_id, attachment_id, attachment_sha256,
      detected_mime_type, analysis_status, privacy_review_status, excluded, created_at
    ) values (
      result_id, p_run_id, p_company_id, p_job_id, attachment_row.id,
      decode(substring(item->>'attachmentSha256' from 3), 'hex'),
      item->>'detectedMimeType', item->>'analysisStatus',
      case when privacy_count > 0 then 'blocked' else 'passed' end,
      false, p_timestamp
    );

    for finding in select value from jsonb_array_elements(item->'privacyFindings') value loop
      if jsonb_typeof(finding) <> 'object'
        or jsonb_typeof(finding->'findingId') <> 'string'
        or jsonb_typeof(finding->'findingCategory') <> 'string'
        or jsonb_typeof(finding->'riskLevel') <> 'string'
        or char_length(finding->>'findingId') not between 1 and 120
        or (finding->>'findingId') !~ '^[A-Za-z0-9_.:-]+$'
        or (finding->>'findingCategory') not in ('possible_license_plate','possible_address','possible_email','possible_phone','possible_face','unknown_privacy_risk')
        or (finding->>'riskLevel') not in ('low','medium','high') then
        raise exception 'invalid media analysis finding payload';
      end if;
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

revoke all on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.record_company_media_analysis_result(uuid, uuid, uuid, text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.meta_facebook_publication_audit_metadata_valid(text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.begin_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_company_facebook_publication_unknown_unvalidated_20260805(uuid, uuid, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.record_company_media_analysis_result(uuid, uuid, uuid, text, text, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.meta_facebook_publication_audit_metadata_valid(text, text, jsonb, integer) to service_role;
grant execute on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz) to service_role;
grant execute on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, jsonb, timestamptz) to service_role;

comment on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) is
  'Approves only the exact displayed newest durable media-analysis attachment result.';
comment on function public.record_company_media_analysis_result(uuid, uuid, uuid, text, text, text, text, text, jsonb, timestamptz) is
  'Atomically records one media-analysis run, attachment results, and privacy findings, returning durable result ids.';

-- META_FACEBOOK_SINGLE_PHOTO_RUNTIME_CLOSURE_END
