alter table public.company_users
  add column if not exists portal_access_rules jsonb not null default '{}'::jsonb;

update public.company_users
set portal_access_rules = jsonb_build_object('onboarding', 'off')
where portal_access_rules = '{}'::jsonb;

comment on column public.company_users.portal_access_rules is
  'Per-user company portal page permissions. Onboarding is owner-only and must remain off for staff.';
