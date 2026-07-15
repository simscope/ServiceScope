-- Warehouse product URL import metadata.
-- Stock quantities still change only through the existing receipt posting RPC.

alter table public.inventory_items
  add column if not exists source_image_url text not null default '';

create table if not exists public.inventory_supplier_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  supplier_id uuid references public.inventory_suppliers(id) on delete set null,
  source_type text not null default 'generic',
  source_domain text not null default '',
  source_url text not null default '',
  source_url_normalized text not null default '',
  canonical_url text not null default '',
  canonical_url_normalized text not null default '',
  external_product_id text not null default '',
  asin text not null default '',
  ebay_item_id text not null default '',
  supplier_part_number text not null default '',
  last_title text not null default '',
  last_image_url text not null default '',
  last_vendor_price numeric(14,4) not null default 0,
  currency text not null default 'USD',
  pack_quantity numeric(14,4) not null default 1,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_inventory_supplier_links_company_item
  on public.inventory_supplier_links(company_id, item_id);

create unique index if not exists idx_inventory_supplier_links_external_product
  on public.inventory_supplier_links(company_id, source_type, external_product_id)
  where external_product_id <> '';

create unique index if not exists idx_inventory_supplier_links_canonical_url
  on public.inventory_supplier_links(company_id, canonical_url_normalized);

create unique index if not exists idx_inventory_supplier_links_source_url
  on public.inventory_supplier_links(company_id, source_url_normalized)
  where source_url_normalized <> '';

alter table public.inventory_supplier_links enable row level security;

drop policy if exists "inventory supplier links readable by company or platform" on public.inventory_supplier_links;
create policy "inventory supplier links readable by company or platform" on public.inventory_supplier_links
  for select using (public.can_access_company(company_id));

drop policy if exists "inventory supplier links manageable by company managers or platform" on public.inventory_supplier_links;
create policy "inventory supplier links manageable by company managers or platform" on public.inventory_supplier_links
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

notify pgrst, 'reload schema';
