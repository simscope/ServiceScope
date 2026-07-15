-- Warehouse product import validation checks.
-- Run after applying 20260715223000_warehouse_product_link_import.sql and deploying the Edge Function.

select
  to_regclass('public.inventory_supplier_links') as supplier_links,
  to_regprocedure('public.inventory_post_stock_receipt(uuid)') as receipt_posting_rpc;

select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'inventory_supplier_links'
order by ordinal_position;

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'inventory_supplier_links'
order by indexname;
