-- Run this in Supabase SQL Editor when a company owner can sign in to
-- Supabase Auth, but ServiceScope says there is no active access.
--
-- It links existing auth.users to companies by companies.owner_email and
-- creates/repairs the company admin row used by ServiceScope.

insert into public.company_users (
  company_id,
  auth_user_id,
  name,
  email,
  role,
  status
)
select
  companies.id,
  auth_users.id,
  coalesce(nullif(companies.owner_name, ''), companies.owner_email::text),
  companies.owner_email,
  'admin'::company_role,
  'active'::user_status
from public.companies
join auth.users as auth_users
  on lower(auth_users.email::text) = lower(companies.owner_email::text)
on conflict (company_id, email)
do update set
  auth_user_id = excluded.auth_user_id,
  name = excluded.name,
  role = 'admin'::company_role,
  status = 'active'::user_status,
  updated_at = now();

select
  companies.name as company,
  companies.owner_email,
  company_users.role,
  company_users.status,
  company_users.auth_user_id
from public.company_users
join public.companies on companies.id = company_users.company_id
where company_users.email = companies.owner_email
order by companies.created_at desc;
