-- Supabase linter: fix function_search_path_mutable warnings.
-- These functions keep their existing behavior; this only pins name resolution
-- to public, pg_temp so a caller's role search_path cannot affect execution.

alter function public.inventory_rpc_guard_enabled()
  set search_path = public, pg_temp;

alter function public.business_analytics_percent_change(numeric, numeric)
  set search_path = public, pg_temp;

alter function public.inventory_guard_receipt_update()
  set search_path = public, pg_temp;

alter function public.inventory_guard_item_cost_update()
  set search_path = public, pg_temp;

alter function public.inventory_guard_receipt_line_update()
  set search_path = public, pg_temp;

alter function public.inventory_normalize_supplier_url(text)
  set search_path = public, pg_temp;

alter function public.inventory_validate_category()
  set search_path = public, pg_temp;

alter function public.inventory_validate_item_category()
  set search_path = public, pg_temp;
