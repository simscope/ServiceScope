-- These are unused hvac-app import tables. They contain sensitive legacy data
-- and must never be exposed through the public API.

alter table legacy_import.mail_accounts enable row level security;
alter table legacy_import.materials enable row level security;

drop policy if exists "Read mail tokens (all auth)" on legacy_import.mail_accounts;
drop policy if exists "Upsert mail tokens (admins via functions)" on legacy_import.mail_accounts;

drop policy if exists "Allow all read" on legacy_import.materials;
drop policy if exists "Allow delete for all" on legacy_import.materials;
drop policy if exists "Allow insert for all" on legacy_import.materials;
drop policy if exists "Insert materials" on legacy_import.materials;
drop policy if exists "Select materials" on legacy_import.materials;
drop policy if exists "Update materials" on legacy_import.materials;

revoke all on table legacy_import.mail_accounts from anon, authenticated;
revoke all on table legacy_import.materials from anon, authenticated;
