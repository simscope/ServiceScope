-- REEL_RENDER_JOBS_BEGIN

create unique index jobs_id_company_reel_render_jobs_uidx
  on public.jobs (id, company_id);

create table public.company_reel_creative_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  schema_version text not null,
  plan_revision text not null,
  locale text not null,
  planning_revision text not null,
  local_facts jsonb not null,
  media_plan jsonb not null,
  plan_json jsonb not null,
  created_at timestamptz not null default now(),
  constraint company_reel_creative_plans_job_tenant_fk
    foreign key (job_id, company_id) references public.jobs(id, company_id) on delete cascade,
  constraint company_reel_creative_plans_revision_unique unique (company_id, job_id, plan_revision),
  constraint company_reel_creative_plans_tenant_identity_unique unique (id, company_id, job_id),
  constraint company_reel_creative_plans_schema_check check (schema_version = 'reel-creative-plan-v1'),
  constraint company_reel_creative_plans_revision_check check (
    char_length(plan_revision) between 8 and 180 and plan_revision ~ '^[A-Za-z0-9:_-]+$'
  ),
  constraint company_reel_creative_plans_locale_check check (
    char_length(locale) between 2 and 24 and locale ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$'
  ),
  constraint company_reel_creative_plans_planning_revision_check check (
    char_length(planning_revision) between 8 and 180 and planning_revision ~ '^[A-Za-z0-9:_-]+$'
  ),
  constraint company_reel_creative_plans_snapshot_check check (
    jsonb_typeof(local_facts) = 'object'
    and jsonb_typeof(media_plan) = 'array'
    and jsonb_array_length(media_plan) between 2 and 4
    and jsonb_typeof(plan_json) = 'object'
    and plan_json->>'schemaVersion' = schema_version
    and plan_json->>'revision' = plan_revision
    and plan_json->>'decision' = 'create_reel'
  )
);

create table public.company_reel_render_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null,
  creative_plan_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'queued',
  render_fingerprint text not null,
  renderer_version text not null,
  attempt_count integer not null default 0,
  lease_token uuid,
  leased_until timestamptz,
  output_bucket text,
  video_object_path text,
  cover_object_path text,
  duration_ms integer,
  width integer,
  height integer,
  fps integer,
  video_codec text,
  pixel_format text,
  audio_streams integer,
  file_size bigint,
  faststart boolean,
  error_code text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint company_reel_render_jobs_job_tenant_fk
    foreign key (job_id, company_id) references public.jobs(id, company_id) on delete cascade,
  constraint company_reel_render_jobs_plan_tenant_fk
    foreign key (creative_plan_id, company_id, job_id)
    references public.company_reel_creative_plans(id, company_id, job_id) on delete restrict,
  constraint company_reel_render_jobs_fingerprint_unique
    unique (company_id, creative_plan_id, render_fingerprint),
  constraint company_reel_render_jobs_status_check
    check (status in ('queued', 'rendering', 'completed', 'failed')),
  constraint company_reel_render_jobs_fingerprint_check
    check (render_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint company_reel_render_jobs_renderer_check
    check (renderer_version = 'servicescope-reel-renderer-v1'),
  constraint company_reel_render_jobs_attempt_check
    check (attempt_count between 0 and 5),
  constraint company_reel_render_jobs_error_check
    check (error_code is null or error_code in (
      'REEL_RENDER_INVALID_PLAN','REEL_RENDER_UNAUTHORIZED','REEL_RENDER_AUDIO_UNSUPPORTED',
      'REEL_RENDER_MEDIA_INVALID','REEL_RENDER_MEDIA_MISSING','REEL_RENDER_TEXT_OVERFLOW',
      'REEL_RENDER_TIMEOUT','REEL_RENDER_FAILED','REEL_RENDER_OUTPUT_INVALID','REEL_RENDER_CONTEXT_STALE'
    )),
  constraint company_reel_render_jobs_state_check check (
    (status = 'queued' and attempt_count = 0 and lease_token is null and leased_until is null
      and started_at is null and completed_at is null and output_bucket is null and error_code is null)
    or (status = 'rendering' and attempt_count between 1 and 5 and lease_token is not null
      and leased_until is not null and started_at is not null and completed_at is null
      and output_bucket is null and error_code is null)
    or (status = 'completed' and attempt_count between 1 and 5 and lease_token is not null
      and leased_until is null and started_at is not null and completed_at is not null
      and output_bucket = 'company-reel-renders'
      and video_object_path is not null and cover_object_path is not null
      and duration_ms between 12000 and 25000 and width = 1080 and height = 1920 and fps = 30
      and video_codec = 'h264' and pixel_format = 'yuv420p' and audio_streams = 0
      and file_size between 1 and 104857600 and faststart = true and error_code is null)
    or (status = 'failed' and attempt_count between 1 and 5 and lease_token is null
      and leased_until is null and started_at is not null and completed_at is not null
      and output_bucket is null and video_object_path is null and cover_object_path is null
      and duration_ms is null and width is null and height is null and fps is null
      and video_codec is null and pixel_format is null and audio_streams is null
      and file_size is null and faststart is null and error_code is not null)
  )
);

create or replace function public.prevent_company_reel_creative_plan_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Reel creative plans are immutable';
end;
$$;

create trigger company_reel_creative_plans_immutable
before update on public.company_reel_creative_plans
for each row execute function public.prevent_company_reel_creative_plan_update();

create or replace function public.protect_company_reel_render_job_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.company_id, new.job_id, new.creative_plan_id, new.requested_by,
      new.render_fingerprint, new.renderer_version, new.created_at)
    is distinct from
     (old.company_id, old.job_id, old.creative_plan_id, old.requested_by,
      old.render_fingerprint, old.renderer_version, old.created_at) then
    raise exception 'Reel render job identity is immutable';
  end if;
  return new;
end;
$$;

create trigger company_reel_render_jobs_identity_immutable
before update on public.company_reel_render_jobs
for each row execute function public.protect_company_reel_render_job_identity();

create index company_reel_creative_plans_job_created_idx
  on public.company_reel_creative_plans (company_id, job_id, created_at desc);
create index company_reel_render_jobs_job_created_idx
  on public.company_reel_render_jobs (company_id, job_id, created_at desc);
create index company_reel_render_jobs_claim_idx
  on public.company_reel_render_jobs (status, leased_until, created_at, id);

alter table public.company_reel_creative_plans enable row level security;
alter table public.company_reel_render_jobs enable row level security;
revoke all on public.company_reel_creative_plans from public, anon, authenticated;
revoke all on public.company_reel_render_jobs from public, anon, authenticated;
grant select, insert on public.company_reel_creative_plans to service_role;
grant select, insert, update on public.company_reel_render_jobs to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-reel-renders', 'company-reel-renders', false, 104857600, array['video/mp4','image/jpeg']::text[])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.persist_company_reel_creative_plan(
  p_company_id uuid,
  p_job_id uuid,
  p_created_by uuid,
  p_schema_version text,
  p_plan_revision text,
  p_locale text,
  p_planning_revision text,
  p_local_facts jsonb,
  p_media_plan jsonb,
  p_plan_json jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_id uuid;
  local_keys text[];
  item jsonb;
  item_keys text[];
  seen_ids text[] := array[]::text[];
  expected_position integer := 1;
begin
  perform 1 from public.jobs where id = p_job_id and company_id = p_company_id for key share;
  if not found or not exists (select 1 from auth.users where id = p_created_by) then
    raise exception 'invalid Reel creative plan authority';
  end if;
  select coalesce(array_agg(key order by key), array[]::text[]) into local_keys
  from jsonb_object_keys(p_local_facts) key;
  if p_schema_version <> 'reel-creative-plan-v1'
    or p_plan_json->>'decision' <> 'create_reel'
    or p_plan_json->>'revision' <> p_plan_revision
    or local_keys <> array['diagnosis','finalResult','repairPerformed']
    or jsonb_typeof(p_media_plan) <> 'array'
    or jsonb_array_length(p_media_plan) not between 2 and 4 then
    raise exception 'invalid Reel creative plan snapshot';
  end if;
  for item in select value from jsonb_array_elements(p_media_plan) value loop
    select coalesce(array_agg(key order by key), array[]::text[]) into item_keys from jsonb_object_keys(item) key;
    if item_keys <> array['attachmentId','position']
      or (item->>'attachmentId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (item->>'attachmentId') = any(seen_ids)
      or (item->>'position')::integer <> expected_position then
      raise exception 'invalid Reel creative plan media snapshot';
    end if;
    perform 1 from public.job_attachments
    where id = (item->>'attachmentId')::uuid and company_id = p_company_id and job_id = p_job_id;
    if not found then raise exception 'invalid Reel creative plan attachment'; end if;
    seen_ids := array_append(seen_ids, item->>'attachmentId');
    expected_position := expected_position + 1;
  end loop;
  insert into public.company_reel_creative_plans (
    company_id, job_id, created_by, schema_version, plan_revision,
    locale, planning_revision, local_facts, media_plan, plan_json
  ) values (
    p_company_id, p_job_id, p_created_by, p_schema_version, p_plan_revision,
    p_locale, p_planning_revision, p_local_facts, p_media_plan, p_plan_json
  ) on conflict (company_id, job_id, plan_revision) do nothing
  returning id into result_id;
  if result_id is null then
    select id into result_id from public.company_reel_creative_plans
    where company_id = p_company_id and job_id = p_job_id and plan_revision = p_plan_revision
      and plan_json = p_plan_json and local_facts = p_local_facts and media_plan = p_media_plan;
  end if;
  if result_id is null then raise exception 'Reel creative plan revision conflict'; end if;
  return result_id;
end;
$$;

create or replace function public.can_access_company_ai_assistant(target_company_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select auth.uid() is not null and (
    exists (
      select 1
      from public.companies company
      where company.id = target_company_id
        and lower(company.owner_email::text) = lower(coalesce(auth.email(), ''))
    )
    or exists (
      select 1
      from public.company_users company_user
      left join public.company_profiles profile on profile.company_id = company_user.company_id
      where company_user.company_id = target_company_id
        and company_user.status = 'active'
        and (
          company_user.auth_user_id = auth.uid()
          or lower(company_user.email::text) = lower(coalesce(auth.email(), ''))
        )
        and case
          when profile.access_rules->>'aiAssistant' in ('full', 'readonly', 'off')
            then profile.access_rules->>'aiAssistant'
          else 'full'
        end <> 'off'
        and case
          when company_user.portal_access_rules->>'aiAssistant' in ('full', 'readonly', 'off')
            then company_user.portal_access_rules->>'aiAssistant'
          when company_user.role::text = 'technician' then 'off'
          else 'full'
        end <> 'off'
    )
  );
$$;

create or replace function public.get_company_reel_workspace(p_job_id uuid)
returns table (
  creative_plan_id uuid, plan_revision text, plan_json jsonb, plan_created_at timestamptz,
  render_job_id uuid, render_status text, render_error_code text,
  duration_ms integer, width integer, height integer,
  render_created_at timestamptz, render_started_at timestamptz, render_completed_at timestamptz,
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
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into plan from public.company_reel_creative_plans where id = p_creative_plan_id for key share;
  if not found or plan.plan_revision <> p_expected_plan_revision
    or not public.can_access_company_ai_assistant(plan.company_id) then
    raise exception 'REEL_RENDER_PLAN_UNAVAILABLE';
  end if;
  fingerprint := encode(sha256(convert_to(concat_ws(E'\n',
    'reel-render-fingerprint-v1', plan.plan_revision, plan.plan_json::text,
    'servicescope-reel-renderer-v1', 'reel-presentation-v1', 'mp4-h264-yuv420p-faststart-v1'
  ), 'UTF8')), 'hex');
  insert into public.company_reel_render_jobs (
    company_id, job_id, creative_plan_id, requested_by, status,
    render_fingerprint, renderer_version
  ) values (
    plan.company_id, plan.job_id, plan.id, auth.uid(), 'queued',
    fingerprint, 'servicescope-reel-renderer-v1'
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

-- 300s Vercel worker runtime plus a 60s reclaim buffer.
create or replace function public.claim_company_reel_render_job(p_render_job_id uuid, p_lease_seconds integer default 360)
returns setof public.company_reel_render_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_seconds not between 60 and 1800 then raise exception 'invalid Reel render lease'; end if;
  update public.company_reel_render_jobs job set
    status='failed', lease_token=null, leased_until=null, error_code='REEL_RENDER_FAILED',
    completed_at=clock_timestamp(), updated_at=clock_timestamp()
  where job.id=p_render_job_id and job.status='rendering' and job.attempt_count=5
    and job.leased_until <= clock_timestamp();
  return query
  update public.company_reel_render_jobs job set
    status='rendering', attempt_count=job.attempt_count+1, lease_token=gen_random_uuid(),
    leased_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),
    started_at=coalesce(job.started_at,clock_timestamp()), updated_at=clock_timestamp()
  where job.id = p_render_job_id
    and job.attempt_count < 5
    and (job.status='queued' or (job.status='rendering' and job.leased_until <= clock_timestamp()))
  returning job.*;
end;
$$;

create or replace function public.release_company_reel_render_job_for_retry(
  p_render_job_id uuid,
  p_lease_token uuid
)
returns setof public.company_reel_render_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query update public.company_reel_render_jobs job set
    leased_until=clock_timestamp(), updated_at=clock_timestamp()
  where job.id=p_render_job_id and job.status='rendering' and job.lease_token=p_lease_token
    and job.leased_until > clock_timestamp() and job.attempt_count < 5
  returning job.*;
end;
$$;

create or replace function public.complete_company_reel_render_job(
  p_render_job_id uuid, p_lease_token uuid, p_output_bucket text,
  p_video_object_path text, p_cover_object_path text,
  p_duration_ms integer, p_width integer, p_height integer, p_fps integer,
  p_video_codec text, p_pixel_format text, p_audio_streams integer,
  p_file_size bigint, p_faststart boolean
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
    file_size=p_file_size, faststart=p_faststart, completed_at=clock_timestamp(), updated_at=clock_timestamp()
  where job.id=p_render_job_id and job.status='rendering' and job.lease_token=p_lease_token
    and job.leased_until > clock_timestamp()
    and p_output_bucket='company-reel-renders'
    and p_video_object_path=job.company_id::text||'/'||job.id::text||'/reel.mp4'
    and p_cover_object_path=job.company_id::text||'/'||job.id::text||'/cover.jpg'
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
    'REEL_RENDER_TIMEOUT','REEL_RENDER_FAILED','REEL_RENDER_OUTPUT_INVALID','REEL_RENDER_CONTEXT_STALE'
  ) then raise exception 'invalid Reel render error'; end if;
  return query update public.company_reel_render_jobs job set
    status='failed', lease_token=null, leased_until=null, error_code=p_error_code,
    completed_at=clock_timestamp(), updated_at=clock_timestamp()
  where job.id=p_render_job_id and job.status='rendering' and job.lease_token=p_lease_token
    and job.leased_until > clock_timestamp()
  returning job.*;
end;
$$;

revoke all on function public.persist_company_reel_creative_plan(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.persist_company_reel_creative_plan(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.can_access_company_ai_assistant(uuid) from public, anon, authenticated;
grant execute on function public.can_access_company_ai_assistant(uuid) to service_role;
revoke all on function public.get_company_reel_workspace(uuid) from public, anon;
grant execute on function public.get_company_reel_workspace(uuid) to authenticated;
revoke all on function public.begin_company_reel_render_request(uuid,text) from public, anon;
grant execute on function public.begin_company_reel_render_request(uuid,text) to authenticated;
revoke all on function public.claim_company_reel_render_job(uuid,integer) from public, anon, authenticated;
revoke all on function public.release_company_reel_render_job_for_retry(uuid,uuid) from public, anon, authenticated;
revoke all on function public.complete_company_reel_render_job(uuid,uuid,text,text,text,integer,integer,integer,integer,text,text,integer,bigint,boolean) from public, anon, authenticated;
revoke all on function public.fail_company_reel_render_job(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_company_reel_render_job(uuid,integer) to service_role;
grant execute on function public.release_company_reel_render_job_for_retry(uuid,uuid) to service_role;
grant execute on function public.complete_company_reel_render_job(uuid,uuid,text,text,text,integer,integer,integer,integer,text,text,integer,bigint,boolean) to service_role;
grant execute on function public.fail_company_reel_render_job(uuid,uuid,text) to service_role;
revoke all on function public.prevent_company_reel_creative_plan_update() from public, anon, authenticated;
revoke all on function public.protect_company_reel_render_job_identity() from public, anon, authenticated;

-- REEL_RENDER_JOBS_END
