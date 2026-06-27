-- Allow authenticated app users and Edge Functions to call the RLS helper.
-- Without this grant, policies that call public.can_access_company(uuid)
-- fail with: permission denied for function can_access_company.

grant usage on schema public to authenticated;
grant execute on function public.can_access_company(uuid) to authenticated;
grant execute on function public.can_access_company(uuid) to service_role;

-- Keep anonymous users out of tenant-scoped helpers.
revoke execute on function public.can_access_company(uuid) from anon;
