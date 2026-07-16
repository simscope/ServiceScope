-- Warehouse daily workflow: move stock between locations.
-- Keeps transfers transactional and preserves company average cost.

create or replace function public.inventory_move_stock_between_locations(
  p_item_id uuid,
  p_from_warehouse_id uuid,
  p_from_bin_id uuid,
  p_to_warehouse_id uuid,
  p_to_bin_id uuid,
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
  v_item public.inventory_items%rowtype;
  v_from_warehouse public.inventory_warehouses%rowtype;
  v_to_warehouse public.inventory_warehouses%rowtype;
  v_from_bin public.inventory_bins%rowtype;
  v_to_bin public.inventory_bins%rowtype;
  v_from_balance public.inventory_stock_balances%rowtype;
  v_to_balance public.inventory_stock_balances%rowtype;
  v_quantity numeric(14,4) := round(coalesce(p_quantity, 0), 4);
  v_unit_cost numeric(14,4);
  v_transfer_id uuid := gen_random_uuid();
  v_transfer_number text := 'MOVE-' || upper(left(replace(v_transfer_id::text, '-', ''), 8));
  v_out_movement_id uuid;
  v_in_movement_id uuid;
  v_from_before numeric(14,4);
  v_from_after numeric(14,4);
  v_to_before numeric(14,4);
  v_to_after numeric(14,4);
begin
  if v_user_id is null then
    raise exception 'ACCESS_DENIED' using errcode = 'P0001';
  end if;

  if v_quantity <= 0 then
    raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
  end if;

  if p_from_warehouse_id is null or p_to_warehouse_id is null then
    raise exception 'WAREHOUSE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_from_warehouse_id = p_to_warehouse_id and p_from_bin_id is not distinct from p_to_bin_id then
    raise exception 'TRANSFER_SAME_LOCATION' using errcode = 'P0001';
  end if;

  select * into v_item
  from public.inventory_items
  where id = p_item_id
  for update;

  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.can_manage_company(v_item.company_id) then
    raise exception 'ACCESS_DENIED' using errcode = 'P0001';
  end if;

  select * into v_from_warehouse
  from public.inventory_warehouses
  where id = p_from_warehouse_id
    and is_active = true;

  if not found or v_from_warehouse.company_id <> v_item.company_id then
    raise exception 'WAREHOUSE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_to_warehouse
  from public.inventory_warehouses
  where id = p_to_warehouse_id
    and is_active = true;

  if not found or v_to_warehouse.company_id <> v_item.company_id then
    raise exception 'WAREHOUSE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_from_bin_id is not null then
    select * into v_from_bin
    from public.inventory_bins
    where id = p_from_bin_id
      and company_id = v_item.company_id
      and is_active = true;

    if not found or v_from_bin.warehouse_id <> p_from_warehouse_id then
      raise exception 'BIN_WAREHOUSE_MISMATCH' using errcode = 'P0001';
    end if;
  end if;

  if p_to_bin_id is not null then
    select * into v_to_bin
    from public.inventory_bins
    where id = p_to_bin_id
      and company_id = v_item.company_id
      and is_active = true;

    if not found or v_to_bin.warehouse_id <> p_to_warehouse_id then
      raise exception 'BIN_WAREHOUSE_MISMATCH' using errcode = 'P0001';
    end if;
  end if;

  select * into v_from_balance
  from public.inventory_stock_balances
  where company_id = v_item.company_id
    and item_id = p_item_id
    and warehouse_id = p_from_warehouse_id
    and bin_id is not distinct from p_from_bin_id
  for update;

  if not found or v_from_balance.quantity < v_quantity then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001';
  end if;

  perform set_config('app.inventory_rpc', 'on', true);

  insert into public.inventory_stock_balances (company_id, item_id, warehouse_id, bin_id, quantity)
  values (v_item.company_id, p_item_id, p_to_warehouse_id, p_to_bin_id, 0)
  on conflict do nothing;

  select * into v_to_balance
  from public.inventory_stock_balances
  where company_id = v_item.company_id
    and item_id = p_item_id
    and warehouse_id = p_to_warehouse_id
    and bin_id is not distinct from p_to_bin_id
  for update;

  if not found then
    raise exception 'WAREHOUSE_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_unit_cost := v_item.average_cost;
  v_from_before := v_from_balance.quantity;
  v_from_after := v_from_balance.quantity - v_quantity;
  v_to_before := v_to_balance.quantity;
  v_to_after := v_to_balance.quantity + v_quantity;

  update public.inventory_stock_balances
    set quantity = v_from_after,
        updated_at = now()
  where id = v_from_balance.id;

  update public.inventory_stock_balances
    set quantity = v_to_after,
        updated_at = now()
  where id = v_to_balance.id;

  insert into public.inventory_movements (
    company_id, item_id, movement_type, quantity, unit_cost,
    from_warehouse_id, from_bin_id, to_warehouse_id, to_bin_id,
    reference_type, reference_id, reference_number, notes,
    balance_before, balance_after, average_cost_before, average_cost_after,
    created_by_user_id
  )
  values (
    v_item.company_id, p_item_id, 'transfer_out', v_quantity, v_unit_cost,
    p_from_warehouse_id, p_from_bin_id, p_to_warehouse_id, p_to_bin_id,
    'transfer', v_transfer_id, v_transfer_number, coalesce(p_notes, ''),
    v_from_before, v_from_after, v_item.average_cost, v_item.average_cost,
    v_user_id
  )
  returning id into v_out_movement_id;

  insert into public.inventory_movements (
    company_id, item_id, movement_type, quantity, unit_cost,
    from_warehouse_id, from_bin_id, to_warehouse_id, to_bin_id,
    reference_type, reference_id, reference_number, notes,
    balance_before, balance_after, average_cost_before, average_cost_after,
    created_by_user_id
  )
  values (
    v_item.company_id, p_item_id, 'transfer_in', v_quantity, v_unit_cost,
    p_from_warehouse_id, p_from_bin_id, p_to_warehouse_id, p_to_bin_id,
    'transfer', v_transfer_id, v_transfer_number, coalesce(p_notes, ''),
    v_to_before, v_to_after, v_item.average_cost, v_item.average_cost,
    v_user_id
  )
  returning id into v_in_movement_id;

  return jsonb_build_object(
    'status', 'moved',
    'transfer_id', v_transfer_id,
    'transfer_number', v_transfer_number,
    'out_movement_id', v_out_movement_id,
    'in_movement_id', v_in_movement_id,
    'item_id', p_item_id,
    'quantity', v_quantity,
    'from_balance', v_from_after,
    'to_balance', v_to_after
  );
end;
$$;

revoke all on function public.inventory_move_stock_between_locations(uuid, uuid, uuid, uuid, uuid, numeric, text) from public;
revoke all on function public.inventory_move_stock_between_locations(uuid, uuid, uuid, uuid, uuid, numeric, text) from anon;
revoke all on function public.inventory_move_stock_between_locations(uuid, uuid, uuid, uuid, uuid, numeric, text) from authenticated;
grant execute on function public.inventory_move_stock_between_locations(uuid, uuid, uuid, uuid, uuid, numeric, text) to authenticated;

notify pgrst, 'reload schema';
