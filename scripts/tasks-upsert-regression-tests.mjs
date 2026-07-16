import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const schema = readFileSync('supabase/schema.sql', 'utf8');
const migration = readFileSync('supabase/migrations/20260716054500_fix_tasks_auto_key_upsert_constraint.sql', 'utf8');
const api = readFileSync('src/features/tasks/api.ts', 'utf8');

assert.ok(
  api.includes('tasks?on_conflict=company_id,auto_key&select=*'),
  'Auto task status persistence must keep using the stable company_id + auto_key upsert target.',
);

assert.ok(
  schema.includes('create unique index tasks_company_auto_key_unique on tasks(company_id, auto_key);'),
  'Tasks schema must expose a non-partial unique index for PostgREST ON CONFLICT(company_id, auto_key).',
);

assert.ok(
  !schema.includes('idx_tasks_company_auto_key on tasks(company_id, auto_key) where auto_key is not null'),
  'Tasks schema must not rely on a partial auto_key index for the PostgREST upsert target.',
);

assert.ok(
  migration.includes('delete from public.tasks'),
  'Migration must remove duplicate auto task rows before creating the unique index.',
);

assert.ok(
  migration.includes('create unique index if not exists tasks_company_auto_key_unique'),
  'Migration must create the non-partial unique index required by PostgREST.',
);

console.log('Tasks upsert regression checks passed.');
