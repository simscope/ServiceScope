-- Remove manual clones created from warehouse-backed Job material rows.
-- Warehouse rows are identified by source_type='warehouse' and inventory_movement_id.

delete from public.job_materials manual_row
using public.job_materials warehouse_row
where manual_row.company_id = warehouse_row.company_id
  and manual_row.job_id = warehouse_row.job_id
  and coalesce(manual_row.source_type::text, 'manual') = 'manual'
  and warehouse_row.source_type = 'warehouse'
  and warehouse_row.inventory_movement_id is not null
  and lower(trim(manual_row.name)) = lower(trim(warehouse_row.name))
  and manual_row.quantity = warehouse_row.quantity
  and manual_row.unit_price_cents = warehouse_row.unit_price_cents
  and trim(coalesce(manual_row.supplier, '')) = trim(coalesce(warehouse_row.supplier, ''));
