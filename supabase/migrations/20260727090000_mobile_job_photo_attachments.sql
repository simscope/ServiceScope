-- Allow technician mobile uploads to become real job attachments.
-- Files are stored as job-files/{company_id}/{job_id}/{file}.

insert into storage.buckets (id, name, public)
values ('job-files', 'job-files', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "company managers can upload job files" on storage.objects;
drop policy if exists "job files insertable by company users" on storage.objects;
create policy "job files insertable by company users"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'job-files'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_company(split_part(name, '/', 1)::uuid)
);

drop policy if exists "company members can read job files" on storage.objects;
drop policy if exists "job files readable by company users" on storage.objects;
create policy "job files readable by company users"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'job-files'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_company(split_part(name, '/', 1)::uuid)
);

drop policy if exists "job files deleteable by company users" on storage.objects;
create policy "job files deleteable by company users"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'job-files'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_company(split_part(name, '/', 1)::uuid)
);

alter table public.job_attachments enable row level security;

drop policy if exists job_attachments_insert_for_company_members on public.job_attachments;
create policy job_attachments_insert_for_company_members
on public.job_attachments
for insert
to authenticated
with check (public.can_access_company(company_id));

drop policy if exists job_attachments_delete_own_or_manager on public.job_attachments;
create policy job_attachments_delete_own_or_manager
on public.job_attachments
for delete
to authenticated
using (
  public.can_manage_company(company_id)
  or (
    uploaded_by_user_id = auth.uid()
    and public.can_access_company(company_id)
  )
);
