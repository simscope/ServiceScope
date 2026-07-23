import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, History, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react';
import { money } from '../../utils/format';
import {
  cancelInventoryStockAdjustment,
  listWarehouseAdjustmentSnapshot,
  postInventoryStockAdjustment,
  warehouseAdjustmentErrorMessage,
  type InventoryAdjustmentDraft,
  type InventoryAdjustmentReason,
  type WarehouseAdjustmentSnapshot,
} from '../../services/warehouseAdjustmentStore';
import { WarehousePage } from './WarehousePage';

const emptySnapshot: WarehouseAdjustmentSnapshot = {
  items: [],
  warehouses: [],
  bins: [],
  balances: [],
  documents: [],
  lines: [],
};

const reasonLabels: Record<InventoryAdjustmentReason, string> = {
  initial: 'Initial inventory',
  count: 'Physical count',
  shortage: 'Shortage / missing',
  damage: 'Damaged material',
  found: 'Found material',
  correction: 'Data correction',
};

function newDraft(): InventoryAdjustmentDraft {
  return {
    idempotencyKey: crypto.randomUUID(),
    itemId: '',
    warehouseId: '',
    binId: null,
    countedQuantity: 0,
    reason: 'count',
    unitCost: 0,
    referenceNumber: '',
    notes: '',
  };
}

function formatQuantity(value: number, unit = '') {
  const clean = Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return unit ? `${clean} ${unit}` : clean;
}

type WarehouseAdjustmentsPageProps = {
  companyId: string;
  onMaterialsChanged?: () => Promise<void> | void;
};

export function WarehouseAdjustmentsPage({ companyId, onMaterialsChanged }: WarehouseAdjustmentsPageProps) {
  const [snapshot, setSnapshot] = useState<WarehouseAdjustmentSnapshot>(emptySnapshot);
  const [draft, setDraft] = useState<InventoryAdjustmentDraft>(() => newDraft());
  const [partSearch, setPartSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [status, setStatus] = useState('');
  const [warehouseRefreshKey, setWarehouseRefreshKey] = useState(0);

  async function reloadAdjustments() {
    const next = await listWarehouseAdjustmentSnapshot(companyId);
    setSnapshot(next);
    return next;
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listWarehouseAdjustmentSnapshot(companyId)
      .then((next) => {
        if (!cancelled) setSnapshot(next);
      })
      .catch((error) => {
        if (!cancelled) setStatus(warehouseAdjustmentErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const itemById = useMemo(() => new Map(snapshot.items.map((item) => [item.id, item])), [snapshot.items]);
  const warehouseById = useMemo(() => new Map(snapshot.warehouses.map((warehouse) => [warehouse.id, warehouse])), [snapshot.warehouses]);
  const lineByAdjustmentId = useMemo(() => new Map(snapshot.lines.map((line) => [line.adjustmentId, line])), [snapshot.lines]);
  const filteredItems = useMemo(() => {
    const query = partSearch.trim().toLowerCase();
    if (!query) return snapshot.items;
    return snapshot.items.filter((item) => `${item.name} ${item.partNumber}`.toLowerCase().includes(query));
  }, [partSearch, snapshot.items]);

  const selectedItem = draft.itemId ? itemById.get(draft.itemId) : undefined;
  const binsForWarehouse = snapshot.bins.filter((bin) => bin.warehouseId === draft.warehouseId);
  const systemQuantity = snapshot.balances.find((balance) =>
    balance.itemId === draft.itemId &&
    balance.warehouseId === draft.warehouseId &&
    balance.binId === (draft.binId || null)
  )?.quantity ?? 0;
  const quantityDelta = Number((draft.countedQuantity - systemQuantity).toFixed(4));

  function quantityAt(itemId: string, warehouseId: string, binId: string | null | undefined) {
    return snapshot.balances.find((balance) =>
      balance.itemId === itemId &&
      balance.warehouseId === warehouseId &&
      balance.binId === (binId || null)
    )?.quantity ?? 0;
  }

  function openAdjustmentForm() {
    setDraft({
      ...newDraft(),
      warehouseId: snapshot.warehouses[0]?.id || '',
    });
    setPartSearch('');
    setStatus('Select the part you counted.');
    setFormOpen(true);
  }

  function selectItem(itemId: string) {
    const item = itemById.get(itemId);
    const currentBalance = snapshot.balances.find((balance) =>
      balance.itemId === itemId &&
      balance.warehouseId === draft.warehouseId &&
      balance.binId === (draft.binId || null)
    );
    const preferredBalance = currentBalance
      ?? snapshot.balances.find((balance) => balance.itemId === itemId && balance.quantity > 0)
      ?? snapshot.balances.find((balance) => balance.itemId === itemId);
    const warehouseId = preferredBalance?.warehouseId || draft.warehouseId || snapshot.warehouses[0]?.id || '';
    const binId = preferredBalance?.warehouseId === warehouseId ? preferredBalance.binId : null;

    setDraft((current) => ({
      ...current,
      itemId,
      warehouseId,
      binId,
      countedQuantity: quantityAt(itemId, warehouseId, binId),
      unitCost: item?.averageCost ?? 0,
    }));
    setPartSearch('');
    setStatus('');
  }

  function selectWarehouse(warehouseId: string) {
    setDraft((current) => ({
      ...current,
      warehouseId,
      binId: null,
      countedQuantity: quantityAt(current.itemId, warehouseId, null),
    }));
  }

  function selectBin(binId: string) {
    setDraft((current) => ({
      ...current,
      binId: binId || null,
      countedQuantity: quantityAt(current.itemId, current.warehouseId, binId || null),
    }));
  }

  async function postAdjustment() {
    if (posting) return;
    if (!draft.itemId) {
      setStatus('Select a part.');
      return;
    }
    if (!draft.warehouseId) {
      setStatus('Select a warehouse location.');
      return;
    }
    if (draft.countedQuantity < 0) {
      setStatus('Counted quantity cannot be negative.');
      return;
    }
    if (quantityDelta === 0) {
      setStatus('Counted quantity already matches the system quantity.');
      return;
    }
    if (quantityDelta > 0 && draft.unitCost < 0) {
      setStatus('Unit cost cannot be negative.');
      return;
    }
    if (quantityDelta > 0 && draft.unitCost === 0) {
      const confirmedZeroCost = window.confirm('This adjustment adds stock at zero cost. Continue only for opening inventory, warranty replacement, donated stock, or a verified correction.');
      if (!confirmedZeroCost) return;
    }

    const location = warehouseById.get(draft.warehouseId)?.name ?? 'warehouse';
    const confirmed = window.confirm(
      `Post stock adjustment for ${selectedItem?.name ?? 'part'} at ${location}?\n\nSystem: ${formatQuantity(systemQuantity, selectedItem?.unit)}\nCounted: ${formatQuantity(draft.countedQuantity, selectedItem?.unit)}\nChange: ${quantityDelta > 0 ? '+' : ''}${formatQuantity(quantityDelta, selectedItem?.unit)}`,
    );
    if (!confirmed) return;

    setPosting(true);
    setStatus('Posting stock adjustment...');
    try {
      const result = await postInventoryStockAdjustment(companyId, draft);
      await reloadAdjustments();
      setWarehouseRefreshKey((key) => key + 1);
      setFormOpen(false);
      setDraft(newDraft());
      setPartSearch('');
      setStatus(result.idempotent_replay ? 'The original adjustment result was returned safely.' : 'Stock adjustment posted. Balance, total quantity, average cost, and movement history were updated.');
    } catch (error) {
      setStatus(warehouseAdjustmentErrorMessage(error));
    } finally {
      setPosting(false);
    }
  }

  async function reverseAdjustment(adjustmentId: string) {
    const reason = window.prompt('Why are you reversing this adjustment?');
    if (reason === null) return;
    if (!reason.trim()) {
      setStatus('Enter a reversal reason.');
      return;
    }
    const confirmed = window.confirm('Reverse this adjustment? This is allowed only when the part has no newer warehouse activity.');
    if (!confirmed) return;

    setStatus('Reversing stock adjustment...');
    try {
      await cancelInventoryStockAdjustment(adjustmentId, reason);
      await reloadAdjustments();
      setWarehouseRefreshKey((key) => key + 1);
      setStatus('Adjustment reversed and the prior balance and average cost were restored.');
    } catch (error) {
      setStatus(warehouseAdjustmentErrorMessage(error));
    }
  }

  return (
    <div className="warehouse-adjustment-enabled">
      <section className="warehouse-adjustment-control">
        <div className="warehouse-adjustment-control-copy">
          <SlidersHorizontal size={18} aria-hidden="true" />
          <div>
            <strong>Stock count and corrections</strong>
            <span>Enter the actual quantity. ServiceScope posts the difference through a locked PostgreSQL transaction.</span>
          </div>
        </div>
        <div className="warehouse-adjustment-control-actions">
          {snapshot.documents.length ? (
            <button className="secondary-button compact" type="button" onClick={() => setHistoryOpen((open) => !open)}>
              <History size={15} aria-hidden="true" /> History
            </button>
          ) : null}
          <button className="primary-button compact" type="button" disabled={loading || !snapshot.items.length || !snapshot.warehouses.length} onClick={openAdjustmentForm}>
            <ClipboardCheck size={15} aria-hidden="true" /> Adjust stock
          </button>
        </div>
      </section>

      {status ? <p className="access-status warehouse-adjustment-status">{status}</p> : null}

      {formOpen ? (
        <section className="warehouse-adjustment-form">
          <div className="warehouse-panel-heading">
            <div>
              <p className="eyebrow">Physical count</p>
              <h2>Adjust stock</h2>
            </div>
            <button className="secondary-button compact icon-button" type="button" title="Close" onClick={() => setFormOpen(false)}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="warehouse-adjustment-part-picker">
            <label className="warehouse-adjustment-part-search">
              <span>Find part</span>
              <span className="warehouse-adjustment-search-input">
                <Search size={15} aria-hidden="true" />
                <input value={partSearch} onChange={(event) => setPartSearch(event.target.value)} placeholder="Search by name or part number" autoFocus />
              </span>
            </label>
            <div className="warehouse-adjustment-part-list" role="listbox" aria-label="Inventory parts">
              {filteredItems.length ? filteredItems.map((item) => (
                <button
                  className={draft.itemId === item.id ? 'active' : ''}
                  type="button"
                  role="option"
                  aria-selected={draft.itemId === item.id}
                  onClick={() => selectItem(item.id)}
                  key={item.id}
                >
                  <strong>{item.name}</strong>
                  <small>{item.partNumber || 'No part number'} · {formatQuantity(snapshot.balances.filter((balance) => balance.itemId === item.id).reduce((sum, balance) => sum + balance.quantity, 0), item.unit)}</small>
                </button>
              )) : <span className="warehouse-adjustment-no-parts">No matching parts.</span>}
            </div>
          </div>

          <div className="warehouse-adjustment-grid">
            <label>Selected part
              <input disabled value={selectedItem ? `${selectedItem.name}${selectedItem.partNumber ? ` - ${selectedItem.partNumber}` : ''}` : 'Select a part above'} />
            </label>
            <label>Location
              <select value={draft.warehouseId} disabled={!draft.itemId} onChange={(event) => selectWarehouse(event.target.value)}>
                <option value="">Select location</option>
                {snapshot.warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.name}</option>)}
              </select>
            </label>
            <label>Exact bin
              <select value={draft.binId ?? ''} disabled={!draft.itemId || !draft.warehouseId} onChange={(event) => selectBin(event.target.value)}>
                <option value="">No exact bin</option>
                {binsForWarehouse.map((bin) => <option value={bin.id} key={bin.id}>{bin.code} - {bin.name}</option>)}
              </select>
            </label>
            <label>Reason
              <select value={draft.reason} disabled={!draft.itemId} onChange={(event) => setDraft({ ...draft, reason: event.target.value as InventoryAdjustmentReason })}>
                {(Object.keys(reasonLabels) as InventoryAdjustmentReason[]).map((reason) => <option value={reason} key={reason}>{reasonLabels[reason]}</option>)}
              </select>
            </label>
            <label>System quantity<input disabled value={selectedItem ? formatQuantity(systemQuantity, selectedItem.unit) : '-'} /></label>
            <label>Actual counted quantity
              <input type="number" min="0" step="0.0001" disabled={!draft.itemId} value={draft.countedQuantity} onChange={(event) => setDraft({ ...draft, countedQuantity: Math.max(0, Number(event.target.value) || 0) })} />
            </label>
            <label>Difference
              <input className={quantityDelta > 0 ? 'positive' : quantityDelta < 0 ? 'negative' : ''} disabled value={selectedItem ? `${quantityDelta > 0 ? '+' : ''}${formatQuantity(quantityDelta, selectedItem.unit)}` : '-'} />
            </label>
            <label>Cost for added quantity
              <input type="number" min="0" step="0.01" disabled={!draft.itemId || quantityDelta <= 0} value={draft.unitCost} onChange={(event) => setDraft({ ...draft, unitCost: Math.max(0, Number(event.target.value) || 0) })} />
            </label>
            <label>Reference<input disabled={!draft.itemId} value={draft.referenceNumber ?? ''} onChange={(event) => setDraft({ ...draft, referenceNumber: event.target.value })} placeholder="Count sheet, ticket, or note #" /></label>
            <label className="wide">Notes<input disabled={!draft.itemId} value={draft.notes ?? ''} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="What was counted, damaged, missing, or corrected?" /></label>
          </div>

          <div className="warehouse-adjustment-summary">
            <span>Current average cost <strong>{selectedItem ? money(selectedItem.averageCost) : '-'}</strong></span>
            <span>Adjustment value <strong>{selectedItem ? money(Math.abs(quantityDelta) * (quantityDelta > 0 ? draft.unitCost : selectedItem.averageCost)) : '-'}</strong></span>
          </div>
          <div className="warehouse-form-actions sticky">
            <button className="secondary-button compact" type="button" onClick={() => setFormOpen(false)}>Cancel</button>
            <button className="primary-button" type="button" disabled={posting || !draft.itemId || !draft.warehouseId || quantityDelta === 0} onClick={postAdjustment}>{posting ? 'Posting...' : 'Post adjustment'}</button>
          </div>
        </section>
      ) : null}

      {historyOpen ? (
        <section className="warehouse-adjustment-history">
          <div className="warehouse-panel-heading">
            <h2>Recent adjustments</h2>
            <span>{snapshot.documents.length}</span>
          </div>
          <div className="warehouse-adjustment-history-list">
            {snapshot.documents.slice(0, 20).map((document) => {
              const line = lineByAdjustmentId.get(document.id);
              const item = line ? itemById.get(line.itemId) : undefined;
              const warehouse = warehouseById.get(document.warehouseId);
              return (
                <div className={`warehouse-adjustment-history-row ${document.status}`} key={document.id}>
                  <span><strong>{item?.name ?? 'Unknown part'}</strong><small>{warehouse?.name ?? 'Unknown location'} - {reasonLabels[document.reason]}</small></span>
                  <span><strong>{line ? `${formatQuantity(line.systemQuantity, item?.unit)} -> ${formatQuantity(line.countedQuantity, item?.unit)}` : '-'}</strong><small>{line ? `${line.quantityDelta > 0 ? '+' : ''}${formatQuantity(line.quantityDelta, item?.unit)}` : ''}</small></span>
                  <span><strong>{document.status}</strong><small>{new Date(document.createdAt).toLocaleString()}</small></span>
                  {document.status === 'posted' ? (
                    <button className="secondary-button compact danger-lite" type="button" onClick={() => reverseAdjustment(document.id)}><RotateCcw size={14} aria-hidden="true" /> Reverse</button>
                  ) : <span className="warehouse-adjustment-cancel-note">{document.cancelReason || document.notes || '-'}</span>}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <WarehousePage key={warehouseRefreshKey} companyId={companyId} onMaterialsChanged={onMaterialsChanged} />
    </div>
  );
}
