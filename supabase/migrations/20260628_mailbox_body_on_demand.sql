alter table public.email_messages
  alter column body drop not null,
  alter column body_html drop not null;

update public.email_messages
set body = null,
    body_html = null;

vacuum full public.email_messages;
analyze public.email_messages;
