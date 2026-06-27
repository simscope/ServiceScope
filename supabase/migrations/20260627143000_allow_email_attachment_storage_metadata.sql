-- Email attachments should not store file bytes in Postgres for production.
-- Incoming Gmail attachments keep only gmail_attachment_id metadata.
-- Outgoing ServiceScope attachments store files in Supabase Storage and keep storage path metadata.

alter table public.email_message_attachments
  alter column content_base64 drop not null;

alter table public.email_message_attachments
  add column if not exists gmail_attachment_id text,
  add column if not exists storage_bucket text,
  add column if not exists storage_path text;

-- Optional guard after cleanup/deploy can be enabled manually later if desired:
-- alter table public.email_message_attachments
--   add constraint email_attachments_no_base64
--   check (content_base64 is null);
