-- META_FACEBOOK_SCHEDULED_PUBLICATION_FOUNDATION_BEGIN

alter table public.company_social_publications
  add column if not exists scheduled_for timestamptz,
  add column if not exists scheduled_timezone text,
  add column if not exists scheduled_attachment_sha256 bytea,
  add column if not exists scheduled_analysis_run_id uuid references public.company_media_analysis_runs(id) on delete restrict,
  add column if not exists scheduled_attachment_result_id uuid references public.company_media_analysis_attachment_results(id) on delete restrict,
  add column if not exists scheduled_approval_id uuid references public.company_social_publication_media_approvals(id) on delete restrict,
  add column if not exists scheduled_facebook_page_id text,
  add column if not exists scheduled_by_name text,
  add column if not exists scheduled_by_role text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete restrict,
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists execution_attempts integer not null default 0,
  add column if not exists last_scheduler_error_code text;

alter table public.company_social_publications
  drop constraint if exists company_social_publications_status_check,
  drop constraint if exists company_social_publications_state_shape_check,
  drop constraint if exists company_social_publications_scheduled_timezone_check,
  drop constraint if exists company_social_publications_scheduled_sha_check,
  drop constraint if exists company_social_publications_scheduled_page_check,
  drop constraint if exists company_social_publications_scheduled_actor_check,
  drop constraint if exists company_social_publications_claim_shape_check,
  drop constraint if exists company_social_publications_execution_attempts_check,
  drop constraint if exists company_social_publications_scheduler_error_check;

alter table public.company_social_publications
  add constraint company_social_publications_status_check
    check (status in ('scheduled', 'publishing', 'published', 'failed', 'delivery_unknown', 'cancelled')),
  add constraint company_social_publications_scheduled_timezone_check
    check (scheduled_timezone is null or (
      char_length(scheduled_timezone) between 1 and 80
      and scheduled_timezone ~ '^[A-Za-z][A-Za-z0-9_./+-]{0,79}$'
      and scheduled_timezone not like '%..%'
    )),
  add constraint company_social_publications_scheduled_sha_check
    check (scheduled_attachment_sha256 is null or octet_length(scheduled_attachment_sha256) = 32),
  add constraint company_social_publications_scheduled_page_check
    check (scheduled_facebook_page_id is null or (
      char_length(scheduled_facebook_page_id) between 1 and 40
      and scheduled_facebook_page_id ~ '^[0-9]+$'
    )),
  add constraint company_social_publications_scheduled_actor_check
    check (
      (scheduled_by_name is null and scheduled_by_role is null)
      or (
        scheduled_by_name is not null
        and char_length(btrim(scheduled_by_name)) between 1 and 120
        and scheduled_by_name !~ '[[:cntrl:]<>]'
        and scheduled_by_role is not null
        and char_length(btrim(scheduled_by_role)) between 1 and 80
        and scheduled_by_role !~ '[[:cntrl:]<>]'
      )
    ),
  add constraint company_social_publications_claim_shape_check
    check (
      (claim_token is null and claimed_at is null and claim_expires_at is null)
      or (
        status = 'scheduled'
        and claim_token is not null
        and claimed_at is not null
        and claim_expires_at is not null
        and claim_expires_at > claimed_at
      )
    ),
  add constraint company_social_publications_execution_attempts_check
    check (execution_attempts between 0 and 100),
  add constraint company_social_publications_scheduler_error_check
    check (
      last_scheduler_error_code is null
      or last_scheduler_error_code = 'META_SCHEDULE_REVALIDATION_FAILED'
    ),
  add constraint company_social_publications_state_shape_check
  check (
    (status = 'scheduled'
      and attempts = 0
      and provider_post_id is null
      and provider_media_id is null
      and published_at is null
      and provider_http_status is null
      and provider_error_code is null
      and provider_error_subcode is null
      and provider_error_category is null
      and provider_is_transient is null
      and last_error_code is null
      and last_scheduler_error_code is null
      and scheduled_for is not null
      and scheduled_timezone is not null
      and scheduled_facebook_page_id is not null
      and scheduled_by_name is not null
      and scheduled_by_role is not null
      and cancelled_at is null
      and cancelled_by is null
      and next_attempt_at is not null
      and (
        (publication_kind = 'text_only'
          and attachment_id is null
          and safe_mime_type is null
          and media_count = 0
          and scheduled_attachment_sha256 is null
          and scheduled_analysis_run_id is null
          and scheduled_attachment_result_id is null
          and scheduled_approval_id is null)
        or (publication_kind = 'single_photo'
          and attachment_id is not null
          and safe_mime_type in ('image/jpeg', 'image/png')
          and media_count = 1
          and scheduled_attachment_sha256 is not null
          and scheduled_analysis_run_id is not null
          and scheduled_attachment_result_id is not null
          and scheduled_approval_id is not null)
      ))
    or (status = 'publishing'
      and attempts = 0
      and provider_post_id is null
      and provider_media_id is null
      and published_at is null
      and provider_http_status is null
      and provider_error_code is null
      and provider_error_subcode is null
      and provider_error_category is null
      and provider_is_transient is null
      and last_error_code is null
      and last_scheduler_error_code is null
      and claim_token is null
      and claimed_at is null
      and claim_expires_at is null
      and next_attempt_at is null
      and cancelled_at is null
      and cancelled_by is null)
    or (status = 'published'
      and attempts = 1
      and published_at is not null
      and provider_http_status is null
      and provider_error_code is null
      and provider_error_subcode is null
      and provider_error_category is null
      and provider_is_transient is null
      and last_error_code is null
      and last_scheduler_error_code is null
      and claim_token is null
      and claimed_at is null
      and claim_expires_at is null
      and next_attempt_at is null
      and cancelled_at is null
      and cancelled_by is null
      and (
        (publication_kind = 'text_only' and provider_post_id is not null and provider_media_id is null)
        or (publication_kind = 'single_photo' and provider_post_id is null and provider_media_id is not null)
      ))
    or (status = 'failed'
      and provider_post_id is null
      and provider_media_id is null
      and published_at is null
      and claim_token is null
      and claimed_at is null
      and claim_expires_at is null
      and next_attempt_at is null
      and cancelled_at is null
      and cancelled_by is null
      and (
        (attempts = 1
          and provider_error_category is not null
          and last_error_code is not null
          and last_scheduler_error_code is null)
        or (attempts = 0
          and scheduled_for is not null
          and provider_http_status is null
          and provider_error_code is null
          and provider_error_subcode is null
          and provider_error_category is null
          and provider_is_transient is null
          and last_error_code = 'META_SCHEDULE_REVALIDATION_FAILED'
          and last_scheduler_error_code = 'META_SCHEDULE_REVALIDATION_FAILED')
      ))
    or (status = 'delivery_unknown'
      and attempts = 1
      and provider_post_id is null
      and provider_media_id is null
      and published_at is null
      and provider_error_category = 'DELIVERY_UNKNOWN'
      and last_error_code = 'META_PUBLICATION_DELIVERY_UNKNOWN'
      and last_scheduler_error_code is null
      and claim_token is null
      and claimed_at is null
      and claim_expires_at is null
      and next_attempt_at is null
      and cancelled_at is null
      and cancelled_by is null)
    or (status = 'cancelled'
      and attempts = 0
      and provider_post_id is null
      and provider_media_id is null
      and published_at is null
      and provider_http_status is null
      and provider_error_code is null
      and provider_error_subcode is null
      and provider_error_category is null
      and provider_is_transient is null
      and last_error_code is null
      and last_scheduler_error_code is null
      and scheduled_for is not null
      and scheduled_timezone is not null
      and scheduled_facebook_page_id is not null
      and cancelled_at is not null
      and cancelled_by is not null
      and claim_token is null
      and claimed_at is null
      and claim_expires_at is null
      and next_attempt_at is null)
  );

create index if not exists company_social_publications_scheduled_due_idx
  on public.company_social_publications (next_attempt_at, scheduled_for, created_at, id)
  where status = 'scheduled';

create index if not exists company_social_publications_scheduled_lookup_idx
  on public.company_social_publications (company_id, job_id, status, scheduled_for desc)
  where scheduled_for is not null;

create or replace function public.schedule_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_job_id uuid,
  p_idempotency_key uuid,
  p_approved_message text,
  p_publication_kind text,
  p_attachment_id uuid,
  p_attachment_sha256 bytea,
  p_analysis_run_id uuid,
  p_attachment_result_id uuid,
  p_approval_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_scheduled_for timestamptz,
  p_scheduled_timezone text,
  p_timestamp timestamptz
)
returns table (
  publication_id uuid,
  publication_status text,
  publication_scheduled_for timestamptz,
  publication_last_error_code text,
  should_schedule boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_connection public.company_social_connections%rowtype;
  selected_attachment public.job_attachments%rowtype;
  selected_result public.company_media_analysis_attachment_results%rowtype;
  selected_approval public.company_social_publication_media_approvals%rowtype;
  existing_publication public.company_social_publications%rowtype;
  created_publication public.company_social_publications%rowtype;
  computed_message_sha256 bytea;
  computed_intent_sha256 bytea;
  computed_safe_mime_type text;
  computed_media_count smallint;
begin
  if p_timestamp is null
    or p_scheduled_for is null
    or p_scheduled_for <= p_timestamp
    or p_scheduled_for > p_timestamp + interval '366 days'
    or p_scheduled_timezone is null
    or char_length(p_scheduled_timezone) not between 1 and 80
    or p_scheduled_timezone !~ '^[A-Za-z][A-Za-z0-9_./+-]{0,79}$'
    or p_scheduled_timezone like '%..%'
    or not exists (select 1 from pg_timezone_names where name = p_scheduled_timezone)
    or p_publication_kind not in ('text_only', 'single_photo')
    or p_approved_message is null
    or p_approved_message <> btrim(p_approved_message)
    or char_length(p_approved_message) not between 1 and 5000
    or translate(p_approved_message, E'\n', '') ~ '[[:cntrl:]]'
    or lower(p_approved_message) like '%[private]%'
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_name ~ '[[:cntrl:]<>]'
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or p_actor_role ~ '[[:cntrl:]<>]' then
    raise exception 'invalid scheduled publication request';
  end if;

  perform 1 from public.companies where id = p_company_id for update;
  if not found then raise exception 'company not found'; end if;

  perform 1
  from public.jobs
  where id = p_job_id
    and company_id = p_company_id
    and status::text in ('Completed', 'Warranty')
  for update;
  if not found then raise exception 'invalid scheduled publication job'; end if;

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
    raise exception 'facebook scheduling unavailable';
  end if;

  if p_publication_kind = 'text_only' then
    if p_attachment_id is not null
      or p_attachment_sha256 is not null
      or p_analysis_run_id is not null
      or p_attachment_result_id is not null
      or p_approval_id is not null then
      raise exception 'invalid text-only schedule media fields';
    end if;
    computed_safe_mime_type := null;
    computed_media_count := 0;
  else
    if p_attachment_id is null
      or octet_length(p_attachment_sha256) <> 32
      or p_analysis_run_id is null
      or p_attachment_result_id is null
      or p_approval_id is null then
      raise exception 'invalid scheduled photo request';
    end if;

    select * into selected_attachment
    from public.job_attachments
    where id = p_attachment_id
      and company_id = p_company_id
      and job_id = p_job_id
    for key share;
    if not found
      or selected_attachment.kind::text = 'video'
      or lower(selected_attachment.mime_type) not in ('image/jpeg', 'image/png')
      or selected_attachment.size_bytes not between 1 and 12000000
      or selected_attachment.storage_bucket is null
      or selected_attachment.storage_path is null then
      raise exception 'invalid scheduled photo attachment';
    end if;

    select ar.* into selected_result
    from public.company_media_analysis_attachment_results ar
    join public.company_media_analysis_runs run
      on run.id = ar.analysis_run_id
      and run.company_id = p_company_id
      and run.job_id = p_job_id
      and run.status = 'completed'
    where ar.id = p_attachment_result_id
      and ar.analysis_run_id = p_analysis_run_id
      and ar.company_id = p_company_id
      and ar.job_id = p_job_id
      and ar.attachment_id = p_attachment_id
      and ar.attachment_sha256 = p_attachment_sha256
      and ar.detected_mime_type = lower(selected_attachment.mime_type)
      and ar.excluded = false
      and ar.analysis_status in ('analyzed', 'metadata_only')
      and ar.privacy_review_status in ('passed', 'resolved_false_positive')
      and not exists (
        select 1
        from public.company_media_analysis_attachment_results newer
        where newer.company_id = p_company_id
          and newer.job_id = p_job_id
          and newer.attachment_id = p_attachment_id
          and (newer.created_at, newer.id) > (ar.created_at, ar.id)
      )
    for key share;
    if not found then raise exception 'scheduled media analysis evidence unavailable'; end if;

    select * into selected_approval
    from public.company_social_publication_media_approvals approval
    where approval.id = p_approval_id
      and approval.company_id = p_company_id
      and approval.job_id = p_job_id
      and approval.attachment_id = p_attachment_id
      and approval.analysis_run_id = p_analysis_run_id
      and approval.attachment_sha256 = p_attachment_sha256
      and approval.attachment_mime_type = lower(selected_attachment.mime_type)
      and approval.approval_status = 'approved'
      and approval.revoked_at is null
    for key share;
    if not found then raise exception 'scheduled media approval unavailable'; end if;

    if exists (
      select 1
      from public.company_media_analysis_privacy_findings finding
      where finding.attachment_result_id = selected_result.id
        and finding.company_id = p_company_id
        and finding.job_id = p_job_id
        and finding.attachment_id = p_attachment_id
        and finding.resolved_as_false_positive = false
    ) then
      raise exception 'unresolved scheduled media privacy finding';
    end if;

    computed_safe_mime_type := lower(selected_attachment.mime_type);
    computed_media_count := 1;
  end if;

  computed_message_sha256 := sha256(convert_to(p_approved_message, 'UTF8'));
  computed_intent_sha256 := sha256(convert_to(concat_ws(E'\n',
    'facebook_scheduled_publication_intent_v1',
    'meta-facebook-login',
    'Facebook',
    p_company_id::text,
    p_job_id::text,
    p_connection_id::text,
    selected_connection.facebook_page_id,
    p_actor_id::text,
    p_publication_kind,
    p_approved_message,
    case when p_publication_kind = 'single_photo' then p_attachment_id::text else '' end,
    to_char(p_scheduled_for at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    p_scheduled_timezone
  ), 'UTF8'));

  select * into existing_publication
  from public.company_social_publications
  where company_id = p_company_id
    and publication_intent_sha256 = computed_intent_sha256;

  if found then
    return query select
      existing_publication.id,
      existing_publication.status,
      existing_publication.scheduled_for,
      existing_publication.last_error_code,
      false;
    return;
  end if;

  insert into public.company_social_publications (
    id, company_id, connection_id, job_id, provider, channel, status,
    idempotency_key, publication_intent_sha256, approved_message, message_sha256,
    publication_kind, attachment_id, safe_mime_type, media_count, approved_by,
    approved_at, scheduled_for, scheduled_timezone, scheduled_attachment_sha256,
    scheduled_analysis_run_id, scheduled_attachment_result_id, scheduled_approval_id,
    scheduled_facebook_page_id, scheduled_by_name, scheduled_by_role,
    next_attempt_at, execution_attempts, created_at, updated_at
  ) values (
    p_publication_id, p_company_id, p_connection_id, p_job_id, 'meta-facebook-login', 'Facebook', 'scheduled',
    p_idempotency_key, computed_intent_sha256, p_approved_message, computed_message_sha256,
    p_publication_kind, p_attachment_id, computed_safe_mime_type, computed_media_count, p_actor_id,
    p_timestamp, p_scheduled_for, p_scheduled_timezone, p_attachment_sha256,
    p_analysis_run_id, p_attachment_result_id, p_approval_id,
    selected_connection.facebook_page_id, btrim(p_actor_name), btrim(p_actor_role),
    p_scheduled_for, 0, p_timestamp, p_timestamp
  )
  returning * into created_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_scheduled', 'meta_social_publication', 'Facebook publication',
    created_publication.id::text, 'Facebook publication',
    'Meta publication scheduled.',
    jsonb_build_object(
      'channel', 'Facebook',
      'status', 'scheduled',
      'publicationKind', created_publication.publication_kind,
      'mediaCount', created_publication.media_count,
      'messageCharacterCount', char_length(created_publication.approved_message),
      'scheduledFor', created_publication.scheduled_for,
      'scheduledTimezone', created_publication.scheduled_timezone,
      'attachmentId', case when created_publication.publication_kind = 'single_photo' then created_publication.attachment_id::text else null end,
      'intentHashPrefix', encode(substring(created_publication.publication_intent_sha256 from 1 for 8), 'hex'),
      'providerCallCount', 0
    )
  );

  return query select created_publication.id, created_publication.status, created_publication.scheduled_for, created_publication.last_error_code, true;
end;
$$;

create or replace function public.cancel_scheduled_company_facebook_publication(
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
  selected_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
begin
  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_name ~ '[[:cntrl:]<>]'
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or p_actor_role ~ '[[:cntrl:]<>]'
    or p_timestamp is null then
    raise exception 'invalid schedule cancellation request';
  end if;

  select * into selected_publication
  from public.company_social_publications
  where id = p_publication_id
    and company_id = p_company_id
  for update;
  if not found then raise exception 'scheduled publication not found'; end if;

  if selected_publication.status = 'cancelled' then
    return next selected_publication;
    return;
  end if;
  if selected_publication.status <> 'scheduled' then
    raise exception 'invalid scheduled publication cancellation';
  end if;

  update public.company_social_publications
  set status = 'cancelled',
      cancelled_at = p_timestamp,
      cancelled_by = p_actor_id,
      claim_token = null,
      claimed_at = null,
      claim_expires_at = null,
      next_attempt_at = null,
      updated_at = p_timestamp
  where id = selected_publication.id
  returning * into updated_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_schedule_cancelled', 'meta_social_publication', 'Facebook publication',
    updated_publication.id::text, 'Facebook publication',
    'Meta scheduled publication cancelled.',
    jsonb_build_object(
      'channel', 'Facebook',
      'status', 'cancelled',
      'publicationKind', updated_publication.publication_kind,
      'mediaCount', updated_publication.media_count,
      'scheduledFor', updated_publication.scheduled_for,
      'scheduledTimezone', updated_publication.scheduled_timezone,
      'attachmentId', case when updated_publication.publication_kind = 'single_photo' then updated_publication.attachment_id::text else null end,
      'intentHashPrefix', encode(substring(updated_publication.publication_intent_sha256 from 1 for 8), 'hex'),
      'providerCallCount', 0
    )
  );

  return next updated_publication;
end;
$$;

create or replace function public.claim_due_company_facebook_publications(
  p_now timestamptz,
  p_lease_seconds integer default 120,
  p_limit integer default 10
)
returns table (
  publication_id uuid,
  company_id uuid,
  connection_id uuid,
  job_id uuid,
  publication_kind text,
  attachment_id uuid,
  scheduled_for timestamptz,
  scheduled_timezone text,
  claim_token uuid,
  claim_expires_at timestamptz,
  execution_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_now is null
    or p_lease_seconds not between 30 and 900
    or p_limit not between 1 and 50 then
    raise exception 'invalid scheduled publication claim request';
  end if;

  return query
  with due as (
    select publication.id
    from public.company_social_publications publication
    where publication.status = 'scheduled'
      and publication.scheduled_for <= p_now
      and publication.next_attempt_at <= p_now
      and (publication.claim_token is null or publication.claim_expires_at <= p_now)
    order by publication.scheduled_for asc, publication.created_at asc, publication.id asc
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.company_social_publications publication
    set claim_token = gen_random_uuid(),
        claimed_at = p_now,
        claim_expires_at = p_now + make_interval(secs => p_lease_seconds),
        execution_attempts = publication.execution_attempts + 1,
        updated_at = p_now
    from due
    where publication.id = due.id
    returning publication.*
  )
  select
    claimed.id,
    claimed.company_id,
    claimed.connection_id,
    claimed.job_id,
    claimed.publication_kind,
    claimed.attachment_id,
    claimed.scheduled_for,
    claimed.scheduled_timezone,
    claimed.claim_token,
    claimed.claim_expires_at,
    claimed.execution_attempts
  from claimed
  order by claimed.scheduled_for asc, claimed.created_at asc, claimed.id asc;
end;
$$;

create or replace function public.release_scheduled_company_facebook_publication_claim(
  p_publication_id uuid,
  p_company_id uuid,
  p_claim_token uuid,
  p_next_attempt_at timestamptz,
  p_now timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_publication public.company_social_publications%rowtype;
begin
  if p_now is null
    or p_next_attempt_at is null
    or p_next_attempt_at <= p_now
    or p_next_attempt_at > p_now + interval '1 day' then
    raise exception 'invalid scheduled publication release request';
  end if;

  update public.company_social_publications
  set claim_token = null,
      claimed_at = null,
      claim_expires_at = null,
      next_attempt_at = p_next_attempt_at,
      updated_at = p_now
  where id = p_publication_id
    and company_id = p_company_id
    and status = 'scheduled'
    and claim_token = p_claim_token
    and claim_expires_at > p_now
  returning * into updated_publication;
  if not found then raise exception 'invalid scheduled publication claim release'; end if;

  return next updated_publication;
end;
$$;

create or replace function public.fail_scheduled_company_facebook_publication_preflight(
  p_publication_id uuid,
  p_company_id uuid,
  p_claim_token uuid,
  p_actor_name text,
  p_actor_role text,
  p_now timestamptz
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
  if p_now is null then raise exception 'invalid scheduled publication preflight failure request'; end if;

  select * into locked_publication
  from public.company_social_publications
  where id = p_publication_id
    and company_id = p_company_id
    and status = 'scheduled'
    and claim_token = p_claim_token
    and claim_expires_at > p_now
  for update;
  if not found then raise exception 'invalid scheduled publication preflight failure'; end if;

  update public.company_social_publications
  set status = 'failed',
      attempts = 0,
      provider_post_id = null,
      provider_media_id = null,
      provider_http_status = null,
      provider_error_code = null,
      provider_error_subcode = null,
      provider_error_category = null,
      provider_is_transient = null,
      last_error_code = 'META_SCHEDULE_REVALIDATION_FAILED',
      last_scheduler_error_code = 'META_SCHEDULE_REVALIDATION_FAILED',
      claim_token = null,
      claimed_at = null,
      claim_expires_at = null,
      next_attempt_at = null,
      published_at = null,
      updated_at = p_now
  where id = locked_publication.id
  returning * into updated_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, locked_publication.approved_by, btrim(coalesce(nullif(p_actor_name, ''), locked_publication.scheduled_by_name)),
    btrim(coalesce(nullif(p_actor_role, ''), locked_publication.scheduled_by_role)), 'access',
    'meta_publication_schedule_failed', 'meta_social_publication', 'Facebook publication',
    updated_publication.id::text, 'Facebook publication',
    'Meta scheduled publication failed before provider call.',
    jsonb_build_object(
      'channel', 'Facebook',
      'status', 'failed',
      'publicationKind', updated_publication.publication_kind,
      'mediaCount', updated_publication.media_count,
      'scheduledFor', updated_publication.scheduled_for,
      'scheduledTimezone', updated_publication.scheduled_timezone,
      'attachmentId', case when updated_publication.publication_kind = 'single_photo' then updated_publication.attachment_id::text else null end,
      'intentHashPrefix', encode(substring(updated_publication.publication_intent_sha256 from 1 for 8), 'hex'),
      'providerCallCount', 0,
      'attempts', 0,
      'errorCode', 'META_SCHEDULE_REVALIDATION_FAILED'
    )
  );

  return next updated_publication;
end;
$$;

create or replace function public.start_scheduled_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_claim_token uuid,
  p_now timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_publication public.company_social_publications%rowtype;
  selected_connection public.company_social_connections%rowtype;
  selected_attachment public.job_attachments%rowtype;
  selected_result public.company_media_analysis_attachment_results%rowtype;
  selected_approval public.company_social_publication_media_approvals%rowtype;
  updated_publication public.company_social_publications%rowtype;
begin
  if p_now is null then raise exception 'invalid scheduled publication start request'; end if;

  select * into locked_publication
  from public.company_social_publications
  where id = p_publication_id
    and company_id = p_company_id
    and status = 'scheduled'
    and claim_token = p_claim_token
    and claim_expires_at > p_now
    and scheduled_for <= p_now
  for update;
  if not found then raise exception 'invalid scheduled publication start'; end if;

  perform 1
  from public.jobs
  where id = locked_publication.job_id
    and company_id = locked_publication.company_id
    and status::text in ('Completed', 'Warranty')
  for key share;
  if not found then raise exception 'scheduled publication job unavailable'; end if;

  select * into selected_connection
  from public.company_social_connections
  where id = locked_publication.connection_id
    and company_id = locked_publication.company_id
    and provider = 'meta-facebook-login'
  for key share;
  if not found
    or selected_connection.status <> 'connected'
    or selected_connection.facebook_page_id <> locked_publication.scheduled_facebook_page_id
    or selected_connection.token_envelope is null
    or not ('pages_manage_posts' = any(selected_connection.granted_scopes)) then
    raise exception 'scheduled publication connection unavailable';
  end if;

  if locked_publication.publication_kind = 'single_photo' then
    select * into selected_attachment
    from public.job_attachments
    where id = locked_publication.attachment_id
      and company_id = locked_publication.company_id
      and job_id = locked_publication.job_id
    for key share;
    if not found
      or selected_attachment.kind::text = 'video'
      or lower(selected_attachment.mime_type) <> locked_publication.safe_mime_type
      or selected_attachment.size_bytes not between 1 and 12000000
      or selected_attachment.storage_bucket is null
      or selected_attachment.storage_path is null then
      raise exception 'scheduled publication attachment unavailable';
    end if;

    select ar.* into selected_result
    from public.company_media_analysis_attachment_results ar
    join public.company_media_analysis_runs run
      on run.id = ar.analysis_run_id
      and run.company_id = locked_publication.company_id
      and run.job_id = locked_publication.job_id
      and run.status = 'completed'
    where ar.id = locked_publication.scheduled_attachment_result_id
      and ar.analysis_run_id = locked_publication.scheduled_analysis_run_id
      and ar.company_id = locked_publication.company_id
      and ar.job_id = locked_publication.job_id
      and ar.attachment_id = locked_publication.attachment_id
      and ar.attachment_sha256 = locked_publication.scheduled_attachment_sha256
      and ar.detected_mime_type = locked_publication.safe_mime_type
      and ar.excluded = false
      and ar.analysis_status in ('analyzed', 'metadata_only')
      and ar.privacy_review_status in ('passed', 'resolved_false_positive')
      and not exists (
        select 1
        from public.company_media_analysis_attachment_results newer
        where newer.company_id = locked_publication.company_id
          and newer.job_id = locked_publication.job_id
          and newer.attachment_id = locked_publication.attachment_id
          and (newer.created_at, newer.id) > (ar.created_at, ar.id)
      )
    for key share;
    if not found then raise exception 'scheduled publication media evidence unavailable'; end if;

    select * into selected_approval
    from public.company_social_publication_media_approvals approval
    where approval.id = locked_publication.scheduled_approval_id
      and approval.company_id = locked_publication.company_id
      and approval.job_id = locked_publication.job_id
      and approval.attachment_id = locked_publication.attachment_id
      and approval.analysis_run_id = locked_publication.scheduled_analysis_run_id
      and approval.attachment_sha256 = locked_publication.scheduled_attachment_sha256
      and approval.attachment_mime_type = locked_publication.safe_mime_type
      and approval.approval_status = 'approved'
      and approval.revoked_at is null
    for key share;
    if not found then raise exception 'scheduled publication approval unavailable'; end if;

    if exists (
      select 1
      from public.company_media_analysis_privacy_findings finding
      where finding.attachment_result_id = selected_result.id
        and finding.company_id = locked_publication.company_id
        and finding.job_id = locked_publication.job_id
        and finding.attachment_id = locked_publication.attachment_id
        and finding.resolved_as_false_positive = false
    ) then
      raise exception 'scheduled publication privacy finding unresolved';
    end if;
  end if;

  update public.company_social_publications
  set status = 'publishing',
      claim_token = null,
      claimed_at = null,
      claim_expires_at = null,
      next_attempt_at = null,
      updated_at = p_now
  where id = locked_publication.id
  returning * into updated_publication;

  return next updated_publication;
end;
$$;

revoke all on function public.schedule_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, text, uuid, bytea, uuid, uuid, uuid, uuid, text, text, timestamptz, text, timestamptz) from public, anon, authenticated;
revoke all on function public.cancel_scheduled_company_facebook_publication(uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_due_company_facebook_publications(timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.release_scheduled_company_facebook_publication_claim(uuid, uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_scheduled_company_facebook_publication_preflight(uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.start_scheduled_company_facebook_publication(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;

grant execute on function public.schedule_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, text, uuid, bytea, uuid, uuid, uuid, uuid, text, text, timestamptz, text, timestamptz) to service_role;
grant execute on function public.cancel_scheduled_company_facebook_publication(uuid, uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.claim_due_company_facebook_publications(timestamptz, integer, integer) to service_role;
grant execute on function public.release_scheduled_company_facebook_publication_claim(uuid, uuid, uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.fail_scheduled_company_facebook_publication_preflight(uuid, uuid, uuid, text, text, timestamptz) to service_role;
grant execute on function public.start_scheduled_company_facebook_publication(uuid, uuid, uuid, timestamptz) to service_role;

comment on function public.schedule_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, text, uuid, bytea, uuid, uuid, uuid, uuid, text, text, timestamptz, text, timestamptz) is
  'Creates an idempotent server-derived scheduled Facebook publication intent without calling Meta.';
comment on function public.claim_due_company_facebook_publications(timestamptz, integer, integer) is
  'Claims due scheduled Facebook publications with FOR UPDATE SKIP LOCKED while preserving provider attempts.';
comment on function public.start_scheduled_company_facebook_publication(uuid, uuid, uuid, timestamptz) is
  'Performs the final DB-only gate from scheduled to publishing immediately before a future provider call.';

-- META_FACEBOOK_SCHEDULED_PUBLICATION_FOUNDATION_END
