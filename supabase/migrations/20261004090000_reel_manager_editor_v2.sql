-- Prepared locally only. No Production application is part of the editor task.
begin;
create table public.company_reel_editor_drafts (
  job_id uuid primary key,
  company_id uuid not null references public.companies(id),
  revision integer not null check (revision > 0),
  draft jsonb not null check (draft->>'contract' = 'reel-manager-presentation-v2'),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  brief_confirmation jsonb,
  approval jsonb,
  foreign key(job_id,company_id) references public.jobs(id,company_id)
);
create table public.company_reel_editor_versions (
  job_id uuid not null references public.company_reel_editor_drafts(job_id),
  revision integer not null,
  draft jsonb not null,
  brief_confirmation jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key(job_id,revision)
);
create trigger company_reel_editor_versions_immutable before update or delete on public.company_reel_editor_versions
  for each row execute function public.protect_company_reel_creative_plan_approval();
alter table public.company_reel_editor_drafts enable row level security;
alter table public.company_reel_editor_versions enable row level security;
revoke all on public.company_reel_editor_drafts, public.company_reel_editor_versions from public,anon,authenticated;
grant select,insert,update on public.company_reel_editor_drafts to service_role;
grant select,insert on public.company_reel_editor_versions to service_role;

-- The browser cannot write facts/approvals directly. Server-authenticated handlers
-- validate privacy, claims, geometry and current asset bytes before service-role commits.
create function public.build_company_reel_editor_context(p_job_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path = '' stable as $$
declare j public.jobs%rowtype; p public.company_profiles%rowtype; catalog jsonb; private_values jsonb;
begin
  select * into j from public.jobs where id=p_job_id;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if not exists(select 1 from auth.users u join public.companies c on c.id=j.company_id
    where u.id=p_actor_id and (lower(c.owner_email::text)=lower(u.email::text) or exists(
      select 1 from public.company_users member left join public.company_profiles profile on profile.company_id=member.company_id
      where member.company_id=c.id and member.status='active' and (member.auth_user_id=u.id or lower(member.email::text)=lower(u.email::text))
      and coalesce(profile.access_rules->>'aiAssistant','full')='full'
      and coalesce(member.portal_access_rules->>'aiAssistant',case when member.role::text='technician' then 'off' else 'full' end)='full'
    ))) then raise exception 'FORBIDDEN'; end if;
  if j.status::text not in ('Completed','Warranty') then raise exception 'UNSUPPORTED_STATUS'; end if;
  select * into p from public.company_profiles where company_id=j.company_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'attachmentId', a.id, 'mimeType', lower(a.mime_type), 'bucket', a.storage_bucket, 'path', a.storage_path,
    'identity', encode(r.attachment_sha256,'hex'),
    'privacy', case when r.analysis_status='analyzed' and not r.excluded
      and r.privacy_review_status in ('passed','resolved_false_positive')
      and not exists(select 1 from public.company_media_analysis_privacy_findings f
        where f.attachment_result_id=r.id and not f.resolved_as_false_positive)
      then 'passed' else 'needs_review' end
  ) order by a.created_at,a.id),'[]'::jsonb) into catalog
  from public.job_attachments a left join lateral (
    select result.* from public.company_media_analysis_attachment_results result
    join public.company_media_analysis_runs run on run.id=result.analysis_run_id and run.status='completed'
    where result.attachment_id=a.id and result.company_id=a.company_id and result.job_id=a.job_id
    order by result.created_at desc,result.id desc limit 1
  ) r on true
  where a.job_id=j.id and a.company_id=j.company_id and a.kind::text='photo'
    and lower(a.mime_type) in ('image/jpeg','image/png','image/webp') and a.size_bytes between 1 and 12000000;
  select coalesce(jsonb_agg(v),'[]'::jsonb) into private_values from (
    select unnest(array[j.job_number::text,j.notes,j.service_call_fee_cents::text,j.labor_cents::text]) v
    union all select unnest(array[c.organization,c.primary_name,c.primary_email::text,c.primary_phone,c.notes]) from public.customers c where c.id=j.customer_id
    union all select l.address from public.customer_locations l where l.id=j.customer_location_id
    union all select unnest(array[i.invoice_number,i.amount_cents::text]) from public.job_invoices i where i.company_id=j.company_id and i.job_id=j.id
    union all select c.message from public.job_comments c where c.company_id=j.company_id and c.job_id=j.id
  ) values_to_protect where v is not null and char_length(btrim(v)) > 1;
  return jsonb_build_object('jobId',j.id,'companyId',j.company_id,'actorId',p_actor_id,'canManage',true,
    'media',catalog,'privateValues',private_values,'brand',jsonb_build_object(
      'displayName',coalesce(nullif(p.ai_public_display_name,''),p.display_name,''),
      'logoAvailable',p.logo_storage_path is not null,
      'logoBucket','company-logos','logoPath',p.logo_storage_path,
      'allowedCtas',case when coalesce(p.ai_cta_guidance,'')='' then '[]'::jsonb else jsonb_build_array(p.ai_cta_guidance) end));
end; $$;
revoke all on function public.build_company_reel_editor_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.build_company_reel_editor_context(uuid,uuid) to service_role;
create function public.get_company_reel_editor_context(p_job_id uuid) returns jsonb
language plpgsql security definer set search_path = '' stable as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  return public.build_company_reel_editor_context(p_job_id,auth.uid());
end; $$;
revoke all on function public.get_company_reel_editor_context(uuid) from public,anon;
grant execute on function public.get_company_reel_editor_context(uuid) to authenticated;

create function public.commit_company_reel_editor_draft(p_job_id uuid,p_actor_id uuid,p_expected_revision integer,p_draft jsonb,p_confirm_brief boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j public.jobs%rowtype; old public.company_reel_editor_drafts%rowtype; result public.company_reel_editor_drafts%rowtype; confirmation jsonb;
begin
  select * into j from public.jobs where id=p_job_id for update;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  perform public.build_company_reel_editor_context(p_job_id,p_actor_id);
  select * into old from public.company_reel_editor_drafts where job_id=p_job_id for update;
  if coalesce(old.revision,0)<>p_expected_revision then raise exception 'EDITOR_DRAFT_CONFLICT'; end if;
  if p_draft->>'jobId'<>p_job_id::text or p_draft->>'contract'<>'reel-manager-presentation-v2' then raise exception 'EDITOR_INVALID_DRAFT'; end if;
  confirmation := case when p_confirm_brief then jsonb_build_object('actorId',p_actor_id,'confirmedAt',clock_timestamp(),'revision',p_expected_revision+1,'confirmedBrief',p_draft->'brief')
    when old.draft->'brief'=p_draft->'brief' then old.brief_confirmation else null end;
  insert into public.company_reel_editor_drafts(job_id,company_id,revision,draft,updated_by,brief_confirmation)
  values(p_job_id,j.company_id,p_expected_revision+1,p_draft,p_actor_id,confirmation)
  on conflict(job_id) do update set revision=excluded.revision,draft=excluded.draft,updated_by=excluded.updated_by,updated_at=clock_timestamp(),brief_confirmation=excluded.brief_confirmation,
    approval=case when not p_confirm_brief and old.draft->'caption'<>p_draft->'caption' and old.draft-'caption'=p_draft-'caption' and old.approval is not null then old.approval||jsonb_build_object('draftRevision',excluded.revision) else null end
  returning * into result;
  insert into public.company_reel_editor_versions(job_id,revision,draft,brief_confirmation,created_by) values(result.job_id,result.revision,result.draft,result.brief_confirmation,p_actor_id);
  return to_jsonb(result);
end; $$;

alter table public.company_reel_creative_plans drop constraint company_reel_creative_plans_schema_check;
alter table public.company_reel_creative_plans add constraint company_reel_creative_plans_schema_check
  check(schema_version in ('reel-creative-plan-v1','reel-manager-plan-v2'));
alter table public.company_reel_creative_plans drop constraint company_reel_creative_plans_snapshot_check;
alter table public.company_reel_creative_plans add constraint company_reel_creative_plans_snapshot_check check(
  jsonb_typeof(local_facts)='object' and jsonb_typeof(media_plan)='array' and
  jsonb_array_length(media_plan) between 1 and 8 and jsonb_typeof(plan_json)='object'
  and plan_json->>'schemaVersion'=schema_version and plan_json->>'revision'=plan_revision and plan_json->>'decision'='create_reel'
  and (schema_version='reel-manager-plan-v2' or jsonb_array_length(media_plan) between 2 and 4));

create function public.commit_company_reel_editor_approval(p_job_id uuid,p_actor_id uuid,p_expected_revision integer,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.company_reel_editor_drafts%rowtype; plan_id uuid; media_plan jsonb;
begin
  select * into d from public.company_reel_editor_drafts where job_id=p_job_id for update;
  if not found or d.revision<>p_expected_revision then raise exception 'EDITOR_DRAFT_CONFLICT'; end if;
  perform public.build_company_reel_editor_context(p_job_id,p_actor_id);
  if d.approval is not null then return to_jsonb(d); end if;
  if d.brief_confirmation is null or d.brief_confirmation->'confirmedBrief'<>d.draft->'brief'
    or p_snapshot->'draft'<>jsonb_set(d.draft,'{caption}','""'::jsonb) or p_snapshot->'briefAuthority'<>d.brief_confirmation
    or (p_snapshot->>'draftRevision')::integer<>d.revision then raise exception 'EDITOR_BRIEF_CONFIRMATION_REQUIRED'; end if;
  select jsonb_agg(jsonb_build_object('attachmentId',value->>'attachmentId','position',ordinality)) into media_plan
    from jsonb_array_elements(p_snapshot->'draft'->'scenes') with ordinality;
  insert into public.company_reel_creative_plans(company_id,job_id,created_by,schema_version,plan_revision,locale,planning_revision,local_facts,media_plan,plan_json)
  values(d.company_id,d.job_id,p_actor_id,'reel-manager-plan-v2',p_snapshot->>'revision',d.draft->'brief'->>'language',p_snapshot->>'revision',jsonb_build_object('managerBriefAuthority',d.brief_confirmation),media_plan,p_snapshot)
  on conflict(company_id,job_id,plan_revision) do nothing returning id into plan_id;
  if plan_id is null then select id into plan_id from public.company_reel_creative_plans where company_id=d.company_id and job_id=d.job_id and plan_revision=p_snapshot->>'revision'; end if;
  insert into public.company_reel_creative_plan_approvals(creative_plan_id,company_id,job_id,plan_revision,approved_by)
    values(plan_id,d.company_id,d.job_id,p_snapshot->>'revision',p_actor_id) on conflict(creative_plan_id) do nothing;
  update public.company_reel_editor_drafts set approval=jsonb_build_object('creativePlanId',plan_id,'revision',p_snapshot->>'revision','draftRevision',d.revision)
    where job_id=d.job_id returning * into d;
  return to_jsonb(d);
end; $$;
revoke all on function public.commit_company_reel_editor_draft(uuid,uuid,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.commit_company_reel_editor_draft(uuid,uuid,integer,jsonb,boolean) to service_role;
revoke all on function public.commit_company_reel_editor_approval(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.commit_company_reel_editor_approval(uuid,uuid,integer,jsonb) to service_role;
-- Preserve the rest of the existing terminal-state invariant unchanged.
do $$ declare invariant text; begin
  select pg_get_constraintdef(oid) into invariant from pg_constraint
    where conrelid='public.company_reel_render_jobs'::regclass and conname='company_reel_render_jobs_state_check';
  invariant := replace(replace(invariant,'duration_ms >= 12000','duration_ms >= 1000'),'duration_ms <= 25000','duration_ms <= 60000');
  alter table public.company_reel_render_jobs drop constraint company_reel_render_jobs_state_check;
  execute 'alter table public.company_reel_render_jobs add constraint company_reel_render_jobs_state_check ' || invariant;
end $$;
commit;
