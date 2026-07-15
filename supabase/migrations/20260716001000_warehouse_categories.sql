create table if not exists public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  parent_id uuid null references public.inventory_categories(id) on delete restrict,
  icon text null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null references auth.users(id)
);

alter table public.inventory_categories
  add constraint inventory_categories_name_not_blank check (btrim(name) <> ''),
  add constraint inventory_categories_sort_order_nonnegative check (sort_order >= 0),
  add constraint inventory_categories_not_self_parent check (parent_id is null or parent_id <> id);

create unique index if not exists idx_inventory_categories_root_name_unique
  on public.inventory_categories(company_id, lower(btrim(name)))
  where parent_id is null;

create unique index if not exists idx_inventory_categories_child_name_unique
  on public.inventory_categories(company_id, parent_id, lower(btrim(name)))
  where parent_id is not null;

create index if not exists idx_inventory_categories_company_parent_order
  on public.inventory_categories(company_id, parent_id, sort_order, name);

drop trigger if exists set_inventory_categories_updated_at on public.inventory_categories;
create trigger set_inventory_categories_updated_at
before update on public.inventory_categories
for each row execute function public.set_updated_at();

create or replace function public.inventory_validate_category()
returns trigger
language plpgsql
as $$
declare
  parent_row public.inventory_categories%rowtype;
begin
  new.name := btrim(new.name);
  new.icon := nullif(btrim(coalesce(new.icon, '')), '');

  if new.name = '' then
    raise exception 'CATEGORY_NAME_REQUIRED' using errcode = 'P0001';
  end if;
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'CATEGORY_PARENT_SELF' using errcode = 'P0001';
    end if;

    select * into parent_row
    from public.inventory_categories
    where id = new.parent_id
    for update;

    if not found then
      raise exception 'CATEGORY_PARENT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if parent_row.company_id <> new.company_id then
      raise exception 'CATEGORY_COMPANY_MISMATCH' using errcode = 'P0001';
    end if;
    if parent_row.parent_id is not null then
      raise exception 'CATEGORY_DEPTH_LIMIT' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_validate_category on public.inventory_categories;
create trigger inventory_validate_category
before insert or update on public.inventory_categories
for each row execute function public.inventory_validate_category();

alter table public.inventory_items
  add column if not exists category_id uuid null references public.inventory_categories(id) on delete set null;

create index if not exists idx_inventory_items_category_id
  on public.inventory_items(company_id, category_id);

create or replace function public.inventory_validate_item_category()
returns trigger
language plpgsql
as $$
declare
  category_company uuid;
begin
  if new.category_id is null then
    return new;
  end if;

  select company_id into category_company
  from public.inventory_categories
  where id = new.category_id;

  if category_company is null then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if category_company <> new.company_id then
    raise exception 'CATEGORY_COMPANY_MISMATCH' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists inventory_validate_item_category on public.inventory_items;
create trigger inventory_validate_item_category
before insert or update of company_id, category_id on public.inventory_items
for each row execute function public.inventory_validate_item_category();

alter table public.inventory_categories enable row level security;

drop policy if exists "inventory categories readable by company" on public.inventory_categories;
create policy "inventory categories readable by company" on public.inventory_categories
  for select using (public.can_access_company(company_id));

drop policy if exists "inventory categories manageable by company managers" on public.inventory_categories;
create policy "inventory categories manageable by company managers" on public.inventory_categories
  for all using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

insert into public.inventory_categories (company_id, name, sort_order)
select i.company_id, btrim(i.category), row_number() over (partition by i.company_id order by lower(btrim(i.category))) - 1
from public.inventory_items i
where btrim(coalesce(i.category, '')) <> ''
group by i.company_id, lower(btrim(i.category)), btrim(i.category)
on conflict do nothing;

update public.inventory_items i
set category_id = c.id
from public.inventory_categories c
where i.category_id is null
  and c.company_id = i.company_id
  and c.parent_id is null
  and lower(btrim(c.name)) = lower(btrim(i.category))
  and btrim(coalesce(i.category, '')) <> '';

create or replace function public.inventory_create_category(
  p_company_id uuid,
  p_name text,
  p_parent_id uuid default null,
  p_icon text default null
)
returns public.inventory_categories
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_category public.inventory_categories%rowtype;
  v_sort integer;
begin
  if auth.uid() is null or not public.can_manage_company(p_company_id) then
    raise exception 'ACCESS_DENIED' using errcode = 'P0001';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_sort
  from public.inventory_categories
  where company_id = p_company_id
    and parent_id is not distinct from p_parent_id;

  insert into public.inventory_categories (company_id, name, parent_id, icon, sort_order, created_by)
  values (p_company_id, p_name, p_parent_id, p_icon, v_sort, auth.uid())
  returning * into v_category;

  return v_category;
exception
  when unique_violation then
    raise exception 'CATEGORY_DUPLICATE_NAME' using errcode = 'P0001';
end;
$$;

create or replace function public.inventory_update_category(
  p_category_id uuid,
  p_name text,
  p_icon text default null,
  p_is_active boolean default true
)
returns public.inventory_categories
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_category public.inventory_categories%rowtype;
begin
  select * into v_category
  from public.inventory_categories
  where id = p_category_id
  for update;

  if not found then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if auth.uid() is null or not public.can_manage_company(v_category.company_id) then
    raise exception 'ACCESS_DENIED' using errcode = 'P0001';
  end if;

  update public.inventory_categories
    set name = p_name,
        icon = p_icon,
        is_active = coalesce(p_is_active, true)
  where id = p_category_id
  returning * into v_category;

  return v_category;
exception
  when unique_violation then
    raise exception 'CATEGORY_DUPLICATE_NAME' using errcode = 'P0001';
end;
$$;

create or replace function public.inventory_reorder_categories(
  p_company_id uuid,
  p_parent_id uuid,
  p_category_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_index integer := 0;
begin
  if auth.uid() is null or not public.can_manage_company(p_company_id) then
    raise exception 'ACCESS_DENIED' using errcode = 'P0001';
  end if;

  foreach v_id in array p_category_ids loop
    update public.inventory_categories
      set sort_order = v_index
    where id = v_id
      and company_id = p_company_id
      and parent_id is not distinct from p_parent_id;

    if not found then
      raise exception 'CATEGORY_REORDER_SCOPE_MISMATCH' using errcode = 'P0001';
    end if;
    v_index := v_index + 1;
  end loop;

  return jsonb_build_object('status', 'reordered', 'count', v_index);
end;
$$;

create or replace function public.inventory_delete_category(p_category_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_category public.inventory_categories%rowtype;
begin
  select * into v_category
  from public.inventory_categories
  where id = p_category_id
  for update;

  if not found then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
  end if;
  if auth.uid() is null or not public.can_manage_company(v_category.company_id) then
    raise exception 'ACCESS_DENIED' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.inventory_items where company_id = v_category.company_id and category_id = p_category_id limit 1) then
    raise exception 'CATEGORY_USED_BY_ITEMS' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.inventory_categories where company_id = v_category.company_id and parent_id = p_category_id and is_active = true limit 1) then
    raise exception 'CATEGORY_HAS_CHILDREN' using errcode = 'P0001';
  end if;

  delete from public.inventory_categories where id = p_category_id;
  return jsonb_build_object('status', 'deleted', 'category_id', p_category_id);
end;
$$;

create or replace function public.inventory_set_item_category(
  p_item_id uuid,
  p_category_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.inventory_items%rowtype;
begin
  select * into v_item
  from public.inventory_items
  where id = p_item_id
  for update;

  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if auth.uid() is null or not public.can_manage_company(v_item.company_id) then
    raise exception 'ACCESS_DENIED' using errcode = 'P0001';
  end if;

  update public.inventory_items
    set category_id = p_category_id,
        category = coalesce((select name from public.inventory_categories where id = p_category_id), category)
  where id = p_item_id;

  return jsonb_build_object('status', 'updated', 'item_id', p_item_id, 'category_id', p_category_id);
end;
$$;

revoke all on function public.inventory_create_category(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.inventory_create_category(uuid, text, uuid, text) to authenticated;
revoke all on function public.inventory_update_category(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.inventory_update_category(uuid, text, text, boolean) to authenticated;
revoke all on function public.inventory_reorder_categories(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.inventory_reorder_categories(uuid, uuid, uuid[]) to authenticated;
revoke all on function public.inventory_delete_category(uuid) from public, anon, authenticated;
grant execute on function public.inventory_delete_category(uuid) to authenticated;
revoke all on function public.inventory_set_item_category(uuid, uuid) from public, anon, authenticated;
grant execute on function public.inventory_set_item_category(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
