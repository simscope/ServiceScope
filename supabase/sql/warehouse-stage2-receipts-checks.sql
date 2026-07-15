-- Warehouse Stage 2 receipt posting checks.
-- Run against a disposable Supabase/PostgreSQL database after applying migrations.
-- The script uses a transaction and rolls back all fixture data.

begin;

do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_company_id uuid := gen_random_uuid();
  v_other_company_id uuid := gen_random_uuid();
  v_warehouse_id uuid;
  v_other_warehouse_id uuid;
  v_bin_id uuid;
  v_other_bin_id uuid;
  v_item_id uuid;
  v_other_item_id uuid;
  v_supplier_id uuid;
  v_receipt_id uuid;
  v_bad_receipt_id uuid;
  v_qty numeric(14,4);
  v_avg numeric(14,4);
  v_value numeric(14,4);
  v_count integer;
begin
  insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values (v_user_id, 'authenticated', 'authenticated', 'warehouse-stage2@example.test', now(), now(), now());

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into public.companies (id, name, owner_email, status)
  values
    (v_company_id, 'Warehouse Stage 2 Test', 'warehouse-stage2@example.test', 'active'),
    (v_other_company_id, 'Warehouse Stage 2 Other Test', 'warehouse-stage2-other@example.test', 'active');

  insert into public.company_users (company_id, auth_user_id, name, email, role, status)
  values (v_company_id, v_user_id, 'Warehouse Manager', 'warehouse-stage2@example.test', 'manager', 'active');

  insert into public.inventory_warehouses (company_id, name)
  values (v_company_id, 'Main')
  returning id into v_warehouse_id;

  insert into public.inventory_warehouses (company_id, name)
  values (v_company_id, 'Overflow')
  returning id into v_other_warehouse_id;

  insert into public.inventory_bins (company_id, warehouse_id, code, name)
  values (v_company_id, v_warehouse_id, 'A1', 'Aisle A1')
  returning id into v_bin_id;

  insert into public.inventory_bins (company_id, warehouse_id, code, name)
  values (v_company_id, v_other_warehouse_id, 'B1', 'Aisle B1')
  returning id into v_other_bin_id;

  insert into public.inventory_items (company_id, internal_name, part_number)
  values (v_company_id, 'Stage 2 Compressor', 'STAGE2-COMP')
  returning id into v_item_id;

  insert into public.inventory_items (company_id, internal_name, part_number)
  values (v_other_company_id, 'Other Company Part', 'OTHER-PART')
  returning id into v_other_item_id;

  insert into public.inventory_suppliers (company_id, name)
  values (v_company_id, 'Stage 2 Supplier')
  returning id into v_supplier_id;

  -- Test 1: 0 stock + receipt 10 x $20 = qty 10, avg $20, value $200.
  insert into public.inventory_stock_receipts (company_id, supplier_id, warehouse_id, bin_id, po_number)
  values (v_company_id, v_supplier_id, v_warehouse_id, v_bin_id, 'TEST-1')
  returning id into v_receipt_id;

  insert into public.inventory_stock_receipt_lines (company_id, receipt_id, item_id, quantity, unit_cost)
  values (v_company_id, v_receipt_id, v_item_id, 10, 20);

  perform public.inventory_post_stock_receipt(v_receipt_id);

  select total_quantity, average_cost, total_quantity * average_cost
    into v_qty, v_avg, v_value
  from public.inventory_items
  where id = v_item_id;

  if v_qty <> 10 or v_avg <> 20 or v_value <> 200 then
    raise exception 'TEST_1_FAILED qty %, avg %, value %', v_qty, v_avg, v_value;
  end if;

  -- Test 2: 10 x avg $20 + receipt 5 x $30 = qty 15, avg $23.3333, value $350.
  insert into public.inventory_stock_receipts (company_id, supplier_id, warehouse_id, bin_id, po_number)
  values (v_company_id, v_supplier_id, v_warehouse_id, v_bin_id, 'TEST-2')
  returning id into v_receipt_id;

  insert into public.inventory_stock_receipt_lines (company_id, receipt_id, item_id, quantity, unit_cost)
  values (v_company_id, v_receipt_id, v_item_id, 5, 30);

  perform public.inventory_post_stock_receipt(v_receipt_id);

  select total_quantity, average_cost, round(total_quantity * average_cost, 2)
    into v_qty, v_avg, v_value
  from public.inventory_items
  where id = v_item_id;

  if v_qty <> 15 or v_avg <> 23.3333 or v_value <> 350 then
    raise exception 'TEST_2_FAILED qty %, avg %, value %', v_qty, v_avg, v_value;
  end if;

  -- Test 3: repeated post does not duplicate movement or change stock/cost.
  begin
    perform public.inventory_post_stock_receipt(v_receipt_id);
    raise exception 'TEST_3_FAILED expected RECEIPT_ALREADY_POSTED';
  exception
    when others then
      if sqlerrm not like '%RECEIPT_ALREADY_POSTED%' then
        raise;
      end if;
  end;

  select count(*) into v_count
  from public.inventory_movements
  where receipt_id = v_receipt_id
    and movement_type = 'receipt';

  if v_count <> 1 then
    raise exception 'TEST_3_FAILED expected 1 movement, got %', v_count;
  end if;

  -- Test 5: receipt line with an item from another company is blocked.
  insert into public.inventory_stock_receipts (company_id, supplier_id, warehouse_id, bin_id, po_number)
  values (v_company_id, v_supplier_id, v_warehouse_id, v_bin_id, 'TEST-5')
  returning id into v_bad_receipt_id;

  insert into public.inventory_stock_receipt_lines (company_id, receipt_id, item_id, quantity, unit_cost)
  values (v_company_id, v_bad_receipt_id, v_other_item_id, 1, 1);

  begin
    perform public.inventory_post_stock_receipt(v_bad_receipt_id);
    raise exception 'TEST_5_FAILED expected ITEM_COMPANY_MISMATCH';
  exception
    when others then
      if sqlerrm not like '%ITEM_COMPANY_MISMATCH%' then
        raise;
      end if;
  end;

  -- Test 6: bin from another warehouse is blocked.
  insert into public.inventory_stock_receipts (company_id, supplier_id, warehouse_id, bin_id, po_number)
  values (v_company_id, v_supplier_id, v_warehouse_id, v_other_bin_id, 'TEST-6')
  returning id into v_bad_receipt_id;

  insert into public.inventory_stock_receipt_lines (company_id, receipt_id, item_id, quantity, unit_cost)
  values (v_company_id, v_bad_receipt_id, v_item_id, 1, 1);

  begin
    perform public.inventory_post_stock_receipt(v_bad_receipt_id);
    raise exception 'TEST_6_FAILED expected BIN_WAREHOUSE_MISMATCH';
  exception
    when others then
      if sqlerrm not like '%BIN_WAREHOUSE_MISMATCH%' then
        raise;
      end if;
  end;

  -- Test 7: quantity <= 0 is blocked at the table/RPC boundary.
  begin
    insert into public.inventory_stock_receipt_lines (company_id, receipt_id, item_id, quantity, unit_cost)
    values (v_company_id, v_receipt_id, v_item_id, 0, 1);
    raise exception 'TEST_7_FAILED expected quantity check violation';
  exception
    when check_violation then
      null;
  end;

  -- Test 8: negative unit cost is blocked by RPC.
  insert into public.inventory_stock_receipts (company_id, supplier_id, warehouse_id, bin_id, po_number)
  values (v_company_id, v_supplier_id, v_warehouse_id, v_bin_id, 'TEST-8')
  returning id into v_bad_receipt_id;

  insert into public.inventory_stock_receipt_lines (company_id, receipt_id, item_id, quantity, unit_cost)
  values (v_company_id, v_bad_receipt_id, v_item_id, 1, -1);

  begin
    perform public.inventory_post_stock_receipt(v_bad_receipt_id);
    raise exception 'TEST_8_FAILED expected INVALID_UNIT_COST';
  exception
    when others then
      if sqlerrm not like '%INVALID_UNIT_COST%' then
        raise;
      end if;
  end;

  -- Test 9: client write policies for ledger tables were removed.
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename in ('inventory_stock_balances', 'inventory_movements', 'inventory_supplier_price_history')
    and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');

  if v_count <> 0 then
    raise exception 'TEST_9_FAILED ledger write policies still exist: %', v_count;
  end if;

  -- Test 10: posted receipts and lines cannot be changed outside the RPC guard.
  begin
    update public.inventory_stock_receipts
    set po_number = 'SHOULD-NOT-CHANGE'
    where id = v_receipt_id;
    raise exception 'TEST_10_FAILED expected posted receipt guard';
  exception
    when others then
      if sqlerrm not like '%POSTED_RECEIPT_LOCKED%' then
        raise;
      end if;
  end;

  begin
    update public.inventory_stock_receipt_lines
    set quantity = 99
    where receipt_id = v_receipt_id;
    raise exception 'TEST_10_FAILED expected posted line guard';
  exception
    when others then
      if sqlerrm not like '%POSTED_RECEIPT_LINES_LOCKED%' then
        raise;
      end if;
  end;

  -- Direct average cost changes are blocked outside the receipt RPC.
  begin
    update public.inventory_items
    set average_cost = 999
    where id = v_item_id;
    raise exception 'TEST_COST_GUARD_FAILED expected INVENTORY_ITEM_COST_LOCKED';
  exception
    when others then
      if sqlerrm not like '%INVENTORY_ITEM_COST_LOCKED%' then
        raise;
      end if;
  end;
end;
$$;

rollback;
