-- Move email attachments out of Postgres base64 columns and into Storage.
-- Files are stored as: email-files/{company_id}/{email_message_id}/{file}

insert into storage.buckets (id, name, public)
values ('email-files', 'email-files', true)
on conflict (id) do update set public = excluded.public;

alter table public.email_message_attachments
  alter column content_base64 drop not null;

alter table public.email_message_attachments
  add column if not exists gmail_attachment_id text,
  add column if not exists storage_bucket text,
  add column if not exists storage_path text;

drop policy if exists "email files readable by company users" on storage.objects;
drop policy if exists "email files insertable by company users" on storage.objects;
drop policy if exists "email files updateable by company users" on storage.objects;
drop policy if exists "email files deleteable by company users" on storage.objects;
drop policy if exists "company members can read email files" on storage.objects;
drop policy if exists "company members can upload email files" on storage.objects;
drop policy if exists "company members can update email files" on storage.objects;
drop policy if exists "company members can delete email files" on storage.objects;

create policy "email files readable by company users"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'email-files'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_company(split_part(name, '/', 1)::uuid)
);

create policy "email files insertable by company users"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'email-files'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_company(split_part(name, '/', 1)::uuid)
);

create policy "email files updateable by company users"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'email-files'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_company(split_part(name, '/', 1)::uuid)
)
with check (
  bucket_id = 'email-files'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_company(split_part(name, '/', 1)::uuid)
);

create policy "email files deleteable by company users"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'email-files'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_company(split_part(name, '/', 1)::uuid)
);
