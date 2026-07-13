-- Legacy hvac-app data has been retired after migration to tenant-scoped
-- ServiceScope tables in public. No production objects depend on this schema.
drop schema if exists legacy_import cascade;
