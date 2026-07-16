import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const migration = readFileSync('supabase/migrations/20260716013000_warehouse_move_between_locations.sql', 'utf8');
const page = readFileSync('src/components/portal/WarehousePage.tsx', 'utf8');
const store = readFileSync('src/services/warehouseStore.ts', 'utf8');
const renderer = readFileSync('src/components/portal/ClientPageRenderer.tsx', 'utf8');
const materialsPage = readFileSync('src/components/portal/MaterialsPage.tsx', 'utf8');

function includes(source, value, label) {
  assert.ok(source.includes(value), label);
}

includes(migration, 'inventory_move_stock_between_locations', 'Move stock RPC must exist.');
includes(migration, 'for update', 'Move stock RPC must lock rows with FOR UPDATE.');
includes(migration, "movement_type, quantity, unit_cost", 'Move stock RPC must write inventory movements.');
includes(migration, "'transfer_out'", 'Move stock RPC must create transfer_out movement.');
includes(migration, "'transfer_in'", 'Move stock RPC must create transfer_in movement.');
includes(migration, 'TRANSFER_SAME_LOCATION', 'Move stock RPC must reject same-location transfers.');
includes(migration, 'INSUFFICIENT_STOCK', 'Move stock RPC must reject negative-stock transfers.');
includes(migration, 'grant execute on function public.inventory_move_stock_between_locations', 'Move stock RPC execute grant must be explicit.');
assert.ok(!/update public\.inventory_items/i.test(migration), 'Move stock must not change item total quantity or average cost.');

includes(store, 'InventoryMoveDraft', 'Store must expose move draft type.');
includes(store, 'moveInventoryStock', 'Store must expose move stock RPC wrapper.');
includes(store, 'inventory_move_stock_between_locations', 'Store must call the move stock RPC.');
includes(store, 'TRANSFER_SAME_LOCATION', 'Store must map same-location transfer errors.');

includes(page, "type WarehouseFormMode = 'none' | 'warehouse' | 'item' | 'supplier' | 'stock' | 'jobIssue' | 'jobReturn' | 'move'", 'Move form mode must exist.');
includes(page, 'startMoveForItem', 'Parts list must open move workflow.');
includes(page, 'Move between locations', 'Move form title must be present.');
includes(page, 'From location', 'Move form must collect source location.');
includes(page, 'To location', 'Move form must collect destination location.');
includes(page, 'Move stock', 'Move form must post stock moves.');
assert.ok(!page.includes('Transfers are Stage 3'), 'Move button must not remain a disabled Stage 3 placeholder.');
assert.ok(!page.includes('Moves and adjustments are reserved for later stages.'), 'Warehouse footer must not claim moves are reserved.');
includes(page, 'Receipts, moves, Job use, and Job returns post through PostgreSQL RPC with locks.', 'Warehouse footer must describe production move posting.');

includes(page, 'Use on Job', 'Use on Job workflow must remain visible.');
includes(page, 'Return unused part', 'Return from Job workflow must remain visible.');
includes(page, 'Cost locked at', 'Use on Job must show cost snapshot.');
includes(page, 'Cost returned at', 'Return from Job must show returned cost.');
includes(page, 'onMaterialsChanged?.()', 'Warehouse Job issue/return must refresh shared Materials state.');
includes(renderer, 'listCompanyJobMaterials', 'Warehouse renderer must reload job materials after warehouse postings.');
includes(renderer, 'context.operations.setMaterials(nextMaterials)', 'Warehouse renderer must update shared Materials state.');
includes(materialsPage, 'onSaveMaterials(job.jobNumber, rowsForJob)', 'Inline material status updates must use the shared workflow.');
assert.ok(!materialsPage.includes('saveJobMaterialsToBackend'), 'Materials page must not bypass the shared material workflow for inline status changes.');

console.log('Warehouse daily workflow regression checks passed.');
