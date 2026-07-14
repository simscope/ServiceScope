alter table public.tasks
  add column if not exists status_changed_by text,
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_from text;

comment on column public.tasks.status_changed_by is 'Display label of the user who last changed the task status.';
comment on column public.tasks.status_changed_at is 'Timestamp of the last task status change.';
comment on column public.tasks.status_changed_from is 'Previous task status before the last status change.';
