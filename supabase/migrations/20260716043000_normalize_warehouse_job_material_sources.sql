-- Normalize older warehouse-backed material rows and recalculate returned quantities.
-- Some rows can have inventory_movement_id while source_type is null/legacy.

update public.job_materials
  set source_type = 'warehouse',
      updated_at = now()
where inventory_movement_id is not null
  and source_type is distinct from 'warehouse'::public.job_material_source_type;

with movement_totals as (
  select
    company_id,
    job_id,
    item_id,
    sum(quantity) filter (where movement_type = 'job_issue') as issued_quantity,
    sum(quantity) filter (where movement_type = 'job_return') as returned_quantity
  from public.inventory_movements
  where movement_type in ('job_issue', 'job_return')
    and job_id is not null
  group by company_id, job_id, item_id
),
warehouse_materials as (
  select
    jm.id,
    greatest(coalesce(mt.issued_quantity, 0) - coalesce(mt.returned_quantity, 0), 0) as remaining_quantity
  from public.job_materials jm
  join public.inventory_movements im on im.id = jm.inventory_movement_id
  join movement_totals mt on mt.company_id = jm.company_id
    and mt.job_id = jm.job_id
    and mt.item_id = im.item_id
  where jm.inventory_movement_id is not null
)
update public.job_materials jm
  set quantity = round(warehouse_materials.remaining_quantity::numeric, 2),
      status = case
        when warehouse_materials.remaining_quantity <= 0 then 'Returned'::public.material_status
        when jm.status = 'Returned'::public.material_status then 'Installed'::public.material_status
        else jm.status
      end,
      updated_at = now()
from warehouse_materials
where jm.id = warehouse_materials.id
  and (
    jm.quantity is distinct from round(warehouse_materials.remaining_quantity::numeric, 2)
    or (warehouse_materials.remaining_quantity <= 0 and jm.status <> 'Returned'::public.material_status)
    or (warehouse_materials.remaining_quantity > 0 and jm.status = 'Returned'::public.material_status)
  );

notify pgrst, 'reload schema';
