-- CI-only synthetic representation of an external historical hvac-app import.
-- No original import DDL is tracked. This is not the Production legacy schema.
-- Only lock/harden/drop migrations reference these objects; no data columns
-- are accessed. Keep both tables empty and outside PostgREST exposed schemas.
-- Named permissive policies/CRUD grants exercise the real historical revocation.
create schema legacy_import;
create table legacy_import.mail_accounts (synthetic_id integer primary key);
create table legacy_import.materials (synthetic_id integer primary key);
grant usage on schema legacy_import to anon, authenticated;
grant select, insert, update, delete on legacy_import.mail_accounts, legacy_import.materials to anon, authenticated;
create policy "Read mail tokens (all auth)" on legacy_import.mail_accounts for select to authenticated using (true);
create policy "Upsert mail tokens (admins via functions)" on legacy_import.mail_accounts for all to authenticated using (true) with check (true);
create policy "Allow all read" on legacy_import.materials for select to authenticated using (true);
create policy "Allow delete for all" on legacy_import.materials for delete to authenticated using (true);
create policy "Allow insert for all" on legacy_import.materials for insert to authenticated with check (true);
create policy "Insert materials" on legacy_import.materials for insert to authenticated with check (true);
create policy "Select materials" on legacy_import.materials for select to authenticated using (true);
create policy "Update materials" on legacy_import.materials for update to authenticated using (true) with check (true);
