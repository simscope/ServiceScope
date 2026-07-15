-- Warehouse Stage 4: issue stock to Jobs and return unused warehouse parts.
-- Keeps all stock, movement, and Job material writes inside transactional RPCs.

create unique index if not exists idx_job_materials_inventory_movement_unique
  on public.job_materials(inventory_movement_id)
  where inventory_movement_id is not null;

create or replace function public.inventory_issue_part_to_job(
  p_item_id uuid,
  p_job_id uuid,
  p_warehouse_id uuid,
  p_bin_id uuid,
  p_quantity numeric,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_job public.jobs%rowtype;
  v_item public.inventory_items%rowtype;
  v_warehouse public.inventory_warehouses%rowtype;
  v_bin public.inventory_bins%rowtype;
  v_balance public.inventory_stock_balances%rowtype;
  v_quantity numeric(14,4) := round(coalesce(p_quantity, 0), 4);
  v_unit_cost numeric(14,4);
  v_balance_before numeric(14,4);
  v_balance_after numeric(14,4);
  v_item_total_after numeric(14,4);
  v_movement_id uuid;
  v_job_material_id uuid;
begin
  if v_user_id is null then
    raise exception 'ACCESS_DENIED' using errcode = 'P0001';
  end if;

  if v_quantity <= 0 then
    raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'JOB_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.can_manage_company(v_job.company_id) then
    raise exception 'ACCESS_DENIED' using errcode = 'P0001';
  end if;

  select * into v_item
  from public.inventory_items
  where id = p_item_id
  for update;

  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_item.company_id <> v_job.company_id then
    raise exception 'ITEM_COMPANY_MISMATCH' using errcode = 'P0001';
  end if;

  select * into v_warehouse
  from public.inventory_warehouses
  where id = p_warehouse_id
    and is_active = true;

  if not found then
    raise exception 'WAREHOUSE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_warehouse.company_id <> v_job.company_id then
    raise exception 'WAREHOUSE_COMPANY_MISMATCH' using errcode = 'P0001';
  end if;

  if p_bin_id is not null then
    select * into v_bin
    from public.inventory_bins
    where id = p_bin_id
      and company_id = v_job.company_id
      and is_active = true;

    if not found or v_bin.warehouse_id <> p_warehouse_id then
      raise exception 'BIN_WAREHOUSE_MISMATCH' using errcode = 'P0001';
    end if;
  end if;

  select * into v_balance
  from public.inventory_stock_balances
  where company_id = v_job.company_id
    and item_id = p_item_id
    and warehouse_id = p_warehouse_id
    and bin_id is not distinct from p_bin_id
  for update;

  if not found or v_balance.quantity < v_quantity then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
  end if;

  if v_item.total_quantity < v_quantity then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
  end if;

  perform set_config('app.inventory_rpc', 'on', true);
  v_unit_cost := v_item.average_cost;
  v_balance_before := v_balance.quantity;
  v_balance_after := v_balance.quantity - v_quantity;
  v_item_total_after := v_item.total_quantity - v_quantity;

  update public.inventory_stock_balances
    set quantity = v_balance_after,
        updated_at = now()
  where id = v_balance.id;

  update public.inventory_items
    set total_quantity = v_item_total_after,
        updated_at = now()
  where id = v_item.id;

  insert into public.inventory_movements (
    company_id, item_id, movement_type, quantity, unit_cost,
    from_warehouse_id, from_bin_id, job_id,
    reference_type, reference_id, reference_number, notes,
    balance_before, balance_after, average_cost_before, average_cost_after,
    created_by_user_id
  )
  values (
    v_job.company_id, p_item_id, 'job_issue', v_quantity, v_unit_cost,
    p_warehouse_id, p_bin_id, p_job_id,
    'job', p_job_id, v_job.job_number, coalesce(p_notes, ''),
    v_balance_before, v_balance_after, v_item.average_cost, v_item.average_cost,
    v_user_id
  )
  returning id into v_movement_id;

  insert into public.job_materials (
    company_id, job_id, name, quantity, unit_price_cents, supplier, status,
    source_type, inventory_movement_id
  )
  values (
    v_job.company_id, p_job_id, v_item.internal_name, v_quantity,
    round(v_unit_cost * 100)::integer, 'Warehouse', 'Installed',
    'warehouse', v_movement_id
  )
  returning id into v_job_material_id;

  return jsonb_build_object(
    'status', 'issued',
    'movement_id', v_movement_id,
    'job_material_id', v_job_material_id,
    'job_id', p_job_id,
    'item_id', p_item_id,
    'quantity', v_quantity
  );
exception
  when unique_violation then
    raise exception 'JOB_MATERIAL_ALREADY_LINKED' using errcode = 'P0001';
end;
$$;

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

  select * into v_job_material
  from public.job_materials
  where inventory_movement_id = p_movement_id
    and source_type = 'warehouse'
  for update;

  if not found then
    raise exception 'JOB_MATERIAL_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_quantity > v_job_material.quantity then
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
    'job_material_return', v_job_material.id, v_issue.reference_number, coalesce(p_notes, ''),
    v_balance_before, v_balance_after, v_current_average, v_new_average,
    v_user_id
  )
  returning id into v_return_movement_id;

  v_remaining_job_quantity := round((v_job_material.quantity - v_quantity)::numeric, 2);
  update public.job_materials
    set quantity = v_remaining_job_quantity,
        status = case when v_remaining_job_quantity <= 0 then 'Returned'::public.material_status else status end,
        updated_at = now()
  where id = v_job_material.id;

  return jsonb_build_object(
    'status', 'returned',
    'movement_id', v_return_movement_id,
    'source_movement_id', p_movement_id,
    'job_material_id', v_job_material.id,
    'quantity', v_quantity
  );
end;
$$;

revoke all on function public.inventory_issue_part_to_job(uuid, uuid, uuid, uuid, numeric, text) from public;
revoke all on function public.inventory_issue_part_to_job(uuid, uuid, uuid, uuid, numeric, text) from anon;
revoke all on function public.inventory_issue_part_to_job(uuid, uuid, uuid, uuid, numeric, text) from authenticated;
grant execute on function public.inventory_issue_part_to_job(uuid, uuid, uuid, uuid, numeric, text) to authenticated;

revoke all on function public.inventory_return_job_part(uuid, numeric, uuid, uuid, text) from public;
revoke all on function public.inventory_return_job_part(uuid, numeric, uuid, uuid, text) from anon;
revoke all on function public.inventory_return_job_part(uuid, numeric, uuid, uuid, text) from authenticated;
grant execute on function public.inventory_return_job_part(uuid, numeric, uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
