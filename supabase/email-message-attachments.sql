create table if not exists public.email_message_attachments (
  id uuid primary key default gen_random_uuid(),
  email_message_id uuid not null references public.email_messages(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes integer not null default 0,
  content_base64 text not null default '',
  content_id text,
  is_inline boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_message_attachments_message
  on public.email_message_attachments(email_message_id);

alter table public.email_message_attachments enable row level security;

drop policy if exists "email attachments readable by company or platform" on public.email_message_attachments;
create policy "email attachments readable by company or platform" on public.email_message_attachments
  for select using (public.can_access_company(company_id));

drop policy if exists "email attachments manageable by company managers or platform" on public.email_message_attachments;
create policy "email attachments manageable by company managers or platform" on public.email_message_attachments
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));
