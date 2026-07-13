-- Run this in Supabase SQL Editor for the current ServiceScope project.
-- It restores required catalog data and links the first owner Auth user.

insert into public.plans (
  name,
  monthly_price_cents,
  seats_limit,
  technicians_limit,
  storage_gb_limit,
  support_level,
  entitlements,
  active
)
values
  ('Launch', 14900, 5, 8, 10, 'Email', array['Jobs', 'Invoices', 'Customer records', 'Basic support'], true),
  ('Growth', 29900, 15, 25, 50, 'Priority', array['Everything in Launch', 'Technician map', 'Finance view', 'Priority support'], true),
  ('Scale', 54900, 20, 30, 100, 'Dedicated', array['Everything in Growth', 'Advanced monitoring', 'Custom onboarding', 'Dedicated support'], true)
on conflict (name) do update
set
  monthly_price_cents = excluded.monthly_price_cents,
  seats_limit = excluded.seats_limit,
  technicians_limit = excluded.technicians_limit,
  storage_gb_limit = excluded.storage_gb_limit,
  support_level = excluded.support_level,
  entitlements = excluded.entitlements,
  active = true,
  updated_at = now();

insert into public.platform_users (
  auth_user_id,
  name,
  email,
  role,
  status,
  last_active_at
)
select
  auth.users.id,
  coalesce(auth.users.raw_user_meta_data->>'name', 'ServiceScope Owner'),
  auth.users.email,
  'owner',
  'active',
  now()
from auth.users
where lower(auth.users.email) = lower('simscopeinc@gmail.com')
on conflict (email) do update
set
  auth_user_id = excluded.auth_user_id,
  name = excluded.name,
  role = 'owner',
  status = 'active',
  last_active_at = now(),
  updated_at = now();
