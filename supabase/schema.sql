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
      and approved_message !~ '[[:cntrl:]]'
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
    or p_approved_message ~ '[[:cntrl:]]'
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
    or p_provider_post_id ~ '[[:cntrl:]]' then
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
    p_company_id, p_actor_id, 'Authenticated user', 'publisher', 'access',
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
    or (p_provider_http_status is not null and p_provider_http_status not between 100 and 599) then
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
    p_company_id, p_actor_id, 'Authenticated user', 'publisher', 'access',
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
    p_company_id, p_actor_id, 'Authenticated user', 'publisher', 'access',
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
revoke all on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_company_facebook_publication(uuid, uuid, uuid, integer, integer, integer, text, boolean, text, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;

grant execute on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, uuid, text, text, timestamptz) to service_role;
grant execute on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.fail_company_facebook_publication(uuid, uuid, uuid, integer, integer, integer, text, boolean, text, timestamptz) to service_role;
grant execute on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, timestamptz) to service_role;

comment on table public.company_social_publications is
  'Server-only Facebook Page text publication history. Browser roles have no direct access.';
comment on column public.company_social_publications.approved_message is
  'Exact human-approved normalized text. Never expose through status or telemetry.';
comment on column public.company_social_publications.provider_post_id is
  'Server-only Meta post identifier. Never return to browser clients.';
comment on function public.begin_company_facebook_publication(uuid, uuid, uuid, uuid, uuid, text, bytea, uuid, text, text, timestamptz) is
  'Validates and begins one idempotent Facebook Page text publication with an atomic safe audit.';
comment on function public.complete_company_facebook_publication(uuid, uuid, uuid, text, timestamptz) is
  'Marks an exact publishing row published and writes its safe audit atomically.';
comment on function public.fail_company_facebook_publication(uuid, uuid, uuid, integer, integer, integer, text, boolean, text, timestamptz) is
  'Marks a definite provider rejection failed using normalized diagnostics and a safe atomic audit.';
comment on function public.mark_company_facebook_publication_unknown(uuid, uuid, uuid, timestamptz) is
  'Marks an indeterminate provider delivery result without retry and writes its safe audit atomically.';
-- META_FACEBOOK_PUBLISH_SCHEMA_END
