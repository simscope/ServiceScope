import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const store = readFileSync('src/services/jobsStore.ts', 'utf8');
const types = readFileSync('src/types.ts', 'utf8');
const materialsPage = readFileSync('src/components/portal/MaterialsPage.tsx', 'utf8');
const materialsFeature = readFileSync('src/features/materials/useMaterialsFeature.ts', 'utf8');
const materialWorkflow = readFileSync('src/features/materials/materialWorkflow.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260716024500_dedupe_warehouse_job_materials.sql', 'utf8');
const aggregateMigration = readFileSync('supabase/migrations/20260716031000_aggregate_warehouse_job_materials.sql', 'utf8');
const returnReferenceMigration = readFileSync('supabase/migrations/20260716034500_fix_job_return_reference_id.sql', 'utf8');
const returnQuantityMigration = readFileSync('supabase/migrations/20260716040500_recalculate_warehouse_job_material_quantities.sql', 'utf8');
const normalizeWarehouseSourceMigration = readFileSync('supabase/migrations/20260716043000_normalize_warehouse_job_material_sources.sql', 'utf8');
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
includes(store, 'unit_price_cents: dollarsToCents(String(Math.max(0, Number(row.price) || 0)))', 'Warehouse-backed material price edits must be saved.');
includes(store, 'supplier: row.supplier.trim()', 'Warehouse-backed material supplier edits must be saved.');
includes(store, "source_type=${sqlEq('manual')}", 'Manual save must delete only manual material rows.');
includes(store, "source_type: 'manual'", 'Manual rows must be explicitly saved as manual.');
assert.ok(!/job_materials\\?company_id=.*job_id=.*\\}`, \\{ method: 'DELETE' \\}/.test(store), 'Saving materials must not delete all job_materials for a Job.');

includes(materialsPage, 'warehouseSource', 'Materials editor must detect warehouse-backed rows.');
includes(materialsPage, "title={warehouseSource ? 'Return unused stock to change quantity.' : undefined}", 'Warehouse-backed material quantity must explain why it is locked.');
includes(materialsPage, "warehouseSource ? 'Stock' : 'Remove'", 'Warehouse-backed rows must not show Remove.');
includes(materialsPage, 'openStockPicker', 'Stock button must open the in-modal stock picker.');
includes(materialsPage, 'issueInventoryPartToJob', 'Materials stock picker must post through the warehouse Job issue RPC.');
includes(materialsFeature, "Math.max(0, Number(row.quantity) || 0)", 'Warehouse-backed material normalization must allow zero quantity.');
includes(materialWorkflow, 'materialIsReturnedWarehouseZero', 'Returned zero-quantity warehouse materials must be handled separately.');
includes(materialWorkflow, "materialStatusFilter !== 'all' || !materialIsReturnedWarehouseZero(material)", 'Default Materials view must hide returned zero-quantity warehouse rows.');
assert.ok(!materialsPage.includes('value={row.price} disabled={warehouseSource}'), 'Warehouse-backed material price must be editable.');
assert.ok(!materialsPage.includes('value={row.name} disabled={warehouseSource}'), 'Warehouse-backed material name must be editable.');

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
includes(returnQuantityMigration, 'sum(quantity) filter (where movement_type = \'job_issue\')', 'Return quantity fix must sum issued movement quantity.');
includes(returnQuantityMigration, 'sum(quantity) filter (where movement_type = \'job_return\')', 'Return quantity fix must sum returned movement quantity.');
includes(returnQuantityMigration, 'greatest(coalesce(mt.issued_quantity, 0) - coalesce(mt.returned_quantity, 0), 0)', 'Existing warehouse material quantity must be recalculated from movement totals.');
includes(returnQuantityMigration, 'v_remaining_job_quantity := round(greatest(v_issued_quantity - (v_returned_quantity + v_quantity), 0)::numeric, 2)', 'Return RPC must set remaining quantity from movement totals.');
includes(normalizeWarehouseSourceMigration, "where inventory_movement_id is not null", 'Legacy movement-linked material rows must be treated as warehouse-backed.');
includes(normalizeWarehouseSourceMigration, "set source_type = 'warehouse'", 'Legacy movement-linked material rows must be normalized to warehouse source.');
includes(normalizeWarehouseSourceMigration, "source_type is distinct from 'warehouse'::public.job_material_source_type", 'Warehouse source normalization must compare enum values safely.');

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
