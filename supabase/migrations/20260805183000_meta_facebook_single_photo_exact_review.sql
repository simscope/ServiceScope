-- META_FACEBOOK_SINGLE_PHOTO_EXACT_REVIEW_BEGIN

alter table public.company_social_publication_media_approvals
  add column if not exists revocation_reason text,
  add column if not exists exclusion_reason text;

alter table public.company_social_publication_media_approvals
  drop constraint if exists company_social_publication_media_approvals_reason_details_check;

alter table public.company_social_publication_media_approvals
  add constraint company_social_publication_media_approvals_reason_details_check
    check (
      (revocation_reason is null or (char_length(revocation_reason) <= 240 and revocation_reason !~ '[[:cntrl:]<>]'))
      and (exclusion_reason is null or (char_length(exclusion_reason) <= 240 and exclusion_reason !~ '[[:cntrl:]<>]'))
    );

create or replace function public.meta_facebook_publication_audit_metadata_valid(
  p_publication_kind text,
  p_stage text,
  p_metadata jsonb,
  p_provider_call_count integer
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with metadata as (
    select coalesce(p_metadata, '{}'::jsonb) as value
  ),
  keys as (
    select key
    from metadata, jsonb_object_keys(metadata.value) key
  ),
  bad_value as (
    select 1
    from metadata, jsonb_each(metadata.value) item
    where jsonb_typeof(item.value) in ('array', 'object')
  )
  select case
    when p_publication_kind = 'text_only' then (select value = '{}'::jsonb from metadata)
    when p_publication_kind <> 'single_photo' then false
    else
      p_stage in ('begin', 'complete', 'fail', 'unknown')
      and p_provider_call_count = case when p_stage = 'begin' then 0 else 1 end
      and (select jsonb_typeof(value) = 'object' and length(value::text) <= 4000 from metadata)
      and not exists (select 1 from bad_value)
      and not exists (
        select 1 from keys
        where key <> all(array[
          'attachmentId','analysisRunId','approvalId','approvedAt','revoked',
          'originalMime','detectedMime','sanitizedMime','originalByteSize','sanitizedByteSize',
          'originalHashPrefix','sanitizedHashPrefix','width','height','metadataStripped','gpsStripped',
          'sanitizer','sanitizerVersion','providerCallCount'
        ])
      )
      and (select value ?& array[
        'attachmentId','analysisRunId','approvalId','approvedAt','revoked',
        'originalMime','detectedMime','sanitizedMime','originalByteSize','sanitizedByteSize',
        'originalHashPrefix','sanitizedHashPrefix','width','height','metadataStripped','gpsStripped',
        'sanitizer','sanitizerVersion','providerCallCount'
      ] from metadata)
      and (select value::text !~* '(token|secret|url|https?://|signed|storage|private@example|coordinates|latitude|longitude)' from metadata)
      and (select value->>'attachmentId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' from metadata)
      and (select value->>'analysisRunId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' from metadata)
      and (select value->>'approvalId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' from metadata)
      and (select value->>'approvedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{3})?Z$' from metadata)
      and (select (value->>'originalMime') in ('image/jpeg','image/png') and (value->>'detectedMime') in ('image/jpeg','image/png') and (value->>'sanitizedMime') in ('image/jpeg','image/png') from metadata)
      and (select (value->>'originalByteSize')::bigint between 1 and 12000000 and (value->>'sanitizedByteSize')::bigint between 1 and 12000000 from metadata)
      and (select value->>'originalHashPrefix' ~ '^[0-9a-f]{16}$' and value->>'sanitizedHashPrefix' ~ '^[0-9a-f]{16}$' from metadata)
      and (select (value->>'width')::integer between 1 and 10000 and (value->>'height')::integer between 1 and 10000 from metadata)
      and (select value->>'metadataStripped' = 'true' and value->>'gpsStripped' = 'true' from metadata)
      and (select value->>'sanitizer' = 'ImageScript' and value->>'sanitizerVersion' = '1.3.0' from metadata)
      and (select value->>'revoked' in ('true', 'false') and (value->>'providerCallCount')::integer = p_provider_call_count from metadata)
  end;
$$;

create or replace function public.revoke_company_facebook_publication_photo_approval(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_revocation_reason text,
  p_timestamp timestamptz
)
returns setof public.company_social_publication_media_approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_approval public.company_social_publication_media_approvals%rowtype;
begin
  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or (p_revocation_reason is not null and (char_length(p_revocation_reason) > 240 or p_revocation_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid media approval revocation request';
  end if;

  perform 1 from public.job_attachments
  where id = p_attachment_id and company_id = p_company_id and job_id = p_job_id
  for key share;
  if not found then raise exception 'invalid approval attachment'; end if;

  update public.company_social_publication_media_approvals approval
  set approval_status = 'revoked',
      revoked_by = p_actor_id,
      revoked_at = p_timestamp,
      updated_at = p_timestamp,
      revocation_reason = case when p_revocation_reason is null then null else btrim(p_revocation_reason) end
  where approval.id = (
    select candidate.id
    from public.company_social_publication_media_approvals candidate
    where candidate.company_id = p_company_id
      and candidate.job_id = p_job_id
      and candidate.attachment_id = p_attachment_id
      and candidate.approval_status = 'approved'
      and candidate.revoked_at is null
    order by candidate.approved_at desc, candidate.id desc
    limit 1
  )
  returning * into updated_approval;
  if not found then raise exception 'active approval not found'; end if;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_approval_revoked', 'job_attachment', 'Facebook publication media approval',
    p_attachment_id::text, 'Facebook photo approval',
    'Meta publication media approval revoked.',
    jsonb_build_object(
      'channel', 'Facebook',
      'publicationKind', 'single_photo',
      'attachmentId', p_attachment_id::text,
      'analysisRunId', updated_approval.analysis_run_id::text,
      'approvalId', updated_approval.id::text,
      'approvalReason', updated_approval.approval_reason,
      'revokedAt', p_timestamp,
      'revocationReason', case when p_revocation_reason is null then null else btrim(p_revocation_reason) end
    )
  );
  return next updated_approval;
end;
$$;

drop function if exists public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, text, text, text, timestamptz);
drop function if exists public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz);

create or replace function public.exclude_company_facebook_publication_photo(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_analysis_run_id uuid,
  p_attachment_result_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_exclusion_reason text,
  p_timestamp timestamptz
)
returns table (
  attachment_id uuid,
  excluded boolean,
  revoked_approval_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_result public.company_media_analysis_attachment_results%rowtype;
  revoked_id uuid;
begin
  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or (p_exclusion_reason is not null and (char_length(p_exclusion_reason) > 240 or p_exclusion_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid media exclusion request';
  end if;

  perform 1 from public.job_attachments
  where id = p_attachment_id and company_id = p_company_id and job_id = p_job_id
  for key share;
  if not found then raise exception 'invalid media exclusion attachment'; end if;

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

  update public.company_social_publication_media_approvals approval
  set approval_status = 'revoked',
      revoked_by = p_actor_id,
      revoked_at = p_timestamp,
      updated_at = p_timestamp,
      exclusion_reason = case when p_exclusion_reason is null then null else btrim(p_exclusion_reason) end
  where approval.id = (
    select candidate.id
    from public.company_social_publication_media_approvals candidate
    where candidate.company_id = p_company_id
      and candidate.job_id = p_job_id
      and candidate.attachment_id = p_attachment_id
      and candidate.approval_status = 'approved'
      and candidate.revoked_at is null
    order by candidate.approved_at desc, candidate.id desc
    limit 1
  )
  returning approval.id into revoked_id;

  update public.company_media_analysis_attachment_results
  set excluded = true,
      privacy_review_status = 'blocked'
  where id = selected_result.id;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_excluded', 'job_attachment', 'Facebook publication media exclusion',
    p_attachment_id::text, 'Facebook photo exclusion',
    'Meta publication media excluded from Facebook photo publishing.',
    jsonb_build_object(
      'channel', 'Facebook',
      'publicationKind', 'single_photo',
      'attachmentId', p_attachment_id::text,
      'analysisRunId', selected_result.analysis_run_id::text,
      'attachmentResultId', selected_result.id::text,
      'revokedApprovalId', case when revoked_id is null then null else revoked_id::text end,
      'excluded', true,
      'exclusionReason', case when p_exclusion_reason is null then null else btrim(p_exclusion_reason) end
    )
  );

  return query select p_attachment_id, true, revoked_id;
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
  resolved_count integer;
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
    or (p_resolution_reason is not null and (char_length(p_resolution_reason) > 240 or p_resolution_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid false positive resolution request';
  end if;

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

  get diagnostics resolved_count = row_count;
  if resolved_count < 1 then raise exception 'privacy finding not found'; end if;

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
      'resolvedFindingCount', resolved_count,
      'privacyReviewStatus', selected_result.privacy_review_status,
      'resolutionReason', case when p_resolution_reason is null then null else btrim(p_resolution_reason) end
    )
  );

  return query select p_attachment_id, selected_result.privacy_review_status, resolved_count;
end;
$$;

create or replace function public.list_company_facebook_publication_photo_candidates(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid default null
)
returns table (
  attachment_id uuid,
  attachment_result_id uuid,
  analysis_run_id uuid,
  approval_id uuid,
  approved_at timestamptz,
  name text,
  mime_type text,
  storage_bucket text,
  storage_path text,
  attachment_sha256 text,
  privacy_review_status text
)
language sql
security definer
set search_path = ''
as $$
  with newest as (
    select distinct on (ar.attachment_id) ar.*
    from public.company_media_analysis_attachment_results ar
    where ar.company_id = p_company_id
      and ar.job_id = p_job_id
      and (p_attachment_id is null or ar.attachment_id = p_attachment_id)
    order by ar.attachment_id, ar.created_at desc, ar.id desc
  ),
  candidate as (
    select
      ja.id as attachment_id,
      newest.id as attachment_result_id,
      newest.analysis_run_id,
      approval.id as approval_id,
      approval.approved_at,
      ja.name,
      lower(ja.mime_type) as mime_type,
      ja.storage_bucket,
      ja.storage_path,
      ('\x' || encode(newest.attachment_sha256, 'hex')) as attachment_sha256,
      newest.privacy_review_status
    from newest
    join public.company_media_analysis_runs run
      on run.id = newest.analysis_run_id
      and run.company_id = p_company_id
      and run.job_id = p_job_id
      and run.status = 'completed'
    join public.job_attachments ja
      on ja.id = newest.attachment_id
      and ja.company_id = p_company_id
      and ja.job_id = p_job_id
      and ja.kind::text <> 'video'
      and lower(ja.mime_type) in ('image/jpeg', 'image/png')
      and ja.size_bytes between 1 and 12000000
      and ja.storage_bucket is not null
      and ja.storage_path is not null
    join public.company_social_publication_media_approvals approval
      on approval.company_id = p_company_id
      and approval.job_id = p_job_id
      and approval.attachment_id = newest.attachment_id
      and approval.analysis_run_id = newest.analysis_run_id
      and approval.attachment_sha256 = newest.attachment_sha256
      and approval.approval_status = 'approved'
      and approval.revoked_at is null
    where newest.excluded = false
      and newest.analysis_status in ('analyzed', 'metadata_only')
      and newest.privacy_review_status in ('passed', 'resolved_false_positive')
      and not exists (
        select 1
        from public.company_media_analysis_privacy_findings finding
        where finding.attachment_result_id = newest.id
          and finding.company_id = p_company_id
          and finding.job_id = p_job_id
          and finding.attachment_id = newest.attachment_id
          and finding.resolved_as_false_positive = false
      )
  ),
  counted as (
    select candidate.*, count(*) over () as candidate_count
    from candidate
  )
  select
    attachment_id, attachment_result_id, analysis_run_id, approval_id, approved_at,
    name, mime_type, storage_bucket, storage_path, attachment_sha256, privacy_review_status
  from counted
  where candidate_count <= 20
  order by approved_at desc, approval_id desc
  limit 20;
$$;

revoke all on function public.meta_facebook_publication_audit_metadata_valid(text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.revoke_company_facebook_publication_photo_approval(uuid, uuid, uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.list_company_facebook_publication_photo_candidates(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.meta_facebook_publication_audit_metadata_valid(text, text, jsonb, integer) to service_role;
grant execute on function public.revoke_company_facebook_publication_photo_approval(uuid, uuid, uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.list_company_facebook_publication_photo_candidates(uuid, uuid, uuid) to service_role;

comment on function public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz) is
  'Excludes exactly the displayed newest durable media analysis attachment result and rejects stale review actions.';
comment on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) is
  'Resolves false-positive findings only for exactly the displayed newest durable media analysis attachment result.';
comment on function public.list_company_facebook_publication_photo_candidates(uuid, uuid, uuid) is
  'Returns at most 20 newest-result Facebook photo candidates after SQL authority checks; Edge revalidates only these hashes.';

-- META_FACEBOOK_SINGLE_PHOTO_EXACT_REVIEW_END
