import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const store = readFileSync('src/services/jobsStore.ts', 'utf8');
const types = readFileSync('src/types.ts', 'utf8');
const materialsPage = readFileSync('src/components/portal/MaterialsPage.tsx', 'utf8');
const migration = readFileSync('supabase/migrations/20260716024500_dedupe_warehouse_job_materials.sql', 'utf8');
const aggregateMigration = readFileSync('supabase/migrations/20260716031000_aggregate_warehouse_job_materials.sql', 'utf8');
const returnReferenceMigration = readFileSync('supabase/migrations/20260716034500_fix_job_return_reference_id.sql', 'utf8');
const warehousePage = readFileSync('src/components/portal/WarehousePage.tsx', 'utf8');

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

includes(aggregateMigration, 'partition by company_id, job_id, item_id', 'Existing warehouse material duplicates must be grouped by Job and item.');
includes(aggregateMigration, 'sum(quantity)', 'Duplicate warehouse material lines must merge into summed quantity.');
includes(aggregateMigration, 'select jm.* into v_existing_job_material', 'Issue RPC must look for an existing Job material line.');
includes(aggregateMigration, 'update public.job_materials', 'Issue RPC must update an existing line instead of always inserting.');
includes(aggregateMigration, 'v_next_material_quantity := v_existing_job_material.quantity + v_quantity', 'Repeated issue must increment quantity.');
includes(aggregateMigration, 'join public.inventory_movements im on im.id = jm.inventory_movement_id', 'Aggregation must identify material item through linked movements.');
includes(aggregateMigration, 'if v_existing_job_material.id is not null then', 'Issue RPC must branch on existing warehouse material line.');
includes(returnReferenceMigration, "'job_material_return', v_issue.id, v_issue.reference_number", 'Return movement reference_id must use the original issue movement UUID.');
assert.ok(!returnReferenceMigration.includes("'job_material_return', v_job_material.id"), 'Return movement reference_id must not use job_materials.id.');

includes(warehousePage, 'jobIssuePosting', 'Warehouse UI must track in-flight Job issue posting.');
includes(warehousePage, 'if (jobIssuePosting) return;', 'Warehouse UI must block double-submit on Job issue.');
includes(warehousePage, "disabled={jobIssuePosting}", 'Post to Job button must be disabled while posting.');
includes(warehousePage, 'type ReturnIssueOption', 'Return UI must use grouped return issue options.');
includes(warehousePage, 'returnIssueOptions = useMemo', 'Return issue options must be memoized from movements.');
includes(warehousePage, "return `${movement.jobId ?? ''}:${movement.itemId}`", 'Return issue grouping must use Job and item.');
includes(warehousePage, "movement.movementType === 'job_return'", 'Return issue availability must subtract posted returns.');
includes(warehousePage, 'quantityAvailable', 'Return UI must show and validate available return quantity.');
includes(warehousePage, 'Only ${formatQty(selectedReturnIssue.quantityAvailable', 'Return UI must block returning more than available.');
assert.ok(!/snapshot\.movements\.filter\(\(movement\) => movement\.movementType === 'job_issue'\)\.map/.test(warehousePage), 'Return dropdown must not render raw job_issue movements directly.');

console.log('Warehouse Job materials regression checks passed.');
