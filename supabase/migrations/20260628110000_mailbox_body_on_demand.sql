alter table public.email_messages
  alter column body drop not null,
  alter column body_html drop not null;

update public.email_messages
set body = null,
    body_html = null;

-- Routine table maintenance must run outside the migration pipeline.
-- VACUUM FULL also takes an exclusive lock, so it is intentionally not part of deploys.
