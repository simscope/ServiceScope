-- Derived tasks are recomputed in the UI, so persist their stable key separately from the UUID row id.

alter table public.tasks
  add column if not exists auto_key text;

create unique index if not exists idx_tasks_company_auto_key
  on public.tasks(company_id, auto_key)
  where auto_key is not null;
