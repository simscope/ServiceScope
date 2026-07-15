import { sqlEq, supabaseRequest, supabaseRpc } from './supabaseRest';

export type WarehouseType = 'main' | 'office' | 'technician_vehicle' | 'other';
export type InventoryMovementType = 'receipt' | 'transfer_out' | 'transfer_in' | 'job_issue' | 'job_return' | 'adjustment';
export type InventoryDocumentStatus = 'draft' | 'posted' | 'canceled';

export type InventoryWarehouse = {
  id: string;
  companyId: string;
  name: string;
  type: WarehouseType;
  location: string;
  technicianId: string | null;
  isActive: boolean;
  notes: string;
};

export type InventoryBin = {
  id: string;
  companyId: string;
  warehouseId: string;
  code: string;
  name: string;
  description: string;
  isActive: boolean;
};

export type InventoryItem = {
  id: string;
  companyId: string;
  internalName: string;
  category: string;
  manufacturer: string;
  oem: string;
  partNumber: string;
  alternatePartNumber: string;
  description: string;
  unit: string;
  minimumQuantity: number;
  averageCost: number;
  totalQuantity: number;
  isActive: boolean;
  notes: string;
};

export type InventorySupplier = {
  id: string;
  companyId: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  isActive: boolean;
};

export type InventoryStockBalance = {
  id: string;
  companyId: string;
  itemId: string;
  warehouseId: string;
  binId: string | null;
  quantity: number;
  updatedAt: string;
};

export type InventoryMovement = {
  id: string;
  companyId: string;
  itemId: string;
  movementType: InventoryMovementType;
  quantity: number;
  unitCost: number;
  totalCost: number;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  supplierId: string | null;
  jobId: string | null;
  referenceNumber: string;
  receiptId: string | null;
  receiptLineId: string | null;
  balanceBefore: number | null;
  balanceAfter: number | null;
  averageCostBefore: number | null;
  averageCostAfter: number | null;
  notes: string;
  createdAt: string;
};

export type InventoryStockReceipt = {
  id: string;
  companyId: string;
  supplierId: string | null;
  warehouseId: string;
  binId: string | null;
  receiptDate: string;
  poNumber: string;
  invoiceNumber: string;
  status: InventoryDocumentStatus;
  notes: string;
  postedAt: string | null;
  postedByUserId: string | null;
  canceledAt: string | null;
  cancelReason: string;
  createdAt: string;
};

export type InventoryStockReceiptLine = {
  id: string;
  companyId: string;
  receiptId: string;
  itemId: string;
  quantity: number;
  unitCost: number;
  extraCost: number;
  currency: string;
  movementId: string | null;
};

export type WarehouseSnapshot = {
  warehouses: InventoryWarehouse[];
  bins: InventoryBin[];
  items: InventoryItem[];
  suppliers: InventorySupplier[];
  stockBalances: InventoryStockBalance[];
  movements: InventoryMovement[];
  receipts: InventoryStockReceipt[];
  receiptLines: InventoryStockReceiptLine[];
};

export type InventoryWarehouseDraft = Pick<InventoryWarehouse, 'name' | 'type' | 'location' | 'technicianId' | 'notes'>;
export type InventoryItemDraft = Pick<InventoryItem, 'internalName' | 'category' | 'manufacturer' | 'oem' | 'partNumber' | 'alternatePartNumber' | 'description' | 'unit' | 'minimumQuantity' | 'notes'>;
export type InventorySupplierDraft = Pick<InventorySupplier, 'name' | 'contactName' | 'phone' | 'email' | 'website' | 'address'>;
export type InventoryReceiptDraft = Pick<InventoryStockReceipt, 'supplierId' | 'warehouseId' | 'binId' | 'receiptDate' | 'poNumber' | 'invoiceNumber' | 'notes'>;
export type InventoryReceiptLineDraft = Pick<InventoryStockReceiptLine, 'receiptId' | 'itemId' | 'quantity' | 'unitCost' | 'extraCost' | 'currency'>;

type WarehouseRow = {
  id: string;
  company_id: string;
  name: string;
  type: WarehouseType;
  location: string | null;
  technician_id: string | null;
  is_active: boolean;
  notes: string | null;
};

type BinRow = {
  id: string;
  company_id: string;
  warehouse_id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
};

type ItemRow = {
  id: string;
  company_id: string;
  internal_name: string;
  category: string | null;
  manufacturer: string | null;
  oem: string | null;
  part_number: string | null;
  alternate_part_number: string | null;
  description: string | null;
  unit: string | null;
  minimum_quantity: number | string | null;
  average_cost: number | string | null;
  total_quantity: number | string | null;
  is_active: boolean;
  notes: string | null;
};

type SupplierRow = {
  id: string;
  company_id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  is_active: boolean;
};

type StockBalanceRow = {
  id: string;
  company_id: string;
  item_id: string;
  warehouse_id: string;
  bin_id: string | null;
  quantity: number | string;
  updated_at: string;
};

type MovementRow = {
  id: string;
  company_id: string;
  item_id: string;
  movement_type: InventoryMovementType;
  quantity: number | string;
  unit_cost: number | string | null;
  total_cost: number | string | null;
  from_warehouse_id: string | null;
  to_warehouse_id: string | null;
  supplier_id: string | null;
  job_id: string | null;
  reference_number: string | null;
  receipt_id?: string | null;
  receipt_line_id?: string | null;
  balance_before?: number | string | null;
  balance_after?: number | string | null;
  average_cost_before?: number | string | null;
  average_cost_after?: number | string | null;
  notes: string | null;
  created_at: string;
};

type ReceiptRow = {
  id: string;
  company_id: string;
  supplier_id: string | null;
  warehouse_id: string;
  bin_id: string | null;
  receipt_date: string;
  po_number: string | null;
  invoice_number: string | null;
  status: InventoryDocumentStatus;
  notes: string | null;
  posted_at: string | null;
  posted_by_user_id: string | null;
  canceled_at?: string | null;
  cancel_reason?: string | null;
  created_at: string;
};

type ReceiptLineRow = {
  id: string;
  company_id: string;
  receipt_id: string;
  item_id: string;
  quantity: number | string;
  unit_cost: number | string;
  extra_cost: number | string;
  currency?: string | null;
  movement_id: string | null;
};

const DEFAULT_LIMIT = 1000;

function numberValue(value: number | string | null | undefined) {
  return Number(value) || 0;
}

function mapWarehouse(row: WarehouseRow): InventoryWarehouse {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    type: row.type,
    location: row.location ?? '',
    technicianId: row.technician_id,
    isActive: row.is_active,
    notes: row.notes ?? '',
  };
}

function mapBin(row: BinRow): InventoryBin {
  return {
    id: row.id,
    companyId: row.company_id,
    warehouseId: row.warehouse_id,
    code: row.code,
    name: row.name,
    description: row.description ?? '',
    isActive: row.is_active,
  };
}

function mapItem(row: ItemRow): InventoryItem {
  return {
    id: row.id,
    companyId: row.company_id,
    internalName: row.internal_name,
    category: row.category ?? '',
    manufacturer: row.manufacturer ?? '',
    oem: row.oem ?? '',
    partNumber: row.part_number ?? '',
    alternatePartNumber: row.alternate_part_number ?? '',
    description: row.description ?? '',
    unit: row.unit ?? 'pcs',
    minimumQuantity: numberValue(row.minimum_quantity),
    averageCost: numberValue(row.average_cost),
    totalQuantity: numberValue(row.total_quantity),
    isActive: row.is_active,
    notes: row.notes ?? '',
  };
}

function mapSupplier(row: SupplierRow): InventorySupplier {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    contactName: row.contact_name ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    website: row.website ?? '',
    address: row.address ?? '',
    isActive: row.is_active,
  };
}

function mapStockBalance(row: StockBalanceRow): InventoryStockBalance {
  return {
    id: row.id,
    companyId: row.company_id,
    itemId: row.item_id,
    warehouseId: row.warehouse_id,
    binId: row.bin_id,
    quantity: numberValue(row.quantity),
    updatedAt: row.updated_at,
  };
}

function mapMovement(row: MovementRow): InventoryMovement {
  return {
    id: row.id,
    companyId: row.company_id,
    itemId: row.item_id,
    movementType: row.movement_type,
    quantity: numberValue(row.quantity),
    unitCost: numberValue(row.unit_cost),
    totalCost: numberValue(row.total_cost),
    fromWarehouseId: row.from_warehouse_id,
    toWarehouseId: row.to_warehouse_id,
    supplierId: row.supplier_id,
    jobId: row.job_id,
    referenceNumber: row.reference_number ?? '',
    receiptId: row.receipt_id ?? null,
    receiptLineId: row.receipt_line_id ?? null,
    balanceBefore: row.balance_before == null ? null : numberValue(row.balance_before),
    balanceAfter: row.balance_after == null ? null : numberValue(row.balance_after),
    averageCostBefore: row.average_cost_before == null ? null : numberValue(row.average_cost_before),
    averageCostAfter: row.average_cost_after == null ? null : numberValue(row.average_cost_after),
    notes: row.notes ?? '',
    createdAt: row.created_at,
  };
}

function mapReceipt(row: ReceiptRow): InventoryStockReceipt {
  return {
    id: row.id,
    companyId: row.company_id,
    supplierId: row.supplier_id,
    warehouseId: row.warehouse_id,
    binId: row.bin_id,
    receiptDate: row.receipt_date,
    poNumber: row.po_number ?? '',
    invoiceNumber: row.invoice_number ?? '',
    status: row.status,
    notes: row.notes ?? '',
    postedAt: row.posted_at,
    postedByUserId: row.posted_by_user_id,
    canceledAt: row.canceled_at ?? null,
    cancelReason: row.cancel_reason ?? '',
    createdAt: row.created_at,
  };
}

function mapReceiptLine(row: ReceiptLineRow): InventoryStockReceiptLine {
  return {
    id: row.id,
    companyId: row.company_id,
    receiptId: row.receipt_id,
    itemId: row.item_id,
    quantity: numberValue(row.quantity),
    unitCost: numberValue(row.unit_cost),
    extraCost: numberValue(row.extra_cost),
    currency: row.currency ?? 'USD',
    movementId: row.movement_id,
  };
}

export async function listWarehouseSnapshot(companyId: string): Promise<WarehouseSnapshot> {
  const [
    warehouses,
    bins,
    items,
    suppliers,
    stockBalances,
    movements,
    receipts,
    receiptLines,
  ] = await Promise.all([
    supabaseRequest<WarehouseRow[]>(`inventory_warehouses?company_id=${sqlEq(companyId)}&order=name.asc&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<BinRow[]>(`inventory_bins?company_id=${sqlEq(companyId)}&order=code.asc&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<ItemRow[]>(`inventory_items?company_id=${sqlEq(companyId)}&order=internal_name.asc&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<SupplierRow[]>(`inventory_suppliers?company_id=${sqlEq(companyId)}&order=name.asc&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<StockBalanceRow[]>(`inventory_stock_balances?company_id=${sqlEq(companyId)}&order=updated_at.desc&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<MovementRow[]>(`inventory_movements?company_id=${sqlEq(companyId)}&order=created_at.desc&limit=200`),
    supabaseRequest<ReceiptRow[]>(`inventory_stock_receipts?company_id=${sqlEq(companyId)}&order=created_at.desc&limit=200`),
    supabaseRequest<ReceiptLineRow[]>(`inventory_stock_receipt_lines?company_id=${sqlEq(companyId)}&order=created_at.asc&limit=${DEFAULT_LIMIT}`),
  ]);

  return {
    warehouses: warehouses.map(mapWarehouse),
    bins: bins.map(mapBin),
    items: items.map(mapItem),
    suppliers: suppliers.map(mapSupplier),
    stockBalances: stockBalances.map(mapStockBalance),
    movements: movements.map(mapMovement),
    receipts: receipts.map(mapReceipt),
    receiptLines: receiptLines.map(mapReceiptLine),
  };
}

export async function createInventoryWarehouse(companyId: string, draft: InventoryWarehouseDraft): Promise<InventoryWarehouse> {
  const [row] = await supabaseRequest<WarehouseRow[]>('inventory_warehouses?select=*', {
    method: 'POST',
    select: true,
    body: [{
      company_id: companyId,
      name: draft.name.trim(),
      type: draft.type,
      location: draft.location.trim(),
      technician_id: draft.type === 'technician_vehicle' ? draft.technicianId : null,
      notes: draft.notes.trim(),
    }],
  });
  return mapWarehouse(row);
}

export async function createInventoryItem(companyId: string, draft: InventoryItemDraft): Promise<InventoryItem> {
  const [row] = await supabaseRequest<ItemRow[]>('inventory_items?select=*', {
    method: 'POST',
    select: true,
    body: [{
      company_id: companyId,
      internal_name: draft.internalName.trim(),
      category: draft.category.trim(),
      manufacturer: draft.manufacturer.trim(),
      oem: draft.oem.trim(),
      part_number: draft.partNumber.trim(),
      alternate_part_number: draft.alternatePartNumber.trim(),
      description: draft.description.trim(),
      unit: draft.unit.trim() || 'pcs',
      minimum_quantity: Math.max(0, Number(draft.minimumQuantity) || 0),
      notes: draft.notes.trim(),
    }],
  });
  return mapItem(row);
}

export async function createInventorySupplier(companyId: string, draft: InventorySupplierDraft): Promise<InventorySupplier> {
  const [row] = await supabaseRequest<SupplierRow[]>('inventory_suppliers?select=*', {
    method: 'POST',
    select: true,
    body: [{
      company_id: companyId,
      name: draft.name.trim(),
      contact_name: draft.contactName.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      website: draft.website.trim(),
      address: draft.address.trim(),
    }],
  });
  return mapSupplier(row);
}

export async function createInventoryReceipt(companyId: string, draft: InventoryReceiptDraft): Promise<InventoryStockReceipt> {
  const [row] = await supabaseRequest<ReceiptRow[]>('inventory_stock_receipts?select=*', {
    method: 'POST',
    select: true,
    body: [{
      company_id: companyId,
      supplier_id: draft.supplierId || null,
      warehouse_id: draft.warehouseId,
      bin_id: draft.binId || null,
      receipt_date: draft.receiptDate,
      po_number: draft.poNumber.trim(),
      invoice_number: draft.invoiceNumber.trim(),
      notes: draft.notes.trim(),
      status: 'draft',
    }],
  });
  return mapReceipt(row);
}

export async function updateInventoryReceipt(receipt: InventoryStockReceipt, patch: Partial<InventoryReceiptDraft>): Promise<InventoryStockReceipt> {
  const [row] = await supabaseRequest<ReceiptRow[]>(`inventory_stock_receipts?id=${sqlEq(receipt.id)}&company_id=${sqlEq(receipt.companyId)}&select=*`, {
    method: 'PATCH',
    select: true,
    body: {
      ...(patch.supplierId !== undefined ? { supplier_id: patch.supplierId || null } : {}),
      ...(patch.warehouseId !== undefined ? { warehouse_id: patch.warehouseId } : {}),
      ...(patch.binId !== undefined ? { bin_id: patch.binId || null } : {}),
      ...(patch.receiptDate !== undefined ? { receipt_date: patch.receiptDate } : {}),
      ...(patch.poNumber !== undefined ? { po_number: patch.poNumber.trim() } : {}),
      ...(patch.invoiceNumber !== undefined ? { invoice_number: patch.invoiceNumber.trim() } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes.trim() } : {}),
    },
  });
  return mapReceipt(row);
}

export async function createInventoryReceiptLine(companyId: string, draft: InventoryReceiptLineDraft): Promise<InventoryStockReceiptLine> {
  const [row] = await supabaseRequest<ReceiptLineRow[]>('inventory_stock_receipt_lines?select=*', {
    method: 'POST',
    select: true,
    body: [{
      company_id: companyId,
      receipt_id: draft.receiptId,
      item_id: draft.itemId,
      quantity: Math.max(0, Number(draft.quantity) || 0),
      unit_cost: Math.max(0, Number(draft.unitCost) || 0),
      extra_cost: Math.max(0, Number(draft.extraCost) || 0),
      currency: draft.currency || 'USD',
    }],
  });
  return mapReceiptLine(row);
}

export async function updateInventoryReceiptLine(line: InventoryStockReceiptLine, patch: Partial<InventoryReceiptLineDraft>): Promise<InventoryStockReceiptLine> {
  const [row] = await supabaseRequest<ReceiptLineRow[]>(`inventory_stock_receipt_lines?id=${sqlEq(line.id)}&company_id=${sqlEq(line.companyId)}&select=*`, {
    method: 'PATCH',
    select: true,
    body: {
      ...(patch.itemId !== undefined ? { item_id: patch.itemId } : {}),
      ...(patch.quantity !== undefined ? { quantity: Math.max(0, Number(patch.quantity) || 0) } : {}),
      ...(patch.unitCost !== undefined ? { unit_cost: Math.max(0, Number(patch.unitCost) || 0) } : {}),
      ...(patch.extraCost !== undefined ? { extra_cost: Math.max(0, Number(patch.extraCost) || 0) } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency || 'USD' } : {}),
    },
  });
  return mapReceiptLine(row);
}

export async function deleteInventoryReceiptLine(line: InventoryStockReceiptLine): Promise<void> {
  await supabaseRequest<void>(`inventory_stock_receipt_lines?id=${sqlEq(line.id)}&company_id=${sqlEq(line.companyId)}`, { method: 'DELETE' });
}

export async function postInventoryReceipt(receiptId: string) {
  return supabaseRpc<{ status: string; receipt_id: string; posted_lines: number }>('inventory_post_stock_receipt', { p_receipt_id: receiptId }, { timeoutMs: 30000 });
}

export async function cancelInventoryReceipt(receiptId: string, reason: string) {
  return supabaseRpc<{ status: string; receipt_id: string; canceled_lines: number }>('inventory_cancel_stock_receipt', { p_receipt_id: receiptId, p_reason: reason }, { timeoutMs: 30000 });
}

export function warehouseErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes('PGRST205') && raw.includes('inventory_')) {
    return 'Warehouse database tables are not available yet. Apply the Warehouse Supabase migrations and refresh the schema cache before using Inventory Control.';
  }
  const knownMessages: Record<string, string> = {
    RECEIPT_NOT_FOUND: 'Receipt was not found.',
    ACCESS_DENIED: 'You do not have permission to manage this warehouse.',
    RECEIPT_ALREADY_POSTED: 'This receipt has already been posted.',
    RECEIPT_NOT_DRAFT: 'Only draft receipts can be posted.',
    RECEIPT_HAS_NO_LINES: 'Add at least one line before posting.',
    INVALID_QUANTITY: 'Quantity must be greater than zero.',
    INVALID_UNIT_COST: 'Unit cost cannot be negative.',
    ITEM_NOT_FOUND: 'One of the receipt items was not found.',
    ITEM_COMPANY_MISMATCH: 'One of the receipt items belongs to another company.',
    WAREHOUSE_NOT_FOUND: 'Warehouse was not found.',
    WAREHOUSE_COMPANY_MISMATCH: 'Warehouse belongs to another company.',
    BIN_WAREHOUSE_MISMATCH: 'Selected bin does not belong to the selected warehouse.',
    SUPPLIER_COMPANY_MISMATCH: 'Supplier belongs to another company.',
    NEGATIVE_CURRENT_STOCK: 'Current stock is negative. Fix inventory before posting.',
    RECEIPT_HAS_LATER_MOVEMENTS: 'This receipt cannot be canceled because later movements exist for its items.',
    INSUFFICIENT_STOCK_TO_CANCEL: 'There is not enough stock to cancel this receipt.',
    UNSUPPORTED_CURRENCY: 'Only USD receipt lines can be posted in this stage.',
    POSTED_RECEIPT_LOCKED: 'Posted receipts cannot be edited directly.',
    POSTED_RECEIPT_LINES_LOCKED: 'Posted receipt lines cannot be edited directly.',
  };
  const code = Object.keys(knownMessages).find((key) => raw.includes(key));
  return code ? knownMessages[code] : raw;
}
