-- Warehouse inventory stage 1: catalog, locations, balances, suppliers, and movement history.
-- Existing job_materials remain the source for manual Job material costs.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'inventory_warehouse_type') then
    create type public.inventory_warehouse_type as enum ('main', 'office', 'technician_vehicle', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'inventory_movement_type') then
    create type public.inventory_movement_type as enum ('receipt', 'transfer_out', 'transfer_in', 'job_issue', 'job_return', 'adjustment');
  end if;
  if not exists (select 1 from pg_type where typname = 'inventory_document_status') then
    create type public.inventory_document_status as enum ('draft', 'posted', 'canceled');
  end if;
  if not exists (select 1 from pg_type where typname = 'job_material_source_type') then
    create type public.job_material_source_type as enum ('manual', 'warehouse');
  end if;
end $$;

create table if not exists public.inventory_warehouses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  type public.inventory_warehouse_type not null default 'main',
  location text not null default '',
  technician_id uuid references public.company_technicians(id) on delete set null,
  is_active boolean not null default true,
  notes text not null default '',
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_warehouses_vehicle_has_tech check (type <> 'technician_vehicle' or technician_id is not null)
);

create table if not exists public.inventory_bins (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  warehouse_id uuid not null references public.inventory_warehouses(id) on delete cascade,
  code text not null,
  name text not null,
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (warehouse_id, code)
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  internal_name text not null,
  category text not null default '',
  manufacturer text not null default '',
  oem text not null default '',
  part_number text not null default '',
  alternate_part_number text not null default '',
  description text not null default '',
  unit text not null default 'pcs',
  photo_storage_bucket text,
  photo_storage_path text,
  minimum_quantity numeric(14,4) not null default 0,
  average_cost numeric(14,4) not null default 0,
  total_quantity numeric(14,4) not null default 0,
  is_active boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, internal_name, part_number)
);

create table if not exists public.inventory_suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  contact_name text not null default '',
  phone text not null default '',
  email text not null default '',
  website text not null default '',
  address text not null default '',
  notes text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists public.inventory_item_suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  supplier_id uuid not null references public.inventory_suppliers(id) on delete cascade,
  supplier_part_number text not null default '',
  supplier_description text not null default '',
  last_unit_cost numeric(14,4) not null default 0,
  currency text not null default 'USD',
  minimum_order_quantity numeric(14,4) not null default 0,
  product_url text not null default '',
  lead_time_days integer not null default 0,
  is_preferred boolean not null default false,
  last_price_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, supplier_id)
);

create table if not exists public.inventory_stock_balances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  warehouse_id uuid not null references public.inventory_warehouses(id) on delete cascade,
  bin_id uuid references public.inventory_bins(id) on delete set null,
  quantity numeric(14,4) not null default 0,
  updated_at timestamptz not null default now(),
  unique (company_id, item_id, warehouse_id, bin_id),
  constraint inventory_stock_balances_nonnegative check (quantity >= 0)
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  movement_type public.inventory_movement_type not null,
  quantity numeric(14,4) not null,
  unit_cost numeric(14,4) not null default 0,
  total_cost numeric(14,4) generated always as (quantity * unit_cost) stored,
  from_warehouse_id uuid references public.inventory_warehouses(id) on delete restrict,
  from_bin_id uuid references public.inventory_bins(id) on delete set null,
  to_warehouse_id uuid references public.inventory_warehouses(id) on delete restrict,
  to_bin_id uuid references public.inventory_bins(id) on delete set null,
  supplier_id uuid references public.inventory_suppliers(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  reference_type text not null default '',
  reference_id uuid,
  reference_number text not null default '',
  notes text not null default '',
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_movements_positive_quantity check (quantity > 0)
);

create table if not exists public.inventory_stock_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid references public.inventory_suppliers(id) on delete set null,
  warehouse_id uuid not null references public.inventory_warehouses(id) on delete restrict,
  bin_id uuid references public.inventory_bins(id) on delete set null,
  receipt_date date not null default current_date,
  po_number text not null default '',
  invoice_number text not null default '',
  status public.inventory_document_status not null default 'draft',
  notes text not null default '',
  posted_at timestamptz,
  posted_by_user_id uuid references auth.users(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_stock_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  receipt_id uuid not null references public.inventory_stock_receipts(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  quantity numeric(14,4) not null,
  unit_cost numeric(14,4) not null default 0,
  extra_cost numeric(14,4) not null default 0,
  movement_id uuid references public.inventory_movements(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_stock_receipt_lines_positive_quantity check (quantity > 0)
);

alter table public.job_materials
  add column if not exists source_type public.job_material_source_type not null default 'manual',
  add column if not exists inventory_movement_id uuid references public.inventory_movements(id) on delete set null;

create index if not exists idx_inventory_warehouses_company on public.inventory_warehouses(company_id, is_active, type);
create index if not exists idx_inventory_bins_company_warehouse on public.inventory_bins(company_id, warehouse_id, is_active);
create index if not exists idx_inventory_items_company_search on public.inventory_items(company_id, is_active, internal_name, part_number);
create index if not exists idx_inventory_suppliers_company on public.inventory_suppliers(company_id, is_active, name);
create index if not exists idx_inventory_item_suppliers_item on public.inventory_item_suppliers(company_id, item_id);
create index if not exists idx_inventory_stock_balances_company_item on public.inventory_stock_balances(company_id, item_id);
create index if not exists idx_inventory_stock_balances_company_warehouse on public.inventory_stock_balances(company_id, warehouse_id);
create unique index if not exists idx_inventory_stock_balances_unique_position
  on public.inventory_stock_balances(company_id, item_id, warehouse_id, bin_id) nulls not distinct;
create index if not exists idx_inventory_movements_company_item on public.inventory_movements(company_id, item_id, created_at desc);
create index if not exists idx_inventory_movements_company_job on public.inventory_movements(company_id, job_id) where job_id is not null;
create index if not exists idx_inventory_receipts_company_status on public.inventory_stock_receipts(company_id, status, receipt_date desc);
create index if not exists idx_job_materials_inventory_movement on public.job_materials(company_id, inventory_movement_id) where inventory_movement_id is not null;

drop trigger if exists set_inventory_warehouses_updated_at on public.inventory_warehouses;
create trigger set_inventory_warehouses_updated_at before update on public.inventory_warehouses for each row execute function public.set_updated_at();
drop trigger if exists set_inventory_bins_updated_at on public.inventory_bins;
create trigger set_inventory_bins_updated_at before update on public.inventory_bins for each row execute function public.set_updated_at();
drop trigger if exists set_inventory_items_updated_at on public.inventory_items;
create trigger set_inventory_items_updated_at before update on public.inventory_items for each row execute function public.set_updated_at();
drop trigger if exists set_inventory_suppliers_updated_at on public.inventory_suppliers;
create trigger set_inventory_suppliers_updated_at before update on public.inventory_suppliers for each row execute function public.set_updated_at();
drop trigger if exists set_inventory_item_suppliers_updated_at on public.inventory_item_suppliers;
create trigger set_inventory_item_suppliers_updated_at before update on public.inventory_item_suppliers for each row execute function public.set_updated_at();
drop trigger if exists set_inventory_stock_receipts_updated_at on public.inventory_stock_receipts;
create trigger set_inventory_stock_receipts_updated_at before update on public.inventory_stock_receipts for each row execute function public.set_updated_at();

alter table public.inventory_warehouses enable row level security;
alter table public.inventory_bins enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_suppliers enable row level security;
alter table public.inventory_item_suppliers enable row level security;
alter table public.inventory_stock_balances enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_stock_receipts enable row level security;
alter table public.inventory_stock_receipt_lines enable row level security;

drop policy if exists "inventory warehouses readable by company or platform" on public.inventory_warehouses;
create policy "inventory warehouses readable by company or platform" on public.inventory_warehouses
  for select using (public.can_access_company(company_id));
drop policy if exists "inventory warehouses manageable by company managers or platform" on public.inventory_warehouses;
create policy "inventory warehouses manageable by company managers or platform" on public.inventory_warehouses
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

drop policy if exists "inventory bins readable by company or platform" on public.inventory_bins;
create policy "inventory bins readable by company or platform" on public.inventory_bins
  for select using (public.can_access_company(company_id));
drop policy if exists "inventory bins manageable by company managers or platform" on public.inventory_bins;
create policy "inventory bins manageable by company managers or platform" on public.inventory_bins
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

drop policy if exists "inventory items readable by company or platform" on public.inventory_items;
create policy "inventory items readable by company or platform" on public.inventory_items
  for select using (public.can_access_company(company_id));
drop policy if exists "inventory items manageable by company managers or platform" on public.inventory_items;
create policy "inventory items manageable by company managers or platform" on public.inventory_items
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

drop policy if exists "inventory suppliers readable by company or platform" on public.inventory_suppliers;
create policy "inventory suppliers readable by company or platform" on public.inventory_suppliers
  for select using (public.can_access_company(company_id));
drop policy if exists "inventory suppliers manageable by company managers or platform" on public.inventory_suppliers;
create policy "inventory suppliers manageable by company managers or platform" on public.inventory_suppliers
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

drop policy if exists "inventory item suppliers readable by company or platform" on public.inventory_item_suppliers;
create policy "inventory item suppliers readable by company or platform" on public.inventory_item_suppliers
  for select using (public.can_access_company(company_id));
drop policy if exists "inventory item suppliers manageable by company managers or platform" on public.inventory_item_suppliers;
create policy "inventory item suppliers manageable by company managers or platform" on public.inventory_item_suppliers
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

drop policy if exists "inventory stock balances readable by company or platform" on public.inventory_stock_balances;
create policy "inventory stock balances readable by company or platform" on public.inventory_stock_balances
  for select using (public.can_access_company(company_id));
drop policy if exists "inventory stock balances manageable by company managers or platform" on public.inventory_stock_balances;
create policy "inventory stock balances manageable by company managers or platform" on public.inventory_stock_balances
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

drop policy if exists "inventory movements readable by company or platform" on public.inventory_movements;
create policy "inventory movements readable by company or platform" on public.inventory_movements
  for select using (public.can_access_company(company_id));
drop policy if exists "inventory movements insertable by company managers or platform" on public.inventory_movements;
create policy "inventory movements insertable by company managers or platform" on public.inventory_movements
  for insert with check (public.can_manage_company(company_id));

drop policy if exists "inventory receipts readable by company or platform" on public.inventory_stock_receipts;
create policy "inventory receipts readable by company or platform" on public.inventory_stock_receipts
  for select using (public.can_access_company(company_id));
drop policy if exists "inventory receipts manageable by company managers or platform" on public.inventory_stock_receipts;
create policy "inventory receipts manageable by company managers or platform" on public.inventory_stock_receipts
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

drop policy if exists "inventory receipt lines readable by company or platform" on public.inventory_stock_receipt_lines;
create policy "inventory receipt lines readable by company or platform" on public.inventory_stock_receipt_lines
  for select using (public.can_access_company(company_id));
drop policy if exists "inventory receipt lines manageable by company managers or platform" on public.inventory_stock_receipt_lines;
create policy "inventory receipt lines manageable by company managers or platform" on public.inventory_stock_receipt_lines
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));
