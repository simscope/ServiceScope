-- ServiceScope production audit log.
-- Run this in Supabase SQL Editor.
-- Audit events are append-only from the UI: insert/select only, no update/delete policy.

create table if not exists public.audit_events (
  id uuid not null default gen_random_uuid(),
  company_id uuid null,
  actor_user_id uuid null,
  actor_name text not null,
  actor_role text null,
  category text not null,
  action text not null,
  resource text not null,
  resource_id text null,
  details text not null default ''::text,
  ip_address inet null,
  user_agent text null,
  created_at timestamp with time zone not null default now(),
  constraint audit_events_pkey primary key (id),
  constraint audit_events_company_id_fkey foreign key (company_id) references public.companies(id) on delete set null,
  constraint audit_events_actor_user_id_fkey foreign key (actor_user_id) references auth.users(id) on delete set null,
  constraint audit_events_category_check check (category in ('tenant', 'billing', 'access', 'support'))
) tablespace pg_default;

create index if not exists idx_audit_events_created_at
  on public.audit_events using btree (created_at desc);

create index if not exists idx_audit_events_company_created
  on public.audit_events using btree (company_id, created_at desc);

create index if not exists idx_audit_events_category_created
  on public.audit_events using btree (category, created_at desc);

alter table public.audit_events enable row level security;

drop policy if exists "audit events select" on public.audit_events;
drop policy if exists "audit events insert" on public.audit_events;

create policy "audit events select"
on public.audit_events
for select
to authenticated
using (
  exists (
    select 1
    from public.app_current_session() session
    where session.kind = 'owner'
       or (session.kind = 'company' and session.company_id = audit_events.company_id)
  )
);

create policy "audit events insert"
on public.audit_events
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_current_session() session
    where session.kind = 'owner'
       or (session.kind = 'company' and session.company_id = audit_events.company_id)
  )
);

comment on table public.audit_events is 'Append-only ServiceScope audit log. UI should insert and select only.';
