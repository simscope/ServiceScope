import { useMemo, useState } from 'react';
import { Plus, PackageCheck } from 'lucide-react';
import type { CompanyOnboardingProfile, MaterialRow, ServiceJob } from '../../types';
import type { MaterialJobStatusFilter } from '../../features/materials/useMaterialsFeature';
import {
  issueInventoryPartToJob,
  listWarehouseSnapshot,
  warehouseErrorMessage,
  type InventoryItem,
  type InventoryStockBalance,
  type InventoryWarehouse,
  type WarehouseSnapshot,
} from '../../services/warehouseStore';
import { money, statusClassName } from '../../utils/format';

type MaterialRowWithJob = {
  material: MaterialRow;
  job: ServiceJob;
};

export function MaterialsPage({
  companyId,
  materials,
  jobsWithoutMaterials,
  materialsTotal,
  materialStatusFilter,
  materialJobStatusFilter,
  onMaterialJobStatusFilterChange,
  onMaterialStatusFilterChange,
  materialStatuses,
  materialTechFilter,
  onMaterialTechFilterChange,
  profile,
  materialSearch,
  onMaterialSearchChange,
  onResetFilters,
  onOpenMaterialEditor,
  onOpenJob,
  filteredMaterialRows,
  selectedMaterialsJob,
  onCloseMaterialEditor,
  materialDraftRows,
  onUpdateMaterialDraft,
  onRemoveMaterialDraftRow,
  onAddMaterialDraftRow,
  onSaveMaterialDraftRows,
  onSaveMaterials,
  onWarehouseStockIssued,
}: {
  companyId: string;
  materials: MaterialRow[];
  jobsWithoutMaterials: ServiceJob[];
  materialsTotal: number;
  materialStatusFilter: 'all' | MaterialRow['status'];
  materialJobStatusFilter: MaterialJobStatusFilter;
  onMaterialJobStatusFilterChange: (value: MaterialJobStatusFilter) => void;
  onMaterialStatusFilterChange: (value: 'all' | MaterialRow['status']) => void;
  materialStatuses: MaterialRow['status'][];
  materialTechFilter: string;
  onMaterialTechFilterChange: (value: string) => void;
  profile: CompanyOnboardingProfile;
  materialSearch: string;
  onMaterialSearchChange: (value: string) => void;
  onResetFilters: () => void;
  onOpenMaterialEditor: (jobNumber: string) => void;
  onOpenJob: (job: ServiceJob) => void;
  filteredMaterialRows: MaterialRowWithJob[];
  selectedMaterialsJob?: ServiceJob;
  onCloseMaterialEditor: () => void;
  materialDraftRows: MaterialRow[];
  onUpdateMaterialDraft: (rowId: string, patch: Partial<MaterialRow>) => void;
  onRemoveMaterialDraftRow: (rowId: string) => void;
  onAddMaterialDraftRow: () => void;
  onSaveMaterialDraftRows: () => void;
  onSaveMaterials: (jobNumber: string, rows: MaterialRow[]) => Promise<void> | void;
  onWarehouseStockIssued: () => Promise<void> | void;
}) {
  const [statusOverrides, setStatusOverrides] = useState<Record<string, MaterialRow['status']>>({});
  const [savingStatusId, setSavingStatusId] = useState('');
  const [inlineStatusMessage, setInlineStatusMessage] = useState('');
  const [stockPickerOpen, setStockPickerOpen] = useState(false);
  const [stockSnapshot, setStockSnapshot] = useState<WarehouseSnapshot | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockPosting, setStockPosting] = useState(false);
  const [stockSearch, setStockSearch] = useState('');
  const [stockDraft, setStockDraft] = useState({ itemId: '', warehouseId: '', binId: '', quantity: 1 });

  const stockItems = useMemo(() => {
    if (!stockSnapshot) return [];
    const itemById = new Map(stockSnapshot.items.map((item) => [item.id, item]));
    const warehouseById = new Map(stockSnapshot.warehouses.map((warehouse) => [warehouse.id, warehouse]));
    const query = stockSearch.trim().toLowerCase();

    return stockSnapshot.stockBalances
      .filter((balance) => balance.quantity > 0)
      .map((balance) => ({
        balance,
        item: itemById.get(balance.itemId),
        warehouse: warehouseById.get(balance.warehouseId),
      }))
      .filter((row): row is { balance: InventoryStockBalance; item: InventoryItem; warehouse: InventoryWarehouse } => Boolean(row.item && row.warehouse))
      .filter(({ item, warehouse }) => {
        const haystack = [item.internalName, item.partNumber, item.oem, item.manufacturer, item.description, warehouse.name].join(' ').toLowerCase();
        return !query || haystack.includes(query);
      })
      .sort((a, b) => a.item.internalName.localeCompare(b.item.internalName) || a.warehouse.name.localeCompare(b.warehouse.name));
  }, [stockSearch, stockSnapshot]);

  async function openStockPicker() {
    setStockPickerOpen(true);
    if (stockSnapshot || stockLoading) return;
    setStockLoading(true);
    setInlineStatusMessage('Loading stock...');
    try {
      const snapshot = await listWarehouseSnapshot(companyId);
      setStockSnapshot(snapshot);
      setInlineStatusMessage('');
    } catch (error) {
      setInlineStatusMessage(warehouseErrorMessage(error));
    } finally {
      setStockLoading(false);
    }
  }

  function selectStockRow(balance: InventoryStockBalance) {
    setStockDraft({
      itemId: balance.itemId,
      warehouseId: balance.warehouseId,
      binId: balance.binId ?? '',
      quantity: Math.min(1, balance.quantity),
    });
  }

  async function useSelectedStockOnJob() {
    if (!selectedMaterialsJob) return;
    if (!stockDraft.itemId || !stockDraft.warehouseId) {
      setInlineStatusMessage('Select a stock item.');
      return;
    }
    if ((Number(stockDraft.quantity) || 0) <= 0) {
      setInlineStatusMessage('Quantity must be greater than zero.');
      return;
    }

    setStockPosting(true);
    setInlineStatusMessage('Using stock on Job...');
    try {
      await issueInventoryPartToJob({
        itemId: stockDraft.itemId,
        jobId: selectedMaterialsJob.id,
        warehouseId: stockDraft.warehouseId,
        binId: stockDraft.binId || null,
        quantity: stockDraft.quantity,
        notes: `Added from Materials #${selectedMaterialsJob.jobNumber}`,
      });
      setStockDraft({ itemId: '', warehouseId: '', binId: '', quantity: 1 });
      const snapshot = await listWarehouseSnapshot(companyId);
      setStockSnapshot(snapshot);
      await onWarehouseStockIssued();
      setInlineStatusMessage('Stock added to Job materials.');
    } catch (error) {
      setInlineStatusMessage(warehouseErrorMessage(error));
    } finally {
      setStockPosting(false);
    }
  }

  async function updateInlineMaterialStatus(material: MaterialRow, job: ServiceJob, nextStatus: MaterialRow['status']) {
    const previousStatus = statusOverrides[material.id] ?? material.status;
    setStatusOverrides((statuses) => ({ ...statuses, [material.id]: nextStatus }));
    setSavingStatusId(material.id);
    setInlineStatusMessage('Saving material status...');

    const rowsForJob = materials
      .filter((row) => row.jobNumber === job.jobNumber)
      .map((row) => (row.id === material.id ? { ...row, status: nextStatus } : row));

    try {
      await onSaveMaterials(job.jobNumber, rowsForJob);
      setInlineStatusMessage('Material status saved.');
    } catch (error) {
      setStatusOverrides((statuses) => ({ ...statuses, [material.id]: previousStatus }));
      setInlineStatusMessage(error instanceof Error ? error.message : 'Material status could not be saved.');
    } finally {
      setSavingStatusId('');
    }
  }

  return (
    <section className="materials-page">
      <div className="materials-header">
        <div>
          <p className="eyebrow">Parts and purchases</p>
          <h1>Materials</h1>
          {inlineStatusMessage ? <p className="access-status">{inlineStatusMessage}</p> : null}
        </div>
        <div className="materials-summary">
          <span>
            <strong>{materials.length}</strong>
            Material rows
          </span>
          <span>
            <strong>{jobsWithoutMaterials.length}</strong>
            Jobs without materials
          </span>
          <span>
            <strong>{money(materialsTotal)}</strong>
            Filtered cost
          </span>
        </div>
      </div>

      <div className="materials-toolbar">
        <label>
          Jobs
          <select value={materialJobStatusFilter} onChange={(event) => onMaterialJobStatusFilterChange(event.target.value as MaterialJobStatusFilter)}>
            <option value="active">Active jobs</option>
            <option value="all">All jobs</option>
            <option value="Completed">Completed</option>
            <option value="Cancelled">Cancelled</option>
            <option value="Archived">Archived</option>
          </select>
        </label>
        <label>
          Status
          <select value={materialStatusFilter} onChange={(event) => onMaterialStatusFilterChange(event.target.value as 'all' | MaterialRow['status'])}>
            <option value="all">All statuses</option>
            {materialStatuses.map((status) => (
              <option value={status} key={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          Technician
          <select value={materialTechFilter} onChange={(event) => onMaterialTechFilterChange(event.target.value)}>
            <option value="all">All technicians</option>
            <option value="No technician">No technician</option>
            {profile.technicians.filter((technician) => technician.role === 'technician').map((technician) => (
              <option value={technician.name} key={technician.id}>
                {technician.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search
          <input value={materialSearch} onChange={(event) => onMaterialSearchChange(event.target.value)} placeholder="Job #, client, supplier, material" />
        </label>
        <button className="secondary-button compact" type="button" onClick={onResetFilters}>
          Reset
        </button>
      </div>

      {jobsWithoutMaterials.length ? (
        <section className="materials-missing">
          <div>
            <PackageCheck size={20} aria-hidden="true" />
            <strong>Jobs without materials</strong>
          </div>
          <div className="materials-missing-list">
            {jobsWithoutMaterials.map((job) => (
              <button className="materials-missing-job" type="button" onClick={() => onOpenMaterialEditor(job.jobNumber)} key={job.jobNumber}>
                #{job.jobNumber} - {job.organization} - {job.issue}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="materials-table-wrap">
        <table className="materials-page-table">
          <thead>
            <tr>
              <th>Job / Client / Issue</th>
              <th>Technician</th>
              <th>Material</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Total</th>
              <th>Supplier</th>
              <th>Status</th>
              <th>Edit</th>
            </tr>
          </thead>
          <tbody>
            {filteredMaterialRows.map(({ material, job }) => {
              const currentStatus = statusOverrides[material.id] ?? material.status;
              const savingThisStatus = savingStatusId === material.id;

              return (
                <tr key={material.id} className="materials-clickable-row" onClick={() => onOpenJob(job)}>
                  <td>
                    <button className="job-number-link" type="button" onClick={() => onOpenJob(job)}>
                      #{job.jobNumber}
                    </button>
                    <strong>{job.organization}</strong>
                    <span>{job.clientName} - {job.system} - {job.issue}</span>
                  </td>
                  <td>{job.assignee?.trim() || 'Unassigned'}</td>
                  <td>{material.name || '-'}</td>
                  <td>{material.quantity}</td>
                  <td>{money(material.price)}</td>
                  <td>{money(material.quantity * material.price)}</td>
                  <td>{material.supplier || '-'}</td>
                  <td>
                    <select
                      className={`material-status-select ${statusClassName(currentStatus)}`}
                      value={currentStatus}
                      disabled={savingThisStatus}
                      onChange={(event) => updateInlineMaterialStatus(material, job, event.target.value as MaterialRow['status'])}
                      aria-label={`Material status for job ${job.jobNumber}`}
                    >
                      {materialStatuses.map((status) => (
                        <option value={status} key={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button className="secondary-button compact" type="button" onClick={(event) => { event.stopPropagation(); onOpenMaterialEditor(job.jobNumber); }}>
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
            {!filteredMaterialRows.length ? (
              <tr>
                <td colSpan={9}>
                  <div className="empty-inline">No material rows match the filters.</div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedMaterialsJob ? (
        <div className="material-modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit materials">
          <div className="material-modal">
            <div className="material-modal-header">
              <div>
                <p className="eyebrow">Edit materials</p>
                <h2>#{selectedMaterialsJob.jobNumber} - {selectedMaterialsJob.organization}</h2>
                <span>{selectedMaterialsJob.clientName} - {selectedMaterialsJob.issue}</span>
              </div>
              <button className="secondary-button compact" type="button" onClick={onCloseMaterialEditor}>
                Close
              </button>
            </div>

            <div className="material-editor-table">
              <div className="material-editor-head">
                <span>Name</span>
                <span>Qty</span>
                <span>Price</span>
                <span>Supplier</span>
                <span>Status</span>
                <span />
              </div>
              {materialDraftRows.map((row) => {
                const warehouseSource = row.sourceType === 'warehouse' || Boolean(row.inventoryMovementId);
                return (
                  <div className={`material-editor-row${warehouseSource ? ' warehouse-source' : ''}`} key={row.id}>
                    <input value={row.name} onChange={(event) => onUpdateMaterialDraft(row.id, { name: event.target.value })} placeholder="Material name" />
                    <input type="number" min="1" value={row.quantity} disabled={warehouseSource} title={warehouseSource ? 'Return unused stock to change quantity.' : undefined} onChange={(event) => onUpdateMaterialDraft(row.id, { quantity: Number(event.target.value) })} aria-label="Quantity" />
                    <input type="number" min="0" value={row.price} onChange={(event) => onUpdateMaterialDraft(row.id, { price: Number(event.target.value) })} aria-label="Price" />
                    <input value={row.supplier} onChange={(event) => onUpdateMaterialDraft(row.id, { supplier: event.target.value })} placeholder="Supplier" />
                    <select value={row.status} onChange={(event) => onUpdateMaterialDraft(row.id, { status: event.target.value as MaterialRow['status'] })}>
                      {materialStatuses.map((status) => (
                        <option value={status} key={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                    <button className={`secondary-button compact${warehouseSource ? '' : ' danger-lite'}`} type="button" onClick={() => (warehouseSource ? openStockPicker() : onRemoveMaterialDraftRow(row.id))}>
                      {warehouseSource ? 'Stock' : 'Remove'}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="material-modal-actions">
              <button className="secondary-button compact" type="button" onClick={openStockPicker}>
                <PackageCheck size={16} aria-hidden="true" />
                Stock
              </button>
              <button className="secondary-button compact" type="button" onClick={onAddMaterialDraftRow}>
                <Plus size={16} aria-hidden="true" />
                Add row
              </button>
              <button className="primary-button" type="button" onClick={onSaveMaterialDraftRows}>
                Save materials
              </button>
            </div>
            {stockPickerOpen ? (
              <section className="material-stock-picker">
                <div className="material-stock-picker-head">
                  <strong>Add from stock</strong>
                  <input value={stockSearch} onChange={(event) => setStockSearch(event.target.value)} placeholder="Search stock" />
                </div>
                {stockLoading ? <div className="empty-inline">Loading stock...</div> : null}
                {!stockLoading && stockItems.length ? (
                  <div className="material-stock-list">
                    {stockItems.slice(0, 12).map(({ balance, item, warehouse }) => {
                      const selected = stockDraft.itemId === balance.itemId && stockDraft.warehouseId === balance.warehouseId && (stockDraft.binId || '') === (balance.binId || '');
                      return (
                        <button className={`material-stock-row${selected ? ' selected' : ''}`} type="button" onClick={() => selectStockRow(balance)} key={balance.id}>
                          <span>
                            <strong>{item.internalName}</strong>
                            <small>{[item.partNumber, item.manufacturer, item.oem].filter(Boolean).join(' - ') || 'No part details'}</small>
                          </span>
                          <span>{warehouse.name}</span>
                          <strong>{balance.quantity} {item.unit}</strong>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {!stockLoading && !stockItems.length ? <div className="empty-inline">No stock found.</div> : null}
                <div className="material-stock-actions">
                  <label>Quantity
                    <input type="number" min="1" value={stockDraft.quantity} onChange={(event) => setStockDraft((draft) => ({ ...draft, quantity: Number(event.target.value) || 0 }))} />
                  </label>
                  <button className="primary-button compact" type="button" disabled={stockPosting} onClick={useSelectedStockOnJob}>
                    {stockPosting ? 'Posting...' : 'Use on Job'}
                  </button>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
