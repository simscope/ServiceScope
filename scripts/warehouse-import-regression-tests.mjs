import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const edge = readFileSync('supabase/functions/import-inventory-product-url/index.ts', 'utf8');
const page = readFileSync('src/components/portal/WarehousePage.tsx', 'utf8');
const store = readFileSync('src/services/supabaseRest.ts', 'utf8') + readFileSync('src/services/warehouseStore.ts', 'utf8');

function assertIncludes(source, value, label) {
  assert.ok(source.includes(value), label);
}

assertIncludes(edge, 'whoops', 'Grainger/error pages must be detected by blocked-page indicators.');
assertIncludes(edge, 'access denied', 'Access denied pages must be blocked.');
assertIncludes(edge, 'page not found', 'Page-not-found previews must be blocked.');
assertIncludes(edge, 'Grainger blocked automatic product import. Enter the fields manually.', 'Grainger must return a manual-entry message.');

assertIncludes(edge, 'PLACEHOLDER_VALUES', 'Placeholder value sanitizer must exist.');
assertIncludes(edge, "'unknown'", 'Amazon MPN "unknown" must be treated as empty.');
assertIncludes(edge, 'isTokenLikePartNumber', 'Token-like MPN values must be rejected.');
assertIncludes(edge, 'Imported Part Number looked like a challenge token and was cleared.', 'Rejected MPN must produce a warning.');

assertIncludes(edge, "result.partNumber = '';", 'Amazon fallback must not return unknown/HTML MPN as confident Part Number.');
assertIncludes(edge, 'Amazon import is partial.', 'Amazon fallback must be visibly partial.');

assertIncludes(edge, 'EBAY_CLIENT_ID', 'eBay must use server-side OAuth client ID.');
assertIncludes(edge, 'EBAY_CLIENT_SECRET', 'eBay must use server-side OAuth client secret.');
assertIncludes(edge, 'grant_type', 'eBay OAuth client credentials grant must be used.');
assertIncludes(edge, 'get_item_by_legacy_id', 'eBay Browse API must be used.');
assert.ok(!edge.includes('EBAY_BROWSE_API_TOKEN'), 'Static eBay access token fallback must not be used.');
assertIncludes(edge, 'eBay blocked the page and the eBay API is not available.', 'eBay missing credentials must show provider-specific warning.');

assertIncludes(edge, 'copyImageToStorage', 'Supplier images must be copied server-side.');
assertIncludes(edge, 'Product image could not be copied; stock import can continue.', 'Broken supplier image must warn without blocking import.');

const importControlCount = (page.match(/placeholder="Paste Amazon, eBay, or supplier product link"/g) || []).length;
assert.equal(importControlCount, 1, 'Product URL/import controls must appear only once.');

assertIncludes(page, 'findWeakImportMatches', 'Weak suggestions must be separated from strong matching.');
assertIncludes(page, 'Weak suggestions only', 'Weak suggestions must be labeled in the UI.');
assert.ok(!/const normalizedName[\s\S]{0,240}return nameMatch\.id/.test(page), 'Title-only matching must not automatically select an existing part.');
assert.ok(!/modelMatch[\s\S]{0,120}return modelMatch\.id/.test(page), 'Manufacturer/model matching must not automatically select an existing part.');

assertIncludes(store, 'JSON.parse(message)', 'Function JSON errors must be converted to user-facing messages.');

console.log('Warehouse import regression checks passed.');
