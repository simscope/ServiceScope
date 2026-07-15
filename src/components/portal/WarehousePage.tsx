import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Boxes, History, MapPin, Package, Settings, Truck, Warehouse } from 'lucide-react';
import {
  createInventoryItem,
  createInventorySupplier,
  createInventoryWarehouse,
  listWarehouseSnapshot,
  type InventoryItem,
  type InventoryItemDraft,
  type InventorySupplierDraft,
  type InventoryWarehouseDraft,
  type WarehouseSnapshot,
} from '../../services/warehouseStore';
import { money } from '../../utils/format';

type WarehouseTab = 'dashboard' | 'materials' | 'stock' | 'receipts' | 'transfers' | 'lowStock' | 'suppliers' | 'history' | 'settings';

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

const tabs: Array<{ key: WarehouseTab; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'materials', label: 'Materials' },
  { key: 'stock', label: 'Stock' },
  { key: 'receipts', label: 'Receipts' },
  { key: 'transfers', label: 'Transfers' },
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

  function renderDocumentPlaceholder(kind: 'receipts' | 'transfers') {
    return (
      <EmptyWarehouseState
        title={kind === 'receipts' ? 'Receipts are ready for stage 2' : 'Transfers are ready for stage 3'}
        detail={kind === 'receipts'
          ? 'Stage 1 creates receipt tables. Posting logic and weighted average cost RPC will be added next.'
          : 'Transfer documents will move stock between warehouses without changing company average cost.'}
      />
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
      {activeTab === 'receipts' ? renderDocumentPlaceholder('receipts') : null}
      {activeTab === 'transfers' ? renderDocumentPlaceholder('transfers') : null}
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
        <span>Stage 1 is database-backed setup and read UI. Posting receipts, transfers, and Job issues must be handled by database RPC in the next stages to prevent negative stock and double posting.</span>
      </div>
    </section>
  );
}
