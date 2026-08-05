-- META_FACEBOOK_SINGLE_PHOTO_REVIEW_CLOSURE_BEGIN

create or replace function public.exclude_company_facebook_publication_photo(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
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
  where ar.company_id = p_company_id
    and ar.job_id = p_job_id
    and ar.attachment_id = p_attachment_id
    and run.company_id = p_company_id
    and run.job_id = p_job_id
  order by ar.created_at desc
  limit 1
  for update of ar;
  if not found then raise exception 'media analysis evidence required'; end if;

  update public.company_social_publication_media_approvals approval
  set approval_status = 'revoked',
      revoked_by = p_actor_id,
      revoked_at = p_timestamp,
      updated_at = p_timestamp,
      approval_reason = coalesce(p_exclusion_reason, approval.approval_reason)
  where approval.id = (
    select candidate.id
    from public.company_social_publication_media_approvals candidate
    where candidate.company_id = p_company_id
      and candidate.job_id = p_job_id
      and candidate.attachment_id = p_attachment_id
      and candidate.approval_status = 'approved'
      and candidate.revoked_at is null
    order by candidate.approved_at desc
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
      'revokedApprovalId', case when revoked_id is null then null else revoked_id::text end,
      'excluded', true
    )
  );

  return query select p_attachment_id, true, revoked_id;
end;
$$;

create or replace function public.resolve_company_media_analysis_false_positive(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
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
  where ar.company_id = p_company_id
    and ar.job_id = p_job_id
    and ar.attachment_id = p_attachment_id
    and ar.excluded = false
    and run.company_id = p_company_id
    and run.job_id = p_job_id
    and run.status = 'completed'
  order by ar.created_at desc
  limit 1
  for update of ar;
  if not found then raise exception 'media analysis evidence required'; end if;

  update public.company_media_analysis_privacy_findings finding
  set resolved_as_false_positive = true,
      resolved_by = p_actor_id,
      resolved_at = p_timestamp
  where finding.attachment_result_id = selected_result.id
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
      'resolvedFindingCount', resolved_count,
      'privacyReviewStatus', selected_result.privacy_review_status
    )
  );

  return query select p_attachment_id, selected_result.privacy_review_status, resolved_count;
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
  locked_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
  safe_metadata jsonb := coalesce(p_publication_audit_metadata, '{}'::jsonb);
begin
  if p_provider_error_category not in (
      'INVALID_TOKEN', 'MISSING_PERMISSION', 'PAGE_UNAVAILABLE', 'RATE_LIMITED',
      'PROVIDER_TEMPORARY_ERROR', 'PROVIDER_REJECTED', 'RESPONSE_MISSING_POST_ID',
      'RESPONSE_MISSING_MEDIA_ID'
    )
    or p_last_error_code is null
    or p_last_error_code !~ '^[A-Z0-9_]{2,80}$'
    or (p_provider_http_status is not null and p_provider_http_status not between 100 and 599)
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or jsonb_typeof(safe_metadata) <> 'object'
    or safe_metadata::text ~* '(token|secret|signed|storage|private@example|coordinates|latitude|longitude)' then
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
  set status = 'failed', attempts = 1, provider_post_id = null, provider_media_id = null,
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
    safe_metadata || jsonb_build_object(
      'channel', 'Facebook', 'status', 'failed',
      'publicationKind', updated_publication.publication_kind,
      'mediaCount', updated_publication.media_count,
      'attachmentId', case when updated_publication.publication_kind = 'single_photo' then updated_publication.attachment_id::text else null end,
      'providerCallCount', 1,
      'providerCategory', p_provider_error_category,
      'messageCharacterCount', char_length(updated_publication.approved_message),
      'intentHashPrefix', encode(substring(updated_publication.publication_intent_sha256 from 1 for 8), 'hex'),
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
  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or jsonb_typeof(safe_metadata) <> 'object'
    or safe_metadata::text ~* '(token|secret|signed|storage|private@example|coordinates|latitude|longitude)' then
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
  set status = 'delivery_unknown', attempts = 1, provider_post_id = null, provider_media_id = null,
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
    safe_metadata || jsonb_build_object(
      'channel', 'Facebook', 'status', 'delivery_unknown',
      'publicationKind', updated_publication.publication_kind,
      'mediaCount', updated_publication.media_count,
      'attachmentId', case when updated_publication.publication_kind = 'single_photo' then updated_publication.attachment_id::text else null end,
      'providerCallCount', 1,
      'deliveryUnknown', true,
      'repeatBlocked', true,
      'reconciliationRequired', true,
      'messageCharacterCount', char_length(updated_publication.approved_message),
      'intentHashPrefix', encode(substring(updated_publication.publication_intent_sha256 from 1 for 8), 'hex'),
      'attempts', 1
    )
  );
  return next updated_publication;
end;
$$;

revoke all on function public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz) to service_role;
grant execute on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, jsonb, timestamptz) to service_role;

comment on function public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, text, text, text, timestamptz) is
  'Durably excludes one analyzed job photo from Facebook publication eligibility and atomically revokes any active approval.';
comment on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) is
  'Durably resolves bounded media privacy finding ids as false positives without granting publication approval.';

-- META_FACEBOOK_SINGLE_PHOTO_REVIEW_CLOSURE_END
