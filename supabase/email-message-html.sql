alter table public.email_messages
  add column if not exists body_html text not null default '';
