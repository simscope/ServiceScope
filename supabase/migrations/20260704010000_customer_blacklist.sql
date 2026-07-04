alter table public.customers
  add column if not exists blacklist text;

create or replace view public.clients
with (security_invoker = true)
as
select
  customers.id,
  customers.company_id,
  customers.organization as company,
  customers.primary_name as full_name,
  customers.primary_phone as phone,
  customers.primary_email as email,
  coalesce(customer_locations.address, '') as address,
  customers.notes,
  customers.blacklist,
  customers.created_at,
  customers.updated_at
from public.customers
left join lateral (
  select address
  from public.customer_locations
  where customer_locations.customer_id = customers.id
  order by created_at
  limit 1
) customer_locations on true;

create or replace function public.clients_compat_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company_id uuid := coalesce(new.company_id, public.current_company_id());
begin
  insert into public.customers (company_id, organization, primary_name, primary_phone, primary_email, notes, blacklist)
  values (target_company_id, coalesce(new.company, ''), coalesce(new.full_name, ''), new.phone, new.email, coalesce(new.notes, ''), nullif(new.blacklist, ''))
  returning id, company_id, organization, primary_name, primary_phone, primary_email, notes, blacklist, created_at, updated_at
  into new.id, new.company_id, new.company, new.full_name, new.phone, new.email, new.notes, new.blacklist, new.created_at, new.updated_at;

  if nullif(new.address, '') is not null then
    insert into public.customer_locations (company_id, customer_id, address)
    values (target_company_id, new.id, new.address);
  end if;

  return new;
end;
$$;

create or replace function public.clients_compat_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company_id uuid;
  location_id uuid;
begin
  update public.customers
  set
    organization = coalesce(new.company, ''),
    primary_name = coalesce(new.full_name, ''),
    primary_phone = new.phone,
    primary_email = new.email,
    notes = coalesce(new.notes, ''),
    blacklist = nullif(new.blacklist, ''),
    updated_at = now()
  where id = old.id
  returning company_id into target_company_id;

  if nullif(new.address, '') is not null then
    select id into location_id
    from public.customer_locations
    where customer_id = old.id
    order by created_at
    limit 1;

    if location_id is null then
      insert into public.customer_locations (company_id, customer_id, address)
      values (target_company_id, old.id, new.address);
    else
      update public.customer_locations
      set address = new.address, updated_at = now()
      where id = location_id;
    end if;
  end if;

  return new;
end;
$$;
