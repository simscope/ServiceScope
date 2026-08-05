-- META_FACEBOOK_SINGLE_PHOTO_PUBLISH_REVIEW_FIX_BEGIN
alter table public.company_social_publications
  drop constraint if exists company_social_publications_state_shape_check,
  drop constraint if exists company_social_publications_error_category_check;

alter table public.company_social_publications
  add constraint company_social_publications_error_category_check
  check (provider_error_category is null or provider_error_category in (
    'INVALID_TOKEN',
    'MISSING_PERMISSION',
    'PAGE_UNAVAILABLE',
    'RATE_LIMITED',
    'PROVIDER_TEMPORARY_ERROR',
    'PROVIDER_REJECTED',
    'DELIVERY_UNKNOWN',
    'RESPONSE_MISSING_POST_ID',
    'RESPONSE_MISSING_MEDIA_ID'
  )),
  add constraint company_social_publications_state_shape_check
  check (
    (status = 'publishing'
      and attempts = 0
      and provider_post_id is null
      and provider_media_id is null
      and published_at is null
      and provider_http_status is null
      and provider_error_code is null
      and provider_error_subcode is null
      and provider_error_category is null
      and provider_is_transient is null
      and last_error_code is null)
    or (status = 'published'
      and attempts = 1
      and published_at is not null
      and provider_http_status is null
      and provider_error_code is null
      and provider_error_subcode is null
      and provider_error_category is null
      and provider_is_transient is null
      and last_error_code is null
      and (
        (publication_kind = 'text_only' and provider_post_id is not null and provider_media_id is null)
        or (publication_kind = 'single_photo' and provider_post_id is null and provider_media_id is not null)
      ))
    or (status = 'failed'
      and attempts = 1
      and provider_post_id is null
      and provider_media_id is null
      and published_at is null
      and provider_error_category is not null
      and last_error_code is not null)
    or (status = 'delivery_unknown'
      and attempts = 1
      and provider_post_id is null
      and provider_media_id is null
      and published_at is null
      and provider_error_category = 'DELIVERY_UNKNOWN'
      and last_error_code = 'META_PUBLICATION_DELIVERY_UNKNOWN')
  );

create table if not exists public.company_media_analysis_runs (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  correlation_id text not null,
  status text not null,
  provider text not null,
  model text,
  analysis_version text not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_media_analysis_runs_status_check
    check (status in ('completed', 'failed')),
  constraint company_media_analysis_runs_correlation_check
    check (char_length(correlation_id) between 8 and 200 and correlation_id !~ '[[:cntrl:]<>]'),
  constraint company_media_analysis_runs_provider_check
    check (char_length(provider) between 1 and 120 and provider !~ '[[:cntrl:]<>]')
);

create table if not exists public.company_media_analysis_attachment_results (
  id uuid primary key,
  analysis_run_id uuid not null references public.company_media_analysis_runs(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  attachment_id uuid not null references public.job_attachments(id) on delete cascade,
  attachment_sha256 bytea not null,
  detected_mime_type text not null,
  analysis_status text not null,
  privacy_review_status text not null,
  excluded boolean not null default false,
  created_at timestamptz not null default now(),
  constraint company_media_analysis_attachment_sha256_check
    check (octet_length(attachment_sha256) = 32),
  constraint company_media_analysis_attachment_mime_check
    check (detected_mime_type in ('image/jpeg', 'image/png')),
  constraint company_media_analysis_attachment_privacy_check
    check (privacy_review_status in ('passed', 'blocked', 'resolved_false_positive')),
  constraint company_media_analysis_attachment_status_check
    check (analysis_status in ('analyzed', 'metadata_only', 'manual_review'))
);

create index if not exists company_media_analysis_attachment_latest_idx
  on public.company_media_analysis_attachment_results (company_id, job_id, attachment_id, created_at desc);

create table if not exists public.company_media_analysis_privacy_findings (
  id uuid primary key,
  analysis_run_id uuid not null references public.company_media_analysis_runs(id) on delete cascade,
  attachment_result_id uuid not null references public.company_media_analysis_attachment_results(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  attachment_id uuid not null references public.job_attachments(id) on delete cascade,
  finding_id text not null,
  finding_category text not null,
  risk_level text not null,
  resolved_as_false_positive boolean not null default false,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint company_media_analysis_privacy_finding_safe_check
    check (
      finding_id !~ '[[:cntrl:]<>]'
      and finding_category ~ '^[a-z0-9_]{2,80}$'
      and risk_level in ('low', 'medium', 'high')
    ),
  constraint company_media_analysis_privacy_resolution_check
    check (
      (resolved_as_false_positive = false and resolved_by is null and resolved_at is null)
      or (resolved_as_false_positive = true and resolved_by is not null and resolved_at is not null)
    )
);

alter table public.company_media_analysis_runs enable row level security;
alter table public.company_media_analysis_attachment_results enable row level security;
alter table public.company_media_analysis_privacy_findings enable row level security;
revoke all on public.company_media_analysis_runs from public, anon, authenticated;
revoke all on public.company_media_analysis_attachment_results from public, anon, authenticated;
revoke all on public.company_media_analysis_privacy_findings from public, anon, authenticated;
grant select, insert, update on public.company_media_analysis_runs to service_role;
grant select, insert, update on public.company_media_analysis_attachment_results to service_role;
grant select, insert, update on public.company_media_analysis_privacy_findings to service_role;

alter table public.company_social_publication_media_approvals
  add constraint company_social_publication_media_approvals_analysis_run_fk
    foreign key (analysis_run_id) references public.company_media_analysis_runs(id) on delete restrict;

drop function if exists public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz);

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
  where ar.company_id = p_company_id
    and ar.job_id = p_job_id
    and ar.attachment_id = p_attachment_id
    and ar.attachment_sha256 = p_attachment_sha256
    and ar.detected_mime_type = p_attachment_mime_type
    and ar.excluded = false
    and ar.analysis_status in ('analyzed', 'metadata_only')
    and ar.privacy_review_status in ('passed', 'resolved_false_positive')
    and run.status = 'completed'
    and run.company_id = p_company_id
    and run.job_id = p_job_id
  order by ar.created_at desc
  limit 1;
  if not found then raise exception 'media analysis evidence required'; end if;

  if exists (
    select 1
    from public.company_media_analysis_privacy_findings finding
    where finding.attachment_result_id = selected_result.id
      and finding.resolved_as_false_positive = false
  ) then
    raise exception 'unresolved media privacy finding';
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
    and revoked_at is null;

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
      'approvalId', approved_row.id::text
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

  update public.company_social_publication_media_approvals
  set approval_status = 'revoked',
      revoked_by = p_actor_id,
      revoked_at = p_timestamp,
      updated_at = p_timestamp,
      approval_reason = coalesce(p_revocation_reason, approval_reason)
  where id = (
    select id
    from public.company_social_publication_media_approvals
    where company_id = p_company_id
      and job_id = p_job_id
      and attachment_id = p_attachment_id
      and approval_status = 'approved'
      and revoked_at is null
    order by approved_at desc
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
      'revokedAt', p_timestamp
    )
  );
  return next updated_approval;
end;
$$;

drop function if exists public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, timestamptz);
drop function if exists public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz);

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
      'providerMediaId', case when updated_publication.publication_kind = 'single_photo' then updated_publication.provider_media_id else null end,
      'providerPostId', case when updated_publication.publication_kind = 'text_only' then updated_publication.provider_post_id else null end,
      'singlePhotoProviderPostIdNull', updated_publication.publication_kind = 'single_photo' and updated_publication.provider_post_id is null,
      'intentHashPrefix', encode(substring(updated_publication.publication_intent_sha256 from 1 for 8), 'hex'),
      'attempts', 1
    ) || safe_metadata
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
      'PROVIDER_TEMPORARY_ERROR', 'PROVIDER_REJECTED', 'RESPONSE_MISSING_POST_ID',
      'RESPONSE_MISSING_MEDIA_ID'
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
    jsonb_build_object(
      'channel', 'Facebook', 'status', 'failed',
      'publicationKind', updated_publication.publication_kind,
      'mediaCount', updated_publication.media_count,
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

revoke all on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.revoke_company_facebook_publication_photo_approval(uuid, uuid, uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, timestamptz) from public, anon, authenticated;
grant execute on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.revoke_company_facebook_publication_photo_approval(uuid, uuid, uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, timestamptz) to service_role;

comment on table public.company_media_analysis_runs is
  'Server-only durable media-analysis run evidence for publication media approval.';
comment on table public.company_media_analysis_attachment_results is
  'Server-only durable media-analysis attachment evidence with exact checksum and privacy review state.';
comment on function public.revoke_company_facebook_publication_photo_approval(uuid, uuid, uuid, uuid, text, text, text, timestamptz) is
  'Revokes the active server-only Facebook publication photo approval for an exact company/job attachment.';
comment on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) is
  'Completes one Facebook publication and writes bounded server-derived publication media audit metadata.';
-- META_FACEBOOK_SINGLE_PHOTO_PUBLISH_REVIEW_FIX_END
