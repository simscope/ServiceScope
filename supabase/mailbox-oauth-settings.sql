create table if not exists public.mailbox_oauth_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider public.email_provider not null,
  client_id text not null,
  client_secret text not null,
  redirect_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider)
);

drop trigger if exists set_mailbox_oauth_settings_updated_at on public.mailbox_oauth_settings;
create trigger set_mailbox_oauth_settings_updated_at
  before update on public.mailbox_oauth_settings
  for each row execute function public.set_updated_at();

alter table public.mailbox_oauth_settings enable row level security;

drop policy if exists "mailbox oauth settings readable by company managers or platform" on public.mailbox_oauth_settings;
create policy "mailbox oauth settings readable by company managers or platform" on public.mailbox_oauth_settings
  for select using (public.can_manage_company(company_id));

drop policy if exists "mailbox oauth settings manageable by company managers or platform" on public.mailbox_oauth_settings;
create policy "mailbox oauth settings manageable by company managers or platform" on public.mailbox_oauth_settings
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));
