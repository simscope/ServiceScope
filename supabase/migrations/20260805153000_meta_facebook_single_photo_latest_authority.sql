-- META_FACEBOOK_SINGLE_PHOTO_LATEST_AUTHORITY_BEGIN

drop function if exists public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, uuid, text, text, timestamptz);
drop function if exists public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, text, uuid, text, smallint, uuid, text, text, timestamptz);
drop function if exists public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, timestamptz);
drop function if exists public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz);
drop function if exists public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, timestamptz);
drop function if exists public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, timestamptz);
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
  selected_result public.company_media_analysis_attachment_results%rowtype;
  selected_run public.company_media_analysis_runs%rowtype;
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
  where ar.company_id = p_company_id
    and ar.job_id = p_job_id
    and ar.attachment_id = p_attachment_id
  order by ar.created_at desc, ar.id desc
  limit 1
  for update;
  if not found then raise exception 'media analysis evidence required'; end if;

  select * into selected_run
  from public.company_media_analysis_runs run
  where run.id = selected_result.analysis_run_id
    and run.company_id = p_company_id
    and run.job_id = p_job_id;
  if not found
    or selected_run.status <> 'completed'
    or selected_result.attachment_sha256 <> p_attachment_sha256
    or selected_result.detected_mime_type <> p_attachment_mime_type
    or selected_result.excluded = true
    or selected_result.analysis_status not in ('analyzed', 'metadata_only')
    or selected_result.privacy_review_status not in ('passed', 'resolved_false_positive') then
    raise exception 'media analysis evidence required';
  end if;

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
      approval_reason = coalesce(p_revocation_reason, approval.approval_reason)
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
      'revokedAt', p_timestamp,
      'revocationReason', case when p_revocation_reason is null then null else btrim(p_revocation_reason) end
    )
  );
  return next updated_approval;
end;
$$;

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
  order by ar.created_at desc, ar.id desc
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
  order by ar.created_at desc, ar.id desc
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
      'privacyReviewStatus', selected_result.privacy_review_status,
      'resolutionReason', case when p_resolution_reason is null then null else btrim(p_resolution_reason) end
    )
  );

  return query select p_attachment_id, selected_result.privacy_review_status, resolved_count;
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
declare
  existing_publication public.company_social_publications%rowtype;
  selected_connection public.company_social_connections%rowtype;
  selected_attachment public.job_attachments%rowtype;
  created_publication public.company_social_publications%rowtype;
  expected_intent bytea;
  safe_metadata jsonb := coalesce(p_publication_audit_metadata, '{}'::jsonb);
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
    or (p_publication_kind = 'text_only' and (p_attachment_id is not null or p_safe_mime_type is not null or p_media_count <> 0 or safe_metadata <> '{}'::jsonb))
    or (p_publication_kind = 'single_photo' and (p_attachment_id is null or p_safe_mime_type not in ('image/jpeg', 'image/png') or p_media_count <> 1))
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or jsonb_typeof(safe_metadata) <> 'object'
    or safe_metadata::text ~* '(token|secret|signed|storage|private@example|coordinates|latitude|longitude)'
    or (p_publication_kind = 'single_photo' and not (
      safe_metadata ?& array[
        'analysisRunId', 'approvalId', 'approvedAt', 'revoked',
        'originalMime', 'detectedMime', 'sanitizedMime',
        'originalByteSize', 'sanitizedByteSize',
        'originalHashPrefix', 'sanitizedHashPrefix',
        'width', 'height', 'metadataStripped', 'gpsStripped',
        'sanitizer', 'sanitizerVersion'
      ]
    )) then
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
    safe_metadata || jsonb_build_object(
      'channel', 'Facebook', 'status', 'publishing', 'publicationKind', p_publication_kind,
      'mediaCount', p_media_count, 'messageCharacterCount', char_length(p_approved_message),
      'attachmentId', case when p_publication_kind = 'single_photo' then p_attachment_id::text else null end,
      'providerCallCount', 0,
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

revoke all on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.revoke_company_facebook_publication_photo_approval(uuid, uuid, uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.revoke_company_facebook_publication_photo_approval(uuid, uuid, uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz) to service_role;
grant execute on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, jsonb, timestamptz) to service_role;

comment on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz) is
  'Begins a Facebook publication with sanitized publication audit metadata; latest single-photo media evidence remains authoritative.';
comment on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) is
  'Approves only the newest durable media analysis result for Facebook single-photo publication.';

-- META_FACEBOOK_SINGLE_PHOTO_LATEST_AUTHORITY_END
