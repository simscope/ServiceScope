-- Manual validation template for inventory_import_product_to_stock idempotency.
-- Replace the placeholders, run as an authenticated manager/admin, and verify both calls return the same receipt_id.

begin;

select public.inventory_import_product_to_stock(
  :'company_id'::uuid,
  :'idempotency_key'::uuid,
  jsonb_build_object(
    'warehouse_id', :'warehouse_id',
    'bin_id', '',
    'selected_item_id', '',
    'create_new_part', true,
    'title', 'Idempotency Test Part',
    'manufacturer', 'ServiceScope',
    'brand', 'ServiceScope',
    'part_number', 'IDEMPOTENCY-TEST',
    'model', '',
    'oem', '',
    'description', 'Temporary import idempotency test row.',
    'image_url', '',
    'supplier_name', 'Idempotency Test Supplier',
    'source_type', 'generic',
    'source_domain', 'example.com',
    'source_url', 'https://example.com/idempotency-test-part',
    'canonical_url', 'https://example.com/idempotency-test-part',
    'external_product_id', 'idempotency-test-part',
    'currency', 'USD',
    'packages_received', 1,
    'units_per_package', 1,
    'package_price', 1,
    'shipping_cost', 0,
    'tax_cost', 0,
    'other_cost', 0,
    'receipt_date', current_date::text
  )
) as first_call;

select public.inventory_import_product_to_stock(
  :'company_id'::uuid,
  :'idempotency_key'::uuid,
  jsonb_build_object(
    'warehouse_id', :'warehouse_id',
    'title', 'Idempotency Test Part',
    'source_type', 'generic',
    'source_domain', 'example.com',
    'source_url', 'https://example.com/idempotency-test-part',
    'canonical_url', 'https://example.com/idempotency-test-part',
    'packages_received', 1,
    'units_per_package', 1,
    'package_price', 1,
    'receipt_date', current_date::text
  )
) as second_call;

rollback;
