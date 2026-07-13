alter table public.job_attachments enable row level security;

drop policy if exists job_attachments_delete_for_company_session on public.job_attachments;

create policy job_attachments_delete_for_company_session
on public.job_attachments
for delete
using (
  exists (
    select 1
    from public.app_current_session() as session
    where session.kind = 'owner'
       or (
         session.kind = 'company'
         and session.company_id = job_attachments.company_id
         and lower(coalesce(session.role::text, '')) in ('admin', 'manager', 'dispatcher', 'owner')
       )
  )
);
