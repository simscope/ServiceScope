-- Keep manual task UI data in Supabase without replacing the existing job/user references.

alter table public.tasks
  add column if not exists job_number text not null default '',
  add column if not exists assigned_to text not null default 'Office';

create index if not exists idx_tasks_company_source
  on public.tasks(company_id, source, created_at desc);
