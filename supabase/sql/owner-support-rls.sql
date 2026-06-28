-- Owner support RLS policies for ServiceScope.
-- Run this in Supabase SQL Editor after owner_support_tickets and owner_support_messages exist.
-- It uses the existing app_current_session() RPC that the app already uses for login/session resolution.

alter table public.owner_support_tickets enable row level security;
alter table public.owner_support_messages enable row level security;

drop policy if exists "owner support tickets select" on public.owner_support_tickets;
drop policy if exists "owner support tickets insert" on public.owner_support_tickets;
drop policy if exists "owner support tickets update" on public.owner_support_tickets;
drop policy if exists "owner support messages select" on public.owner_support_messages;
drop policy if exists "owner support messages insert" on public.owner_support_messages;
drop policy if exists "owner support messages update" on public.owner_support_messages;

create policy "owner support tickets select"
on public.owner_support_tickets
for select
to authenticated
using (
  exists (
    select 1
    from public.app_current_session() session
    where session.kind = 'owner'
       or (session.kind = 'company' and session.company_id = owner_support_tickets.company_id)
  )
);

create policy "owner support tickets insert"
on public.owner_support_tickets
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_current_session() session
    where session.kind = 'owner'
       or (session.kind = 'company' and session.company_id = owner_support_tickets.company_id)
  )
);

create policy "owner support tickets update"
on public.owner_support_tickets
for update
to authenticated
using (
  exists (
    select 1
    from public.app_current_session() session
    where session.kind = 'owner'
       or (session.kind = 'company' and session.company_id = owner_support_tickets.company_id)
  )
)
with check (
  exists (
    select 1
    from public.app_current_session() session
    where session.kind = 'owner'
       or (session.kind = 'company' and session.company_id = owner_support_tickets.company_id)
  )
);

create policy "owner support messages select"
on public.owner_support_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.app_current_session() session
    where session.kind = 'owner'
       or (session.kind = 'company' and session.company_id = owner_support_messages.company_id)
  )
);

create policy "owner support messages insert"
on public.owner_support_messages
for insert
to authenticated
with check (
  exists (
    select 1
    from public.app_current_session() session
    where session.kind = 'owner'
       or (session.kind = 'company' and session.company_id = owner_support_messages.company_id)
  )
  and exists (
    select 1
    from public.owner_support_tickets ticket
    where ticket.id = owner_support_messages.ticket_id
      and (
        ticket.company_id = owner_support_messages.company_id
        or owner_support_messages.company_id is null
      )
  )
);

create policy "owner support messages update"
on public.owner_support_messages
for update
to authenticated
using (
  exists (
    select 1
    from public.app_current_session() session
    where session.kind = 'owner'
       or (session.kind = 'company' and session.company_id = owner_support_messages.company_id)
  )
)
with check (
  exists (
    select 1
    from public.app_current_session() session
    where session.kind = 'owner'
       or (session.kind = 'company' and session.company_id = owner_support_messages.company_id)
  )
);
