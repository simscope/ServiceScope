-- Warehouse Stage 3 transfer and adjustment checks.
-- Run against a disposable Supabase/PostgreSQL database after applying migrations.
-- The script uses a transaction and rolls back all fixture data.

begin;

do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_company_id uuid := gen_random_uuid();
  v_from_warehouse_id uuid;
  v_to_warehouse_id uuid;
  v_item_id uuid;
  v_adjust_item_id uuid;
  v_transfer_id uuid;
  v_adjustment_id uuid;
  v_qty numeric(14,4);
  v_avg numeric(14,4);
  v_count integer;
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values (v_user_id, 'authenticated', 'authenticated', 'warehouse-stage3@example.test', now(), now(), now());

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into public.companies (id, name, owner_email, status)
  values (v_company_id, 'Warehouse Stage 3 Test', 'warehouse-stage3@example.test', 'active');

  insert into public.company_users (company_id, auth_user_id, name, email, role, status)
  values (v_company_id, v_user_id, 'Warehouse Manager', 'warehouse-stage3@example.test', 'manager', 'active');

  insert into public.inventory_warehouses (company_id, name)
  values (v_company_id, 'Main')
  returning id into v_from_warehouse_id;

  insert into public.inventory_warehouses (company_id, name)
  values (v_company_id, 'Overflow')
  returning id into v_to_warehouse_id;

  insert into public.inventory_items (company_id, internal_name, part_number, total_quantity, average_cost)
  values (v_company_id, 'Stage 3 Transfer Part', 'STAGE3-XFER', 10, 20)
  returning id into v_item_id;

  insert into public.inventory_stock_balances (company_id, item_id, warehouse_id, quantity)
  values (v_company_id, v_item_id, v_from_warehouse_id, 10);

  insert into public.inventory_transfer_documents (company_id, from_warehouse_id, to_warehouse_id, reference_number)
  values (v_company_id, v_from_warehouse_id, v_to_warehouse_id, 'XFER-1')
  returning id into v_transfer_id;

  insert into public.inventory_transfer_lines (company_id, transfer_id, item_id, quantity)
  values (v_company_id, v_transfer_id, v_item_id, 4);

  perform public.inventory_post_transfer(v_transfer_id);

  select quantity into v_qty
  from public.inventory_stock_balances
  where item_id = v_item_id and warehouse_id = v_from_warehouse_id;
  if v_qty <> 6 then
    raise exception 'TRANSFER_FROM_BALANCE_FAILED got %', v_qty;
  end if;

  select quantity into v_qty
  from public.inventory_stock_balances
  where item_id = v_item_id and warehouse_id = v_to_warehouse_id;
  if v_qty <> 4 then
    raise exception 'TRANSFER_TO_BALANCE_FAILED got %', v_qty;
  end if;

  select total_quantity, average_cost into v_qty, v_avg
  from public.inventory_items
  where id = v_item_id;
  if v_qty <> 10 or v_avg <> 20 then
    raise exception 'TRANSFER_AVERAGE_CHANGED qty %, avg %', v_qty, v_avg;
  end if;

  select count(*) into v_count
  from public.inventory_movements
  where transfer_id = v_transfer_id
    and movement_type in ('transfer_out', 'transfer_in');
  if v_count <> 2 then
    raise exception 'TRANSFER_MOVEMENT_PAIR_FAILED got %', v_count;
  end if;

  begin
    perform public.inventory_post_transfer(v_transfer_id);
    raise exception 'TRANSFER_IDEMPOTENCY_FAILED expected TRANSFER_ALREADY_POSTED';
  exception
    when others then
      if sqlerrm not like '%TRANSFER_ALREADY_POSTED%' then
        raise;
      end if;
  end;

  begin
    insert into public.inventory_transfer_lines (company_id, transfer_id, item_id, quantity)
    values (v_company_id, v_transfer_id, v_item_id, 1);
    raise exception 'TRANSFER_LINE_LOCK_FAILED expected POSTED_TRANSFER_LINES_LOCKED';
  exception
    when others then
      if sqlerrm not like '%POSTED_TRANSFER_LINES_LOCKED%' then
        raise;
      end if;
  end;

  insert into public.inventory_items (company_id, internal_name, part_number)
  values (v_company_id, 'Stage 3 Adjustment Part', 'STAGE3-ADJ')
  returning id into v_adjust_item_id;

  insert into public.inventory_adjustment_documents (company_id, warehouse_id, reason, reference_number)
  values (v_company_id, v_from_warehouse_id, 'initial', 'ADJ-1')
  returning id into v_adjustment_id;

  insert into public.inventory_adjustment_lines (company_id, adjustment_id, item_id, quantity_delta, unit_cost)
  values (v_company_id, v_adjustment_id, v_adjust_item_id, 10, 5);

  perform public.inventory_post_adjustment(v_adjustment_id);

  select total_quantity, average_cost into v_qty, v_avg
  from public.inventory_items
  where id = v_adjust_item_id;
  if v_qty <> 10 or v_avg <> 5 then
    raise exception 'ADJUSTMENT_INITIAL_FAILED qty %, avg %', v_qty, v_avg;
  end if;

  insert into public.inventory_adjustment_documents (company_id, warehouse_id, reason, reference_number)
  values (v_company_id, v_from_warehouse_id, 'shortage', 'ADJ-2')
  returning id into v_adjustment_id;

  insert into public.inventory_adjustment_lines (company_id, adjustment_id, item_id, quantity_delta, unit_cost)
  values (v_company_id, v_adjustment_id, v_adjust_item_id, -2, 0);

  perform public.inventory_post_adjustment(v_adjustment_id);

  select total_quantity, average_cost into v_qty, v_avg
  from public.inventory_items
  where id = v_adjust_item_id;
  if v_qty <> 8 or v_avg <> 5 then
    raise exception 'ADJUSTMENT_NEGATIVE_FAILED qty %, avg %', v_qty, v_avg;
  end if;

  begin
    insert into public.inventory_adjustment_lines (company_id, adjustment_id, item_id, quantity_delta, unit_cost)
    values (v_company_id, v_adjustment_id, v_adjust_item_id, 1, 1);
    raise exception 'ADJUSTMENT_LINE_LOCK_FAILED expected POSTED_ADJUSTMENT_LINES_LOCKED';
  exception
    when others then
      if sqlerrm not like '%POSTED_ADJUSTMENT_LINES_LOCKED%' then
        raise;
      end if;
  end;
end;
$$;

rollback;
