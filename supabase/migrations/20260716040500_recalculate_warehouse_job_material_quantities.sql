-- Recalculate warehouse-backed Job material quantities from movement history.
-- Job material quantity must equal issued quantity minus returned quantity for the same Job + item.

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
    jm.company_id,
    jm.job_id,
    im.item_id,
    greatest(coalesce(mt.issued_quantity, 0) - coalesce(mt.returned_quantity, 0), 0) as remaining_quantity
  from public.job_materials jm
  join public.inventory_movements im on im.id = jm.inventory_movement_id
  join movement_totals mt on mt.company_id = jm.company_id
    and mt.job_id = jm.job_id
    and mt.item_id = im.item_id
  where jm.source_type = 'warehouse'
    and jm.inventory_movement_id is not null
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

create or replace function public.inventory_return_job_part(
  p_movement_id uuid,
  p_quantity numeric,
  p_warehouse_id uuid default null,
  p_bin_id uuid default null,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_issue public.inventory_movements%rowtype;
  v_job_material public.job_materials%rowtype;
  v_item public.inventory_items%rowtype;
  v_warehouse_id uuid;
  v_bin_id uuid;
  v_warehouse public.inventory_warehouses%rowtype;
  v_bin public.inventory_bins%rowtype;
  v_balance public.inventory_stock_balances%rowtype;
  v_quantity numeric(14,4) := round(coalesce(p_quantity, 0), 4);
  v_issued_quantity numeric(14,4);
  v_returned_quantity numeric(14,4);
  v_remaining_job_quantity numeric(10,2);
  v_current_total numeric(14,4);
  v_current_average numeric(14,4);
  v_new_total numeric(14,4);
  v_new_average numeric(14,4);
  v_balance_before numeric(14,4);
  v_balance_after numeric(14,4);
  v_return_movement_id uuid;
begin
  if v_user_id is null then
    raise exception 'ACCESS_DENIED' using errcode = 'P0001';
  end if;

  if v_quantity <= 0 then
    raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
  end if;

  select * into v_issue
  from public.inventory_movements
  where id = p_movement_id
    and movement_type = 'job_issue'
  for update;

  if not found then
    raise exception 'JOB_ISSUE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.can_manage_company(v_issue.company_id) then
    raise exception 'ACCESS_DENIED' using errcode = 'P0001';
  end if;

  select jm.* into v_job_material
  from public.job_materials jm
  join public.inventory_movements im on im.id = jm.inventory_movement_id
  where jm.company_id = v_issue.company_id
    and jm.job_id = v_issue.job_id
    and jm.source_type = 'warehouse'
    and im.movement_type = 'job_issue'
    and im.item_id = v_issue.item_id
  order by jm.created_at, jm.id
  for update of jm
  limit 1;

  if not found then
    raise exception 'JOB_MATERIAL_NOT_FOUND' using errcode = 'P0001';
  end if;

  select
    coalesce(sum(quantity) filter (where movement_type = 'job_issue'), 0),
    coalesce(sum(quantity) filter (where movement_type = 'job_return'), 0)
  into v_issued_quantity, v_returned_quantity
  from public.inventory_movements
  where company_id = v_issue.company_id
    and job_id = v_issue.job_id
    and item_id = v_issue.item_id
    and movement_type in ('job_issue', 'job_return');

  if v_quantity > greatest(v_issued_quantity - v_returned_quantity, 0) then
    raise exception 'RETURN_QUANTITY_EXCEEDS_USED' using errcode = 'P0001';
  end if;

  select * into v_item
  from public.inventory_items
  where id = v_issue.item_id
  for update;

  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_warehouse_id := coalesce(p_warehouse_id, v_issue.from_warehouse_id);
  v_bin_id := coalesce(p_bin_id, v_issue.from_bin_id);

  select * into v_warehouse
  from public.inventory_warehouses
  where id = v_warehouse_id
    and is_active = true;

  if not found or v_warehouse.company_id <> v_issue.company_id then
    raise exception 'WAREHOUSE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_bin_id is not null then
    select * into v_bin
    from public.inventory_bins
    where id = v_bin_id
      and company_id = v_issue.company_id
      and is_active = true;

    if not found or v_bin.warehouse_id <> v_warehouse_id then
      raise exception 'BIN_WAREHOUSE_MISMATCH' using errcode = 'P0001';
    end if;
  end if;

  perform set_config('app.inventory_rpc', 'on', true);

  insert into public.inventory_stock_balances (company_id, item_id, warehouse_id, bin_id, quantity)
  values (v_issue.company_id, v_issue.item_id, v_warehouse_id, v_bin_id, 0)
  on conflict do nothing;

  select * into v_balance
  from public.inventory_stock_balances
  where company_id = v_issue.company_id
    and item_id = v_issue.item_id
    and warehouse_id = v_warehouse_id
    and bin_id is not distinct from v_bin_id
  for update;

  if not found then
    raise exception 'WAREHOUSE_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_current_total := v_item.total_quantity;
  v_current_average := v_item.average_cost;
  v_new_total := v_current_total + v_quantity;
  v_new_average := case
    when v_new_total = 0 then v_current_average
    when v_current_total = 0 then v_issue.unit_cost
    else round(((v_current_total * v_current_average) + (v_quantity * v_issue.unit_cost)) / v_new_total, 4)
  end;
  v_balance_before := v_balance.quantity;
  v_balance_after := v_balance.quantity + v_quantity;

  update public.inventory_stock_balances
    set quantity = v_balance_after,
        updated_at = now()
  where id = v_balance.id;

  update public.inventory_items
    set total_quantity = v_new_total,
        average_cost = v_new_average,
        updated_at = now()
  where id = v_item.id;

  insert into public.inventory_movements (
    company_id, item_id, movement_type, quantity, unit_cost,
    to_warehouse_id, to_bin_id, job_id,
    reference_type, reference_id, reference_number, notes,
    balance_before, balance_after, average_cost_before, average_cost_after,
    created_by_user_id
  )
  values (
    v_issue.company_id, v_issue.item_id, 'job_return', v_quantity, v_issue.unit_cost,
    v_warehouse_id, v_bin_id, v_issue.job_id,
    'job_material_return', v_issue.id, v_issue.reference_number, coalesce(p_notes, ''),
    v_balance_before, v_balance_after, v_current_average, v_new_average,
    v_user_id
  )
  returning id into v_return_movement_id;

  v_remaining_job_quantity := round(greatest(v_issued_quantity - (v_returned_quantity + v_quantity), 0)::numeric, 2);

  update public.job_materials
    set quantity = v_remaining_job_quantity,
        status = case
          when v_remaining_job_quantity <= 0 then 'Returned'::public.material_status
          when status = 'Returned'::public.material_status then 'Installed'::public.material_status
          else status
        end,
        updated_at = now()
  where id = v_job_material.id;

  return jsonb_build_object(
    'status', 'returned',
    'movement_id', v_return_movement_id,
    'source_movement_id', p_movement_id,
    'job_material_id', v_job_material.id,
    'quantity', v_quantity,
    'remaining_job_quantity', v_remaining_job_quantity
  );
end;
$$;

revoke all on function public.inventory_return_job_part(uuid, numeric, uuid, uuid, text) from public;
revoke all on function public.inventory_return_job_part(uuid, numeric, uuid, uuid, text) from anon;
revoke all on function public.inventory_return_job_part(uuid, numeric, uuid, uuid, text) from authenticated;
grant execute on function public.inventory_return_job_part(uuid, numeric, uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
