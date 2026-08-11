BEGIN;

lock table public.company_reel_render_jobs in access exclusive mode;

do $$
begin
  if exists (select 1 from public.company_reel_render_jobs) then
    raise exception 'REEL_RENDERER_V2_MIGRATION_REQUIRES_EMPTY_RENDER_JOBS';
  end if;
end;
$$;

alter table public.company_reel_render_jobs
  drop constraint company_reel_render_jobs_renderer_check;

alter table public.company_reel_render_jobs
  add constraint company_reel_render_jobs_renderer_check
    check (renderer_version = 'servicescope-reel-renderer-v2');

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

revoke all on function public.begin_company_reel_render_request(uuid,text) from public, anon;
grant execute on function public.begin_company_reel_render_request(uuid,text) to authenticated;

COMMIT;
