-- Warehouse Stage 3: transfer and stock adjustment documents.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'inventory_adjustment_reason') then
    create type public.inventory_adjustment_reason as enum ('initial', 'count', 'shortage', 'damage', 'found', 'correction');
  end if;
end $$;

create table if not exists public.inventory_transfer_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  from_warehouse_id uuid not null references public.inventory_warehouses(id) on delete restrict,
  from_bin_id uuid references public.inventory_bins(id) on delete set null,
  to_warehouse_id uuid not null references public.inventory_warehouses(id) on delete restrict,
  to_bin_id uuid references public.inventory_bins(id) on delete set null,
  transfer_date date not null default current_date,
  reference_number text not null default '',
  status public.inventory_document_status not null default 'draft',
  notes text not null default '',
  posted_at timestamptz,
  posted_by_user_id uuid references auth.users(id) on delete set null,
  canceled_at timestamptz,
  canceled_by_user_id uuid references auth.users(id) on delete set null,
  cancel_reason text not null default '',
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_transfer_different_positions check (
    from_warehouse_id <> to_warehouse_id or from_bin_id is distinct from to_bin_id
  )
);

create table if not exists public.inventory_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  transfer_id uuid not null references public.inventory_transfer_documents(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity numeric(14,4) not null,
  out_movement_id uuid references public.inventory_movements(id) on delete set null,
  in_movement_id uuid references public.inventory_movements(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_transfer_lines_positive_quantity check (quantity > 0)
);

create table if not exists public.inventory_adjustment_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  warehouse_id uuid not null references public.inventory_warehouses(id) on delete restrict,
  bin_id uuid references public.inventory_bins(id) on delete set null,
  adjustment_date date not null default current_date,
  reason public.inventory_adjustment_reason not null default 'count',
  reference_number text not null default '',
  status public.inventory_document_status not null default 'draft',
  notes text not null default '',
  posted_at timestamptz,
  posted_by_user_id uuid references auth.users(id) on delete set null,
  canceled_at timestamptz,
  canceled_by_user_id uuid references auth.users(id) on delete set null,
  cancel_reason text not null default '',
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_adjustment_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  adjustment_id uuid not null references public.inventory_adjustment_documents(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity_delta numeric(14,4) not null,
  unit_cost numeric(14,4) not null default 0,
  movement_id uuid references public.inventory_movements(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_adjustment_lines_nonzero_quantity check (quantity_delta <> 0),
  constraint inventory_adjustment_lines_nonnegative_cost check (unit_cost >= 0)
);

alter table public.inventory_movements
  add column if not exists transfer_id uuid references public.inventory_transfer_documents(id) on delete set null,
  add column if not exists transfer_line_id uuid references public.inventory_transfer_lines(id) on delete set null,
  add column if not exists adjustment_id uuid references public.inventory_adjustment_documents(id) on delete set null,
  add column if not exists adjustment_line_id uuid references public.inventory_adjustment_lines(id) on delete set null;

create unique index if not exists idx_inventory_transfer_line_out_once
  on public.inventory_movements(transfer_line_id, movement_type)
  where transfer_line_id is not null and movement_type = 'transfer_out';
create unique index if not exists idx_inventory_transfer_line_in_once
  on public.inventory_movements(transfer_line_id, movement_type)
  where transfer_line_id is not null and movement_type = 'transfer_in';
create unique index if not exists idx_inventory_adjustment_line_once
  on public.inventory_movements(adjustment_line_id, reference_type)
  where adjustment_line_id is not null and reference_type = 'stock_adjustment';
create unique index if not exists idx_inventory_transfer_lines_unique_item
  on public.inventory_transfer_lines(transfer_id, item_id);
create unique index if not exists idx_inventory_adjustment_lines_unique_item
  on public.inventory_adjustment_lines(adjustment_id, item_id);

create index if not exists idx_inventory_transfer_docs_company_status on public.inventory_transfer_documents(company_id, status, transfer_date desc);
create index if not exists idx_inventory_adjustment_docs_company_status on public.inventory_adjustment_documents(company_id, status, adjustment_date desc);
create index if not exists idx_inventory_movements_transfer on public.inventory_movements(company_id, transfer_id, transfer_line_id);
create index if not exists idx_inventory_movements_adjustment on public.inventory_movements(company_id, adjustment_id, adjustment_line_id);

drop trigger if exists set_inventory_transfer_documents_updated_at on public.inventory_transfer_documents;
create trigger set_inventory_transfer_documents_updated_at before update on public.inventory_transfer_documents for each row execute function public.set_updated_at();
drop trigger if exists set_inventory_adjustment_documents_updated_at on public.inventory_adjustment_documents;
create trigger set_inventory_adjustment_documents_updated_at before update on public.inventory_adjustment_documents for each row execute function public.set_updated_at();

alter table public.inventory_transfer_documents enable row level security;
alter table public.inventory_transfer_lines enable row level security;
alter table public.inventory_adjustment_documents enable row level security;
alter table public.inventory_adjustment_lines enable row level security;

drop policy if exists "inventory transfers readable by company or platform" on public.inventory_transfer_documents;
create policy "inventory transfers readable by company or platform" on public.inventory_transfer_documents
  for select using (public.can_access_company(company_id));
drop policy if exists "inventory transfer lines readable by company or platform" on public.inventory_transfer_lines;
create policy "inventory transfer lines readable by company or platform" on public.inventory_transfer_lines
  for select using (public.can_access_company(company_id));
drop policy if exists "inventory adjustments readable by company or platform" on public.inventory_adjustment_documents;
create policy "inventory adjustments readable by company or platform" on public.inventory_adjustment_documents
  for select using (public.can_access_company(company_id));
drop policy if exists "inventory adjustment lines readable by company or platform" on public.inventory_adjustment_lines;
create policy "inventory adjustment lines readable by company or platform" on public.inventory_adjustment_lines
  for select using (public.can_access_company(company_id));

create policy "inventory transfers insertable as drafts by company managers or platform" on public.inventory_transfer_documents
  for insert with check (public.can_manage_company(company_id) and status = 'draft' and posted_at is null and canceled_at is null);
create policy "inventory transfers draft editable by company managers or platform" on public.inventory_transfer_documents
  for update using (public.can_manage_company(company_id) and status = 'draft' and posted_at is null and canceled_at is null)
  with check (public.can_manage_company(company_id) and status = 'draft' and posted_at is null and canceled_at is null);
create policy "inventory transfers draft deletable by company managers or platform" on public.inventory_transfer_documents
  for delete using (public.can_manage_company(company_id) and status = 'draft' and posted_at is null and canceled_at is null);

create policy "inventory adjustments insertable as drafts by company managers or platform" on public.inventory_adjustment_documents
  for insert with check (public.can_manage_company(company_id) and status = 'draft' and posted_at is null and canceled_at is null);
create policy "inventory adjustments draft editable by company managers or platform" on public.inventory_adjustment_documents
  for update using (public.can_manage_company(company_id) and status = 'draft' and posted_at is null and canceled_at is null)
  with check (public.can_manage_company(company_id) and status = 'draft' and posted_at is null and canceled_at is null);
create policy "inventory adjustments draft deletable by company managers or platform" on public.inventory_adjustment_documents
  for delete using (public.can_manage_company(company_id) and status = 'draft' and posted_at is null and canceled_at is null);

create policy "inventory transfer lines writable for draft transfers by company managers or platform" on public.inventory_transfer_lines
  for all using (
    public.can_manage_company(company_id)
    and exists (select 1 from public.inventory_transfer_documents d where d.id = transfer_id and d.company_id = inventory_transfer_lines.company_id and d.status = 'draft' and d.posted_at is null and d.canceled_at is null)
  )
  with check (
    public.can_manage_company(company_id)
    and exists (select 1 from public.inventory_transfer_documents d where d.id = transfer_id and d.company_id = inventory_transfer_lines.company_id and d.status = 'draft' and d.posted_at is null and d.canceled_at is null)
  );
create policy "inventory adjustment lines writable for draft adjustments by company managers or platform" on public.inventory_adjustment_lines
  for all using (
    public.can_manage_company(company_id)
    and exists (select 1 from public.inventory_adjustment_documents d where d.id = adjustment_id and d.company_id = inventory_adjustment_lines.company_id and d.status = 'draft' and d.posted_at is null and d.canceled_at is null)
  )
  with check (
    public.can_manage_company(company_id)
    and exists (select 1 from public.inventory_adjustment_documents d where d.id = adjustment_id and d.company_id = inventory_adjustment_lines.company_id and d.status = 'draft' and d.posted_at is null and d.canceled_at is null)
  );

create or replace function public.inventory_guard_transfer_document_update()
returns trigger language plpgsql as $$
begin
  if public.inventory_rpc_guard_enabled() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' or old.posted_at is not null or old.canceled_at is not null then
      raise exception 'POSTED_TRANSFER_LOCKED' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status <> 'draft' or old.posted_at is not null or old.canceled_at is not null then
    raise exception 'POSTED_TRANSFER_LOCKED' using errcode = 'P0001';
  end if;
  if new.status <> 'draft' or new.posted_at is not null or new.canceled_at is not null then
    raise exception 'TRANSFER_POSTING_REQUIRES_RPC' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.inventory_guard_adjustment_document_update()
returns trigger language plpgsql as $$
begin
  if public.inventory_rpc_guard_enabled() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' or old.posted_at is not null or old.canceled_at is not null then
      raise exception 'POSTED_ADJUSTMENT_LOCKED' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.status <> 'draft' or old.posted_at is not null or old.canceled_at is not null then
    raise exception 'POSTED_ADJUSTMENT_LOCKED' using errcode = 'P0001';
  end if;
  if new.status <> 'draft' or new.posted_at is not null or new.canceled_at is not null then
    raise exception 'ADJUSTMENT_POSTING_REQUIRES_RPC' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.inventory_guard_transfer_line_update()
returns trigger language plpgsql as $$
declare
  doc_status public.inventory_document_status;
  doc_posted_at timestamptz;
  doc_canceled_at timestamptz;
  target_id uuid;
begin
  if public.inventory_rpc_guard_enabled() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  target_id := case when tg_op = 'DELETE' then old.transfer_id else new.transfer_id end;
  select status, posted_at, canceled_at into doc_status, doc_posted_at, doc_canceled_at
  from public.inventory_transfer_documents where id = target_id for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode = 'P0001'; end if;
  if doc_status <> 'draft' or doc_posted_at is not null or doc_canceled_at is not null then
    raise exception 'POSTED_TRANSFER_LINES_LOCKED' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.inventory_guard_adjustment_line_update()
returns trigger language plpgsql as $$
declare
  doc_status public.inventory_document_status;
  doc_posted_at timestamptz;
  doc_canceled_at timestamptz;
  target_id uuid;
begin
  if public.inventory_rpc_guard_enabled() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  target_id := case when tg_op = 'DELETE' then old.adjustment_id else new.adjustment_id end;
  select status, posted_at, canceled_at into doc_status, doc_posted_at, doc_canceled_at
  from public.inventory_adjustment_documents where id = target_id for update;
  if not found then raise exception 'ADJUSTMENT_NOT_FOUND' using errcode = 'P0001'; end if;
  if doc_status <> 'draft' or doc_posted_at is not null or doc_canceled_at is not null then
    raise exception 'POSTED_ADJUSTMENT_LINES_LOCKED' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists inventory_guard_transfer_document_update on public.inventory_transfer_documents;
create trigger inventory_guard_transfer_document_update before update or delete on public.inventory_transfer_documents
for each row execute function public.inventory_guard_transfer_document_update();
drop trigger if exists inventory_guard_adjustment_document_update on public.inventory_adjustment_documents;
create trigger inventory_guard_adjustment_document_update before update or delete on public.inventory_adjustment_documents
for each row execute function public.inventory_guard_adjustment_document_update();
drop trigger if exists inventory_guard_transfer_line_update on public.inventory_transfer_lines;
create trigger inventory_guard_transfer_line_update before insert or update or delete on public.inventory_transfer_lines
for each row execute function public.inventory_guard_transfer_line_update();
drop trigger if exists inventory_guard_adjustment_line_update on public.inventory_adjustment_lines;
create trigger inventory_guard_adjustment_line_update before insert or update or delete on public.inventory_adjustment_lines
for each row execute function public.inventory_guard_adjustment_line_update();

create or replace function public.inventory_post_transfer(p_transfer_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user_id uuid := auth.uid();
  v_doc public.inventory_transfer_documents%rowtype;
  v_line public.inventory_transfer_lines%rowtype;
  v_item public.inventory_items%rowtype;
  v_from public.inventory_stock_balances%rowtype;
  v_to public.inventory_stock_balances%rowtype;
  v_from_company uuid;
  v_to_company uuid;
  v_bin_warehouse uuid;
  v_line_count integer;
  v_unit_cost numeric(14,4);
  v_out_id uuid;
  v_in_id uuid;
  v_posted_lines integer := 0;
begin
  if v_user_id is null then raise exception 'ACCESS_DENIED' using errcode = 'P0001'; end if;
  select * into v_doc from public.inventory_transfer_documents where id = p_transfer_id for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode = 'P0001'; end if;
  if not public.can_manage_company(v_doc.company_id) then raise exception 'ACCESS_DENIED' using errcode = 'P0001'; end if;
  if v_doc.status = 'posted' or v_doc.posted_at is not null then raise exception 'TRANSFER_ALREADY_POSTED' using errcode = 'P0001'; end if;
  if v_doc.status <> 'draft' then raise exception 'TRANSFER_NOT_DRAFT' using errcode = 'P0001'; end if;

  select company_id into v_from_company from public.inventory_warehouses where id = v_doc.from_warehouse_id and is_active = true;
  select company_id into v_to_company from public.inventory_warehouses where id = v_doc.to_warehouse_id and is_active = true;
  if v_from_company is null or v_to_company is null then raise exception 'WAREHOUSE_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_from_company <> v_doc.company_id or v_to_company <> v_doc.company_id then raise exception 'WAREHOUSE_COMPANY_MISMATCH' using errcode = 'P0001'; end if;
  if v_doc.from_warehouse_id = v_doc.to_warehouse_id and v_doc.from_bin_id is not distinct from v_doc.to_bin_id then
    raise exception 'TRANSFER_SAME_LOCATION' using errcode = 'P0001';
  end if;
  if v_doc.from_bin_id is not null then
    select warehouse_id into v_bin_warehouse from public.inventory_bins where id = v_doc.from_bin_id and company_id = v_doc.company_id and is_active = true;
    if v_bin_warehouse is null or v_bin_warehouse <> v_doc.from_warehouse_id then raise exception 'BIN_WAREHOUSE_MISMATCH' using errcode = 'P0001'; end if;
  end if;
  if v_doc.to_bin_id is not null then
    select warehouse_id into v_bin_warehouse from public.inventory_bins where id = v_doc.to_bin_id and company_id = v_doc.company_id and is_active = true;
    if v_bin_warehouse is null or v_bin_warehouse <> v_doc.to_warehouse_id then raise exception 'BIN_WAREHOUSE_MISMATCH' using errcode = 'P0001'; end if;
  end if;
  select count(*) into v_line_count from public.inventory_transfer_lines where transfer_id = v_doc.id and company_id = v_doc.company_id;
  if v_line_count = 0 then raise exception 'TRANSFER_HAS_NO_LINES' using errcode = 'P0001'; end if;

  perform set_config('app.inventory_rpc', 'on', true);
  for v_line in select * from public.inventory_transfer_lines where transfer_id = v_doc.id and company_id = v_doc.company_id order by created_at, id for update loop
    if v_line.quantity <= 0 then raise exception 'INVALID_QUANTITY' using errcode = 'P0001'; end if;
    select * into v_item from public.inventory_items where id = v_line.item_id for update;
    if not found then raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001'; end if;
    if v_item.company_id <> v_doc.company_id then raise exception 'ITEM_COMPANY_MISMATCH' using errcode = 'P0001'; end if;
    v_unit_cost := v_item.average_cost;

    select * into v_from from public.inventory_stock_balances
    where company_id = v_doc.company_id and item_id = v_line.item_id and warehouse_id = v_doc.from_warehouse_id and bin_id is not distinct from v_doc.from_bin_id
    for update;
    if not found or v_from.quantity < v_line.quantity then raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001'; end if;

    insert into public.inventory_stock_balances (company_id, item_id, warehouse_id, bin_id, quantity)
    values (v_doc.company_id, v_line.item_id, v_doc.to_warehouse_id, v_doc.to_bin_id, 0)
    on conflict do nothing;
    select * into v_to from public.inventory_stock_balances
    where company_id = v_doc.company_id and item_id = v_line.item_id and warehouse_id = v_doc.to_warehouse_id and bin_id is not distinct from v_doc.to_bin_id
    for update;

    update public.inventory_stock_balances set quantity = v_from.quantity - v_line.quantity, updated_at = now() where id = v_from.id;
    update public.inventory_stock_balances set quantity = v_to.quantity + v_line.quantity, updated_at = now() where id = v_to.id;

    insert into public.inventory_movements (
      company_id, item_id, movement_type, quantity, unit_cost, from_warehouse_id, from_bin_id,
      reference_type, reference_id, reference_number, notes, transfer_id, transfer_line_id,
      balance_before, balance_after, average_cost_before, average_cost_after, created_by_user_id
    ) values (
      v_doc.company_id, v_line.item_id, 'transfer_out', v_line.quantity, v_unit_cost, v_doc.from_warehouse_id, v_doc.from_bin_id,
      'stock_transfer', v_doc.id, coalesce(nullif(v_doc.reference_number, ''), v_doc.id::text), v_doc.notes, v_doc.id, v_line.id,
      v_from.quantity, v_from.quantity - v_line.quantity, v_item.average_cost, v_item.average_cost, v_user_id
    ) returning id into v_out_id;

    insert into public.inventory_movements (
      company_id, item_id, movement_type, quantity, unit_cost, to_warehouse_id, to_bin_id,
      reference_type, reference_id, reference_number, notes, transfer_id, transfer_line_id,
      balance_before, balance_after, average_cost_before, average_cost_after, created_by_user_id
    ) values (
      v_doc.company_id, v_line.item_id, 'transfer_in', v_line.quantity, v_unit_cost, v_doc.to_warehouse_id, v_doc.to_bin_id,
      'stock_transfer', v_doc.id, coalesce(nullif(v_doc.reference_number, ''), v_doc.id::text), v_doc.notes, v_doc.id, v_line.id,
      v_to.quantity, v_to.quantity + v_line.quantity, v_item.average_cost, v_item.average_cost, v_user_id
    ) returning id into v_in_id;

    update public.inventory_transfer_lines set out_movement_id = v_out_id, in_movement_id = v_in_id where id = v_line.id;
    v_posted_lines := v_posted_lines + 1;
  end loop;
  update public.inventory_transfer_documents set status = 'posted', posted_at = now(), posted_by_user_id = v_user_id, updated_at = now() where id = v_doc.id;
  return jsonb_build_object('status', 'posted', 'transfer_id', v_doc.id, 'posted_lines', v_posted_lines);
exception when unique_violation then
  raise exception 'TRANSFER_ALREADY_POSTED' using errcode = 'P0001';
end;
$$;

create or replace function public.inventory_cancel_transfer(p_transfer_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user_id uuid := auth.uid();
  v_doc public.inventory_transfer_documents%rowtype;
  v_line public.inventory_transfer_lines%rowtype;
  v_item public.inventory_items%rowtype;
  v_from public.inventory_stock_balances%rowtype;
  v_to public.inventory_stock_balances%rowtype;
  v_later_count integer;
  v_canceled_lines integer := 0;
begin
  if v_user_id is null then raise exception 'ACCESS_DENIED' using errcode = 'P0001'; end if;
  select * into v_doc from public.inventory_transfer_documents where id = p_transfer_id for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode = 'P0001'; end if;
  if not public.can_manage_company(v_doc.company_id) then raise exception 'ACCESS_DENIED' using errcode = 'P0001'; end if;
  if v_doc.status <> 'posted' then raise exception 'TRANSFER_NOT_POSTED' using errcode = 'P0001'; end if;
  perform set_config('app.inventory_rpc', 'on', true);
  for v_line in select * from public.inventory_transfer_lines where transfer_id = v_doc.id and company_id = v_doc.company_id order by created_at desc, id desc for update loop
    select count(*) into v_later_count from public.inventory_movements
    where company_id = v_doc.company_id and item_id = v_line.item_id and transfer_line_id = v_line.id and movement_type in ('transfer_out', 'transfer_in');
    if v_later_count <> 2 then raise exception 'TRANSFER_MOVEMENTS_NOT_FOUND' using errcode = 'P0001'; end if;
    select count(*) into v_later_count from public.inventory_movements m
    where m.company_id = v_doc.company_id and m.item_id = v_line.item_id
      and m.created_at > (select max(created_at) from public.inventory_movements where transfer_line_id = v_line.id)
      and m.transfer_line_id is distinct from v_line.id;
    if v_later_count > 0 then raise exception 'TRANSFER_HAS_LATER_MOVEMENTS' using errcode = 'P0001'; end if;
    select * into v_item from public.inventory_items where id = v_line.item_id for update;
    select * into v_to from public.inventory_stock_balances where company_id = v_doc.company_id and item_id = v_line.item_id and warehouse_id = v_doc.to_warehouse_id and bin_id is not distinct from v_doc.to_bin_id for update;
    if not found or v_to.quantity < v_line.quantity then raise exception 'INSUFFICIENT_STOCK_TO_CANCEL' using errcode = 'P0001'; end if;
    select * into v_from from public.inventory_stock_balances where company_id = v_doc.company_id and item_id = v_line.item_id and warehouse_id = v_doc.from_warehouse_id and bin_id is not distinct from v_doc.from_bin_id for update;
    if not found then raise exception 'INSUFFICIENT_STOCK_TO_CANCEL' using errcode = 'P0001'; end if;
    update public.inventory_stock_balances set quantity = v_to.quantity - v_line.quantity, updated_at = now() where id = v_to.id;
    update public.inventory_stock_balances set quantity = v_from.quantity + v_line.quantity, updated_at = now() where id = v_from.id;
    insert into public.inventory_movements (company_id, item_id, movement_type, quantity, unit_cost, from_warehouse_id, from_bin_id, reference_type, reference_id, reference_number, notes, transfer_id, balance_before, balance_after, average_cost_before, average_cost_after, created_by_user_id)
    values (v_doc.company_id, v_line.item_id, 'transfer_out', v_line.quantity, v_item.average_cost, v_doc.to_warehouse_id, v_doc.to_bin_id, 'stock_transfer_cancel', v_doc.id, coalesce(nullif(v_doc.reference_number, ''), v_doc.id::text), coalesce(p_reason, ''), v_doc.id, v_to.quantity, v_to.quantity - v_line.quantity, v_item.average_cost, v_item.average_cost, v_user_id);
    insert into public.inventory_movements (company_id, item_id, movement_type, quantity, unit_cost, to_warehouse_id, to_bin_id, reference_type, reference_id, reference_number, notes, transfer_id, balance_before, balance_after, average_cost_before, average_cost_after, created_by_user_id)
    values (v_doc.company_id, v_line.item_id, 'transfer_in', v_line.quantity, v_item.average_cost, v_doc.from_warehouse_id, v_doc.from_bin_id, 'stock_transfer_cancel', v_doc.id, coalesce(nullif(v_doc.reference_number, ''), v_doc.id::text), coalesce(p_reason, ''), v_doc.id, v_from.quantity, v_from.quantity + v_line.quantity, v_item.average_cost, v_item.average_cost, v_user_id);
    v_canceled_lines := v_canceled_lines + 1;
  end loop;
  update public.inventory_transfer_documents set status = 'canceled', canceled_at = now(), canceled_by_user_id = v_user_id, cancel_reason = coalesce(p_reason, ''), updated_at = now() where id = v_doc.id;
  return jsonb_build_object('status', 'canceled', 'transfer_id', v_doc.id, 'canceled_lines', v_canceled_lines);
end;
$$;

create or replace function public.inventory_post_adjustment(p_adjustment_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user_id uuid := auth.uid();
  v_doc public.inventory_adjustment_documents%rowtype;
  v_line public.inventory_adjustment_lines%rowtype;
  v_item public.inventory_items%rowtype;
  v_balance public.inventory_stock_balances%rowtype;
  v_company uuid;
  v_bin_warehouse uuid;
  v_line_count integer;
  v_new_balance numeric(14,4);
  v_prior_total numeric(14,4);
  v_new_total numeric(14,4);
  v_new_average numeric(14,4);
  v_movement_id uuid;
  v_posted_lines integer := 0;
begin
  if v_user_id is null then raise exception 'ACCESS_DENIED' using errcode = 'P0001'; end if;
  select * into v_doc from public.inventory_adjustment_documents where id = p_adjustment_id for update;
  if not found then raise exception 'ADJUSTMENT_NOT_FOUND' using errcode = 'P0001'; end if;
  if not public.can_manage_company(v_doc.company_id) then raise exception 'ACCESS_DENIED' using errcode = 'P0001'; end if;
  if v_doc.status = 'posted' or v_doc.posted_at is not null then raise exception 'ADJUSTMENT_ALREADY_POSTED' using errcode = 'P0001'; end if;
  if v_doc.status <> 'draft' then raise exception 'ADJUSTMENT_NOT_DRAFT' using errcode = 'P0001'; end if;
  select company_id into v_company from public.inventory_warehouses where id = v_doc.warehouse_id and is_active = true;
  if v_company is null then raise exception 'WAREHOUSE_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_company <> v_doc.company_id then raise exception 'WAREHOUSE_COMPANY_MISMATCH' using errcode = 'P0001'; end if;
  if v_doc.bin_id is not null then
    select warehouse_id into v_bin_warehouse from public.inventory_bins where id = v_doc.bin_id and company_id = v_doc.company_id and is_active = true;
    if v_bin_warehouse is null or v_bin_warehouse <> v_doc.warehouse_id then raise exception 'BIN_WAREHOUSE_MISMATCH' using errcode = 'P0001'; end if;
  end if;
  select count(*) into v_line_count from public.inventory_adjustment_lines where adjustment_id = v_doc.id and company_id = v_doc.company_id;
  if v_line_count = 0 then raise exception 'ADJUSTMENT_HAS_NO_LINES' using errcode = 'P0001'; end if;
  perform set_config('app.inventory_rpc', 'on', true);
  for v_line in select * from public.inventory_adjustment_lines where adjustment_id = v_doc.id and company_id = v_doc.company_id order by created_at, id for update loop
    if v_line.quantity_delta = 0 then raise exception 'INVALID_QUANTITY' using errcode = 'P0001'; end if;
    if v_line.unit_cost < 0 then raise exception 'INVALID_UNIT_COST' using errcode = 'P0001'; end if;
    select * into v_item from public.inventory_items where id = v_line.item_id for update;
    if not found then raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001'; end if;
    if v_item.company_id <> v_doc.company_id then raise exception 'ITEM_COMPANY_MISMATCH' using errcode = 'P0001'; end if;
    insert into public.inventory_stock_balances (company_id, item_id, warehouse_id, bin_id, quantity)
    values (v_doc.company_id, v_line.item_id, v_doc.warehouse_id, v_doc.bin_id, 0)
    on conflict do nothing;
    select * into v_balance from public.inventory_stock_balances
    where company_id = v_doc.company_id and item_id = v_line.item_id and warehouse_id = v_doc.warehouse_id and bin_id is not distinct from v_doc.bin_id
    for update;
    v_new_balance := v_balance.quantity + v_line.quantity_delta;
    if v_new_balance < 0 then raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001'; end if;
    v_prior_total := v_item.total_quantity;
    v_new_total := v_item.total_quantity + v_line.quantity_delta;
    if v_new_total < 0 then raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001'; end if;
    if v_line.quantity_delta > 0 then
      v_new_average := case when v_prior_total = 0 then v_line.unit_cost else round(((v_prior_total * v_item.average_cost) + (v_line.quantity_delta * v_line.unit_cost)) / v_new_total, 4) end;
    else
      v_new_average := case when v_new_total = 0 then 0 else v_item.average_cost end;
    end if;
    update public.inventory_stock_balances set quantity = v_new_balance, updated_at = now() where id = v_balance.id;
    update public.inventory_items set total_quantity = v_new_total, average_cost = v_new_average, updated_at = now() where id = v_item.id;
    insert into public.inventory_movements (
      company_id, item_id, movement_type, quantity, unit_cost, to_warehouse_id, to_bin_id, from_warehouse_id, from_bin_id,
      reference_type, reference_id, reference_number, notes, adjustment_id, adjustment_line_id,
      balance_before, balance_after, average_cost_before, average_cost_after, created_by_user_id
    ) values (
      v_doc.company_id, v_line.item_id, 'adjustment', abs(v_line.quantity_delta), case when v_line.quantity_delta > 0 then v_line.unit_cost else v_item.average_cost end,
      case when v_line.quantity_delta > 0 then v_doc.warehouse_id else null end,
      case when v_line.quantity_delta > 0 then v_doc.bin_id else null end,
      case when v_line.quantity_delta < 0 then v_doc.warehouse_id else null end,
      case when v_line.quantity_delta < 0 then v_doc.bin_id else null end,
      'stock_adjustment', v_doc.id, coalesce(nullif(v_doc.reference_number, ''), v_doc.id::text), concat(v_doc.reason::text, ': ', v_doc.notes), v_doc.id, v_line.id,
      v_balance.quantity, v_new_balance, v_item.average_cost, v_new_average, v_user_id
    ) returning id into v_movement_id;
    update public.inventory_adjustment_lines set movement_id = v_movement_id where id = v_line.id;
    v_posted_lines := v_posted_lines + 1;
  end loop;
  update public.inventory_adjustment_documents set status = 'posted', posted_at = now(), posted_by_user_id = v_user_id, updated_at = now() where id = v_doc.id;
  return jsonb_build_object('status', 'posted', 'adjustment_id', v_doc.id, 'posted_lines', v_posted_lines);
exception when unique_violation then
  raise exception 'ADJUSTMENT_ALREADY_POSTED' using errcode = 'P0001';
end;
$$;

create or replace function public.inventory_cancel_adjustment(p_adjustment_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user_id uuid := auth.uid();
  v_doc public.inventory_adjustment_documents%rowtype;
  v_line public.inventory_adjustment_lines%rowtype;
  v_item public.inventory_items%rowtype;
  v_balance public.inventory_stock_balances%rowtype;
  v_movement public.inventory_movements%rowtype;
  v_later_count integer;
  v_new_balance numeric(14,4);
  v_prior_total numeric(14,4);
  v_prior_average numeric(14,4);
  v_canceled_lines integer := 0;
begin
  if v_user_id is null then raise exception 'ACCESS_DENIED' using errcode = 'P0001'; end if;
  select * into v_doc from public.inventory_adjustment_documents where id = p_adjustment_id for update;
  if not found then raise exception 'ADJUSTMENT_NOT_FOUND' using errcode = 'P0001'; end if;
  if not public.can_manage_company(v_doc.company_id) then raise exception 'ACCESS_DENIED' using errcode = 'P0001'; end if;
  if v_doc.status <> 'posted' then raise exception 'ADJUSTMENT_NOT_POSTED' using errcode = 'P0001'; end if;
  perform set_config('app.inventory_rpc', 'on', true);
  for v_line in select * from public.inventory_adjustment_lines where adjustment_id = v_doc.id and company_id = v_doc.company_id order by created_at desc, id desc for update loop
    select * into v_movement from public.inventory_movements
    where adjustment_line_id = v_line.id and reference_type = 'stock_adjustment'
    for update;
    if not found then raise exception 'ADJUSTMENT_MOVEMENT_NOT_FOUND' using errcode = 'P0001'; end if;
    select count(*) into v_later_count from public.inventory_movements m
    where m.company_id = v_doc.company_id and m.item_id = v_line.item_id
      and m.created_at > v_movement.created_at
      and m.adjustment_line_id is distinct from v_line.id;
    if v_later_count > 0 then raise exception 'ADJUSTMENT_HAS_LATER_MOVEMENTS' using errcode = 'P0001'; end if;
    select * into v_item from public.inventory_items where id = v_line.item_id for update;
    select * into v_balance from public.inventory_stock_balances
    where company_id = v_doc.company_id and item_id = v_line.item_id and warehouse_id = v_doc.warehouse_id and bin_id is not distinct from v_doc.bin_id
    for update;
    if not found then raise exception 'INSUFFICIENT_STOCK_TO_CANCEL' using errcode = 'P0001'; end if;

    v_new_balance := v_balance.quantity - v_line.quantity_delta;
    v_prior_total := v_item.total_quantity - v_line.quantity_delta;
    v_prior_average := coalesce(v_movement.average_cost_before, 0);
    if v_new_balance < 0 or v_prior_total < 0 then
      raise exception 'INSUFFICIENT_STOCK_TO_CANCEL' using errcode = 'P0001';
    end if;

    update public.inventory_stock_balances set quantity = v_new_balance, updated_at = now() where id = v_balance.id;
    update public.inventory_items set total_quantity = v_prior_total, average_cost = v_prior_average, updated_at = now() where id = v_item.id;

    insert into public.inventory_movements (
      company_id, item_id, movement_type, quantity, unit_cost, to_warehouse_id, to_bin_id, from_warehouse_id, from_bin_id,
      reference_type, reference_id, reference_number, notes, adjustment_id,
      balance_before, balance_after, average_cost_before, average_cost_after, created_by_user_id
    ) values (
      v_doc.company_id, v_line.item_id, 'adjustment', abs(v_line.quantity_delta), v_movement.unit_cost,
      case when v_line.quantity_delta < 0 then v_doc.warehouse_id else null end,
      case when v_line.quantity_delta < 0 then v_doc.bin_id else null end,
      case when v_line.quantity_delta > 0 then v_doc.warehouse_id else null end,
      case when v_line.quantity_delta > 0 then v_doc.bin_id else null end,
      'stock_adjustment_cancel', v_doc.id, coalesce(nullif(v_doc.reference_number, ''), v_doc.id::text), coalesce(p_reason, ''), v_doc.id,
      v_balance.quantity, v_new_balance, v_item.average_cost, v_prior_average, v_user_id
    );
    v_canceled_lines := v_canceled_lines + 1;
  end loop;
  update public.inventory_adjustment_documents set status = 'canceled', canceled_at = now(), canceled_by_user_id = v_user_id, cancel_reason = coalesce(p_reason, ''), updated_at = now() where id = v_doc.id;
  return jsonb_build_object('status', 'canceled', 'adjustment_id', v_doc.id, 'canceled_lines', v_canceled_lines);
end;
$$;

revoke all on function public.inventory_post_transfer(uuid) from public, anon, authenticated;
grant execute on function public.inventory_post_transfer(uuid) to authenticated;
revoke all on function public.inventory_cancel_transfer(uuid, text) from public, anon, authenticated;
grant execute on function public.inventory_cancel_transfer(uuid, text) to authenticated;
revoke all on function public.inventory_post_adjustment(uuid) from public, anon, authenticated;
grant execute on function public.inventory_post_adjustment(uuid) to authenticated;
revoke all on function public.inventory_cancel_adjustment(uuid, text) from public, anon, authenticated;
grant execute on function public.inventory_cancel_adjustment(uuid, text) to authenticated;
