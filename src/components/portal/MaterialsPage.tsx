import { useState } from 'react';
import { Plus, PackageCheck } from 'lucide-react';
import type { CompanyOnboardingProfile, MaterialRow, ServiceJob } from '../../types';
import { money, statusClassName } from '../../utils/format';
import { saveJobMaterials as saveJobMaterialsToBackend } from '../../services/jobsStore';

type MaterialRowWithJob = {
  material: MaterialRow;
  job: ServiceJob;
};

export function MaterialsPage({
  materials,
  jobsWithoutMaterials,
  materialsTotal,
  materialStatusFilter,
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
  const [statusOverrides, setStatusOverrides] = useState<Record<string, MaterialRow['status']>>({});
  const [savingStatusId, setSavingStatusId] = useState('');
  const [inlineStatusMessage, setInlineStatusMessage] = useState('');

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
            {profile.technicians.map((technician) => (
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
                <tr key={material.id}>
                  <td>
                    <button className="job-number-link" type="button" onClick={() => onOpenJob(job)}>
                      #{job.jobNumber}
                    </button>
                    <strong>{job.organization}</strong>
                    <span>{job.clientName} - {job.system} - {job.issue}</span>
                  </td>
                  <td>{job.assignee}</td>
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
                    <button className="secondary-button compact" type="button" onClick={() => onOpenMaterialEditor(job.jobNumber)}>
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
