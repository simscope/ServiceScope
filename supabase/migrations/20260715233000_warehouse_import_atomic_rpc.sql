-- Warehouse product import atomic receive RPC.
-- The frontend must not create receipt/import rows step-by-step; this function keeps the stock update idempotent.

create table if not exists public.inventory_import_operations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  idempotency_key uuid not null,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (company_id, idempotency_key)
);

drop trigger if exists set_inventory_import_operations_updated_at on public.inventory_import_operations;
create trigger set_inventory_import_operations_updated_at
before update on public.inventory_import_operations
for each row execute function public.set_updated_at();

alter table public.inventory_import_operations enable row level security;

drop policy if exists "inventory import operations readable by company or platform" on public.inventory_import_operations;
create policy "inventory import operations readable by company or platform" on public.inventory_import_operations
  for select using (public.can_access_company(company_id));

drop policy if exists "inventory import operations manageable by company managers or platform" on public.inventory_import_operations;
create policy "inventory import operations manageable by company managers or platform" on public.inventory_import_operations
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create or replace function public.inventory_normalize_supplier_url(p_url text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(regexp_replace(coalesce(trim(p_url), ''), '#.*$', ''), '/$', ''));
$$;

create or replace function public.inventory_post_stock_receipt_internal(
  p_receipt_id uuid,
  p_user_id uuid,
  p_require_access_check boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
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
  if p_user_id is null then
    raise exception 'ACCESS_DENIED' using errcode = 'P0001';
  end if;

  select * into v_receipt
  from public.inventory_stock_receipts
  where id = p_receipt_id
  for update;

  if not found then
    raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_require_access_check and not public.can_manage_company(v_receipt.company_id) then
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
      p_user_id
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
        v_line.unit_cost, v_effective_unit_cost, v_line.extra_cost, 'USD', p_user_id
      );
    end if;

    v_posted_lines := v_posted_lines + 1;
  end loop;

  update public.inventory_stock_receipts
    set status = 'posted',
        posted_at = now(),
        posted_by_user_id = p_user_id,
        updated_at = now()
  where id = v_receipt.id;

  return jsonb_build_object('status', 'posted', 'receipt_id', v_receipt.id, 'posted_lines', v_posted_lines);
exception
  when unique_violation then
    raise exception 'RECEIPT_ALREADY_POSTED' using errcode = 'P0001';
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
begin
  return public.inventory_post_stock_receipt_internal(p_receipt_id, v_user_id, true);
end;
$$;

create or replace function public.inventory_import_product_to_stock(
  p_company_id uuid,
  p_idempotency_key uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_operation public.inventory_import_operations%rowtype;
  v_item public.inventory_items%rowtype;
  v_supplier public.inventory_suppliers%rowtype;
  v_link public.inventory_supplier_links%rowtype;
  v_receipt_id uuid;
  v_line_id uuid;
  v_movement_id uuid;
  v_item_id uuid;
  v_supplier_id uuid;
  v_quantity numeric(14,4);
  v_units_per_package numeric(14,4);
  v_package_price numeric(14,4);
  v_unit_cost numeric(14,4);
  v_extra_cost numeric(14,4);
  v_warehouse_id uuid;
  v_bin_id uuid;
  v_title text;
  v_supplier_name text;
  v_source_type text;
  v_source_url text;
  v_canonical_url text;
  v_source_url_normalized text;
  v_canonical_url_normalized text;
  v_external_product_id text;
  v_asin text;
  v_ebay_item_id text;
  v_part_number text;
  v_create_new boolean;
  v_post_result jsonb;
  v_result jsonb;
  v_warnings text[] := array[]::text[];
begin
  if v_user_id is null then
    raise exception 'ACCESS_DENIED' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;
  if not public.can_manage_company(p_company_id) then
    raise exception 'ACCESS_DENIED' using errcode = 'P0001';
  end if;

  insert into public.inventory_import_operations (company_id, idempotency_key, created_by)
  values (p_company_id, p_idempotency_key, v_user_id)
  on conflict (company_id, idempotency_key) do nothing;

  select * into v_operation
  from public.inventory_import_operations
  where company_id = p_company_id
    and idempotency_key = p_idempotency_key
  for update;

  if v_operation.status = 'completed' and v_operation.result is not null then
    return v_operation.result || jsonb_build_object('idempotent_replay', true);
  end if;

  v_warehouse_id := nullif(p_payload->>'warehouse_id', '')::uuid;
  v_bin_id := nullif(p_payload->>'bin_id', '')::uuid;
  v_title := trim(coalesce(p_payload->>'title', ''));
  v_supplier_name := trim(coalesce(p_payload->>'supplier_name', ''));
  v_source_type := coalesce(nullif(p_payload->>'source_type', ''), 'generic');
  v_source_url := trim(coalesce(p_payload->>'source_url', ''));
  v_canonical_url := trim(coalesce(p_payload->>'canonical_url', v_source_url));
  v_source_url_normalized := public.inventory_normalize_supplier_url(v_source_url);
  v_canonical_url_normalized := public.inventory_normalize_supplier_url(v_canonical_url);
  v_external_product_id := trim(coalesce(p_payload->>'external_product_id', ''));
  v_asin := trim(coalesce(p_payload->>'asin', ''));
  v_ebay_item_id := trim(coalesce(p_payload->>'ebay_item_id', ''));
  v_part_number := trim(coalesce(p_payload->>'part_number', ''));
  v_create_new := coalesce((p_payload->>'create_new_part')::boolean, false);
  v_quantity := round(greatest(0, coalesce((p_payload->>'packages_received')::numeric, 0)) * greatest(0, coalesce((p_payload->>'units_per_package')::numeric, 0)), 4);
  v_units_per_package := round(greatest(0, coalesce((p_payload->>'units_per_package')::numeric, 0)), 4);
  v_package_price := round(greatest(0, coalesce((p_payload->>'package_price')::numeric, 0)), 4);
  v_extra_cost := round(greatest(0, coalesce((p_payload->>'shipping_cost')::numeric, 0)) + greatest(0, coalesce((p_payload->>'tax_cost')::numeric, 0)) + greatest(0, coalesce((p_payload->>'other_cost')::numeric, 0)), 4);

  if v_title = '' then
    raise exception 'ITEM_NAME_REQUIRED' using errcode = 'P0001';
  end if;
  if v_warehouse_id is null then
    raise exception 'WAREHOUSE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_quantity <= 0 or v_units_per_package <= 0 then
    raise exception 'INVALID_QUANTITY' using errcode = 'P0001';
  end if;
  if v_package_price < 0 then
    raise exception 'INVALID_UNIT_COST' using errcode = 'P0001';
  end if;
  v_unit_cost := round(v_package_price / v_units_per_package, 4);

  if not v_create_new then
    v_item_id := nullif(p_payload->>'selected_item_id', '')::uuid;
  end if;

  if v_item_id is null then
    select * into v_link
    from public.inventory_supplier_links l
    where l.company_id = p_company_id
      and (
        (v_external_product_id <> '' and l.source_type = v_source_type and l.external_product_id = v_external_product_id)
        or (v_asin <> '' and l.asin = v_asin)
        or (v_ebay_item_id <> '' and l.ebay_item_id = v_ebay_item_id)
        or (v_canonical_url_normalized <> '' and l.canonical_url_normalized = v_canonical_url_normalized)
        or (v_source_url_normalized <> '' and l.source_url_normalized = v_source_url_normalized)
      )
    order by last_checked_at desc nulls last, created_at desc
    limit 1
    for update;

    if found then
      v_item_id := v_link.item_id;
    end if;
  end if;

  if v_item_id is null and v_part_number <> '' then
    select * into v_item
    from public.inventory_items
    where company_id = p_company_id
      and lower(part_number) = lower(v_part_number)
    order by created_at desc
    limit 1
    for update;
    if found then
      v_item_id := v_item.id;
    end if;
  end if;

  if v_item_id is not null then
    select * into v_item
    from public.inventory_items
    where id = v_item_id
    for update;
    if not found or v_item.company_id <> p_company_id then
      raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
    end if;
  else
    insert into public.inventory_items (
      company_id, internal_name, category, manufacturer, oem, part_number,
      alternate_part_number, description, unit, source_image_url, notes
    )
    values (
      p_company_id,
      v_title,
      '',
      trim(coalesce(p_payload->>'manufacturer', p_payload->>'brand', '')),
      trim(coalesce(p_payload->>'oem', p_payload->>'model', '')),
      v_part_number,
      coalesce(nullif(v_asin, ''), nullif(v_ebay_item_id, ''), ''),
      trim(coalesce(p_payload->>'description', '')),
      'pcs',
      trim(coalesce(p_payload->>'image_url', '')),
      ''
    )
    returning * into v_item;
    v_item_id := v_item.id;
  end if;

  if trim(coalesce(p_payload->>'image_url', '')) <> '' and coalesce(v_item.source_image_url, '') = '' then
    update public.inventory_items
      set source_image_url = trim(coalesce(p_payload->>'image_url', '')),
          updated_at = now()
    where id = v_item.id;
    v_warnings := array_append(v_warnings, 'Imported image source URL was saved. Permanent Storage copy is handled by server deployment when image storage is configured.');
  end if;

  if v_supplier_name <> '' then
    select * into v_supplier
    from public.inventory_suppliers
    where company_id = p_company_id
      and lower(name) = lower(v_supplier_name)
    limit 1
    for update;

    if not found then
      insert into public.inventory_suppliers (company_id, name, website)
      values (p_company_id, v_supplier_name, coalesce(nullif(v_canonical_url, ''), v_source_url))
      returning * into v_supplier;
    end if;
    v_supplier_id := v_supplier.id;
  end if;

  if v_supplier_id is not null then
    insert into public.inventory_item_suppliers (
      company_id, item_id, supplier_id, supplier_part_number, supplier_description,
      last_unit_cost, currency, product_url, last_price_updated_at
    )
    values (
      p_company_id, v_item_id, v_supplier_id, coalesce(nullif(v_part_number, ''), v_external_product_id),
      v_title, v_unit_cost, coalesce(nullif(p_payload->>'currency', ''), 'USD'),
      coalesce(nullif(v_canonical_url, ''), v_source_url), now()
    )
    on conflict (item_id, supplier_id) do update
      set supplier_part_number = excluded.supplier_part_number,
          supplier_description = excluded.supplier_description,
          last_unit_cost = excluded.last_unit_cost,
          currency = excluded.currency,
          product_url = excluded.product_url,
          last_price_updated_at = excluded.last_price_updated_at,
          updated_at = now();
  end if;

  if v_canonical_url_normalized <> '' then
    if v_link.id is not null then
      update public.inventory_supplier_links
        set item_id = v_item_id,
            supplier_id = v_supplier_id,
            source_type = v_source_type,
            source_domain = trim(coalesce(p_payload->>'source_domain', '')),
            source_url = v_source_url,
            source_url_normalized = v_source_url_normalized,
            canonical_url = v_canonical_url,
            canonical_url_normalized = v_canonical_url_normalized,
            external_product_id = v_external_product_id,
            asin = v_asin,
            ebay_item_id = v_ebay_item_id,
            supplier_part_number = v_part_number,
            last_title = v_title,
            last_image_url = trim(coalesce(p_payload->>'image_url', '')),
            last_vendor_price = v_package_price,
            currency = coalesce(nullif(p_payload->>'currency', ''), 'USD'),
            pack_quantity = v_units_per_package,
            last_checked_at = now()
      where id = v_link.id;
    else
      insert into public.inventory_supplier_links (
        company_id, item_id, supplier_id, source_type, source_domain,
        source_url, source_url_normalized, canonical_url, canonical_url_normalized,
        external_product_id, asin, ebay_item_id, supplier_part_number,
        last_title, last_image_url, last_vendor_price, currency, pack_quantity,
        last_checked_at, created_by
      )
      values (
        p_company_id, v_item_id, v_supplier_id, v_source_type, trim(coalesce(p_payload->>'source_domain', '')),
        v_source_url, v_source_url_normalized, v_canonical_url, v_canonical_url_normalized,
        v_external_product_id, v_asin, v_ebay_item_id, v_part_number,
        v_title, trim(coalesce(p_payload->>'image_url', '')), v_package_price,
        coalesce(nullif(p_payload->>'currency', ''), 'USD'), v_units_per_package,
        now(), v_user_id
      )
      on conflict (company_id, canonical_url_normalized) do update
        set item_id = excluded.item_id,
            supplier_id = excluded.supplier_id,
            source_type = excluded.source_type,
            source_domain = excluded.source_domain,
            source_url = excluded.source_url,
            source_url_normalized = excluded.source_url_normalized,
            external_product_id = excluded.external_product_id,
            asin = excluded.asin,
            ebay_item_id = excluded.ebay_item_id,
            supplier_part_number = excluded.supplier_part_number,
            last_title = excluded.last_title,
            last_image_url = excluded.last_image_url,
            last_vendor_price = excluded.last_vendor_price,
            currency = excluded.currency,
            pack_quantity = excluded.pack_quantity,
            last_checked_at = excluded.last_checked_at;
    end if;
  end if;

  insert into public.inventory_stock_receipts (
    company_id, supplier_id, warehouse_id, bin_id, receipt_date,
    po_number, invoice_number, status, notes, created_by_user_id
  )
  values (
    p_company_id, v_supplier_id, v_warehouse_id, v_bin_id,
    coalesce(nullif(p_payload->>'receipt_date', '')::date, current_date),
    trim(coalesce(p_payload->>'po_number', '')),
    trim(coalesce(p_payload->>'invoice_number', '')),
    'draft',
    'Imported from ' || coalesce(nullif(v_canonical_url, ''), v_source_url),
    v_user_id
  )
  returning id into v_receipt_id;

  insert into public.inventory_stock_receipt_lines (
    company_id, receipt_id, item_id, quantity, unit_cost, extra_cost, currency
  )
  values (
    p_company_id, v_receipt_id, v_item_id, v_quantity, v_unit_cost, v_extra_cost,
    coalesce(nullif(p_payload->>'currency', ''), 'USD')
  )
  returning id into v_line_id;

  v_post_result := public.inventory_post_stock_receipt_internal(v_receipt_id, v_user_id, false);

  select movement_id into v_movement_id
  from public.inventory_stock_receipt_lines
  where id = v_line_id;

  select * into v_item
  from public.inventory_items
  where id = v_item_id;

  v_result := jsonb_build_object(
    'status', 'imported',
    'item_id', v_item_id,
    'supplier_id', v_supplier_id,
    'receipt_id', v_receipt_id,
    'receipt_line_id', v_line_id,
    'movement_id', v_movement_id,
    'new_total_quantity', v_item.total_quantity,
    'average_cost', v_item.average_cost,
    'posted', v_post_result,
    'warnings', to_jsonb(v_warnings),
    'idempotent_replay', false
  );

  update public.inventory_import_operations
    set status = 'completed',
        result = v_result,
        updated_at = now()
  where id = v_operation.id;

  return v_result;
end;
$$;

revoke all on function public.inventory_post_stock_receipt_internal(uuid, uuid, boolean) from public;
revoke all on function public.inventory_post_stock_receipt_internal(uuid, uuid, boolean) from anon;
revoke all on function public.inventory_post_stock_receipt_internal(uuid, uuid, boolean) from authenticated;

revoke all on function public.inventory_import_product_to_stock(uuid, uuid, jsonb) from public;
revoke all on function public.inventory_import_product_to_stock(uuid, uuid, jsonb) from anon;
revoke all on function public.inventory_import_product_to_stock(uuid, uuid, jsonb) from authenticated;
grant execute on function public.inventory_import_product_to_stock(uuid, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
