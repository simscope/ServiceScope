-- REEL_MEDIA_SELECTION_BEGIN

create table public.company_reel_media_selections (
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  attachment_id uuid not null references public.job_attachments(id) on delete cascade,
  role text not null check (role in ('problem', 'process', 'result', 'supporting')),
  position smallint not null check (position between 1 and 4),
  selected_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, job_id, attachment_id),
  unique (company_id, job_id, position)
);

alter table public.company_reel_media_selections enable row level security;
revoke all on public.company_reel_media_selections from public, anon, authenticated;
grant select, insert, update, delete on public.company_reel_media_selections to service_role;

create or replace function public.get_company_reel_media_selector(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  target_company_id uuid;
  catalog jsonb;
  selection_ready boolean;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select job.company_id into target_company_id
  from public.jobs job
  where job.id = p_job_id;

  if target_company_id is null or not public.can_access_company_ai_assistant(target_company_id) then
    raise exception 'FORBIDDEN';
  end if;

  with catalog_rows as (
    select
      attachment.id as attachment_id,
      attachment.name,
      attachment.mime_type,
      selection.role,
      selection.position,
      selection.selected_by,
      selection.created_at as selected_at,
      selection.updated_at,
      latest.analysis_run_id,
      latest.attachment_result_id,
      latest.privacy_review_status,
      coalesce(latest.unresolved_privacy_count, 0)::integer as unresolved_privacy_count,
      case
        when latest.attachment_result_id is null then 'not_analyzed'
        when latest.analysis_status = 'analyzed'
          and latest.excluded = false
          and latest.privacy_review_status in ('passed', 'resolved_false_positive')
          and coalesce(latest.unresolved_privacy_count, 0) = 0 then 'passed'
        else 'needs_review'
      end as privacy_state
    from public.job_attachments attachment
    left join public.company_reel_media_selections selection
      on selection.company_id = attachment.company_id
      and selection.job_id = attachment.job_id
      and selection.attachment_id = attachment.id
    left join lateral (
      select
        result.id as attachment_result_id,
        result.analysis_run_id,
        result.analysis_status,
        result.privacy_review_status,
        result.excluded,
        (
          select count(*)
          from public.company_media_analysis_privacy_findings finding
          where finding.attachment_result_id = result.id
            and finding.analysis_run_id = result.analysis_run_id
            and finding.company_id = result.company_id
            and finding.job_id = result.job_id
            and finding.attachment_id = result.attachment_id
            and finding.resolved_as_false_positive = false
        ) as unresolved_privacy_count
      from public.company_media_analysis_attachment_results result
      join public.company_media_analysis_runs run
        on run.id = result.analysis_run_id
        and run.company_id = result.company_id
        and run.job_id = result.job_id
        and run.status = 'completed'
      where result.company_id = attachment.company_id
        and result.job_id = attachment.job_id
        and result.attachment_id = attachment.id
      order by result.created_at desc, result.id desc
      limit 1
    ) latest on true
    where attachment.company_id = target_company_id
      and attachment.job_id = p_job_id
      and attachment.kind::text <> 'video'
      and lower(attachment.mime_type) in ('image/jpeg', 'image/png', 'image/webp')
      and attachment.size_bytes between 1 and 12000000
      and attachment.storage_bucket is not null
      and attachment.storage_path is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'attachmentId', row.attachment_id,
    'name', row.name,
    'mimeType', row.mime_type,
    'role', row.role,
    'position', row.position,
    'selectedBy', row.selected_by,
    'selectedAt', row.selected_at,
    'updatedAt', row.updated_at,
    'analysisRunId', row.analysis_run_id,
    'attachmentResultId', row.attachment_result_id,
    'privacyState', row.privacy_state,
    'privacyReviewStatus', row.privacy_review_status,
    'unresolvedPrivacyCount', row.unresolved_privacy_count
  ) order by coalesce(row.position, 32767), row.name, row.attachment_id), '[]'::jsonb)
  into catalog
  from catalog_rows row;

  select
    count(*) between 3 and 4
    and bool_or(selection.role = 'result')
    and bool_or(selection.role = 'process')
    and bool_or(selection.role in ('problem', 'supporting'))
    and bool_and(
      attachment.kind::text <> 'video'
      and lower(attachment.mime_type) in ('image/jpeg', 'image/png', 'image/webp')
      and attachment.size_bytes between 1 and 12000000
      and attachment.storage_bucket is not null
      and attachment.storage_path is not null
      and latest.analysis_status = 'analyzed'
      and latest.excluded = false
      and latest.privacy_review_status in ('passed', 'resolved_false_positive')
      and coalesce(latest.unresolved_privacy_count, 0) = 0
    )
  into selection_ready
  from public.company_reel_media_selections selection
  join public.job_attachments attachment
    on attachment.id = selection.attachment_id
    and attachment.company_id = selection.company_id
    and attachment.job_id = selection.job_id
  left join lateral (
    select
      result.analysis_status,
      result.privacy_review_status,
      result.excluded,
      (
        select count(*)
        from public.company_media_analysis_privacy_findings finding
        where finding.attachment_result_id = result.id
          and finding.analysis_run_id = result.analysis_run_id
          and finding.company_id = result.company_id
          and finding.job_id = result.job_id
          and finding.attachment_id = result.attachment_id
          and finding.resolved_as_false_positive = false
      ) as unresolved_privacy_count
    from public.company_media_analysis_attachment_results result
    join public.company_media_analysis_runs run
      on run.id = result.analysis_run_id
      and run.company_id = result.company_id
      and run.job_id = result.job_id
      and run.status = 'completed'
    where result.company_id = selection.company_id
      and result.job_id = selection.job_id
      and result.attachment_id = selection.attachment_id
    order by result.created_at desc, result.id desc
    limit 1
  ) latest on true
  where selection.company_id = target_company_id
    and selection.job_id = p_job_id;

  return jsonb_build_object(
    'canManage', public.can_manage_company_ai_assistant(target_company_id),
    'ready', coalesce(selection_ready, false),
    'items', catalog
  );
end;
$$;

create or replace function public.replace_company_reel_media_selection(
  p_job_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_company_id uuid;
  target_status text;
  item jsonb;
  item_count integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select job.company_id, job.status::text into target_company_id, target_status
  from public.jobs job
  where job.id = p_job_id;

  if target_company_id is null or not public.can_manage_company_ai_assistant(target_company_id) then
    raise exception 'FORBIDDEN';
  end if;
  if target_status not in ('Completed', 'Warranty') then raise exception 'UNSUPPORTED_STATUS'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'INVALID_REEL_MEDIA_SELECTION'; end if;

  item_count := jsonb_array_length(p_items);
  if item_count > 4 then raise exception 'INVALID_REEL_MEDIA_SELECTION'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) value
    where jsonb_typeof(value) <> 'object'
      or value - array['attachmentId', 'role', 'position']::text[] <> '{}'::jsonb
      or not (value ?& array['attachmentId', 'role', 'position'])
      or coalesce(value->>'role', '') not in ('problem', 'process', 'result', 'supporting')
      or coalesce(value->>'attachmentId', '') !~ '^[0-9a-fA-F-]{36}$'
      or coalesce(value->>'position', '') !~ '^[1-4]$'
  ) then raise exception 'INVALID_REEL_MEDIA_SELECTION'; end if;

  if item_count <> (
      select count(distinct value->>'attachmentId') from jsonb_array_elements(p_items) value
    )
    or item_count <> (
      select count(distinct (value->>'position')::integer) from jsonb_array_elements(p_items) value
    )
    or exists (
      select 1 from generate_series(1, item_count) expected
      where not exists (
        select 1 from jsonb_array_elements(p_items) value
        where (value->>'position')::integer = expected
      )
    ) then
    raise exception 'INVALID_REEL_MEDIA_SELECTION';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) value
    left join public.job_attachments attachment
      on attachment.id = (value->>'attachmentId')::uuid
      and attachment.company_id = target_company_id
      and attachment.job_id = p_job_id
      and attachment.kind::text <> 'video'
      and lower(attachment.mime_type) in ('image/jpeg', 'image/png', 'image/webp')
      and attachment.size_bytes between 1 and 12000000
      and attachment.storage_bucket is not null
      and attachment.storage_path is not null
    where attachment.id is null
  ) then raise exception 'REEL_MEDIA_UNAVAILABLE'; end if;

  perform pg_advisory_xact_lock(hashtextextended('reel-media-selection:' || p_job_id::text, 0));
  delete from public.company_reel_media_selections
  where company_id = target_company_id and job_id = p_job_id;

  for item in select value from jsonb_array_elements(p_items) value loop
    insert into public.company_reel_media_selections (
      company_id, job_id, attachment_id, role, position, selected_by, created_at, updated_at
    ) values (
      target_company_id,
      p_job_id,
      (item->>'attachmentId')::uuid,
      item->>'role',
      (item->>'position')::smallint,
      auth.uid(),
      now(),
      now()
    );
  end loop;

  return public.get_company_reel_media_selector(p_job_id);
end;
$$;

create or replace function public.list_company_reel_media_selection_for_planning(
  p_company_id uuid,
  p_job_id uuid
)
returns table (attachment_id uuid, role text, selection_position integer)
language sql
security definer
set search_path = ''
stable
as $$
  select selection.attachment_id, selection.role, selection.position::integer as selection_position
  from public.company_reel_media_selections selection
  where selection.company_id = p_company_id
    and selection.job_id = p_job_id
  order by selection.position, selection.attachment_id;
$$;

revoke all on function public.get_company_reel_media_selector(uuid) from public, anon;
grant execute on function public.get_company_reel_media_selector(uuid) to authenticated, service_role;
revoke all on function public.replace_company_reel_media_selection(uuid, jsonb) from public, anon;
grant execute on function public.replace_company_reel_media_selection(uuid, jsonb) to authenticated, service_role;
revoke all on function public.list_company_reel_media_selection_for_planning(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_company_reel_media_selection_for_planning(uuid, uuid) to service_role;

comment on table public.company_reel_media_selections is
  'Opt-in, human-authored Reel media roles and ordering for completed service jobs.';
comment on function public.replace_company_reel_media_selection(uuid, jsonb) is
  'Atomically replaces at most four manually selected Reel images without triggering analysis.';
comment on function public.list_company_reel_media_selection_for_planning(uuid, uuid) is
  'Returns the authoritative manual Reel selection to the server-side director; empty means legacy fallback.';

-- REEL_MEDIA_SELECTION_END
