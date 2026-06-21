import { ChangeEvent, useEffect, useState } from 'react';
import type { CompanyOnboardingProfile, JobAttachment, JobComment, JobInvoice, MaterialRow, MaterialStatus, ServiceJobStatus } from '../types';
import type { JobCardData } from './JobCard';
import { money } from '../utils/format';

type PaymentMethodOption = {
  value: string;
  label: string;
};

type JobDetailPanelProps = {
  job: JobCardData;
  technicians: string[];
  systems: string[];
  paymentMethods: PaymentMethodOption[];
  materials: MaterialRow[];
  profile: CompanyOnboardingProfile;
  currentUser: {
    name: string;
    role: JobComment['authorRole'];
  };
  onClose: () => void;
  onSave: (job: JobCardData) => void;
  onSaveMaterials: (jobNumber: string, rows: MaterialRow[]) => void;
  onCreateInvoice: (job: JobCardData, materials: MaterialRow[]) => Promise<JobInvoice>;
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
const materialStatuses: MaterialStatus[] = ['Needed', 'Ordered', 'Received', 'Installed', 'Returned'];

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

function formatCommentTime(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function emptyMaterialRow(jobNumber: string): MaterialRow {
  return {
    id: crypto.randomUUID(),
    jobNumber,
    name: '',
    quantity: 1,
    price: 0,
    supplier: '',
    status: 'Needed',
  };
}

export function JobDetailPanel({
  job,
  technicians,
  systems,
  paymentMethods,
  materials,
  profile,
  currentUser,
  onClose,
  onSave,
  onSaveMaterials,
  onCreateInvoice,
}: JobDetailPanelProps) {
  const [draft, setDraft] = useState<JobCardData>(job);
  const [materialDrafts, setMaterialDrafts] = useState<MaterialRow[]>(materials.length ? materials : [emptyMaterialRow(job.jobNumber)]);
  const [commentDraft, setCommentDraft] = useState('');
  const [saved, setSaved] = useState(false);
  const [materialsSaved, setMaterialsSaved] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [invoiceStatus, setInvoiceStatus] = useState('');
  const jobNumberParts = draft.jobNumber.split('-');
  const jobNumber = jobNumberParts[jobNumberParts.length - 1] ?? draft.jobNumber;
  const scfPaid = Boolean(draft.scfPayment);

  useEffect(() => {
    setDraft(job);
    setMaterialDrafts(materials.length ? materials : [emptyMaterialRow(job.jobNumber)]);
    setSaved(false);
    setMaterialsSaved(false);
    setUploadError('');
  }, [job, materials]);

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

  function updateMaterial(rowId: string, patch: Partial<MaterialRow>) {
    setMaterialsSaved(false);
    setMaterialDrafts((rows) => rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  function addMaterial() {
    setMaterialsSaved(false);
    setMaterialDrafts((rows) => [...rows, emptyMaterialRow(draft.jobNumber)]);
  }

  function removeMaterial(rowId: string) {
    setMaterialsSaved(false);
    setMaterialDrafts((rows) => rows.filter((row) => row.id !== rowId));
  }

  function saveMaterials() {
    onSaveMaterials(draft.jobNumber, materialDrafts);
    setMaterialsSaved(true);
  }

  function addComment() {
    if (!commentDraft.trim()) return;

    const nextComment: JobComment = {
      id: crypto.randomUUID(),
      authorName: currentUser.name,
      authorRole: currentUser.role,
      message: commentDraft.trim(),
      createdAt: new Date().toISOString(),
    };
    const nextJob = {
      ...draft,
      comments: [...(draft.comments ?? []), nextComment],
    };

    onSave(nextJob);
    setDraft(nextJob);
    setCommentDraft('');
    setSaved(true);
  }

  const escapeHtml = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function invoiceLines() {
    return [
      { label: 'Service call fee', quantity: 1, price: Number(draft.serviceCallFee || 0) },
      { label: 'Labor', quantity: 1, price: Number(draft.labor || 0) },
      ...materialDrafts
        .filter((material) => material.name.trim() || material.price)
        .map((material) => ({
          label: material.name.trim() || 'Material',
          quantity: Number(material.quantity) || 1,
          price: Number(material.price) || 0,
        })),
    ].filter((line) => line.price > 0 || line.label === 'Labor');
  }

  function openInvoice(invoice: JobInvoice) {
    const lines = invoiceLines();
    const rows = lines.map((line) => `
      <tr>
        <td>${escapeHtml(line.label)}</td>
        <td>${line.quantity}</td>
        <td>${money(line.price)}</td>
        <td>${money(line.price * line.quantity)}</td>
      </tr>
    `).join('');
    const invoiceWindow = window.open('', '_blank', 'noopener,noreferrer');
    if (!invoiceWindow) return;

    invoiceWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>${escapeHtml(invoice.invoiceNumber)}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #17201b; margin: 32px; }
            header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #17201b; padding-bottom: 18px; margin-bottom: 24px; }
            h1 { margin: 0; font-size: 30px; }
            h2 { margin: 0 0 8px; font-size: 16px; }
            p { margin: 3px 0; }
            .muted { color: #526158; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
            .box { border: 1px solid #cfd8d1; border-radius: 8px; padding: 14px; }
            table { width: 100%; border-collapse: collapse; margin-top: 18px; }
            th, td { border-bottom: 1px solid #d7dee8; padding: 10px; text-align: left; vertical-align: top; }
            th { background: #f4f6f8; }
            td:nth-child(2), td:nth-child(3), td:nth-child(4), th:nth-child(2), th:nth-child(3), th:nth-child(4) { text-align: right; }
            .total { display: flex; justify-content: flex-end; margin-top: 18px; font-size: 22px; font-weight: 800; }
            .footer { margin-top: 28px; color: #526158; font-size: 12px; }
            @media print { button { display: none; } body { margin: 18px; } }
          </style>
        </head>
        <body>
          <header>
            <div>
              <h1>Invoice</h1>
              <p><strong>${escapeHtml(invoice.invoiceNumber)}</strong></p>
              <p class="muted">Created ${escapeHtml(invoice.createdAt)}</p>
            </div>
            <div>
              <h2>${escapeHtml(profile.displayName || profile.legalName || 'Service company')}</h2>
              <p>${escapeHtml(profile.serviceAddress || '')}</p>
              <p>${escapeHtml(profile.phone || '')}</p>
              <p>${escapeHtml(profile.website || '')}</p>
            </div>
          </header>
          <div class="grid">
            <section class="box">
              <h2>Bill to</h2>
              <p><strong>${escapeHtml(draft.organization || draft.clientName || 'Customer')}</strong></p>
              <p>${escapeHtml(draft.clientName || '')}</p>
              <p>${escapeHtml(draft.phone || '')}</p>
              <p>${escapeHtml(draft.email || '')}</p>
              <p>${escapeHtml(draft.address || '')}</p>
            </section>
            <section class="box">
              <h2>Job</h2>
              <p><strong>${escapeHtml(draft.jobNumber)}</strong></p>
              <p>${escapeHtml(draft.system)}</p>
              <p>${escapeHtml(draft.issue)}</p>
            </section>
          </div>
          <table>
            <thead>
              <tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="total">Total: ${money(invoice.amount)}</div>
          <p class="footer">${escapeHtml(profile.paymentNotes || 'Thank you for your business.')}</p>
          <button onclick="window.print()">Print / Save PDF</button>
        </body>
      </html>
    `);
    invoiceWindow.document.close();
    invoiceWindow.focus();
  }

  async function createInvoice() {
    setInvoiceStatus('Creating invoice...');
    try {
      const invoice = await onCreateInvoice(draft, materialDrafts);
      const nextJob = {
        ...draft,
        invoices: [invoice, ...(draft.invoices ?? [])],
      };
      setDraft(nextJob);
      setInvoiceStatus('Invoice created.');
      openInvoice(invoice);
    } catch (error) {
      setInvoiceStatus(error instanceof Error ? error.message : 'Invoice could not be created.');
    }
  }

  function sendInvoices() {
    const invoices = draft.invoices ?? [];
    if (!invoices.length || !draft.email) return;
    const body = [
      `Hello ${draft.clientName || ''},`,
      '',
      'Invoice details:',
      ...invoices.map((invoice) => `${invoice.invoiceNumber} - ${money(invoice.amount)} - ${invoice.status}`),
      '',
      profile.paymentNotes || 'Please contact us if you have any questions.',
    ].join('\n');

    window.location.href = `mailto:${encodeURIComponent(draft.email)}?subject=${encodeURIComponent(`Invoice for job ${draft.jobNumber}`)}&body=${encodeURIComponent(body)}`;
  }

  return (
    <section className="job-detail-panel">
      <header className="job-detail-title">
        <button className="secondary-button compact" type="button" onClick={onClose}>
          Back
        </button>
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
              {(draft.invoices ?? []).length ? (
                <div className="invoice-list">
                  {(draft.invoices ?? []).map((invoice) => (
                    <button className="invoice-row" type="button" key={invoice.id} onClick={() => openInvoice(invoice)}>
                      <span>
                        <strong>{invoice.invoiceNumber}</strong>
                        {invoice.status}
                      </span>
                      <b>{money(invoice.amount)}</b>
                    </button>
                  ))}
                </div>
              ) : (
                <p>No invoices for this job yet</p>
              )}
              {invoiceStatus ? <p>{invoiceStatus}</p> : null}
            </div>
            <div className="invoice-actions">
              <button className="secondary-button compact" type="button" onClick={sendInvoices} disabled={!(draft.invoices ?? []).length || !draft.email}>
                Send selected
              </button>
              <button className="primary-button" type="button" onClick={createInvoice}>
                + Create invoice
              </button>
            </div>
          </section>
        </div>
      </div>

      <section className="job-detail-card materials-card">
        <h2>Materials</h2>
        <div className="job-material-editor">
          <div className="job-material-row job-material-head">
            <span>Name</span>
            <span>Price</span>
            <span>Qty</span>
            <span>Supplier</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          {materialDrafts.map((material) => (
            <div className="job-material-row" key={material.id}>
              <input value={material.name} onChange={(event) => updateMaterial(material.id, { name: event.target.value })} placeholder="Material name" />
              <input type="number" min={0} step={1} value={material.price} onChange={(event) => updateMaterial(material.id, { price: Number(event.target.value) || 0 })} placeholder="0" />
              <input type="number" min={1} step={1} value={material.quantity} onChange={(event) => updateMaterial(material.id, { quantity: Number(event.target.value) || 1 })} placeholder="1" />
              <input value={material.supplier} onChange={(event) => updateMaterial(material.id, { supplier: event.target.value })} placeholder="Supplier" />
              <select value={material.status} onChange={(event) => updateMaterial(material.id, { status: event.target.value as MaterialStatus })}>
                {materialStatuses.map((status) => (
                  <option value={status} key={status}>
                    {status}
                  </option>
                ))}
              </select>
              <button className="secondary-button compact" type="button" onClick={() => removeMaterial(material.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="job-detail-actions">
          <button className="secondary-button compact" type="button" onClick={addMaterial}>
            + Add
          </button>
          <button className="primary-button" type="button" onClick={saveMaterials}>
            Save materials
          </button>
          <span>{materialsSaved ? 'Saved' : 'Material changes stay here until Save materials'}</span>
        </div>
      </section>

      <section className="job-detail-card job-comments-card">
        <h2>Comments</h2>
        <div className="job-comment-list">
          {(draft.comments ?? []).map((comment) => (
            <article className={`job-comment ${comment.authorRole.toLowerCase()}`} key={comment.id}>
              <div>
                <strong>{comment.authorName}</strong>
                <span>{comment.authorRole} - {formatCommentTime(comment.createdAt)}</span>
              </div>
              <p>{comment.message}</p>
            </article>
          ))}
          {(draft.comments ?? []).length === 0 ? <p className="empty-inline">No comments yet.</p> : null}
        </div>
        <div className="job-comment-compose">
          <div className="job-comment-author">
            <strong>{currentUser.name}</strong>
            <span>{currentUser.role}</span>
          </div>
          <textarea
            value={commentDraft}
            onChange={(event) => setCommentDraft(event.target.value)}
            placeholder="Write a comment..."
          />
          <button className="primary-button" type="button" onClick={addComment}>
            Send
          </button>
        </div>
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
                <span>{attachment.kind === 'photo' ? 'Photo' : 'File'} - {formatFileSize(attachment.sizeBytes)}</span>
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
