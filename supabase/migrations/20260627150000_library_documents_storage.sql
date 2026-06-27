create table if not exists public.library_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  category text not null default 'Manual',
  system text not null default 'General',
  manufacturer text not null default 'Unknown',
  model text not null default 'Any model',
  format text not null default 'PDF',
  tags text[] not null default '{}',
  uploaded_by text not null default 'Company admin',
  summary text not null default '',
  file_name text,
  mime_type text,
  size_bytes bigint not null default 0,
  storage_bucket text not null default 'library',
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_library_documents_company
  on public.library_documents(company_id, created_at desc);

create trigger set_library_documents_updated_at
before update on public.library_documents
for each row
execute function public.set_updated_at();

alter table public.library_documents enable row level security;

drop policy if exists "Company users can read library documents" on public.library_documents;
drop policy if exists "Company users can insert library documents" on public.library_documents;
drop policy if exists "Company users can update library documents" on public.library_documents;
drop policy if exists "Company users can delete library documents" on public.library_documents;

create policy "Company users can read library documents"
on public.library_documents
for select
to authenticated
using (public.can_access_company(company_id));

create policy "Company users can insert library documents"
on public.library_documents
for insert
to authenticated
with check (public.can_access_company(company_id));

create policy "Company users can update library documents"
on public.library_documents
for update
to authenticated
using (public.can_access_company(company_id))
with check (public.can_access_company(company_id));

create policy "Company users can delete library documents"
on public.library_documents
for delete
to authenticated
using (public.can_access_company(company_id));

insert into storage.buckets (id, name, public)
values ('library', 'library', false)
on conflict (id) do nothing;

drop policy if exists "Company users can read library files" on storage.objects;
drop policy if exists "Company users can upload library files" on storage.objects;
drop policy if exists "Company users can update library files" on storage.objects;
drop policy if exists "Company users can delete library files" on storage.objects;

create policy "Company users can read library files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'library'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_company(split_part(name, '/', 1)::uuid)
);

create policy "Company users can upload library files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'library'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_company(split_part(name, '/', 1)::uuid)
);

create policy "Company users can update library files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'library'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_company(split_part(name, '/', 1)::uuid)
)
with check (
  bucket_id = 'library'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_company(split_part(name, '/', 1)::uuid)
);

create policy "Company users can delete library files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'library'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.can_access_company(split_part(name, '/', 1)::uuid)
);
