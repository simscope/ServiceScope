import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Boxes, History, MapPin, Package, Settings, Truck, Warehouse } from 'lucide-react';
import {
  cancelInventoryReceipt,
  cancelInventoryAdjustment,
  cancelInventoryTransfer,
  createInventoryAdjustment,
  createInventoryAdjustmentLine,
  createInventoryItem,
  createInventoryReceipt,
  createInventoryReceiptLine,
  createInventorySupplier,
  createInventoryTransfer,
  createInventoryTransferLine,
  createInventoryWarehouse,
  deleteInventoryAdjustmentLine,
  deleteInventoryReceiptLine,
  deleteInventoryTransferLine,
  listWarehouseSnapshot,
  postInventoryAdjustment,
  postInventoryReceipt,
  postInventoryTransfer,
  updateInventoryAdjustment,
  updateInventoryAdjustmentLine,
  updateInventoryReceipt,
  updateInventoryReceiptLine,
  updateInventoryTransfer,
  updateInventoryTransferLine,
  warehouseErrorMessage,
  type InventoryAdjustmentDocument,
  type InventoryAdjustmentDraft,
  type InventoryAdjustmentLine,
  type InventoryAdjustmentLineDraft,
  type InventoryItem,
  type InventoryItemDraft,
  type InventoryReceiptDraft,
  type InventoryReceiptLineDraft,
  type InventorySupplierDraft,
  type InventoryTransferDocument,
  type InventoryTransferDraft,
  type InventoryTransferLine,
  type InventoryTransferLineDraft,
  type InventoryWarehouseDraft,
  type InventoryStockReceipt,
  type InventoryStockReceiptLine,
  type WarehouseSnapshot,
} from '../../services/warehouseStore';
import { money } from '../../utils/format';

type WarehouseTab = 'dashboard' | 'materials' | 'stock' | 'receipts' | 'transfers' | 'adjustments' | 'lowStock' | 'suppliers' | 'history' | 'settings';

type WarehousePageProps = {
  companyId: string;
};

type WarehouseFormMode = 'none' | 'warehouse' | 'item' | 'supplier';

const emptySnapshot: WarehouseSnapshot = {
  warehouses: [],
  bins: [],
  items: [],
  suppliers: [],
  stockBalances: [],
  movements: [],
  receipts: [],
  receiptLines: [],
  transfers: [],
  transferLines: [],
  adjustments: [],
  adjustmentLines: [],
};

const emptyWarehouseDraft: InventoryWarehouseDraft = {
  name: '',
  type: 'main',
  location: '',
  technicianId: null,
  notes: '',
};

const emptyItemDraft: InventoryItemDraft = {
  internalName: '',
  category: '',
  manufacturer: '',
  oem: '',
  partNumber: '',
  alternatePartNumber: '',
  description: '',
  unit: 'pcs',
  minimumQuantity: 0,
  notes: '',
};

const emptySupplierDraft: InventorySupplierDraft = {
  name: '',
  contactName: '',
  phone: '',
  email: '',
  website: '',
  address: '',
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyReceiptDraft = (): InventoryReceiptDraft => ({
  supplierId: null,
  warehouseId: '',
  binId: null,
  receiptDate: todayIso(),
  poNumber: '',
  invoiceNumber: '',
  notes: '',
});

const emptyReceiptLineDraft = (receiptId = ''): InventoryReceiptLineDraft => ({
  receiptId,
  itemId: '',
  quantity: 1,
  unitCost: 0,
  extraCost: 0,
  currency: 'USD',
});

const emptyTransferDraft = (): InventoryTransferDraft => ({
  fromWarehouseId: '',
  fromBinId: null,
  toWarehouseId: '',
  toBinId: null,
  transferDate: todayIso(),
  referenceNumber: '',
  notes: '',
});

const emptyTransferLineDraft = (transferId = ''): InventoryTransferLineDraft => ({
  transferId,
  itemId: '',
  quantity: 1,
});

const emptyAdjustmentDraft = (): InventoryAdjustmentDraft => ({
  warehouseId: '',
  binId: null,
  adjustmentDate: todayIso(),
  reason: 'count',
  referenceNumber: '',
  notes: '',
});

const emptyAdjustmentLineDraft = (adjustmentId = ''): InventoryAdjustmentLineDraft => ({
  adjustmentId,
  itemId: '',
  quantityDelta: 1,
  unitCost: 0,
});

const tabs: Array<{ key: WarehouseTab; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'materials', label: 'Materials' },
  { key: 'stock', label: 'Stock' },
  { key: 'receipts', label: 'Receipts' },
  { key: 'transfers', label: 'Transfers' },
  { key: 'adjustments', label: 'Adjustments' },
  { key: 'lowStock', label: 'Low Stock' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'history', label: 'Movement History' },
  { key: 'settings', label: 'Settings' },
];

function formatQty(value: number, unit = '') {
  const clean = Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return unit ? `${clean} ${unit}` : clean;
}

function EmptyWarehouseState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="warehouse-empty-state">
      <Warehouse size={24} aria-hidden="true" />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function WarehousePage({ companyId }: WarehousePageProps) {
  const [activeTab, setActiveTab] = useState<WarehouseTab>('dashboard');
  const [search, setSearch] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [snapshot, setSnapshot] = useState<WarehouseSnapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [formMode, setFormMode] = useState<WarehouseFormMode>('none');
  const [warehouseDraft, setWarehouseDraft] = useState<InventoryWarehouseDraft>(emptyWarehouseDraft);
  const [itemDraft, setItemDraft] = useState<InventoryItemDraft>(emptyItemDraft);
  const [supplierDraft, setSupplierDraft] = useState<InventorySupplierDraft>(emptySupplierDraft);
  const [receiptDraft, setReceiptDraft] = useState<InventoryReceiptDraft>(() => emptyReceiptDraft());
  const [receiptLineDraft, setReceiptLineDraft] = useState<InventoryReceiptLineDraft>(() => emptyReceiptLineDraft());
  const [selectedReceiptId, setSelectedReceiptId] = useState('');
  const [receiptStatusFilter, setReceiptStatusFilter] = useState<'all' | 'draft' | 'posted' | 'canceled'>('all');
  const [transferDraft, setTransferDraft] = useState<InventoryTransferDraft>(() => emptyTransferDraft());
  const [transferLineDraft, setTransferLineDraft] = useState<InventoryTransferLineDraft>(() => emptyTransferLineDraft());
  const [selectedTransferId, setSelectedTransferId] = useState('');
  const [transferStatusFilter, setTransferStatusFilter] = useState<'all' | 'draft' | 'posted' | 'canceled'>('all');
  const [adjustmentDraft, setAdjustmentDraft] = useState<InventoryAdjustmentDraft>(() => emptyAdjustmentDraft());
  const [adjustmentLineDraft, setAdjustmentLineDraft] = useState<InventoryAdjustmentLineDraft>(() => emptyAdjustmentLineDraft());
  const [selectedAdjustmentId, setSelectedAdjustmentId] = useState('');
  const [adjustmentStatusFilter, setAdjustmentStatusFilter] = useState<'all' | 'draft' | 'posted' | 'canceled'>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setStatus('');

    listWarehouseSnapshot(companyId)
      .then((nextSnapshot) => {
        if (cancelled) return;
        setSnapshot(nextSnapshot);
      })
      .catch((error) => {
        if (cancelled) return;
        setSnapshot(emptySnapshot);
        setStatus(error instanceof Error ? error.message : 'Warehouse data could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function reloadWarehouse() {
    const nextSnapshot = await listWarehouseSnapshot(companyId);
    setSnapshot(nextSnapshot);
    if (selectedReceiptId && !nextSnapshot.receipts.some((receipt) => receipt.id === selectedReceiptId)) {
      setSelectedReceiptId('');
    }
    if (selectedTransferId && !nextSnapshot.transfers.some((transfer) => transfer.id === selectedTransferId)) {
      setSelectedTransferId('');
    }
    if (selectedAdjustmentId && !nextSnapshot.adjustments.some((adjustment) => adjustment.id === selectedAdjustmentId)) {
      setSelectedAdjustmentId('');
    }
  }

  async function saveWarehouseDraft() {
    if (!warehouseDraft.name.trim()) {
      setStatus('Warehouse name is required.');
      return;
    }
    setStatus('Saving warehouse...');
    try {
      await createInventoryWarehouse(companyId, warehouseDraft);
      setWarehouseDraft(emptyWarehouseDraft);
      setFormMode('none');
      await reloadWarehouse();
      setStatus('Warehouse saved.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Warehouse could not be saved.');
    }
  }

  async function saveItemDraft() {
    if (!itemDraft.internalName.trim()) {
      setStatus('Item name is required.');
      return;
    }
    setStatus('Saving inventory item...');
    try {
      await createInventoryItem(companyId, itemDraft);
      setItemDraft(emptyItemDraft);
      setFormMode('none');
      await reloadWarehouse();
      setStatus('Inventory item saved.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Inventory item could not be saved.');
    }
  }

  async function saveSupplierDraft() {
    if (!supplierDraft.name.trim()) {
      setStatus('Supplier name is required.');
      return;
    }
    setStatus('Saving supplier...');
    try {
      await createInventorySupplier(companyId, supplierDraft);
      setSupplierDraft(emptySupplierDraft);
      setFormMode('none');
      await reloadWarehouse();
      setStatus('Supplier saved.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Supplier could not be saved.');
    }
  }

  async function saveReceiptDraft() {
    if (!receiptDraft.warehouseId) {
      setStatus('Warehouse is required.');
      return;
    }
    if (receiptDraft.binId && !snapshot.bins.some((bin) => bin.id === receiptDraft.binId && bin.warehouseId === receiptDraft.warehouseId)) {
      setStatus('Selected bin does not belong to this warehouse.');
      return;
    }
    if (receiptDraft.supplierId && !snapshot.suppliers.some((supplier) => supplier.id === receiptDraft.supplierId && supplier.isActive)) {
      setStatus('Select an active supplier or leave supplier empty.');
      return;
    }

    setStatus('Saving receipt draft...');
    try {
      const saved = selectedReceiptId
        ? await updateInventoryReceipt(snapshot.receipts.find((receipt) => receipt.id === selectedReceiptId) as InventoryStockReceipt, receiptDraft)
        : await createInventoryReceipt(companyId, receiptDraft);
      setSelectedReceiptId(saved.id);
      await reloadWarehouse();
      setStatus('Receipt draft saved.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function addReceiptLine() {
    const receiptId = selectedReceiptId;
    if (!receiptId) {
      setStatus('Save the receipt draft before adding lines.');
      return;
    }
    if (!receiptLineDraft.itemId) {
      setStatus('Select an item.');
      return;
    }
    if ((Number(receiptLineDraft.quantity) || 0) <= 0) {
      setStatus('Quantity must be greater than zero.');
      return;
    }
    if ((Number(receiptLineDraft.unitCost) || 0) < 0) {
      setStatus('Unit cost cannot be negative.');
      return;
    }
    if (snapshot.receiptLines.some((line) => line.receiptId === receiptId && line.itemId === receiptLineDraft.itemId)) {
      setStatus('This item is already on the receipt. Update the existing line instead.');
      return;
    }

    setStatus('Adding receipt line...');
    try {
      await createInventoryReceiptLine(companyId, { ...receiptLineDraft, receiptId });
      setReceiptLineDraft(emptyReceiptLineDraft(receiptId));
      await reloadWarehouse();
      setStatus('Receipt line added.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function updateReceiptLine(line: InventoryStockReceiptLine, patch: Partial<InventoryReceiptLineDraft>) {
    setStatus('Saving line...');
    try {
      await updateInventoryReceiptLine(line, patch);
      await reloadWarehouse();
      setStatus('Receipt line saved.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function removeReceiptLine(line: InventoryStockReceiptLine) {
    setStatus('Removing line...');
    try {
      await deleteInventoryReceiptLine(line);
      await reloadWarehouse();
      setStatus('Receipt line removed.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function postReceipt(receipt: InventoryStockReceipt) {
    const lines = snapshot.receiptLines.filter((line) => line.receiptId === receipt.id);
    if (!lines.length) {
      setStatus('Add at least one line before posting.');
      return;
    }
    if (lines.some((line) => line.unitCost === 0)) {
      const confirmedZeroCost = window.confirm('This receipt includes zero-cost lines. Continue only for warranty, free replacement, donated stock, or opening correction.');
      if (!confirmedZeroCost) return;
    }
    const confirmed = window.confirm('This receipt will update stock balances and inventory cost. Posted receipts cannot be edited.');
    if (!confirmed) return;

    setStatus('Posting receipt...');
    try {
      await postInventoryReceipt(receipt.id);
      await reloadWarehouse();
      setStatus('Receipt posted. Stock balances and average cost were updated.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function cancelReceipt(receipt: InventoryStockReceipt) {
    const reason = window.prompt('Cancel reason');
    if (reason === null) return;
    setStatus('Canceling receipt...');
    try {
      await cancelInventoryReceipt(receipt.id, reason);
      await reloadWarehouse();
      setStatus('Receipt canceled.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function saveTransferDraft() {
    if (!transferDraft.fromWarehouseId || !transferDraft.toWarehouseId) {
      setStatus('Source and destination warehouses are required.');
      return;
    }
    if (transferDraft.fromWarehouseId === transferDraft.toWarehouseId && (transferDraft.fromBinId || null) === (transferDraft.toBinId || null)) {
      setStatus('Source and destination must be different.');
      return;
    }
    setStatus('Saving transfer draft...');
    try {
      const saved = selectedTransferId
        ? await updateInventoryTransfer(snapshot.transfers.find((transfer) => transfer.id === selectedTransferId) as InventoryTransferDocument, transferDraft)
        : await createInventoryTransfer(companyId, transferDraft);
      setSelectedTransferId(saved.id);
      await reloadWarehouse();
      setStatus('Transfer draft saved.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function addTransferLine() {
    if (!selectedTransferId) {
      setStatus('Save the transfer draft before adding lines.');
      return;
    }
    if (!transferLineDraft.itemId) {
      setStatus('Select an item.');
      return;
    }
    if ((Number(transferLineDraft.quantity) || 0) <= 0) {
      setStatus('Quantity must be greater than zero.');
      return;
    }
    if (snapshot.transferLines.some((line) => line.transferId === selectedTransferId && line.itemId === transferLineDraft.itemId)) {
      setStatus('This item is already on the transfer. Update the existing line instead.');
      return;
    }
    setStatus('Adding transfer line...');
    try {
      await createInventoryTransferLine(companyId, { ...transferLineDraft, transferId: selectedTransferId });
      setTransferLineDraft(emptyTransferLineDraft(selectedTransferId));
      await reloadWarehouse();
      setStatus('Transfer line added.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function updateTransferLine(line: InventoryTransferLine, patch: Partial<InventoryTransferLineDraft>) {
    setStatus('Saving transfer line...');
    try {
      await updateInventoryTransferLine(line, patch);
      await reloadWarehouse();
      setStatus('Transfer line saved.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function removeTransferLine(line: InventoryTransferLine) {
    setStatus('Removing transfer line...');
    try {
      await deleteInventoryTransferLine(line);
      await reloadWarehouse();
      setStatus('Transfer line removed.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function postTransfer(transfer: InventoryTransferDocument) {
    if (!snapshot.transferLines.some((line) => line.transferId === transfer.id)) {
      setStatus('Add at least one line before posting.');
      return;
    }
    if (!window.confirm('This transfer will move stock between locations without changing company average cost. Posted transfers cannot be edited.')) return;
    setStatus('Posting transfer...');
    try {
      await postInventoryTransfer(transfer.id);
      await reloadWarehouse();
      setStatus('Transfer posted.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function cancelTransfer(transfer: InventoryTransferDocument) {
    const reason = window.prompt('Cancel reason');
    if (reason === null) return;
    setStatus('Canceling transfer...');
    try {
      await cancelInventoryTransfer(transfer.id, reason);
      await reloadWarehouse();
      setStatus('Transfer canceled.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function saveAdjustmentDraft() {
    if (!adjustmentDraft.warehouseId) {
      setStatus('Warehouse is required.');
      return;
    }
    setStatus('Saving adjustment draft...');
    try {
      const saved = selectedAdjustmentId
        ? await updateInventoryAdjustment(snapshot.adjustments.find((adjustment) => adjustment.id === selectedAdjustmentId) as InventoryAdjustmentDocument, adjustmentDraft)
        : await createInventoryAdjustment(companyId, adjustmentDraft);
      setSelectedAdjustmentId(saved.id);
      await reloadWarehouse();
      setStatus('Adjustment draft saved.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function addAdjustmentLine() {
    if (!selectedAdjustmentId) {
      setStatus('Save the adjustment draft before adding lines.');
      return;
    }
    if (!adjustmentLineDraft.itemId) {
      setStatus('Select an item.');
      return;
    }
    if ((Number(adjustmentLineDraft.quantityDelta) || 0) === 0) {
      setStatus('Quantity delta cannot be zero.');
      return;
    }
    if ((Number(adjustmentLineDraft.unitCost) || 0) < 0) {
      setStatus('Unit cost cannot be negative.');
      return;
    }
    if (snapshot.adjustmentLines.some((line) => line.adjustmentId === selectedAdjustmentId && line.itemId === adjustmentLineDraft.itemId)) {
      setStatus('This item is already on the adjustment. Update the existing line instead.');
      return;
    }
    setStatus('Adding adjustment line...');
    try {
      await createInventoryAdjustmentLine(companyId, { ...adjustmentLineDraft, adjustmentId: selectedAdjustmentId });
      setAdjustmentLineDraft(emptyAdjustmentLineDraft(selectedAdjustmentId));
      await reloadWarehouse();
      setStatus('Adjustment line added.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function updateAdjustmentLine(line: InventoryAdjustmentLine, patch: Partial<InventoryAdjustmentLineDraft>) {
    setStatus('Saving adjustment line...');
    try {
      await updateInventoryAdjustmentLine(line, patch);
      await reloadWarehouse();
      setStatus('Adjustment line saved.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function removeAdjustmentLine(line: InventoryAdjustmentLine) {
    setStatus('Removing adjustment line...');
    try {
      await deleteInventoryAdjustmentLine(line);
      await reloadWarehouse();
      setStatus('Adjustment line removed.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function postAdjustment(adjustment: InventoryAdjustmentDocument) {
    if (!snapshot.adjustmentLines.some((line) => line.adjustmentId === adjustment.id)) {
      setStatus('Add at least one line before posting.');
      return;
    }
    if (!window.confirm('This adjustment will change stock balances and may change average cost for positive adjustments. Posted adjustments cannot be edited.')) return;
    setStatus('Posting adjustment...');
    try {
      await postInventoryAdjustment(adjustment.id);
      await reloadWarehouse();
      setStatus('Adjustment posted.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  async function cancelAdjustment(adjustment: InventoryAdjustmentDocument) {
    const reason = window.prompt('Cancel reason');
    if (reason === null) return;
    setStatus('Canceling adjustment...');
    try {
      await cancelInventoryAdjustment(adjustment.id, reason);
      await reloadWarehouse();
      setStatus('Adjustment canceled.');
    } catch (error) {
      setStatus(warehouseErrorMessage(error));
    }
  }

  const itemById = useMemo(() => new Map(snapshot.items.map((item) => [item.id, item])), [snapshot.items]);
  const warehouseById = useMemo(() => new Map(snapshot.warehouses.map((warehouse) => [warehouse.id, warehouse])), [snapshot.warehouses]);
  const supplierById = useMemo(() => new Map(snapshot.suppliers.map((supplier) => [supplier.id, supplier])), [snapshot.suppliers]);

  const stockRows = useMemo(() => snapshot.stockBalances.map((balance) => {
    const item = itemById.get(balance.itemId);
    const warehouseRow = warehouseById.get(balance.warehouseId);
    return {
      balance,
      item,
      warehouse: warehouseRow,
      value: balance.quantity * (item?.averageCost ?? 0),
      low: item ? balance.quantity <= item.minimumQuantity : false,
    };
  }), [itemById, snapshot.stockBalances, warehouseById]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return snapshot.items.filter((item) => {
      const haystack = [
        item.internalName,
        item.category,
        item.manufacturer,
        item.oem,
        item.partNumber,
        item.alternatePartNumber,
        item.description,
      ].join(' ').toLowerCase();
      return !query || haystack.includes(query);
    });
  }, [search, snapshot.items]);

  const filteredStockRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return stockRows.filter(({ balance, item, warehouse: warehouseRow }) => {
      const matchesWarehouse = warehouseFilter === 'all' || balance.warehouseId === warehouseFilter;
      const haystack = `${item?.internalName ?? ''} ${item?.partNumber ?? ''} ${warehouseRow?.name ?? ''}`.toLowerCase();
      return matchesWarehouse && (!query || haystack.includes(query));
    });
  }, [search, stockRows, warehouseFilter]);

  const lowStockItems = useMemo(() => snapshot.items.filter((item) => item.minimumQuantity > 0 && item.totalQuantity <= item.minimumQuantity), [snapshot.items]);

  const summary = useMemo(() => ({
    warehouses: snapshot.warehouses.filter((warehouse) => warehouse.isActive).length,
    items: snapshot.items.filter((item) => item.isActive).length,
    totalQuantity: snapshot.items.reduce((sum, item) => sum + item.totalQuantity, 0),
    inventoryValue: snapshot.items.reduce((sum, item) => sum + item.totalQuantity * item.averageCost, 0),
    lowStock: lowStockItems.length,
  }), [lowStockItems.length, snapshot.items, snapshot.warehouses]);

  const selectedReceipt = useMemo(() => snapshot.receipts.find((receipt) => receipt.id === selectedReceiptId), [selectedReceiptId, snapshot.receipts]);
  const selectedTransfer = useMemo(() => snapshot.transfers.find((transfer) => transfer.id === selectedTransferId), [selectedTransferId, snapshot.transfers]);
  const selectedAdjustment = useMemo(() => snapshot.adjustments.find((adjustment) => adjustment.id === selectedAdjustmentId), [selectedAdjustmentId, snapshot.adjustments]);

  useEffect(() => {
    if (!selectedReceipt) return;
    setReceiptDraft({
      supplierId: selectedReceipt.supplierId,
      warehouseId: selectedReceipt.warehouseId,
      binId: selectedReceipt.binId,
      receiptDate: selectedReceipt.receiptDate,
      poNumber: selectedReceipt.poNumber,
      invoiceNumber: selectedReceipt.invoiceNumber,
      notes: selectedReceipt.notes,
    });
    setReceiptLineDraft((draft) => ({ ...draft, receiptId: selectedReceipt.id }));
  }, [selectedReceipt]);

  useEffect(() => {
    if (!selectedTransfer) return;
    setTransferDraft({
      fromWarehouseId: selectedTransfer.fromWarehouseId,
      fromBinId: selectedTransfer.fromBinId,
      toWarehouseId: selectedTransfer.toWarehouseId,
      toBinId: selectedTransfer.toBinId,
      transferDate: selectedTransfer.transferDate,
      referenceNumber: selectedTransfer.referenceNumber,
      notes: selectedTransfer.notes,
    });
    setTransferLineDraft((draft) => ({ ...draft, transferId: selectedTransfer.id }));
  }, [selectedTransfer]);

  useEffect(() => {
    if (!selectedAdjustment) return;
    setAdjustmentDraft({
      warehouseId: selectedAdjustment.warehouseId,
      binId: selectedAdjustment.binId,
      adjustmentDate: selectedAdjustment.adjustmentDate,
      reason: selectedAdjustment.reason,
      referenceNumber: selectedAdjustment.referenceNumber,
      notes: selectedAdjustment.notes,
    });
    setAdjustmentLineDraft((draft) => ({ ...draft, adjustmentId: selectedAdjustment.id }));
  }, [selectedAdjustment]);

  function renderDashboard() {
    return (
      <>
        <div className="warehouse-kpi-grid">
          <span><strong>{summary.warehouses}</strong> Active warehouses</span>
          <span><strong>{summary.items}</strong> Active items</span>
          <span><strong>{formatQty(summary.totalQuantity)}</strong> Total on hand</span>
          <span><strong>{money(summary.inventoryValue)}</strong> Inventory value</span>
          <span className={summary.lowStock ? 'warning' : ''}><strong>{summary.lowStock}</strong> Low stock</span>
        </div>

        <div className="warehouse-dashboard-grid">
          <section className="warehouse-panel">
            <div className="warehouse-panel-heading">
              <h2>Warehouses</h2>
              <MapPin size={18} aria-hidden="true" />
            </div>
            {snapshot.warehouses.length ? (
              <div className="warehouse-list">
                {snapshot.warehouses.map((warehouseRow) => (
                  <div className="warehouse-list-row" key={warehouseRow.id}>
                    <strong>{warehouseRow.name}</strong>
                    <span>{warehouseRow.type.replace(/_/g, ' ')} - {warehouseRow.location || 'No location'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyWarehouseState title="No warehouses yet" detail="Create main stock, office, and technician vehicle warehouses after applying the migration." />
            )}
          </section>

          <section className="warehouse-panel">
            <div className="warehouse-panel-heading">
              <h2>Recent movement</h2>
              <History size={18} aria-hidden="true" />
            </div>
            {snapshot.movements.length ? renderMovementTable(snapshot.movements.slice(0, 6)) : (
              <EmptyWarehouseState title="No movements yet" detail="Posted receipts, transfers, adjustments, and Job issues will appear here." />
            )}
          </section>
        </div>
      </>
    );
  }

  function renderMaterialsTable(items: InventoryItem[]) {
    if (!items.length) return <EmptyWarehouseState title="No inventory materials yet" detail="The warehouse catalog is empty. Add items through the inventory_items table or the next CRUD stage." />;

    return (
      <div className="warehouse-table-wrap">
        <table className="warehouse-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Category</th>
              <th>Manufacturer</th>
              <th>OEM</th>
              <th>Part #</th>
              <th>Unit</th>
              <th>Total stock</th>
              <th>Avg cost</th>
              <th>Min</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.internalName}</strong><span>{item.description || item.notes}</span></td>
                <td>{item.category || '-'}</td>
                <td>{item.manufacturer || '-'}</td>
                <td>{item.oem || '-'}</td>
                <td>{item.partNumber || '-'}</td>
                <td>{item.unit}</td>
                <td>{formatQty(item.totalQuantity, item.unit)}</td>
                <td>{money(item.averageCost)}</td>
                <td>{formatQty(item.minimumQuantity, item.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderStockTable(onlyLow = false) {
    const rows = onlyLow ? filteredStockRows.filter((row) => row.low) : filteredStockRows;
    if (!rows.length) return <EmptyWarehouseState title={onlyLow ? 'No low stock rows' : 'No stock balances yet'} detail="Stock balances are controlled by the database and will appear after posted warehouse movements." />;

    return (
      <div className="warehouse-table-wrap">
        <table className="warehouse-table stock">
          <thead>
            <tr>
              <th>Item</th>
              <th>Warehouse</th>
              <th>Bin</th>
              <th>On hand</th>
              <th>Min</th>
              <th>Avg cost</th>
              <th>Value</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ balance, item, warehouse: warehouseRow, value, low }) => (
              <tr className={low ? 'low' : ''} key={balance.id}>
                <td><strong>{item?.internalName ?? 'Unknown item'}</strong><span>{item?.partNumber || item?.manufacturer || ''}</span></td>
                <td>{warehouseRow?.name ?? 'Unknown warehouse'}</td>
                <td>{snapshot.bins.find((bin) => bin.id === balance.binId)?.code ?? '-'}</td>
                <td><strong>{formatQty(balance.quantity, item?.unit)}</strong></td>
                <td>{formatQty(item?.minimumQuantity ?? 0, item?.unit)}</td>
                <td>{money(item?.averageCost ?? 0)}</td>
                <td>{money(value)}</td>
                <td>{balance.updatedAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderMovementTable(rows = snapshot.movements) {
    if (!rows.length) return <EmptyWarehouseState title="No movement history yet" detail="Every posted receipt, transfer, adjustment, issue, and return will be stored here." />;

    return (
      <div className="warehouse-table-wrap">
        <table className="warehouse-table movement">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Item</th>
              <th>Qty</th>
              <th>Cost</th>
              <th>Balance before</th>
              <th>Balance after</th>
              <th>Avg after</th>
              <th>From</th>
              <th>To</th>
              <th>Supplier</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((movement) => (
              <tr key={movement.id}>
                <td>{movement.createdAt.slice(0, 10)}</td>
                <td>{movement.movementType.replace(/_/g, ' ')}</td>
                <td>{itemById.get(movement.itemId)?.internalName ?? 'Unknown item'}</td>
                <td>{formatQty(movement.quantity, itemById.get(movement.itemId)?.unit)}</td>
                <td>{money(movement.totalCost)}</td>
                <td>{movement.balanceBefore == null ? '-' : formatQty(movement.balanceBefore, itemById.get(movement.itemId)?.unit)}</td>
                <td>{movement.balanceAfter == null ? '-' : formatQty(movement.balanceAfter, itemById.get(movement.itemId)?.unit)}</td>
                <td>{movement.averageCostAfter == null ? '-' : money(movement.averageCostAfter)}</td>
                <td>{movement.fromWarehouseId ? warehouseById.get(movement.fromWarehouseId)?.name ?? '-' : '-'}</td>
                <td>{movement.toWarehouseId ? warehouseById.get(movement.toWarehouseId)?.name ?? '-' : '-'}</td>
                <td>{movement.supplierId ? supplierById.get(movement.supplierId)?.name ?? '-' : '-'}</td>
                <td>{movement.referenceNumber || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderSuppliers() {
    if (!snapshot.suppliers.length) return <EmptyWarehouseState title="No suppliers yet" detail="Suppliers and item supplier prices will be stored in inventory_suppliers and inventory_item_suppliers." />;

    return (
      <div className="warehouse-card-grid">
        {snapshot.suppliers.map((supplier) => (
          <article className="warehouse-supplier-card" key={supplier.id}>
            <strong>{supplier.name}</strong>
            <span>{supplier.contactName || 'No contact'}</span>
            <span>{supplier.phone || supplier.email || 'No phone or email'}</span>
            <span>{supplier.website || supplier.address || 'No website or address'}</span>
          </article>
        ))}
      </div>
    );
  }

  function renderReceipts() {
    const filteredReceipts = snapshot.receipts.filter((receipt) => receiptStatusFilter === 'all' || receipt.status === receiptStatusFilter);
    const receiptLines = selectedReceipt ? snapshot.receiptLines.filter((line) => line.receiptId === selectedReceipt.id) : [];
    const receiptMovements = selectedReceipt ? snapshot.movements.filter((movement) => movement.receiptId === selectedReceipt.id) : [];
    const receiptTotal = receiptLines.reduce((sum, line) => sum + line.quantity * line.unitCost + line.extraCost, 0);
    const editable = !selectedReceipt || selectedReceipt.status === 'draft';
    const binsForWarehouse = snapshot.bins.filter((bin) => bin.warehouseId === receiptDraft.warehouseId && bin.isActive);

    return (
      <div className="warehouse-receipts-grid">
        <section className="warehouse-panel">
          <div className="warehouse-panel-heading">
            <h2>Receipts</h2>
            <select value={receiptStatusFilter} onChange={(event) => setReceiptStatusFilter(event.target.value as typeof receiptStatusFilter)}>
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="posted">Posted</option>
              <option value="canceled">Canceled</option>
            </select>
          </div>
          <button className="secondary-button compact" type="button" onClick={() => { setSelectedReceiptId(''); setReceiptDraft(emptyReceiptDraft()); setReceiptLineDraft(emptyReceiptLineDraft()); }}>
            New draft receipt
          </button>
          {filteredReceipts.length ? (
            <div className="warehouse-receipt-list">
              {filteredReceipts.map((receipt) => {
                const lines = snapshot.receiptLines.filter((line) => line.receiptId === receipt.id);
                const total = lines.reduce((sum, line) => sum + line.quantity * line.unitCost + line.extraCost, 0);
                return (
                  <button className={selectedReceiptId === receipt.id ? 'active' : ''} type="button" onClick={() => setSelectedReceiptId(receipt.id)} key={receipt.id}>
                    <strong>{receipt.invoiceNumber || receipt.poNumber || `Receipt ${receipt.id.slice(0, 8)}`}</strong>
                    <span>{receipt.status} - {receipt.receiptDate} - {money(total)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyWarehouseState title="No receipts yet" detail="Create a draft receipt, add lines, then post it through the database RPC." />
          )}
        </section>

        <section className="warehouse-panel warehouse-receipt-editor">
          <div className="warehouse-panel-heading">
            <h2>{selectedReceipt ? `Receipt ${selectedReceipt.invoiceNumber || selectedReceipt.poNumber || selectedReceipt.id.slice(0, 8)}` : 'New receipt draft'}</h2>
            {selectedReceipt ? <span className={`warehouse-status ${selectedReceipt.status}`}>{selectedReceipt.status}</span> : null}
          </div>

          <div className="warehouse-form-grid">
            <label>Supplier
              <select value={receiptDraft.supplierId ?? ''} disabled={!editable} onChange={(event) => setReceiptDraft({ ...receiptDraft, supplierId: event.target.value || null })}>
                <option value="">No supplier</option>
                {snapshot.suppliers.filter((supplier) => supplier.isActive).map((supplier) => (
                  <option value={supplier.id} key={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            </label>
            <label>Warehouse
              <select value={receiptDraft.warehouseId} disabled={!editable} onChange={(event) => setReceiptDraft({ ...receiptDraft, warehouseId: event.target.value, binId: null })}>
                <option value="">Select warehouse</option>
                {snapshot.warehouses.filter((warehouseRow) => warehouseRow.isActive).map((warehouseRow) => (
                  <option value={warehouseRow.id} key={warehouseRow.id}>{warehouseRow.name}</option>
                ))}
              </select>
            </label>
            <label>Bin
              <select value={receiptDraft.binId ?? ''} disabled={!editable || !receiptDraft.warehouseId} onChange={(event) => setReceiptDraft({ ...receiptDraft, binId: event.target.value || null })}>
                <option value="">No bin</option>
                {binsForWarehouse.map((bin) => (
                  <option value={bin.id} key={bin.id}>{bin.code} - {bin.name}</option>
                ))}
              </select>
            </label>
            <label>Date<input type="date" value={receiptDraft.receiptDate} disabled={!editable} onChange={(event) => setReceiptDraft({ ...receiptDraft, receiptDate: event.target.value })} /></label>
            <label>PO #<input value={receiptDraft.poNumber} disabled={!editable} onChange={(event) => setReceiptDraft({ ...receiptDraft, poNumber: event.target.value })} /></label>
            <label>Invoice #<input value={receiptDraft.invoiceNumber} disabled={!editable} onChange={(event) => setReceiptDraft({ ...receiptDraft, invoiceNumber: event.target.value })} /></label>
            <label>Notes<input value={receiptDraft.notes} disabled={!editable} onChange={(event) => setReceiptDraft({ ...receiptDraft, notes: event.target.value })} /></label>
          </div>

          <div className="warehouse-form-actions">
            {editable ? <button className="secondary-button compact" type="button" onClick={saveReceiptDraft}>Save draft</button> : null}
            {selectedReceipt?.status === 'draft' ? <button className="primary-button" type="button" onClick={() => postReceipt(selectedReceipt)}>Post Receipt</button> : null}
            {selectedReceipt?.status === 'posted' ? <button className="secondary-button compact danger-lite" type="button" onClick={() => cancelReceipt(selectedReceipt)}>Cancel Receipt</button> : null}
          </div>

          {selectedReceipt?.postedAt ? <p className="warehouse-note">Posted {selectedReceipt.postedAt.slice(0, 16).replace('T', ' ')}</p> : null}
          {selectedReceipt?.canceledAt ? <p className="warehouse-note">Canceled {selectedReceipt.canceledAt.slice(0, 16).replace('T', ' ')} - {selectedReceipt.cancelReason}</p> : null}

          <div className="warehouse-receipt-lines">
            <div className="warehouse-panel-heading">
              <h2>Lines</h2>
              <strong>{money(receiptTotal)}</strong>
            </div>
            {editable ? (
              <div className="warehouse-line-editor">
                <select value={receiptLineDraft.itemId} onChange={(event) => setReceiptLineDraft({ ...receiptLineDraft, itemId: event.target.value })}>
                  <option value="">Select item</option>
                  {snapshot.items.filter((item) => item.isActive).map((item) => (
                    <option value={item.id} key={item.id}>{item.internalName} {item.partNumber ? `- ${item.partNumber}` : ''}</option>
                  ))}
                </select>
                <input type="number" min="0" value={receiptLineDraft.quantity} onChange={(event) => setReceiptLineDraft({ ...receiptLineDraft, quantity: Number(event.target.value) || 0 })} aria-label="Quantity" />
                <input type="number" min="0" value={receiptLineDraft.unitCost} onChange={(event) => setReceiptLineDraft({ ...receiptLineDraft, unitCost: Number(event.target.value) || 0 })} aria-label="Vendor unit cost" />
                <input type="number" min="0" value={receiptLineDraft.extraCost} onChange={(event) => setReceiptLineDraft({ ...receiptLineDraft, extraCost: Number(event.target.value) || 0 })} aria-label="Extra cost" />
                <button className="secondary-button compact" type="button" onClick={addReceiptLine}>Add line</button>
              </div>
            ) : null}

            {receiptLines.length ? (
              <div className="warehouse-table-wrap">
                <table className="warehouse-table receipt-lines">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Vendor unit</th>
                      <th>Extra</th>
                      <th>Landed unit</th>
                      <th>Total</th>
                      <th>Avg before</th>
                      <th>Avg after</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {receiptLines.map((line) => {
                      const item = itemById.get(line.itemId);
                      const movement = snapshot.movements.find((row) => row.receiptLineId === line.id && row.movementType === 'receipt');
                      const landedUnitCost = line.quantity > 0 ? line.unitCost + line.extraCost / line.quantity : line.unitCost;
                      return (
                        <tr key={line.id}>
                          <td>{item?.internalName ?? 'Unknown item'}</td>
                          <td>{editable ? <input type="number" min="0" value={line.quantity} onChange={(event) => updateReceiptLine(line, { quantity: Number(event.target.value) || 0 })} /> : formatQty(line.quantity, item?.unit)}</td>
                          <td>{editable ? <input type="number" min="0" value={line.unitCost} onChange={(event) => updateReceiptLine(line, { unitCost: Number(event.target.value) || 0 })} /> : money(line.unitCost)}</td>
                          <td>{editable ? <input type="number" min="0" value={line.extraCost} onChange={(event) => updateReceiptLine(line, { extraCost: Number(event.target.value) || 0 })} /> : money(line.extraCost)}</td>
                          <td>{money(landedUnitCost)}</td>
                          <td>{money(line.quantity * line.unitCost + line.extraCost)}</td>
                          <td>{movement?.averageCostBefore == null ? '-' : money(movement.averageCostBefore)}</td>
                          <td>{movement?.averageCostAfter == null ? '-' : money(movement.averageCostAfter)}</td>
                          <td>{editable ? <button className="secondary-button compact danger-lite" type="button" onClick={() => removeReceiptLine(line)}>Remove</button> : null}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyWarehouseState title="No receipt lines" detail="Add at least one active inventory item before posting." />
            )}
          </div>

          {receiptMovements.length ? (
            <div>
              <div className="warehouse-panel-heading">
                <h2>Posted movements</h2>
              </div>
              {renderMovementTable(receiptMovements)}
            </div>
          ) : null}
        </section>
      </div>
    );
  }

  function renderTransfers() {
    const filteredTransfers = snapshot.transfers.filter((transfer) => transferStatusFilter === 'all' || transfer.status === transferStatusFilter);
    const transferLines = selectedTransfer ? snapshot.transferLines.filter((line) => line.transferId === selectedTransfer.id) : [];
    const transferMovements = selectedTransfer ? snapshot.movements.filter((movement) => movement.transferId === selectedTransfer.id) : [];
    const editable = !selectedTransfer || selectedTransfer.status === 'draft';
    const fromBins = snapshot.bins.filter((bin) => bin.warehouseId === transferDraft.fromWarehouseId && bin.isActive);
    const toBins = snapshot.bins.filter((bin) => bin.warehouseId === transferDraft.toWarehouseId && bin.isActive);

    return (
      <div className="warehouse-receipts-grid">
        <section className="warehouse-panel">
          <div className="warehouse-panel-heading">
            <h2>Transfers</h2>
            <select value={transferStatusFilter} onChange={(event) => setTransferStatusFilter(event.target.value as typeof transferStatusFilter)}>
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="posted">Posted</option>
              <option value="canceled">Canceled</option>
            </select>
          </div>
          <button className="secondary-button compact" type="button" onClick={() => { setSelectedTransferId(''); setTransferDraft(emptyTransferDraft()); setTransferLineDraft(emptyTransferLineDraft()); }}>
            New transfer
          </button>
          {filteredTransfers.length ? (
            <div className="warehouse-receipt-list">
              {filteredTransfers.map((transfer) => {
                const lineCount = snapshot.transferLines.filter((line) => line.transferId === transfer.id).length;
                return (
                  <button className={selectedTransferId === transfer.id ? 'active' : ''} type="button" onClick={() => setSelectedTransferId(transfer.id)} key={transfer.id}>
                    <strong>{transfer.referenceNumber || `Transfer ${transfer.id.slice(0, 8)}`}</strong>
                    <span>{transfer.status} - {transfer.transferDate} - {lineCount} lines</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyWarehouseState title="No transfers yet" detail="Create a draft transfer, add lines, then post it through the database RPC." />
          )}
        </section>

        <section className="warehouse-panel warehouse-receipt-editor">
          <div className="warehouse-panel-heading">
            <h2>{selectedTransfer ? `Transfer ${selectedTransfer.referenceNumber || selectedTransfer.id.slice(0, 8)}` : 'New transfer draft'}</h2>
            {selectedTransfer ? <span className={`warehouse-status ${selectedTransfer.status}`}>{selectedTransfer.status}</span> : null}
          </div>
          <div className="warehouse-form-grid">
            <label>From warehouse
              <select value={transferDraft.fromWarehouseId} disabled={!editable} onChange={(event) => setTransferDraft({ ...transferDraft, fromWarehouseId: event.target.value, fromBinId: null })}>
                <option value="">Select warehouse</option>
                {snapshot.warehouses.filter((warehouseRow) => warehouseRow.isActive).map((warehouseRow) => <option value={warehouseRow.id} key={warehouseRow.id}>{warehouseRow.name}</option>)}
              </select>
            </label>
            <label>From bin
              <select value={transferDraft.fromBinId ?? ''} disabled={!editable || !transferDraft.fromWarehouseId} onChange={(event) => setTransferDraft({ ...transferDraft, fromBinId: event.target.value || null })}>
                <option value="">No bin</option>
                {fromBins.map((bin) => <option value={bin.id} key={bin.id}>{bin.code} - {bin.name}</option>)}
              </select>
            </label>
            <label>To warehouse
              <select value={transferDraft.toWarehouseId} disabled={!editable} onChange={(event) => setTransferDraft({ ...transferDraft, toWarehouseId: event.target.value, toBinId: null })}>
                <option value="">Select warehouse</option>
                {snapshot.warehouses.filter((warehouseRow) => warehouseRow.isActive).map((warehouseRow) => <option value={warehouseRow.id} key={warehouseRow.id}>{warehouseRow.name}</option>)}
              </select>
            </label>
            <label>To bin
              <select value={transferDraft.toBinId ?? ''} disabled={!editable || !transferDraft.toWarehouseId} onChange={(event) => setTransferDraft({ ...transferDraft, toBinId: event.target.value || null })}>
                <option value="">No bin</option>
                {toBins.map((bin) => <option value={bin.id} key={bin.id}>{bin.code} - {bin.name}</option>)}
              </select>
            </label>
            <label>Date<input type="date" value={transferDraft.transferDate} disabled={!editable} onChange={(event) => setTransferDraft({ ...transferDraft, transferDate: event.target.value })} /></label>
            <label>Reference<input value={transferDraft.referenceNumber} disabled={!editable} onChange={(event) => setTransferDraft({ ...transferDraft, referenceNumber: event.target.value })} /></label>
            <label>Notes<input value={transferDraft.notes} disabled={!editable} onChange={(event) => setTransferDraft({ ...transferDraft, notes: event.target.value })} /></label>
          </div>
          <div className="warehouse-form-actions">
            {editable ? <button className="secondary-button compact" type="button" onClick={saveTransferDraft}>Save draft</button> : null}
            {selectedTransfer?.status === 'draft' ? <button className="primary-button" type="button" onClick={() => postTransfer(selectedTransfer)}>Post Transfer</button> : null}
            {selectedTransfer?.status === 'posted' ? <button className="secondary-button compact danger-lite" type="button" onClick={() => cancelTransfer(selectedTransfer)}>Cancel Transfer</button> : null}
          </div>
          <div className="warehouse-receipt-lines">
            <div className="warehouse-panel-heading"><h2>Lines</h2></div>
            {editable ? (
              <div className="warehouse-line-editor simple">
                <select value={transferLineDraft.itemId} onChange={(event) => setTransferLineDraft({ ...transferLineDraft, itemId: event.target.value })}>
                  <option value="">Select item</option>
                  {snapshot.items.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.internalName} {item.partNumber ? `- ${item.partNumber}` : ''}</option>)}
                </select>
                <input type="number" min="0" value={transferLineDraft.quantity} onChange={(event) => setTransferLineDraft({ ...transferLineDraft, quantity: Number(event.target.value) || 0 })} aria-label="Quantity" />
                <button className="secondary-button compact" type="button" onClick={addTransferLine}>Add line</button>
              </div>
            ) : null}
            {transferLines.length ? (
              <div className="warehouse-table-wrap">
                <table className="warehouse-table receipt-lines">
                  <thead><tr><th>Item</th><th>Qty</th><th>Avg cost</th><th /></tr></thead>
                  <tbody>
                    {transferLines.map((line) => {
                      const item = itemById.get(line.itemId);
                      return (
                        <tr key={line.id}>
                          <td>{item?.internalName ?? 'Unknown item'}</td>
                          <td>{editable ? <input type="number" min="0" value={line.quantity} onChange={(event) => updateTransferLine(line, { quantity: Number(event.target.value) || 0 })} /> : formatQty(line.quantity, item?.unit)}</td>
                          <td>{money(item?.averageCost ?? 0)}</td>
                          <td>{editable ? <button className="secondary-button compact danger-lite" type="button" onClick={() => removeTransferLine(line)}>Remove</button> : null}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <EmptyWarehouseState title="No transfer lines" detail="Add at least one item before posting." />}
          </div>
          {transferMovements.length ? <div><div className="warehouse-panel-heading"><h2>Posted movements</h2></div>{renderMovementTable(transferMovements)}</div> : null}
        </section>
      </div>
    );
  }

  function renderAdjustments() {
    const filteredAdjustments = snapshot.adjustments.filter((adjustment) => adjustmentStatusFilter === 'all' || adjustment.status === adjustmentStatusFilter);
    const adjustmentLines = selectedAdjustment ? snapshot.adjustmentLines.filter((line) => line.adjustmentId === selectedAdjustment.id) : [];
    const adjustmentMovements = selectedAdjustment ? snapshot.movements.filter((movement) => movement.adjustmentId === selectedAdjustment.id) : [];
    const editable = !selectedAdjustment || selectedAdjustment.status === 'draft';
    const binsForWarehouse = snapshot.bins.filter((bin) => bin.warehouseId === adjustmentDraft.warehouseId && bin.isActive);

    return (
      <div className="warehouse-receipts-grid">
        <section className="warehouse-panel">
          <div className="warehouse-panel-heading">
            <h2>Adjustments</h2>
            <select value={adjustmentStatusFilter} onChange={(event) => setAdjustmentStatusFilter(event.target.value as typeof adjustmentStatusFilter)}>
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="posted">Posted</option>
              <option value="canceled">Canceled</option>
            </select>
          </div>
          <button className="secondary-button compact" type="button" onClick={() => { setSelectedAdjustmentId(''); setAdjustmentDraft(emptyAdjustmentDraft()); setAdjustmentLineDraft(emptyAdjustmentLineDraft()); }}>
            New adjustment
          </button>
          {filteredAdjustments.length ? (
            <div className="warehouse-receipt-list">
              {filteredAdjustments.map((adjustment) => {
                const lineCount = snapshot.adjustmentLines.filter((line) => line.adjustmentId === adjustment.id).length;
                return (
                  <button className={selectedAdjustmentId === adjustment.id ? 'active' : ''} type="button" onClick={() => setSelectedAdjustmentId(adjustment.id)} key={adjustment.id}>
                    <strong>{adjustment.referenceNumber || `Adjustment ${adjustment.id.slice(0, 8)}`}</strong>
                    <span>{adjustment.status} - {adjustment.reason} - {lineCount} lines</span>
                  </button>
                );
              })}
            </div>
          ) : <EmptyWarehouseState title="No adjustments yet" detail="Create cycle counts, shortages, damage, found stock, or opening balances." />}
        </section>

        <section className="warehouse-panel warehouse-receipt-editor">
          <div className="warehouse-panel-heading">
            <h2>{selectedAdjustment ? `Adjustment ${selectedAdjustment.referenceNumber || selectedAdjustment.id.slice(0, 8)}` : 'New adjustment draft'}</h2>
            {selectedAdjustment ? <span className={`warehouse-status ${selectedAdjustment.status}`}>{selectedAdjustment.status}</span> : null}
          </div>
          <div className="warehouse-form-grid">
            <label>Warehouse
              <select value={adjustmentDraft.warehouseId} disabled={!editable} onChange={(event) => setAdjustmentDraft({ ...adjustmentDraft, warehouseId: event.target.value, binId: null })}>
                <option value="">Select warehouse</option>
                {snapshot.warehouses.filter((warehouseRow) => warehouseRow.isActive).map((warehouseRow) => <option value={warehouseRow.id} key={warehouseRow.id}>{warehouseRow.name}</option>)}
              </select>
            </label>
            <label>Bin
              <select value={adjustmentDraft.binId ?? ''} disabled={!editable || !adjustmentDraft.warehouseId} onChange={(event) => setAdjustmentDraft({ ...adjustmentDraft, binId: event.target.value || null })}>
                <option value="">No bin</option>
                {binsForWarehouse.map((bin) => <option value={bin.id} key={bin.id}>{bin.code} - {bin.name}</option>)}
              </select>
            </label>
            <label>Reason
              <select value={adjustmentDraft.reason} disabled={!editable} onChange={(event) => setAdjustmentDraft({ ...adjustmentDraft, reason: event.target.value as InventoryAdjustmentDraft['reason'] })}>
                <option value="initial">Initial balance</option>
                <option value="count">Cycle count</option>
                <option value="shortage">Shortage</option>
                <option value="damage">Damage</option>
                <option value="found">Found material</option>
                <option value="correction">Correction</option>
              </select>
            </label>
            <label>Date<input type="date" value={adjustmentDraft.adjustmentDate} disabled={!editable} onChange={(event) => setAdjustmentDraft({ ...adjustmentDraft, adjustmentDate: event.target.value })} /></label>
            <label>Reference<input value={adjustmentDraft.referenceNumber} disabled={!editable} onChange={(event) => setAdjustmentDraft({ ...adjustmentDraft, referenceNumber: event.target.value })} /></label>
            <label>Notes<input value={adjustmentDraft.notes} disabled={!editable} onChange={(event) => setAdjustmentDraft({ ...adjustmentDraft, notes: event.target.value })} /></label>
          </div>
          <div className="warehouse-form-actions">
            {editable ? <button className="secondary-button compact" type="button" onClick={saveAdjustmentDraft}>Save draft</button> : null}
            {selectedAdjustment?.status === 'draft' ? <button className="primary-button" type="button" onClick={() => postAdjustment(selectedAdjustment)}>Post Adjustment</button> : null}
            {selectedAdjustment?.status === 'posted' ? <button className="secondary-button compact danger-lite" type="button" onClick={() => cancelAdjustment(selectedAdjustment)}>Cancel Adjustment</button> : null}
          </div>
          <div className="warehouse-receipt-lines">
            <div className="warehouse-panel-heading"><h2>Lines</h2></div>
            {editable ? (
              <div className="warehouse-line-editor adjustment">
                <select value={adjustmentLineDraft.itemId} onChange={(event) => setAdjustmentLineDraft({ ...adjustmentLineDraft, itemId: event.target.value })}>
                  <option value="">Select item</option>
                  {snapshot.items.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.internalName} {item.partNumber ? `- ${item.partNumber}` : ''}</option>)}
                </select>
                <input type="number" value={adjustmentLineDraft.quantityDelta} onChange={(event) => setAdjustmentLineDraft({ ...adjustmentLineDraft, quantityDelta: Number(event.target.value) || 0 })} aria-label="Quantity delta" />
                <input type="number" min="0" value={adjustmentLineDraft.unitCost} onChange={(event) => setAdjustmentLineDraft({ ...adjustmentLineDraft, unitCost: Number(event.target.value) || 0 })} aria-label="Unit cost" />
                <button className="secondary-button compact" type="button" onClick={addAdjustmentLine}>Add line</button>
              </div>
            ) : null}
            {adjustmentLines.length ? (
              <div className="warehouse-table-wrap">
                <table className="warehouse-table receipt-lines">
                  <thead><tr><th>Item</th><th>Delta</th><th>Unit cost</th><th>Avg after</th><th /></tr></thead>
                  <tbody>
                    {adjustmentLines.map((line) => {
                      const item = itemById.get(line.itemId);
                      const movement = snapshot.movements.find((row) => row.adjustmentLineId === line.id && row.referenceNumber !== '');
                      return (
                        <tr key={line.id}>
                          <td>{item?.internalName ?? 'Unknown item'}</td>
                          <td>{editable ? <input type="number" value={line.quantityDelta} onChange={(event) => updateAdjustmentLine(line, { quantityDelta: Number(event.target.value) || 0 })} /> : formatQty(line.quantityDelta, item?.unit)}</td>
                          <td>{editable ? <input type="number" min="0" value={line.unitCost} onChange={(event) => updateAdjustmentLine(line, { unitCost: Number(event.target.value) || 0 })} /> : money(line.unitCost)}</td>
                          <td>{movement?.averageCostAfter == null ? '-' : money(movement.averageCostAfter)}</td>
                          <td>{editable ? <button className="secondary-button compact danger-lite" type="button" onClick={() => removeAdjustmentLine(line)}>Remove</button> : null}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <EmptyWarehouseState title="No adjustment lines" detail="Add at least one item delta before posting." />}
          </div>
          {adjustmentMovements.length ? <div><div className="warehouse-panel-heading"><h2>Posted movements</h2></div>{renderMovementTable(adjustmentMovements)}</div> : null}
        </section>
      </div>
    );
  }

  function renderSettings() {
    return (
      <div className="warehouse-settings-grid">
        <section className="warehouse-panel">
          <div className="warehouse-panel-heading">
            <h2>Data model</h2>
            <Settings size={18} aria-hidden="true" />
          </div>
          <div className="warehouse-settings-list">
            <span>Warehouses and technician vehicles</span>
            <span>Storage bins per warehouse</span>
            <span>Inventory material catalog</span>
            <span>Supplier catalog and supplier prices</span>
            <span>Stock balances per item, warehouse, and bin</span>
            <span>Append-only movement history</span>
          </div>
        </section>
        <section className="warehouse-panel">
          <div className="warehouse-panel-heading">
            <h2>Integration boundary</h2>
            <Package size={18} aria-hidden="true" />
          </div>
          <p className="warehouse-note">
            Existing Job Materials remain manual entries. Warehouse-issued Job costs will use source_type=warehouse and an inventory_movement_id in a later stage.
          </p>
        </section>
      </div>
    );
  }

  function renderActiveForm() {
    if (formMode === 'warehouse') {
      return (
        <section className="warehouse-form-panel">
          <h2>Add warehouse</h2>
          <div className="warehouse-form-grid">
            <label>Name<input value={warehouseDraft.name} onChange={(event) => setWarehouseDraft({ ...warehouseDraft, name: event.target.value })} /></label>
            <label>Type
              <select value={warehouseDraft.type} onChange={(event) => setWarehouseDraft({ ...warehouseDraft, type: event.target.value as InventoryWarehouseDraft['type'] })}>
                <option value="main">Main</option>
                <option value="office">Office</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>Location<input value={warehouseDraft.location} onChange={(event) => setWarehouseDraft({ ...warehouseDraft, location: event.target.value })} /></label>
            <label>Notes<input value={warehouseDraft.notes} onChange={(event) => setWarehouseDraft({ ...warehouseDraft, notes: event.target.value })} /></label>
          </div>
          <div className="warehouse-form-actions">
            <button className="secondary-button compact" type="button" onClick={() => setFormMode('none')}>Cancel</button>
            <button className="primary-button" type="button" onClick={saveWarehouseDraft}>Save warehouse</button>
          </div>
        </section>
      );
    }

    if (formMode === 'item') {
      return (
        <section className="warehouse-form-panel">
          <h2>Add inventory item</h2>
          <div className="warehouse-form-grid wide">
            <label>Name<input value={itemDraft.internalName} onChange={(event) => setItemDraft({ ...itemDraft, internalName: event.target.value })} /></label>
            <label>Category<input value={itemDraft.category} onChange={(event) => setItemDraft({ ...itemDraft, category: event.target.value })} /></label>
            <label>Manufacturer<input value={itemDraft.manufacturer} onChange={(event) => setItemDraft({ ...itemDraft, manufacturer: event.target.value })} /></label>
            <label>OEM<input value={itemDraft.oem} onChange={(event) => setItemDraft({ ...itemDraft, oem: event.target.value })} /></label>
            <label>Part #<input value={itemDraft.partNumber} onChange={(event) => setItemDraft({ ...itemDraft, partNumber: event.target.value })} /></label>
            <label>Alt part #<input value={itemDraft.alternatePartNumber} onChange={(event) => setItemDraft({ ...itemDraft, alternatePartNumber: event.target.value })} /></label>
            <label>Unit<input value={itemDraft.unit} onChange={(event) => setItemDraft({ ...itemDraft, unit: event.target.value })} /></label>
            <label>Minimum qty<input type="number" min="0" value={itemDraft.minimumQuantity} onChange={(event) => setItemDraft({ ...itemDraft, minimumQuantity: Number(event.target.value) || 0 })} /></label>
            <label>Description<input value={itemDraft.description} onChange={(event) => setItemDraft({ ...itemDraft, description: event.target.value })} /></label>
            <label>Notes<input value={itemDraft.notes} onChange={(event) => setItemDraft({ ...itemDraft, notes: event.target.value })} /></label>
          </div>
          <div className="warehouse-form-actions">
            <button className="secondary-button compact" type="button" onClick={() => setFormMode('none')}>Cancel</button>
            <button className="primary-button" type="button" onClick={saveItemDraft}>Save item</button>
          </div>
        </section>
      );
    }

    if (formMode === 'supplier') {
      return (
        <section className="warehouse-form-panel">
          <h2>Add supplier</h2>
          <div className="warehouse-form-grid">
            <label>Name<input value={supplierDraft.name} onChange={(event) => setSupplierDraft({ ...supplierDraft, name: event.target.value })} /></label>
            <label>Contact<input value={supplierDraft.contactName} onChange={(event) => setSupplierDraft({ ...supplierDraft, contactName: event.target.value })} /></label>
            <label>Phone<input value={supplierDraft.phone} onChange={(event) => setSupplierDraft({ ...supplierDraft, phone: event.target.value })} /></label>
            <label>Email<input value={supplierDraft.email} onChange={(event) => setSupplierDraft({ ...supplierDraft, email: event.target.value })} /></label>
            <label>Website<input value={supplierDraft.website} onChange={(event) => setSupplierDraft({ ...supplierDraft, website: event.target.value })} /></label>
            <label>Address<input value={supplierDraft.address} onChange={(event) => setSupplierDraft({ ...supplierDraft, address: event.target.value })} /></label>
          </div>
          <div className="warehouse-form-actions">
            <button className="secondary-button compact" type="button" onClick={() => setFormMode('none')}>Cancel</button>
            <button className="primary-button" type="button" onClick={saveSupplierDraft}>Save supplier</button>
          </div>
        </section>
      );
    }

    return null;
  }

  return (
    <section className="warehouse-page">
      <div className="warehouse-header">
        <div>
          <p className="eyebrow">Inventory control</p>
          <h1>Warehouse</h1>
          {status ? <p className="access-status">{status}</p> : null}
        </div>
        <div className="warehouse-header-actions">
          <button className="secondary-button compact" type="button" onClick={() => setFormMode('supplier')}>
            <Truck size={16} aria-hidden="true" />
            Add supplier
          </button>
          <button className="secondary-button compact" type="button" onClick={() => setFormMode('warehouse')}>
            <Truck size={16} aria-hidden="true" />
            Add warehouse
          </button>
          <button className="primary-button" type="button" onClick={() => setFormMode('item')}>
            <Boxes size={16} aria-hidden="true" />
            Add item
          </button>
        </div>
      </div>

      <div className="warehouse-tabs">
        {tabs.map((tab) => (
          <button className={activeTab === tab.key ? 'active' : ''} type="button" onClick={() => setActiveTab(tab.key)} key={tab.key}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="warehouse-toolbar">
        <label>
          Search
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, OEM, part #, manufacturer" />
        </label>
        <label>
          Warehouse
          <select value={warehouseFilter} onChange={(event) => setWarehouseFilter(event.target.value)}>
            <option value="all">All warehouses</option>
            {snapshot.warehouses.map((warehouseRow) => (
              <option value={warehouseRow.id} key={warehouseRow.id}>{warehouseRow.name}</option>
            ))}
          </select>
        </label>
        <span className="warehouse-load-state">{loading ? 'Loading warehouse...' : `${summary.items} items loaded`}</span>
      </div>

      {renderActiveForm()}

      {activeTab === 'dashboard' ? renderDashboard() : null}
      {activeTab === 'materials' ? renderMaterialsTable(filteredItems) : null}
      {activeTab === 'stock' ? renderStockTable(false) : null}
      {activeTab === 'receipts' ? renderReceipts() : null}
      {activeTab === 'transfers' ? renderTransfers() : null}
      {activeTab === 'adjustments' ? renderAdjustments() : null}
      {activeTab === 'lowStock' ? (
        lowStockItems.length ? renderMaterialsTable(lowStockItems) : (
          <EmptyWarehouseState title="No low-stock materials" detail="Items will appear here when total quantity is at or below the minimum quantity." />
        )
      ) : null}
      {activeTab === 'suppliers' ? renderSuppliers() : null}
      {activeTab === 'history' ? renderMovementTable() : null}
      {activeTab === 'settings' ? renderSettings() : null}

      <div className="warehouse-warning">
        <AlertTriangle size={17} aria-hidden="true" />
        <span>Receipts, transfers, and adjustments post through PostgreSQL RPC with locks. Job issues are reserved for Stage 4.</span>
      </div>
    </section>
  );
}
