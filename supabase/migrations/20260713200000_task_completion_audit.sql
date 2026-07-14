alter table public.tasks
  add column if not exists completed_by text,
  add column if not exists completed_at timestamptz,
  add column if not exists completion_note text not null default '';

comment on column public.tasks.completed_by is 'Display name and email of the user who marked the task completed.';
comment on column public.tasks.completed_at is 'Time when the task was marked completed.';
comment on column public.tasks.completion_note is 'Optional information entered when the task was completed.';
