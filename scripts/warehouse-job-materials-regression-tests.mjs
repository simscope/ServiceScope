import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const store = readFileSync('src/services/jobsStore.ts', 'utf8');
const types = readFileSync('src/types.ts', 'utf8');
const materialsPage = readFileSync('src/components/portal/MaterialsPage.tsx', 'utf8');
const migration = readFileSync('supabase/migrations/20260716024500_dedupe_warehouse_job_materials.sql', 'utf8');

function includes(source, value, label) {
  assert.ok(source.includes(value), label);
}

includes(types, "sourceType?: 'manual' | 'warehouse'", 'MaterialRow must preserve source type.');
includes(types, 'inventoryMovementId?: string | null', 'MaterialRow must preserve inventory movement link.');

includes(store, 'source_type?:', 'Job material row must read source_type.');
includes(store, 'inventory_movement_id?:', 'Job material row must read inventory_movement_id.');
includes(store, 'sourceType: row.source_type', 'Mapped material must keep source type.');
includes(store, 'inventoryMovementId: row.inventory_movement_id', 'Mapped material must keep movement id.');
includes(store, "source_type=${sqlEq('manual')}", 'Manual save must delete only manual material rows.');
includes(store, "source_type: 'manual'", 'Manual rows must be explicitly saved as manual.');
assert.ok(!/job_materials\\?company_id=.*job_id=.*\\}`, \\{ method: 'DELETE' \\}/.test(store), 'Saving materials must not delete all job_materials for a Job.');

includes(materialsPage, 'warehouseSource', 'Materials editor must detect warehouse-backed rows.');
includes(materialsPage, 'disabled={warehouseSource}', 'Warehouse-backed material fields must be read-only.');
includes(materialsPage, "warehouseSource ? 'Stock' : 'Remove'", 'Warehouse-backed rows must not show Remove.');

includes(migration, 'delete from public.job_materials manual_row', 'Cleanup migration must delete manual clones.');
includes(migration, "warehouse_row.source_type = 'warehouse'", 'Cleanup migration must preserve warehouse source rows.');
includes(migration, 'warehouse_row.inventory_movement_id is not null', 'Cleanup migration must only match warehouse movement rows.');

console.log('Warehouse Job materials regression checks passed.');
