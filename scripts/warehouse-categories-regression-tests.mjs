import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const migration = readFileSync('supabase/migrations/20260716001000_warehouse_categories.sql', 'utf8');
const page = readFileSync('src/components/portal/WarehousePage.tsx', 'utf8');
const store = readFileSync('src/services/warehouseStore.ts', 'utf8');

function includes(source, value, label) {
  assert.ok(source.includes(value), label);
}

includes(migration, 'create table if not exists public.inventory_categories', 'inventory_categories table must be created.');
includes(migration, 'idx_inventory_categories_root_name_unique', 'Root category uniqueness must be enforced.');
includes(migration, 'idx_inventory_categories_child_name_unique', 'Child category uniqueness must be enforced.');
includes(migration, 'CATEGORY_DEPTH_LIMIT', 'Child-under-child must be blocked.');
includes(migration, 'CATEGORY_COMPANY_MISMATCH', 'Item/category company mismatch must be blocked.');
includes(migration, 'alter table public.inventory_items', 'inventory_items must get category_id.');
includes(migration, 'update public.inventory_items i', 'Legacy text categories must be backfilled.');
includes(migration, 'inventory_create_category', 'Create category RPC must exist.');
includes(migration, 'inventory_update_category', 'Update category RPC must exist.');
includes(migration, 'inventory_reorder_categories', 'Reorder category RPC must exist.');
includes(migration, 'inventory_delete_category', 'Delete category RPC must exist.');
includes(migration, 'CATEGORY_USED_BY_ITEMS', 'Used category delete must be blocked.');
includes(migration, 'CATEGORY_HAS_CHILDREN', 'Root with children delete must be blocked.');
includes(migration, 'public.can_access_company(company_id)', 'RLS read policy must use company access.');
includes(migration, 'public.can_manage_company(company_id)', 'RLS write policy must use company manage access.');

includes(store, 'InventoryCategory', 'Warehouse store must expose InventoryCategory.');
includes(store, 'inventory_categories?company_id=', 'Snapshot must load categories.');
includes(store, 'category_id: draft.categoryId || null', 'Add Part must save category_id.');

includes(page, "type PartsStatusFilter = 'all' | 'in' | 'low' | 'out'", 'Status filter must be a dropdown state, not tabs.');
includes(page, 'Category', 'Parts toolbar must include Category filter.');
includes(page, 'All statuses', 'Parts toolbar must include Status dropdown.');
includes(page, "stockStatus === 'out'", 'Cards must render out-of-stock status.');
includes(page, "stockStatus === 'low'", 'Cards must render low status.');
includes(page, 'item.minimumQuantity > 0', 'Low status must not apply when minimum quantity is 0.');
includes(page, 'categoryMatchesFilter', 'Category filter logic must exist.');
includes(page, 'childIds.has(item.categoryId)', 'Root category filter must include child items.');
includes(page, 'renderCategoriesManager', 'Settings Categories manager must exist.');
includes(page, 'Add subcategory', 'Settings must allow child category creation.');
includes(page, 'moveCategory(category, -1)', 'Move up reorder control must exist.');
includes(page, 'moveCategory(category, 1)', 'Move down reorder control must exist.');
includes(page, 'Weak suggestions only', 'Prior import regression UI should remain intact.');

assert.ok(!/PartsFilter/.test(page), 'Old separate stock-status tab type must be removed.');

console.log('Warehouse categories regression checks passed.');
