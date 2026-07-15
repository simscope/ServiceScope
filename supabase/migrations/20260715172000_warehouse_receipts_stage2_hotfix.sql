-- Warehouse Stage 2 hotfix: landed cost, line insert locking, supplier price restore, explicit RPC grants.

alter table public.inventory_movements
  add column if not exists vendor_unit_cost numeric(14,4),
  add column if not exists extra_cost numeric(14,4) not null default 0;

alter table public.inventory_supplier_price_history
  add column if not exists landed_unit_cost numeric(14,4),
  add column if not exists extra_cost numeric(14,4) not null default 0;

create or replace function public.inventory_guard_receipt_line_update()
returns trigger
language plpgsql
as $$
declare
  receipt_status public.inventory_document_status;
  receipt_posted_at timestamptz;
  receipt_canceled_at timestamptz;
  target_receipt_id uuid;
begin
  if public.inventory_rpc_guard_enabled() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    target_receipt_id := old.receipt_id;
    select status, posted_at, canceled_at
      into receipt_status, receipt_posted_at, receipt_canceled_at
    from public.inventory_stock_receipts
    where id = target_receipt_id
    for update;

    if receipt_status <> 'draft' or receipt_posted_at is not null or receipt_canceled_at is not null then
      raise exception 'POSTED_RECEIPT_LINES_LOCKED' using errcode = 'P0001';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    target_receipt_id := new.receipt_id;
    select status, posted_at, canceled_at
      into receipt_status, receipt_posted_at, receipt_canceled_at
    from public.inventory_stock_receipts
    where id = target_receipt_id
    for update;

    if not found then
      raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001';
    end if;

    if receipt_status <> 'draft' or receipt_posted_at is not null or receipt_canceled_at is not null then
      raise exception 'POSTED_RECEIPT_LINES_LOCKED' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_guard_receipt_line_update on public.inventory_stock_receipt_lines;
create trigger inventory_guard_receipt_line_update
before insert or update or delete on public.inventory_stock_receipt_lines
for each row execute function public.inventory_guard_receipt_line_update();

create or replace function public.inventory_restore_supplier_last_price(
  p_company_id uuid,
  p_item_id uuid,
  p_supplier_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_latest record;
begin
  if p_supplier_id is null then
    return;
  end if;

  select
    l.unit_cost,
    coalesce(l.currency, 'USD') as currency,
    r.posted_at
  into v_latest
  from public.inventory_stock_receipt_lines l
  join public.inventory_stock_receipts r on r.id = l.receipt_id
  where l.company_id = p_company_id
    and l.item_id = p_item_id
    and r.company_id = p_company_id
    and r.supplier_id = p_supplier_id
    and r.status = 'posted'
    and r.posted_at is not null
    and r.canceled_at is null
  order by r.posted_at desc, l.created_at desc, l.id desc
  limit 1;

  if found then
    update public.inventory_item_suppliers
      set last_unit_cost = v_latest.unit_cost,
          currency = v_latest.currency,
          last_price_updated_at = v_latest.posted_at,
          updated_at = now()
    where item_id = p_item_id
      and supplier_id = p_supplier_id;
  else
    update public.inventory_item_suppliers
      set last_unit_cost = 0,
          last_price_updated_at = null,
          updated_at = now()
    where item_id = p_item_id
      and supplier_id = p_supplier_id;
  end if;
end;
$$;

create or replace function public.inventory_post_stock_receipt(p_receipt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_receipt public.inventory_stock_receipts%rowtype;
  v_line public.inventory_stock_receipt_lines%rowtype;
  v_item public.inventory_items%rowtype;
  v_balance public.inventory_stock_balances%rowtype;
  v_supplier_company uuid;
  v_warehouse_company uuid;
  v_bin_warehouse uuid;
  v_line_count integer;
  v_current_total numeric(14,4);
  v_current_average numeric(14,4);
  v_effective_unit_cost numeric(14,4);
  v_new_total numeric(14,4);
  v_new_average numeric(14,4);
  v_balance_before numeric(14,4);
  v_balance_after numeric(14,4);
  v_movement_id uuid;
  v_reference_number text;
  v_posted_lines integer := 0;
begin
  if v_user_id is null then
    raise exception 'ACCESS_DENIED' using errcode = 'P0001';
  end if;

  select * into v_receipt
  from public.inventory_stock_receipts
  where id = p_receipt_id
  for update;

  if not found then
    raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.can_manage_company(v_receipt.company_id) then
    raise exception 'ACCESS_DENIED' using errcode = 'P0001';
  end if;

  if v_receipt.status = 'posted' or v_receipt.posted_at is not null then
    raise exception 'RECEIPT_ALREADY_POSTED' using errcode = 'P0001';
  end if;

  if v_receipt.status <> 'draft' then
    raise exception 'RECEIPT_NOT_DRAFT' using errcode = 'P0001';
  end if;

  select count(*) into v_line_count
  from public.inventory_stock_receipt_lines
  where receipt_id = v_receipt.id
    and company_id = v_receipt.company_id;

  if v_line_count = 0 then
    raise exception 'RECEIPT_HAS_NO_LINES' using errcode = 'P0001';
  end if;

  select company_id into v_warehouse_company
  from public.inventory_warehouses
  where id = v_receipt.warehouse_id
    and is_active = true;

  if v_warehouse_company is null then
    raise exception 'WAREHOUSE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_warehouse_company <> v_receipt.company_id then
    raise exception 'WAREHOUSE_COMPANY_MISMATCH' using errcode = 'P0001';
  end if;

  if v_receipt.bin_id is not null then
    select warehouse_id into v_bin_warehouse
    from public.inventory_bins
    where id = v_receipt.bin_id
      and company_id = v_receipt.company_id
      and is_active = true;

    if v_bin_warehouse is null or v_bin_warehouse <> v_receipt.warehouse_id then
      raise exception 'BIN_WAREHOUSE_MISMATCH' using errcode = 'P0001';
    end if;
  end if;

  if v_receipt.supplier_id is not null then
    select company_id into v_supplier_company
    from public.inventory_suppliers
    where id = v_receipt.supplier_id
      and is_active = true;

    if v_supplier_company is null or v_supplier_company <> v_receipt.company_id then
      raise exception 'SUPPLIER_COMPANY_MISMATCH' using errcode = 'P0001';
    end if;
  end if;

  perform set_config('app.inventory_rpc', 'on', true);
  v_reference_number := coalesce(nullif(v_receipt.invoice_number, ''), nullif(v_receipt.po_number, ''), v_receipt.id::text);

  for v_line in
    select *
    from public.inventory_stock_receipt_lines
    where receipt_id = v_receipt.id
      and company_id = v_receipt.company_id
    order by created_at, id
    for update
  loop
    if v_line.quantity <= 0 then
      raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
    end if;
    if v_line.unit_cost < 0 or v_line.extra_cost < 0 then
      raise exception 'INVALID_UNIT_COST' using errcode = 'P0001';
    end if;
    if v_line.currency <> 'USD' then
      raise exception 'UNSUPPORTED_CURRENCY' using errcode = 'P0001';
    end if;

    v_effective_unit_cost := round(v_line.unit_cost + (v_line.extra_cost / v_line.quantity), 4);

    select * into v_item
    from public.inventory_items
    where id = v_line.item_id
    for update;

    if not found then
      raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_item.company_id <> v_receipt.company_id then
      raise exception 'ITEM_COMPANY_MISMATCH' using errcode = 'P0001';
    end if;
    if v_item.total_quantity < 0 then
      raise exception 'NEGATIVE_CURRENT_STOCK' using errcode = 'P0001';
    end if;

    insert into public.inventory_stock_balances (company_id, item_id, warehouse_id, bin_id, quantity)
    values (v_receipt.company_id, v_line.item_id, v_receipt.warehouse_id, v_receipt.bin_id, 0)
    on conflict do nothing;

    select * into v_balance
    from public.inventory_stock_balances
    where company_id = v_receipt.company_id
      and item_id = v_line.item_id
      and warehouse_id = v_receipt.warehouse_id
      and bin_id is not distinct from v_receipt.bin_id
    for update;

    if not found then
      raise exception 'WAREHOUSE_NOT_FOUND' using errcode = 'P0001';
    end if;

    v_current_total := v_item.total_quantity;
    v_current_average := v_item.average_cost;
    v_new_total := v_current_total + v_line.quantity;
    v_new_average := case
      when v_current_total = 0 then v_effective_unit_cost
      else round(((v_current_total * v_current_average) + (v_line.quantity * v_effective_unit_cost)) / v_new_total, 4)
    end;
    v_balance_before := v_balance.quantity;
    v_balance_after := v_balance.quantity + v_line.quantity;

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
      company_id, item_id, movement_type, quantity, unit_cost, vendor_unit_cost, extra_cost,
      to_warehouse_id, to_bin_id, supplier_id,
      reference_type, reference_id, reference_number, notes,
      receipt_id, receipt_line_id,
      balance_before, balance_after, average_cost_before, average_cost_after,
      created_by_user_id
    )
    values (
      v_receipt.company_id, v_line.item_id, 'receipt', v_line.quantity, v_effective_unit_cost, v_line.unit_cost, v_line.extra_cost,
      v_receipt.warehouse_id, v_receipt.bin_id, v_receipt.supplier_id,
      'stock_receipt', v_receipt.id, v_reference_number, v_receipt.notes,
      v_receipt.id, v_line.id,
      v_balance_before, v_balance_after, v_current_average, v_new_average,
      v_user_id
    )
    returning id into v_movement_id;

    update public.inventory_stock_receipt_lines
      set movement_id = v_movement_id
    where id = v_line.id;

    if v_receipt.supplier_id is not null then
      insert into public.inventory_item_suppliers (
        company_id, item_id, supplier_id, last_unit_cost, currency, last_price_updated_at
      )
      values (
        v_receipt.company_id, v_line.item_id, v_receipt.supplier_id, v_line.unit_cost, 'USD', now()
      )
      on conflict (item_id, supplier_id) do update
        set last_unit_cost = excluded.last_unit_cost,
            currency = excluded.currency,
            last_price_updated_at = excluded.last_price_updated_at,
            updated_at = now();

      insert into public.inventory_supplier_price_history (
        company_id, item_id, supplier_id, receipt_id, receipt_line_id,
        unit_cost, landed_unit_cost, extra_cost, currency, created_by_user_id
      )
      values (
        v_receipt.company_id, v_line.item_id, v_receipt.supplier_id, v_receipt.id, v_line.id,
        v_line.unit_cost, v_effective_unit_cost, v_line.extra_cost, 'USD', v_user_id
      );
    end if;

    v_posted_lines := v_posted_lines + 1;
  end loop;

  update public.inventory_stock_receipts
    set status = 'posted',
        posted_at = now(),
        posted_by_user_id = v_user_id,
        updated_at = now()
  where id = v_receipt.id;

  return jsonb_build_object('status', 'posted', 'receipt_id', v_receipt.id, 'posted_lines', v_posted_lines);
exception
  when unique_violation then
    raise exception 'RECEIPT_ALREADY_POSTED' using errcode = 'P0001';
end;
$$;

create or replace function public.inventory_cancel_stock_receipt(p_receipt_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_receipt public.inventory_stock_receipts%rowtype;
  v_line public.inventory_stock_receipt_lines%rowtype;
  v_item public.inventory_items%rowtype;
  v_balance public.inventory_stock_balances%rowtype;
  v_movement public.inventory_movements%rowtype;
  v_later_count integer;
  v_new_balance numeric(14,4);
  v_prior_total numeric(14,4);
  v_prior_average numeric(14,4);
  v_canceled_lines integer := 0;
begin
  if v_user_id is null then
    raise exception 'ACCESS_DENIED' using errcode = 'P0001';
  end if;

  select * into v_receipt
  from public.inventory_stock_receipts
  where id = p_receipt_id
  for update;

  if not found then
    raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not public.can_manage_company(v_receipt.company_id) then
    raise exception 'ACCESS_DENIED' using errcode = 'P0001';
  end if;

  if v_receipt.status <> 'posted' then
    raise exception 'RECEIPT_NOT_DRAFT' using errcode = 'P0001';
  end if;

  perform set_config('app.inventory_rpc', 'on', true);

  for v_line in
    select *
    from public.inventory_stock_receipt_lines
    where receipt_id = v_receipt.id
      and company_id = v_receipt.company_id
    order by created_at desc, id desc
    for update
  loop
    select * into v_movement
    from public.inventory_movements
    where receipt_line_id = v_line.id
      and movement_type = 'receipt'
    for update;

    if not found then
      raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001';
    end if;

    select count(*) into v_later_count
    from public.inventory_movements
    where company_id = v_receipt.company_id
      and item_id = v_line.item_id
      and created_at > v_movement.created_at
      and id <> v_movement.id;

    if v_later_count > 0 then
      raise exception 'RECEIPT_HAS_LATER_MOVEMENTS' using errcode = 'P0001';
    end if;

    select * into v_item
    from public.inventory_items
    where id = v_line.item_id
    for update;

    select * into v_balance
    from public.inventory_stock_balances
    where company_id = v_receipt.company_id
      and item_id = v_line.item_id
      and warehouse_id = v_receipt.warehouse_id
      and bin_id is not distinct from v_receipt.bin_id
    for update;

    if not found or v_balance.quantity < v_line.quantity then
      raise exception 'INSUFFICIENT_STOCK_TO_CANCEL' using errcode = 'P0001';
    end if;

    v_new_balance := v_balance.quantity - v_line.quantity;
    v_prior_total := v_item.total_quantity - v_line.quantity;
    if v_prior_total < 0 then
      raise exception 'INSUFFICIENT_STOCK_TO_CANCEL' using errcode = 'P0001';
    end if;
    v_prior_average := case
      when v_prior_total = 0 then 0
      else round(((v_item.total_quantity * v_item.average_cost) - (v_line.quantity * v_movement.unit_cost)) / v_prior_total, 4)
    end;

    update public.inventory_stock_balances
      set quantity = v_new_balance,
          updated_at = now()
    where id = v_balance.id;

    update public.inventory_items
      set total_quantity = v_prior_total,
          average_cost = v_prior_average,
          updated_at = now()
    where id = v_item.id;

    insert into public.inventory_movements (
      company_id, item_id, movement_type, quantity, unit_cost, vendor_unit_cost, extra_cost,
      from_warehouse_id, from_bin_id, supplier_id,
      reference_type, reference_id, reference_number, notes,
      receipt_id, receipt_line_id,
      balance_before, balance_after, average_cost_before, average_cost_after,
      created_by_user_id
    )
    values (
      v_receipt.company_id, v_line.item_id, 'adjustment', v_line.quantity, v_movement.unit_cost, v_movement.vendor_unit_cost, v_movement.extra_cost,
      v_receipt.warehouse_id, v_receipt.bin_id, v_receipt.supplier_id,
      'stock_receipt_cancel', v_receipt.id, coalesce(nullif(v_receipt.invoice_number, ''), nullif(v_receipt.po_number, ''), v_receipt.id::text), coalesce(p_reason, ''),
      v_receipt.id, v_line.id,
      v_balance.quantity, v_new_balance, v_item.average_cost, v_prior_average,
      v_user_id
    );

    v_canceled_lines := v_canceled_lines + 1;
  end loop;

  update public.inventory_stock_receipts
    set status = 'canceled',
        canceled_at = now(),
        canceled_by_user_id = v_user_id,
        cancel_reason = coalesce(p_reason, ''),
        updated_at = now()
  where id = v_receipt.id;

  for v_line in
    select *
    from public.inventory_stock_receipt_lines
    where receipt_id = v_receipt.id
      and company_id = v_receipt.company_id
  loop
    perform public.inventory_restore_supplier_last_price(v_receipt.company_id, v_line.item_id, v_receipt.supplier_id);
  end loop;

  return jsonb_build_object('status', 'canceled', 'receipt_id', v_receipt.id, 'canceled_lines', v_canceled_lines);
end;
$$;

revoke all on function public.inventory_post_stock_receipt(uuid) from public;
revoke all on function public.inventory_post_stock_receipt(uuid) from anon;
revoke all on function public.inventory_post_stock_receipt(uuid) from authenticated;
grant execute on function public.inventory_post_stock_receipt(uuid) to authenticated;

revoke all on function public.inventory_cancel_stock_receipt(uuid, text) from public;
revoke all on function public.inventory_cancel_stock_receipt(uuid, text) from anon;
revoke all on function public.inventory_cancel_stock_receipt(uuid, text) from authenticated;
grant execute on function public.inventory_cancel_stock_receipt(uuid, text) to authenticated;

revoke all on function public.inventory_restore_supplier_last_price(uuid, uuid, uuid) from public;
revoke all on function public.inventory_restore_supplier_last_price(uuid, uuid, uuid) from anon;
revoke all on function public.inventory_restore_supplier_last_price(uuid, uuid, uuid) from authenticated;
