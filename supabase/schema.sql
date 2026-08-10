-- ServiceScope initial Supabase schema
-- Run once in Supabase SQL Editor for a new project.
-- Project: https://supabase.com/dashboard/project/sizdqtgejoikjlgukbqh

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- =========================================================
-- Enums
-- =========================================================

create type company_status as enum ('setup', 'trial', 'active', 'paused', 'cancelled');
create type billing_status as enum ('not_started', 'trialing', 'paid', 'overdue', 'cancelled');
create type onboarding_status as enum ('todo', 'current', 'blocked', 'done');

create type platform_role as enum ('owner', 'admin', 'support', 'viewer');
create type user_status as enum ('active', 'invited', 'disabled');
create type company_role as enum ('admin', 'manager', 'dispatcher', 'technician');
create type technician_role as enum ('technician', 'dispatcher', 'manager');

create type support_status as enum ('new', 'reviewing', 'planned', 'resolved');
create type support_kind as enum ('bug', 'change', 'question');
create type priority_level as enum ('low', 'normal', 'urgent');
create type support_message_author as enum ('company', 'owner');

create type audit_category as enum ('tenant', 'billing', 'access', 'support', 'job', 'email', 'file', 'payroll');
create type job_status as enum ('New', 'ReCall', 'Diagnosis', 'In progress', 'Parts ordered', 'Waiting for parts', 'To finish', 'Completed', 'Warranty', 'Cancelled', 'Archived');
create type material_status as enum ('Needed', 'Ordered', 'Received', 'Installed', 'Returned');
create type attachment_kind as enum ('photo', 'file');
create type payment_method as enum (
  'ach',
  'zelle',
  'venmo',
  'cash_app',
  'paypal',
  'credit_card',
  'debit_card',
  'check',
  'cash',
  'wire_transfer',
  'apple_pay',
  'google_pay',
  'stripe',
  'square',
  'financing'
);
create type payment_scope as enum ('scf', 'labor', 'invoice', 'subscription');

create type email_provider as enum ('google', 'microsoft', 'smtp');
create type email_connection_status as enum ('backend_required', 'connected', 'failed');
create type email_folder as enum ('inbox', 'sent');

create type task_status as enum ('To do', 'In progress', 'Done');
create type task_source as enum ('Manual', 'Auto');

create type subscription_status as enum ('not_connected', 'trialing', 'active', 'past_due', 'cancelled', 'failed');
create type subscription_payment_status as enum ('not_connected', 'pending', 'active', 'failed');
create type invoice_status as enum ('draft', 'open', 'paid', 'void', 'uncollectible');

create type library_category as enum ('Manual', 'Wiring diagram', 'Service bulletin', 'Install guide', 'Parts list', 'Warranty', 'Training');
create type library_format as enum ('PDF', 'Image', 'Video', 'Link');

-- =========================================================
-- Helpers
-- =========================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================
-- Platform / Owner console
-- =========================================================

create table platform_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  email citext not null unique,
  role platform_role not null default 'support',
  status user_status not null default 'invited',
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  category audit_category not null,
  action text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text not null,
  actor_role text,
  resource_type text,
  resource_id text,
  resource text not null default 'Unknown resource',
  resource_label text not null,
  details text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  user_agent text,
  created_at timestamptz not null default now()
);

-- =========================================================
-- Tenant / company core
-- =========================================================

create table plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  monthly_price_cents integer not null check (monthly_price_cents >= 0),
  seats_limit integer not null,
  technicians_limit integer not null,
  storage_gb_limit numeric(10,2) not null,
  support_level text not null,
  entitlements text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into plans (name, monthly_price_cents, seats_limit, technicians_limit, storage_gb_limit, support_level, entitlements)
values
  ('Launch', 14900, 5, 8, 10, 'Email', array['Jobs', 'Invoices', 'Customer records', 'Basic support']),
  ('Growth', 29900, 15, 25, 50, 'Priority', array['Everything in Launch', 'Technician map', 'Finance view', 'Priority support']),
  ('Scale', 54900, 20, 30, 100, 'Dedicated', array['Everything in Growth', 'Advanced monitoring', 'Custom onboarding', 'Dedicated support']);

create table companies (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references plans(id) on delete set null,
  name text not null,
  owner_name text not null default '',
  owner_email citext not null,
  domain citext unique,
  market text not null default '',
  status company_status not null default 'setup',
  billing_status billing_status not null default 'not_started',
  seats_count integer not null default 0,
  technicians_count integer not null default 0,
  open_jobs_count integer not null default 0,
  revenue_cents bigint not null default 0,
  health_score integer not null default 80 check (health_score between 0 and 100),
  last_sync_label text not null default 'Needs setup',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table audit_events
  add constraint audit_events_company_id_fkey
  foreign key (company_id) references companies(id) on delete set null;

create or replace function company_ai_voice_text_valid(
  value text,
  max_length integer,
  contact_free boolean
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    char_length(value) <= max_length
    and value !~ '[<>]'
    and value !~* '(api[_ -]?key|authorization|bearer|oauth|password|refresh[_ -]?token|secret|session[_ -]?token)'
    and value !~* '(provider|model|temperature|top[_ -]?p|max[_ -]?tokens?|response[_ -]?format|tool[_ -]?choice)[[:space:]]*[:=]'
    and value !~* '(https?://|www\.)'
    and (
      not contact_free
      or (
        value !~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'
        and value !~ '(\+?[0-9][0-9 .()\-]{7,}[0-9])'
        and value !~* '[0-9]{1,6}[[:space:]]+[A-Z0-9.'' -]{2,}[[:space:]]+(street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|way)\y'
      )
    );
$$;

create or replace function company_ai_voice_text_array_valid(
  value text[],
  max_items integer,
  max_item_length integer
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    coalesce(cardinality(value), 0) <= max_items
    and not exists (
      select 1
      from unnest(value) as item
      where item is null
        or item = ''
        or item <> btrim(item)
        or not coalesce(company_ai_voice_text_valid(item, max_item_length, true), false)
    );
$$;

create or replace function company_ai_channel_defaults_valid(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  channel_key text;
  settings jsonb;
  hashtag_item jsonb;
begin
  if jsonb_typeof(value) <> 'object' then
    return false;
  end if;

  for channel_key, settings in select key, val from jsonb_each(value) as entry(key, val)
  loop
    if channel_key not in ('Instagram', 'Facebook', 'LinkedIn', 'Google Business', 'Blog / Case Study', 'Short Video') then
      return false;
    end if;
    if jsonb_typeof(settings) <> 'object' then
      return false;
    end if;
    if settings - array['enabled', 'defaultTone', 'defaultLocale', 'callToActionGuidance', 'hashtagGuidance']::text[] <> '{}'::jsonb then
      return false;
    end if;
    if settings ? 'enabled' and jsonb_typeof(settings->'enabled') <> 'boolean' then
      return false;
    end if;
    if settings ? 'defaultTone' and (
      jsonb_typeof(settings->'defaultTone') <> 'string'
      or settings->>'defaultTone' not in ('Professional', 'Friendly', 'Technical', 'Educational', 'Marketing')
    ) then
      return false;
    end if;
    if settings ? 'defaultLocale' and (
      jsonb_typeof(settings->'defaultLocale') <> 'string'
      or char_length(settings->>'defaultLocale') > 35
      or settings->>'defaultLocale' !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
    ) then
      return false;
    end if;
    if settings ? 'callToActionGuidance' and (
      jsonb_typeof(settings->'callToActionGuidance') <> 'string'
      or not company_ai_voice_text_valid(settings->>'callToActionGuidance', 160, true)
    ) then
      return false;
    end if;
    if settings ? 'hashtagGuidance' then
      if jsonb_typeof(settings->'hashtagGuidance') <> 'array'
        or jsonb_array_length(settings->'hashtagGuidance') > 20 then
        return false;
      end if;
      for hashtag_item in select item from jsonb_array_elements(settings->'hashtagGuidance') as item
      loop
        if jsonb_typeof(hashtag_item) <> 'string'
          or not company_ai_voice_text_valid(hashtag_item #>> '{}', 40, true) then
          return false;
        end if;
      end loop;
    end if;
  end loop;

  return true;
end;
$$;

create table company_profiles (
  company_id uuid primary key references companies(id) on delete cascade,
  legal_name text not null default '',
  display_name text not null default '',
  logo_storage_path text,
  website text,
  phone text,
  billing_email citext,
  service_address text,
  service_area text,
  timezone text not null default 'America/New_York',
  emergency_contact text,
  website_intake_enabled boolean not null default false,
  website_intake_token text,
  website_intake_allowed_origins text,
  lead_api_enabled boolean not null default false,
  lead_api_token text,
  access_rules jsonb not null default '{}'::jsonb,
  ai_voice_enabled boolean not null default false,
  ai_public_display_name text not null default '' check (company_ai_voice_text_valid(ai_public_display_name, 80, true)),
  ai_default_tone text not null default 'Professional' check (ai_default_tone in ('Professional', 'Friendly', 'Technical', 'Educational', 'Marketing')),
  ai_custom_voice_guidance text not null default '' check (company_ai_voice_text_valid(ai_custom_voice_guidance, 1000, true)),
  ai_service_areas text[] not null default '{}'::text[] check (company_ai_voice_text_array_valid(ai_service_areas, 20, 80)),
  ai_public_location_wording text not null default '' check (company_ai_voice_text_valid(ai_public_location_wording, 160, true)),
  ai_cta_guidance text not null default '' check (company_ai_voice_text_valid(ai_cta_guidance, 160, true)),
  ai_hashtag_guidance text[] not null default '{}'::text[] check (company_ai_voice_text_array_valid(ai_hashtag_guidance, 20, 40)),
  ai_channel_defaults jsonb not null default '{}'::jsonb check (company_ai_channel_defaults_valid(ai_channel_defaults)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table company_onboarding_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  step_key text not null,
  status onboarding_status not null default 'todo',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, step_key)
);

create table company_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  severity priority_level not null default 'normal',
  title text not null,
  details text not null default '',
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- =========================================================
-- Company access / team
-- =========================================================

create table company_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email citext not null,
  role company_role not null default 'technician',
  status user_status not null default 'invited',
  portal_access_rules jsonb not null default '{}'::jsonb,
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, email)
);

create table company_technicians (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  company_user_id uuid references company_users(id) on delete set null,
  name text not null,
  email citext,
  phone text,
  role technician_role not null default 'technician',
  status user_status not null default 'active',
  assigned_jobs_count integer not null default 0,
  gps_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS helper functions are created after platform_users and company_users exist.
create or replace function current_platform_role()
returns platform_role
language sql
security definer
set search_path = public
stable
as $$
  select role
  from public.platform_users
  where auth_user_id = auth.uid()
    and status = 'active'
  limit 1;
$$;

create or replace function is_platform_team()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.platform_users
    where auth_user_id = auth.uid()
      and status = 'active'
      and role in ('owner', 'admin', 'support')
  );
$$;

create or replace function is_platform_owner()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.platform_users
    where auth_user_id = auth.uid()
      and status = 'active'
      and role = 'owner'
  );
$$;

create or replace function current_company_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select company_id
  from public.company_users
  where auth_user_id = auth.uid()
    and status = 'active';
$$;

create or replace function can_access_company(target_company_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_platform_team()
    or exists (
      select 1
      from public.company_users
      where auth_user_id = auth.uid()
        and company_id = target_company_id
        and status = 'active'
    );
$$;

create or replace function can_manage_company(target_company_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_platform_team()
    or exists (
      select 1
      from public.company_users
      where auth_user_id = auth.uid()
        and company_id = target_company_id
        and status = 'active'
        and role in ('admin', 'manager', 'dispatcher')
    );
$$;

create or replace function app_current_session()
returns table (
  kind text,
  user_id uuid,
  name text,
  email citext,
  company_id uuid,
  company_name text,
  role text,
  status text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    'owner'::text as kind,
    platform_users.id as user_id,
    platform_users.name,
    platform_users.email,
    null::uuid as company_id,
    null::text as company_name,
    platform_users.role::text as role,
    platform_users.status::text as status
  from public.platform_users
  where platform_users.status = 'active'
    and (
      platform_users.auth_user_id = auth.uid()
      or lower(platform_users.email::text) = lower(coalesce(auth.email(), ''))
    )

  union all

  select
    'company'::text as kind,
    company_users.id as user_id,
    company_users.name,
    company_users.email,
    company_users.company_id,
    companies.name as company_name,
    company_users.role::text as role,
    company_users.status::text as status
  from public.company_users
  join public.companies on companies.id = company_users.company_id
  where company_users.status = 'active'
    and (
      company_users.auth_user_id = auth.uid()
      or lower(company_users.email::text) = lower(coalesce(auth.email(), ''))
    )

  union all

  select
    'company'::text as kind,
    companies.id as user_id,
    coalesce(nullif(companies.owner_name, ''), companies.owner_email::text) as name,
    companies.owner_email as email,
    companies.id as company_id,
    companies.name as company_name,
    'admin'::text as role,
    'active'::text as status
  from public.companies
  where lower(companies.owner_email::text) = lower(coalesce(auth.email(), ''))
  order by kind desc
  limit 1;
$$;

grant usage on schema public to authenticated;
grant execute on function can_access_company(uuid) to authenticated;
grant execute on function can_access_company(uuid) to service_role;
grant execute on function can_manage_company(uuid) to authenticated;
grant execute on function can_manage_company(uuid) to service_role;
grant execute on function app_current_session() to authenticated;
revoke execute on function company_ai_voice_text_valid(text, integer, boolean) from public, anon;
revoke execute on function company_ai_voice_text_array_valid(text[], integer, integer) from public, anon;
revoke execute on function company_ai_channel_defaults_valid(jsonb) from public, anon;
grant execute on function company_ai_voice_text_valid(text, integer, boolean) to authenticated, service_role;
grant execute on function company_ai_voice_text_array_valid(text[], integer, integer) to authenticated, service_role;
grant execute on function company_ai_channel_defaults_valid(jsonb) to authenticated, service_role;
revoke execute on function can_access_company(uuid) from anon;
revoke execute on function can_manage_company(uuid) from anon;

-- =========================================================
-- Company settings
-- =========================================================

create table company_job_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  job_number_prefix text not null default '',
  default_duration_minutes integer not null default 60,
  default_priority priority_level not null default 'normal',
  requires_parts boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

create table company_payment_methods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  method payment_method not null,
  enabled boolean not null default true,
  display_label text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, method)
);

create table company_job_workflow_settings (
  company_id uuid primary key references companies(id) on delete cascade,
  job_assignment_mode text not null default 'manual',
  use_job_number_prefixes boolean not null default true,
  default_job_number_prefix text not null default 'JOB',
  default_service_call_fee_cents integer not null default 12000,
  default_job_priority priority_level not null default 'normal',
  warranty_days integer not null default 30,
  auto_archive_completed_after_days integer not null default 14,
  auto_archive_cancelled_after_days integer not null default 7,
  require_completion_note boolean not null default true,
  require_completion_photo boolean not null default false,
  allow_warranty_reopen boolean not null default true,
  payment_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table company_payroll_rules (
  company_id uuid primary key references companies(id) on delete cascade,
  commission_percent numeric(5,2) not null default 50,
  scf_only_payout_cents integer not null default 5000,
  include_scf_in_commission_base boolean not null default true,
  deduct_materials_before_payroll boolean not null default true,
  archive_paid_after_days integer not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- Customers and locations
-- =========================================================

create table customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  organization text not null default '',
  primary_name text not null default '',
  primary_email citext,
  primary_phone text,
  notes text not null default '',
  blacklist text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table customer_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  label text not null default 'Service address',
  address text not null,
  latitude numeric(10,7),
  longitude numeric(10,7),
  access_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- Jobs / operations
-- =========================================================

create table jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  customer_location_id uuid references customer_locations(id) on delete set null,
  technician_id uuid references company_technicians(id) on delete set null,
  job_type_id uuid references company_job_types(id) on delete set null,
  job_number text not null,
  status job_status not null default 'New',
  system text not null default '',
  issue text not null default '',
  notes text not null default '',
  service_call_fee_cents integer not null default 0,
  labor_cents integer not null default 0,
  created_by_user_id uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  warranty_until date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, job_number)
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  technician_id uuid references company_technicians(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table job_inbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  source text not null default 'manual'
    check (source in ('call', 'missed_call', 'website', 'online_booking', 'email', 'sms', 'partner', 'manual')),
  client_name text not null default '',
  client_phone text not null default '',
  client_email citext,
  address text not null default '',
  message text not null default '',
  status text not null default 'new'
    check (status in ('new', 'converted', 'ignored', 'duplicate', 'spam')),
  job_id uuid references jobs(id) on delete set null,
  external_source text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table job_comments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  author_name text not null,
  author_role text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table job_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  uploaded_by_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  kind attachment_kind not null default 'file',
  storage_bucket text not null default 'job-files',
  storage_path text not null,
  created_at timestamptz not null default now()
);

create table job_materials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  name text not null,
  quantity numeric(10,2) not null default 1,
  unit_price_cents integer not null default 0,
  supplier text not null default '',
  status material_status not null default 'Needed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table job_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  scope payment_scope not null,
  method payment_method,
  amount_cents integer not null default 0,
  paid_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table job_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  invoice_number text not null,
  document_type text not null default 'Invoice' check (document_type in ('Invoice', 'Proposal', 'Estimate', 'Receipt')),
  status invoice_status not null default 'draft',
  amount_cents integer not null default 0,
  pdf_storage_path text,
  sent_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, invoice_number)
);

-- =========================================================
-- Payroll
-- =========================================================

create table payroll_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  technician_id uuid not null references company_technicians(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft',
  total_pay_cents integer not null default 0,
  report_storage_path text,
  sent_to_email citext,
  paid_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table payroll_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  payroll_batch_id uuid references payroll_batches(id) on delete set null,
  job_id uuid not null references jobs(id) on delete cascade,
  technician_id uuid not null references company_technicians(id) on delete cascade,
  collected_cents integer not null default 0,
  materials_cents integer not null default 0,
  payroll_base_cents integer not null default 0,
  salary_cents integer not null default 0,
  review_note text not null default '',
  selected_for_payment boolean not null default false,
  paid_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, job_id, technician_id)
);

-- =========================================================
-- Tasks / technician map
-- =========================================================

create table tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  job_number text not null default '',
  assigned_user_id uuid references company_users(id) on delete set null,
  assigned_to text not null default 'Office',
  title text not null,
  notes text not null default '',
  due_at timestamptz,
  priority priority_level not null default 'normal',
  status task_status not null default 'To do',
  source task_source not null default 'Manual',
  auto_key text,
  completed_by text,
  completed_at timestamptz,
  completion_note text not null default '',
  status_changed_by text,
  status_changed_at timestamptz,
  status_changed_from text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table technician_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  technician_id uuid not null references company_technicians(id) on delete cascade,
  latitude numeric(10,7) not null,
  longitude numeric(10,7) not null,
  accuracy_meters numeric(10,2),
  recorded_at timestamptz not null default now(),
  source text not null default 'mobile'
);

-- =========================================================
-- Email
-- =========================================================

create table email_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references companies(id) on delete cascade,
  provider email_provider not null,
  address citext not null,
  status email_connection_status not null default 'backend_required',
  last_sync_at timestamptz,
  sync_range_days integer not null default 30,
  auto_link_job_number boolean not null default true,
  auto_link_client_email boolean not null default true,
  create_task_from_unread boolean not null default false,
  import_leads_from_email boolean not null default false,
  sender_name text not null default '',
  reply_to citext,
  signature text not null default '',
  imap_host text,
  imap_port text,
  smtp_host text,
  smtp_port text,
  security text,
  username text,
  token_encrypted bytea,
  refresh_token_encrypted bytea,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table mailbox_oauth_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  provider email_provider not null,
  client_id text not null,
  client_secret text not null,
  redirect_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider)
);

create table email_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  email_connection_id uuid references email_connections(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  folder email_folder not null,
  provider_message_id text,
  from_email citext,
  to_email citext,
  subject text not null default '',
  preview text not null default '',
  body text not null default '',
  body_html text not null default '',
  body_storage_path text,
  unread boolean not null default false,
  received_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table email_message_attachments (
  id uuid primary key default gen_random_uuid(),
  email_message_id uuid not null references email_messages(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes integer not null default 0,
  content_base64 text,
  content_id text,
  gmail_attachment_id text,
  storage_bucket text,
  storage_path text,
  is_inline boolean not null default false,
  created_at timestamptz not null default now()
);

create table email_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- ServiceScope billing / subscriptions
-- =========================================================

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references companies(id) on delete cascade,
  plan_id uuid references plans(id) on delete set null,
  status subscription_status not null default 'not_connected',
  provider text not null default 'stripe',
  provider_customer_id text,
  provider_subscription_id text,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table subscription_payment_methods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete cascade,
  provider text not null default 'stripe',
  provider_payment_method_id text,
  status subscription_payment_status not null default 'not_connected',
  brand text,
  last4 text,
  exp_month integer,
  exp_year integer,
  billing_name text,
  billing_zip text,
  autopay_enabled boolean not null default false,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, is_default)
);

create table subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  provider_invoice_id text,
  status invoice_status not null default 'open',
  amount_due_cents integer not null default 0,
  amount_paid_cents integer not null default 0,
  currency text not null default 'usd',
  due_at timestamptz,
  paid_at timestamptz,
  invoice_pdf_url text,
  created_at timestamptz not null default now()
);

-- =========================================================
-- Owner support
-- =========================================================

create table owner_support_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  author_name text not null,
  author_email citext,
  kind support_kind not null default 'question',
  priority priority_level not null default 'normal',
  status support_status not null default 'new',
  subject text not null,
  message text not null,
  last_update_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table owner_support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references owner_support_tickets(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  author support_message_author not null,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

-- =========================================================
-- Technical library
-- =========================================================

create table library_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  title text not null,
  category library_category not null,
  system text not null default '',
  manufacturer text not null default '',
  model text not null default '',
  format library_format not null default 'PDF',
  tags text[] not null default '{}',
  summary text not null default '',
  storage_bucket text not null default 'library',
  storage_path text,
  external_url text,
  file_size_bytes bigint not null default 0,
  uploaded_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- Indexes
-- =========================================================

create index idx_companies_status on companies(status);
create index idx_companies_billing_status on companies(billing_status);
create index idx_company_users_auth_user_id on company_users(auth_user_id);
create index idx_company_users_company_id on company_users(company_id);
create index idx_company_technicians_company_id on company_technicians(company_id);
create index idx_jobs_company_status on jobs(company_id, status);
create index idx_jobs_company_job_number on jobs(company_id, job_number);
create index idx_jobs_technician on jobs(technician_id);
create index idx_jobs_customer on jobs(customer_id);
create index idx_appointments_company_starts on appointments(company_id, starts_at);
create index idx_appointments_technician_starts on appointments(technician_id, starts_at);
create index idx_job_inbox_company_status on job_inbox(company_id, status, created_at desc);
create index idx_job_inbox_company_source on job_inbox(company_id, source, created_at desc);
create unique index idx_company_profiles_website_intake_token on company_profiles(website_intake_token) where website_intake_token is not null and website_intake_token <> '';
create index idx_job_comments_job on job_comments(job_id, created_at);
create index idx_job_attachments_job on job_attachments(job_id);
create index idx_job_materials_job on job_materials(job_id);
create index idx_job_payments_job on job_payments(job_id);
create index idx_payroll_items_technician on payroll_items(company_id, technician_id, paid_at);
create index idx_tasks_company_status on tasks(company_id, status);
create index idx_tasks_company_source on tasks(company_id, source, created_at desc);
create unique index tasks_company_auto_key_unique on tasks(company_id, auto_key);
create index idx_technician_locations_latest on technician_locations(technician_id, recorded_at desc);
create index idx_email_messages_company_folder on email_messages(company_id, folder, created_at desc);
create index idx_email_message_attachments_message on email_message_attachments(email_message_id);
create index idx_support_tickets_company_status on owner_support_tickets(company_id, status);
create index idx_audit_company_created on audit_events(company_id, created_at desc);
create index idx_library_company_search on library_documents(company_id, category, system, manufacturer);

-- =========================================================
-- Updated-at triggers
-- =========================================================

create trigger set_platform_users_updated_at before update on platform_users for each row execute function set_updated_at();
create trigger set_plans_updated_at before update on plans for each row execute function set_updated_at();
create trigger set_companies_updated_at before update on companies for each row execute function set_updated_at();
create trigger set_company_profiles_updated_at before update on company_profiles for each row execute function set_updated_at();
create trigger set_company_onboarding_steps_updated_at before update on company_onboarding_steps for each row execute function set_updated_at();
create trigger set_company_users_updated_at before update on company_users for each row execute function set_updated_at();
create trigger set_company_technicians_updated_at before update on company_technicians for each row execute function set_updated_at();
create trigger set_company_job_types_updated_at before update on company_job_types for each row execute function set_updated_at();
create trigger set_company_payment_methods_updated_at before update on company_payment_methods for each row execute function set_updated_at();
create trigger set_company_job_workflow_settings_updated_at before update on company_job_workflow_settings for each row execute function set_updated_at();
create trigger set_company_payroll_rules_updated_at before update on company_payroll_rules for each row execute function set_updated_at();
create trigger set_customers_updated_at before update on customers for each row execute function set_updated_at();
create trigger set_customer_locations_updated_at before update on customer_locations for each row execute function set_updated_at();
create trigger set_jobs_updated_at before update on jobs for each row execute function set_updated_at();
create trigger set_appointments_updated_at before update on appointments for each row execute function set_updated_at();
create trigger set_job_inbox_updated_at before update on job_inbox for each row execute function set_updated_at();
create trigger set_job_materials_updated_at before update on job_materials for each row execute function set_updated_at();
create trigger set_job_invoices_updated_at before update on job_invoices for each row execute function set_updated_at();
create trigger set_payroll_batches_updated_at before update on payroll_batches for each row execute function set_updated_at();
create trigger set_payroll_items_updated_at before update on payroll_items for each row execute function set_updated_at();
create trigger set_tasks_updated_at before update on tasks for each row execute function set_updated_at();
create trigger set_email_connections_updated_at before update on email_connections for each row execute function set_updated_at();
create trigger set_mailbox_oauth_settings_updated_at before update on mailbox_oauth_settings for each row execute function set_updated_at();
create trigger set_email_templates_updated_at before update on email_templates for each row execute function set_updated_at();
create trigger set_subscriptions_updated_at before update on subscriptions for each row execute function set_updated_at();
create trigger set_subscription_payment_methods_updated_at before update on subscription_payment_methods for each row execute function set_updated_at();
create trigger set_owner_support_tickets_updated_at before update on owner_support_tickets for each row execute function set_updated_at();
create trigger set_library_documents_updated_at before update on library_documents for each row execute function set_updated_at();

-- =========================================================
-- RLS
-- =========================================================

alter table platform_users enable row level security;
alter table audit_events enable row level security;
alter table plans enable row level security;
alter table companies enable row level security;
alter table company_profiles enable row level security;
alter table company_onboarding_steps enable row level security;
alter table company_alerts enable row level security;
alter table company_users enable row level security;
alter table company_technicians enable row level security;
alter table company_job_types enable row level security;
alter table company_payment_methods enable row level security;
alter table company_job_workflow_settings enable row level security;
alter table company_payroll_rules enable row level security;
alter table customers enable row level security;
alter table customer_locations enable row level security;
alter table jobs enable row level security;
alter table appointments enable row level security;
alter table job_comments enable row level security;
alter table job_attachments enable row level security;
grant select, insert, delete on table public.job_attachments to authenticated;
alter table job_materials enable row level security;
alter table job_payments enable row level security;
alter table job_invoices enable row level security;
alter table payroll_batches enable row level security;
alter table payroll_items enable row level security;
alter table job_inbox enable row level security;
alter table tasks enable row level security;
alter table technician_locations enable row level security;
alter table email_connections enable row level security;
alter table mailbox_oauth_settings enable row level security;
alter table email_messages enable row level security;
alter table email_message_attachments enable row level security;
alter table email_templates enable row level security;
alter table subscriptions enable row level security;
alter table subscription_payment_methods enable row level security;
alter table subscription_invoices enable row level security;
alter table owner_support_tickets enable row level security;
alter table owner_support_messages enable row level security;
alter table library_documents enable row level security;

-- Platform users
create policy "platform team can read platform users" on platform_users
  for select using (public.is_platform_team() or auth_user_id = auth.uid());

create policy "platform owner can manage platform users" on platform_users
  for all using (public.is_platform_owner()) with check (public.is_platform_owner());

-- Plans are readable by authenticated users, managed by owner.
create policy "authenticated can read plans" on plans
  for select using (auth.uid() is not null);

create policy "platform owner can manage plans" on plans
  for all using (public.is_platform_owner()) with check (public.is_platform_owner());

-- Companies and tenant-owned records
create policy "tenant members and platform can read companies" on companies
  for select using (public.is_platform_team() or id in (select public.current_company_ids()));

create policy "platform team can manage companies" on companies
  for all using (public.is_platform_team()) with check (public.is_platform_team());

-- Generic company_id RLS tables
create policy "company profiles readable by company or platform" on company_profiles
  for select using (public.can_access_company(company_id));
create policy "company profiles manageable by company managers or platform" on company_profiles
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "onboarding readable by company or platform" on company_onboarding_steps
  for select using (public.can_access_company(company_id));
create policy "onboarding manageable by company managers or platform" on company_onboarding_steps
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "alerts readable by company or platform" on company_alerts
  for select using (public.can_access_company(company_id));
create policy "alerts manageable by platform" on company_alerts
  for all using (public.is_platform_team()) with check (public.is_platform_team());

create policy "company users readable by company or platform" on company_users
  for select using (public.can_access_company(company_id));
create policy "company users manageable by company managers or platform" on company_users
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "company technicians readable by company or platform" on company_technicians
  for select using (public.can_access_company(company_id));
create policy "company technicians manageable by company managers or platform" on company_technicians
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "job types readable by company or platform" on company_job_types
  for select using (public.can_access_company(company_id));
create policy "job types manageable by company managers or platform" on company_job_types
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "payment methods readable by company or platform" on company_payment_methods
  for select using (public.can_access_company(company_id));
create policy "payment methods manageable by company managers or platform" on company_payment_methods
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "workflow settings readable by company or platform" on company_job_workflow_settings
  for select using (public.can_access_company(company_id));
create policy "workflow settings manageable by company managers or platform" on company_job_workflow_settings
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "payroll rules readable by company or platform" on company_payroll_rules
  for select using (public.can_access_company(company_id));
create policy "payroll rules manageable by company managers or platform" on company_payroll_rules
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "customers readable by company or platform" on customers
  for select using (public.can_access_company(company_id));
create policy "customers manageable by company or platform" on customers
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "customer locations readable by company or platform" on customer_locations
  for select using (public.can_access_company(company_id));
create policy "customer locations manageable by company or platform" on customer_locations
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "jobs readable by company or platform" on jobs
  for select using (public.can_access_company(company_id));
create policy "jobs manageable by company or platform" on jobs
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "appointments readable by company or platform" on appointments
  for select using (public.can_access_company(company_id));
create policy "appointments manageable by company or platform" on appointments
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "job comments readable by company or platform" on job_comments
  for select using (public.can_access_company(company_id));
create policy "job comments insertable by company or platform" on job_comments
  for insert with check (public.can_access_company(company_id));

create policy "job attachments readable by company or platform" on job_attachments
  for select using (public.can_access_company(company_id));
create policy "job attachments insertable by company members" on job_attachments
  for insert with check (public.can_access_company(company_id));
create policy "job attachments deletable by uploader or company manager" on job_attachments
  for delete using (public.can_manage_company(company_id) or (uploaded_by_user_id = auth.uid() and public.can_access_company(company_id)));
create policy "job attachments manageable by company or platform" on job_attachments
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "job materials readable by company or platform" on job_materials
  for select using (public.can_access_company(company_id));
create policy "job materials manageable by company or platform" on job_materials
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "job payments readable by company or platform" on job_payments
  for select using (public.can_access_company(company_id));
create policy "job payments manageable by company managers or platform" on job_payments
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "job invoices readable by company or platform" on job_invoices
  for select using (public.can_access_company(company_id));
create policy "job invoices manageable by company managers or platform" on job_invoices
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "payroll batches readable by company or platform" on payroll_batches
  for select using (public.can_access_company(company_id));
create policy "payroll batches manageable by company managers or platform" on payroll_batches
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "payroll items readable by company or platform" on payroll_items
  for select using (public.can_access_company(company_id));
create policy "payroll items manageable by company managers or platform" on payroll_items
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "job inbox readable by company or platform" on job_inbox
  for select using (public.can_access_company(company_id));
create policy "job inbox manageable by company managers or platform" on job_inbox
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "tasks readable by company or platform" on tasks
  for select using (public.can_access_company(company_id));
create policy "tasks manageable by company or platform" on tasks
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "locations readable by company or platform" on technician_locations
  for select using (public.can_access_company(company_id));
create policy "locations insertable by company users or platform" on technician_locations
  for insert with check (public.can_access_company(company_id));

create policy "email connections readable by company or platform" on email_connections
  for select using (public.can_access_company(company_id));
create policy "email connections manageable by company managers or platform" on email_connections
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "mailbox oauth settings readable by company managers or platform" on mailbox_oauth_settings
  for select using (public.can_manage_company(company_id));
create policy "mailbox oauth settings manageable by company managers or platform" on mailbox_oauth_settings
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "email messages readable by company or platform" on email_messages
  for select using (public.can_access_company(company_id));
create policy "email messages manageable by company managers or platform" on email_messages
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "email attachments readable by company or platform" on email_message_attachments
  for select using (public.can_access_company(company_id));
create policy "email attachments manageable by company managers or platform" on email_message_attachments
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "email templates readable by company or platform" on email_templates
  for select using (public.can_access_company(company_id));
create policy "email templates manageable by company managers or platform" on email_templates
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "subscriptions readable by company or platform" on subscriptions
  for select using (public.can_access_company(company_id));
create policy "subscriptions manageable by platform" on subscriptions
  for all using (public.is_platform_team()) with check (public.is_platform_team());

create policy "subscription payment methods readable by company or platform" on subscription_payment_methods
  for select using (public.can_access_company(company_id));
create policy "subscription payment methods manageable by platform" on subscription_payment_methods
  for all using (public.is_platform_team()) with check (public.is_platform_team());

create policy "subscription invoices readable by company or platform" on subscription_invoices
  for select using (public.can_access_company(company_id));
create policy "subscription invoices manageable by platform" on subscription_invoices
  for all using (public.is_platform_team()) with check (public.is_platform_team());

create policy "support tickets readable by company or platform" on owner_support_tickets
  for select using (company_id is null or public.can_access_company(company_id));
create policy "support tickets insertable by authenticated users" on owner_support_tickets
  for insert with check (auth.uid() is not null and (company_id is null or public.can_access_company(company_id)));
create policy "support tickets updateable by platform" on owner_support_tickets
  for update using (public.is_platform_team()) with check (public.is_platform_team());

create policy "support messages readable by company or platform" on owner_support_messages
  for select using (company_id is null or public.can_access_company(company_id));
create policy "support messages insertable by company or platform" on owner_support_messages
  for insert with check (auth.uid() is not null and (company_id is null or public.can_access_company(company_id) or public.is_platform_team()));

create policy "library readable by company or platform" on library_documents
  for select using (public.can_access_company(company_id));
create policy "library manageable by company or platform" on library_documents
  for all using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id));

create policy "audit readable by platform" on audit_events
  for select using (public.is_platform_team());
create policy "audit insertable by authenticated users" on audit_events
  for insert with check (auth.uid() is not null);

-- =========================================================
-- Storage buckets
-- =========================================================

insert into storage.buckets (id, name, public)
values
  ('job-files', 'job-files', true),
  ('library', 'library', false),
  ('email-files', 'email-files', true),
  ('company-logos', 'company-logos', true)
on conflict (id) do nothing;

-- Storage policies use the convention:
-- job-files/{company_id}/{job_id}/{file}
-- library/{company_id}/{file}
-- email-files/{company_id}/{email_message_id}/{file}
-- company-logos/{company_id}/{file}
create policy "authenticated can read company logos" on storage.objects
  for select using (bucket_id = 'company-logos');

create policy "company managers can upload company logos" on storage.objects
  for insert with check (
    bucket_id = 'company-logos'
    and public.can_manage_company((storage.foldername(name))[1]::uuid)
  );

create policy "company managers can update company logos" on storage.objects
  for update using (
    bucket_id = 'company-logos'
    and public.can_manage_company((storage.foldername(name))[1]::uuid)
  ) with check (
    bucket_id = 'company-logos'
    and public.can_manage_company((storage.foldername(name))[1]::uuid)
  );

create policy "company members can read job files" on storage.objects
  for select using (
    bucket_id = 'job-files'
    and public.can_access_company((storage.foldername(name))[1]::uuid)
  );

create policy "company members can upload job files" on storage.objects
  for insert with check (
    bucket_id = 'job-files'
    and public.can_access_company((storage.foldername(name))[1]::uuid)
  );

create policy "company members can read library files" on storage.objects
  for select using (
    bucket_id = 'library'
    and public.can_access_company((storage.foldername(name))[1]::uuid)
  );

create policy "company managers can upload library files" on storage.objects
  for insert with check (
    bucket_id = 'library'
    and public.can_manage_company((storage.foldername(name))[1]::uuid)
  );

create policy "company members can read email files" on storage.objects
  for select using (
    bucket_id = 'email-files'
    and public.can_access_company((storage.foldername(name))[1]::uuid)
  );

create policy "company members can upload email files" on storage.objects
  for insert with check (
    bucket_id = 'email-files'
    and public.can_access_company((storage.foldername(name))[1]::uuid)
  );

create policy "company members can update email files" on storage.objects
  for update using (
    bucket_id = 'email-files'
    and public.can_access_company((storage.foldername(name))[1]::uuid)
  ) with check (
    bucket_id = 'email-files'
    and public.can_access_company((storage.foldername(name))[1]::uuid)
  );

create policy "company members can delete email files" on storage.objects
  for delete using (
    bucket_id = 'email-files'
    and public.can_access_company((storage.foldername(name))[1]::uuid)
  );

-- =========================================================
-- Bootstrap owner after creating your first Auth user
-- =========================================================
--
-- 1. In Supabase Dashboard, create/sign up your owner user in Authentication.
-- 2. Copy that user's auth.users.id.
-- 3. Run this with your real values:
--
-- insert into public.platform_users (auth_user_id, name, email, role, status)
-- values ('00000000-0000-0000-0000-000000000000', 'Your Name', 'you@example.com', 'owner', 'active');

-- META_SOCIAL_CONNECTION_SCHEMA_BEGIN
create table public.company_social_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null,
  status text not null default 'pending_asset_selection',
  facebook_page_id text,
  facebook_page_name text,
  instagram_account_id text,
  instagram_username text,
  instagram_account_type text,
  granted_scopes text[] not null default '{}'::text[],
  token_envelope jsonb,
  token_expires_at timestamptz,
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz,
  last_checked_at timestamptz,
  last_error_code text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_social_connections_provider_check
    check (provider = 'meta-facebook-login'),
  constraint company_social_connections_status_check
    check (status in ('pending_asset_selection', 'connected', 'needs_reauthorization', 'error', 'revoked')),
  constraint company_social_connections_page_shape_check
    check (
      (status = 'pending_asset_selection' and facebook_page_id is null and facebook_page_name is null)
      or (status <> 'pending_asset_selection' and facebook_page_id is not null and facebook_page_name is not null)
    ),
  constraint company_social_connections_instagram_shape_check
    check (
      (instagram_account_id is null and instagram_username is null and instagram_account_type is null)
      or (
        instagram_account_id is not null
        and instagram_username is not null
        and instagram_account_type in ('BUSINESS', 'CREATOR')
      )
    ),
  constraint company_social_connections_scopes_check
    check (
      granted_scopes <@ array['pages_show_list', 'pages_read_engagement', 'instagram_basic']::text[]
      and array_position(granted_scopes, null) is null
    ),
  constraint company_social_connections_token_state_check
    check (
      (status in ('connected', 'needs_reauthorization', 'error') and token_envelope is not null)
      or (status in ('pending_asset_selection', 'revoked') and token_envelope is null)
    ),
  constraint company_social_connections_token_envelope_shape_check
    check (
      token_envelope is null or (
        jsonb_typeof(token_envelope) = 'object'
        and token_envelope ?& array['schemaVersion', 'algorithm', 'keyVersion', 'purpose', 'iv', 'ciphertext']
        and token_envelope ->> 'schemaVersion' = 'encrypted-social-token-v1'
        and token_envelope ->> 'algorithm' = 'AES-GCM'
        and token_envelope ->> 'purpose' = 'meta-connection'
        and jsonb_typeof(token_envelope -> 'keyVersion') = 'number'
        and token_envelope ->> 'keyVersion' = '1'
        and token_envelope ->> 'iv' ~ '^[A-Za-z0-9_-]+$'
        and length(token_envelope ->> 'iv') between 16 and 128
        and token_envelope ->> 'ciphertext' ~ '^[A-Za-z0-9_-]+$'
        and length(token_envelope ->> 'ciphertext') between 23 and 32768
        and token_envelope - 'schemaVersion' - 'algorithm' - 'keyVersion' - 'purpose' - 'iv' - 'ciphertext' = '{}'::jsonb
      )
    ),
  constraint company_social_connections_error_code_check
    check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{2,80}$')
);

create unique index company_social_connections_active_provider_unique
  on public.company_social_connections (company_id, provider)
  where status <> 'revoked';

create index company_social_connections_company_status_idx
  on public.company_social_connections (company_id, status, updated_at desc);

create table public.company_social_oauth_states (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_auth_user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  state_hash bytea not null unique,
  redirect_uri text not null,
  return_path text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  encrypted_pending_token_bundle jsonb,
  discovered_assets jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_social_oauth_states_provider_check
    check (provider = 'meta-facebook-login'),
  constraint company_social_oauth_states_hash_check
    check (octet_length(state_hash) = 32),
  constraint company_social_oauth_states_redirect_check
    check (redirect_uri ~ '^https://[^[:space:]]+$' or redirect_uri ~ '^http://127\\.0\\.0\\.1(:[0-9]+)?/[^[:space:]]*$'),
  constraint company_social_oauth_states_return_path_check
    check (return_path = '/settings/social-connections'),
  constraint company_social_oauth_states_expiry_check
    check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  constraint company_social_oauth_states_assets_check
    check (discovered_assets is null or jsonb_typeof(discovered_assets) = 'array'),
  constraint company_social_oauth_states_pending_shape_check
    check (
      (encrypted_pending_token_bundle is null and discovered_assets is null)
      or (consumed_at is not null and encrypted_pending_token_bundle is not null and discovered_assets is not null)
    ),
  constraint company_social_oauth_states_pending_envelope_shape_check
    check (
      encrypted_pending_token_bundle is null or (
        jsonb_typeof(encrypted_pending_token_bundle) = 'object'
        and encrypted_pending_token_bundle ?& array['schemaVersion', 'algorithm', 'keyVersion', 'purpose', 'iv', 'ciphertext']
        and encrypted_pending_token_bundle ->> 'schemaVersion' = 'encrypted-social-token-v1'
        and encrypted_pending_token_bundle ->> 'algorithm' = 'AES-GCM'
        and encrypted_pending_token_bundle ->> 'purpose' = 'meta-pending'
        and jsonb_typeof(encrypted_pending_token_bundle -> 'keyVersion') = 'number'
        and encrypted_pending_token_bundle ->> 'keyVersion' = '1'
        and encrypted_pending_token_bundle ->> 'iv' ~ '^[A-Za-z0-9_-]+$'
        and length(encrypted_pending_token_bundle ->> 'iv') between 16 and 128
        and encrypted_pending_token_bundle ->> 'ciphertext' ~ '^[A-Za-z0-9_-]+$'
        and length(encrypted_pending_token_bundle ->> 'ciphertext') between 23 and 32768
        and encrypted_pending_token_bundle - 'schemaVersion' - 'algorithm' - 'keyVersion' - 'purpose' - 'iv' - 'ciphertext' = '{}'::jsonb
      )
    )
);

create index company_social_oauth_states_company_actor_idx
  on public.company_social_oauth_states (company_id, actor_auth_user_id, created_at desc);

create index company_social_oauth_states_expiry_idx
  on public.company_social_oauth_states (expires_at);

alter table public.company_social_connections enable row level security;
alter table public.company_social_oauth_states enable row level security;

revoke all on public.company_social_connections from public, anon, authenticated;
revoke all on public.company_social_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on public.company_social_connections to service_role;
grant select, insert, update, delete on public.company_social_oauth_states to service_role;

create or replace function public.consume_company_social_oauth_state(
  p_state_hash bytea,
  p_company_id uuid,
  p_actor_auth_user_id uuid,
  p_provider text,
  p_redirect_uri text
)
returns setof public.company_social_oauth_states
language sql
security definer
set search_path = ''
as $$
  update public.company_social_oauth_states
  set consumed_at = clock_timestamp(), updated_at = clock_timestamp()
  where state_hash = p_state_hash
    and company_id = p_company_id
    and actor_auth_user_id = p_actor_auth_user_id
    and provider = p_provider
    and redirect_uri = p_redirect_uri
    and consumed_at is null
    and expires_at > clock_timestamp()
  returning *;
$$;

create or replace function public.cleanup_company_social_oauth_states(
  p_company_id uuid,
  p_provider text,
  p_now timestamptz,
  p_limit integer default 50
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  if p_provider <> 'meta-facebook-login' or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid cleanup request';
  end if;
  with doomed as (
    select id
    from public.company_social_oauth_states
    where company_id = p_company_id
      and provider = p_provider
      and expires_at <= p_now
    order by expires_at, id
    limit p_limit
    for update skip locked
  ), deleted as (
    delete from public.company_social_oauth_states state
    using doomed
    where state.id = doomed.id
    returning state.id
  )
  select count(*)::integer into deleted_count from deleted;
  return deleted_count;
end;
$$;

create or replace function public.replace_company_social_connection(
  p_connection_id uuid,
  p_company_id uuid,
  p_provider text,
  p_facebook_page_id text,
  p_facebook_page_name text,
  p_instagram_account_id text,
  p_instagram_username text,
  p_instagram_account_type text,
  p_granted_scopes text[],
  p_token_envelope jsonb,
  p_token_expires_at timestamptz,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_timestamp timestamptz
)
returns setof public.company_social_connections
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_provider <> 'meta-facebook-login'
    or p_facebook_page_id !~ '^[0-9]{1,40}$'
    or p_facebook_page_name is null
    or length(p_facebook_page_name) not between 1 and 120
    or p_granted_scopes is null
    or not (array['pages_show_list', 'pages_read_engagement', 'instagram_basic']::text[] <@ p_granted_scopes)
    or not (p_granted_scopes <@ array['pages_show_list', 'pages_read_engagement', 'instagram_basic']::text[])
    or p_token_envelope is null then
    raise exception 'invalid replacement request';
  end if;

  perform 1 from public.companies where id = p_company_id for update;
  if not found then raise exception 'company not found'; end if;

  update public.company_social_connections
  set status = 'revoked', token_envelope = null, revoked_at = p_timestamp,
      last_error_code = null, updated_at = p_timestamp
  where company_id = p_company_id and provider = p_provider and status <> 'revoked';

  insert into public.company_social_connections (
    id, company_id, provider, status, facebook_page_id, facebook_page_name,
    instagram_account_id, instagram_username, instagram_account_type,
    granted_scopes, token_envelope, token_expires_at, connected_by,
    connected_at, last_error_code, revoked_at, created_at, updated_at
  ) values (
    p_connection_id, p_company_id, p_provider, 'connected', p_facebook_page_id, p_facebook_page_name,
    p_instagram_account_id, p_instagram_username, p_instagram_account_type,
    p_granted_scopes, p_token_envelope, p_token_expires_at, p_actor_id,
    p_timestamp, null, null, p_timestamp, p_timestamp
  );

  delete from public.company_social_oauth_states
  where company_id = p_company_id and provider = p_provider;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details
  ) values (
    p_company_id, p_actor_id, p_actor_name, p_actor_role, 'access', 'meta_asset_selected',
    'meta_social_connection', 'Meta social connection', p_connection_id::text,
    p_facebook_page_name, 'Meta connection lifecycle action completed.'
  );

  return query select * from public.company_social_connections where id = p_connection_id;
end;
$$;

create or replace function public.disconnect_company_social_connection(
  p_connection_id uuid,
  p_company_id uuid,
  p_provider text,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_timestamp timestamptz
)
returns setof public.company_social_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  disconnected public.company_social_connections%rowtype;
begin
  if p_provider <> 'meta-facebook-login' then raise exception 'invalid provider'; end if;
  perform 1 from public.companies where id = p_company_id for update;
  if not found then raise exception 'company not found'; end if;

  update public.company_social_connections
  set status = 'revoked', token_envelope = null, revoked_at = p_timestamp,
      last_error_code = null, last_checked_at = p_timestamp, updated_at = p_timestamp
  where id = p_connection_id and company_id = p_company_id and provider = p_provider and status <> 'revoked'
  returning * into disconnected;
  if not found then return; end if;

  delete from public.company_social_oauth_states
  where company_id = p_company_id and provider = p_provider;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details
  ) values (
    p_company_id, p_actor_id, p_actor_name, p_actor_role, 'access', 'meta_connection_disconnected',
    'meta_social_connection', 'Meta social connection', p_connection_id::text,
    disconnected.facebook_page_name, 'Meta connection lifecycle action completed.'
  );

  return next disconnected;
end;
$$;

revoke all on function public.consume_company_social_oauth_state(bytea, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.cleanup_company_social_oauth_states(uuid, text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.replace_company_social_connection(uuid, uuid, text, text, text, text, text, text, text[], jsonb, timestamptz, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.disconnect_company_social_connection(uuid, uuid, text, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.consume_company_social_oauth_state(bytea, uuid, uuid, text, text) to service_role;
grant execute on function public.cleanup_company_social_oauth_states(uuid, text, timestamptz, integer) to service_role;
grant execute on function public.replace_company_social_connection(uuid, uuid, text, text, text, text, text, text, text[], jsonb, timestamptz, uuid, text, text, timestamptz) to service_role;
grant execute on function public.disconnect_company_social_connection(uuid, uuid, text, uuid, text, text, timestamptz) to service_role;

comment on table public.company_social_connections is
  'Server-only Meta connection records. Browser roles have no direct access to encrypted token material.';
comment on table public.company_social_oauth_states is
  'Server-only one-time OAuth state hashes and short-lived pending encrypted authorization bundles.';
comment on column public.company_social_connections.token_envelope is
  'Versioned and context-bound AES-256-GCM envelope. Never return this column to browser clients or telemetry.';
comment on column public.company_social_oauth_states.state_hash is
  'SHA-256 hash of the one-time OAuth state. Raw OAuth state is never stored.';
comment on function public.disconnect_company_social_connection(uuid, uuid, text, uuid, text, text, timestamptz) is
  'Company-local disconnect only. Global Meta deauthorization is intentionally deferred.';
-- META_SOCIAL_CONNECTION_SCHEMA_END
-- META_SOCIAL_LIFECYCLE_AUDIT_SCHEMA_BEGIN
create or replace function public.create_company_social_oauth_state_with_audit(
  p_company_id uuid,
  p_actor_auth_user_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider text,
  p_state_hash bytea,
  p_redirect_uri text,
  p_return_path text,
  p_expires_at timestamptz,
  p_timestamp timestamptz
)
returns setof public.company_social_oauth_states
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_state public.company_social_oauth_states%rowtype;
begin
  if p_provider <> 'meta-facebook-login'
    or octet_length(p_state_hash) <> 32
    or p_redirect_uri <> 'https://servicescope-inky.vercel.app/auth/meta/callback'
    or p_return_path <> '/settings/social-connections'
    or p_expires_at <= p_timestamp
    or p_expires_at > p_timestamp + interval '10 minutes' then
    raise exception 'invalid OAuth state request';
  end if;

  insert into public.company_social_oauth_states (
    company_id, actor_auth_user_id, provider, state_hash, redirect_uri,
    return_path, expires_at, created_at, updated_at
  ) values (
    p_company_id, p_actor_auth_user_id, p_provider, p_state_hash, p_redirect_uri,
    p_return_path, p_expires_at, p_timestamp, p_timestamp
  )
  returning * into created_state;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details
  ) values (
    p_company_id, p_actor_auth_user_id, p_actor_name, p_actor_role, 'access',
    'meta_connection_started', 'meta_social_authorization', 'Meta social connection',
    created_state.id::text, 'Meta authorization',
    'Meta connection lifecycle action completed.'
  );

  return next created_state;
end;
$$;

create or replace function public.save_company_social_oauth_discovery_with_audit(
  p_oauth_state_id uuid,
  p_company_id uuid,
  p_actor_auth_user_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider text,
  p_encrypted_pending_token_bundle jsonb,
  p_discovered_assets jsonb,
  p_timestamp timestamptz
)
returns setof public.company_social_oauth_states
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_state public.company_social_oauth_states%rowtype;
  updated_state public.company_social_oauth_states%rowtype;
begin
  if p_provider <> 'meta-facebook-login'
    or p_encrypted_pending_token_bundle is null
    or p_discovered_assets is null
    or jsonb_typeof(p_discovered_assets) <> 'array' then
    raise exception 'invalid OAuth discovery request';
  end if;

  select * into locked_state
  from public.company_social_oauth_states
  where id = p_oauth_state_id
    and company_id = p_company_id
    and actor_auth_user_id = p_actor_auth_user_id
    and provider = p_provider
  for update;

  if not found
    or locked_state.consumed_at is null
    or locked_state.expires_at <= p_timestamp
    or locked_state.encrypted_pending_token_bundle is not null
    or locked_state.discovered_assets is not null then
    raise exception 'invalid OAuth discovery state';
  end if;

  update public.company_social_oauth_states
  set encrypted_pending_token_bundle = p_encrypted_pending_token_bundle,
      discovered_assets = p_discovered_assets,
      updated_at = p_timestamp
  where id = locked_state.id
  returning * into updated_state;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details
  ) values (
    p_company_id, p_actor_auth_user_id, p_actor_name, p_actor_role, 'access',
    'meta_oauth_completed', 'meta_social_authorization', 'Meta social connection',
    updated_state.id::text, 'Meta authorization',
    'Meta connection lifecycle action completed.'
  );

  return next updated_state;
end;
$$;

create or replace function public.update_company_social_connection_health_with_audit(
  p_connection_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider text,
  p_status text,
  p_last_error_code text,
  p_granted_scopes text[],
  p_audit_action text,
  p_timestamp timestamptz
)
returns setof public.company_social_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_connection public.company_social_connections%rowtype;
  updated_connection public.company_social_connections%rowtype;
begin
  if p_provider <> 'meta-facebook-login'
    or p_audit_action not in ('meta_health_checked', 'meta_connection_needs_reauthorization')
    or p_status not in ('connected', 'needs_reauthorization', 'error')
    or p_granted_scopes is null
    or not (array['pages_show_list', 'pages_read_engagement', 'instagram_basic']::text[] <@ p_granted_scopes)
    or not (p_granted_scopes <@ array['pages_show_list', 'pages_read_engagement', 'instagram_basic']::text[])
    or (p_last_error_code is not null and p_last_error_code !~ '^[A-Z0-9_]{2,80}$') then
    raise exception 'invalid health update request';
  end if;

  select * into locked_connection
  from public.company_social_connections
  where id = p_connection_id
    and company_id = p_company_id
    and provider = p_provider
  for update;

  if not found
    or locked_connection.status = 'revoked'
    or locked_connection.status not in ('connected', 'needs_reauthorization', 'error')
    or (p_status <> locked_connection.status and p_status not in ('connected', 'needs_reauthorization'))
    or (p_audit_action = 'meta_connection_needs_reauthorization'
      and (p_status <> 'needs_reauthorization' or p_last_error_code is null)) then
    raise exception 'invalid health transition';
  end if;

  update public.company_social_connections
  set status = p_status,
      last_checked_at = p_timestamp,
      last_error_code = p_last_error_code,
      granted_scopes = p_granted_scopes,
      updated_at = p_timestamp
  where id = locked_connection.id
  returning * into updated_connection;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details
  ) values (
    p_company_id, p_actor_id, p_actor_name, p_actor_role, 'access', p_audit_action,
    'meta_social_connection', 'Meta social connection', updated_connection.id::text,
    locked_connection.facebook_page_name, 'Meta connection lifecycle action completed.'
  );

  return next updated_connection;
end;
$$;

revoke all on function public.create_company_social_oauth_state_with_audit(uuid, uuid, text, text, text, bytea, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.save_company_social_oauth_discovery_with_audit(uuid, uuid, uuid, text, text, text, jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.update_company_social_connection_health_with_audit(uuid, uuid, uuid, text, text, text, text, text, text[], text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_company_social_oauth_state_with_audit(uuid, uuid, text, text, text, bytea, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.save_company_social_oauth_discovery_with_audit(uuid, uuid, uuid, text, text, text, jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.update_company_social_connection_health_with_audit(uuid, uuid, uuid, text, text, text, text, text, text[], text, timestamptz) to service_role;

comment on function public.create_company_social_oauth_state_with_audit(uuid, uuid, text, text, text, bytea, text, text, timestamptz, timestamptz) is
  'Creates a bounded Meta OAuth state and its fixed-label lifecycle audit atomically. Service role only.';
comment on function public.save_company_social_oauth_discovery_with_audit(uuid, uuid, uuid, text, text, text, jsonb, jsonb, timestamptz) is
  'Saves consumed Meta OAuth discovery material and its fixed-label lifecycle audit atomically. Service role only.';
comment on function public.update_company_social_connection_health_with_audit(uuid, uuid, uuid, text, text, text, text, text, text[], text, timestamptz) is
  'Updates a locked Meta connection health state and writes a server-derived-label lifecycle audit atomically. Service role only.';
-- META_SOCIAL_LIFECYCLE_AUDIT_SCHEMA_END
-- META_SOCIAL_OAUTH_STATE_TTL_SCHEMA_BEGIN
alter table public.company_social_oauth_states
  drop constraint company_social_oauth_states_expiry_check;

alter table public.company_social_oauth_states
  add constraint company_social_oauth_states_expiry_check
  check (
    expires_at > created_at
    and expires_at <= created_at + interval '30 minutes'
  );

create or replace function public.create_company_social_oauth_state_with_audit(
  p_company_id uuid,
  p_actor_auth_user_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider text,
  p_state_hash bytea,
  p_redirect_uri text,
  p_return_path text,
  p_expires_at timestamptz,
  p_timestamp timestamptz
)
returns setof public.company_social_oauth_states
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_state public.company_social_oauth_states%rowtype;
begin
  if p_provider <> 'meta-facebook-login'
    or octet_length(p_state_hash) <> 32
    or p_redirect_uri <> 'https://servicescope-inky.vercel.app/auth/meta/callback'
    or p_return_path <> '/settings/social-connections'
    or p_expires_at <= p_timestamp
    or p_expires_at > p_timestamp + interval '30 minutes' then
    raise exception 'invalid OAuth state request';
  end if;

  insert into public.company_social_oauth_states (
    company_id, actor_auth_user_id, provider, state_hash, redirect_uri,
    return_path, expires_at, created_at, updated_at
  ) values (
    p_company_id, p_actor_auth_user_id, p_provider, p_state_hash, p_redirect_uri,
    p_return_path, p_expires_at, p_timestamp, p_timestamp
  )
  returning * into created_state;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details
  ) values (
    p_company_id, p_actor_auth_user_id, p_actor_name, p_actor_role, 'access',
    'meta_connection_started', 'meta_social_authorization', 'Meta social connection',
    created_state.id::text, 'Meta authorization',
    'Meta connection lifecycle action completed.'
  );

  return next created_state;
end;
$$;

revoke all on function public.create_company_social_oauth_state_with_audit(uuid, uuid, text, text, text, bytea, text, text, timestamptz, timestamptz) from public;
revoke all on function public.create_company_social_oauth_state_with_audit(uuid, uuid, text, text, text, bytea, text, text, timestamptz, timestamptz) from anon;
revoke all on function public.create_company_social_oauth_state_with_audit(uuid, uuid, text, text, text, bytea, text, text, timestamptz, timestamptz) from authenticated;
grant execute on function public.create_company_social_oauth_state_with_audit(uuid, uuid, text, text, text, bytea, text, text, timestamptz, timestamptz) to service_role;

comment on function public.create_company_social_oauth_state_with_audit(uuid, uuid, text, text, text, bytea, text, text, timestamptz, timestamptz) is
  'Creates a bounded 30-minute Meta OAuth state and its fixed-label lifecycle audit atomically. Service role only.';
-- META_SOCIAL_OAUTH_STATE_TTL_SCHEMA_END
-- META_FACEBOOK_PUBLISH_SCHEMA_BEGIN
alter table public.company_social_connections
  drop constraint company_social_connections_scopes_check;

alter table public.company_social_connections
  add constraint company_social_connections_scopes_check
  check (
    granted_scopes <@ array[
      'pages_show_list',
      'pages_read_engagement',
      'instagram_basic',
      'pages_manage_posts'
    ]::text[]
    and array_position(granted_scopes, null) is null
  );

create or replace function public.replace_company_social_connection(
  p_connection_id uuid,
  p_company_id uuid,
  p_provider text,
  p_facebook_page_id text,
  p_facebook_page_name text,
  p_instagram_account_id text,
  p_instagram_username text,
  p_instagram_account_type text,
  p_granted_scopes text[],
  p_token_envelope jsonb,
  p_token_expires_at timestamptz,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_timestamp timestamptz
)
returns setof public.company_social_connections
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_provider <> 'meta-facebook-login'
    or p_facebook_page_id !~ '^[0-9]{1,40}$'
    or p_facebook_page_name is null
    or length(p_facebook_page_name) not between 1 and 120
    or p_granted_scopes is null
    or not (array['pages_show_list', 'pages_read_engagement', 'instagram_basic']::text[] <@ p_granted_scopes)
    or not (p_granted_scopes <@ array['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'pages_manage_posts']::text[])
    or p_token_envelope is null then
    raise exception 'invalid replacement request';
  end if;

  perform 1 from public.companies where id = p_company_id for update;
  if not found then raise exception 'company not found'; end if;

  update public.company_social_connections
  set status = 'revoked', token_envelope = null, revoked_at = p_timestamp,
      last_error_code = null, updated_at = p_timestamp
  where company_id = p_company_id and provider = p_provider and status <> 'revoked';

  insert into public.company_social_connections (
    id, company_id, provider, status, facebook_page_id, facebook_page_name,
    instagram_account_id, instagram_username, instagram_account_type,
    granted_scopes, token_envelope, token_expires_at, connected_by,
    connected_at, last_error_code, revoked_at, created_at, updated_at
  ) values (
    p_connection_id, p_company_id, p_provider, 'connected', p_facebook_page_id, p_facebook_page_name,
    p_instagram_account_id, p_instagram_username, p_instagram_account_type,
    p_granted_scopes, p_token_envelope, p_token_expires_at, p_actor_id,
    p_timestamp, null, null, p_timestamp, p_timestamp
  );

  delete from public.company_social_oauth_states
  where company_id = p_company_id and provider = p_provider;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details
  ) values (
    p_company_id, p_actor_id, p_actor_name, p_actor_role, 'access', 'meta_asset_selected',
    'meta_social_connection', 'Meta social connection', p_connection_id::text,
    p_facebook_page_name, 'Meta connection lifecycle action completed.'
  );

  return query select * from public.company_social_connections where id = p_connection_id;
end;
$$;

create or replace function public.update_company_social_connection_health_with_audit(
  p_connection_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider text,
  p_status text,
  p_last_error_code text,
  p_granted_scopes text[],
  p_audit_action text,
  p_timestamp timestamptz
)
returns setof public.company_social_connections
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_connection public.company_social_connections%rowtype;
  updated_connection public.company_social_connections%rowtype;
begin
  if p_provider <> 'meta-facebook-login'
    or p_audit_action not in ('meta_health_checked', 'meta_connection_needs_reauthorization')
    or p_status not in ('connected', 'needs_reauthorization', 'error')
    or p_granted_scopes is null
    or not (array['pages_show_list', 'pages_read_engagement', 'instagram_basic']::text[] <@ p_granted_scopes)
    or not (p_granted_scopes <@ array['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'pages_manage_posts']::text[])
    or (p_last_error_code is not null and p_last_error_code !~ '^[A-Z0-9_]{2,80}$') then
    raise exception 'invalid health update request';
  end if;

  select * into locked_connection
  from public.company_social_connections
  where id = p_connection_id
    and company_id = p_company_id
    and provider = p_provider
  for update;

  if not found
    or locked_connection.status = 'revoked'
    or locked_connection.status not in ('connected', 'needs_reauthorization', 'error')
    or (p_status <> locked_connection.status and p_status not in ('connected', 'needs_reauthorization'))
    or (p_audit_action = 'meta_connection_needs_reauthorization'
      and (p_status <> 'needs_reauthorization' or p_last_error_code is null)) then
    raise exception 'invalid health transition';
  end if;

  update public.company_social_connections
  set status = p_status,
      last_checked_at = p_timestamp,
      last_error_code = p_last_error_code,
      granted_scopes = p_granted_scopes,
      updated_at = p_timestamp
  where id = locked_connection.id
  returning * into updated_connection;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details
  ) values (
    p_company_id, p_actor_id, p_actor_name, p_actor_role, 'access', p_audit_action,
    'meta_social_connection', 'Meta social connection', updated_connection.id::text,
    locked_connection.facebook_page_name, 'Meta connection lifecycle action completed.'
  );

  return next updated_connection;
end;
$$;

create table public.company_social_publications (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  connection_id uuid not null references public.company_social_connections(id) on delete restrict,
  job_id uuid not null references public.jobs(id) on delete restrict,
  provider text not null,
  channel text not null,
  status text not null,
  idempotency_key uuid not null,
  approved_message text not null,
  message_sha256 bytea not null,
  provider_post_id text,
  attempts smallint not null default 0,
  provider_http_status integer,
  provider_error_code integer,
  provider_error_subcode integer,
  provider_error_category text,
  provider_is_transient boolean,
  last_error_code text,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null,
  published_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint company_social_publications_provider_check
    check (provider = 'meta-facebook-login'),
  constraint company_social_publications_channel_check
    check (channel = 'Facebook'),
  constraint company_social_publications_status_check
    check (status in ('publishing', 'published', 'failed', 'delivery_unknown')),
  constraint company_social_publications_message_check
    check (
      approved_message = btrim(approved_message)
      and char_length(approved_message) between 1 and 5000
      and translate(approved_message, E'\n', '') !~ '[[:cntrl:]]'
      and lower(approved_message) not like '%[private]%'
    ),
  constraint company_social_publications_message_hash_check
    check (octet_length(message_sha256) = 32),
  constraint company_social_publications_attempts_check
    check (attempts between 0 and 1),
  constraint company_social_publications_http_status_check
    check (provider_http_status is null or provider_http_status between 100 and 599),
  constraint company_social_publications_error_code_check
    check (provider_error_code is null or provider_error_code between -2147483648 and 2147483647),
  constraint company_social_publications_error_subcode_check
    check (provider_error_subcode is null or provider_error_subcode between -2147483648 and 2147483647),
  constraint company_social_publications_error_category_check
    check (provider_error_category is null or provider_error_category in (
      'INVALID_TOKEN',
      'MISSING_PERMISSION',
      'PAGE_UNAVAILABLE',
      'RATE_LIMITED',
      'PROVIDER_TEMPORARY_ERROR',
      'PROVIDER_REJECTED',
      'DELIVERY_UNKNOWN',
      'RESPONSE_MISSING_POST_ID'
    )),
  constraint company_social_publications_last_error_code_check
    check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{2,80}$'),
  constraint company_social_publications_provider_post_id_check
    check (provider_post_id is null or (
      char_length(provider_post_id) between 1 and 200
      and provider_post_id !~ '[[:cntrl:]]'
    )),
  constraint company_social_publications_state_shape_check
    check (
      (status = 'publishing'
        and attempts = 0
        and provider_post_id is null
        and published_at is null
        and provider_http_status is null
        and provider_error_code is null
        and provider_error_subcode is null
        and provider_error_category is null
        and provider_is_transient is null
        and last_error_code is null)
      or (status = 'published'
        and attempts = 1
        and provider_post_id is not null
        and published_at is not null
        and provider_http_status is null
        and provider_error_code is null
        and provider_error_subcode is null
        and provider_error_category is null
        and provider_is_transient is null
        and last_error_code is null)
      or (status = 'failed'
        and attempts = 1
        and provider_post_id is null
        and published_at is null
        and provider_error_category is not null
        and last_error_code is not null)
      or (status = 'delivery_unknown'
        and attempts = 1
        and provider_post_id is null
        and published_at is null
        and provider_error_category = 'DELIVERY_UNKNOWN'
        and last_error_code = 'META_PUBLICATION_DELIVERY_UNKNOWN')
    )
);

create unique index company_social_publications_company_idempotency_unique
  on public.company_social_publications (company_id, idempotency_key);

create index company_social_publications_company_created_idx
  on public.company_social_publications (company_id, created_at desc);

alter table public.company_social_publications enable row level security;
revoke all on public.company_social_publications from public, anon, authenticated;
grant select, insert, update on public.company_social_publications to service_role;

create or replace function public.begin_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_job_id uuid,
  p_idempotency_key uuid,
  p_approved_message text,
  p_message_sha256 bytea,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_timestamp timestamptz
)
returns table (
  publication_id uuid,
  publication_status text,
  publication_approved_at timestamptz,
  publication_published_at timestamptz,
  publication_last_error_code text,
  publication_provider_http_status integer,
  publication_provider_error_code integer,
  publication_provider_error_subcode integer,
  publication_provider_error_category text,
  publication_provider_is_transient boolean,
  should_publish boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_publication public.company_social_publications%rowtype;
  selected_connection public.company_social_connections%rowtype;
  created_publication public.company_social_publications%rowtype;
begin
  if p_approved_message is null
    or p_approved_message <> btrim(p_approved_message)
    or char_length(p_approved_message) not between 1 and 5000
    or translate(p_approved_message, E'\n', '') ~ '[[:cntrl:]]'
    or lower(p_approved_message) like '%[private]%'
    or octet_length(p_message_sha256) <> 32
    or p_message_sha256 <> sha256(convert_to(p_approved_message, 'UTF8'))
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80 then
    raise exception 'invalid publication request';
  end if;

  perform 1 from public.companies where id = p_company_id for update;
  if not found then raise exception 'company not found'; end if;

  select * into existing_publication
  from public.company_social_publications
  where company_id = p_company_id and idempotency_key = p_idempotency_key;

  if found then
    if existing_publication.connection_id <> p_connection_id
      or existing_publication.job_id <> p_job_id
      or existing_publication.approved_by <> p_actor_id
      or existing_publication.approved_message <> p_approved_message
      or existing_publication.message_sha256 <> p_message_sha256 then
      raise exception 'idempotency payload mismatch';
    end if;
    return query select
      existing_publication.id,
      existing_publication.status,
      existing_publication.approved_at,
      existing_publication.published_at,
      existing_publication.last_error_code,
      existing_publication.provider_http_status,
      existing_publication.provider_error_code,
      existing_publication.provider_error_subcode,
      existing_publication.provider_error_category,
      existing_publication.provider_is_transient,
      false;
    return;
  end if;

  perform 1 from public.jobs
  where id = p_job_id
    and company_id = p_company_id
    and status::text in ('Completed', 'Warranty')
  for update;
  if not found then raise exception 'invalid publication job'; end if;

  select * into selected_connection
  from public.company_social_connections
  where id = p_connection_id
    and company_id = p_company_id
    and provider = 'meta-facebook-login'
  for update;

  if not found
    or selected_connection.status <> 'connected'
    or selected_connection.facebook_page_id is null
    or selected_connection.facebook_page_name is null
    or selected_connection.token_envelope is null
    or not ('pages_manage_posts' = any(selected_connection.granted_scopes)) then
    raise exception 'facebook publishing unavailable';
  end if;

  insert into public.company_social_publications (
    id, company_id, connection_id, job_id, provider, channel, status,
    idempotency_key, approved_message, message_sha256, approved_by,
    approved_at, created_at, updated_at
  ) values (
    p_publication_id, p_company_id, p_connection_id, p_job_id,
    'meta-facebook-login', 'Facebook', 'publishing', p_idempotency_key,
    p_approved_message, p_message_sha256, p_actor_id,
    p_timestamp, p_timestamp, p_timestamp
  )
  returning * into created_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_started', 'meta_social_publication', 'Facebook publication',
    created_publication.id::text, 'Facebook publication',
    'Meta publication lifecycle action completed.',
    jsonb_build_object(
      'channel', 'Facebook',
      'status', 'publishing',
      'messageCharacterCount', char_length(p_approved_message),
      'attempts', 0
    )
  );

  return query select
    created_publication.id,
    created_publication.status,
    created_publication.approved_at,
    created_publication.published_at,
    created_publication.last_error_code,
    created_publication.provider_http_status,
    created_publication.provider_error_code,
    created_publication.provider_error_subcode,
    created_publication.provider_error_category,
    created_publication.provider_is_transient,
    true;
end;
$$;

create or replace function public.complete_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider_post_id text,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
begin
  if p_provider_post_id is null
    or char_length(btrim(p_provider_post_id)) not between 1 and 200
    or p_provider_post_id ~ '[[:cntrl:]]'
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80 then
    raise exception 'invalid provider post id';
  end if;

  select * into locked_publication
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id
  for update;
  if not found or locked_publication.status <> 'publishing' then
    raise exception 'invalid publication transition';
  end if;

  update public.company_social_publications
  set status = 'published', provider_post_id = btrim(p_provider_post_id), attempts = 1,
      provider_http_status = null, provider_error_code = null,
      provider_error_subcode = null, provider_error_category = null,
      provider_is_transient = null, last_error_code = null,
      published_at = p_timestamp, updated_at = p_timestamp
  where id = locked_publication.id
  returning * into updated_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_published', 'meta_social_publication', 'Facebook publication',
    updated_publication.id::text, 'Facebook publication',
    'Meta publication lifecycle action completed.',
    jsonb_build_object(
      'channel', 'Facebook', 'status', 'published',
      'messageCharacterCount', char_length(updated_publication.approved_message),
      'attempts', 1
    )
  );
  return next updated_publication;
end;
$$;

create or replace function public.fail_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider_http_status integer,
  p_provider_error_code integer,
  p_provider_error_subcode integer,
  p_provider_error_category text,
  p_provider_is_transient boolean,
  p_last_error_code text,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
begin
  if p_provider_error_category not in (
      'INVALID_TOKEN', 'MISSING_PERMISSION', 'PAGE_UNAVAILABLE', 'RATE_LIMITED',
      'PROVIDER_TEMPORARY_ERROR', 'PROVIDER_REJECTED', 'RESPONSE_MISSING_POST_ID'
    )
    or p_last_error_code is null
    or p_last_error_code !~ '^[A-Z0-9_]{2,80}$'
    or (p_provider_http_status is not null and p_provider_http_status not between 100 and 599)
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80 then
    raise exception 'invalid publication failure';
  end if;

  select * into locked_publication
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id
  for update;
  if not found or locked_publication.status <> 'publishing' then
    raise exception 'invalid publication transition';
  end if;

  update public.company_social_publications
  set status = 'failed', attempts = 1, provider_post_id = null,
      provider_http_status = p_provider_http_status,
      provider_error_code = p_provider_error_code,
      provider_error_subcode = p_provider_error_subcode,
      provider_error_category = p_provider_error_category,
      provider_is_transient = p_provider_is_transient,
      last_error_code = p_last_error_code,
      published_at = null, updated_at = p_timestamp
  where id = locked_publication.id
  returning * into updated_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_failed', 'meta_social_publication', 'Facebook publication',
    updated_publication.id::text, 'Facebook publication',
    'Meta publication lifecycle action completed.',
    jsonb_build_object(
      'channel', 'Facebook', 'status', 'failed',
      'messageCharacterCount', char_length(updated_publication.approved_message),
      'attempts', 1
    )
  );
  return next updated_publication;
end;
$$;

create or replace function public.mark_company_facebook_publication_unknown(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
begin
  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80 then
    raise exception 'invalid publication actor';
  end if;

  select * into locked_publication
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id
  for update;
  if not found or locked_publication.status <> 'publishing' then
    raise exception 'invalid publication transition';
  end if;

  update public.company_social_publications
  set status = 'delivery_unknown', attempts = 1, provider_post_id = null,
      provider_http_status = null, provider_error_code = null,
      provider_error_subcode = null, provider_error_category = 'DELIVERY_UNKNOWN',
      provider_is_transient = null,
      last_error_code = 'META_PUBLICATION_DELIVERY_UNKNOWN',
      published_at = null, updated_at = p_timestamp
  where id = locked_publication.id
  returning * into updated_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_delivery_unknown', 'meta_social_publication', 'Facebook publication',
    updated_publication.id::text, 'Facebook publication',
    'Meta publication lifecycle action completed.',
    jsonb_build_object(
      'channel', 'Facebook', 'status', 'delivery_unknown',
      'messageCharacterCount', char_length(updated_publication.approved_message),
      'attempts', 1
    )
  );
  return next updated_publication;
end;
$$;

revoke all on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, timestamptz) from public, anon, authenticated;

grant execute on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, uuid, text, text, timestamptz) to service_role;
grant execute on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, timestamptz) to service_role;
grant execute on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, timestamptz) to service_role;

comment on table public.company_social_publications is
  'Server-only Facebook Page text publication history. Browser roles have no direct access.';
comment on column public.company_social_publications.approved_message is
  'Exact human-approved normalized text. Never expose through status or telemetry.';
comment on column public.company_social_publications.provider_post_id is
  'Server-only Meta post identifier. Never return to browser clients.';
comment on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, uuid, text, text, timestamptz) is
  'Validates and begins one idempotent Facebook Page text publication with an atomic safe audit.';
comment on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, timestamptz) is
  'Marks an exact publishing row published and writes its safe audit atomically.';
comment on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, timestamptz) is
  'Marks a definite provider rejection failed using normalized diagnostics and a safe atomic audit.';
comment on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, timestamptz) is
  'Marks an indeterminate provider delivery result without retry and writes its safe audit atomically.';
-- META_FACEBOOK_PUBLISH_SCHEMA_END

-- META_FACEBOOK_PUBLISH_ACL_FIX_BEGIN
revoke all privileges
on table public.company_social_publications
from service_role;

grant select, insert, update
on table public.company_social_publications
to service_role;

revoke all privileges
on table public.company_social_publications
from public, anon, authenticated;
-- META_FACEBOOK_PUBLISH_ACL_FIX_END

-- META_FACEBOOK_SINGLE_PHOTO_PUBLISH_BEGIN
alter table public.company_social_publications
  add column publication_kind text not null default 'text_only',
  add column attachment_id uuid references public.job_attachments(id) on delete restrict,
  add column safe_mime_type text,
  add column provider_media_id text,
  add column media_count smallint not null default 0;

alter table public.company_social_publications
  add constraint company_social_publications_kind_check
  check (publication_kind in ('text_only', 'single_photo')),
  add constraint company_social_publications_media_count_check
  check (
    (publication_kind = 'text_only' and media_count = 0 and attachment_id is null and safe_mime_type is null)
    or (publication_kind = 'single_photo' and media_count = 1 and attachment_id is not null and safe_mime_type in ('image/jpeg', 'image/png', 'image/webp'))
  ),
  add constraint company_social_publications_provider_media_id_check
  check (provider_media_id is null or (
    char_length(provider_media_id) between 1 and 200
    and provider_media_id !~ '[[:cntrl:]]'
  ));

create index company_social_publications_attachment_idx
  on public.company_social_publications (company_id, job_id, attachment_id)
  where attachment_id is not null;

create or replace function public.begin_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_job_id uuid,
  p_idempotency_key uuid,
  p_approved_message text,
  p_message_sha256 bytea,
  p_publication_kind text,
  p_attachment_id uuid,
  p_safe_mime_type text,
  p_media_count smallint,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_timestamp timestamptz
)
returns table (
  publication_id uuid,
  publication_status text,
  publication_approved_at timestamptz,
  publication_published_at timestamptz,
  publication_last_error_code text,
  publication_provider_http_status integer,
  publication_provider_error_code integer,
  publication_provider_error_subcode integer,
  publication_provider_error_category text,
  publication_provider_is_transient boolean,
  should_publish boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_publication public.company_social_publications%rowtype;
  selected_connection public.company_social_connections%rowtype;
  selected_attachment public.job_attachments%rowtype;
  created_publication public.company_social_publications%rowtype;
begin
  if p_approved_message is null
    or p_approved_message <> btrim(p_approved_message)
    or char_length(p_approved_message) not between 1 and 5000
    or translate(p_approved_message, E'\n', '') ~ '[[:cntrl:]]'
    or lower(p_approved_message) like '%[private]%'
    or octet_length(p_message_sha256) <> 32
    or p_message_sha256 <> sha256(convert_to(p_approved_message, 'UTF8'))
    or p_publication_kind not in ('text_only', 'single_photo')
    or (p_publication_kind = 'text_only' and (p_attachment_id is not null or p_safe_mime_type is not null or p_media_count <> 0))
    or (p_publication_kind = 'single_photo' and (p_attachment_id is null or p_safe_mime_type not in ('image/jpeg', 'image/png', 'image/webp') or p_media_count <> 1))
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80 then
    raise exception 'invalid publication request';
  end if;

  perform 1 from public.companies where id = p_company_id for update;
  if not found then raise exception 'company not found'; end if;

  select * into existing_publication
  from public.company_social_publications
  where company_id = p_company_id and idempotency_key = p_idempotency_key;

  if found then
    if existing_publication.connection_id <> p_connection_id
      or existing_publication.job_id <> p_job_id
      or existing_publication.approved_by <> p_actor_id
      or existing_publication.approved_message <> p_approved_message
      or existing_publication.message_sha256 <> p_message_sha256
      or existing_publication.publication_kind <> p_publication_kind
      or existing_publication.attachment_id is distinct from p_attachment_id
      or existing_publication.safe_mime_type is distinct from p_safe_mime_type
      or existing_publication.media_count <> p_media_count then
      raise exception 'idempotency payload mismatch';
    end if;
    return query select
      existing_publication.id,
      existing_publication.status,
      existing_publication.approved_at,
      existing_publication.published_at,
      existing_publication.last_error_code,
      existing_publication.provider_http_status,
      existing_publication.provider_error_code,
      existing_publication.provider_error_subcode,
      existing_publication.provider_error_category,
      existing_publication.provider_is_transient,
      false;
    return;
  end if;

  perform 1 from public.jobs
  where id = p_job_id
    and company_id = p_company_id
    and status::text in ('Completed', 'Warranty')
  for update;
  if not found then raise exception 'invalid publication job'; end if;

  if p_publication_kind = 'single_photo' then
    select * into selected_attachment
    from public.job_attachments
    where id = p_attachment_id
      and company_id = p_company_id
      and job_id = p_job_id
    for key share;
    if not found
      or selected_attachment.kind::text = 'video'
      or lower(selected_attachment.mime_type) <> p_safe_mime_type
      or selected_attachment.size_bytes < 1
      or selected_attachment.size_bytes > 12000000
      or selected_attachment.storage_bucket is null
      or selected_attachment.storage_path is null then
      raise exception 'invalid publication attachment';
    end if;
  end if;

  select * into selected_connection
  from public.company_social_connections
  where id = p_connection_id
    and company_id = p_company_id
    and provider = 'meta-facebook-login'
  for update;

  if not found
    or selected_connection.status <> 'connected'
    or selected_connection.facebook_page_id is null
    or selected_connection.facebook_page_name is null
    or selected_connection.token_envelope is null
    or not ('pages_manage_posts' = any(selected_connection.granted_scopes)) then
    raise exception 'facebook publishing unavailable';
  end if;

  insert into public.company_social_publications (
    id, company_id, connection_id, job_id, provider, channel, status,
    idempotency_key, approved_message, message_sha256, publication_kind,
    attachment_id, safe_mime_type, media_count, approved_by,
    approved_at, created_at, updated_at
  ) values (
    p_publication_id, p_company_id, p_connection_id, p_job_id,
    'meta-facebook-login', 'Facebook', 'publishing', p_idempotency_key,
    p_approved_message, p_message_sha256, p_publication_kind,
    p_attachment_id, p_safe_mime_type, p_media_count, p_actor_id,
    p_timestamp, p_timestamp, p_timestamp
  )
  returning * into created_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_started', 'meta_social_publication', 'Facebook publication',
    created_publication.id::text, 'Facebook publication',
    'Meta publication lifecycle action completed.',
    jsonb_build_object(
      'channel', 'Facebook',
      'status', 'publishing',
      'publicationKind', p_publication_kind,
      'mediaCount', p_media_count,
      'messageCharacterCount', char_length(p_approved_message),
      'attempts', 0
    )
  );

  return query select
    created_publication.id,
    created_publication.status,
    created_publication.approved_at,
    created_publication.published_at,
    created_publication.last_error_code,
    created_publication.provider_http_status,
    created_publication.provider_error_code,
    created_publication.provider_error_subcode,
    created_publication.provider_error_category,
    created_publication.provider_is_transient,
    true;
end;
$$;

create or replace function public.complete_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider_post_id text,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
begin
  if p_provider_post_id is null
    or char_length(btrim(p_provider_post_id)) not between 1 and 200
    or p_provider_post_id ~ '[[:cntrl:]]'
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80 then
    raise exception 'invalid provider post id';
  end if;

  select * into locked_publication
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id
  for update;
  if not found or locked_publication.status <> 'publishing' then
    raise exception 'invalid publication transition';
  end if;

  update public.company_social_publications
  set status = 'published',
      provider_post_id = btrim(p_provider_post_id),
      provider_media_id = case when locked_publication.publication_kind = 'single_photo' then btrim(p_provider_post_id) else null end,
      attempts = 1,
      provider_http_status = null, provider_error_code = null,
      provider_error_subcode = null, provider_error_category = null,
      provider_is_transient = null, last_error_code = null,
      published_at = p_timestamp, updated_at = p_timestamp
  where id = locked_publication.id
  returning * into updated_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_published', 'meta_social_publication', 'Facebook publication',
    updated_publication.id::text, 'Facebook publication',
    'Meta publication lifecycle action completed.',
    jsonb_build_object(
      'channel', 'Facebook', 'status', 'published',
      'publicationKind', updated_publication.publication_kind,
      'mediaCount', updated_publication.media_count,
      'messageCharacterCount', char_length(updated_publication.approved_message),
      'attempts', 1
    )
  );
  return next updated_publication;
end;
$$;

revoke all on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, text, uuid, text, smallint, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, text, uuid, text, smallint, uuid, text, text, timestamptz) to service_role;

comment on column public.company_social_publications.publication_kind is
  'Server-only publication kind: text_only or single_photo.';
comment on column public.company_social_publications.attachment_id is
  'Server-only bounded job attachment reference for single-photo publications.';
comment on column public.company_social_publications.safe_mime_type is
  'Server-validated MIME type used for single-photo publication.';
comment on column public.company_social_publications.provider_media_id is
  'Server-only Meta photo identifier. Never return to browser clients.';
comment on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, text, uuid, text, smallint, uuid, text, text, timestamptz) is
  'Validates and begins one idempotent Facebook Page publication, including optional single-photo metadata, with an atomic safe audit.';
-- META_FACEBOOK_SINGLE_PHOTO_PUBLISH_END

-- META_FACEBOOK_SINGLE_PHOTO_PUBLISH_CORRECTIVE_BEGIN
alter table public.company_social_publications
  add column if not exists publication_intent_sha256 bytea;

update public.company_social_publications
set publication_intent_sha256 = sha256(convert_to(concat_ws(E'\n',
  'facebook_publication_intent_v1',
  'meta-facebook-login',
  'Facebook',
  company_id::text,
  job_id::text,
  connection_id::text,
  approved_by::text,
  coalesce(publication_kind, 'text_only'),
  approved_message,
  case when coalesce(publication_kind, 'text_only') = 'single_photo' then attachment_id::text else '' end
), 'UTF8'))
where publication_intent_sha256 is null;

alter table public.company_social_publications
  alter column publication_intent_sha256 set not null,
  add constraint company_social_publications_intent_sha256_check
    check (octet_length(publication_intent_sha256) = 32);

create unique index if not exists company_social_publications_company_intent_unique
  on public.company_social_publications (company_id, publication_intent_sha256);

alter table public.company_social_publications
  drop constraint if exists company_social_publications_media_count_check,
  add constraint company_social_publications_media_count_check
  check (
    (publication_kind = 'text_only' and media_count = 0 and attachment_id is null and safe_mime_type is null)
    or (publication_kind = 'single_photo' and media_count = 1 and attachment_id is not null and safe_mime_type in ('image/jpeg', 'image/png'))
  );

create table if not exists public.company_social_publication_media_approvals (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  attachment_id uuid not null references public.job_attachments(id) on delete restrict,
  analysis_run_id uuid,
  approval_status text not null,
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null,
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  approval_reason text,
  attachment_sha256 bytea not null,
  attachment_mime_type text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_social_publication_media_approvals_status_check
    check (approval_status in ('approved', 'revoked')),
  constraint company_social_publication_media_approvals_sha256_check
    check (octet_length(attachment_sha256) = 32),
  constraint company_social_publication_media_approvals_mime_check
    check (attachment_mime_type in ('image/jpeg', 'image/png')),
  constraint company_social_publication_media_approvals_reason_check
    check (approval_reason is null or (char_length(approval_reason) <= 240 and approval_reason !~ '[[:cntrl:]<>]')),
  constraint company_social_publication_media_approvals_revocation_check
    check ((approval_status = 'approved' and revoked_by is null and revoked_at is null) or (approval_status = 'revoked' and revoked_by is not null and revoked_at is not null))
);

alter table public.company_social_publication_media_approvals enable row level security;
revoke all on public.company_social_publication_media_approvals from public, anon, authenticated;
grant select, insert, update on public.company_social_publication_media_approvals to service_role;

create unique index if not exists company_social_publication_media_approvals_current_unique
  on public.company_social_publication_media_approvals (company_id, job_id, attachment_id, attachment_sha256)
  where approval_status = 'approved' and revoked_at is null;

drop function if exists public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, uuid, text, text, timestamptz);
drop function if exists public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, text, uuid, text, smallint, uuid, text, text, timestamptz);
drop function if exists public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, timestamptz);
drop function if exists public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, timestamptz);

create or replace function public.approve_company_facebook_publication_photo(
  p_approval_id uuid,
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_attachment_sha256 bytea,
  p_attachment_mime_type text,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_approval_reason text,
  p_timestamp timestamptz
)
returns setof public.company_social_publication_media_approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_attachment public.job_attachments%rowtype;
  approved_row public.company_social_publication_media_approvals%rowtype;
begin
  if octet_length(p_attachment_sha256) <> 32
    or p_attachment_mime_type not in ('image/jpeg', 'image/png')
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or (p_approval_reason is not null and (char_length(p_approval_reason) > 240 or p_approval_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid media approval request';
  end if;

  perform 1 from public.jobs where id = p_job_id and company_id = p_company_id and status::text in ('Completed', 'Warranty') for update;
  if not found then raise exception 'invalid approval job'; end if;

  select * into selected_attachment
  from public.job_attachments
  where id = p_attachment_id and company_id = p_company_id and job_id = p_job_id
  for key share;
  if not found
    or selected_attachment.kind::text = 'video'
    or lower(selected_attachment.mime_type) <> p_attachment_mime_type
    or selected_attachment.size_bytes < 1
    or selected_attachment.size_bytes > 12000000
    or selected_attachment.storage_bucket is null
    or selected_attachment.storage_path is null then
    raise exception 'invalid approval attachment';
  end if;

  update public.company_social_publication_media_approvals
  set approval_status = 'revoked',
      revoked_by = p_actor_id,
      revoked_at = p_timestamp,
      updated_at = p_timestamp
  where company_id = p_company_id
    and job_id = p_job_id
    and attachment_id = p_attachment_id
    and approval_status = 'approved'
    and revoked_at is null
    and attachment_sha256 <> p_attachment_sha256;

  insert into public.company_social_publication_media_approvals (
    id, company_id, job_id, attachment_id, approval_status, approved_by, approved_at,
    approval_reason, attachment_sha256, attachment_mime_type, created_at, updated_at
  ) values (
    p_approval_id, p_company_id, p_job_id, p_attachment_id, 'approved', p_actor_id, p_timestamp,
    p_approval_reason, p_attachment_sha256, p_attachment_mime_type, p_timestamp, p_timestamp
  )
  on conflict (company_id, job_id, attachment_id, attachment_sha256)
  where approval_status = 'approved' and revoked_at is null
  do update set approved_by = excluded.approved_by,
                approved_at = excluded.approved_at,
                approval_reason = excluded.approval_reason,
                updated_at = excluded.updated_at
  returning * into approved_row;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_approved', 'job_attachment', 'Facebook publication media approval',
    p_attachment_id::text, 'Facebook photo approval',
    'Meta publication media approval completed.',
    jsonb_build_object('channel', 'Facebook', 'publicationKind', 'single_photo', 'mediaCount', 1)
  );
  return next approved_row;
end;
$$;

create or replace function public.begin_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_job_id uuid,
  p_idempotency_key uuid,
  p_approved_message text,
  p_message_sha256 bytea,
  p_publication_intent_sha256 bytea,
  p_publication_kind text,
  p_attachment_id uuid,
  p_safe_mime_type text,
  p_media_count smallint,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_timestamp timestamptz
)
returns table (
  publication_id uuid,
  publication_status text,
  publication_approved_at timestamptz,
  publication_published_at timestamptz,
  publication_last_error_code text,
  publication_provider_http_status integer,
  publication_provider_error_code integer,
  publication_provider_error_subcode integer,
  publication_provider_error_category text,
  publication_provider_is_transient boolean,
  should_publish boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_publication public.company_social_publications%rowtype;
  selected_connection public.company_social_connections%rowtype;
  selected_attachment public.job_attachments%rowtype;
  created_publication public.company_social_publications%rowtype;
  expected_intent bytea;
begin
  expected_intent := sha256(convert_to(concat_ws(E'\n',
    'facebook_publication_intent_v1', 'meta-facebook-login', 'Facebook',
    p_company_id::text, p_job_id::text, p_connection_id::text, p_actor_id::text,
    p_publication_kind, p_approved_message,
    case when p_publication_kind = 'single_photo' then p_attachment_id::text else '' end
  ), 'UTF8'));

  if p_approved_message is null
    or p_approved_message <> btrim(p_approved_message)
    or char_length(p_approved_message) not between 1 and 5000
    or translate(p_approved_message, E'\n', '') ~ '[[:cntrl:]]'
    or lower(p_approved_message) like '%[private]%'
    or octet_length(p_message_sha256) <> 32
    or p_message_sha256 <> sha256(convert_to(p_approved_message, 'UTF8'))
    or octet_length(p_publication_intent_sha256) <> 32
    or p_publication_intent_sha256 <> expected_intent
    or p_publication_kind not in ('text_only', 'single_photo')
    or (p_publication_kind = 'text_only' and (p_attachment_id is not null or p_safe_mime_type is not null or p_media_count <> 0))
    or (p_publication_kind = 'single_photo' and (p_attachment_id is null or p_safe_mime_type not in ('image/jpeg', 'image/png') or p_media_count <> 1))
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80 then
    raise exception 'invalid publication request';
  end if;

  perform 1 from public.companies where id = p_company_id for update;
  if not found then raise exception 'company not found'; end if;

  select * into existing_publication
  from public.company_social_publications
  where company_id = p_company_id and publication_intent_sha256 = p_publication_intent_sha256;

  if found then
    return query select
      existing_publication.id, existing_publication.status, existing_publication.approved_at,
      existing_publication.published_at, existing_publication.last_error_code,
      existing_publication.provider_http_status, existing_publication.provider_error_code,
      existing_publication.provider_error_subcode, existing_publication.provider_error_category,
      existing_publication.provider_is_transient, false;
    return;
  end if;

  perform 1 from public.jobs where id = p_job_id and company_id = p_company_id and status::text in ('Completed', 'Warranty') for update;
  if not found then raise exception 'invalid publication job'; end if;

  if p_publication_kind = 'single_photo' then
    select * into selected_attachment
    from public.job_attachments
    where id = p_attachment_id and company_id = p_company_id and job_id = p_job_id
    for key share;
    if not found
      or selected_attachment.kind::text = 'video'
      or lower(selected_attachment.mime_type) <> p_safe_mime_type
      or selected_attachment.size_bytes < 1
      or selected_attachment.size_bytes > 12000000
      or selected_attachment.storage_bucket is null
      or selected_attachment.storage_path is null then
      raise exception 'invalid publication attachment';
    end if;
  end if;

  select * into selected_connection
  from public.company_social_connections
  where id = p_connection_id and company_id = p_company_id and provider = 'meta-facebook-login'
  for update;
  if not found
    or selected_connection.status <> 'connected'
    or selected_connection.facebook_page_id is null
    or selected_connection.facebook_page_name is null
    or selected_connection.token_envelope is null
    or not ('pages_manage_posts' = any(selected_connection.granted_scopes)) then
    raise exception 'facebook publishing unavailable';
  end if;

  insert into public.company_social_publications (
    id, company_id, connection_id, job_id, provider, channel, status,
    idempotency_key, publication_intent_sha256, approved_message, message_sha256,
    publication_kind, attachment_id, safe_mime_type, media_count, approved_by,
    approved_at, created_at, updated_at
  ) values (
    p_publication_id, p_company_id, p_connection_id, p_job_id, 'meta-facebook-login', 'Facebook', 'publishing',
    p_idempotency_key, p_publication_intent_sha256, p_approved_message, p_message_sha256,
    p_publication_kind, p_attachment_id, p_safe_mime_type, p_media_count, p_actor_id,
    p_timestamp, p_timestamp, p_timestamp
  )
  returning * into created_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_started', 'meta_social_publication', 'Facebook publication',
    created_publication.id::text, 'Facebook publication',
    'Meta publication lifecycle action completed.',
    jsonb_build_object(
      'channel', 'Facebook', 'status', 'publishing', 'publicationKind', p_publication_kind,
      'mediaCount', p_media_count, 'messageCharacterCount', char_length(p_approved_message),
      'attachmentId', case when p_publication_kind = 'single_photo' then p_attachment_id::text else null end,
      'intentHashPrefix', encode(substring(p_publication_intent_sha256 from 1 for 8), 'hex'),
      'requestCorrelationId', p_idempotency_key::text, 'attempts', 0
    )
  );

  return query select
    created_publication.id, created_publication.status, created_publication.approved_at,
    created_publication.published_at, created_publication.last_error_code,
    created_publication.provider_http_status, created_publication.provider_error_code,
    created_publication.provider_error_subcode, created_publication.provider_error_category,
    created_publication.provider_is_transient, true;
end;
$$;

create or replace function public.complete_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider_post_id text,
  p_provider_media_id text,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
begin
  select * into locked_publication
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id
  for update;
  if not found or locked_publication.status <> 'publishing' then
    raise exception 'invalid publication transition';
  end if;

  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or (locked_publication.publication_kind = 'text_only' and (
      p_provider_post_id is null or char_length(btrim(p_provider_post_id)) not between 1 and 200 or p_provider_post_id ~ '[[:cntrl:]]' or p_provider_media_id is not null
    ))
    or (locked_publication.publication_kind = 'single_photo' and (
      p_provider_post_id is not null or p_provider_media_id is null or char_length(btrim(p_provider_media_id)) not between 1 and 200 or p_provider_media_id ~ '[[:cntrl:]]'
    )) then
    raise exception 'invalid provider ids';
  end if;

  update public.company_social_publications
  set status = 'published',
      provider_post_id = case when locked_publication.publication_kind = 'text_only' then btrim(p_provider_post_id) else null end,
      provider_media_id = case when locked_publication.publication_kind = 'single_photo' then btrim(p_provider_media_id) else null end,
      attempts = 1,
      provider_http_status = null, provider_error_code = null,
      provider_error_subcode = null, provider_error_category = null,
      provider_is_transient = null, last_error_code = null,
      published_at = p_timestamp, updated_at = p_timestamp
  where id = locked_publication.id
  returning * into updated_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_published', 'meta_social_publication', 'Facebook publication',
    updated_publication.id::text, 'Facebook publication',
    'Meta publication lifecycle action completed.',
    jsonb_build_object(
      'channel', 'Facebook', 'status', 'published', 'publicationKind', updated_publication.publication_kind,
      'mediaCount', updated_publication.media_count,
      'messageCharacterCount', char_length(updated_publication.approved_message),
      'attachmentId', case when updated_publication.publication_kind = 'single_photo' then updated_publication.attachment_id::text else null end,
      'intentHashPrefix', encode(substring(updated_publication.publication_intent_sha256 from 1 for 8), 'hex'),
      'attempts', 1
    )
  );
  return next updated_publication;
end;
$$;

revoke all on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, timestamptz) to service_role;
grant execute on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, timestamptz) to service_role;

comment on column public.company_social_publications.publication_intent_sha256 is
  'Server-derived SHA-256 of the canonical publication intent. Browser UUIDs are correlation only.';
comment on table public.company_social_publication_media_approvals is
  'Server-only durable human approval for exact single-photo publication attachments and checksums.';
-- META_FACEBOOK_SINGLE_PHOTO_PUBLISH_CORRECTIVE_END

-- META_FACEBOOK_SINGLE_PHOTO_PUBLISH_REVIEW_FIX_BEGIN
alter table public.company_social_publications
  drop constraint if exists company_social_publications_state_shape_check,
  drop constraint if exists company_social_publications_error_category_check;

alter table public.company_social_publications
  add constraint company_social_publications_error_category_check
  check (provider_error_category is null or provider_error_category in (
    'INVALID_TOKEN',
    'MISSING_PERMISSION',
    'PAGE_UNAVAILABLE',
    'RATE_LIMITED',
    'PROVIDER_TEMPORARY_ERROR',
    'PROVIDER_REJECTED',
    'DELIVERY_UNKNOWN',
    'RESPONSE_MISSING_POST_ID',
    'RESPONSE_MISSING_MEDIA_ID'
  )),
  add constraint company_social_publications_state_shape_check
  check (
    (status = 'publishing'
      and attempts = 0
      and provider_post_id is null
      and provider_media_id is null
      and published_at is null
      and provider_http_status is null
      and provider_error_code is null
      and provider_error_subcode is null
      and provider_error_category is null
      and provider_is_transient is null
      and last_error_code is null)
    or (status = 'published'
      and attempts = 1
      and published_at is not null
      and provider_http_status is null
      and provider_error_code is null
      and provider_error_subcode is null
      and provider_error_category is null
      and provider_is_transient is null
      and last_error_code is null
      and (
        (publication_kind = 'text_only' and provider_post_id is not null and provider_media_id is null)
        or (publication_kind = 'single_photo' and provider_post_id is null and provider_media_id is not null)
      ))
    or (status = 'failed'
      and attempts = 1
      and provider_post_id is null
      and provider_media_id is null
      and published_at is null
      and provider_error_category is not null
      and last_error_code is not null)
    or (status = 'delivery_unknown'
      and attempts = 1
      and provider_post_id is null
      and provider_media_id is null
      and published_at is null
      and provider_error_category = 'DELIVERY_UNKNOWN'
      and last_error_code = 'META_PUBLICATION_DELIVERY_UNKNOWN')
  );

create table if not exists public.company_media_analysis_runs (
  id uuid primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  correlation_id text not null,
  status text not null,
  provider text not null,
  model text,
  analysis_version text not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_media_analysis_runs_status_check
    check (status in ('completed', 'failed')),
  constraint company_media_analysis_runs_correlation_check
    check (char_length(correlation_id) between 8 and 200 and correlation_id !~ '[[:cntrl:]<>]'),
  constraint company_media_analysis_runs_provider_check
    check (char_length(provider) between 1 and 120 and provider !~ '[[:cntrl:]<>]')
);

create table if not exists public.company_media_analysis_attachment_results (
  id uuid primary key,
  analysis_run_id uuid not null references public.company_media_analysis_runs(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  attachment_id uuid not null references public.job_attachments(id) on delete cascade,
  attachment_sha256 bytea not null,
  detected_mime_type text not null,
  analysis_status text not null,
  privacy_review_status text not null,
  excluded boolean not null default false,
  created_at timestamptz not null default now(),
  constraint company_media_analysis_attachment_sha256_check
    check (octet_length(attachment_sha256) = 32),
  constraint company_media_analysis_attachment_mime_check
    check (detected_mime_type in ('image/jpeg', 'image/png')),
  constraint company_media_analysis_attachment_privacy_check
    check (privacy_review_status in ('passed', 'blocked', 'resolved_false_positive')),
  constraint company_media_analysis_attachment_status_check
    check (analysis_status in ('analyzed', 'metadata_only', 'manual_review'))
);

create index if not exists company_media_analysis_attachment_latest_idx
  on public.company_media_analysis_attachment_results (company_id, job_id, attachment_id, created_at desc);

create table if not exists public.company_media_analysis_privacy_findings (
  id uuid primary key,
  analysis_run_id uuid not null references public.company_media_analysis_runs(id) on delete cascade,
  attachment_result_id uuid not null references public.company_media_analysis_attachment_results(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  attachment_id uuid not null references public.job_attachments(id) on delete cascade,
  finding_id text not null,
  finding_category text not null,
  risk_level text not null,
  resolved_as_false_positive boolean not null default false,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint company_media_analysis_privacy_finding_safe_check
    check (
      finding_id !~ '[[:cntrl:]<>]'
      and finding_category ~ '^[a-z0-9_]{2,80}


      and risk_level in ('low', 'medium', 'high')
    ),
  constraint company_media_analysis_privacy_resolution_check
    check (
      (resolved_as_false_positive = false and resolved_by is null and resolved_at is null)
      or (resolved_as_false_positive = true and resolved_by is not null and resolved_at is not null)
    )
);

alter table public.company_media_analysis_runs enable row level security;
alter table public.company_media_analysis_attachment_results enable row level security;
alter table public.company_media_analysis_privacy_findings enable row level security;
revoke all on public.company_media_analysis_runs from public, anon, authenticated;
revoke all on public.company_media_analysis_attachment_results from public, anon, authenticated;
revoke all on public.company_media_analysis_privacy_findings from public, anon, authenticated;
grant select, insert, update on public.company_media_analysis_runs to service_role;
grant select, insert, update on public.company_media_analysis_attachment_results to service_role;
grant select, insert, update on public.company_media_analysis_privacy_findings to service_role;

alter table public.company_social_publication_media_approvals
  add constraint company_social_publication_media_approvals_analysis_run_fk
    foreign key (analysis_run_id) references public.company_media_analysis_runs(id) on delete restrict;

drop function if exists public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz);

create or replace function public.approve_company_facebook_publication_photo(
  p_approval_id uuid,
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_attachment_sha256 bytea,
  p_attachment_mime_type text,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_approval_reason text,
  p_timestamp timestamptz
)
returns setof public.company_social_publication_media_approvals
language plpgsql
security definer
set search_path = ''
as $
declare
  selected_attachment public.job_attachments%rowtype;
  selected_result public.company_media_analysis_attachment_results%rowtype;
  approved_row public.company_social_publication_media_approvals%rowtype;
begin
  if octet_length(p_attachment_sha256) <> 32
    or p_attachment_mime_type not in ('image/jpeg', 'image/png')
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or (p_approval_reason is not null and (char_length(p_approval_reason) > 240 or p_approval_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid media approval request';
  end if;

  perform 1 from public.jobs where id = p_job_id and company_id = p_company_id and status::text in ('Completed', 'Warranty') for update;
  if not found then raise exception 'invalid approval job'; end if;

  select * into selected_attachment
  from public.job_attachments
  where id = p_attachment_id and company_id = p_company_id and job_id = p_job_id
  for key share;
  if not found
    or selected_attachment.kind::text = 'video'
    or lower(selected_attachment.mime_type) <> p_attachment_mime_type
    or selected_attachment.size_bytes < 1
    or selected_attachment.size_bytes > 12000000
    or selected_attachment.storage_bucket is null
    or selected_attachment.storage_path is null then
    raise exception 'invalid approval attachment';
  end if;

  select ar.* into selected_result
  from public.company_media_analysis_attachment_results ar
  join public.company_media_analysis_runs run on run.id = ar.analysis_run_id
  where ar.company_id = p_company_id
    and ar.job_id = p_job_id
    and ar.attachment_id = p_attachment_id
    and ar.attachment_sha256 = p_attachment_sha256
    and ar.detected_mime_type = p_attachment_mime_type
    and ar.excluded = false
    and ar.analysis_status in ('analyzed', 'metadata_only')
    and ar.privacy_review_status in ('passed', 'resolved_false_positive')
    and run.status = 'completed'
    and run.company_id = p_company_id
    and run.job_id = p_job_id
  order by ar.created_at desc
  limit 1;
  if not found then raise exception 'media analysis evidence required'; end if;

  if exists (
    select 1
    from public.company_media_analysis_privacy_findings finding
    where finding.attachment_result_id = selected_result.id
      and finding.resolved_as_false_positive = false
  ) then
    raise exception 'unresolved media privacy finding';
  end if;

  update public.company_social_publication_media_approvals
  set approval_status = 'revoked',
      revoked_by = p_actor_id,
      revoked_at = p_timestamp,
      updated_at = p_timestamp
  where company_id = p_company_id
    and job_id = p_job_id
    and attachment_id = p_attachment_id
    and approval_status = 'approved'
    and revoked_at is null;

  insert into public.company_social_publication_media_approvals (
    id, company_id, job_id, attachment_id, analysis_run_id, approval_status, approved_by, approved_at,
    approval_reason, attachment_sha256, attachment_mime_type, created_at, updated_at
  ) values (
    p_approval_id, p_company_id, p_job_id, p_attachment_id, selected_result.analysis_run_id, 'approved', p_actor_id, p_timestamp,
    p_approval_reason, p_attachment_sha256, p_attachment_mime_type, p_timestamp, p_timestamp
  )
  returning * into approved_row;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_approved', 'job_attachment', 'Facebook publication media approval',
    p_attachment_id::text, 'Facebook photo approval',
    'Meta publication media approval completed.',
    jsonb_build_object(
      'channel', 'Facebook',
      'publicationKind', 'single_photo',
      'mediaCount', 1,
      'attachmentId', p_attachment_id::text,
      'analysisRunId', selected_result.analysis_run_id::text,
      'analysisStatus', selected_result.analysis_status,
      'privacyReviewStatus', selected_result.privacy_review_status,
      'checksumMatch', true,
      'approvalId', approved_row.id::text
    )
  );
  return next approved_row;
end;
$;

create or replace function public.revoke_company_facebook_publication_photo_approval(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_revocation_reason text,
  p_timestamp timestamptz
)
returns setof public.company_social_publication_media_approvals
language plpgsql
security definer
set search_path = ''
as $
declare
  updated_approval public.company_social_publication_media_approvals%rowtype;
begin
  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or (p_revocation_reason is not null and (char_length(p_revocation_reason) > 240 or p_revocation_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid media approval revocation request';
  end if;

  perform 1 from public.job_attachments
  where id = p_attachment_id and company_id = p_company_id and job_id = p_job_id
  for key share;
  if not found then raise exception 'invalid approval attachment'; end if;

  update public.company_social_publication_media_approvals
  set approval_status = 'revoked',
      revoked_by = p_actor_id,
      revoked_at = p_timestamp,
      updated_at = p_timestamp,
      approval_reason = coalesce(p_revocation_reason, approval_reason)
  where id = (
    select id
    from public.company_social_publication_media_approvals
    where company_id = p_company_id
      and job_id = p_job_id
      and attachment_id = p_attachment_id
      and approval_status = 'approved'
      and revoked_at is null
    order by approved_at desc
    limit 1
  )
  returning * into updated_approval;
  if not found then raise exception 'active approval not found'; end if;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_approval_revoked', 'job_attachment', 'Facebook publication media approval',
    p_attachment_id::text, 'Facebook photo approval',
    'Meta publication media approval revoked.',
    jsonb_build_object(
      'channel', 'Facebook',
      'publicationKind', 'single_photo',
      'attachmentId', p_attachment_id::text,
      'analysisRunId', updated_approval.analysis_run_id::text,
      'approvalId', updated_approval.id::text,
      'revokedAt', p_timestamp
    )
  );
  return next updated_approval;
end;
$;

drop function if exists public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, timestamptz);
drop function if exists public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz);

create or replace function public.complete_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider_post_id text,
  p_provider_media_id text,
  p_publication_audit_metadata jsonb,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $
declare
  locked_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
  safe_metadata jsonb := coalesce(p_publication_audit_metadata, '{}'::jsonb);
begin
  select * into locked_publication
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id
  for update;
  if not found or locked_publication.status <> 'publishing' then
    raise exception 'invalid publication transition';
  end if;

  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or jsonb_typeof(safe_metadata) <> 'object'
    or safe_metadata::text ~* '(token|secret|signed|storage|private@example|coordinates|latitude|longitude)'
    or (locked_publication.publication_kind = 'single_photo' and not (
      safe_metadata ?& array[
        'analysisRunId', 'approvalId', 'approvedAt', 'revoked',
        'originalMime', 'detectedMime', 'sanitizedMime',
        'originalByteSize', 'sanitizedByteSize',
        'originalHashPrefix', 'sanitizedHashPrefix',
        'width', 'height', 'metadataStripped', 'gpsStripped',
        'sanitizer', 'sanitizerVersion', 'providerCallCount'
      ]
    ))
    or (locked_publication.publication_kind = 'text_only' and (
      p_provider_post_id is null or char_length(btrim(p_provider_post_id)) not between 1 and 200 or p_provider_post_id ~ '[[:cntrl:]]' or p_provider_media_id is not null
    ))
    or (locked_publication.publication_kind = 'single_photo' and (
      p_provider_post_id is not null or p_provider_media_id is null or char_length(btrim(p_provider_media_id)) not between 1 and 200 or p_provider_media_id ~ '[[:cntrl:]]'
    )) then
    raise exception 'invalid provider ids';
  end if;

  update public.company_social_publications
  set status = 'published',
      provider_post_id = case when locked_publication.publication_kind = 'text_only' then btrim(p_provider_post_id) else null end,
      provider_media_id = case when locked_publication.publication_kind = 'single_photo' then btrim(p_provider_media_id) else null end,
      attempts = 1,
      provider_http_status = null, provider_error_code = null,
      provider_error_subcode = null, provider_error_category = null,
      provider_is_transient = null, last_error_code = null,
      published_at = p_timestamp, updated_at = p_timestamp
  where id = locked_publication.id
  returning * into updated_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_published', 'meta_social_publication', 'Facebook publication',
    updated_publication.id::text, 'Facebook publication',
    'Meta publication lifecycle action completed.',
    jsonb_build_object(
      'channel', 'Facebook', 'status', 'published',
      'publicationKind', updated_publication.publication_kind,
      'mediaCount', updated_publication.media_count,
      'messageCharacterCount', char_length(updated_publication.approved_message),
      'attachmentId', case when updated_publication.publication_kind = 'single_photo' then updated_publication.attachment_id::text else null end,
      'providerCallCount', 1,
      'providerMediaId', case when updated_publication.publication_kind = 'single_photo' then updated_publication.provider_media_id else null end,
      'providerPostId', case when updated_publication.publication_kind = 'text_only' then updated_publication.provider_post_id else null end,
      'singlePhotoProviderPostIdNull', updated_publication.publication_kind = 'single_photo' and updated_publication.provider_post_id is null,
      'intentHashPrefix', encode(substring(updated_publication.publication_intent_sha256 from 1 for 8), 'hex'),
      'attempts', 1
    ) || safe_metadata
  );
  return next updated_publication;
end;
$;

create or replace function public.fail_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider_http_status integer,
  p_provider_error_code integer,
  p_provider_error_subcode integer,
  p_provider_error_category text,
  p_provider_is_transient boolean,
  p_last_error_code text,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $
declare
  locked_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
begin
  if p_provider_error_category not in (
      'INVALID_TOKEN', 'MISSING_PERMISSION', 'PAGE_UNAVAILABLE', 'RATE_LIMITED',
      'PROVIDER_TEMPORARY_ERROR', 'PROVIDER_REJECTED', 'RESPONSE_MISSING_POST_ID',
      'RESPONSE_MISSING_MEDIA_ID'
    )
    or p_last_error_code is null
    or p_last_error_code !~ '^[A-Z0-9_]{2,80}


    or (p_provider_http_status is not null and p_provider_http_status not between 100 and 599)
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80 then
    raise exception 'invalid publication failure';
  end if;

  select * into locked_publication
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id
  for update;
  if not found or locked_publication.status <> 'publishing' then
    raise exception 'invalid publication transition';
  end if;

  update public.company_social_publications
  set status = 'failed', attempts = 1, provider_post_id = null, provider_media_id = null,
      provider_http_status = p_provider_http_status,
      provider_error_code = p_provider_error_code,
      provider_error_subcode = p_provider_error_subcode,
      provider_error_category = p_provider_error_category,
      provider_is_transient = p_provider_is_transient,
      last_error_code = p_last_error_code,
      published_at = null, updated_at = p_timestamp
  where id = locked_publication.id
  returning * into updated_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_failed', 'meta_social_publication', 'Facebook publication',
    updated_publication.id::text, 'Facebook publication',
    'Meta publication lifecycle action completed.',
    jsonb_build_object(
      'channel', 'Facebook', 'status', 'failed',
      'publicationKind', updated_publication.publication_kind,
      'mediaCount', updated_publication.media_count,
      'providerCallCount', 1,
      'providerCategory', p_provider_error_category,
      'messageCharacterCount', char_length(updated_publication.approved_message),
      'intentHashPrefix', encode(substring(updated_publication.publication_intent_sha256 from 1 for 8), 'hex'),
      'attempts', 1
    )
  );
  return next updated_publication;
end;
$;

revoke all on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.revoke_company_facebook_publication_photo_approval(uuid, uuid, uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, timestamptz) from public, anon, authenticated;
grant execute on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.revoke_company_facebook_publication_photo_approval(uuid, uuid, uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, timestamptz) to service_role;

comment on table public.company_media_analysis_runs is
  'Server-only durable media-analysis run evidence for publication media approval.';
comment on table public.company_media_analysis_attachment_results is
  'Server-only durable media-analysis attachment evidence with exact checksum and privacy review state.';
comment on function public.revoke_company_facebook_publication_photo_approval(uuid, uuid, uuid, uuid, text, text, text, timestamptz) is
  'Revokes the active server-only Facebook publication photo approval for an exact company/job attachment.';
comment on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) is
  'Completes one Facebook publication and writes bounded server-derived publication media audit metadata.';
-- META_FACEBOOK_SINGLE_PHOTO_PUBLISH_REVIEW_FIX_END


-- META_FACEBOOK_SINGLE_PHOTO_REVIEW_CLOSURE_BEGIN

create or replace function public.exclude_company_facebook_publication_photo(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_exclusion_reason text,
  p_timestamp timestamptz
)
returns table (
  attachment_id uuid,
  excluded boolean,
  revoked_approval_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_result public.company_media_analysis_attachment_results%rowtype;
  revoked_id uuid;
begin
  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or (p_exclusion_reason is not null and (char_length(p_exclusion_reason) > 240 or p_exclusion_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid media exclusion request';
  end if;

  perform 1 from public.job_attachments
  where id = p_attachment_id and company_id = p_company_id and job_id = p_job_id
  for key share;
  if not found then raise exception 'invalid media exclusion attachment'; end if;

  select ar.* into selected_result
  from public.company_media_analysis_attachment_results ar
  join public.company_media_analysis_runs run on run.id = ar.analysis_run_id
  where ar.company_id = p_company_id
    and ar.job_id = p_job_id
    and ar.attachment_id = p_attachment_id
    and run.company_id = p_company_id
    and run.job_id = p_job_id
  order by ar.created_at desc
  limit 1
  for update of ar;
  if not found then raise exception 'media analysis evidence required'; end if;

  update public.company_social_publication_media_approvals approval
  set approval_status = 'revoked',
      revoked_by = p_actor_id,
      revoked_at = p_timestamp,
      updated_at = p_timestamp,
      approval_reason = coalesce(p_exclusion_reason, approval.approval_reason)
  where approval.id = (
    select candidate.id
    from public.company_social_publication_media_approvals candidate
    where candidate.company_id = p_company_id
      and candidate.job_id = p_job_id
      and candidate.attachment_id = p_attachment_id
      and candidate.approval_status = 'approved'
      and candidate.revoked_at is null
    order by candidate.approved_at desc
    limit 1
  )
  returning approval.id into revoked_id;

  update public.company_media_analysis_attachment_results
  set excluded = true,
      privacy_review_status = 'blocked'
  where id = selected_result.id;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_excluded', 'job_attachment', 'Facebook publication media exclusion',
    p_attachment_id::text, 'Facebook photo exclusion',
    'Meta publication media excluded from Facebook photo publishing.',
    jsonb_build_object(
      'channel', 'Facebook',
      'publicationKind', 'single_photo',
      'attachmentId', p_attachment_id::text,
      'analysisRunId', selected_result.analysis_run_id::text,
      'revokedApprovalId', case when revoked_id is null then null else revoked_id::text end,
      'excluded', true
    )
  );

  return query select p_attachment_id, true, revoked_id;
end;
$$;

create or replace function public.resolve_company_media_analysis_false_positive(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_finding_ids text[],
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_resolution_reason text,
  p_timestamp timestamptz
)
returns table (
  attachment_id uuid,
  privacy_review_status text,
  resolved_finding_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_result public.company_media_analysis_attachment_results%rowtype;
  resolved_count integer;
  unresolved_count integer;
begin
  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or p_finding_ids is null
    or array_length(p_finding_ids, 1) is null
    or array_length(p_finding_ids, 1) > 50
    or exists (select 1 from unnest(p_finding_ids) value where value is null or char_length(value) not between 1 and 120 or value !~ '^[A-Za-z0-9_.:-]+$')
    or (p_resolution_reason is not null and (char_length(p_resolution_reason) > 240 or p_resolution_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid false positive resolution request';
  end if;

  select ar.* into selected_result
  from public.company_media_analysis_attachment_results ar
  join public.company_media_analysis_runs run on run.id = ar.analysis_run_id
  where ar.company_id = p_company_id
    and ar.job_id = p_job_id
    and ar.attachment_id = p_attachment_id
    and ar.excluded = false
    and run.company_id = p_company_id
    and run.job_id = p_job_id
    and run.status = 'completed'
  order by ar.created_at desc
  limit 1
  for update of ar;
  if not found then raise exception 'media analysis evidence required'; end if;

  update public.company_media_analysis_privacy_findings finding
  set resolved_as_false_positive = true,
      resolved_by = p_actor_id,
      resolved_at = p_timestamp
  where finding.attachment_result_id = selected_result.id
    and finding.company_id = p_company_id
    and finding.job_id = p_job_id
    and finding.attachment_id = p_attachment_id
    and finding.finding_id = any(p_finding_ids)
    and finding.resolved_as_false_positive = false;

  get diagnostics resolved_count = row_count;
  if resolved_count < 1 then raise exception 'privacy finding not found'; end if;

  select count(*)::integer into unresolved_count
  from public.company_media_analysis_privacy_findings finding
  where finding.attachment_result_id = selected_result.id
    and finding.resolved_as_false_positive = false;

  if unresolved_count = 0 then
    update public.company_media_analysis_attachment_results
    set privacy_review_status = 'resolved_false_positive'
    where id = selected_result.id;
    selected_result.privacy_review_status := 'resolved_false_positive';
  end if;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_false_positive_resolved', 'job_attachment', 'Facebook publication media false positive',
    p_attachment_id::text, 'Facebook photo false positive review',
    'Meta publication media privacy findings were resolved as false positives.',
    jsonb_build_object(
      'channel', 'Facebook',
      'publicationKind', 'single_photo',
      'attachmentId', p_attachment_id::text,
      'analysisRunId', selected_result.analysis_run_id::text,
      'resolvedFindingCount', resolved_count,
      'privacyReviewStatus', selected_result.privacy_review_status
    )
  );

  return query select p_attachment_id, selected_result.privacy_review_status, resolved_count;
end;
$$;

create or replace function public.fail_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider_http_status integer,
  p_provider_error_code integer,
  p_provider_error_subcode integer,
  p_provider_error_category text,
  p_provider_is_transient boolean,
  p_last_error_code text,
  p_publication_audit_metadata jsonb,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
  safe_metadata jsonb := coalesce(p_publication_audit_metadata, '{}'::jsonb);
begin
  if p_provider_error_category not in (
      'INVALID_TOKEN', 'MISSING_PERMISSION', 'PAGE_UNAVAILABLE', 'RATE_LIMITED',
      'PROVIDER_TEMPORARY_ERROR', 'PROVIDER_REJECTED', 'RESPONSE_MISSING_POST_ID',
      'RESPONSE_MISSING_MEDIA_ID'
    )
    or p_last_error_code is null
    or p_last_error_code !~ '^[A-Z0-9_]{2,80}$'
    or (p_provider_http_status is not null and p_provider_http_status not between 100 and 599)
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or jsonb_typeof(safe_metadata) <> 'object'
    or safe_metadata::text ~* '(token|secret|signed|storage|private@example|coordinates|latitude|longitude)' then
    raise exception 'invalid publication failure';
  end if;

  select * into locked_publication
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id
  for update;
  if not found or locked_publication.status <> 'publishing' then
    raise exception 'invalid publication transition';
  end if;

  update public.company_social_publications
  set status = 'failed', attempts = 1, provider_post_id = null, provider_media_id = null,
      provider_http_status = p_provider_http_status,
      provider_error_code = p_provider_error_code,
      provider_error_subcode = p_provider_error_subcode,
      provider_error_category = p_provider_error_category,
      provider_is_transient = p_provider_is_transient,
      last_error_code = p_last_error_code,
      published_at = null, updated_at = p_timestamp
  where id = locked_publication.id
  returning * into updated_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_failed', 'meta_social_publication', 'Facebook publication',
    updated_publication.id::text, 'Facebook publication',
    'Meta publication lifecycle action completed.',
    safe_metadata || jsonb_build_object(
      'channel', 'Facebook', 'status', 'failed',
      'publicationKind', updated_publication.publication_kind,
      'mediaCount', updated_publication.media_count,
      'attachmentId', case when updated_publication.publication_kind = 'single_photo' then updated_publication.attachment_id::text else null end,
      'providerCallCount', 1,
      'providerCategory', p_provider_error_category,
      'messageCharacterCount', char_length(updated_publication.approved_message),
      'intentHashPrefix', encode(substring(updated_publication.publication_intent_sha256 from 1 for 8), 'hex'),
      'attempts', 1
    )
  );
  return next updated_publication;
end;
$$;

create or replace function public.mark_company_facebook_publication_unknown(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_publication_audit_metadata jsonb,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
  safe_metadata jsonb := coalesce(p_publication_audit_metadata, '{}'::jsonb);
begin
  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or jsonb_typeof(safe_metadata) <> 'object'
    or safe_metadata::text ~* '(token|secret|signed|storage|private@example|coordinates|latitude|longitude)' then
    raise exception 'invalid publication actor';
  end if;

  select * into locked_publication
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id
  for update;
  if not found or locked_publication.status <> 'publishing' then
    raise exception 'invalid publication transition';
  end if;

  update public.company_social_publications
  set status = 'delivery_unknown', attempts = 1, provider_post_id = null, provider_media_id = null,
      provider_http_status = null, provider_error_code = null,
      provider_error_subcode = null, provider_error_category = 'DELIVERY_UNKNOWN',
      provider_is_transient = null,
      last_error_code = 'META_PUBLICATION_DELIVERY_UNKNOWN',
      published_at = null, updated_at = p_timestamp
  where id = locked_publication.id
  returning * into updated_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_delivery_unknown', 'meta_social_publication', 'Facebook publication',
    updated_publication.id::text, 'Facebook publication',
    'Meta publication lifecycle action completed.',
    safe_metadata || jsonb_build_object(
      'channel', 'Facebook', 'status', 'delivery_unknown',
      'publicationKind', updated_publication.publication_kind,
      'mediaCount', updated_publication.media_count,
      'attachmentId', case when updated_publication.publication_kind = 'single_photo' then updated_publication.attachment_id::text else null end,
      'providerCallCount', 1,
      'deliveryUnknown', true,
      'repeatBlocked', true,
      'reconciliationRequired', true,
      'messageCharacterCount', char_length(updated_publication.approved_message),
      'intentHashPrefix', encode(substring(updated_publication.publication_intent_sha256 from 1 for 8), 'hex'),
      'attempts', 1
    )
  );
  return next updated_publication;
end;
$$;

revoke all on function public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz) to service_role;
grant execute on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, jsonb, timestamptz) to service_role;

comment on function public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, text, text, text, timestamptz) is
  'Durably excludes one analyzed job photo from Facebook publication eligibility and atomically revokes any active approval.';
comment on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) is
  'Durably resolves bounded media privacy finding ids as false positives without granting publication approval.';

-- META_FACEBOOK_SINGLE_PHOTO_REVIEW_CLOSURE_END

-- META_FACEBOOK_SINGLE_PHOTO_LATEST_AUTHORITY_BEGIN

drop function if exists public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, uuid, text, text, timestamptz);
drop function if exists public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, text, uuid, text, smallint, uuid, text, text, timestamptz);
drop function if exists public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, timestamptz);
drop function if exists public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz);
drop function if exists public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, timestamptz);
drop function if exists public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, timestamptz);
drop function if exists public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, timestamptz);
drop function if exists public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, timestamptz);

create or replace function public.approve_company_facebook_publication_photo(
  p_approval_id uuid,
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_attachment_sha256 bytea,
  p_attachment_mime_type text,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_approval_reason text,
  p_timestamp timestamptz
)
returns setof public.company_social_publication_media_approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_attachment public.job_attachments%rowtype;
  selected_result public.company_media_analysis_attachment_results%rowtype;
  selected_run public.company_media_analysis_runs%rowtype;
  approved_row public.company_social_publication_media_approvals%rowtype;
begin
  if octet_length(p_attachment_sha256) <> 32
    or p_attachment_mime_type not in ('image/jpeg', 'image/png')
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or (p_approval_reason is not null and (char_length(p_approval_reason) > 240 or p_approval_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid media approval request';
  end if;

  perform 1 from public.jobs where id = p_job_id and company_id = p_company_id and status::text in ('Completed', 'Warranty') for update;
  if not found then raise exception 'invalid approval job'; end if;

  select * into selected_attachment
  from public.job_attachments
  where id = p_attachment_id and company_id = p_company_id and job_id = p_job_id
  for key share;
  if not found
    or selected_attachment.kind::text = 'video'
    or lower(selected_attachment.mime_type) <> p_attachment_mime_type
    or selected_attachment.size_bytes < 1
    or selected_attachment.size_bytes > 12000000
    or selected_attachment.storage_bucket is null
    or selected_attachment.storage_path is null then
    raise exception 'invalid approval attachment';
  end if;

  select ar.* into selected_result
  from public.company_media_analysis_attachment_results ar
  where ar.company_id = p_company_id
    and ar.job_id = p_job_id
    and ar.attachment_id = p_attachment_id
  order by ar.created_at desc, ar.id desc
  limit 1
  for update;
  if not found then raise exception 'media analysis evidence required'; end if;

  select * into selected_run
  from public.company_media_analysis_runs run
  where run.id = selected_result.analysis_run_id
    and run.company_id = p_company_id
    and run.job_id = p_job_id;
  if not found
    or selected_run.status <> 'completed'
    or selected_result.attachment_sha256 <> p_attachment_sha256
    or selected_result.detected_mime_type <> p_attachment_mime_type
    or selected_result.excluded = true
    or selected_result.analysis_status not in ('analyzed', 'metadata_only')
    or selected_result.privacy_review_status not in ('passed', 'resolved_false_positive') then
    raise exception 'media analysis evidence required';
  end if;

  if exists (
    select 1
    from public.company_media_analysis_privacy_findings finding
    where finding.attachment_result_id = selected_result.id
      and finding.company_id = p_company_id
      and finding.job_id = p_job_id
      and finding.attachment_id = p_attachment_id
      and finding.resolved_as_false_positive = false
  ) then
    raise exception 'unresolved media privacy finding';
  end if;

  update public.company_social_publication_media_approvals approval
  set approval_status = 'revoked',
      revoked_by = p_actor_id,
      revoked_at = p_timestamp,
      updated_at = p_timestamp
  where approval.company_id = p_company_id
    and approval.job_id = p_job_id
    and approval.attachment_id = p_attachment_id
    and approval.approval_status = 'approved'
    and approval.revoked_at is null;

  insert into public.company_social_publication_media_approvals (
    id, company_id, job_id, attachment_id, analysis_run_id, approval_status, approved_by, approved_at,
    approval_reason, attachment_sha256, attachment_mime_type, created_at, updated_at
  ) values (
    p_approval_id, p_company_id, p_job_id, p_attachment_id, selected_result.analysis_run_id, 'approved', p_actor_id, p_timestamp,
    p_approval_reason, p_attachment_sha256, p_attachment_mime_type, p_timestamp, p_timestamp
  )
  returning * into approved_row;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_approved', 'job_attachment', 'Facebook publication media approval',
    p_attachment_id::text, 'Facebook photo approval',
    'Meta publication media approval completed.',
    jsonb_build_object(
      'channel', 'Facebook',
      'publicationKind', 'single_photo',
      'mediaCount', 1,
      'attachmentId', p_attachment_id::text,
      'analysisRunId', selected_result.analysis_run_id::text,
      'analysisStatus', selected_result.analysis_status,
      'privacyReviewStatus', selected_result.privacy_review_status,
      'checksumMatch', true,
      'approvalId', approved_row.id::text,
      'approvalReason', case when p_approval_reason is null then null else btrim(p_approval_reason) end
    )
  );
  return next approved_row;
end;
$$;

create or replace function public.revoke_company_facebook_publication_photo_approval(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_revocation_reason text,
  p_timestamp timestamptz
)
returns setof public.company_social_publication_media_approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_approval public.company_social_publication_media_approvals%rowtype;
begin
  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or (p_revocation_reason is not null and (char_length(p_revocation_reason) > 240 or p_revocation_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid media approval revocation request';
  end if;

  perform 1 from public.job_attachments
  where id = p_attachment_id and company_id = p_company_id and job_id = p_job_id
  for key share;
  if not found then raise exception 'invalid approval attachment'; end if;

  update public.company_social_publication_media_approvals approval
  set approval_status = 'revoked',
      revoked_by = p_actor_id,
      revoked_at = p_timestamp,
      updated_at = p_timestamp,
      approval_reason = coalesce(p_revocation_reason, approval.approval_reason)
  where approval.id = (
    select candidate.id
    from public.company_social_publication_media_approvals candidate
    where candidate.company_id = p_company_id
      and candidate.job_id = p_job_id
      and candidate.attachment_id = p_attachment_id
      and candidate.approval_status = 'approved'
      and candidate.revoked_at is null
    order by candidate.approved_at desc, candidate.id desc
    limit 1
  )
  returning * into updated_approval;
  if not found then raise exception 'active approval not found'; end if;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_approval_revoked', 'job_attachment', 'Facebook publication media approval',
    p_attachment_id::text, 'Facebook photo approval',
    'Meta publication media approval revoked.',
    jsonb_build_object(
      'channel', 'Facebook',
      'publicationKind', 'single_photo',
      'attachmentId', p_attachment_id::text,
      'analysisRunId', updated_approval.analysis_run_id::text,
      'approvalId', updated_approval.id::text,
      'revokedAt', p_timestamp,
      'revocationReason', case when p_revocation_reason is null then null else btrim(p_revocation_reason) end
    )
  );
  return next updated_approval;
end;
$$;

create or replace function public.exclude_company_facebook_publication_photo(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_exclusion_reason text,
  p_timestamp timestamptz
)
returns table (
  attachment_id uuid,
  excluded boolean,
  revoked_approval_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_result public.company_media_analysis_attachment_results%rowtype;
  revoked_id uuid;
begin
  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or (p_exclusion_reason is not null and (char_length(p_exclusion_reason) > 240 or p_exclusion_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid media exclusion request';
  end if;

  perform 1 from public.job_attachments
  where id = p_attachment_id and company_id = p_company_id and job_id = p_job_id
  for key share;
  if not found then raise exception 'invalid media exclusion attachment'; end if;

  select ar.* into selected_result
  from public.company_media_analysis_attachment_results ar
  join public.company_media_analysis_runs run on run.id = ar.analysis_run_id
  where ar.company_id = p_company_id
    and ar.job_id = p_job_id
    and ar.attachment_id = p_attachment_id
    and run.company_id = p_company_id
    and run.job_id = p_job_id
  order by ar.created_at desc, ar.id desc
  limit 1
  for update of ar;
  if not found then raise exception 'media analysis evidence required'; end if;

  update public.company_social_publication_media_approvals approval
  set approval_status = 'revoked',
      revoked_by = p_actor_id,
      revoked_at = p_timestamp,
      updated_at = p_timestamp,
      approval_reason = coalesce(p_exclusion_reason, approval.approval_reason)
  where approval.id = (
    select candidate.id
    from public.company_social_publication_media_approvals candidate
    where candidate.company_id = p_company_id
      and candidate.job_id = p_job_id
      and candidate.attachment_id = p_attachment_id
      and candidate.approval_status = 'approved'
      and candidate.revoked_at is null
    order by candidate.approved_at desc, candidate.id desc
    limit 1
  )
  returning approval.id into revoked_id;

  update public.company_media_analysis_attachment_results
  set excluded = true,
      privacy_review_status = 'blocked'
  where id = selected_result.id;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_excluded', 'job_attachment', 'Facebook publication media exclusion',
    p_attachment_id::text, 'Facebook photo exclusion',
    'Meta publication media excluded from Facebook photo publishing.',
    jsonb_build_object(
      'channel', 'Facebook',
      'publicationKind', 'single_photo',
      'attachmentId', p_attachment_id::text,
      'analysisRunId', selected_result.analysis_run_id::text,
      'revokedApprovalId', case when revoked_id is null then null else revoked_id::text end,
      'excluded', true,
      'exclusionReason', case when p_exclusion_reason is null then null else btrim(p_exclusion_reason) end
    )
  );

  return query select p_attachment_id, true, revoked_id;
end;
$$;

create or replace function public.resolve_company_media_analysis_false_positive(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_finding_ids text[],
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_resolution_reason text,
  p_timestamp timestamptz
)
returns table (
  attachment_id uuid,
  privacy_review_status text,
  resolved_finding_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_result public.company_media_analysis_attachment_results%rowtype;
  resolved_count integer;
  unresolved_count integer;
begin
  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or p_finding_ids is null
    or array_length(p_finding_ids, 1) is null
    or array_length(p_finding_ids, 1) > 50
    or exists (select 1 from unnest(p_finding_ids) value where value is null or char_length(value) not between 1 and 120 or value !~ '^[A-Za-z0-9_.:-]+$')
    or (p_resolution_reason is not null and (char_length(p_resolution_reason) > 240 or p_resolution_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid false positive resolution request';
  end if;

  select ar.* into selected_result
  from public.company_media_analysis_attachment_results ar
  join public.company_media_analysis_runs run on run.id = ar.analysis_run_id
  where ar.company_id = p_company_id
    and ar.job_id = p_job_id
    and ar.attachment_id = p_attachment_id
    and ar.excluded = false
    and run.company_id = p_company_id
    and run.job_id = p_job_id
    and run.status = 'completed'
  order by ar.created_at desc, ar.id desc
  limit 1
  for update of ar;
  if not found then raise exception 'media analysis evidence required'; end if;

  update public.company_media_analysis_privacy_findings finding
  set resolved_as_false_positive = true,
      resolved_by = p_actor_id,
      resolved_at = p_timestamp
  where finding.attachment_result_id = selected_result.id
    and finding.company_id = p_company_id
    and finding.job_id = p_job_id
    and finding.attachment_id = p_attachment_id
    and finding.finding_id = any(p_finding_ids)
    and finding.resolved_as_false_positive = false;

  get diagnostics resolved_count = row_count;
  if resolved_count < 1 then raise exception 'privacy finding not found'; end if;

  select count(*)::integer into unresolved_count
  from public.company_media_analysis_privacy_findings finding
  where finding.attachment_result_id = selected_result.id
    and finding.resolved_as_false_positive = false;

  if unresolved_count = 0 then
    update public.company_media_analysis_attachment_results
    set privacy_review_status = 'resolved_false_positive'
    where id = selected_result.id;
    selected_result.privacy_review_status := 'resolved_false_positive';
  end if;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_false_positive_resolved', 'job_attachment', 'Facebook publication media false positive',
    p_attachment_id::text, 'Facebook photo false positive review',
    'Meta publication media privacy findings were resolved as false positives.',
    jsonb_build_object(
      'channel', 'Facebook',
      'publicationKind', 'single_photo',
      'attachmentId', p_attachment_id::text,
      'analysisRunId', selected_result.analysis_run_id::text,
      'resolvedFindingCount', resolved_count,
      'privacyReviewStatus', selected_result.privacy_review_status,
      'resolutionReason', case when p_resolution_reason is null then null else btrim(p_resolution_reason) end
    )
  );

  return query select p_attachment_id, selected_result.privacy_review_status, resolved_count;
end;
$$;

create or replace function public.begin_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_job_id uuid,
  p_idempotency_key uuid,
  p_approved_message text,
  p_message_sha256 bytea,
  p_publication_intent_sha256 bytea,
  p_publication_kind text,
  p_attachment_id uuid,
  p_safe_mime_type text,
  p_media_count smallint,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_publication_audit_metadata jsonb,
  p_timestamp timestamptz
)
returns table (
  publication_id uuid,
  publication_status text,
  publication_approved_at timestamptz,
  publication_published_at timestamptz,
  publication_last_error_code text,
  publication_provider_http_status integer,
  publication_provider_error_code integer,
  publication_provider_error_subcode integer,
  publication_provider_error_category text,
  publication_provider_is_transient boolean,
  should_publish boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_publication public.company_social_publications%rowtype;
  selected_connection public.company_social_connections%rowtype;
  selected_attachment public.job_attachments%rowtype;
  created_publication public.company_social_publications%rowtype;
  expected_intent bytea;
  safe_metadata jsonb := coalesce(p_publication_audit_metadata, '{}'::jsonb);
begin
  expected_intent := sha256(convert_to(concat_ws(E'\n',
    'facebook_publication_intent_v1', 'meta-facebook-login', 'Facebook',
    p_company_id::text, p_job_id::text, p_connection_id::text, p_actor_id::text,
    p_publication_kind, p_approved_message,
    case when p_publication_kind = 'single_photo' then p_attachment_id::text else '' end
  ), 'UTF8'));

  if p_approved_message is null
    or p_approved_message <> btrim(p_approved_message)
    or char_length(p_approved_message) not between 1 and 5000
    or translate(p_approved_message, E'\n', '') ~ '[[:cntrl:]]'
    or lower(p_approved_message) like '%[private]%'
    or octet_length(p_message_sha256) <> 32
    or p_message_sha256 <> sha256(convert_to(p_approved_message, 'UTF8'))
    or octet_length(p_publication_intent_sha256) <> 32
    or p_publication_intent_sha256 <> expected_intent
    or p_publication_kind not in ('text_only', 'single_photo')
    or (p_publication_kind = 'text_only' and (p_attachment_id is not null or p_safe_mime_type is not null or p_media_count <> 0 or safe_metadata <> '{}'::jsonb))
    or (p_publication_kind = 'single_photo' and (p_attachment_id is null or p_safe_mime_type not in ('image/jpeg', 'image/png') or p_media_count <> 1))
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or jsonb_typeof(safe_metadata) <> 'object'
    or safe_metadata::text ~* '(token|secret|signed|storage|private@example|coordinates|latitude|longitude)'
    or (p_publication_kind = 'single_photo' and not (
      safe_metadata ?& array[
        'analysisRunId', 'approvalId', 'approvedAt', 'revoked',
        'originalMime', 'detectedMime', 'sanitizedMime',
        'originalByteSize', 'sanitizedByteSize',
        'originalHashPrefix', 'sanitizedHashPrefix',
        'width', 'height', 'metadataStripped', 'gpsStripped',
        'sanitizer', 'sanitizerVersion'
      ]
    )) then
    raise exception 'invalid publication request';
  end if;

  perform 1 from public.companies where id = p_company_id for update;
  if not found then raise exception 'company not found'; end if;

  select * into existing_publication
  from public.company_social_publications
  where company_id = p_company_id and publication_intent_sha256 = p_publication_intent_sha256;

  if found then
    return query select
      existing_publication.id, existing_publication.status, existing_publication.approved_at,
      existing_publication.published_at, existing_publication.last_error_code,
      existing_publication.provider_http_status, existing_publication.provider_error_code,
      existing_publication.provider_error_subcode, existing_publication.provider_error_category,
      existing_publication.provider_is_transient, false;
    return;
  end if;

  perform 1 from public.jobs where id = p_job_id and company_id = p_company_id and status::text in ('Completed', 'Warranty') for update;
  if not found then raise exception 'invalid publication job'; end if;

  if p_publication_kind = 'single_photo' then
    select * into selected_attachment
    from public.job_attachments
    where id = p_attachment_id and company_id = p_company_id and job_id = p_job_id
    for key share;
    if not found
      or selected_attachment.kind::text = 'video'
      or lower(selected_attachment.mime_type) <> p_safe_mime_type
      or selected_attachment.size_bytes < 1
      or selected_attachment.size_bytes > 12000000
      or selected_attachment.storage_bucket is null
      or selected_attachment.storage_path is null then
      raise exception 'invalid publication attachment';
    end if;
  end if;

  select * into selected_connection
  from public.company_social_connections
  where id = p_connection_id and company_id = p_company_id and provider = 'meta-facebook-login'
  for update;
  if not found
    or selected_connection.status <> 'connected'
    or selected_connection.facebook_page_id is null
    or selected_connection.facebook_page_name is null
    or selected_connection.token_envelope is null
    or not ('pages_manage_posts' = any(selected_connection.granted_scopes)) then
    raise exception 'facebook publishing unavailable';
  end if;

  insert into public.company_social_publications (
    id, company_id, connection_id, job_id, provider, channel, status,
    idempotency_key, publication_intent_sha256, approved_message, message_sha256,
    publication_kind, attachment_id, safe_mime_type, media_count, approved_by,
    approved_at, created_at, updated_at
  ) values (
    p_publication_id, p_company_id, p_connection_id, p_job_id, 'meta-facebook-login', 'Facebook', 'publishing',
    p_idempotency_key, p_publication_intent_sha256, p_approved_message, p_message_sha256,
    p_publication_kind, p_attachment_id, p_safe_mime_type, p_media_count, p_actor_id,
    p_timestamp, p_timestamp, p_timestamp
  )
  returning * into created_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_started', 'meta_social_publication', 'Facebook publication',
    created_publication.id::text, 'Facebook publication',
    'Meta publication lifecycle action completed.',
    safe_metadata || jsonb_build_object(
      'channel', 'Facebook', 'status', 'publishing', 'publicationKind', p_publication_kind,
      'mediaCount', p_media_count, 'messageCharacterCount', char_length(p_approved_message),
      'attachmentId', case when p_publication_kind = 'single_photo' then p_attachment_id::text else null end,
      'providerCallCount', 0,
      'intentHashPrefix', encode(substring(p_publication_intent_sha256 from 1 for 8), 'hex'),
      'requestCorrelationId', p_idempotency_key::text, 'attempts', 0
    )
  );

  return query select
    created_publication.id, created_publication.status, created_publication.approved_at,
    created_publication.published_at, created_publication.last_error_code,
    created_publication.provider_http_status, created_publication.provider_error_code,
    created_publication.provider_error_subcode, created_publication.provider_error_category,
    created_publication.provider_is_transient, true;
end;
$$;

revoke all on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.revoke_company_facebook_publication_photo_approval(uuid, uuid, uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.revoke_company_facebook_publication_photo_approval(uuid, uuid, uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz) to service_role;
grant execute on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, jsonb, timestamptz) to service_role;

comment on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz) is
  'Begins a Facebook publication with sanitized publication audit metadata; latest single-photo media evidence remains authoritative.';
comment on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) is
  'Approves only the newest durable media analysis result for Facebook single-photo publication.';

-- META_FACEBOOK_SINGLE_PHOTO_LATEST_AUTHORITY_END


-- META_FACEBOOK_SINGLE_PHOTO_EXACT_REVIEW_BEGIN

alter table public.company_social_publication_media_approvals
  add column if not exists revocation_reason text,
  add column if not exists exclusion_reason text;

alter table public.company_social_publication_media_approvals
  drop constraint if exists company_social_publication_media_approvals_reason_details_check;

alter table public.company_social_publication_media_approvals
  add constraint company_social_publication_media_approvals_reason_details_check
    check (
      (revocation_reason is null or (char_length(revocation_reason) <= 240 and revocation_reason !~ '[[:cntrl:]<>]'))
      and (exclusion_reason is null or (char_length(exclusion_reason) <= 240 and exclusion_reason !~ '[[:cntrl:]<>]'))
    );

create or replace function public.meta_facebook_publication_audit_metadata_valid(
  p_publication_kind text,
  p_stage text,
  p_metadata jsonb,
  p_provider_call_count integer
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with metadata as (
    select coalesce(p_metadata, '{}'::jsonb) as value
  ),
  keys as (
    select key
    from metadata, jsonb_object_keys(metadata.value) key
  ),
  bad_value as (
    select 1
    from metadata, jsonb_each(metadata.value) item
    where jsonb_typeof(item.value) in ('array', 'object')
  )
  select case
    when p_publication_kind = 'text_only' then (select value = '{}'::jsonb from metadata)
    when p_publication_kind <> 'single_photo' then false
    else
      p_stage in ('begin', 'complete', 'fail', 'unknown')
      and p_provider_call_count = case when p_stage = 'begin' then 0 else 1 end
      and (select jsonb_typeof(value) = 'object' and length(value::text) <= 4000 from metadata)
      and not exists (select 1 from bad_value)
      and not exists (
        select 1 from keys
        where key <> all(array[
          'attachmentId','analysisRunId','approvalId','approvedAt','revoked',
          'originalMime','detectedMime','sanitizedMime','originalByteSize','sanitizedByteSize',
          'originalHashPrefix','sanitizedHashPrefix','width','height','metadataStripped','gpsStripped',
          'sanitizer','sanitizerVersion','providerCallCount'
        ])
      )
      and (select value ?& array[
        'attachmentId','analysisRunId','approvalId','approvedAt','revoked',
        'originalMime','detectedMime','sanitizedMime','originalByteSize','sanitizedByteSize',
        'originalHashPrefix','sanitizedHashPrefix','width','height','metadataStripped','gpsStripped',
        'sanitizer','sanitizerVersion','providerCallCount'
      ] from metadata)
      and (select value::text !~* '(token|secret|url|https?://|signed|storage|private@example|coordinates|latitude|longitude)' from metadata)
      and (select value->>'attachmentId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' from metadata)
      and (select value->>'analysisRunId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' from metadata)
      and (select value->>'approvalId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' from metadata)
      and (select value->>'approvedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{3})?Z$' from metadata)
      and (select (value->>'originalMime') in ('image/jpeg','image/png') and (value->>'detectedMime') in ('image/jpeg','image/png') and (value->>'sanitizedMime') in ('image/jpeg','image/png') from metadata)
      and (select (value->>'originalByteSize')::bigint between 1 and 12000000 and (value->>'sanitizedByteSize')::bigint between 1 and 12000000 from metadata)
      and (select value->>'originalHashPrefix' ~ '^[0-9a-f]{16}$' and value->>'sanitizedHashPrefix' ~ '^[0-9a-f]{16}$' from metadata)
      and (select (value->>'width')::integer between 1 and 10000 and (value->>'height')::integer between 1 and 10000 from metadata)
      and (select value->>'metadataStripped' = 'true' and value->>'gpsStripped' = 'true' from metadata)
      and (select value->>'sanitizer' = 'ImageScript' and value->>'sanitizerVersion' = '1.3.0' from metadata)
      and (select value->>'revoked' in ('true', 'false') and (value->>'providerCallCount')::integer = p_provider_call_count from metadata)
  end;
$$;

create or replace function public.revoke_company_facebook_publication_photo_approval(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_revocation_reason text,
  p_timestamp timestamptz
)
returns setof public.company_social_publication_media_approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_approval public.company_social_publication_media_approvals%rowtype;
begin
  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or (p_revocation_reason is not null and (char_length(p_revocation_reason) > 240 or p_revocation_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid media approval revocation request';
  end if;

  perform 1 from public.job_attachments
  where id = p_attachment_id and company_id = p_company_id and job_id = p_job_id
  for key share;
  if not found then raise exception 'invalid approval attachment'; end if;

  update public.company_social_publication_media_approvals approval
  set approval_status = 'revoked',
      revoked_by = p_actor_id,
      revoked_at = p_timestamp,
      updated_at = p_timestamp,
      revocation_reason = case when p_revocation_reason is null then null else btrim(p_revocation_reason) end
  where approval.id = (
    select candidate.id
    from public.company_social_publication_media_approvals candidate
    where candidate.company_id = p_company_id
      and candidate.job_id = p_job_id
      and candidate.attachment_id = p_attachment_id
      and candidate.approval_status = 'approved'
      and candidate.revoked_at is null
    order by candidate.approved_at desc, candidate.id desc
    limit 1
  )
  returning * into updated_approval;
  if not found then raise exception 'active approval not found'; end if;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_approval_revoked', 'job_attachment', 'Facebook publication media approval',
    p_attachment_id::text, 'Facebook photo approval',
    'Meta publication media approval revoked.',
    jsonb_build_object(
      'channel', 'Facebook',
      'publicationKind', 'single_photo',
      'attachmentId', p_attachment_id::text,
      'analysisRunId', updated_approval.analysis_run_id::text,
      'approvalId', updated_approval.id::text,
      'approvalReason', updated_approval.approval_reason,
      'revokedAt', p_timestamp,
      'revocationReason', case when p_revocation_reason is null then null else btrim(p_revocation_reason) end
    )
  );
  return next updated_approval;
end;
$$;

drop function if exists public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, text, text, text, timestamptz);
drop function if exists public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz);

create or replace function public.exclude_company_facebook_publication_photo(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_analysis_run_id uuid,
  p_attachment_result_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_exclusion_reason text,
  p_timestamp timestamptz
)
returns table (
  attachment_id uuid,
  excluded boolean,
  revoked_approval_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_result public.company_media_analysis_attachment_results%rowtype;
  revoked_id uuid;
begin
  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or (p_exclusion_reason is not null and (char_length(p_exclusion_reason) > 240 or p_exclusion_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid media exclusion request';
  end if;

  perform 1 from public.job_attachments
  where id = p_attachment_id and company_id = p_company_id and job_id = p_job_id
  for key share;
  if not found then raise exception 'invalid media exclusion attachment'; end if;

  select ar.* into selected_result
  from public.company_media_analysis_attachment_results ar
  join public.company_media_analysis_runs run on run.id = ar.analysis_run_id
  where ar.id = p_attachment_result_id
    and ar.analysis_run_id = p_analysis_run_id
    and ar.company_id = p_company_id
    and ar.job_id = p_job_id
    and ar.attachment_id = p_attachment_id
    and ar.excluded = false
    and ar.analysis_status in ('analyzed', 'metadata_only')
    and run.company_id = p_company_id
    and run.job_id = p_job_id
    and run.status = 'completed'
    and not exists (
      select 1
      from public.company_media_analysis_attachment_results newer
      where newer.company_id = p_company_id
        and newer.job_id = p_job_id
        and newer.attachment_id = p_attachment_id
        and (newer.created_at, newer.id) > (ar.created_at, ar.id)
    )
  for update of ar;
  if not found then raise exception 'media analysis evidence stale or missing'; end if;

  update public.company_social_publication_media_approvals approval
  set approval_status = 'revoked',
      revoked_by = p_actor_id,
      revoked_at = p_timestamp,
      updated_at = p_timestamp,
      exclusion_reason = case when p_exclusion_reason is null then null else btrim(p_exclusion_reason) end
  where approval.id = (
    select candidate.id
    from public.company_social_publication_media_approvals candidate
    where candidate.company_id = p_company_id
      and candidate.job_id = p_job_id
      and candidate.attachment_id = p_attachment_id
      and candidate.approval_status = 'approved'
      and candidate.revoked_at is null
    order by candidate.approved_at desc, candidate.id desc
    limit 1
  )
  returning approval.id into revoked_id;

  update public.company_media_analysis_attachment_results
  set excluded = true,
      privacy_review_status = 'blocked'
  where id = selected_result.id;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_excluded', 'job_attachment', 'Facebook publication media exclusion',
    p_attachment_id::text, 'Facebook photo exclusion',
    'Meta publication media excluded from Facebook photo publishing.',
    jsonb_build_object(
      'channel', 'Facebook',
      'publicationKind', 'single_photo',
      'attachmentId', p_attachment_id::text,
      'analysisRunId', selected_result.analysis_run_id::text,
      'attachmentResultId', selected_result.id::text,
      'revokedApprovalId', case when revoked_id is null then null else revoked_id::text end,
      'excluded', true,
      'exclusionReason', case when p_exclusion_reason is null then null else btrim(p_exclusion_reason) end
    )
  );

  return query select p_attachment_id, true, revoked_id;
end;
$$;

create or replace function public.resolve_company_media_analysis_false_positive(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_analysis_run_id uuid,
  p_attachment_result_id uuid,
  p_finding_ids text[],
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_resolution_reason text,
  p_timestamp timestamptz
)
returns table (
  attachment_id uuid,
  privacy_review_status text,
  resolved_finding_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_result public.company_media_analysis_attachment_results%rowtype;
  resolved_count integer;
  unresolved_count integer;
begin
  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or p_finding_ids is null
    or array_length(p_finding_ids, 1) is null
    or array_length(p_finding_ids, 1) > 50
    or exists (select 1 from unnest(p_finding_ids) value where value is null or char_length(value) not between 1 and 120 or value !~ '^[A-Za-z0-9_.:-]+$')
    or (p_resolution_reason is not null and (char_length(p_resolution_reason) > 240 or p_resolution_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid false positive resolution request';
  end if;

  select ar.* into selected_result
  from public.company_media_analysis_attachment_results ar
  join public.company_media_analysis_runs run on run.id = ar.analysis_run_id
  where ar.id = p_attachment_result_id
    and ar.analysis_run_id = p_analysis_run_id
    and ar.company_id = p_company_id
    and ar.job_id = p_job_id
    and ar.attachment_id = p_attachment_id
    and ar.excluded = false
    and ar.analysis_status in ('analyzed', 'metadata_only')
    and run.company_id = p_company_id
    and run.job_id = p_job_id
    and run.status = 'completed'
    and not exists (
      select 1
      from public.company_media_analysis_attachment_results newer
      where newer.company_id = p_company_id
        and newer.job_id = p_job_id
        and newer.attachment_id = p_attachment_id
        and (newer.created_at, newer.id) > (ar.created_at, ar.id)
    )
  for update of ar;
  if not found then raise exception 'media analysis evidence stale or missing'; end if;

  update public.company_media_analysis_privacy_findings finding
  set resolved_as_false_positive = true,
      resolved_by = p_actor_id,
      resolved_at = p_timestamp
  where finding.attachment_result_id = selected_result.id
    and finding.analysis_run_id = selected_result.analysis_run_id
    and finding.company_id = p_company_id
    and finding.job_id = p_job_id
    and finding.attachment_id = p_attachment_id
    and finding.finding_id = any(p_finding_ids)
    and finding.resolved_as_false_positive = false;

  get diagnostics resolved_count = row_count;
  if resolved_count < 1 then raise exception 'privacy finding not found'; end if;

  select count(*)::integer into unresolved_count
  from public.company_media_analysis_privacy_findings finding
  where finding.attachment_result_id = selected_result.id
    and finding.resolved_as_false_positive = false;

  if unresolved_count = 0 then
    update public.company_media_analysis_attachment_results
    set privacy_review_status = 'resolved_false_positive'
    where id = selected_result.id;
    selected_result.privacy_review_status := 'resolved_false_positive';
  end if;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_false_positive_resolved', 'job_attachment', 'Facebook publication media false positive',
    p_attachment_id::text, 'Facebook photo false positive review',
    'Meta publication media privacy findings were resolved as false positives.',
    jsonb_build_object(
      'channel', 'Facebook',
      'publicationKind', 'single_photo',
      'attachmentId', p_attachment_id::text,
      'analysisRunId', selected_result.analysis_run_id::text,
      'attachmentResultId', selected_result.id::text,
      'resolvedFindingCount', resolved_count,
      'privacyReviewStatus', selected_result.privacy_review_status,
      'resolutionReason', case when p_resolution_reason is null then null else btrim(p_resolution_reason) end
    )
  );

  return query select p_attachment_id, selected_result.privacy_review_status, resolved_count;
end;
$$;

create or replace function public.list_company_facebook_publication_photo_candidates(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid default null
)
returns table (
  attachment_id uuid,
  attachment_result_id uuid,
  analysis_run_id uuid,
  approval_id uuid,
  approved_at timestamptz,
  name text,
  mime_type text,
  storage_bucket text,
  storage_path text,
  attachment_sha256 text,
  privacy_review_status text
)
language sql
security definer
set search_path = ''
as $$
  with newest as (
    select distinct on (ar.attachment_id) ar.*
    from public.company_media_analysis_attachment_results ar
    where ar.company_id = p_company_id
      and ar.job_id = p_job_id
      and (p_attachment_id is null or ar.attachment_id = p_attachment_id)
    order by ar.attachment_id, ar.created_at desc, ar.id desc
  ),
  candidate as (
    select
      ja.id as attachment_id,
      newest.id as attachment_result_id,
      newest.analysis_run_id,
      approval.id as approval_id,
      approval.approved_at,
      ja.name,
      lower(ja.mime_type) as mime_type,
      ja.storage_bucket,
      ja.storage_path,
      ('\x' || encode(newest.attachment_sha256, 'hex')) as attachment_sha256,
      newest.privacy_review_status
    from newest
    join public.company_media_analysis_runs run
      on run.id = newest.analysis_run_id
      and run.company_id = p_company_id
      and run.job_id = p_job_id
      and run.status = 'completed'
    join public.job_attachments ja
      on ja.id = newest.attachment_id
      and ja.company_id = p_company_id
      and ja.job_id = p_job_id
      and ja.kind::text <> 'video'
      and lower(ja.mime_type) in ('image/jpeg', 'image/png')
      and ja.size_bytes between 1 and 12000000
      and ja.storage_bucket is not null
      and ja.storage_path is not null
    join public.company_social_publication_media_approvals approval
      on approval.company_id = p_company_id
      and approval.job_id = p_job_id
      and approval.attachment_id = newest.attachment_id
      and approval.analysis_run_id = newest.analysis_run_id
      and approval.attachment_sha256 = newest.attachment_sha256
      and approval.approval_status = 'approved'
      and approval.revoked_at is null
    where newest.excluded = false
      and newest.analysis_status in ('analyzed', 'metadata_only')
      and newest.privacy_review_status in ('passed', 'resolved_false_positive')
      and not exists (
        select 1
        from public.company_media_analysis_privacy_findings finding
        where finding.attachment_result_id = newest.id
          and finding.company_id = p_company_id
          and finding.job_id = p_job_id
          and finding.attachment_id = newest.attachment_id
          and finding.resolved_as_false_positive = false
      )
  ),
  counted as (
    select candidate.*, count(*) over () as candidate_count
    from candidate
  )
  select
    attachment_id, attachment_result_id, analysis_run_id, approval_id, approved_at,
    name, mime_type, storage_bucket, storage_path, attachment_sha256, privacy_review_status
  from counted
  where candidate_count <= 20
  order by approved_at desc, approval_id desc
  limit 20;
$$;

revoke all on function public.meta_facebook_publication_audit_metadata_valid(text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.revoke_company_facebook_publication_photo_approval(uuid, uuid, uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.list_company_facebook_publication_photo_candidates(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.meta_facebook_publication_audit_metadata_valid(text, text, jsonb, integer) to service_role;
grant execute on function public.revoke_company_facebook_publication_photo_approval(uuid, uuid, uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.list_company_facebook_publication_photo_candidates(uuid, uuid, uuid) to service_role;

comment on function public.exclude_company_facebook_publication_photo(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz) is
  'Excludes exactly the displayed newest durable media analysis attachment result and rejects stale review actions.';
comment on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) is
  'Resolves false-positive findings only for exactly the displayed newest durable media analysis attachment result.';
comment on function public.list_company_facebook_publication_photo_candidates(uuid, uuid, uuid) is
  'Returns at most 20 newest-result Facebook photo candidates after SQL authority checks; Edge revalidates only these hashes.';

-- META_FACEBOOK_SINGLE_PHOTO_EXACT_REVIEW_END


-- META_FACEBOOK_SINGLE_PHOTO_RUNTIME_CLOSURE_BEGIN

drop function if exists public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz);

create or replace function public.meta_facebook_publication_audit_metadata_valid(
  p_publication_kind text,
  p_stage text,
  p_metadata jsonb,
  p_provider_call_count integer
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  value jsonb := coalesce(p_metadata, '{}'::jsonb);
  allowed_keys text[] := array[
    'attachmentId','analysisRunId','approvalId','approvedAt','revoked',
    'originalMime','detectedMime','sanitizedMime','originalByteSize','sanitizedByteSize',
    'originalHashPrefix','sanitizedHashPrefix','width','height','metadataStripped','gpsStripped',
    'sanitizer','sanitizerVersion','providerCallCount'
  ];
  key text;
  timestamp_value timestamptz;
  expected_call_count integer := case when p_stage = 'begin' then 0 else 1 end;
begin
  if p_publication_kind = 'text_only' then
    return value = '{}'::jsonb and p_provider_call_count = expected_call_count;
  end if;
  if p_publication_kind <> 'single_photo'
    or p_stage not in ('begin', 'complete', 'fail', 'unknown')
    or p_provider_call_count <> expected_call_count
    or jsonb_typeof(value) <> 'object'
    or length(value::text) > 4000
    or value::text ~* '(token|secret|url|https?://|signed|storage|private@example|coordinates|latitude|longitude)' then
    return false;
  end if;
  for key in select jsonb_object_keys(value) loop
    if key <> all(allowed_keys) then return false; end if;
  end loop;
  if not (value ?& allowed_keys) then return false; end if;
  if exists (select 1 from jsonb_each(value) item where jsonb_typeof(item.value) in ('array','object','null')) then return false; end if;
  if jsonb_typeof(value->'attachmentId') <> 'string'
    or jsonb_typeof(value->'analysisRunId') <> 'string'
    or jsonb_typeof(value->'approvalId') <> 'string'
    or jsonb_typeof(value->'approvedAt') <> 'string'
    or jsonb_typeof(value->'originalMime') <> 'string'
    or jsonb_typeof(value->'detectedMime') <> 'string'
    or jsonb_typeof(value->'sanitizedMime') <> 'string'
    or jsonb_typeof(value->'originalHashPrefix') <> 'string'
    or jsonb_typeof(value->'sanitizedHashPrefix') <> 'string'
    or jsonb_typeof(value->'sanitizer') <> 'string'
    or jsonb_typeof(value->'sanitizerVersion') <> 'string'
    or jsonb_typeof(value->'originalByteSize') <> 'number'
    or jsonb_typeof(value->'sanitizedByteSize') <> 'number'
    or jsonb_typeof(value->'width') <> 'number'
    or jsonb_typeof(value->'height') <> 'number'
    or jsonb_typeof(value->'providerCallCount') <> 'number'
    or jsonb_typeof(value->'revoked') <> 'boolean'
    or jsonb_typeof(value->'metadataStripped') <> 'boolean'
    or jsonb_typeof(value->'gpsStripped') <> 'boolean' then
    return false;
  end if;
  if (value->>'attachmentId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (value->>'analysisRunId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (value->>'approvalId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or (value->>'originalMime') not in ('image/jpeg','image/png')
    or (value->>'detectedMime') not in ('image/jpeg','image/png')
    or (value->>'sanitizedMime') not in ('image/jpeg','image/png')
    or (value->>'originalHashPrefix') !~ '^[0-9a-f]{16}$'
    or (value->>'sanitizedHashPrefix') !~ '^[0-9a-f]{16}$'
    or value->>'sanitizer' <> 'ImageScript'
    or value->>'sanitizerVersion' <> '1.3.0'
    or (value->>'revoked')::boolean <> false
    or (value->>'metadataStripped')::boolean <> true
    or (value->>'gpsStripped')::boolean <> true then
    return false;
  end if;
  if (value->>'originalByteSize') !~ '^[0-9]+$'
    or (value->>'sanitizedByteSize') !~ '^[0-9]+$'
    or (value->>'width') !~ '^[0-9]+$'
    or (value->>'height') !~ '^[0-9]+$'
    or (value->>'providerCallCount') !~ '^[0-9]+$' then
    return false;
  end if;
  if (value->>'originalByteSize')::bigint not between 1 and 12000000
    or (value->>'sanitizedByteSize')::bigint not between 1 and 12000000
    or (value->>'width')::integer not between 1 and 10000
    or (value->>'height')::integer not between 1 and 10000
    or (value->>'providerCallCount')::integer <> p_provider_call_count then
    return false;
  end if;
  begin
    timestamp_value := (value->>'approvedAt')::timestamptz;
  exception when others then
    return false;
  end;
  return timestamp_value is not null;
end;
$$;

alter function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz)
  rename to begin_company_facebook_publication_unvalidated_20260805;
alter function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz)
  rename to complete_company_facebook_publication_unvalidated_20260805;
alter function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz)
  rename to fail_company_facebook_publication_unvalidated_20260805;
alter function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, jsonb, timestamptz)
  rename to mark_company_facebook_publication_unknown_unvalidated_20260805;

create or replace function public.begin_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_job_id uuid,
  p_idempotency_key uuid,
  p_approved_message text,
  p_message_sha256 bytea,
  p_publication_intent_sha256 bytea,
  p_publication_kind text,
  p_attachment_id uuid,
  p_safe_mime_type text,
  p_media_count smallint,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_publication_audit_metadata jsonb,
  p_timestamp timestamptz
)
returns table (
  publication_id uuid,
  publication_status text,
  publication_approved_at timestamptz,
  publication_published_at timestamptz,
  publication_last_error_code text,
  publication_provider_http_status integer,
  publication_provider_error_code integer,
  publication_provider_error_subcode integer,
  publication_provider_error_category text,
  publication_provider_is_transient boolean,
  should_publish boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.meta_facebook_publication_audit_metadata_valid(p_publication_kind, 'begin', coalesce(p_publication_audit_metadata, '{}'::jsonb), 0) then
    raise exception 'invalid publication audit metadata';
  end if;

  return query select * from public.begin_company_facebook_publication_unvalidated_20260805(
    p_publication_id, p_company_id, p_connection_id, p_job_id, p_idempotency_key,
    p_approved_message, p_message_sha256, p_publication_intent_sha256, p_publication_kind,
    p_attachment_id, p_safe_mime_type, p_media_count, p_actor_id, p_actor_name, p_actor_role,
    p_publication_audit_metadata, p_timestamp
  );
end;
$$;

create or replace function public.complete_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider_post_id text,
  p_provider_media_id text,
  p_publication_audit_metadata jsonb,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_kind text;
begin
  select publication_kind into selected_kind
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id;

  if found and not public.meta_facebook_publication_audit_metadata_valid(selected_kind, 'complete', coalesce(p_publication_audit_metadata, '{}'::jsonb), 1) then
    raise exception 'invalid publication audit metadata';
  end if;

  return query select * from public.complete_company_facebook_publication_unvalidated_20260805(
    p_publication_id, p_company_id, p_actor_id, p_actor_name, p_actor_role,
    p_provider_post_id, p_provider_media_id, p_publication_audit_metadata, p_timestamp
  );
end;
$$;

create or replace function public.fail_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider_http_status integer,
  p_provider_error_code integer,
  p_provider_error_subcode integer,
  p_provider_error_category text,
  p_provider_is_transient boolean,
  p_last_error_code text,
  p_publication_audit_metadata jsonb,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_kind text;
begin
  select publication_kind into selected_kind
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id;

  if found and not public.meta_facebook_publication_audit_metadata_valid(selected_kind, 'fail', coalesce(p_publication_audit_metadata, '{}'::jsonb), 1) then
    raise exception 'invalid publication audit metadata';
  end if;

  return query select * from public.fail_company_facebook_publication_unvalidated_20260805(
    p_publication_id, p_company_id, p_actor_id, p_actor_name, p_actor_role,
    p_provider_http_status, p_provider_error_code, p_provider_error_subcode,
    p_provider_error_category, p_provider_is_transient, p_last_error_code,
    p_publication_audit_metadata, p_timestamp
  );
end;
$$;

create or replace function public.mark_company_facebook_publication_unknown(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_publication_audit_metadata jsonb,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_kind text;
begin
  select publication_kind into selected_kind
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id;

  if found and not public.meta_facebook_publication_audit_metadata_valid(selected_kind, 'unknown', coalesce(p_publication_audit_metadata, '{}'::jsonb), 1) then
    raise exception 'invalid publication audit metadata';
  end if;

  return query select * from public.mark_company_facebook_publication_unknown_unvalidated_20260805(
    p_publication_id, p_company_id, p_actor_id, p_actor_name, p_actor_role,
    p_publication_audit_metadata, p_timestamp
  );
end;
$$;

create or replace function public.approve_company_facebook_publication_photo(
  p_approval_id uuid,
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_analysis_run_id uuid,
  p_attachment_result_id uuid,
  p_attachment_sha256 bytea,
  p_attachment_mime_type text,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_approval_reason text,
  p_timestamp timestamptz
)
returns setof public.company_social_publication_media_approvals
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_attachment public.job_attachments%rowtype;
  selected_result public.company_media_analysis_attachment_results%rowtype;
  approved_row public.company_social_publication_media_approvals%rowtype;
begin
  if octet_length(p_attachment_sha256) <> 32
    or p_attachment_mime_type not in ('image/jpeg', 'image/png')
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or (p_approval_reason is not null and (char_length(p_approval_reason) > 240 or p_approval_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid media approval request';
  end if;

  perform 1 from public.jobs where id = p_job_id and company_id = p_company_id and status::text in ('Completed', 'Warranty') for update;
  if not found then raise exception 'invalid approval job'; end if;

  select * into selected_attachment
  from public.job_attachments
  where id = p_attachment_id and company_id = p_company_id and job_id = p_job_id
  for key share;
  if not found
    or selected_attachment.kind::text = 'video'
    or lower(selected_attachment.mime_type) <> p_attachment_mime_type
    or selected_attachment.size_bytes < 1
    or selected_attachment.size_bytes > 12000000
    or selected_attachment.storage_bucket is null
    or selected_attachment.storage_path is null then
    raise exception 'invalid approval attachment';
  end if;

  select ar.* into selected_result
  from public.company_media_analysis_attachment_results ar
  join public.company_media_analysis_runs run on run.id = ar.analysis_run_id
  where ar.id = p_attachment_result_id
    and ar.analysis_run_id = p_analysis_run_id
    and ar.company_id = p_company_id
    and ar.job_id = p_job_id
    and ar.attachment_id = p_attachment_id
    and ar.attachment_sha256 = p_attachment_sha256
    and ar.detected_mime_type = p_attachment_mime_type
    and ar.excluded = false
    and ar.analysis_status in ('analyzed', 'metadata_only')
    and ar.privacy_review_status in ('passed', 'resolved_false_positive')
    and run.company_id = p_company_id
    and run.job_id = p_job_id
    and run.status = 'completed'
    and not exists (
      select 1 from public.company_media_analysis_attachment_results newer
      where newer.company_id = p_company_id
        and newer.job_id = p_job_id
        and newer.attachment_id = p_attachment_id
        and (newer.created_at, newer.id) > (ar.created_at, ar.id)
    )
  for update of ar;
  if not found then raise exception 'media analysis evidence stale or missing'; end if;

  if exists (
    select 1
    from public.company_media_analysis_privacy_findings finding
    where finding.attachment_result_id = selected_result.id
      and finding.company_id = p_company_id
      and finding.job_id = p_job_id
      and finding.attachment_id = p_attachment_id
      and finding.resolved_as_false_positive = false
  ) then
    raise exception 'unresolved media privacy finding';
  end if;

  update public.company_social_publication_media_approvals approval
  set approval_status = 'revoked',
      revoked_by = p_actor_id,
      revoked_at = p_timestamp,
      updated_at = p_timestamp
  where approval.company_id = p_company_id
    and approval.job_id = p_job_id
    and approval.attachment_id = p_attachment_id
    and approval.approval_status = 'approved'
    and approval.revoked_at is null;

  insert into public.company_social_publication_media_approvals (
    id, company_id, job_id, attachment_id, analysis_run_id, approval_status, approved_by, approved_at,
    approval_reason, attachment_sha256, attachment_mime_type, created_at, updated_at
  ) values (
    p_approval_id, p_company_id, p_job_id, p_attachment_id, selected_result.analysis_run_id, 'approved', p_actor_id, p_timestamp,
    p_approval_reason, p_attachment_sha256, p_attachment_mime_type, p_timestamp, p_timestamp
  )
  returning * into approved_row;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_approved', 'job_attachment', 'Facebook publication media approval',
    p_attachment_id::text, 'Facebook photo approval',
    'Meta publication media approval completed.',
    jsonb_build_object(
      'channel', 'Facebook',
      'publicationKind', 'single_photo',
      'mediaCount', 1,
      'attachmentId', p_attachment_id::text,
      'analysisRunId', selected_result.analysis_run_id::text,
      'attachmentResultId', selected_result.id::text,
      'analysisStatus', selected_result.analysis_status,
      'privacyReviewStatus', selected_result.privacy_review_status,
      'checksumMatch', true,
      'approvalId', approved_row.id::text,
      'approvalReason', case when p_approval_reason is null then null else btrim(p_approval_reason) end
    )
  );
  return next approved_row;
end;
$$;

create or replace function public.resolve_company_media_analysis_false_positive(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_id uuid,
  p_analysis_run_id uuid,
  p_attachment_result_id uuid,
  p_finding_ids text[],
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_resolution_reason text,
  p_timestamp timestamptz
)
returns table (
  attachment_id uuid,
  privacy_review_status text,
  resolved_finding_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_result public.company_media_analysis_attachment_results%rowtype;
  unique_finding_count integer;
  unresolved_count integer;
begin
  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or p_finding_ids is null
    or array_length(p_finding_ids, 1) is null
    or array_length(p_finding_ids, 1) > 50
    or exists (select 1 from unnest(p_finding_ids) value where value is null or char_length(value) not between 1 and 120 or value !~ '^[A-Za-z0-9_.:-]+$')
    or (select count(*) from unnest(p_finding_ids) value) <> (select count(distinct value) from unnest(p_finding_ids) value)
    or (p_resolution_reason is not null and (char_length(p_resolution_reason) > 240 or p_resolution_reason ~ '[[:cntrl:]<>]')) then
    raise exception 'invalid false positive resolution request';
  end if;
  select count(distinct value)::integer into unique_finding_count from unnest(p_finding_ids) value;

  select ar.* into selected_result
  from public.company_media_analysis_attachment_results ar
  join public.company_media_analysis_runs run on run.id = ar.analysis_run_id
  where ar.id = p_attachment_result_id
    and ar.analysis_run_id = p_analysis_run_id
    and ar.company_id = p_company_id
    and ar.job_id = p_job_id
    and ar.attachment_id = p_attachment_id
    and ar.excluded = false
    and ar.analysis_status in ('analyzed', 'metadata_only')
    and run.company_id = p_company_id
    and run.job_id = p_job_id
    and run.status = 'completed'
    and not exists (
      select 1
      from public.company_media_analysis_attachment_results newer
      where newer.company_id = p_company_id
        and newer.job_id = p_job_id
        and newer.attachment_id = p_attachment_id
        and (newer.created_at, newer.id) > (ar.created_at, ar.id)
    )
  for update of ar;
  if not found then raise exception 'media analysis evidence stale or missing'; end if;

  if (
    select count(*)::integer
    from public.company_media_analysis_privacy_findings finding
    where finding.attachment_result_id = selected_result.id
      and finding.analysis_run_id = selected_result.analysis_run_id
      and finding.company_id = p_company_id
      and finding.job_id = p_job_id
      and finding.attachment_id = p_attachment_id
      and finding.finding_id = any(p_finding_ids)
      and finding.resolved_as_false_positive = false
  ) <> unique_finding_count then
    raise exception 'privacy finding set mismatch';
  end if;

  update public.company_media_analysis_privacy_findings finding
  set resolved_as_false_positive = true,
      resolved_by = p_actor_id,
      resolved_at = p_timestamp
  where finding.attachment_result_id = selected_result.id
    and finding.analysis_run_id = selected_result.analysis_run_id
    and finding.company_id = p_company_id
    and finding.job_id = p_job_id
    and finding.attachment_id = p_attachment_id
    and finding.finding_id = any(p_finding_ids)
    and finding.resolved_as_false_positive = false;

  get diagnostics resolved_finding_count = row_count;
  if resolved_finding_count <> unique_finding_count then
    raise exception 'privacy finding set mismatch';
  end if;

  select count(*)::integer into unresolved_count
  from public.company_media_analysis_privacy_findings finding
  where finding.attachment_result_id = selected_result.id
    and finding.resolved_as_false_positive = false;

  if unresolved_count = 0 then
    update public.company_media_analysis_attachment_results
    set privacy_review_status = 'resolved_false_positive'
    where id = selected_result.id;
    selected_result.privacy_review_status := 'resolved_false_positive';
  end if;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_media_false_positive_resolved', 'job_attachment', 'Facebook publication media false positive',
    p_attachment_id::text, 'Facebook photo false positive review',
    'Meta publication media privacy findings were resolved as false positives.',
    jsonb_build_object(
      'channel', 'Facebook',
      'publicationKind', 'single_photo',
      'attachmentId', p_attachment_id::text,
      'analysisRunId', selected_result.analysis_run_id::text,
      'attachmentResultId', selected_result.id::text,
      'resolvedFindingCount', resolved_finding_count,
      'privacyReviewStatus', selected_result.privacy_review_status,
      'resolutionReason', case when p_resolution_reason is null then null else btrim(p_resolution_reason) end
    )
  );

  return query select p_attachment_id, selected_result.privacy_review_status, resolved_finding_count;
end;
$$;

create or replace function public.record_company_media_analysis_result(
  p_run_id uuid,
  p_company_id uuid,
  p_job_id uuid,
  p_correlation_id text,
  p_status text,
  p_provider text,
  p_model text,
  p_analysis_version text,
  p_attachments jsonb,
  p_timestamp timestamptz
)
returns table (
  attachment_id uuid,
  analysis_run_id uuid,
  attachment_result_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  finding jsonb;
  result_id uuid;
  attachment_row public.job_attachments%rowtype;
  privacy_count integer;
begin
  if p_status not in ('completed','failed')
    or p_correlation_id is null or char_length(p_correlation_id) not between 1 and 160
    or p_provider is null or char_length(p_provider) not between 1 and 80
    or p_analysis_version <> 'media-analysis-v1'
    or jsonb_typeof(p_attachments) <> 'array'
    or jsonb_array_length(p_attachments) > 15 then
    raise exception 'invalid media analysis persistence request';
  end if;
  perform 1 from public.jobs where id = p_job_id and company_id = p_company_id for key share;
  if not found then raise exception 'invalid media analysis job'; end if;

  insert into public.company_media_analysis_runs (
    id, company_id, job_id, correlation_id, status, provider, model, analysis_version,
    completed_at, created_at, updated_at
  ) values (
    p_run_id, p_company_id, p_job_id, p_correlation_id, p_status, p_provider, p_model, p_analysis_version,
    p_timestamp, p_timestamp, p_timestamp
  );

  for item in select value from jsonb_array_elements(p_attachments) value loop
    if jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item->'attachmentId') <> 'string'
      or jsonb_typeof(item->'attachmentSha256') <> 'string'
      or jsonb_typeof(item->'detectedMimeType') <> 'string'
      or jsonb_typeof(item->'analysisStatus') <> 'string'
      or jsonb_typeof(item->'privacyFindings') <> 'array'
      or jsonb_array_length(item->'privacyFindings') > 50
      or (item->>'attachmentSha256') !~ '^\\x[0-9a-f]{64}$'
      or (item->>'detectedMimeType') not in ('image/jpeg','image/png','image/webp')
      or (item->>'analysisStatus') not in ('analyzed','metadata_only','manual_review') then
      raise exception 'invalid media analysis attachment payload';
    end if;
    select * into attachment_row
    from public.job_attachments
    where id = (item->>'attachmentId')::uuid
      and company_id = p_company_id
      and job_id = p_job_id
    for key share;
    if not found then raise exception 'invalid media analysis attachment'; end if;

    result_id := gen_random_uuid();
    privacy_count := jsonb_array_length(item->'privacyFindings');
    insert into public.company_media_analysis_attachment_results (
      id, analysis_run_id, company_id, job_id, attachment_id, attachment_sha256,
      detected_mime_type, analysis_status, privacy_review_status, excluded, created_at
    ) values (
      result_id, p_run_id, p_company_id, p_job_id, attachment_row.id,
      decode(substring(item->>'attachmentSha256' from 3), 'hex'),
      item->>'detectedMimeType', item->>'analysisStatus',
      case when privacy_count > 0 then 'blocked' else 'passed' end,
      false, p_timestamp
    );

    for finding in select value from jsonb_array_elements(item->'privacyFindings') value loop
      if jsonb_typeof(finding) <> 'object'
        or jsonb_typeof(finding->'findingId') <> 'string'
        or jsonb_typeof(finding->'findingCategory') <> 'string'
        or jsonb_typeof(finding->'riskLevel') <> 'string'
        or char_length(finding->>'findingId') not between 1 and 120
        or (finding->>'findingId') !~ '^[A-Za-z0-9_.:-]+$'
        or (finding->>'findingCategory') not in ('possible_license_plate','possible_address','possible_email','possible_phone','possible_face','unknown_privacy_risk')
        or (finding->>'riskLevel') not in ('low','medium','high') then
        raise exception 'invalid media analysis finding payload';
      end if;
      insert into public.company_media_analysis_privacy_findings (
        id, analysis_run_id, attachment_result_id, company_id, job_id, attachment_id,
        finding_id, finding_category, risk_level, resolved_as_false_positive, created_at
      ) values (
        gen_random_uuid(), p_run_id, result_id, p_company_id, p_job_id, attachment_row.id,
        finding->>'findingId', finding->>'findingCategory', finding->>'riskLevel', false, p_timestamp
      );
    end loop;

    attachment_id := attachment_row.id;
    analysis_run_id := p_run_id;
    attachment_result_id := result_id;
    return next;
  end loop;
end;
$$;

revoke all on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.record_company_media_analysis_result(uuid, uuid, uuid, text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.meta_facebook_publication_audit_metadata_valid(text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.begin_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_company_facebook_publication_unknown_unvalidated_20260805(uuid, uuid, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.resolve_company_media_analysis_false_positive(uuid, uuid, uuid, uuid, uuid, text[], uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.record_company_media_analysis_result(uuid, uuid, uuid, text, text, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.meta_facebook_publication_audit_metadata_valid(text, text, jsonb, integer) to service_role;
grant execute on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) to service_role;
grant execute on function public.fail_company_facebook_publication(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz) to service_role;
grant execute on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, text, text, jsonb, timestamptz) to service_role;

comment on function public.approve_company_facebook_publication_photo(uuid, uuid, uuid, uuid, uuid, uuid, bytea, text, uuid, text, text, text, timestamptz) is
  'Approves only the exact displayed newest durable media-analysis attachment result.';
comment on function public.record_company_media_analysis_result(uuid, uuid, uuid, text, text, text, text, text, jsonb, timestamptz) is
  'Atomically records one media-analysis run, attachment results, and privacy findings, returning durable result ids.';

-- META_FACEBOOK_SINGLE_PHOTO_RUNTIME_CLOSURE_END



-- META_FACEBOOK_SINGLE_PHOTO_PERSISTENCE_CLOSURE_BEGIN

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

alter function public.begin_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz)
  set schema private;
alter function public.complete_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz)
  set schema private;
alter function public.fail_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz)
  set schema private;
alter function public.mark_company_facebook_publication_unknown_unvalidated_20260805(uuid, uuid, uuid, text, text, jsonb, timestamptz)
  set schema private;

revoke all on function private.begin_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, uuid, uuid, text, bytea, bytea, text, uuid, text, smallint, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.complete_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.fail_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, text, text, integer, integer, integer, text, boolean, text, jsonb, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.mark_company_facebook_publication_unknown_unvalidated_20260805(uuid, uuid, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.begin_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_job_id uuid,
  p_idempotency_key uuid,
  p_approved_message text,
  p_message_sha256 bytea,
  p_publication_intent_sha256 bytea,
  p_publication_kind text,
  p_attachment_id uuid,
  p_safe_mime_type text,
  p_media_count smallint,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_publication_audit_metadata jsonb,
  p_timestamp timestamptz
)
returns table (
  publication_id uuid,
  publication_status text,
  publication_approved_at timestamptz,
  publication_published_at timestamptz,
  publication_last_error_code text,
  publication_provider_http_status integer,
  publication_provider_error_code integer,
  publication_provider_error_subcode integer,
  publication_provider_error_category text,
  publication_provider_is_transient boolean,
  should_publish boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.meta_facebook_publication_audit_metadata_valid(p_publication_kind, 'begin', coalesce(p_publication_audit_metadata, '{}'::jsonb), 0) then
    raise exception 'invalid publication audit metadata';
  end if;

  return query select * from private.begin_company_facebook_publication_unvalidated_20260805(
    p_publication_id, p_company_id, p_connection_id, p_job_id, p_idempotency_key,
    p_approved_message, p_message_sha256, p_publication_intent_sha256, p_publication_kind,
    p_attachment_id, p_safe_mime_type, p_media_count, p_actor_id, p_actor_name, p_actor_role,
    p_publication_audit_metadata, p_timestamp
  );
end;
$$;

create or replace function public.complete_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider_post_id text,
  p_provider_media_id text,
  p_publication_audit_metadata jsonb,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_kind text;
begin
  select publication_kind into selected_kind
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id;

  if found and not public.meta_facebook_publication_audit_metadata_valid(selected_kind, 'complete', coalesce(p_publication_audit_metadata, '{}'::jsonb), 1) then
    raise exception 'invalid publication audit metadata';
  end if;

  return query select * from private.complete_company_facebook_publication_unvalidated_20260805(
    p_publication_id, p_company_id, p_actor_id, p_actor_name, p_actor_role,
    p_provider_post_id, p_provider_media_id, p_publication_audit_metadata, p_timestamp
  );
end;
$$;

create or replace function public.fail_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider_http_status integer,
  p_provider_error_code integer,
  p_provider_error_subcode integer,
  p_provider_error_category text,
  p_provider_is_transient boolean,
  p_last_error_code text,
  p_publication_audit_metadata jsonb,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_kind text;
begin
  select publication_kind into selected_kind
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id;

  if found and not public.meta_facebook_publication_audit_metadata_valid(selected_kind, 'fail', coalesce(p_publication_audit_metadata, '{}'::jsonb), 1) then
    raise exception 'invalid publication audit metadata';
  end if;

  return query select * from private.fail_company_facebook_publication_unvalidated_20260805(
    p_publication_id, p_company_id, p_actor_id, p_actor_name, p_actor_role,
    p_provider_http_status, p_provider_error_code, p_provider_error_subcode,
    p_provider_error_category, p_provider_is_transient, p_last_error_code,
    p_publication_audit_metadata, p_timestamp
  );
end;
$$;

create or replace function public.mark_company_facebook_publication_unknown(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_publication_audit_metadata jsonb,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_kind text;
begin
  select publication_kind into selected_kind
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id;

  if found and not public.meta_facebook_publication_audit_metadata_valid(selected_kind, 'unknown', coalesce(p_publication_audit_metadata, '{}'::jsonb), 1) then
    raise exception 'invalid publication audit metadata';
  end if;

  return query select * from private.mark_company_facebook_publication_unknown_unvalidated_20260805(
    p_publication_id, p_company_id, p_actor_id, p_actor_name, p_actor_role,
    p_publication_audit_metadata, p_timestamp
  );
end;
$$;

alter table public.company_media_analysis_attachment_results
  drop constraint if exists company_media_analysis_attachment_mime_check;
alter table public.company_media_analysis_attachment_results
  add constraint company_media_analysis_attachment_mime_check
    check (detected_mime_type in ('image/jpeg', 'image/png', 'image/webp'));

do $$
begin
  if exists (
    select 1
    from public.company_media_analysis_attachment_results
    group by analysis_run_id, attachment_id
    having count(*) > 1
  ) then
    raise exception 'duplicate media analysis attachment results exist';
  end if;
  if exists (
    select 1
    from public.company_media_analysis_privacy_findings
    group by attachment_result_id, finding_id
    having count(*) > 1
  ) then
    raise exception 'duplicate media analysis privacy findings exist';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'company_media_analysis_attachment_results_run_attachment_unique'
      and conrelid = 'public.company_media_analysis_attachment_results'::regclass
  ) then
    alter table public.company_media_analysis_attachment_results
      add constraint company_media_analysis_attachment_results_run_attachment_unique
      unique (analysis_run_id, attachment_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'company_media_analysis_privacy_findings_result_finding_unique'
      and conrelid = 'public.company_media_analysis_privacy_findings'::regclass
  ) then
    alter table public.company_media_analysis_privacy_findings
      add constraint company_media_analysis_privacy_findings_result_finding_unique
      unique (attachment_result_id, finding_id);
  end if;
end;
$$;

create or replace function public.record_company_media_analysis_result(
  p_run_id uuid,
  p_company_id uuid,
  p_job_id uuid,
  p_correlation_id text,
  p_status text,
  p_provider text,
  p_model text,
  p_analysis_version text,
  p_attachments jsonb,
  p_timestamp timestamptz
)
returns table (
  attachment_id uuid,
  analysis_run_id uuid,
  attachment_result_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  finding jsonb;
  result_id uuid;
  attachment_row public.job_attachments%rowtype;
  privacy_count integer;
  total_privacy_count integer := 0;
  seen_attachment_ids text[] := array[]::text[];
  seen_finding_ids text[];
  item_keys text[];
  finding_keys text[];
  attachment_id_text text;
  checksum_text text;
  detected_mime text;
begin
  if p_status not in ('completed','failed')
    or p_correlation_id is null or char_length(p_correlation_id) not between 8 and 160 or p_correlation_id ~ '[[:cntrl:]<>]'
    or p_provider is null or char_length(p_provider) not between 1 and 120 or p_provider ~ '[[:cntrl:]<>]'
    or (p_model is not null and (char_length(p_model) > 120 or p_model ~ '[[:cntrl:]<>]'))
    or p_analysis_version <> 'media-analysis-v1'
    or p_timestamp is null
    or jsonb_typeof(p_attachments) <> 'array'
    or jsonb_array_length(p_attachments) > 4 then
    raise exception 'invalid media analysis persistence request';
  end if;
  perform 1 from public.jobs where id = p_job_id and company_id = p_company_id for key share;
  if not found then raise exception 'invalid media analysis job'; end if;

  insert into public.company_media_analysis_runs (
    id, company_id, job_id, correlation_id, status, provider, model, analysis_version,
    completed_at, created_at, updated_at
  ) values (
    p_run_id, p_company_id, p_job_id, p_correlation_id, p_status, p_provider, p_model, p_analysis_version,
    p_timestamp, p_timestamp, p_timestamp
  );

  for item in select value from jsonb_array_elements(p_attachments) value loop
    select coalesce(array_agg(key order by key), array[]::text[]) into item_keys from jsonb_object_keys(item) key;
    attachment_id_text := item->>'attachmentId';
    checksum_text := item->>'attachmentSha256';
    detected_mime := lower(item->>'detectedMimeType');

    if jsonb_typeof(item) <> 'object'
      or item_keys <> array['analysisStatus','attachmentId','attachmentSha256','detectedMimeType','privacyFindings']
      or jsonb_typeof(item->'attachmentId') <> 'string'
      or attachment_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or attachment_id_text = any(seen_attachment_ids)
      or jsonb_typeof(item->'attachmentSha256') <> 'string'
      or checksum_text !~ '^\\x[0-9a-f]{64}$'
      or jsonb_typeof(item->'detectedMimeType') <> 'string'
      or detected_mime not in ('image/jpeg','image/png','image/webp')
      or jsonb_typeof(item->'analysisStatus') <> 'string'
      or (item->>'analysisStatus') not in ('analyzed','metadata_only','manual_review')
      or jsonb_typeof(item->'privacyFindings') <> 'array'
      or jsonb_array_length(item->'privacyFindings') > 6 then
      raise exception 'invalid media analysis attachment payload';
    end if;

    select * into attachment_row
    from public.job_attachments
    where id = attachment_id_text::uuid
      and company_id = p_company_id
      and job_id = p_job_id
    for key share;
    if not found
      or attachment_row.kind::text <> 'photo'
      or lower(attachment_row.mime_type) <> detected_mime
      or attachment_row.size_bytes not between 1 and 12000000
      or attachment_row.storage_bucket is null
      or attachment_row.storage_path is null then
      raise exception 'invalid media analysis attachment';
    end if;

    seen_attachment_ids := array_append(seen_attachment_ids, attachment_id_text);
    result_id := gen_random_uuid();
    privacy_count := jsonb_array_length(item->'privacyFindings');
    total_privacy_count := total_privacy_count + privacy_count;
    if total_privacy_count > 24 then
      raise exception 'invalid media analysis finding payload';
    end if;

    insert into public.company_media_analysis_attachment_results (
      id, analysis_run_id, company_id, job_id, attachment_id, attachment_sha256,
      detected_mime_type, analysis_status, privacy_review_status, excluded, created_at
    ) values (
      result_id, p_run_id, p_company_id, p_job_id, attachment_row.id,
      decode(substring(checksum_text from 3), 'hex'),
      detected_mime, item->>'analysisStatus',
      case when privacy_count > 0 then 'blocked' else 'passed' end,
      false, p_timestamp
    );

    seen_finding_ids := array[]::text[];
    for finding in select value from jsonb_array_elements(item->'privacyFindings') value loop
      select coalesce(array_agg(key order by key), array[]::text[]) into finding_keys from jsonb_object_keys(finding) key;
      if jsonb_typeof(finding) <> 'object'
        or finding_keys <> array['findingCategory','findingId','riskLevel']
        or jsonb_typeof(finding->'findingId') <> 'string'
        or jsonb_typeof(finding->'findingCategory') <> 'string'
        or jsonb_typeof(finding->'riskLevel') <> 'string'
        or char_length(finding->>'findingId') not between 1 and 120
        or (finding->>'findingId') !~ '^[A-Za-z0-9_.:-]+$'
        or (finding->>'findingId') = any(seen_finding_ids)
        or (finding->>'findingCategory') not in (
          'possible_face','possible_address','possible_phone_or_email','possible_license_plate',
          'possible_customer_document','possible_screen','possible_barcode',
          'possible_serial_or_nameplate','possible_personal_identifier','unknown_privacy_risk'
        )
        or (finding->>'riskLevel') not in ('low','medium','high') then
        raise exception 'invalid media analysis finding payload';
      end if;
      seen_finding_ids := array_append(seen_finding_ids, finding->>'findingId');
      insert into public.company_media_analysis_privacy_findings (
        id, analysis_run_id, attachment_result_id, company_id, job_id, attachment_id,
        finding_id, finding_category, risk_level, resolved_as_false_positive, created_at
      ) values (
        gen_random_uuid(), p_run_id, result_id, p_company_id, p_job_id, attachment_row.id,
        finding->>'findingId', finding->>'findingCategory', finding->>'riskLevel', false, p_timestamp
      );
    end loop;

    attachment_id := attachment_row.id;
    analysis_run_id := p_run_id;
    attachment_result_id := result_id;
    return next;
  end loop;
end;
$$;

revoke all on function public.record_company_media_analysis_result(uuid, uuid, uuid, text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.record_company_media_analysis_result(uuid, uuid, uuid, text, text, text, text, text, jsonb, timestamptz) to service_role;

comment on function public.record_company_media_analysis_result(uuid, uuid, uuid, text, text, text, text, text, jsonb, timestamptz) is
  'Atomically records bounded media-analysis photo results with exact attachment validation, WebP persistence, canonical privacy categories, and durable id mapping.';

-- META_FACEBOOK_SINGLE_PHOTO_PERSISTENCE_CLOSURE_END

-- META_PUBLICATION_AUDIT_PROVIDER_ID_REDACTION_BEGIN

create or replace function private.complete_company_facebook_publication_unvalidated_20260805(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_provider_post_id text,
  p_provider_media_id text,
  p_publication_audit_metadata jsonb,
  p_timestamp timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
  safe_metadata jsonb := coalesce(p_publication_audit_metadata, '{}'::jsonb);
begin
  select * into locked_publication
  from public.company_social_publications
  where id = p_publication_id and company_id = p_company_id and approved_by = p_actor_id
  for update;
  if not found or locked_publication.status <> 'publishing' then
    raise exception 'invalid publication transition';
  end if;

  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or jsonb_typeof(safe_metadata) <> 'object'
    or safe_metadata::text ~* '(token|secret|signed|storage|private@example|coordinates|latitude|longitude)'
    or (locked_publication.publication_kind = 'single_photo' and not (
      safe_metadata ?& array[
        'analysisRunId', 'approvalId', 'approvedAt', 'revoked',
        'originalMime', 'detectedMime', 'sanitizedMime',
        'originalByteSize', 'sanitizedByteSize',
        'originalHashPrefix', 'sanitizedHashPrefix',
        'width', 'height', 'metadataStripped', 'gpsStripped',
        'sanitizer', 'sanitizerVersion', 'providerCallCount'
      ]
    ))
    or (locked_publication.publication_kind = 'text_only' and (
      p_provider_post_id is null or char_length(btrim(p_provider_post_id)) not between 1 and 200 or p_provider_post_id ~ '[[:cntrl:]]' or p_provider_media_id is not null
    ))
    or (locked_publication.publication_kind = 'single_photo' and (
      p_provider_post_id is not null or p_provider_media_id is null or char_length(btrim(p_provider_media_id)) not between 1 and 200 or p_provider_media_id ~ '[[:cntrl:]]'
    )) then
    raise exception 'invalid provider ids';
  end if;

  update public.company_social_publications
  set status = 'published',
      provider_post_id = case when locked_publication.publication_kind = 'text_only' then btrim(p_provider_post_id) else null end,
      provider_media_id = case when locked_publication.publication_kind = 'single_photo' then btrim(p_provider_media_id) else null end,
      attempts = 1,
      provider_http_status = null, provider_error_code = null,
      provider_error_subcode = null, provider_error_category = null,
      provider_is_transient = null, last_error_code = null,
      published_at = p_timestamp, updated_at = p_timestamp
  where id = locked_publication.id
  returning * into updated_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_published', 'meta_social_publication', 'Facebook publication',
    updated_publication.id::text, 'Facebook publication',
    'Meta publication lifecycle action completed.',
    jsonb_build_object(
      'channel', 'Facebook', 'status', 'published',
      'publicationKind', updated_publication.publication_kind,
      'mediaCount', updated_publication.media_count,
      'messageCharacterCount', char_length(updated_publication.approved_message),
      'attachmentId', case when updated_publication.publication_kind = 'single_photo' then updated_publication.attachment_id::text else null end,
      'providerCallCount', 1,
      'singlePhotoProviderPostIdNull', updated_publication.publication_kind = 'single_photo' and updated_publication.provider_post_id is null,
      'intentHashPrefix', encode(substring(updated_publication.publication_intent_sha256 from 1 for 8), 'hex'),
      'attempts', 1
    ) || safe_metadata
  );
  return next updated_publication;
end;
$$;

revoke all on function private.complete_company_facebook_publication_unvalidated_20260805(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated, service_role;

update public.audit_events
set metadata = metadata - 'providerMediaId' - 'providerPostId'
where action = 'meta_publication_published'
  and metadata ?| array['providerMediaId', 'providerPostId'];

do $$
begin
  if exists (
    select 1
    from public.audit_events
    where action = 'meta_publication_published'
      and metadata ?| array['providerMediaId', 'providerPostId']
  ) then
    raise exception 'meta publication published audit provider ids remain';
  end if;
end;
$$;

-- META_PUBLICATION_AUDIT_PROVIDER_ID_REDACTION_END

-- META_FACEBOOK_SCHEDULED_PUBLICATION_FOUNDATION_BEGIN

alter table public.company_social_publications
  add column if not exists scheduled_for timestamptz,
  add column if not exists scheduled_timezone text,
  add column if not exists scheduled_attachment_sha256 bytea,
  add column if not exists scheduled_analysis_run_id uuid references public.company_media_analysis_runs(id) on delete restrict,
  add column if not exists scheduled_attachment_result_id uuid references public.company_media_analysis_attachment_results(id) on delete restrict,
  add column if not exists scheduled_approval_id uuid references public.company_social_publication_media_approvals(id) on delete restrict,
  add column if not exists scheduled_facebook_page_id text,
  add column if not exists scheduled_by_name text,
  add column if not exists scheduled_by_role text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete restrict,
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists execution_attempts integer not null default 0,
  add column if not exists last_scheduler_error_code text;

alter table public.company_social_publications
  drop constraint if exists company_social_publications_status_check,
  drop constraint if exists company_social_publications_state_shape_check,
  drop constraint if exists company_social_publications_scheduled_timezone_check,
  drop constraint if exists company_social_publications_scheduled_sha_check,
  drop constraint if exists company_social_publications_scheduled_page_check,
  drop constraint if exists company_social_publications_scheduled_actor_check,
  drop constraint if exists company_social_publications_claim_shape_check,
  drop constraint if exists company_social_publications_execution_attempts_check,
  drop constraint if exists company_social_publications_scheduler_error_check;

alter table public.company_social_publications
  add constraint company_social_publications_status_check
    check (status in ('scheduled', 'publishing', 'published', 'failed', 'delivery_unknown', 'cancelled')),
  add constraint company_social_publications_scheduled_timezone_check
    check (scheduled_timezone is null or (
      char_length(scheduled_timezone) between 1 and 80
      and scheduled_timezone ~ '^[A-Za-z][A-Za-z0-9_./+-]{0,79}$'
      and scheduled_timezone not like '%..%'
    )),
  add constraint company_social_publications_scheduled_sha_check
    check (scheduled_attachment_sha256 is null or octet_length(scheduled_attachment_sha256) = 32),
  add constraint company_social_publications_scheduled_page_check
    check (scheduled_facebook_page_id is null or (
      char_length(scheduled_facebook_page_id) between 1 and 40
      and scheduled_facebook_page_id ~ '^[0-9]+$'
    )),
  add constraint company_social_publications_scheduled_actor_check
    check (
      (scheduled_by_name is null and scheduled_by_role is null)
      or (
        scheduled_by_name is not null
        and char_length(btrim(scheduled_by_name)) between 1 and 120
        and scheduled_by_name !~ '[[:cntrl:]<>]'
        and scheduled_by_role is not null
        and char_length(btrim(scheduled_by_role)) between 1 and 80
        and scheduled_by_role !~ '[[:cntrl:]<>]'
      )
    ),
  add constraint company_social_publications_claim_shape_check
    check (
      (claim_token is null and claimed_at is null and claim_expires_at is null)
      or (
        status = 'scheduled'
        and claim_token is not null
        and claimed_at is not null
        and claim_expires_at is not null
        and claim_expires_at > claimed_at
      )
    ),
  add constraint company_social_publications_execution_attempts_check
    check (execution_attempts >= 0),
  add constraint company_social_publications_scheduler_error_check
    check (
      last_scheduler_error_code is null
      or last_scheduler_error_code = 'META_SCHEDULE_REVALIDATION_FAILED'
    ),
  add constraint company_social_publications_state_shape_check
  check (
    (status = 'scheduled'
      and attempts = 0
      and provider_post_id is null
      and provider_media_id is null
      and published_at is null
      and provider_http_status is null
      and provider_error_code is null
      and provider_error_subcode is null
      and provider_error_category is null
      and provider_is_transient is null
      and last_error_code is null
      and last_scheduler_error_code is null
      and scheduled_for is not null
      and scheduled_timezone is not null
      and scheduled_facebook_page_id is not null
      and scheduled_by_name is not null
      and scheduled_by_role is not null
      and cancelled_at is null
      and cancelled_by is null
      and next_attempt_at is not null
      and (
        (publication_kind = 'text_only'
          and attachment_id is null
          and safe_mime_type is null
          and media_count = 0
          and scheduled_attachment_sha256 is null
          and scheduled_analysis_run_id is null
          and scheduled_attachment_result_id is null
          and scheduled_approval_id is null)
        or (publication_kind = 'single_photo'
          and attachment_id is not null
          and safe_mime_type in ('image/jpeg', 'image/png')
          and media_count = 1
          and scheduled_attachment_sha256 is not null
          and scheduled_analysis_run_id is not null
          and scheduled_attachment_result_id is not null
          and scheduled_approval_id is not null)
      ))
    or (status = 'publishing'
      and attempts = 0
      and provider_post_id is null
      and provider_media_id is null
      and published_at is null
      and provider_http_status is null
      and provider_error_code is null
      and provider_error_subcode is null
      and provider_error_category is null
      and provider_is_transient is null
      and last_error_code is null
      and last_scheduler_error_code is null
      and claim_token is null
      and claimed_at is null
      and claim_expires_at is null
      and next_attempt_at is null
      and cancelled_at is null
      and cancelled_by is null)
    or (status = 'published'
      and attempts = 1
      and published_at is not null
      and provider_http_status is null
      and provider_error_code is null
      and provider_error_subcode is null
      and provider_error_category is null
      and provider_is_transient is null
      and last_error_code is null
      and last_scheduler_error_code is null
      and claim_token is null
      and claimed_at is null
      and claim_expires_at is null
      and next_attempt_at is null
      and cancelled_at is null
      and cancelled_by is null
      and (
        (publication_kind = 'text_only' and provider_post_id is not null and provider_media_id is null)
        or (publication_kind = 'single_photo' and provider_post_id is null and provider_media_id is not null)
      ))
    or (status = 'failed'
      and provider_post_id is null
      and provider_media_id is null
      and published_at is null
      and claim_token is null
      and claimed_at is null
      and claim_expires_at is null
      and next_attempt_at is null
      and cancelled_at is null
      and cancelled_by is null
      and (
        (attempts = 1
          and provider_error_category is not null
          and last_error_code is not null
          and last_scheduler_error_code is null)
        or (attempts = 0
          and scheduled_for is not null
          and provider_http_status is null
          and provider_error_code is null
          and provider_error_subcode is null
          and provider_error_category is null
          and provider_is_transient is null
          and last_error_code = 'META_SCHEDULE_REVALIDATION_FAILED'
          and last_scheduler_error_code = 'META_SCHEDULE_REVALIDATION_FAILED')
      ))
    or (status = 'delivery_unknown'
      and attempts = 1
      and provider_post_id is null
      and provider_media_id is null
      and published_at is null
      and provider_error_category = 'DELIVERY_UNKNOWN'
      and last_error_code = 'META_PUBLICATION_DELIVERY_UNKNOWN'
      and last_scheduler_error_code is null
      and claim_token is null
      and claimed_at is null
      and claim_expires_at is null
      and next_attempt_at is null
      and cancelled_at is null
      and cancelled_by is null)
    or (status = 'cancelled'
      and attempts = 0
      and provider_post_id is null
      and provider_media_id is null
      and published_at is null
      and provider_http_status is null
      and provider_error_code is null
      and provider_error_subcode is null
      and provider_error_category is null
      and provider_is_transient is null
      and last_error_code is null
      and last_scheduler_error_code is null
      and scheduled_for is not null
      and scheduled_timezone is not null
      and scheduled_facebook_page_id is not null
      and cancelled_at is not null
      and cancelled_by is not null
      and claim_token is null
      and claimed_at is null
      and claim_expires_at is null
      and next_attempt_at is null)
  );

create index if not exists company_social_publications_scheduled_due_idx
  on public.company_social_publications (next_attempt_at, scheduled_for, created_at, id)
  where status = 'scheduled';

create index if not exists company_social_publications_scheduled_lookup_idx
  on public.company_social_publications (company_id, job_id, status, scheduled_for desc)
  where scheduled_for is not null;

create or replace function public.schedule_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_connection_id uuid,
  p_job_id uuid,
  p_idempotency_key uuid,
  p_approved_message text,
  p_publication_kind text,
  p_attachment_id uuid,
  p_attachment_sha256 bytea,
  p_analysis_run_id uuid,
  p_attachment_result_id uuid,
  p_approval_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text,
  p_scheduled_for timestamptz,
  p_scheduled_timezone text
)
returns table (
  publication_id uuid,
  publication_status text,
  publication_scheduled_for timestamptz,
  publication_last_error_code text,
  should_schedule boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_connection public.company_social_connections%rowtype;
  selected_attachment public.job_attachments%rowtype;
  selected_result public.company_media_analysis_attachment_results%rowtype;
  selected_approval public.company_social_publication_media_approvals%rowtype;
  existing_publication public.company_social_publications%rowtype;
  created_publication public.company_social_publications%rowtype;
  computed_message_sha256 bytea;
  computed_intent_sha256 bytea;
  computed_safe_mime_type text;
  computed_media_count smallint;
  database_now timestamptz;
begin
  database_now := clock_timestamp();

  if p_scheduled_for is null
    or p_scheduled_for <= database_now
    or p_scheduled_for > database_now + interval '366 days'
    or p_scheduled_timezone is null
    or char_length(p_scheduled_timezone) not between 1 and 80
    or p_scheduled_timezone !~ '^[A-Za-z][A-Za-z0-9_./+-]{0,79}$'
    or p_scheduled_timezone like '%..%'
    or not exists (select 1 from pg_timezone_names where name = p_scheduled_timezone)
    or p_publication_kind not in ('text_only', 'single_photo')
    or p_approved_message is null
    or p_approved_message <> btrim(p_approved_message)
    or char_length(p_approved_message) not between 1 and 5000
    or translate(p_approved_message, E'\n', '') ~ '[[:cntrl:]]'
    or lower(p_approved_message) like '%[private]%'
    or p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_name ~ '[[:cntrl:]<>]'
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or p_actor_role ~ '[[:cntrl:]<>]' then
    raise exception 'invalid scheduled publication request';
  end if;

  perform 1 from public.companies where id = p_company_id for update;
  if not found then raise exception 'company not found'; end if;

  perform 1
  from public.jobs
  where id = p_job_id
    and company_id = p_company_id
    and status::text in ('Completed', 'Warranty')
  for update;
  if not found then raise exception 'invalid scheduled publication job'; end if;

  select * into selected_connection
  from public.company_social_connections
  where id = p_connection_id
    and company_id = p_company_id
    and provider = 'meta-facebook-login'
  for update;
  if not found
    or selected_connection.status <> 'connected'
    or selected_connection.facebook_page_id is null
    or selected_connection.facebook_page_name is null
    or selected_connection.token_envelope is null
    or not ('pages_manage_posts' = any(selected_connection.granted_scopes)) then
    raise exception 'facebook scheduling unavailable';
  end if;

  if p_publication_kind = 'text_only' then
    if p_attachment_id is not null
      or p_attachment_sha256 is not null
      or p_analysis_run_id is not null
      or p_attachment_result_id is not null
      or p_approval_id is not null then
      raise exception 'invalid text-only schedule media fields';
    end if;
    computed_safe_mime_type := null;
    computed_media_count := 0;
  else
    if p_attachment_id is null
      or octet_length(p_attachment_sha256) <> 32
      or p_analysis_run_id is null
      or p_attachment_result_id is null
      or p_approval_id is null then
      raise exception 'invalid scheduled photo request';
    end if;

    select * into selected_attachment
    from public.job_attachments
    where id = p_attachment_id
      and company_id = p_company_id
      and job_id = p_job_id
    for key share;
    if not found
      or selected_attachment.kind::text = 'video'
      or lower(selected_attachment.mime_type) not in ('image/jpeg', 'image/png')
      or selected_attachment.size_bytes not between 1 and 12000000
      or selected_attachment.storage_bucket is null
      or selected_attachment.storage_path is null then
      raise exception 'invalid scheduled photo attachment';
    end if;

    select ar.* into selected_result
    from public.company_media_analysis_attachment_results ar
    join public.company_media_analysis_runs run
      on run.id = ar.analysis_run_id
      and run.company_id = p_company_id
      and run.job_id = p_job_id
      and run.status = 'completed'
    where ar.id = p_attachment_result_id
      and ar.analysis_run_id = p_analysis_run_id
      and ar.company_id = p_company_id
      and ar.job_id = p_job_id
      and ar.attachment_id = p_attachment_id
      and ar.attachment_sha256 = p_attachment_sha256
      and ar.detected_mime_type = lower(selected_attachment.mime_type)
      and ar.excluded = false
      and ar.analysis_status in ('analyzed', 'metadata_only')
      and ar.privacy_review_status in ('passed', 'resolved_false_positive')
      and not exists (
        select 1
        from public.company_media_analysis_attachment_results newer
        where newer.company_id = p_company_id
          and newer.job_id = p_job_id
          and newer.attachment_id = p_attachment_id
          and (newer.created_at, newer.id) > (ar.created_at, ar.id)
      )
    for key share;
    if not found then raise exception 'scheduled media analysis evidence unavailable'; end if;

    select * into selected_approval
    from public.company_social_publication_media_approvals approval
    where approval.id = p_approval_id
      and approval.company_id = p_company_id
      and approval.job_id = p_job_id
      and approval.attachment_id = p_attachment_id
      and approval.analysis_run_id = p_analysis_run_id
      and approval.attachment_sha256 = p_attachment_sha256
      and approval.attachment_mime_type = lower(selected_attachment.mime_type)
      and approval.approval_status = 'approved'
      and approval.revoked_at is null
    for key share;
    if not found then raise exception 'scheduled media approval unavailable'; end if;

    if exists (
      select 1
      from public.company_media_analysis_privacy_findings finding
      where finding.attachment_result_id = selected_result.id
        and finding.company_id = p_company_id
        and finding.job_id = p_job_id
        and finding.attachment_id = p_attachment_id
        and finding.resolved_as_false_positive = false
    ) then
      raise exception 'unresolved scheduled media privacy finding';
    end if;

    computed_safe_mime_type := lower(selected_attachment.mime_type);
    computed_media_count := 1;
  end if;

  computed_message_sha256 := sha256(convert_to(p_approved_message, 'UTF8'));
  computed_intent_sha256 := sha256(convert_to(concat_ws(E'\n',
    'facebook_scheduled_publication_intent_v1',
    'meta-facebook-login',
    'Facebook',
    p_company_id::text,
    p_job_id::text,
    p_connection_id::text,
    selected_connection.facebook_page_id,
    p_actor_id::text,
    p_publication_kind,
    p_approved_message,
    case when p_publication_kind = 'single_photo' then p_attachment_id::text else '' end,
    to_char(p_scheduled_for at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    p_scheduled_timezone
  ), 'UTF8'));

  select * into existing_publication
  from public.company_social_publications
  where company_id = p_company_id
    and publication_intent_sha256 = computed_intent_sha256;

  if found then
    return query select
      existing_publication.id,
      existing_publication.status,
      existing_publication.scheduled_for,
      existing_publication.last_error_code,
      false;
    return;
  end if;

  insert into public.company_social_publications (
    id, company_id, connection_id, job_id, provider, channel, status,
    idempotency_key, publication_intent_sha256, approved_message, message_sha256,
    publication_kind, attachment_id, safe_mime_type, media_count, approved_by,
    approved_at, scheduled_for, scheduled_timezone, scheduled_attachment_sha256,
    scheduled_analysis_run_id, scheduled_attachment_result_id, scheduled_approval_id,
    scheduled_facebook_page_id, scheduled_by_name, scheduled_by_role,
    next_attempt_at, execution_attempts, created_at, updated_at
  ) values (
    p_publication_id, p_company_id, p_connection_id, p_job_id, 'meta-facebook-login', 'Facebook', 'scheduled',
    p_idempotency_key, computed_intent_sha256, p_approved_message, computed_message_sha256,
    p_publication_kind, p_attachment_id, computed_safe_mime_type, computed_media_count, p_actor_id,
    database_now, p_scheduled_for, p_scheduled_timezone, p_attachment_sha256,
    p_analysis_run_id, p_attachment_result_id, p_approval_id,
    selected_connection.facebook_page_id, btrim(p_actor_name), btrim(p_actor_role),
    p_scheduled_for, 0, database_now, database_now
  )
  returning * into created_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_scheduled', 'meta_social_publication', 'Facebook publication',
    created_publication.id::text, 'Facebook publication',
    'Meta publication scheduled.',
    jsonb_build_object(
      'channel', 'Facebook',
      'status', 'scheduled',
      'publicationKind', created_publication.publication_kind,
      'mediaCount', created_publication.media_count,
      'messageCharacterCount', char_length(created_publication.approved_message),
      'scheduledFor', created_publication.scheduled_for,
      'scheduledTimezone', created_publication.scheduled_timezone,
      'attachmentId', case when created_publication.publication_kind = 'single_photo' then created_publication.attachment_id::text else null end,
      'intentHashPrefix', encode(substring(created_publication.publication_intent_sha256 from 1 for 8), 'hex'),
      'providerCallCount', 0
    )
  );

  return query select created_publication.id, created_publication.status, created_publication.scheduled_for, created_publication.last_error_code, true;
end;
$$;

create or replace function public.cancel_scheduled_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_actor_id uuid,
  p_actor_name text,
  p_actor_role text
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
  database_now timestamptz;
begin
  database_now := clock_timestamp();

  if p_actor_name is null
    or char_length(btrim(p_actor_name)) not between 1 and 120
    or p_actor_name ~ '[[:cntrl:]<>]'
    or p_actor_role is null
    or char_length(btrim(p_actor_role)) not between 1 and 80
    or p_actor_role ~ '[[:cntrl:]<>]' then
    raise exception 'invalid schedule cancellation request';
  end if;

  select * into selected_publication
  from public.company_social_publications
  where id = p_publication_id
    and company_id = p_company_id
  for update;
  if not found then raise exception 'scheduled publication not found'; end if;

  if selected_publication.status = 'cancelled' then
    return next selected_publication;
    return;
  end if;
  if selected_publication.status <> 'scheduled' then
    raise exception 'invalid scheduled publication cancellation';
  end if;

  update public.company_social_publications
  set status = 'cancelled',
      cancelled_at = database_now,
      cancelled_by = p_actor_id,
      claim_token = null,
      claimed_at = null,
      claim_expires_at = null,
      next_attempt_at = null,
      updated_at = database_now
  where id = selected_publication.id
  returning * into updated_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, p_actor_id, btrim(p_actor_name), btrim(p_actor_role), 'access',
    'meta_publication_schedule_cancelled', 'meta_social_publication', 'Facebook publication',
    updated_publication.id::text, 'Facebook publication',
    'Meta scheduled publication cancelled.',
    jsonb_build_object(
      'channel', 'Facebook',
      'status', 'cancelled',
      'publicationKind', updated_publication.publication_kind,
      'mediaCount', updated_publication.media_count,
      'scheduledFor', updated_publication.scheduled_for,
      'scheduledTimezone', updated_publication.scheduled_timezone,
      'attachmentId', case when updated_publication.publication_kind = 'single_photo' then updated_publication.attachment_id::text else null end,
      'intentHashPrefix', encode(substring(updated_publication.publication_intent_sha256 from 1 for 8), 'hex'),
      'providerCallCount', 0
    )
  );

  return next updated_publication;
end;
$$;

create or replace function public.claim_due_company_facebook_publications(
  p_lease_seconds integer default 120,
  p_limit integer default 10
)
returns table (
  publication_id uuid,
  company_id uuid,
  connection_id uuid,
  job_id uuid,
  publication_kind text,
  attachment_id uuid,
  scheduled_for timestamptz,
  scheduled_timezone text,
  claim_token uuid,
  claim_expires_at timestamptz,
  execution_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  database_now timestamptz;
begin
  database_now := clock_timestamp();

  if p_lease_seconds not between 30 and 900
    or p_limit not between 1 and 50 then
    raise exception 'invalid scheduled publication claim request';
  end if;

  return query
  with due as (
    select publication.id
    from public.company_social_publications publication
    where publication.status = 'scheduled'
      and publication.scheduled_for <= database_now
      and publication.next_attempt_at <= database_now
      and (publication.claim_token is null or publication.claim_expires_at <= database_now)
    order by publication.scheduled_for asc, publication.created_at asc, publication.id asc
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.company_social_publications publication
    set claim_token = gen_random_uuid(),
        claimed_at = database_now,
        claim_expires_at = database_now + make_interval(secs => p_lease_seconds),
        execution_attempts = publication.execution_attempts + 1,
        updated_at = database_now
    from due
    where publication.id = due.id
    returning publication.*
  )
  select
    claimed.id,
    claimed.company_id,
    claimed.connection_id,
    claimed.job_id,
    claimed.publication_kind,
    claimed.attachment_id,
    claimed.scheduled_for,
    claimed.scheduled_timezone,
    claimed.claim_token,
    claimed.claim_expires_at,
    claimed.execution_attempts
  from claimed
  order by claimed.scheduled_for asc, claimed.created_at asc, claimed.id asc;
end;
$$;

create or replace function public.release_scheduled_company_facebook_publication_claim(
  p_publication_id uuid,
  p_company_id uuid,
  p_claim_token uuid,
  p_next_attempt_at timestamptz
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_publication public.company_social_publications%rowtype;
  database_now timestamptz;
begin
  database_now := clock_timestamp();

  if p_next_attempt_at is null
    or p_next_attempt_at <= database_now
    or p_next_attempt_at > database_now + interval '1 day' then
    raise exception 'invalid scheduled publication release request';
  end if;

  update public.company_social_publications
  set claim_token = null,
      claimed_at = null,
      claim_expires_at = null,
      next_attempt_at = p_next_attempt_at,
      updated_at = database_now
  where id = p_publication_id
    and company_id = p_company_id
    and status = 'scheduled'
    and claim_token = p_claim_token
    and claim_expires_at > database_now
  returning * into updated_publication;
  if not found then raise exception 'invalid scheduled publication claim release'; end if;

  return next updated_publication;
end;
$$;

create or replace function public.fail_scheduled_company_facebook_publication_preflight(
  p_publication_id uuid,
  p_company_id uuid,
  p_claim_token uuid
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
  database_now timestamptz;
begin
  database_now := clock_timestamp();

  select * into locked_publication
  from public.company_social_publications
  where id = p_publication_id
    and company_id = p_company_id
    and status = 'scheduled'
    and claim_token = p_claim_token
    and claim_expires_at > database_now
  for update;
  if not found then raise exception 'invalid scheduled publication preflight failure'; end if;

  update public.company_social_publications
  set status = 'failed',
      attempts = 0,
      provider_post_id = null,
      provider_media_id = null,
      provider_http_status = null,
      provider_error_code = null,
      provider_error_subcode = null,
      provider_error_category = null,
      provider_is_transient = null,
      last_error_code = 'META_SCHEDULE_REVALIDATION_FAILED',
      last_scheduler_error_code = 'META_SCHEDULE_REVALIDATION_FAILED',
      claim_token = null,
      claimed_at = null,
      claim_expires_at = null,
      next_attempt_at = null,
      published_at = null,
      updated_at = database_now
  where id = locked_publication.id
  returning * into updated_publication;

  insert into public.audit_events (
    company_id, actor_user_id, actor_name, actor_role, category, action,
    resource_type, resource, resource_id, resource_label, details, metadata
  ) values (
    p_company_id, locked_publication.approved_by, locked_publication.scheduled_by_name,
    locked_publication.scheduled_by_role, 'access',
    'meta_publication_schedule_failed', 'meta_social_publication', 'Facebook publication',
    updated_publication.id::text, 'Facebook publication',
    'Meta scheduled publication failed before provider call.',
    jsonb_build_object(
      'channel', 'Facebook',
      'status', 'failed',
      'publicationKind', updated_publication.publication_kind,
      'mediaCount', updated_publication.media_count,
      'scheduledFor', updated_publication.scheduled_for,
      'scheduledTimezone', updated_publication.scheduled_timezone,
      'attachmentId', case when updated_publication.publication_kind = 'single_photo' then updated_publication.attachment_id::text else null end,
      'intentHashPrefix', encode(substring(updated_publication.publication_intent_sha256 from 1 for 8), 'hex'),
      'providerCallCount', 0,
      'attempts', 0,
      'errorCode', 'META_SCHEDULE_REVALIDATION_FAILED'
    )
  );

  return next updated_publication;
end;
$$;

create or replace function public.start_scheduled_company_facebook_publication(
  p_publication_id uuid,
  p_company_id uuid,
  p_claim_token uuid
)
returns setof public.company_social_publications
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_publication public.company_social_publications%rowtype;
  selected_connection public.company_social_connections%rowtype;
  selected_attachment public.job_attachments%rowtype;
  selected_result public.company_media_analysis_attachment_results%rowtype;
  selected_approval public.company_social_publication_media_approvals%rowtype;
  updated_publication public.company_social_publications%rowtype;
  database_now timestamptz;
begin
  database_now := clock_timestamp();

  -- Lock order: publication, job, connection, attachment, analysis result, approval, privacy read.
  select * into locked_publication
  from public.company_social_publications
  where id = p_publication_id
    and company_id = p_company_id
    and status = 'scheduled'
    and claim_token = p_claim_token
    and claim_expires_at > database_now
    and scheduled_for <= database_now
  for update;
  if not found then raise exception 'invalid scheduled publication start'; end if;

  perform 1
  from public.jobs
  where id = locked_publication.job_id
    and company_id = locked_publication.company_id
    and status::text in ('Completed', 'Warranty')
  for update;
  if not found then raise exception 'scheduled publication job unavailable'; end if;

  select * into selected_connection
  from public.company_social_connections
  where id = locked_publication.connection_id
    and company_id = locked_publication.company_id
    and provider = 'meta-facebook-login'
  for update;
  if not found
    or selected_connection.status <> 'connected'
    or selected_connection.facebook_page_id <> locked_publication.scheduled_facebook_page_id
    or selected_connection.token_envelope is null
    or not ('pages_manage_posts' = any(selected_connection.granted_scopes)) then
    raise exception 'scheduled publication connection unavailable';
  end if;

  if locked_publication.publication_kind = 'single_photo' then
    select * into selected_attachment
    from public.job_attachments
    where id = locked_publication.attachment_id
      and company_id = locked_publication.company_id
      and job_id = locked_publication.job_id
    for update;
    if not found
      or selected_attachment.kind::text = 'video'
      or lower(selected_attachment.mime_type) <> locked_publication.safe_mime_type
      or selected_attachment.size_bytes not between 1 and 12000000
      or selected_attachment.storage_bucket is null
      or selected_attachment.storage_path is null then
      raise exception 'scheduled publication attachment unavailable';
    end if;

    select ar.* into selected_result
    from public.company_media_analysis_attachment_results ar
    join public.company_media_analysis_runs run
      on run.id = ar.analysis_run_id
      and run.company_id = locked_publication.company_id
      and run.job_id = locked_publication.job_id
      and run.status = 'completed'
    where ar.id = locked_publication.scheduled_attachment_result_id
      and ar.analysis_run_id = locked_publication.scheduled_analysis_run_id
      and ar.company_id = locked_publication.company_id
      and ar.job_id = locked_publication.job_id
      and ar.attachment_id = locked_publication.attachment_id
      and ar.attachment_sha256 = locked_publication.scheduled_attachment_sha256
      and ar.detected_mime_type = locked_publication.safe_mime_type
      and ar.excluded = false
      and ar.analysis_status in ('analyzed', 'metadata_only')
      and ar.privacy_review_status in ('passed', 'resolved_false_positive')
      and not exists (
        select 1
        from public.company_media_analysis_attachment_results newer
        where newer.company_id = locked_publication.company_id
          and newer.job_id = locked_publication.job_id
          and newer.attachment_id = locked_publication.attachment_id
          and (newer.created_at, newer.id) > (ar.created_at, ar.id)
      )
    for update of ar;
    if not found then raise exception 'scheduled publication media evidence unavailable'; end if;

    select * into selected_approval
    from public.company_social_publication_media_approvals approval
    where approval.id = locked_publication.scheduled_approval_id
      and approval.company_id = locked_publication.company_id
      and approval.job_id = locked_publication.job_id
      and approval.attachment_id = locked_publication.attachment_id
      and approval.analysis_run_id = locked_publication.scheduled_analysis_run_id
      and approval.attachment_sha256 = locked_publication.scheduled_attachment_sha256
      and approval.attachment_mime_type = locked_publication.safe_mime_type
      and approval.approval_status = 'approved'
      and approval.revoked_at is null
    for update;
    if not found then raise exception 'scheduled publication approval unavailable'; end if;

    if exists (
      select 1
      from public.company_media_analysis_privacy_findings finding
      where finding.attachment_result_id = selected_result.id
        and finding.company_id = locked_publication.company_id
        and finding.job_id = locked_publication.job_id
        and finding.attachment_id = locked_publication.attachment_id
        and finding.resolved_as_false_positive = false
    ) then
      raise exception 'scheduled publication privacy finding unresolved';
    end if;
  end if;

  update public.company_social_publications
  set status = 'publishing',
      claim_token = null,
      claimed_at = null,
      claim_expires_at = null,
      next_attempt_at = null,
      updated_at = database_now
  where id = locked_publication.id
  returning * into updated_publication;

  return next updated_publication;
end;
$$;

revoke all on function public.schedule_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, text, uuid, bytea, uuid, uuid, uuid, uuid, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.cancel_scheduled_company_facebook_publication(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.claim_due_company_facebook_publications(integer, integer) from public, anon, authenticated;
revoke all on function public.release_scheduled_company_facebook_publication_claim(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_scheduled_company_facebook_publication_preflight(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.start_scheduled_company_facebook_publication(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.schedule_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, text, uuid, bytea, uuid, uuid, uuid, uuid, text, text, timestamptz, text) to service_role;
grant execute on function public.cancel_scheduled_company_facebook_publication(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.claim_due_company_facebook_publications(integer, integer) to service_role;
grant execute on function public.release_scheduled_company_facebook_publication_claim(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function public.fail_scheduled_company_facebook_publication_preflight(uuid, uuid, uuid) to service_role;
grant execute on function public.start_scheduled_company_facebook_publication(uuid, uuid, uuid) to service_role;

comment on function public.schedule_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, text, uuid, bytea, uuid, uuid, uuid, uuid, text, text, timestamptz, text) is
  'Creates an idempotent server-derived scheduled Facebook publication intent without calling Meta.';
comment on function public.claim_due_company_facebook_publications(integer, integer) is
  'Claims due scheduled Facebook publications with FOR UPDATE SKIP LOCKED while preserving provider attempts.';
comment on function public.start_scheduled_company_facebook_publication(uuid, uuid, uuid) is
  'Performs the final DB-only gate from scheduled to publishing immediately before a future provider call.';

-- META_FACEBOOK_SCHEDULED_PUBLICATION_FOUNDATION_END

-- META_FACEBOOK_SCHEDULED_WORKER_RECONCILIATION_BEGIN

create or replace function public.reconcile_stale_scheduled_company_facebook_publications(
  p_limit integer default 20
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  database_now timestamptz;
  locked_publication public.company_social_publications%rowtype;
  updated_publication public.company_social_publications%rowtype;
  reconciled_count integer := 0;
begin
  database_now := clock_timestamp();

  if p_limit not between 1 and 20 then
    raise exception 'invalid scheduled publication reconciliation request';
  end if;

  for locked_publication in
    select publication.*
    from public.company_social_publications publication
    where publication.scheduled_for is not null
      and publication.status = 'publishing'
      and publication.attempts = 0
      and publication.provider_post_id is null
      and publication.provider_media_id is null
      and publication.updated_at < database_now - interval '10 minutes'
    order by publication.updated_at asc, publication.created_at asc, publication.id asc
    limit p_limit
    for update skip locked
  loop
    update public.company_social_publications
    set status = 'delivery_unknown',
        attempts = 1,
        provider_post_id = null,
        provider_media_id = null,
        provider_http_status = null,
        provider_error_code = null,
        provider_error_subcode = null,
        provider_error_category = 'DELIVERY_UNKNOWN',
        provider_is_transient = null,
        last_error_code = 'META_PUBLICATION_DELIVERY_UNKNOWN',
        last_scheduler_error_code = null,
        claim_token = null,
        claimed_at = null,
        claim_expires_at = null,
        next_attempt_at = null,
        published_at = null,
        updated_at = database_now
    where id = locked_publication.id
    returning * into updated_publication;

    insert into public.audit_events (
      company_id, actor_user_id, actor_name, actor_role, category, action,
      resource_type, resource, resource_id, resource_label, details, metadata
    ) values (
      updated_publication.company_id,
      updated_publication.approved_by,
      updated_publication.scheduled_by_name,
      updated_publication.scheduled_by_role,
      'access',
      'meta_publication_delivery_unknown',
      'meta_social_publication',
      'Facebook publication',
      updated_publication.id::text,
      'Facebook publication',
      'Meta scheduled publication requires delivery reconciliation.',
      jsonb_build_object(
        'channel', 'Facebook',
        'status', 'delivery_unknown',
        'publicationKind', updated_publication.publication_kind,
        'mediaCount', updated_publication.media_count,
        'attachmentId', case when updated_publication.publication_kind = 'single_photo' then updated_publication.attachment_id::text else null end,
        'providerCallCount', 1,
        'deliveryUnknown', true,
        'repeatBlocked', true,
        'reconciliationRequired', true,
        'schedulerRecovery', true,
        'intentHashPrefix', encode(substring(updated_publication.publication_intent_sha256 from 1 for 8), 'hex'),
        'attempts', 1
      )
    );

    reconciled_count := reconciled_count + 1;
  end loop;

  return reconciled_count;
end;
$$;

revoke all on function public.reconcile_stale_scheduled_company_facebook_publications(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_stale_scheduled_company_facebook_publications(integer)
  to service_role;

comment on function public.reconcile_stale_scheduled_company_facebook_publications(integer) is
  'Conservatively marks stale scheduled publishing rows delivery_unknown without retrying Meta.';

-- META_FACEBOOK_SCHEDULED_WORKER_RECONCILIATION_END

-- META_FACEBOOK_SINGLE_ACTIVE_PUBLICATION_INVARIANT_BEGIN

do $$
begin
  if exists (
    select 1
    from public.company_social_publications
    where status in ('scheduled', 'publishing', 'delivery_unknown')
    group by company_id, job_id
    having count(*) > 1
  ) then
    raise exception 'cannot enforce one active Facebook publication per job while duplicates exist';
  end if;
end;
$$;

create unique index company_social_publications_one_active_per_job_uidx
  on public.company_social_publications (company_id, job_id)
  where status in ('scheduled', 'publishing', 'delivery_unknown');

-- META_FACEBOOK_SINGLE_ACTIVE_PUBLICATION_INVARIANT_END


-- REEL_AUTHORITATIVE_MEDIA_FINDINGS_BEGIN

create table public.company_media_analysis_content_findings (
  id uuid primary key,
  analysis_run_id uuid not null references public.company_media_analysis_runs(id) on delete cascade,
  attachment_result_id uuid not null references public.company_media_analysis_attachment_results(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  attachment_id uuid not null references public.job_attachments(id) on delete cascade,
  finding_id text not null,
  finding_category text not null,
  evidence_type text not null,
  confidence double precision not null,
  explanation text not null,
  risk_level text not null,
  requires_user_approval boolean not null,
  created_at timestamptz not null default now(),
  constraint company_media_analysis_content_findings_result_finding_unique
    unique (attachment_result_id, finding_id),
  constraint company_media_analysis_content_findings_id_check
    check (char_length(finding_id) between 1 and 120 and finding_id ~ '^[A-Za-z0-9_.:-]+$'),
  constraint company_media_analysis_content_findings_category_check
    check (finding_category in (
      'equipment_overview',
      'possible_problem_detail',
      'repair_process',
      'replacement_part',
      'finished_result',
      'low_information',
      'duplicate_candidate',
      'unclear'
    )),
  constraint company_media_analysis_content_findings_evidence_type_check
    check (evidence_type in ('visual_suggestion', 'metadata_only')),
  constraint company_media_analysis_content_findings_confidence_check
    check (confidence >= 0 and confidence <= 1),
  constraint company_media_analysis_content_findings_explanation_check
    check (
      explanation = btrim(explanation)
      and char_length(explanation) between 1 and 180
      and explanation !~ '[[:cntrl:]<>]'
    ),
  constraint company_media_analysis_content_findings_risk_check
    check (risk_level in ('low', 'medium', 'high'))
);

create index company_media_analysis_content_findings_authority_idx
  on public.company_media_analysis_content_findings
  (company_id, job_id, attachment_id, attachment_result_id);

alter table public.company_media_analysis_content_findings enable row level security;
revoke all on public.company_media_analysis_content_findings from public, anon, authenticated;
grant select, insert on public.company_media_analysis_content_findings to service_role;

create or replace function public.record_company_media_analysis_result(
  p_run_id uuid,
  p_company_id uuid,
  p_job_id uuid,
  p_correlation_id text,
  p_status text,
  p_provider text,
  p_model text,
  p_analysis_version text,
  p_attachments jsonb,
  p_timestamp timestamptz
)
returns table (
  attachment_id uuid,
  analysis_run_id uuid,
  attachment_result_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  finding jsonb;
  content_findings jsonb;
  result_id uuid;
  attachment_row public.job_attachments%rowtype;
  privacy_count integer;
  content_count integer;
  total_finding_count integer := 0;
  seen_attachment_ids text[] := array[]::text[];
  seen_finding_ids text[];
  item_keys text[];
  finding_keys text[];
  attachment_id_text text;
  checksum_text text;
  detected_mime text;
begin
  if p_status not in ('completed','failed')
    or p_correlation_id is null or char_length(p_correlation_id) not between 8 and 160 or p_correlation_id ~ '[[:cntrl:]<>]'
    or p_provider is null or char_length(p_provider) not between 1 and 120 or p_provider ~ '[[:cntrl:]<>]'
    or (p_model is not null and (char_length(p_model) > 120 or p_model ~ '[[:cntrl:]<>]'))
    or p_analysis_version <> 'media-analysis-v1'
    or p_timestamp is null
    or jsonb_typeof(p_attachments) <> 'array'
    or jsonb_array_length(p_attachments) > 4 then
    raise exception 'invalid media analysis persistence request';
  end if;
  perform 1 from public.jobs where id = p_job_id and company_id = p_company_id for key share;
  if not found then raise exception 'invalid media analysis job'; end if;

  insert into public.company_media_analysis_runs (
    id, company_id, job_id, correlation_id, status, provider, model, analysis_version,
    completed_at, created_at, updated_at
  ) values (
    p_run_id, p_company_id, p_job_id, p_correlation_id, p_status, p_provider, p_model, p_analysis_version,
    p_timestamp, p_timestamp, p_timestamp
  );

  for item in select value from jsonb_array_elements(p_attachments) value loop
    select coalesce(array_agg(key order by key), array[]::text[]) into item_keys from jsonb_object_keys(item) key;
    content_findings := coalesce(item->'contentFindings', '[]'::jsonb);
    attachment_id_text := item->>'attachmentId';
    checksum_text := item->>'attachmentSha256';
    detected_mime := lower(item->>'detectedMimeType');
    if jsonb_typeof(item) <> 'object'
      or (
        item_keys <> array['analysisStatus','attachmentId','attachmentSha256','detectedMimeType','privacyFindings']
        and item_keys <> array['analysisStatus','attachmentId','attachmentSha256','contentFindings','detectedMimeType','privacyFindings']
      )
      or jsonb_typeof(item->'attachmentId') <> 'string'
      or attachment_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or attachment_id_text = any(seen_attachment_ids)
      or jsonb_typeof(item->'attachmentSha256') <> 'string'
      or checksum_text !~ '^\\x[0-9a-f]{64}$'
      or jsonb_typeof(item->'detectedMimeType') <> 'string'
      or detected_mime not in ('image/jpeg','image/png','image/webp')
      or jsonb_typeof(item->'analysisStatus') <> 'string'
      or (item->>'analysisStatus') not in ('analyzed','metadata_only','manual_review')
      or jsonb_typeof(item->'privacyFindings') <> 'array'
      or jsonb_typeof(content_findings) <> 'array'
      or jsonb_array_length(item->'privacyFindings') + jsonb_array_length(content_findings) > 6 then
      raise exception 'invalid media analysis attachment payload';
    end if;
    select * into attachment_row
    from public.job_attachments
    where id = attachment_id_text::uuid
      and company_id = p_company_id
      and job_id = p_job_id
    for key share;
    if not found
      or attachment_row.kind::text <> 'photo'
      or lower(attachment_row.mime_type) <> detected_mime
      or attachment_row.size_bytes not between 1 and 12000000
      or attachment_row.storage_bucket is null
      or attachment_row.storage_path is null then
      raise exception 'invalid media analysis attachment';
    end if;

    seen_attachment_ids := array_append(seen_attachment_ids, attachment_id_text);
    result_id := gen_random_uuid();
    privacy_count := jsonb_array_length(item->'privacyFindings');
    content_count := jsonb_array_length(content_findings);
    total_finding_count := total_finding_count + privacy_count + content_count;
    if total_finding_count > 24 then
      raise exception 'invalid media analysis finding payload';
    end if;
    insert into public.company_media_analysis_attachment_results (
      id, analysis_run_id, company_id, job_id, attachment_id, attachment_sha256,
      detected_mime_type, analysis_status, privacy_review_status, excluded, created_at
    ) values (
      result_id, p_run_id, p_company_id, p_job_id, attachment_row.id,
      decode(substring(checksum_text from 3), 'hex'),
      detected_mime, item->>'analysisStatus',
      case when privacy_count > 0 then 'blocked' else 'passed' end,
      false, p_timestamp
    );

    seen_finding_ids := array[]::text[];
    for finding in select value from jsonb_array_elements(content_findings) value loop
      select coalesce(array_agg(key order by key), array[]::text[]) into finding_keys from jsonb_object_keys(finding) key;
      if jsonb_typeof(finding) <> 'object'
        or finding_keys <> array['confidence','evidenceType','explanation','findingCategory','findingId','requiresUserApproval','riskLevel']
        or jsonb_typeof(finding->'findingId') <> 'string'
        or jsonb_typeof(finding->'findingCategory') <> 'string'
        or jsonb_typeof(finding->'evidenceType') <> 'string'
        or jsonb_typeof(finding->'confidence') <> 'number'
        or jsonb_typeof(finding->'explanation') <> 'string'
        or jsonb_typeof(finding->'riskLevel') <> 'string'
        or jsonb_typeof(finding->'requiresUserApproval') <> 'boolean'
        or char_length(finding->>'findingId') not between 1 and 120
        or (finding->>'findingId') !~ '^[A-Za-z0-9_.:-]+$'
        or (finding->>'findingId') = any(seen_finding_ids)
        or (finding->>'findingCategory') not in (
          'equipment_overview','possible_problem_detail','repair_process','replacement_part',
          'finished_result','low_information','duplicate_candidate','unclear'
        )
        or (finding->>'evidenceType') not in ('visual_suggestion','metadata_only')
        or (finding->>'confidence')::double precision < 0
        or (finding->>'confidence')::double precision > 1
        or finding->>'explanation' <> btrim(finding->>'explanation')
        or char_length(finding->>'explanation') not between 1 and 180
        or (finding->>'explanation') ~ '[[:cntrl:]<>]'
        or (finding->>'riskLevel') not in ('low','medium','high') then
        raise exception 'invalid media analysis content finding payload';
      end if;
      seen_finding_ids := array_append(seen_finding_ids, finding->>'findingId');
      insert into public.company_media_analysis_content_findings (
        id, analysis_run_id, attachment_result_id, company_id, job_id, attachment_id,
        finding_id, finding_category, evidence_type, confidence, explanation,
        risk_level, requires_user_approval, created_at
      ) values (
        gen_random_uuid(), p_run_id, result_id, p_company_id, p_job_id, attachment_row.id,
        finding->>'findingId', finding->>'findingCategory', finding->>'evidenceType',
        (finding->>'confidence')::double precision, finding->>'explanation',
        finding->>'riskLevel', (finding->>'requiresUserApproval')::boolean, p_timestamp
      );
    end loop;

    for finding in select value from jsonb_array_elements(item->'privacyFindings') value loop
      select coalesce(array_agg(key order by key), array[]::text[]) into finding_keys from jsonb_object_keys(finding) key;
      if jsonb_typeof(finding) <> 'object'
        or finding_keys <> array['findingCategory','findingId','riskLevel']
        or jsonb_typeof(finding->'findingId') <> 'string'
        or jsonb_typeof(finding->'findingCategory') <> 'string'
        or jsonb_typeof(finding->'riskLevel') <> 'string'
        or char_length(finding->>'findingId') not between 1 and 120
        or (finding->>'findingId') !~ '^[A-Za-z0-9_.:-]+$'
        or (finding->>'findingId') = any(seen_finding_ids)
        or (finding->>'findingCategory') not in (
          'possible_face','possible_address','possible_phone_or_email','possible_license_plate',
          'possible_customer_document','possible_screen','possible_barcode',
          'possible_serial_or_nameplate','possible_personal_identifier','unknown_privacy_risk'
        )
        or (finding->>'riskLevel') not in ('low','medium','high') then
        raise exception 'invalid media analysis privacy finding payload';
      end if;
      seen_finding_ids := array_append(seen_finding_ids, finding->>'findingId');
      insert into public.company_media_analysis_privacy_findings (
        id, analysis_run_id, attachment_result_id, company_id, job_id, attachment_id,
        finding_id, finding_category, risk_level, resolved_as_false_positive, created_at
      ) values (
        gen_random_uuid(), p_run_id, result_id, p_company_id, p_job_id, attachment_row.id,
        finding->>'findingId', finding->>'findingCategory', finding->>'riskLevel', false, p_timestamp
      );
    end loop;

    attachment_id := attachment_row.id;
    analysis_run_id := p_run_id;
    attachment_result_id := result_id;
    return next;
  end loop;
end;
$$;

create or replace function public.list_company_reel_media_analysis_candidates(
  p_company_id uuid,
  p_job_id uuid,
  p_attachment_ids uuid[]
)
returns table (
  requested_position integer,
  attachment_id uuid,
  attachment_result_id uuid,
  analysis_run_id uuid,
  attachment_sha256 text,
  detected_mime_type text,
  analysis_status text,
  privacy_review_status text,
  excluded boolean,
  analysis_completed_at timestamptz,
  storage_bucket text,
  storage_path text,
  finding_id text,
  finding_category text,
  evidence_type text,
  confidence double precision,
  explanation text,
  risk_level text,
  requires_user_approval boolean,
  unresolved_privacy_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_attachment_ids is null
    or cardinality(p_attachment_ids) not between 1 and 4
    or exists (select 1 from unnest(p_attachment_ids) value where value is null)
    or cardinality(p_attachment_ids) <> (select count(distinct value) from unnest(p_attachment_ids) value) then
    raise exception 'invalid Reel media candidate request';
  end if;
  perform 1 from public.jobs where id = p_job_id and company_id = p_company_id;
  if not found then raise exception 'invalid Reel media candidate job'; end if;

  return query
  with requested as (
    select value as attachment_id, position::integer as requested_position
    from unnest(p_attachment_ids) with ordinality requested(value, position)
  ),
  latest_completed as (
    select distinct on (result.attachment_id)
      requested.requested_position,
      result.*,
      run.completed_at
    from requested
    join public.company_media_analysis_attachment_results result
      on result.attachment_id = requested.attachment_id
      and result.company_id = p_company_id
      and result.job_id = p_job_id
    join public.company_media_analysis_runs run
      on run.id = result.analysis_run_id
      and run.company_id = p_company_id
      and run.job_id = p_job_id
      and run.status = 'completed'
    order by result.attachment_id, result.created_at desc, result.id desc
  )
  select
    latest.requested_position,
    latest.attachment_id,
    latest.id,
    latest.analysis_run_id,
    ('\\x' || encode(latest.attachment_sha256, 'hex')),
    latest.detected_mime_type,
    latest.analysis_status,
    latest.privacy_review_status,
    latest.excluded,
    latest.completed_at,
    attachment.storage_bucket,
    attachment.storage_path,
    content.finding_id,
    content.finding_category,
    content.evidence_type,
    content.confidence,
    content.explanation,
    content.risk_level,
    content.requires_user_approval,
    coalesce(privacy.unresolved_count, 0)
  from latest_completed latest
  join public.job_attachments attachment
    on attachment.id = latest.attachment_id
    and attachment.company_id = p_company_id
    and attachment.job_id = p_job_id
    and attachment.kind::text <> 'video'
    and lower(attachment.mime_type) in ('image/jpeg','image/png','image/webp')
    and attachment.size_bytes between 1 and 12000000
    and attachment.storage_bucket is not null
    and attachment.storage_path is not null
  left join public.company_media_analysis_content_findings content
    on content.attachment_result_id = latest.id
    and content.analysis_run_id = latest.analysis_run_id
    and content.company_id = p_company_id
    and content.job_id = p_job_id
    and content.attachment_id = latest.attachment_id
  left join lateral (
    select count(*)::bigint as unresolved_count
    from public.company_media_analysis_privacy_findings finding
    where finding.attachment_result_id = latest.id
      and finding.analysis_run_id = latest.analysis_run_id
      and finding.company_id = p_company_id
      and finding.job_id = p_job_id
      and finding.attachment_id = latest.attachment_id
      and finding.resolved_as_false_positive = false
  ) privacy on true
  order by latest.requested_position, content.finding_category, content.finding_id;
end;
$$;

revoke all on function public.record_company_media_analysis_result(uuid, uuid, uuid, text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.record_company_media_analysis_result(uuid, uuid, uuid, text, text, text, text, text, jsonb, timestamptz) to service_role;
revoke all on function public.list_company_reel_media_analysis_candidates(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.list_company_reel_media_analysis_candidates(uuid, uuid, uuid[]) to service_role;

comment on table public.company_media_analysis_content_findings is
  'Server-authoritative non-privacy media-analysis findings. Historical results are intentionally not backfilled.';
comment on function public.list_company_reel_media_analysis_candidates(uuid, uuid, uuid[]) is
  'Returns latest completed server-authoritative Reel analysis evidence without requiring Facebook publication approval.';

-- REEL_AUTHORITATIVE_MEDIA_FINDINGS_END

-- REEL_RENDER_JOBS_BEGIN

create unique index jobs_id_company_reel_render_jobs_uidx
  on public.jobs (id, company_id);

create table public.company_reel_creative_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  schema_version text not null,
  plan_revision text not null,
  locale text not null,
  planning_revision text not null,
  local_facts jsonb not null,
  media_plan jsonb not null,
  plan_json jsonb not null,
  created_at timestamptz not null default now(),
  constraint company_reel_creative_plans_job_tenant_fk
    foreign key (job_id, company_id) references public.jobs(id, company_id) on delete cascade,
  constraint company_reel_creative_plans_revision_unique unique (company_id, job_id, plan_revision),
  constraint company_reel_creative_plans_tenant_identity_unique unique (id, company_id, job_id),
  constraint company_reel_creative_plans_schema_check check (schema_version = 'reel-creative-plan-v1'),
  constraint company_reel_creative_plans_revision_check check (
    char_length(plan_revision) between 8 and 180 and plan_revision ~ '^[A-Za-z0-9:_-]+$'
  ),
  constraint company_reel_creative_plans_locale_check check (
    char_length(locale) between 2 and 24 and locale ~ '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$'
  ),
  constraint company_reel_creative_plans_planning_revision_check check (
    char_length(planning_revision) between 8 and 180 and planning_revision ~ '^[A-Za-z0-9:_-]+$'
  ),
  constraint company_reel_creative_plans_snapshot_check check (
    jsonb_typeof(local_facts) = 'object'
    and jsonb_typeof(media_plan) = 'array'
    and jsonb_array_length(media_plan) between 2 and 4
    and jsonb_typeof(plan_json) = 'object'
    and plan_json->>'schemaVersion' = schema_version
    and plan_json->>'revision' = plan_revision
    and plan_json->>'decision' = 'create_reel'
  )
);

create table public.company_reel_render_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null,
  creative_plan_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'queued',
  render_fingerprint text not null,
  renderer_version text not null,
  attempt_count integer not null default 0,
  lease_token uuid,
  leased_until timestamptz,
  output_bucket text,
  video_object_path text,
  cover_object_path text,
  duration_ms integer,
  width integer,
  height integer,
  fps integer,
  video_codec text,
  pixel_format text,
  audio_streams integer,
  file_size bigint,
  faststart boolean,
  error_code text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint company_reel_render_jobs_job_tenant_fk
    foreign key (job_id, company_id) references public.jobs(id, company_id) on delete cascade,
  constraint company_reel_render_jobs_plan_tenant_fk
    foreign key (creative_plan_id, company_id, job_id)
    references public.company_reel_creative_plans(id, company_id, job_id) on delete restrict,
  constraint company_reel_render_jobs_fingerprint_unique
    unique (company_id, creative_plan_id, render_fingerprint),
  constraint company_reel_render_jobs_status_check
    check (status in ('queued', 'rendering', 'completed', 'failed')),
  constraint company_reel_render_jobs_fingerprint_check
    check (render_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint company_reel_render_jobs_renderer_check
    check (renderer_version = 'servicescope-reel-renderer-v1'),
  constraint company_reel_render_jobs_attempt_check
    check (attempt_count between 0 and 5),
  constraint company_reel_render_jobs_error_check
    check (error_code is null or error_code in (
      'REEL_RENDER_INVALID_PLAN','REEL_RENDER_UNAUTHORIZED','REEL_RENDER_AUDIO_UNSUPPORTED',
      'REEL_RENDER_MEDIA_INVALID','REEL_RENDER_MEDIA_MISSING','REEL_RENDER_TEXT_OVERFLOW',
      'REEL_RENDER_TIMEOUT','REEL_RENDER_FAILED','REEL_RENDER_OUTPUT_INVALID','REEL_RENDER_CONTEXT_STALE'
    )),
  constraint company_reel_render_jobs_state_check check (
    (status = 'queued' and attempt_count = 0 and lease_token is null and leased_until is null
      and started_at is null and completed_at is null and output_bucket is null and error_code is null)
    or (status = 'rendering' and attempt_count between 1 and 5 and lease_token is not null
      and leased_until is not null and started_at is not null and completed_at is null
      and output_bucket is null and error_code is null)
    or (status = 'completed' and attempt_count between 1 and 5 and lease_token is not null
      and leased_until is null and started_at is not null and completed_at is not null
      and output_bucket = 'company-reel-renders'
      and video_object_path is not null and cover_object_path is not null
      and duration_ms between 12000 and 25000 and width = 1080 and height = 1920 and fps = 30
      and video_codec = 'h264' and pixel_format = 'yuv420p' and audio_streams = 0
      and file_size between 1 and 104857600 and faststart = true and error_code is null)
    or (status = 'failed' and attempt_count between 1 and 5 and lease_token is null
      and leased_until is null and started_at is not null and completed_at is not null
      and output_bucket is null and video_object_path is null and cover_object_path is null
      and duration_ms is null and width is null and height is null and fps is null
      and video_codec is null and pixel_format is null and audio_streams is null
      and file_size is null and faststart is null and error_code is not null)
  )
);

create or replace function public.prevent_company_reel_creative_plan_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Reel creative plans are immutable';
end;
$$;

create trigger company_reel_creative_plans_immutable
before update on public.company_reel_creative_plans
for each row execute function public.prevent_company_reel_creative_plan_update();

create or replace function public.protect_company_reel_render_job_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.company_id, new.job_id, new.creative_plan_id, new.requested_by,
      new.render_fingerprint, new.renderer_version, new.created_at)
    is distinct from
     (old.company_id, old.job_id, old.creative_plan_id, old.requested_by,
      old.render_fingerprint, old.renderer_version, old.created_at) then
    raise exception 'Reel render job identity is immutable';
  end if;
  return new;
end;
$$;

create trigger company_reel_render_jobs_identity_immutable
before update on public.company_reel_render_jobs
for each row execute function public.protect_company_reel_render_job_identity();

create index company_reel_creative_plans_job_created_idx
  on public.company_reel_creative_plans (company_id, job_id, created_at desc);
create index company_reel_render_jobs_job_created_idx
  on public.company_reel_render_jobs (company_id, job_id, created_at desc);
create index company_reel_render_jobs_claim_idx
  on public.company_reel_render_jobs (status, leased_until, created_at, id);

alter table public.company_reel_creative_plans enable row level security;
alter table public.company_reel_render_jobs enable row level security;
revoke all on public.company_reel_creative_plans from public, anon, authenticated;
revoke all on public.company_reel_render_jobs from public, anon, authenticated;
grant select, insert on public.company_reel_creative_plans to service_role;
grant select, insert, update on public.company_reel_render_jobs to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-reel-renders', 'company-reel-renders', false, 104857600, array['video/mp4','image/jpeg']::text[])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.persist_company_reel_creative_plan(
  p_company_id uuid,
  p_job_id uuid,
  p_created_by uuid,
  p_schema_version text,
  p_plan_revision text,
  p_locale text,
  p_planning_revision text,
  p_local_facts jsonb,
  p_media_plan jsonb,
  p_plan_json jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_id uuid;
  local_keys text[];
  item jsonb;
  item_keys text[];
  seen_ids text[] := array[]::text[];
  expected_position integer := 1;
begin
  perform 1 from public.jobs where id = p_job_id and company_id = p_company_id for key share;
  if not found or not exists (select 1 from auth.users where id = p_created_by) then
    raise exception 'invalid Reel creative plan authority';
  end if;
  select coalesce(array_agg(key order by key), array[]::text[]) into local_keys
  from jsonb_object_keys(p_local_facts) key;
  if p_schema_version <> 'reel-creative-plan-v1'
    or p_plan_json->>'decision' <> 'create_reel'
    or p_plan_json->>'revision' <> p_plan_revision
    or local_keys <> array['diagnosis','finalResult','repairPerformed']
    or jsonb_typeof(p_media_plan) <> 'array'
    or jsonb_array_length(p_media_plan) not between 2 and 4 then
    raise exception 'invalid Reel creative plan snapshot';
  end if;
  for item in select value from jsonb_array_elements(p_media_plan) value loop
    select coalesce(array_agg(key order by key), array[]::text[]) into item_keys from jsonb_object_keys(item) key;
    if item_keys <> array['attachmentId','position']
      or (item->>'attachmentId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (item->>'attachmentId') = any(seen_ids)
      or (item->>'position')::integer <> expected_position then
      raise exception 'invalid Reel creative plan media snapshot';
    end if;
    perform 1 from public.job_attachments
    where id = (item->>'attachmentId')::uuid and company_id = p_company_id and job_id = p_job_id;
    if not found then raise exception 'invalid Reel creative plan attachment'; end if;
    seen_ids := array_append(seen_ids, item->>'attachmentId');
    expected_position := expected_position + 1;
  end loop;
  insert into public.company_reel_creative_plans (
    company_id, job_id, created_by, schema_version, plan_revision,
    locale, planning_revision, local_facts, media_plan, plan_json
  ) values (
    p_company_id, p_job_id, p_created_by, p_schema_version, p_plan_revision,
    p_locale, p_planning_revision, p_local_facts, p_media_plan, p_plan_json
  ) on conflict (company_id, job_id, plan_revision) do nothing
  returning id into result_id;
  if result_id is null then
    select id into result_id from public.company_reel_creative_plans
    where company_id = p_company_id and job_id = p_job_id and plan_revision = p_plan_revision
      and plan_json = p_plan_json and local_facts = p_local_facts and media_plan = p_media_plan;
  end if;
  if result_id is null then raise exception 'Reel creative plan revision conflict'; end if;
  return result_id;
end;
$$;

create or replace function public.can_access_company_ai_assistant(target_company_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select auth.uid() is not null and (
    exists (
      select 1
      from public.companies company
      where company.id = target_company_id
        and lower(company.owner_email::text) = lower(coalesce(auth.email(), ''))
    )
    or exists (
      select 1
      from public.company_users company_user
      left join public.company_profiles profile on profile.company_id = company_user.company_id
      where company_user.company_id = target_company_id
        and company_user.status = 'active'
        and (
          company_user.auth_user_id = auth.uid()
          or lower(company_user.email::text) = lower(coalesce(auth.email(), ''))
        )
        and case
          when profile.access_rules->>'aiAssistant' in ('full', 'readonly', 'off')
            then profile.access_rules->>'aiAssistant'
          else 'full'
        end <> 'off'
        and case
          when company_user.portal_access_rules->>'aiAssistant' in ('full', 'readonly', 'off')
            then company_user.portal_access_rules->>'aiAssistant'
          when company_user.role::text = 'technician' then 'off'
          else 'full'
        end <> 'off'
    )
  );
$$;

create or replace function public.get_company_reel_workspace(p_job_id uuid)
returns table (
  creative_plan_id uuid, plan_revision text, plan_json jsonb, plan_created_at timestamptz,
  render_job_id uuid, render_status text, render_error_code text,
  duration_ms integer, width integer, height integer,
  render_created_at timestamptz, render_started_at timestamptz, render_completed_at timestamptz,
  artifact_available boolean
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare target_company_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select company_id into target_company_id from public.jobs where id = p_job_id;
  if target_company_id is null or not public.can_access_company_ai_assistant(target_company_id) then
    raise exception 'FORBIDDEN';
  end if;
  return query
  select plan.id, plan.plan_revision, plan.plan_json, plan.created_at,
    render.id, render.status, render.error_code, render.duration_ms, render.width, render.height,
    render.created_at, render.started_at, render.completed_at,
    render.status = 'completed'
  from public.company_reel_creative_plans plan
  left join lateral (
    select job.* from public.company_reel_render_jobs job
    where job.creative_plan_id = plan.id order by job.created_at desc, job.id desc limit 1
  ) render on true
  where plan.company_id = target_company_id and plan.job_id = p_job_id
  order by plan.created_at desc, plan.id desc limit 1;
end;
$$;

create or replace function public.begin_company_reel_render_request(
  p_creative_plan_id uuid,
  p_expected_plan_revision text
)
returns table (render_job_id uuid, status text, error_code text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare plan public.company_reel_creative_plans%rowtype;
declare fingerprint text;
declare result public.company_reel_render_jobs%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into plan from public.company_reel_creative_plans where id = p_creative_plan_id for key share;
  if not found or plan.plan_revision <> p_expected_plan_revision
    or not public.can_access_company_ai_assistant(plan.company_id) then
    raise exception 'REEL_RENDER_PLAN_UNAVAILABLE';
  end if;
  fingerprint := encode(sha256(convert_to(concat_ws(E'\n',
    'reel-render-fingerprint-v1', plan.plan_revision, plan.plan_json::text,
    'servicescope-reel-renderer-v1', 'reel-presentation-v1', 'mp4-h264-yuv420p-faststart-v1'
  ), 'UTF8')), 'hex');
  insert into public.company_reel_render_jobs (
    company_id, job_id, creative_plan_id, requested_by, status,
    render_fingerprint, renderer_version
  ) values (
    plan.company_id, plan.job_id, plan.id, auth.uid(), 'queued',
    fingerprint, 'servicescope-reel-renderer-v1'
  ) on conflict (company_id, creative_plan_id, render_fingerprint) do nothing
  returning * into result;
  if result.id is null then
    select * into result from public.company_reel_render_jobs
    where company_id=plan.company_id and creative_plan_id=plan.id and render_fingerprint=fingerprint;
  end if;
  render_job_id := result.id; status := result.status; error_code := result.error_code; created_at := result.created_at;
  return next;
end;
$$;

-- 300s Vercel worker runtime plus a 60s reclaim buffer.
create or replace function public.claim_company_reel_render_job(p_render_job_id uuid, p_lease_seconds integer default 360)
returns setof public.company_reel_render_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_seconds not between 60 and 1800 then raise exception 'invalid Reel render lease'; end if;
  update public.company_reel_render_jobs job set
    status='failed', lease_token=null, leased_until=null, error_code='REEL_RENDER_FAILED',
    completed_at=clock_timestamp(), updated_at=clock_timestamp()
  where job.id=p_render_job_id and job.status='rendering' and job.attempt_count=5
    and job.leased_until <= clock_timestamp();
  return query
  update public.company_reel_render_jobs job set
    status='rendering', attempt_count=job.attempt_count+1, lease_token=gen_random_uuid(),
    leased_until=clock_timestamp()+make_interval(secs=>p_lease_seconds),
    started_at=coalesce(job.started_at,clock_timestamp()), updated_at=clock_timestamp()
  where job.id = p_render_job_id
    and job.attempt_count < 5
    and (job.status='queued' or (job.status='rendering' and job.leased_until <= clock_timestamp()))
  returning job.*;
end;
$$;

create or replace function public.release_company_reel_render_job_for_retry(
  p_render_job_id uuid,
  p_lease_token uuid
)
returns setof public.company_reel_render_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query update public.company_reel_render_jobs job set
    leased_until=clock_timestamp(), updated_at=clock_timestamp()
  where job.id=p_render_job_id and job.status='rendering' and job.lease_token=p_lease_token
    and job.leased_until > clock_timestamp() and job.attempt_count < 5
  returning job.*;
end;
$$;

create or replace function public.complete_company_reel_render_job(
  p_render_job_id uuid, p_lease_token uuid, p_output_bucket text,
  p_video_object_path text, p_cover_object_path text,
  p_duration_ms integer, p_width integer, p_height integer, p_fps integer,
  p_video_codec text, p_pixel_format text, p_audio_streams integer,
  p_file_size bigint, p_faststart boolean
)
returns setof public.company_reel_render_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query update public.company_reel_render_jobs job set
    status='completed', leased_until=null, output_bucket=p_output_bucket,
    video_object_path=p_video_object_path, cover_object_path=p_cover_object_path,
    duration_ms=p_duration_ms, width=p_width, height=p_height, fps=p_fps,
    video_codec=p_video_codec, pixel_format=p_pixel_format, audio_streams=p_audio_streams,
    file_size=p_file_size, faststart=p_faststart, completed_at=clock_timestamp(), updated_at=clock_timestamp()
  where job.id=p_render_job_id and job.status='rendering' and job.lease_token=p_lease_token
    and job.leased_until > clock_timestamp()
    and p_output_bucket='company-reel-renders'
    and p_video_object_path=job.company_id::text||'/'||job.id::text||'/reel.mp4'
    and p_cover_object_path=job.company_id::text||'/'||job.id::text||'/cover.jpg'
  returning job.*;
end;
$$;

create or replace function public.fail_company_reel_render_job(
  p_render_job_id uuid, p_lease_token uuid, p_error_code text
)
returns setof public.company_reel_render_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_error_code not in (
    'REEL_RENDER_INVALID_PLAN','REEL_RENDER_UNAUTHORIZED','REEL_RENDER_AUDIO_UNSUPPORTED',
    'REEL_RENDER_MEDIA_INVALID','REEL_RENDER_MEDIA_MISSING','REEL_RENDER_TEXT_OVERFLOW',
    'REEL_RENDER_TIMEOUT','REEL_RENDER_FAILED','REEL_RENDER_OUTPUT_INVALID','REEL_RENDER_CONTEXT_STALE'
  ) then raise exception 'invalid Reel render error'; end if;
  return query update public.company_reel_render_jobs job set
    status='failed', lease_token=null, leased_until=null, error_code=p_error_code,
    completed_at=clock_timestamp(), updated_at=clock_timestamp()
  where job.id=p_render_job_id and job.status='rendering' and job.lease_token=p_lease_token
    and job.leased_until > clock_timestamp()
  returning job.*;
end;
$$;

revoke all on function public.persist_company_reel_creative_plan(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.persist_company_reel_creative_plan(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.can_access_company_ai_assistant(uuid) from public, anon, authenticated;
grant execute on function public.can_access_company_ai_assistant(uuid) to service_role;
revoke all on function public.get_company_reel_workspace(uuid) from public, anon;
grant execute on function public.get_company_reel_workspace(uuid) to authenticated;
revoke all on function public.begin_company_reel_render_request(uuid,text) from public, anon;
grant execute on function public.begin_company_reel_render_request(uuid,text) to authenticated;
revoke all on function public.claim_company_reel_render_job(uuid,integer) from public, anon, authenticated;
revoke all on function public.release_company_reel_render_job_for_retry(uuid,uuid) from public, anon, authenticated;
revoke all on function public.complete_company_reel_render_job(uuid,uuid,text,text,text,integer,integer,integer,integer,text,text,integer,bigint,boolean) from public, anon, authenticated;
revoke all on function public.fail_company_reel_render_job(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_company_reel_render_job(uuid,integer) to service_role;
grant execute on function public.release_company_reel_render_job_for_retry(uuid,uuid) to service_role;
grant execute on function public.complete_company_reel_render_job(uuid,uuid,text,text,text,integer,integer,integer,integer,text,text,integer,bigint,boolean) to service_role;
grant execute on function public.fail_company_reel_render_job(uuid,uuid,text) to service_role;
revoke all on function public.prevent_company_reel_creative_plan_update() from public, anon, authenticated;
revoke all on function public.protect_company_reel_render_job_identity() from public, anon, authenticated;

-- REEL_RENDER_JOBS_END
