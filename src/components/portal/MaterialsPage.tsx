import { useMemo, useState } from 'react';
import { Plus, PackageCheck, Warehouse } from 'lucide-react';
import type { CompanyOnboardingProfile, MaterialRow, ServiceJob } from '../../types';
import type { MaterialJobStatusFilter } from '../../features/materials/useMaterialsFeature';
import { money, statusClassName } from '../../utils/format';
import { saveJobMaterials as saveJobMaterialsToBackend } from '../../services/jobsStore';

type MaterialRowWithJob = {
  material: MaterialRow;
  job: ServiceJob;
};

type MaterialsView = 'materials' | 'inventory';
type InventoryStatusFilter = 'all' | 'available' | 'low' | 'out' | 'incoming';

type InventoryStockItem = {
  key: string;
  sku: string;
  name: string;
  supplier: string;
  location: string;
  onHand: number;
  committed: number;
  available: number;
  incoming: number;
  issued: number;
  returned: number;
  reorderPoint: number;
  unitCost: number;
  stockValue: number;
  jobNumbers: string[];
};

export function MaterialsPage({
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
}: {
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
}) {
  const [materialsView, setMaterialsView] = useState<MaterialsView>('materials');
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState<InventoryStatusFilter>('all');
  const [statusOverrides, setStatusOverrides] = useState<Record<string, MaterialRow['status']>>({});
  const [savingStatusId, setSavingStatusId] = useState('');
  const [inlineStatusMessage, setInlineStatusMessage] = useState('');

  const inventoryStockItems = useMemo(() => {
    const groupedMaterials = new Map<string, InventoryStockItem & { costQuantity: number; costTotal: number }>();

    materials.forEach((material) => {
      const name = material.name.trim() || 'Unnamed material';
      const supplier = material.supplier.trim() || 'No supplier';
      const key = `${name.toLowerCase()}::${supplier.toLowerCase()}`;
      const existingMaterial = groupedMaterials.get(key) ?? {
        key,
        sku: `MAT-${String(groupedMaterials.size + 1).padStart(4, '0')}`,
        name,
        supplier,
        location: 'Main stock',
        onHand: 0,
        committed: 0,
        available: 0,
        incoming: 0,
        issued: 0,
        returned: 0,
        reorderPoint: 0,
        unitCost: 0,
        stockValue: 0,
        jobNumbers: [],
        costQuantity: 0,
        costTotal: 0,
      };
      const quantity = Number(material.quantity) || 0;
      const price = Number(material.price) || 0;

      if (material.status === 'Needed') existingMaterial.committed += quantity;
      if (material.status === 'Ordered') existingMaterial.incoming += quantity;
      if (material.status === 'Received') existingMaterial.onHand += quantity;
      if (material.status === 'Installed') existingMaterial.issued += quantity;
      if (material.status === 'Returned') existingMaterial.returned += quantity;

      if (price > 0 && quantity > 0) {
        existingMaterial.costQuantity += quantity;
        existingMaterial.costTotal += quantity * price;
      }
      if (!existingMaterial.jobNumbers.includes(material.jobNumber)) existingMaterial.jobNumbers.push(material.jobNumber);
      groupedMaterials.set(key, existingMaterial);
    });

    return Array.from(groupedMaterials.values()).map((item) => {
      const onHand = Math.max(0, item.onHand - item.issued - item.returned);
      const available = Math.max(0, onHand - item.committed);
      const unitCost = item.costQuantity ? item.costTotal / item.costQuantity : 0;
      const reorderPoint = item.committed > 0 ? Math.max(1, Math.ceil(item.committed * 0.5)) : 0;

      return {
        ...item,
        onHand,
        available,
        unitCost,
        reorderPoint,
        stockValue: onHand * unitCost,
      };
    }).sort((left, right) => left.name.localeCompare(right.name));
  }, [materials]);

  const filteredInventoryItems = useMemo(() => {
    const query = inventorySearch.trim().toLowerCase();

    return inventoryStockItems.filter((item) => {
      const matchesQuery = !query
        || item.name.toLowerCase().includes(query)
        || item.supplier.toLowerCase().includes(query)
        || item.sku.toLowerCase().includes(query)
        || item.location.toLowerCase().includes(query)
        || item.jobNumbers.some((jobNumber) => jobNumber.toLowerCase().includes(query));
      const matchesStatus = inventoryStatusFilter === 'all'
        || (inventoryStatusFilter === 'available' && item.available > 0)
        || (inventoryStatusFilter === 'low' && item.onHand > 0 && item.onHand <= item.reorderPoint)
        || (inventoryStatusFilter === 'out' && item.onHand <= 0)
        || (inventoryStatusFilter === 'incoming' && item.incoming > 0);

      return matchesQuery && matchesStatus;
    });
  }, [inventorySearch, inventoryStatusFilter, inventoryStockItems]);

  const inventorySummary = useMemo(() => inventoryStockItems.reduce((summary, item) => ({
    uniqueItems: summary.uniqueItems + 1,
    onHand: summary.onHand + item.onHand,
    available: summary.available + item.available,
    incoming: summary.incoming + item.incoming,
    committed: summary.committed + item.committed,
    value: summary.value + item.stockValue,
    reorderAlerts: summary.reorderAlerts + (item.onHand <= item.reorderPoint && (item.committed > 0 || item.incoming > 0) ? 1 : 0),
  }), {
    uniqueItems: 0,
    onHand: 0,
    available: 0,
    incoming: 0,
    committed: 0,
    value: 0,
    reorderAlerts: 0,
  }), [inventoryStockItems]);

  async function updateInlineMaterialStatus(material: MaterialRow, job: ServiceJob, nextStatus: MaterialRow['status']) {
    const previousStatus = statusOverrides[material.id] ?? material.status;
    setStatusOverrides((statuses) => ({ ...statuses, [material.id]: nextStatus }));
    setSavingStatusId(material.id);
    setInlineStatusMessage('Saving material status...');

    const rowsForJob = materials
      .filter((row) => row.jobNumber === job.jobNumber)
      .map((row) => (row.id === material.id ? { ...row, status: nextStatus } : row));

    try {
      await saveJobMaterialsToBackend(job.companyId, job.jobNumber, rowsForJob);
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
          <h1>{materialsView === 'inventory' ? 'Inventory' : 'Materials'}</h1>
          {inlineStatusMessage ? <p className="access-status">{inlineStatusMessage}</p> : null}
        </div>
        <div className="materials-summary">
          {materialsView === 'inventory' ? (
            <>
              <span>
                <strong>{inventorySummary.uniqueItems}</strong>
                Items
              </span>
              <span>
                <strong>{inventorySummary.onHand}</strong>
                On hand
              </span>
              <span>
                <strong>{inventorySummary.available}</strong>
                Available
              </span>
              <span>
                <strong>{money(inventorySummary.value)}</strong>
                Inventory value
              </span>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      <div className="materials-view-tabs" aria-label="Materials views">
        <button className={materialsView === 'materials' ? 'active' : ''} type="button" onClick={() => setMaterialsView('materials')}>
          Materials
        </button>
        <button className={materialsView === 'inventory' ? 'active' : ''} type="button" onClick={() => setMaterialsView('inventory')}>
          <Warehouse size={16} aria-hidden="true" />
          Inventory
        </button>
      </div>

      {materialsView === 'inventory' ? (
        <>
          <div className="inventory-toolbar">
            <label>
              Search inventory
              <input value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder="SKU, item, supplier, location, job #" />
            </label>
            <label>
              Stock status
              <select value={inventoryStatusFilter} onChange={(event) => setInventoryStatusFilter(event.target.value as InventoryStatusFilter)}>
                <option value="all">All stock</option>
                <option value="available">Available</option>
                <option value="low">Low stock</option>
                <option value="out">Out of stock</option>
                <option value="incoming">Incoming</option>
              </select>
            </label>
            <div className="inventory-movement-summary">
              <span><strong>{inventorySummary.incoming}</strong> incoming</span>
              <span><strong>{inventorySummary.committed}</strong> committed</span>
              <span><strong>{inventorySummary.reorderAlerts}</strong> reorder</span>
            </div>
          </div>

          <div className="inventory-table-wrap">
            <table className="inventory-stock-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Item</th>
                  <th>Location</th>
                  <th>On hand</th>
                  <th>Committed</th>
                  <th>Available</th>
                  <th>Incoming</th>
                  <th>Reorder point</th>
                  <th>Unit cost</th>
                  <th>Value</th>
                  <th>Supplier</th>
                  <th>Jobs</th>
                </tr>
              </thead>
              <tbody>
                {filteredInventoryItems.map((item) => {
                  const stockState = item.onHand <= 0 ? 'out' : item.onHand <= item.reorderPoint ? 'low' : 'ok';

                  return (
                    <tr className={stockState} key={item.key}>
                      <td><strong>{item.sku}</strong></td>
                      <td>
                        <strong>{item.name}</strong>
                        <span>Issued {item.issued} - Returned {item.returned}</span>
                      </td>
                      <td>{item.location}</td>
                      <td><strong>{item.onHand}</strong></td>
                      <td>{item.committed}</td>
                      <td><strong>{item.available}</strong></td>
                      <td>{item.incoming}</td>
                      <td>{item.reorderPoint}</td>
                      <td>{money(item.unitCost)}</td>
                      <td>{money(item.stockValue)}</td>
                      <td>{item.supplier}</td>
                      <td>
                        <div className="inventory-job-links">
                          {item.jobNumbers.slice(0, 4).map((jobNumber) => (
                            <button type="button" key={jobNumber} onClick={() => onOpenMaterialEditor(jobNumber)}>
                              #{jobNumber}
                            </button>
                          ))}
                          {item.jobNumbers.length > 4 ? <span>+{item.jobNumbers.length - 4}</span> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!filteredInventoryItems.length ? (
                  <tr>
                    <td colSpan={12}>
                      <div className="empty-inline">No inventory items match the filters.</div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="inventory-movement-table-wrap">
            <table className="inventory-movement-table">
              <thead>
                <tr>
                  <th>Movement</th>
                  <th>Job</th>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Supplier</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {materials.slice(0, 12).map((material) => (
                  <tr key={material.id}>
                    <td>{material.status}</td>
                    <td>
                      <button className="job-number-link" type="button" onClick={() => onOpenMaterialEditor(material.jobNumber)}>
                        #{material.jobNumber}
                      </button>
                    </td>
                    <td>{material.name || '-'}</td>
                    <td>{material.quantity}</td>
                    <td>{material.supplier || '-'}</td>
                    <td>{money(material.quantity * material.price)}</td>
                  </tr>
                ))}
                {!materials.length ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty-inline">No stock movements yet.</div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
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
        </>
      )}

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
              {materialDraftRows.map((row) => (
                <div className="material-editor-row" key={row.id}>
                  <input value={row.name} onChange={(event) => onUpdateMaterialDraft(row.id, { name: event.target.value })} placeholder="Material name" />
                  <input type="number" min="1" value={row.quantity} onChange={(event) => onUpdateMaterialDraft(row.id, { quantity: Number(event.target.value) })} aria-label="Quantity" />
                  <input type="number" min="0" value={row.price} onChange={(event) => onUpdateMaterialDraft(row.id, { price: Number(event.target.value) })} aria-label="Price" />
                  <input value={row.supplier} onChange={(event) => onUpdateMaterialDraft(row.id, { supplier: event.target.value })} placeholder="Supplier" />
                  <select value={row.status} onChange={(event) => onUpdateMaterialDraft(row.id, { status: event.target.value as MaterialRow['status'] })}>
                    {materialStatuses.map((status) => (
                      <option value={status} key={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <button className="secondary-button compact danger-lite" type="button" onClick={() => onRemoveMaterialDraftRow(row.id)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div className="material-modal-actions">
              <button className="secondary-button compact" type="button" onClick={onAddMaterialDraftRow}>
                <Plus size={16} aria-hidden="true" />
                Add row
              </button>
              <button className="primary-button" type="button" onClick={onSaveMaterialDraftRows}>
                Save materials
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
