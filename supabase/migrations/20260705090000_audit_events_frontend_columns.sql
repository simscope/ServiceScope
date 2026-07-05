alter table public.audit_events
  add column if not exists actor_role text,
  add column if not exists resource text,
  add column if not exists user_agent text;

do $$
declare
  has_resource_label boolean;
  has_resource_type boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'audit_events'
      and column_name = 'resource_label'
  ) into has_resource_label;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'audit_events'
      and column_name = 'resource_type'
  ) into has_resource_type;

  if has_resource_label and has_resource_type then
    update public.audit_events
    set resource = coalesce(nullif(resource, ''), nullif(resource_label, ''), nullif(resource_type, ''), 'Unknown resource')
    where resource is null or resource = '';
  elsif has_resource_label then
    update public.audit_events
    set resource = coalesce(nullif(resource, ''), nullif(resource_label, ''), 'Unknown resource')
    where resource is null or resource = '';
  elsif has_resource_type then
    update public.audit_events
    set resource = coalesce(nullif(resource, ''), nullif(resource_type, ''), 'Unknown resource')
    where resource is null or resource = '';
  else
    update public.audit_events
    set resource = coalesce(nullif(resource, ''), 'Unknown resource')
    where resource is null or resource = '';
  end if;
end $$;

alter table public.audit_events
  alter column resource set default 'Unknown resource';
