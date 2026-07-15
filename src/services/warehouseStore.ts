import { sqlEq, supabaseRequest } from './supabaseRest';

export type WarehouseType = 'main' | 'office' | 'technician_vehicle' | 'other';
export type InventoryMovementType = 'receipt' | 'transfer_out' | 'transfer_in' | 'job_issue' | 'job_return' | 'adjustment';

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
  notes: string;
  createdAt: string;
};

export type WarehouseSnapshot = {
  warehouses: InventoryWarehouse[];
  bins: InventoryBin[];
  items: InventoryItem[];
  suppliers: InventorySupplier[];
  stockBalances: InventoryStockBalance[];
  movements: InventoryMovement[];
};

export type InventoryWarehouseDraft = Pick<InventoryWarehouse, 'name' | 'type' | 'location' | 'technicianId' | 'notes'>;
export type InventoryItemDraft = Pick<InventoryItem, 'internalName' | 'category' | 'manufacturer' | 'oem' | 'partNumber' | 'alternatePartNumber' | 'description' | 'unit' | 'minimumQuantity' | 'notes'>;
export type InventorySupplierDraft = Pick<InventorySupplier, 'name' | 'contactName' | 'phone' | 'email' | 'website' | 'address'>;

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
  notes: string | null;
  created_at: string;
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
    notes: row.notes ?? '',
    createdAt: row.created_at,
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
  ] = await Promise.all([
    supabaseRequest<WarehouseRow[]>(`inventory_warehouses?company_id=${sqlEq(companyId)}&order=name.asc&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<BinRow[]>(`inventory_bins?company_id=${sqlEq(companyId)}&order=code.asc&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<ItemRow[]>(`inventory_items?company_id=${sqlEq(companyId)}&order=internal_name.asc&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<SupplierRow[]>(`inventory_suppliers?company_id=${sqlEq(companyId)}&order=name.asc&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<StockBalanceRow[]>(`inventory_stock_balances?company_id=${sqlEq(companyId)}&order=updated_at.desc&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<MovementRow[]>(`inventory_movements?company_id=${sqlEq(companyId)}&order=created_at.desc&limit=200`),
  ]);

  return {
    warehouses: warehouses.map(mapWarehouse),
    bins: bins.map(mapBin),
    items: items.map(mapItem),
    suppliers: suppliers.map(mapSupplier),
    stockBalances: stockBalances.map(mapStockBalance),
    movements: movements.map(mapMovement),
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
