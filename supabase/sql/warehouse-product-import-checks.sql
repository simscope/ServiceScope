-- Warehouse product import validation checks.
-- Run after applying 20260715223000_warehouse_product_link_import.sql and deploying the Edge Function.

select
  to_regclass('public.inventory_supplier_links') as supplier_links,
  to_regclass('public.inventory_import_operations') as import_operations,
  to_regprocedure('public.inventory_import_product_to_stock(uuid,uuid,jsonb)') as import_receive_rpc,
  to_regprocedure('public.inventory_post_stock_receipt_internal(uuid,uuid,boolean)') as internal_receipt_posting_helper,
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
