-- Job Inbox is the intake layer before a request becomes a scheduled job.

create table if not exists public.job_inbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source text not null default 'manual'
    check (source in ('call', 'missed_call', 'website', 'online_booking', 'email', 'sms', 'manual')),
  client_name text not null default '',
  client_phone text not null default '',
  client_email citext,
  address text not null default '',
  message text not null default '',
  status text not null default 'new'
    check (status in ('new', 'converted', 'ignored', 'duplicate', 'spam')),
  job_id uuid references public.jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_job_inbox_company_status
  on public.job_inbox(company_id, status, created_at desc);

create index if not exists idx_job_inbox_company_source
  on public.job_inbox(company_id, source, created_at desc);

drop trigger if exists set_job_inbox_updated_at on public.job_inbox;
create trigger set_job_inbox_updated_at
before update on public.job_inbox
for each row execute function public.set_updated_at();

alter table public.job_inbox enable row level security;

drop policy if exists "job inbox readable by company or platform" on public.job_inbox;
create policy "job inbox readable by company or platform" on public.job_inbox
  for select using (public.can_access_company(company_id));

drop policy if exists "job inbox manageable by company managers or platform" on public.job_inbox;
create policy "job inbox manageable by company managers or platform" on public.job_inbox
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));
