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
  resource_type text,
  resource_id text,
  resource_label text not null,
  details text not null default '',
  metadata jsonb not null default '{}'::jsonb,
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
  ('Scale', 54900, 35, 75, 150, 'Dedicated', array['Everything in Growth', 'Advanced monitoring', 'Custom onboarding', 'Dedicated support']);

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

grant execute on function app_current_session() to authenticated;

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
  assigned_user_id uuid references company_users(id) on delete set null,
  title text not null,
  notes text not null default '',
  due_at timestamptz,
  priority priority_level not null default 'normal',
  status task_status not null default 'To do',
  source task_source not null default 'Manual',
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
  content_base64 text not null default '',
  content_id text,
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
create index idx_job_comments_job on job_comments(job_id, created_at);
create index idx_job_attachments_job on job_attachments(job_id);
create index idx_job_materials_job on job_materials(job_id);
create index idx_job_payments_job on job_payments(job_id);
create index idx_payroll_items_technician on payroll_items(company_id, technician_id, paid_at);
create index idx_tasks_company_status on tasks(company_id, status);
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
alter table job_materials enable row level security;
alter table job_payments enable row level security;
alter table job_invoices enable row level security;
alter table payroll_batches enable row level security;
alter table payroll_items enable row level security;
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
  ('job-files', 'job-files', false),
  ('library', 'library', false),
  ('company-logos', 'company-logos', true)
on conflict (id) do nothing;

-- Storage policies use the convention:
-- job-files/{company_id}/{job_id}/{file}
-- library/{company_id}/{file}
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

create policy "company managers can upload job files" on storage.objects
  for insert with check (
    bucket_id = 'job-files'
    and public.can_manage_company((storage.foldername(name))[1]::uuid)
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
