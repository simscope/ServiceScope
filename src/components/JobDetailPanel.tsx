import { ChangeEvent, useEffect, useState } from 'react';
import type { JobAttachment, ServiceJobStatus } from '../types';
import type { JobCardData } from './JobCard';

type PaymentMethodOption = {
  value: string;
  label: string;
};

type JobDetailPanelProps = {
  job: JobCardData;
  technicians: string[];
  systems: string[];
  paymentMethods: PaymentMethodOption[];
  onClose: () => void;
  onSave: (job: JobCardData) => void;
};

const jobStatuses: ServiceJobStatus[] = [
  'New',
  'ReCall',
  'Diagnosis',
  'In progress',
  'Parts ordered',
  'Waiting for parts',
  'To finish',
  'Completed',
  'Warranty',
  'Cancelled',
];

const acceptedFileTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
const acceptedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.pdf'];

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024 * 1024) return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function isAcceptedFile(file: File) {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  return acceptedFileTypes.includes(file.type) || acceptedExtensions.includes(extension);
}

function fileKind(file: File): JobAttachment['kind'] {
  return file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|heic|heif)$/i.test(file.name) ? 'photo' : 'file';
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export function JobDetailPanel({ job, technicians, systems, paymentMethods, onClose, onSave }: JobDetailPanelProps) {
  const [draft, setDraft] = useState<JobCardData>(job);
  const [saved, setSaved] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const jobNumberParts = draft.jobNumber.split('-');
  const jobNumber = jobNumberParts[jobNumberParts.length - 1] ?? draft.jobNumber;
  const scfPaid = Boolean(draft.scfPayment);

  useEffect(() => {
    setDraft(job);
    setSaved(false);
    setUploadError('');
  }, [job]);

  function updateDraft(patch: Partial<JobCardData>) {
    setSaved(false);
    setDraft((current) => ({ ...current, ...patch }));
  }

  function saveDraft() {
    const assignee = draft.technician || 'No technician';
    const nextJob = {
      ...draft,
      technician: assignee,
      assignee,
      attachments: draft.attachments ?? [],
    };

    onSave(nextJob);
    setDraft(nextJob);
    setSaved(true);
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    setUploadError('');

    if (!files.length) return;

    const invalidFile = files.find((file) => !isAcceptedFile(file));
    if (invalidFile) {
      setUploadError('Accepted formats: JPG, PNG, WEBP, HEIC, HEIF, PDF.');
      return;
    }

    const attachments = await Promise.all(
      files.map(async (file): Promise<JobAttachment> => ({
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        kind: fileKind(file),
        uploadedAt: new Date().toISOString(),
        dataUrl: fileKind(file) === 'photo' ? await readFileAsDataUrl(file) : undefined,
      })),
    );

    updateDraft({ attachments: [...(draft.attachments ?? []), ...attachments] });
  }

  function removeAttachment(attachmentId: string) {
    updateDraft({ attachments: (draft.attachments ?? []).filter((attachment) => attachment.id !== attachmentId) });
  }

  return (
    <section className="job-detail-panel">
      <header className="job-detail-title">
        <h1>Edit Job #{jobNumber}</h1>
      </header>

      <div className="job-detail-grid">
        <section className="job-detail-card">
          <div className="job-detail-card-header">
            <h2>Parameters</h2>
            <button className="archive-button" type="button">
              Archive
            </button>
          </div>
          <div className="job-detail-form">
            <label>
              Technician
              <select value={draft.technician && draft.technician !== 'No technician' ? draft.technician : ''} onChange={(event) => updateDraft({ technician: event.target.value || 'No technician' })}>
                <option value="">--</option>
                {technicians.map((technician) => (
                  <option value={technician} key={technician}>
                    {technician}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Appointment (NY)
              <input type="datetime-local" value={draft.appointment ?? ''} onChange={(event) => updateDraft({ appointment: event.target.value })} />
            </label>
            <label>
              System type
              <select value={draft.system} onChange={(event) => updateDraft({ system: event.target.value })}>
                {systems.map((system) => (
                  <option value={system} key={system}>
                    {system}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Issue
              <input value={draft.issue} onChange={(event) => updateDraft({ issue: event.target.value })} />
            </label>
            <label>
              SCF ($)
              <input value={draft.serviceCallFee.replace('$', '')} onChange={(event) => updateDraft({ serviceCallFee: event.target.value })} />
            </label>
            <label>
              SCF payment
              <select value={draft.scfPayment} onChange={(event) => updateDraft({ scfPayment: event.target.value })}>
                <option value="">-</option>
                {paymentMethods.map((method) => (
                  <option value={method.value} key={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </label>
            {!scfPaid ? <p className="payment-warning">SCF unpaid -- select payment method</p> : null}
            <label>
              Labor ($)
              <input value={draft.labor} onChange={(event) => updateDraft({ labor: event.target.value })} />
            </label>
            <label>
              Labor payment
              <select value={draft.laborPayment} onChange={(event) => updateDraft({ laborPayment: event.target.value })}>
                <option value="">-</option>
                {paymentMethods.map((method) => (
                  <option value={method.value} key={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select value={draft.status} onChange={(event) => updateDraft({ status: event.target.value as ServiceJobStatus })}>
                {jobStatuses.map((status) => (
                  <option value={status} key={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Job # (optional)
              <input value={draft.jobNumber} onChange={(event) => updateDraft({ jobNumber: event.target.value })} />
            </label>
          </div>
          <div className="job-detail-actions">
            <button className="primary-button" type="button" onClick={saveDraft}>
              Save job
            </button>
            <button className="secondary-button compact" type="button" onClick={onClose}>
              Back
            </button>
            <span>{saved ? 'Saved' : 'Unsaved changes stay here until Save job'}</span>
          </div>
        </section>

        <div className="job-detail-side">
          <section className="job-detail-card">
            <h2>Client</h2>
            <div className="job-detail-form">
              <label>
                Company
                <input value={draft.organization} onChange={(event) => updateDraft({ organization: event.target.value })} />
              </label>
              <label>
                Full name
                <input value={draft.clientName} onChange={(event) => updateDraft({ clientName: event.target.value })} />
              </label>
              <label>
                Phone
                <input value={draft.phone} onChange={(event) => updateDraft({ phone: event.target.value })} />
              </label>
              <label>
                Email
                <input value={draft.email} onChange={(event) => updateDraft({ email: event.target.value })} />
              </label>
              <label>
                Address
                <input value={draft.address} onChange={(event) => updateDraft({ address: event.target.value })} />
              </label>
              <label>
                Additional info
                <textarea value={draft.notes} onChange={(event) => updateDraft({ notes: event.target.value })} placeholder="Any additional notes about the client (access codes, contacts, preferences, etc.)" />
              </label>
            </div>
            <div className="job-detail-actions">
              <button className="primary-button" type="button" onClick={saveDraft}>
                Save client
              </button>
              <span>{saved ? 'Saved' : 'No client changes saved yet'}</span>
              <button className="secondary-button compact" type="button">
                Write to the client
              </button>
            </div>
          </section>

          <section className="job-detail-card invoice-card">
            <div>
              <h2>Invoices (PDF)</h2>
              <p>No invoices for this job yet</p>
            </div>
            <div className="invoice-actions">
              <label className="invoice-select">
                <input type="checkbox" />
                Select all
              </label>
              <button className="secondary-button compact" type="button">
                Send selected
              </button>
              <button className="secondary-button compact" type="button">
                Refresh
              </button>
              <button className="primary-button" type="button">
                + Create invoice
              </button>
            </div>
          </section>
        </div>
      </div>

      <section className="job-detail-card materials-card">
        <h2>Materials</h2>
        <div className="materials-table">
          <span>Name</span>
          <span>Price</span>
          <span>Qty</span>
          <span>Supplier</span>
          <span>Actions</span>
        </div>
        <div className="job-detail-actions">
          <button className="secondary-button compact" type="button">
            + Add
          </button>
          <button className="primary-button" type="button">
            Save materials
          </button>
        </div>
      </section>

      <section className="job-detail-card">
        <h2>Comments</h2>
        <textarea value={draft.notes} onChange={(event) => updateDraft({ notes: event.target.value })} placeholder="Add internal comments for this job." />
      </section>

      <section className="job-detail-card job-files-card">
        <div className="job-files-header">
          <div>
            <h2>Photos / Files</h2>
            <p>Accepted formats: JPG, PNG, WEBP, HEIC, HEIF, PDF.</p>
          </div>
          <label className="file-upload-button">
            Upload
            <input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" onChange={handleFileUpload} />
          </label>
        </div>
        {uploadError ? <p className="file-upload-error">{uploadError}</p> : null}
        <div className="job-files-grid">
          {(draft.attachments ?? []).map((attachment) => (
            <article className="job-file-card" key={attachment.id}>
              {attachment.kind === 'photo' && attachment.dataUrl ? (
                <img src={attachment.dataUrl} alt={attachment.name} />
              ) : (
                <div className="job-file-icon">PDF</div>
              )}
              <div>
                <strong>{attachment.name}</strong>
                <span>{attachment.kind === 'photo' ? 'Photo' : 'File'} · {formatFileSize(attachment.sizeBytes)}</span>
              </div>
              <button className="secondary-button compact" type="button" onClick={() => removeAttachment(attachment.id)}>
                Remove
              </button>
            </article>
          ))}
          {(draft.attachments ?? []).length === 0 ? <p className="empty-inline">No files yet.</p> : null}
        </div>
        <div className="job-detail-actions">
          <button className="primary-button" type="button" onClick={saveDraft}>
            Save photos / files
          </button>
          <span>{saved ? 'Saved' : 'Upload files, then save the job'}</span>
        </div>
      </section>
    </section>
  );
}
