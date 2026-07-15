insert into storage.buckets (id, name, public)
values ('inventory-images', 'inventory-images', true)
on conflict (id) do update
set public = true;

