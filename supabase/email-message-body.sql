alter table public.email_messages
  add column if not exists body text not null default '';
