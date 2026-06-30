-- Clean duplicate job-files storage policies.
-- Run this in Supabase SQL Editor after confirming files are stored as:
-- job-files/{company_id}/{job_id}/{file}

insert into storage.buckets (id, name, public)
values ('job-files', 'job-files', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Authenticated users can delete job files" on storage.objects;
drop policy if exists "Authenticated users can update job files" on storage.objects;
drop policy if exists "Authenticated users can upload job files" on storage.objects;
drop policy if exists "Company users can delete job files" on storage.objects;
drop policy if exists "Company users can read job files" on storage.objects;
drop policy if exists "Company users can update job files" on storage.objects;
drop policy if exists "Company users can upload job files" on storage.objects;
drop policy if exists "company managers can upload job files" on storage.objects;
drop policy if exists "company members can read job files" on storage.objects;

drop policy if exists "job files readable by company users" on storage.objects;
drop policy if exists "job files insertable by company users" on storage.objects;
drop policy if exists "job files updateable by company users" on storage.objects;
drop policy if exists "job files deleteable by company users" on storage.objects;

create policy "job files readable by company users"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'job-files'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_company(split_part(name, '/', 1)::uuid)
);

create policy "job files insertable by company users"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'job-files'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_company(split_part(name, '/', 1)::uuid)
);

create policy "job files updateable by company users"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'job-files'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_company(split_part(name, '/', 1)::uuid)
)
with check (
  bucket_id = 'job-files'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_company(split_part(name, '/', 1)::uuid)
);

create policy "job files deleteable by company users"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'job-files'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_company(split_part(name, '/', 1)::uuid)
);
