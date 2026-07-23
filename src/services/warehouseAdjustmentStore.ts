import { sqlEq, supabaseRequest, supabaseRpc } from './supabaseRest';

export type InventoryAdjustmentReason = 'initial' | 'count' | 'shortage' | 'damage' | 'found' | 'correction';
export type InventoryAdjustmentStatus = 'draft' | 'posted' | 'canceled';

export type AdjustmentItem = {
  id: string;
  name: string;
  partNumber: string;
  unit: string;
  averageCost: number;
};

export type AdjustmentWarehouse = {
  id: string;
  name: string;
};

export type AdjustmentBin = {
  id: string;
  warehouseId: string;
  code: string;
  name: string;
};

export type AdjustmentBalance = {
  itemId: string;
  warehouseId: string;
  binId: string | null;
  quantity: number;
};

export type AdjustmentDocument = {
  id: string;
  warehouseId: string;
  binId: string | null;
  adjustmentDate: string;
  reason: InventoryAdjustmentReason;
  referenceNumber: string;
  status: InventoryAdjustmentStatus;
  notes: string;
  postedAt: string | null;
  canceledAt: string | null;
  cancelReason: string;
  createdAt: string;
};

export type AdjustmentLine = {
  id: string;
  adjustmentId: string;
  itemId: string;
  systemQuantity: number;
  countedQuantity: number;
  quantityDelta: number;
  unitCost: number;
  movementId: string | null;
};

export type WarehouseAdjustmentSnapshot = {
  items: AdjustmentItem[];
  warehouses: AdjustmentWarehouse[];
  bins: AdjustmentBin[];
  balances: AdjustmentBalance[];
  documents: AdjustmentDocument[];
  lines: AdjustmentLine[];
};

export type InventoryAdjustmentDraft = {
  idempotencyKey: string;
  itemId: string;
  warehouseId: string;
  binId?: string | null;
  countedQuantity: number;
  reason: InventoryAdjustmentReason;
  unitCost: number;
  referenceNumber?: string;
  notes?: string;
};

type ItemRow = {
  id: string;
  internal_name: string;
  part_number: string | null;
  unit: string | null;
  average_cost: number | string | null;
};

type WarehouseRow = { id: string; name: string };
type BinRow = { id: string; warehouse_id: string; code: string; name: string };
type BalanceRow = { item_id: string; warehouse_id: string; bin_id: string | null; quantity: number | string };
type DocumentRow = {
  id: string;
  warehouse_id: string;
  bin_id: string | null;
  adjustment_date: string;
  reason: InventoryAdjustmentReason;
  reference_number: string | null;
  status: InventoryAdjustmentStatus;
  notes: string | null;
  posted_at: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
};
type LineRow = {
  id: string;
  adjustment_id: string;
  item_id: string;
  system_quantity: number | string | null;
  counted_quantity: number | string | null;
  quantity_delta: number | string;
  unit_cost: number | string | null;
  movement_id: string | null;
};

function numberValue(value: number | string | null | undefined) {
  return Number(value) || 0;
}

export async function listWarehouseAdjustmentSnapshot(companyId: string): Promise<WarehouseAdjustmentSnapshot> {
  const [items, warehouses, bins, balances, documents, lines] = await Promise.all([
    supabaseRequest<ItemRow[]>(`inventory_items?company_id=${sqlEq(companyId)}&is_active=eq.true&select=id,internal_name,part_number,unit,average_cost&order=internal_name.asc&limit=1000`),
    supabaseRequest<WarehouseRow[]>(`inventory_warehouses?company_id=${sqlEq(companyId)}&is_active=eq.true&select=id,name&order=name.asc&limit=1000`),
    supabaseRequest<BinRow[]>(`inventory_bins?company_id=${sqlEq(companyId)}&is_active=eq.true&select=id,warehouse_id,code,name&order=code.asc&limit=1000`),
    supabaseRequest<BalanceRow[]>(`inventory_stock_balances?company_id=${sqlEq(companyId)}&select=item_id,warehouse_id,bin_id,quantity&limit=5000`),
    supabaseRequest<DocumentRow[]>(`inventory_adjustment_documents?company_id=${sqlEq(companyId)}&select=id,warehouse_id,bin_id,adjustment_date,reason,reference_number,status,notes,posted_at,canceled_at,cancel_reason,created_at&order=created_at.desc&limit=50`),
    supabaseRequest<LineRow[]>(`inventory_adjustment_lines?company_id=${sqlEq(companyId)}&select=id,adjustment_id,item_id,system_quantity,counted_quantity,quantity_delta,unit_cost,movement_id&order=created_at.desc&limit=200`),
  ]);

  return {
    items: items.map((row) => ({
      id: row.id,
      name: row.internal_name,
      partNumber: row.part_number ?? '',
      unit: row.unit ?? 'pcs',
      averageCost: numberValue(row.average_cost),
    })),
    warehouses: warehouses.map((row) => ({ id: row.id, name: row.name })),
    bins: bins.map((row) => ({ id: row.id, warehouseId: row.warehouse_id, code: row.code, name: row.name })),
    balances: balances.map((row) => ({
      itemId: row.item_id,
      warehouseId: row.warehouse_id,
      binId: row.bin_id,
      quantity: numberValue(row.quantity),
    })),
    documents: documents.map((row) => ({
      id: row.id,
      warehouseId: row.warehouse_id,
      binId: row.bin_id,
      adjustmentDate: row.adjustment_date,
      reason: row.reason,
      referenceNumber: row.reference_number ?? '',
      status: row.status,
      notes: row.notes ?? '',
      postedAt: row.posted_at,
      canceledAt: row.canceled_at,
      cancelReason: row.cancel_reason ?? '',
      createdAt: row.created_at,
    })),
    lines: lines.map((row) => ({
      id: row.id,
      adjustmentId: row.adjustment_id,
      itemId: row.item_id,
      systemQuantity: numberValue(row.system_quantity),
      countedQuantity: numberValue(row.counted_quantity),
      quantityDelta: numberValue(row.quantity_delta),
      unitCost: numberValue(row.unit_cost),
      movementId: row.movement_id,
    })),
  };
}

export async function postInventoryStockAdjustment(companyId: string, draft: InventoryAdjustmentDraft) {
  return supabaseRpc<{
    status: InventoryAdjustmentStatus;
    adjustment_id: string;
    adjustment_line_id: string;
    movement_id: string;
    system_quantity?: number;
    counted_quantity?: number;
    quantity_delta?: number;
    new_total_quantity?: number;
    average_cost?: number;
    idempotent_replay: boolean;
  }>('inventory_adjust_stock', {
    p_company_id: companyId,
    p_idempotency_key: draft.idempotencyKey,
    p_item_id: draft.itemId,
    p_warehouse_id: draft.warehouseId,
    p_bin_id: draft.binId || null,
    p_counted_quantity: Math.max(0, Number(draft.countedQuantity) || 0),
    p_reason: draft.reason,
    p_unit_cost: Math.max(0, Number(draft.unitCost) || 0),
    p_reference_number: draft.referenceNumber?.trim() ?? '',
    p_notes: draft.notes?.trim() ?? '',
  }, { timeoutMs: 30000 });
}

export async function cancelInventoryStockAdjustment(adjustmentId: string, reason: string) {
  return supabaseRpc<{ status: InventoryAdjustmentStatus; adjustment_id: string; canceled_lines?: number; idempotent_replay: boolean }>(
    'inventory_cancel_adjustment',
    { p_adjustment_id: adjustmentId, p_reason: reason.trim() },
    { timeoutMs: 30000 },
  );
}

export function warehouseAdjustmentErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const known: Record<string, string> = {
    ACCESS_DENIED: 'You do not have permission to adjust this warehouse.',
    IDEMPOTENCY_KEY_REQUIRED: 'The adjustment retry key is missing. Close the form and try again.',
    INVALID_COUNTED_QUANTITY: 'Counted quantity cannot be negative.',
    INVALID_ADJUSTMENT_REASON: 'Select a valid adjustment reason.',
    WAREHOUSE_NOT_FOUND: 'Warehouse location was not found.',
    WAREHOUSE_COMPANY_MISMATCH: 'Warehouse belongs to another company.',
    BIN_WAREHOUSE_MISMATCH: 'Exact bin does not belong to the selected warehouse.',
    ITEM_NOT_FOUND: 'Inventory part was not found.',
    ITEM_COMPANY_MISMATCH: 'Inventory part belongs to another company.',
    NO_ADJUSTMENT_NEEDED: 'Counted quantity already matches the system quantity.',
    INSUFFICIENT_STOCK: 'This correction would make inventory negative.',
    INVALID_UNIT_COST: 'Unit cost cannot be negative.',
    ADJUSTMENT_NOT_FOUND: 'Adjustment was not found.',
    ADJUSTMENT_NOT_POSTED: 'Only a posted adjustment can be reversed.',
    ADJUSTMENT_MOVEMENT_NOT_FOUND: 'The original adjustment movement could not be found.',
    ADJUSTMENT_HAS_LATER_MOVEMENTS: 'This adjustment cannot be reversed because the part has newer warehouse activity.',
    INSUFFICIENT_STOCK_TO_CANCEL: 'There is not enough stock to reverse this adjustment.',
  };

  const code = Object.keys(known).find((key) => raw.includes(key));
  if (code) return known[code];
  if (raw.includes('PGRST202') || (raw.includes('PGRST205') && raw.includes('inventory_adjustment'))) {
    return 'Stock adjustments are not installed in Supabase yet. Apply migration 20260723013000_warehouse_adjustments_stage5.sql and refresh the schema cache.';
  }

  try {
    const parsed = JSON.parse(raw) as { error?: string; message?: string };
    return parsed.error || parsed.message || raw;
  } catch {
    return raw;
  }
}
