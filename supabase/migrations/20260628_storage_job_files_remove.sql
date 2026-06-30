drop policy if exists allow_job_files_remove on storage.objects;

create policy allow_job_files_remove
on storage.objects
for delete
using (
  bucket_id = 'job-files'
  and exists (
    select 1
    from public.app_current_session() s
    where s.kind = 'owner'
       or (
         s.kind = 'company'
         and name like (s.company_id::text || '/%')
         and lower(coalesce(s.role::text, '')) in ('admin', 'manager', 'dispatcher', 'owner')
       )
  )
);
