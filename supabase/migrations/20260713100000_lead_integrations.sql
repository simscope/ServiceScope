-- Lead integrations: email parsing and provider webhooks feed the existing Job Inbox.

alter table public.job_inbox
  drop constraint if exists job_inbox_source_check;

alter table public.job_inbox
  add constraint job_inbox_source_check
  check (source in ('call', 'missed_call', 'website', 'online_booking', 'email', 'sms', 'partner', 'manual'));

alter table public.job_inbox
  add column if not exists external_source text,
  add column if not exists external_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists idx_job_inbox_external_identity
  on public.job_inbox(company_id, external_source, external_id)
  where external_source is not null and external_id is not null;

alter table public.company_profiles
  add column if not exists lead_api_enabled boolean not null default false,
  add column if not exists lead_api_token text;

create unique index if not exists idx_company_profiles_lead_api_token
  on public.company_profiles(lead_api_token)
  where lead_api_token is not null and lead_api_token <> '';

alter table public.email_connections
  add column if not exists import_leads_from_email boolean not null default false;
