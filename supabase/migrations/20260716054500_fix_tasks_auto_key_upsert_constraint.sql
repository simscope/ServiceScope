-- PostgREST ON CONFLICT(company_id, auto_key) requires a non-partial unique
-- index or constraint. The older partial index works for data integrity, but
-- PostgREST cannot use it as the upsert conflict target.

with ranked_auto_tasks as (
  select
    id,
    row_number() over (
      partition by company_id, auto_key
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as keep_rank
  from public.tasks
  where auto_key is not null
)
delete from public.tasks t
using ranked_auto_tasks ranked
where t.id = ranked.id
  and ranked.keep_rank > 1;

drop index if exists public.idx_tasks_company_auto_key;

create unique index if not exists tasks_company_auto_key_unique
  on public.tasks(company_id, auto_key);
