import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile('supabase/migrations/20260723013000_warehouse_adjustments_stage5.sql', 'utf8');
const service = await readFile('src/services/warehouseAdjustmentStore.ts', 'utf8');
const page = await readFile('src/components/portal/WarehouseAdjustmentsPage.tsx', 'utf8');
const renderer = await readFile('src/components/portal/ClientPageRenderer.tsx', 'utf8');
const styles = await readFile('src/styles/warehouse-adjustments.css', 'utf8');

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.inventory_adjust_stock\(/);
assert.match(migration, /SECURITY DEFINER/);
assert.match(migration, /FOR UPDATE;/);
assert.match(migration, /idx_inventory_adjustment_idempotency/);
assert.match(migration, /NO_ADJUSTMENT_NEEDED/);
assert.match(migration, /ADJUSTMENT_HAS_LATER_MOVEMENTS/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.inventory_adjust_stock/);
assert.doesNotMatch(migration, /GRANT (INSERT|UPDATE|DELETE|ALL) ON public\.inventory_adjustment/);

assert.match(service, /supabaseRpc<[^]*?>\('inventory_adjust_stock'/);
assert.match(service, /supabaseRpc<[^]*?>\([\s\S]*?'inventory_cancel_adjustment'/);
assert.match(service, /p_counted_quantity/);
assert.match(service, /idempotencyKey/);

assert.match(page, /Actual counted quantity/);
assert.match(page, /System quantity/);
assert.match(page, /Post adjustment/);
assert.match(page, /Reverse/);
assert.match(page, /window\.confirm/);
assert.match(page, /quantityDelta === 0/);
assert.match(page, /WarehousePage key=\{warehouseRefreshKey\}/);
assert.match(page, /Search by name or part number/);
assert.match(page, /filteredItems\.map/);
assert.match(page, /role="listbox"/);
assert.match(page, /Select the part you counted/);
assert.doesNotMatch(page, /const itemId = draft\.itemId \|\| snapshot\.items\[0\]/);

assert.match(renderer, /WarehouseAdjustmentsPage/);
assert.doesNotMatch(renderer, /import \{ WarehousePage \}/);
assert.match(styles, /\.warehouse-adjustment-enabled \.warehouse-warning/);
assert.match(styles, /\.warehouse-adjustment-part-list/);
assert.match(styles, /max-height: 250px/);
assert.match(styles, /display: none/);

console.log('warehouse adjustments regression checks passed');
