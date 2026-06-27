do $$
begin
  if not exists (select 1 from pg_type where typname = 'library_category') then
    create type public.library_category as enum ('Manual', 'Wiring diagram', 'Service bulletin', 'Install guide', 'Parts list', 'Warranty', 'Training');
  end if;

  if not exists (select 1 from pg_type where typname = 'library_format') then
    create type public.library_format as enum ('PDF', 'Image', 'Video', 'Link');
  end if;
end $$;

create table if not exists public.library_documents (
  id uuid not null default gen_random_uuid(),
  company_id uuid not null,
  title text not null,
  category public.library_category not null,
  system text not null default ''::text,
  manufacturer text not null default ''::text,
  model text not null default ''::text,
  format public.library_format not null default 'PDF'::public.library_format,
  tags text[] not null default '{}'::text[],
  summary text not null default ''::text,
  storage_bucket text not null default 'library'::text,
  storage_path text null,
  external_url text null,
  file_size_bytes bigint not null default 0,
  uploaded_by_user_id uuid null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint library_documents_pkey primary key (id),
  constraint library_documents_company_id_fkey foreign key (company_id) references public.companies(id) on delete cascade,
  constraint library_documents_uploaded_by_user_id_fkey foreign key (uploaded_by_user_id) references auth.users(id) on delete set null
);

create index if not exists idx_library_company_search
  on public.library_documents using btree (company_id, category, system, manufacturer);

drop trigger if exists set_library_documents_updated_at on public.library_documents;

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
