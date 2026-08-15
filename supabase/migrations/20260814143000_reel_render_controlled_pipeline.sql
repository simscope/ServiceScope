begin;

create table public.company_reel_creative_plan_approvals (
  id uuid primary key default gen_random_uuid(),
  creative_plan_id uuid not null unique,
  company_id uuid not null,
  job_id uuid not null,
  plan_revision text not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default clock_timestamp(),
  constraint company_reel_creative_plan_approvals_plan_tenant_fk
    foreign key (creative_plan_id, company_id, job_id)
    references public.company_reel_creative_plans(id, company_id, job_id) on delete restrict,
  constraint company_reel_creative_plan_approvals_revision_check
    check (char_length(plan_revision) between 8 and 180 and plan_revision ~ '^[A-Za-z0-9:_-]+$')
);

create or replace function public.protect_company_reel_creative_plan_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Reel creative plan approvals are immutable';
end;
$$;

create trigger company_reel_creative_plan_approvals_immutable
before update or delete on public.company_reel_creative_plan_approvals
for each row execute function public.protect_company_reel_creative_plan_approval();

alter table public.company_reel_creative_plan_approvals enable row level security;
revoke all on public.company_reel_creative_plan_approvals from public, anon, authenticated;
grant select, insert on public.company_reel_creative_plan_approvals to service_role;

create or replace function public.approve_company_reel_creative_plan(
  p_creative_plan_id uuid,
  p_expected_plan_revision text
)
returns table (creative_plan_id uuid, plan_revision text, approved_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare plan public.company_reel_creative_plans%rowtype;
declare approval public.company_reel_creative_plan_approvals%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into plan
  from public.company_reel_creative_plans
  where id = p_creative_plan_id
  for key share;
  if not found or plan.plan_revision <> p_expected_plan_revision
    or not public.can_access_company_ai_assistant(plan.company_id) then
    raise exception 'REEL_RENDER_PLAN_UNAVAILABLE';
  end if;

  insert into public.company_reel_creative_plan_approvals (
    creative_plan_id, company_id, job_id, plan_revision, approved_by
  ) values (
    plan.id, plan.company_id, plan.job_id, plan.plan_revision, auth.uid()
  ) on conflict on constraint company_reel_creative_plan_approvals_creative_plan_id_key do nothing
  returning * into approval;

  if approval.id is null then
    select existing.* into approval
    from public.company_reel_creative_plan_approvals existing
    where existing.creative_plan_id = plan.id
      and existing.company_id = plan.company_id
      and existing.job_id = plan.job_id
      and existing.plan_revision = plan.plan_revision;
  end if;
  if approval.id is null then raise exception 'REEL_RENDER_APPROVAL_CONFLICT'; end if;

  creative_plan_id := approval.creative_plan_id;
  plan_revision := approval.plan_revision;
  approved_at := approval.approved_at;
  return next;
end;
$$;

create or replace function public.begin_company_reel_render_request(
  p_creative_plan_id uuid,
  p_expected_plan_revision text
)
returns table (render_job_id uuid, status text, error_code text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare plan public.company_reel_creative_plans%rowtype;
declare fingerprint text;
declare result public.company_reel_render_jobs%rowtype;
declare current_renderer_version constant text := 'servicescope-reel-renderer-v2';
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into plan from public.company_reel_creative_plans where id = p_creative_plan_id for key share;
  if not found or plan.plan_revision <> p_expected_plan_revision
    or not public.can_access_company_ai_assistant(plan.company_id) then
    raise exception 'REEL_RENDER_PLAN_UNAVAILABLE';
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
  fingerprint := encode(sha256(convert_to(concat_ws(E'\n',
    'reel-render-fingerprint-v1', plan.plan_revision, plan.plan_json::text,
    current_renderer_version, 'reel-presentation-v1', 'mp4-h264-yuv420p-faststart-v1'
  ), 'UTF8')), 'hex');
  insert into public.company_reel_render_jobs (
    company_id, job_id, creative_plan_id, requested_by, status,
    render_fingerprint, renderer_version
  ) values (
    plan.company_id, plan.job_id, plan.id, auth.uid(), 'queued',
    fingerprint, current_renderer_version
  ) on conflict (company_id, creative_plan_id, render_fingerprint) do nothing
  returning * into result;
  if result.id is null then
    select * into result from public.company_reel_render_jobs
    where company_id=plan.company_id and creative_plan_id=plan.id and render_fingerprint=fingerprint;
  end if;
  render_job_id := result.id; status := result.status; error_code := result.error_code; created_at := result.created_at;
  return next;
end;
$$;

alter table public.company_reel_render_jobs
  add column video_sha256 text,
  add column cover_sha256 text,
  add column cover_file_size bigint,
  drop constraint company_reel_render_jobs_error_check,
  add constraint company_reel_render_jobs_error_check
    check (error_code is null or error_code in (
      'REEL_RENDER_INVALID_PLAN','REEL_RENDER_UNAUTHORIZED','REEL_RENDER_AUDIO_UNSUPPORTED',
      'REEL_RENDER_MEDIA_INVALID','REEL_RENDER_MEDIA_MISSING','REEL_RENDER_TEXT_OVERFLOW',
      'REEL_RENDER_TIMEOUT','REEL_RENDER_FAILED','REEL_RENDER_OUTPUT_INVALID','REEL_RENDER_CONTEXT_STALE',
      'REEL_PRIVACY_FAILED'
    )),
  add constraint company_reel_render_jobs_artifact_integrity_check check (
    (status = 'completed'
      and video_sha256 ~ '^[0-9a-f]{64}$'
      and cover_sha256 ~ '^[0-9a-f]{64}$'
      and cover_file_size between 1 and 8388608)
    or (status <> 'completed'
      and video_sha256 is null
      and cover_sha256 is null
      and cover_file_size is null)
  );

drop function public.complete_company_reel_render_job(uuid,uuid,text,text,text,integer,integer,integer,integer,text,text,integer,bigint,boolean);

create function public.complete_company_reel_render_job(
  p_render_job_id uuid, p_lease_token uuid, p_output_bucket text,
  p_video_object_path text, p_cover_object_path text,
  p_duration_ms integer, p_width integer, p_height integer, p_fps integer,
  p_video_codec text, p_pixel_format text, p_audio_streams integer,
  p_file_size bigint, p_cover_file_size bigint,
  p_video_sha256 text, p_cover_sha256 text, p_faststart boolean
)
returns setof public.company_reel_render_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query update public.company_reel_render_jobs job set
    status='completed', leased_until=null, output_bucket=p_output_bucket,
    video_object_path=p_video_object_path, cover_object_path=p_cover_object_path,
    duration_ms=p_duration_ms, width=p_width, height=p_height, fps=p_fps,
    video_codec=p_video_codec, pixel_format=p_pixel_format, audio_streams=p_audio_streams,
    file_size=p_file_size, cover_file_size=p_cover_file_size,
    video_sha256=p_video_sha256, cover_sha256=p_cover_sha256,
    faststart=p_faststart, completed_at=clock_timestamp(), updated_at=clock_timestamp()
  where job.id=p_render_job_id and job.status='rendering' and job.lease_token=p_lease_token
    and job.leased_until > clock_timestamp()
    and p_output_bucket='company-reel-renders'
    and p_video_object_path=job.company_id::text||'/'||job.id::text||'/reel.mp4'
    and p_cover_object_path=job.company_id::text||'/'||job.id::text||'/cover.jpg'
    and p_video_sha256 ~ '^[0-9a-f]{64}$'
    and p_cover_sha256 ~ '^[0-9a-f]{64}$'
    and p_cover_file_size between 1 and 8388608
  returning job.*;
end;
$$;

create or replace function public.fail_company_reel_render_job(
  p_render_job_id uuid, p_lease_token uuid, p_error_code text
)
returns setof public.company_reel_render_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_error_code not in (
    'REEL_RENDER_INVALID_PLAN','REEL_RENDER_UNAUTHORIZED','REEL_RENDER_AUDIO_UNSUPPORTED',
    'REEL_RENDER_MEDIA_INVALID','REEL_RENDER_MEDIA_MISSING','REEL_RENDER_TEXT_OVERFLOW',
    'REEL_RENDER_TIMEOUT','REEL_RENDER_FAILED','REEL_RENDER_OUTPUT_INVALID','REEL_RENDER_CONTEXT_STALE',
    'REEL_PRIVACY_FAILED'
  ) then raise exception 'invalid Reel render error'; end if;
  return query update public.company_reel_render_jobs job set
    status='failed', lease_token=null, leased_until=null, error_code=p_error_code,
    completed_at=clock_timestamp(), updated_at=clock_timestamp()
  where job.id=p_render_job_id and job.status='rendering' and job.lease_token=p_lease_token
    and job.leased_until > clock_timestamp()
  returning job.*;
end;
$$;

revoke all on function public.approve_company_reel_creative_plan(uuid,text) from public, anon;
grant execute on function public.approve_company_reel_creative_plan(uuid,text) to authenticated;
revoke all on function public.begin_company_reel_render_request(uuid,text) from public, anon;
grant execute on function public.begin_company_reel_render_request(uuid,text) to authenticated;
revoke all on function public.complete_company_reel_render_job(uuid,uuid,text,text,text,integer,integer,integer,integer,text,text,integer,bigint,bigint,text,text,boolean) from public, anon, authenticated;
grant execute on function public.complete_company_reel_render_job(uuid,uuid,text,text,text,integer,integer,integer,integer,text,text,integer,bigint,bigint,text,text,boolean) to service_role;
revoke all on function public.fail_company_reel_render_job(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.fail_company_reel_render_job(uuid,uuid,text) to service_role;
revoke all on function public.protect_company_reel_creative_plan_approval() from public, anon, authenticated;

commit;
