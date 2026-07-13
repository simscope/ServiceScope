-- Access restrictions are tenant configuration, not browser-local state.

alter table public.company_profiles
  add column if not exists access_rules jsonb not null default '{}'::jsonb;
