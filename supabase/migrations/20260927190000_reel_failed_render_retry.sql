begin;

alter table public.company_reel_render_jobs
  add column retry_of_render_job_id uuid,
  add column retry_ordinal smallint not null default 0;

alter table public.company_reel_render_jobs
  add constraint company_reel_render_jobs_retry_parent_identity_unique
    unique (id, company_id, job_id, creative_plan_id);

alter table public.company_reel_render_jobs
  add constraint company_reel_render_jobs_retry_parent_fk
    foreign key (retry_of_render_job_id, company_id, job_id, creative_plan_id)
    references public.company_reel_render_jobs (id, company_id, job_id, creative_plan_id)
    on delete restrict,
  add constraint company_reel_render_jobs_retry_shape_check check (
    (retry_ordinal = 0 and retry_of_render_job_id is null)
    or (retry_ordinal = 1 and retry_of_render_job_id is not null and retry_of_render_job_id <> id)
  ),
  add constraint company_reel_render_jobs_retry_identity_unique
    unique (retry_of_render_job_id, retry_ordinal);

create or replace function public.protect_company_reel_render_job_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.company_id, new.job_id, new.creative_plan_id, new.requested_by,
      new.render_fingerprint, new.renderer_version, new.retry_of_render_job_id,
      new.retry_ordinal, new.created_at)
    is distinct from
     (old.company_id, old.job_id, old.creative_plan_id, old.requested_by,
      old.render_fingerprint, old.renderer_version, old.retry_of_render_job_id,
      old.retry_ordinal, old.created_at) then
    raise exception 'Reel render job identity is immutable';
  end if;
  return new;
end;
$$;

create or replace function public.prepare_company_reel_render_retry(
  p_failed_render_job_id uuid,
  p_expected_plan_revision text
)
returns table (
  failed_render_job_id uuid,
  company_id uuid,
  job_id uuid,
  creative_plan_id uuid,
  retry_render_job_id uuid,
  retry_status text
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare source_job public.company_reel_render_jobs%rowtype;
declare plan public.company_reel_creative_plans%rowtype;
declare existing_retry public.company_reel_render_jobs%rowtype;
declare base_fingerprint text;
declare retry_fingerprint text;
declare current_renderer_version constant text := 'servicescope-reel-renderer-v2';
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into source_job
  from public.company_reel_render_jobs
  where id = p_failed_render_job_id;
  if not found then raise exception 'REEL_RENDER_RETRY_UNAVAILABLE'; end if;

  select * into plan
  from public.company_reel_creative_plans
  where id = source_job.creative_plan_id;
  if not found
    or plan.plan_revision <> p_expected_plan_revision
    or plan.company_id <> source_job.company_id
    or plan.job_id <> source_job.job_id
    or not public.can_manage_company_ai_assistant(plan.company_id) then
    raise exception 'REEL_RENDER_RETRY_UNAVAILABLE';
  end if;
  if not exists (
    select 1
    from public.company_reel_creative_plan_approvals approval
    where approval.creative_plan_id = plan.id
      and approval.company_id = plan.company_id
      and approval.job_id = plan.job_id
      and approval.plan_revision = plan.plan_revision
  ) then
    raise exception 'REEL_RENDER_APPROVAL_REQUIRED';
  end if;

  base_fingerprint := encode(sha256(convert_to(concat_ws(E'\n',
    'reel-render-fingerprint-v1', plan.plan_revision, plan.plan_json::text,
    current_renderer_version, 'reel-presentation-v1', 'mp4-h264-yuv420p-faststart-v1'
  ), 'UTF8')), 'hex');
  retry_fingerprint := encode(sha256(convert_to(base_fingerprint || ':retry:1', 'UTF8')), 'hex');

  if source_job.status <> 'failed'
    or source_job.error_code <> 'REEL_RENDER_CONTEXT_STALE'
    or source_job.retry_ordinal <> 0
    or source_job.retry_of_render_job_id is not null
    or source_job.renderer_version <> current_renderer_version
    or source_job.render_fingerprint <> base_fingerprint
    or source_job.output_bucket is not null
    or source_job.video_object_path is not null
    or source_job.cover_object_path is not null
    or source_job.video_sha256 is not null
    or source_job.cover_sha256 is not null
    or source_job.file_size is not null
    or source_job.cover_file_size is not null then
    raise exception 'REEL_RENDER_RETRY_UNAVAILABLE';
  end if;

  select * into existing_retry
  from public.company_reel_render_jobs retry
  where retry.retry_of_render_job_id = source_job.id
    and retry.retry_ordinal = 1;

  if existing_retry.id is not null then
    if existing_retry.company_id <> source_job.company_id
      or existing_retry.job_id <> source_job.job_id
      or existing_retry.creative_plan_id <> source_job.creative_plan_id
      or existing_retry.renderer_version <> source_job.renderer_version
      or existing_retry.render_fingerprint <> retry_fingerprint then
      raise exception 'REEL_RENDER_RETRY_UNAVAILABLE';
    end if;
  elsif exists (
    select 1
    from public.company_reel_render_jobs candidate
    where candidate.creative_plan_id = plan.id
      and candidate.id <> source_job.id
      and candidate.status in ('queued', 'rendering', 'completed')
  ) then
    raise exception 'REEL_RENDER_RETRY_UNAVAILABLE';
  end if;

  failed_render_job_id := source_job.id;
  company_id := source_job.company_id;
  job_id := source_job.job_id;
  creative_plan_id := source_job.creative_plan_id;
  retry_render_job_id := existing_retry.id;
  retry_status := existing_retry.status;
  return next;
end;
$$;

create or replace function public.begin_company_reel_render_retry(
  p_failed_render_job_id uuid,
  p_expected_plan_revision text
)
returns table (
  render_job_id uuid,
  status text,
  error_code text,
  created_at timestamptz,
  retry_of_render_job_id uuid,
  retry_ordinal smallint,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare prepared record;
declare source_job public.company_reel_render_jobs%rowtype;
declare result public.company_reel_render_jobs%rowtype;
declare retry_fingerprint text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into source_job
  from public.company_reel_render_jobs
  where id = p_failed_render_job_id
  for update;
  if not found then raise exception 'REEL_RENDER_RETRY_UNAVAILABLE'; end if;

  select * into prepared
  from public.prepare_company_reel_render_retry(p_failed_render_job_id, p_expected_plan_revision);
  if prepared.failed_render_job_id is null then
    raise exception 'REEL_RENDER_RETRY_UNAVAILABLE';
  end if;

  if prepared.retry_render_job_id is not null then
    select * into result
    from public.company_reel_render_jobs
    where id = prepared.retry_render_job_id;
    created := false;
  else
    retry_fingerprint := encode(sha256(convert_to(source_job.render_fingerprint || ':retry:1', 'UTF8')), 'hex');
    insert into public.company_reel_render_jobs (
      company_id, job_id, creative_plan_id, requested_by, status,
      render_fingerprint, renderer_version, retry_of_render_job_id, retry_ordinal
    ) values (
      source_job.company_id, source_job.job_id, source_job.creative_plan_id, auth.uid(), 'queued',
      retry_fingerprint, source_job.renderer_version, source_job.id, 1
    ) on conflict on constraint company_reel_render_jobs_retry_identity_unique do nothing
    returning * into result;
    created := result.id is not null;
    if result.id is null then
      select * into result
      from public.company_reel_render_jobs
      where retry_of_render_job_id = source_job.id and retry_ordinal = 1;
    end if;
  end if;

  if result.id is null then raise exception 'REEL_RENDER_RETRY_UNAVAILABLE'; end if;
  render_job_id := result.id;
  status := result.status;
  error_code := result.error_code;
  created_at := result.created_at;
  retry_of_render_job_id := result.retry_of_render_job_id;
  retry_ordinal := result.retry_ordinal;
  return next;
end;
$$;

drop function public.get_company_reel_workspace(uuid);

create function public.get_company_reel_workspace(p_job_id uuid)
returns table (
  creative_plan_id uuid, plan_revision text, plan_json jsonb, plan_created_at timestamptz,
  render_job_id uuid, render_status text, render_error_code text,
  duration_ms integer, width integer, height integer,
  render_created_at timestamptz, render_started_at timestamptz, render_completed_at timestamptz,
  render_retry_of_render_job_id uuid, render_retry_ordinal smallint,
  artifact_available boolean
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare target_company_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select company_id into target_company_id from public.jobs where id = p_job_id;
  if target_company_id is null or not public.can_access_company_ai_assistant(target_company_id) then
    raise exception 'FORBIDDEN';
  end if;
  return query
  select plan.id, plan.plan_revision, plan.plan_json, plan.created_at,
    render.id, render.status, render.error_code, render.duration_ms, render.width, render.height,
    render.created_at, render.started_at, render.completed_at,
    render.retry_of_render_job_id, render.retry_ordinal,
    render.status = 'completed'
  from public.company_reel_creative_plans plan
  left join lateral (
    select job.* from public.company_reel_render_jobs job
    where job.creative_plan_id = plan.id order by job.created_at desc, job.id desc limit 1
  ) render on true
  where plan.company_id = target_company_id and plan.job_id = p_job_id
  order by plan.created_at desc, plan.id desc limit 1;
end;
$$;

revoke all on function public.prepare_company_reel_render_retry(uuid,text) from public, anon;
grant execute on function public.prepare_company_reel_render_retry(uuid,text) to authenticated;
revoke all on function public.begin_company_reel_render_retry(uuid,text) from public, anon;
grant execute on function public.begin_company_reel_render_retry(uuid,text) to authenticated;
revoke all on function public.get_company_reel_workspace(uuid) from public, anon;
grant execute on function public.get_company_reel_workspace(uuid) to authenticated;

commit;
