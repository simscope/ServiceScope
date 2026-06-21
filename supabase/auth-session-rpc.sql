-- Run this in Supabase SQL Editor for an existing ServiceScope database.
-- It lets the frontend resolve the signed-in Supabase Auth user into
-- either the owner console or a company workspace.

create or replace function public.app_current_session()
returns table (
  kind text,
  user_id uuid,
  name text,
  email citext,
  company_id uuid,
  company_name text,
  role text,
  status text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    'owner'::text as kind,
    platform_users.id as user_id,
    platform_users.name,
    platform_users.email,
    null::uuid as company_id,
    null::text as company_name,
    platform_users.role::text as role,
    platform_users.status::text as status
  from public.platform_users
  where platform_users.status = 'active'
    and (
      platform_users.auth_user_id = auth.uid()
      or lower(platform_users.email::text) = lower(coalesce(auth.email(), ''))
    )

  union all

  select
    'company'::text as kind,
    company_users.id as user_id,
    company_users.name,
    company_users.email,
    company_users.company_id,
    companies.name as company_name,
    company_users.role::text as role,
    company_users.status::text as status
  from public.company_users
  join public.companies on companies.id = company_users.company_id
  where company_users.status = 'active'
    and (
      company_users.auth_user_id = auth.uid()
      or lower(company_users.email::text) = lower(coalesce(auth.email(), ''))
    )

  union all

  select
    'company'::text as kind,
    companies.id as user_id,
    coalesce(nullif(companies.owner_name, ''), companies.owner_email::text) as name,
    companies.owner_email as email,
    companies.id as company_id,
    companies.name as company_name,
    'admin'::text as role,
    'active'::text as status
  from public.companies
  where lower(companies.owner_email::text) = lower(coalesce(auth.email(), ''))
  order by kind desc
  limit 1;
$$;

grant execute on function public.app_current_session() to authenticated;
