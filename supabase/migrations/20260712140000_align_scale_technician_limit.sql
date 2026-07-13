-- Scale has a 30-technician limit across the UI, bootstrap SQL, and production.
update public.plans
set technicians_limit = 30,
    updated_at = now()
where name = 'Scale';
