-- META_FACEBOOK_SINGLE_ACTIVE_PUBLICATION_INVARIANT_BEGIN

do $$
begin
  if exists (
    select 1
    from public.company_social_publications
    where status in ('scheduled', 'publishing', 'delivery_unknown')
    group by company_id, job_id
    having count(*) > 1
  ) then
    raise exception 'cannot enforce one active Facebook publication per job while duplicates exist';
  end if;
end;
$$;

create unique index company_social_publications_one_active_per_job_uidx
  on public.company_social_publications (company_id, job_id)
  where status in ('scheduled', 'publishing', 'delivery_unknown');

-- META_FACEBOOK_SINGLE_ACTIVE_PUBLICATION_INVARIANT_END
