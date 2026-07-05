-- Allow authenticated app users and Edge Functions to call the manage helper used by RLS policies.
-- Without this grant, insert/update/delete policies fail with:
-- permission denied for function can_manage_company.

grant usage on schema public to authenticated;
grant execute on function public.can_manage_company(uuid) to authenticated;
grant execute on function public.can_manage_company(uuid) to service_role;

-- Keep anonymous users out of tenant-scoped helpers.
revoke execute on function public.can_manage_company(uuid) from anon;
