-- The tenant-scoped web app uses current_company_id through the compatibility
-- layer when loading and saving company data. Keep the RPC private from anon,
-- but allow signed-in company users to call the function.
grant execute on function public.current_company_id() to authenticated;
grant execute on function public.current_company_id() to service_role;
revoke execute on function public.current_company_id() from anon;
