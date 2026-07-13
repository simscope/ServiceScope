-- Compatibility bridge for the imported technician mobile app.
-- The app came from simscope/hvac-app and still calls several legacy table
-- names/columns. Keep the canonical ServiceScope schema intact and expose a
-- narrow compatibility layer for the mobile client.

create or replace function public.current_company_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select company_id
  from public.company_users
  where auth_user_id = auth.uid()
    and status = 'active'
  order by created_at
  limit 1;
$$;

alter table public.jobs
  alter column company_id set default public.current_company_id();

alter table public.jobs
  alter column job_number set default ('JOB-' || upper(substr(gen_random_uuid()::text, 1, 8)));

alter table public.jobs add column if not exists client_id uuid references public.customers(id) on delete set null;
alter table public.jobs add column if not exists system_type text;
alter table public.jobs add column if not exists scf numeric(10,2);
alter table public.jobs add column if not exists labor_price numeric(10,2);
alter table public.jobs add column if not exists appointment_time timestamptz;
alter table public.jobs add column if not exists appointment_duration_min integer not null default 60;
alter table public.jobs add column if not exists scf_payment_method text;
alter table public.jobs add column if not exists labor_payment_method text;
alter table public.jobs add column if not exists tech_comment text;
alter table public.jobs add column if not exists archived_reason text;
alter table public.jobs add column if not exists status_canon text;
alter table public.jobs add column if not exists client_name text;
alter table public.jobs add column if not exists client_phone text;
alter table public.jobs add column if not exists client_email text;
alter table public.jobs add column if not exists client_address text;

create or replace function public.sync_technician_mobile_job_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.company_id := coalesce(new.company_id, public.current_company_id());

  if new.job_number is null or btrim(new.job_number) = '' then
    new.job_number := 'JOB-' || upper(substr(gen_random_uuid()::text, 1, 8));
  end if;

  if new.client_id is not null then
    new.customer_id := new.client_id;
  elsif new.customer_id is not null then
    new.client_id := new.customer_id;
  end if;

  if new.system_type is not null then
    new.system := coalesce(new.system_type, '');
  elsif nullif(new.system, '') is not null then
    new.system_type := new.system;
  end if;

  if new.scf is not null then
    new.service_call_fee_cents := round(new.scf * 100)::integer;
  else
    new.scf := round(coalesce(new.service_call_fee_cents, 0)::numeric / 100, 2);
  end if;

  if new.labor_price is not null then
    new.labor_cents := round(new.labor_price * 100)::integer;
  else
    new.labor_price := round(coalesce(new.labor_cents, 0)::numeric / 100, 2);
  end if;

  new.status_canon := coalesce(new.status_canon, new.status::text);

  return new;
end;
$$;

drop trigger if exists sync_technician_mobile_job_columns on public.jobs;
create trigger sync_technician_mobile_job_columns
before insert or update on public.jobs
for each row execute function public.sync_technician_mobile_job_columns();

-- Compatibility views may exist with an older column layout. PostgreSQL cannot
-- remove view columns through CREATE OR REPLACE, so recreate them explicitly.
drop view if exists public.profiles;
create view public.profiles
with (security_invoker = true)
as
select
  company_users.auth_user_id as id,
  company_users.name as full_name,
  case
    when company_users.role = 'technician' then 'technician'
    else company_users.role::text
  end as role,
  company_technicians.id as technician_id,
  company_users.company_id,
  company_users.email,
  company_users.status,
  company_users.created_at,
  company_users.updated_at
from public.company_users
left join public.company_technicians
  on company_technicians.company_user_id = company_users.id;

drop view if exists public.technicians;
create view public.technicians
with (security_invoker = true)
as
select
  company_technicians.id,
  company_technicians.company_id,
  company_technicians.company_id as org_id,
  company_users.auth_user_id,
  company_technicians.name,
  company_technicians.name as full_name,
  company_technicians.email,
  company_technicians.phone,
  company_technicians.role::text as role,
  company_technicians.status = 'active' as is_active,
  company_technicians.role in ('manager', 'dispatcher') as is_admin,
  null::timestamptz as terminated_at,
  null::text as termination_reason,
  company_technicians.gps_enabled,
  company_technicians.created_at,
  company_technicians.updated_at
from public.company_technicians
left join public.company_users
  on company_users.id = company_technicians.company_user_id;

drop view if exists public.clients;
create view public.clients
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
  null::text as blacklist,
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
  insert into public.customers (company_id, organization, primary_name, primary_phone, primary_email, notes)
  values (target_company_id, coalesce(new.company, ''), coalesce(new.full_name, ''), new.phone, new.email, coalesce(new.notes, ''))
  returning id, company_id, organization, primary_name, primary_phone, primary_email, notes, created_at, updated_at
  into new.id, new.company_id, new.company, new.full_name, new.phone, new.email, new.notes, new.created_at, new.updated_at;

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

drop trigger if exists clients_compat_insert on public.clients;
create trigger clients_compat_insert
instead of insert on public.clients
for each row execute function public.clients_compat_insert();

drop trigger if exists clients_compat_update on public.clients;
create trigger clients_compat_update
instead of update on public.clients
for each row execute function public.clients_compat_update();

drop view if exists public.materials;
create view public.materials
with (security_invoker = true)
as
select
  id,
  company_id,
  job_id,
  name,
  round(unit_price_cents::numeric / 100, 2) as price,
  quantity,
  supplier,
  status,
  created_at,
  updated_at
from public.job_materials;

create or replace function public.materials_compat_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.job_materials (company_id, job_id, name, quantity, unit_price_cents, supplier, status)
  select jobs.company_id, new.job_id, coalesce(new.name, ''), coalesce(new.quantity, 1), round(coalesce(new.price, 0) * 100)::integer, coalesce(new.supplier, ''), coalesce(new.status, 'Needed')::public.material_status
  from public.jobs
  where jobs.id = new.job_id
  returning id, company_id, job_id, name, round(unit_price_cents::numeric / 100, 2), quantity, supplier, status, created_at, updated_at
  into new.id, new.company_id, new.job_id, new.name, new.price, new.quantity, new.supplier, new.status, new.created_at, new.updated_at;

  return new;
end;
$$;

create or replace function public.materials_compat_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.job_materials
  set
    name = coalesce(new.name, ''),
    quantity = coalesce(new.quantity, 1),
    unit_price_cents = round(coalesce(new.price, 0) * 100)::integer,
    supplier = coalesce(new.supplier, ''),
    status = coalesce(new.status, old.status)::public.material_status,
    updated_at = now()
  where id = old.id;
  return new;
end;
$$;

create or replace function public.materials_compat_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.job_materials where id = old.id;
  return old;
end;
$$;

drop trigger if exists materials_compat_insert on public.materials;
create trigger materials_compat_insert
instead of insert on public.materials
for each row execute function public.materials_compat_insert();

drop trigger if exists materials_compat_update on public.materials;
create trigger materials_compat_update
instead of update on public.materials
for each row execute function public.materials_compat_update();

drop trigger if exists materials_compat_delete on public.materials;
create trigger materials_compat_delete
instead of delete on public.materials
for each row execute function public.materials_compat_delete();

drop view if exists public.comments;
create view public.comments
with (security_invoker = true)
as
select
  id,
  company_id,
  job_id,
  message as text,
  null::text as image_url,
  author_user_id,
  created_at
from public.job_comments;

create or replace function public.comments_compat_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author_label text := coalesce(auth.email(), 'Technician');
begin
  insert into public.job_comments (company_id, job_id, author_user_id, author_name, author_role, message)
  select jobs.company_id, new.job_id, new.author_user_id, author_label, 'technician', coalesce(new.text, '')
  from public.jobs
  where jobs.id = new.job_id
  returning id, company_id, job_id, message, author_user_id, created_at
  into new.id, new.company_id, new.job_id, new.text, new.author_user_id, new.created_at;

  return new;
end;
$$;

drop trigger if exists comments_compat_insert on public.comments;
create trigger comments_compat_insert
instead of insert on public.comments
for each row execute function public.comments_compat_insert();

drop view if exists public.invoices;
create view public.invoices
with (security_invoker = true)
as
select
  id,
  company_id,
  job_id,
  invoice_number as invoice_no,
  pdf_storage_path as file_key,
  created_at,
  updated_at
from public.job_invoices;

create or replace function public.invoices_compat_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.job_invoices where id = old.id;
  return old;
end;
$$;

drop trigger if exists invoices_compat_delete on public.invoices;
create trigger invoices_compat_delete
instead of delete on public.invoices
for each row execute function public.invoices_compat_delete();

drop view if exists public.tech_locations_latest;
create view public.tech_locations_latest
with (security_invoker = true)
as
select distinct on (technician_id)
  technician_id,
  company_id,
  latitude,
  longitude,
  accuracy_meters,
  recorded_at
from public.technician_locations
order by technician_id, recorded_at desc;
