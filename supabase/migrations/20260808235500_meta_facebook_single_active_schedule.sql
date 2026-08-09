-- META_FACEBOOK_SINGLE_ACTIVE_SCHEDULE_INVARIANT_BEGIN

do $$
begin
  if exists (
    select 1
    from public.company_social_publications
    where status = 'scheduled'
    group by company_id, job_id
    having count(*) > 1
  ) then
    raise exception 'cannot enforce one scheduled Facebook publication per job while duplicates exist';
  end if;
end;
$$;

create unique index company_social_publications_one_scheduled_per_job_uidx
  on public.company_social_publications (company_id, job_id)
  where status = 'scheduled';

-- META_FACEBOOK_SINGLE_ACTIVE_SCHEDULE_INVARIANT_END
