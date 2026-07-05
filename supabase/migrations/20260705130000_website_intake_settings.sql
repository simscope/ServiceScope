-- Public website intake settings live with company onboarding/profile settings.

alter table public.company_profiles
  add column if not exists website_intake_enabled boolean not null default false,
  add column if not exists website_intake_token text,
  add column if not exists website_intake_allowed_origins text;

create unique index if not exists idx_company_profiles_website_intake_token
  on public.company_profiles(website_intake_token)
  where website_intake_token is not null and website_intake_token <> '';
