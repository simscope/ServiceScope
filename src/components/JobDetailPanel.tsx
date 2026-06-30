import { ChangeEvent, useEffect, useState } from 'react';
import type { EmailCompose, EmailComposeAttachment } from '../appTypes';
import type { CompanyOnboardingProfile, JobAttachment, JobComment, JobDocumentType, JobInvoice, MaterialRow, MaterialStatus, ServiceJobStatus } from '../types';
import type { JobCardData } from './JobCard';
import { money } from '../utils/format';
import { deleteJobFile } from '../services/jobFiles';

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
  onSaveMaterials: (jobOrJobNumber: JobCardData | string, rows: MaterialRow[]) => void | Promise<void>;
  onCreateInvoice: (job: JobCardData, materials: MaterialRow[], amount: number, documentType: JobDocumentType) => Promise<JobInvoice>;
  onDeleteInvoice?: (job: JobCardData, invoiceId: string) => Promise<void>;
  onComposeEmail?: (compose: EmailCompose, attachments?: EmailComposeAttachment[]) => void;
};

type InvoiceLineType = 'service' | 'material' | 'other';

type InvoiceLineDraft = {
  id: string;
  type: InvoiceLineType;
  name: string;
  quantity: number;
  price: number;
};

type InvoiceDraft = {
  documentType: JobDocumentType;
  invoiceDate: string;
  balanceDue: number;
  discount: number;
  includeWarranty: boolean;
  warrantyDays: number;
  lines: InvoiceLineDraft[];
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

function formatInvoiceTime(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
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

function todayLocalDate() {
  return new Date().toISOString().slice(0, 10);
}

function invoiceLineAmount(line: InvoiceLineDraft) {
  return Math.max(0, Number(line.quantity) || 0) * Math.max(0, Number(line.price) || 0);
}

function fallbackInvoiceLine(job: JobCardData): InvoiceLineDraft {
  return {
    id: crypto.randomUUID(),
    type: 'service',
    name: 'Service Call Fee',
    quantity: 1,
    price: Number(job.serviceCallFee || 0),
  };
}

function makeInvoiceLines(job: JobCardData, rows: MaterialRow[]): InvoiceLineDraft[] {
  const lines: InvoiceLineDraft[] = [];
  const labor = Number(job.labor || 0);
  const serviceCallFee = Number(job.serviceCallFee || 0);

  if (labor > 0) {
    lines.push({ id: crypto.randomUUID(), type: 'service', name: 'Labor', quantity: 1, price: labor });
  }

  lines.push({ id: crypto.randomUUID(), type: 'service', name: 'Service Call Fee', quantity: 1, price: serviceCallFee });

  rows
    .filter((material) => material.name.trim() || Number(material.price) > 0)
    .forEach((material) => {
      lines.push({
        id: crypto.randomUUID(),
        type: 'material',
        name: material.name.trim() || 'Material',
        quantity: Number(material.quantity) || 1,
        price: Number(material.price) || 0,
      });
    });

  return lines.length ? lines : [fallbackInvoiceLine(job)];
}

function invoiceLinesTotal(lines: InvoiceLineDraft[], discount = 0) {
  const subtotal = lines.reduce((sum, line) => sum + invoiceLineAmount(line), 0);
  return Math.max(0, subtotal - Math.max(0, Number(discount) || 0));
}

function nextInvoiceNumberPreview(jobNumber: string, invoices: JobInvoice[]) {
  const prefix = `INV-${jobNumber}-`;
  const nextIndex = invoices.reduce((maxIndex, invoice) => {
    if (!invoice.invoiceNumber.startsWith(prefix)) return maxIndex;
    const suffix = Number.parseInt(invoice.invoiceNumber.slice(prefix.length), 10);
    return Number.isFinite(suffix) ? Math.max(maxIndex, suffix) : maxIndex;
  }, 0) + 1;

  return `INV-${jobNumber}-${String(nextIndex).padStart(2, '0')}`;
}

function textToBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function invoiceErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('23505') || message.includes('duplicate key')) {
    return 'Invoice number was already used. Reload jobs and create the invoice again.';
  }
  if (message.includes('document_type')) {
    return 'Database needs the job_invoices.document_type column. Run the Supabase SQL update, then try again.';
  }
  return message || 'Invoice could not be created.';
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
  onDeleteInvoice,
  onComposeEmail,
}: JobDetailPanelProps) {
  const [draft, setDraft] = useState<JobCardData>(job);
  const [materialDrafts, setMaterialDrafts] = useState<MaterialRow[]>(materials.length ? materials : [emptyMaterialRow(job.jobNumber)]);
  const [commentDraft, setCommentDraft] = useState('');
  const [saved, setSaved] = useState(false);
  const [materialsSaved, setMaterialsSaved] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [previewAttachment, setPreviewAttachment] = useState<JobAttachment | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
  const [invoiceStatus, setInvoiceStatus] = useState('');
  const [invoiceEditorOpen, setInvoiceEditorOpen] = useState(false);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [invoiceDraft, setInvoiceDraft] = useState<InvoiceDraft>(() => ({
    documentType: 'Invoice',
    invoiceDate: todayLocalDate(),
    balanceDue: invoiceLinesTotal(makeInvoiceLines(job, materials)),
    discount: 0,
    includeWarranty: true,
    warrantyDays: profile.warrantyDays,
    lines: makeInvoiceLines(job, materials),
  }));
  const jobNumberParts = draft.jobNumber.split('-');
  const jobNumber = jobNumberParts[jobNumberParts.length - 1] ?? draft.jobNumber;
  const scfPaid = Boolean(draft.scfPayment);
  const invoiceSubtotal = invoiceDraft.lines.reduce((sum, line) => sum + invoiceLineAmount(line), 0);
  const invoiceDiscount = Math.max(0, Number(invoiceDraft.discount) || 0);
  const invoiceComputedTotal = Math.max(0, invoiceSubtotal - invoiceDiscount);
  const invoiceTotal = Math.max(0, Number(invoiceDraft.balanceDue) || 0);
  const nextInvoiceNumber = nextInvoiceNumberPreview(draft.jobNumber, draft.invoices ?? []);
  const invoices = draft.invoices ?? [];
  const selectedInvoices = invoices.filter((invoice) => selectedInvoiceIds.includes(invoice.id));
  const allInvoicesSelected = invoices.length > 0 && selectedInvoiceIds.length === invoices.length;
  const attachments = draft.attachments ?? [];
  const selectedAttachments = attachments.filter((attachment) => selectedAttachmentIds.includes(attachment.id));
  const allAttachmentsSelected = attachments.length > 0 && selectedAttachments.length === attachments.length;

  useEffect(() => {
    setDraft(job);
    setMaterialDrafts(materials.length ? materials : [emptyMaterialRow(job.jobNumber)]);
    setInvoiceDraft({
      documentType: 'Invoice',
      invoiceDate: todayLocalDate(),
      balanceDue: invoiceLinesTotal(makeInvoiceLines(job, materials)),
      discount: 0,
      includeWarranty: true,
      warrantyDays: profile.warrantyDays,
      lines: makeInvoiceLines(job, materials),
    });
    setSelectedInvoiceIds([]);
    setSaved(false);
    setMaterialsSaved(false);
    setUploadError('');
  }, [job, materials, profile.warrantyDays]);

  useEffect(() => {
    if (!invoiceEditorOpen || invoiceDraft.lines.length > 0) return;
    const lines = makeInvoiceLines(draft, materialDrafts);
    setInvoiceDraft((current) => ({
      ...current,
      lines,
      balanceDue: invoiceLinesTotal(lines, current.discount),
    }));
  }, [draft, invoiceDraft.lines.length, invoiceEditorOpen, materialDrafts]);

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

    const nextJob = {
      ...draft,
      attachments: [...(draft.attachments ?? []), ...attachments],
    };

    setDraft(nextJob);
    setSaved(false);
    onSave(nextJob);
  }

  async function removeAttachment(attachmentId: string) {
    const attachment = (draft.attachments ?? []).find((item) => item.id === attachmentId);
    const companyId = draft.companyId || job.companyId;
    const nextJob = {
      ...draft,
      attachments: (draft.attachments ?? []).filter((item) => item.id !== attachmentId),
    };

    setDraft(nextJob);
    setSelectedAttachmentIds((ids) => ids.filter((id) => id !== attachmentId));
    setSaved(false);
    setUploadError('');

    try {
      if (companyId && draft.id && attachment?.storagePath) {
        await deleteJobFile(companyId, draft.id, attachmentId, attachment.storageBucket, attachment.storagePath);
      }
      await Promise.resolve(onSave(nextJob));
      setSaved(true);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'File could not be deleted.');
    }
  }

  function closeAttachmentPreview() {
    setPreviewAttachment(null);
    setPreviewUrl('');
  }

  function attachmentUrl(attachment: JobAttachment) {
    return attachment.dataUrl ?? '';
  }

  function openAttachment(attachment: JobAttachment) {
    const url = attachmentUrl(attachment);
    if (!url) {
      setUploadError('Save the job first, then open this file.');
      return;
    }
    setPreviewAttachment(attachment);
    setPreviewUrl(url);
  }

  async function downloadAttachment(attachment: JobAttachment) {
    const url = attachmentUrl(attachment);
    if (!url) {
      setUploadError('Save the job first, then download this file.');
      return;
    }

    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = attachment.name || 'attachment';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = attachment.name || 'attachment';
      anchor.target = '_blank';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
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
    Promise.resolve(onSaveMaterials(draft.jobNumber, materialDrafts))
      .then(() => {
        setMaterialsSaved(true);
      })
      .catch(() => {
        setMaterialsSaved(false);
      });
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

  function resetInvoiceDraft() {
    const lines = makeInvoiceLines(draft, materialDrafts);
    setInvoiceDraft({
      documentType: 'Invoice',
      invoiceDate: todayLocalDate(),
      balanceDue: invoiceLinesTotal(lines),
      discount: 0,
      includeWarranty: true,
      warrantyDays: profile.warrantyDays,
      lines,
    });
  }

  function openInvoiceEditor() {
    const lines = makeInvoiceLines(draft, materialDrafts);
    setInvoiceDraft({
      documentType: 'Invoice',
      invoiceDate: todayLocalDate(),
      balanceDue: invoiceLinesTotal(lines),
      discount: 0,
      includeWarranty: true,
      warrantyDays: profile.warrantyDays,
      lines,
    });
    setInvoiceEditorOpen(true);
    setInvoiceStatus('');
  }

  function updateInvoiceLine(lineId: string, patch: Partial<InvoiceLineDraft>) {
    setInvoiceDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
      balanceDue: invoiceLinesTotal(current.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)), current.discount),
    }));
  }

  function addInvoiceLine() {
    const line = { id: crypto.randomUUID(), type: 'service' as InvoiceLineType, name: '', quantity: 1, price: 0 };
    setInvoiceDraft((current) => ({
      ...current,
      lines: [...current.lines, line],
      balanceDue: invoiceLinesTotal([...current.lines, line], current.discount),
    }));
  }

  function removeInvoiceLine(lineId: string) {
    setInvoiceDraft((current) => ({
      ...current,
      lines: current.lines.length > 1 ? current.lines.filter((line) => line.id !== lineId) : current.lines,
      balanceDue: invoiceLinesTotal(current.lines.length > 1 ? current.lines.filter((line) => line.id !== lineId) : current.lines, current.discount),
    }));
  }

  function makeInvoiceHtml(invoice: JobInvoice, printableDraft = invoiceDraft) {
    const documentType = invoice.documentType || printableDraft.documentType;
    const lines = printableDraft.lines.filter((line) => line.name.trim() || invoiceLineAmount(line) > 0);
    const serviceLines = lines.filter((line) => line.type !== 'material');
    const materialLines = lines.filter((line) => line.type === 'material');
    const makeRows = (items: InvoiceLineDraft[]) => items.map((line) => `
      <tr>
        <td>${escapeHtml(line.name.trim() || 'Service')}</td>
        <td>${line.quantity}</td>
        <td>${money(line.price)}</td>
        <td>${money(invoiceLineAmount(line))}</td>
      </tr>
    `).join('');
    const rows = lines.map((line) => `
      <tr>
        <td>${escapeHtml(line.type)}</td>
        <td>${escapeHtml(line.name.trim() || 'Service')}</td>
        <td>${line.quantity}</td>
        <td>${money(line.price)}</td>
        <td>${money(invoiceLineAmount(line))}</td>
      </tr>
    `).join('');
    const subtotal = lines.reduce((sum, line) => sum + invoiceLineAmount(line), 0);
    const total = Math.max(0, Number(printableDraft.balanceDue) || 0);
    const companyName = profile.displayName || profile.legalName || 'Service company';
    const companyLogo = profile.logoUrl ? `<img class="logo" src="${escapeHtml(profile.logoUrl)}" alt="${escapeHtml(companyName)} logo" />` : '<div class="logo placeholder">S</div>';
    const warrantyDays = Number(printableDraft.warrantyDays) || 0;
    const warranty = printableDraft.includeWarranty ? `
      <section class="warranty">
        <strong>Warranty (${warrantyDays} days):</strong>
        <p>A ${warrantyDays}-day limited warranty applies ONLY to the work performed and/or parts installed by ${escapeHtml(companyName)}. The warranty does not cover other components or the appliance as a whole, normal wear, consumables, damage caused by external factors, or third-party tampering. The warranty starts on the job completion date and is valid only when the invoice is paid in full.</p>
      </section>
    ` : '';

    return `
      <!doctype html>
      <html>
        <head>
          <title>${escapeHtml(invoice.invoiceNumber)}</title>
          <style>
            * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            body { font-family: Arial, sans-serif; color: #050b12; margin: 0; background: #333; }
            .page { width: 816px; min-height: 1056px; margin: 0 auto; background: #fff; padding: 22px 44px 26px; box-sizing: border-box; }
            header { display: grid; grid-template-columns: 1fr 300px; gap: 42px; margin-bottom: 8px; }
            h1 { margin: 0 0 8px; font-size: 38px; letter-spacing: 1px; text-transform: uppercase; text-align: right; }
            h2 { margin: 0 0 5px; font-size: 16px; }
            p { margin: 2px 0; }
            .logo { width: 135px; height: 160px; object-fit: contain; margin-bottom: 12px; }
            .logo.placeholder { display: grid; place-items: center; background: #edf3ff; border-radius: 8px; font: 700 28px Arial; color: #1c408f; }
            .muted { color: #526158; }
            .invoice-meta { text-align: right; }
            .balance { border: 1px solid #d7dee8; border-radius: 10px; background: #f7f9fb; padding: 10px 14px; margin: 8px 0 8px; display: flex; justify-content: space-between; font-weight: 700; }
            .bill-to { margin-top: 8px; text-align: left; }
            table { width: 100%; border-collapse: collapse; margin-top: 0; table-layout: auto; }
            .description-col { width: auto; }
            .qty-col { width: 58px; }
            .unit-price-col { width: 102px; }
            .amount-col { width: 94px; }
            th, td { border: 1px solid #cfd8d1; padding: 8px; text-align: left; vertical-align: top; }
            th { background: #343434; color: #fff; }
            th:first-child, td:first-child { width: auto; }
            th:nth-child(2), td:nth-child(2) { width: 58px; white-space: nowrap; text-align: right; }
            th:nth-child(3), td:nth-child(3) { width: 102px; white-space: nowrap; text-align: right; }
            th:nth-child(4), td:nth-child(4) { width: 94px; white-space: nowrap; text-align: right; }
            .group { background: #eef3f8; font-weight: 700; }
            .totals { width: 260px; margin: 0 6px 0 auto; }
            .totals div { display: flex; justify-content: space-between; margin: 7px 0; font-weight: 700; }
            .warranty { margin-top: 22px; font-size: 13px; }
            .footer { margin-top: 14px; color: #526158; font-size: 12px; }
            @page { size: letter; margin: 0; }
            @media print {
              body { background: #fff; }
              .page { width: 816px; min-height: 1056px; margin: 0 auto; padding: 22px 44px 26px; }
              th { background: #343434 !important; color: #fff !important; }
              .group { background: #eef3f8 !important; }
              .balance { background: #f7f9fb !important; }
            }
          </style>
        </head>
        <body>
        <main class="page">
          <header>
            <div>
              ${companyLogo}
              <h2>${escapeHtml(companyName)}</h2>
              <p>${escapeHtml(profile.serviceAddress || '')}</p>
              <p>${escapeHtml(profile.phone || '')}</p>
              <p>${escapeHtml(profile.billingEmail || '')}</p>
              <p>${escapeHtml(profile.website || '')}</p>
            </div>
            <div class="invoice-meta">
              <h1>${escapeHtml(documentType)}</h1>
              <p># ${escapeHtml(invoice.invoiceNumber)}</p>
              <p><strong>Date:</strong> ${escapeHtml(printableDraft.invoiceDate)}</p>
              <div class="balance"><span>Balance Due:</span><span>${money(total)}</span></div>
              <section class="bill-to">
                <h2>Bill To:</h2>
                <p><strong>${escapeHtml(draft.organization || draft.clientName || 'Customer')}</strong></p>
                <p>${escapeHtml(draft.clientName || '')}</p>
                <p>${escapeHtml(draft.address || '')}</p>
                <p>${escapeHtml(draft.phone || '')}</p>
                <p>${escapeHtml(draft.email || '')}</p>
              </section>
            </div>
          </header>
          <table>
            <colgroup>
              <col class="description-col" />
              <col class="qty-col" />
              <col class="unit-price-col" />
              <col class="amount-col" />
            </colgroup>
            <thead>
              <tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr>
            </thead>
            <tbody>
              ${serviceLines.length ? `<tr class="group"><td colspan="4">Services</td></tr>${makeRows(serviceLines)}` : ''}
              ${materialLines.length ? `<tr class="group"><td colspan="4">Materials</td></tr>${makeRows(materialLines)}` : ''}
              ${!serviceLines.length && !materialLines.length ? rows : ''}
            </tbody>
          </table>
          <section class="totals">
            <div><span>Subtotal:</span><span>${money(subtotal)}</span></div>
            <div><strong>Total:</strong><strong>${money(total)}</strong></div>
          </section>
          ${warranty}
          <p class="footer">${escapeHtml(profile.paymentNotes || 'Thank you for your business.')}</p>
        </main>
        </body>
      </html>
    `;
  }

  function writeInvoiceDocument(invoiceWindow: Window, invoiceHtml: string, print = true) {
    invoiceWindow.document.open();
    invoiceWindow.document.write(invoiceHtml);
    invoiceWindow.document.close();
    invoiceWindow.focus();
    if (print) {
      window.setTimeout(() => {
        invoiceWindow.print();
      }, 350);
    }
  }

  function openInvoice(invoice: JobInvoice, printableDraft = invoiceDraft, targetWindow?: Window | null, print = true) {
    const invoiceWindow = targetWindow ?? window.open('', '_blank');
    if (!invoiceWindow) return;
    writeInvoiceDocument(invoiceWindow, makeInvoiceHtml(invoice, printableDraft), print);
  }

  function downloadInvoice(invoice: JobInvoice) {
    const blob = new Blob([makeInvoiceHtml(invoice)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${invoice.invoiceNumber}.html`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function createInvoice() {
    const invoiceWindow = window.open('', '_blank');
    if (invoiceWindow) {
      invoiceWindow.document.write('<p style="font-family: Arial, sans-serif; padding: 24px;">Preparing invoice...</p>');
    }
    setInvoiceStatus('Creating invoice...');
    try {
      const currentInvoiceDraft = invoiceDraft;
      const invoice = await onCreateInvoice(draft, materialDrafts, invoiceTotal, currentInvoiceDraft.documentType);
      const nextJob = {
        ...draft,
        invoices: [invoice, ...(draft.invoices ?? [])],
      };
      setDraft(nextJob);
      setSelectedInvoiceIds([invoice.id]);
      setInvoiceEditorOpen(false);
      setInvoiceStatus('Invoice created.');
      openInvoice(invoice, currentInvoiceDraft, invoiceWindow);
    } catch (error) {
      const message = invoiceErrorMessage(error);
      setInvoiceStatus(message);
      if (invoiceWindow) {
        invoiceWindow.document.body.innerHTML = `<p style="font-family: Arial, sans-serif; padding: 24px;">${escapeHtml(message)}</p>`;
      }
    }
  }

  function makeInvoiceEmailBody(items: JobInvoice[]) {
    return [
      `Hello ${draft.clientName || ''},`,
      '',
      `Please find the attached invoice document${items.length > 1 ? 's' : ''} for job ${draft.jobNumber}.`,
      '',
      'Invoice summary:',
      ...items.map((invoice) => `${invoice.invoiceNumber} - ${money(invoice.amount)} - ${invoice.status}`),
      '',
      profile.paymentNotes || 'Please contact us if you have any questions.',
    ].join('\n');
  }

  function makeInvoiceEmailAttachment(invoice: JobInvoice): EmailComposeAttachment {
    const html = makeInvoiceHtml(invoice);
    return {
      id: `invoice-email-${invoice.id}`,
      fileName: `${invoice.invoiceNumber}.html`,
      mimeType: 'text/html',
      sizeBytes: new Blob([html]).size,
      contentBase64: textToBase64(html),
    };
  }

  function composeEmail(subject: string, body: string, attachments: EmailComposeAttachment[] = []) {
    if (!draft.email) {
      setInvoiceStatus('Client email is empty.');
      return;
    }

    if (!onComposeEmail) {
      window.location.href = `mailto:${encodeURIComponent(draft.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      return;
    }

    onComposeEmail(
      {
        to: draft.email,
        subject,
        body,
        jobNumber: draft.jobNumber,
        includeSignature: true,
        includePaymentBlock: attachments.length > 0,
        signatureText: '',
        paymentBlockText: '',
      },
      attachments,
    );
    setInvoiceStatus(attachments.length ? 'Email draft opened with invoice attached.' : 'Email draft opened.');
  }

  function writeToClient() {
    composeEmail(
      `Job ${draft.jobNumber}`,
      [
        `Hello ${draft.clientName || ''},`,
        '',
        `We are contacting you regarding job ${draft.jobNumber}.`,
        '',
        profile.paymentNotes || '',
      ].join('\n'),
    );
  }

  function sendInvoices(items = selectedInvoices.length ? selectedInvoices : invoices) {
    if (!items.length) return;
    composeEmail(`Invoice for job ${draft.jobNumber}`, makeInvoiceEmailBody(items), items.map(makeInvoiceEmailAttachment));
  }

  async function deleteInvoice(invoiceId: string) {
    const previousJob = draft;
    const nextJob = {
      ...draft,
      invoices: invoices.filter((invoice) => invoice.id !== invoiceId),
    };

    setDraft(nextJob);
    setSelectedInvoiceIds((ids) => ids.filter((id) => id !== invoiceId));
    setInvoiceStatus('Deleting invoice...');

    try {
      if (onDeleteInvoice) {
        await onDeleteInvoice(draft, invoiceId);
      } else {
        onSave(nextJob);
      }
      setInvoiceStatus('Invoice removed from this job.');
    } catch (error) {
      setDraft(previousJob);
      setInvoiceStatus(error instanceof Error ? error.message : 'Invoice could not be deleted.');
    }
  }

  function toggleInvoiceSelection(invoiceId: string, checked: boolean) {
    setSelectedInvoiceIds((ids) => (checked ? Array.from(new Set([...ids, invoiceId])) : ids.filter((id) => id !== invoiceId)));
  }

  function toggleAllInvoices(checked: boolean) {
    setSelectedInvoiceIds(checked ? invoices.map((invoice) => invoice.id) : []);
  }

  function refreshInvoices() {
    setDraft(job);
    setSelectedInvoiceIds([]);
    setInvoiceStatus('Invoices refreshed.');
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
              <span>{saved ? 'Saved' : 'No changes'}</span>
              <button className="secondary-button compact" type="button" onClick={writeToClient} disabled={!draft.email}>
                Write to the client
              </button>
            </div>
          </section>

          <section className="job-detail-card invoice-card">
            <div className="invoice-card-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>Invoices (PDF)</h2>
              <div className="invoice-actions" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={allInvoicesSelected} onChange={(event) => toggleAllInvoices(event.target.checked)} disabled={!invoices.length} />
                  Select all
                </label>
                <button className="secondary-button compact" type="button" onClick={() => sendInvoices()} disabled={!selectedInvoices.length || !draft.email}>
                  Send selected
                </button>
                <button className="secondary-button compact" type="button" onClick={refreshInvoices}>
                  Refresh
                </button>
                <button className="primary-button" type="button" onClick={openInvoiceEditor}>
                  + Create invoice
                </button>
              </div>
            </div>

            {invoices.length ? (
              <div className="invoice-list" style={{ display: 'grid', gap: 10, marginTop: 14 }}>
                {invoices.map((invoice) => (
                  <div className="invoice-row" key={invoice.id} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center' }}>
                    <input type="checkbox" checked={selectedInvoiceIds.includes(invoice.id)} onChange={(event) => toggleInvoiceSelection(invoice.id, event.target.checked)} aria-label={`Select ${invoice.invoiceNumber}`} />
                    <div>
                      <strong>{invoice.invoiceNumber}</strong>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>{formatInvoiceTime(invoice.createdAt)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button className="secondary-button compact" type="button" onClick={() => openInvoice(invoice, invoiceDraft, undefined, false)}>
                        Open PDF
                      </button>
                      <button className="secondary-button compact" type="button" onClick={() => downloadInvoice(invoice)}>
                        Download
                      </button>
                      <button className="danger-button compact" type="button" onClick={() => deleteInvoice(invoice.id)}>
                        Delete
                      </button>
                      <button className="primary-button compact" type="button" onClick={() => sendInvoices([invoice])} disabled={!draft.email}>
                        Send email
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p>No invoices for this job yet</p>
            )}
            {invoiceStatus ? <p>{invoiceStatus}</p> : null}
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

      {previewAttachment && previewUrl ? (
        <div className="email-message-modal-backdrop" role="dialog" aria-modal="true" onClick={closeAttachmentPreview}>
          <section className="email-message-modal job-attachment-preview-modal" onClick={(event) => event.stopPropagation()}>
            <div className="email-message-modal-toolbar">
              <div>
                <p className="eyebrow">Attachment preview</p>
                <h2>{previewAttachment.name}</h2>
              </div>
              <button className="secondary-button compact" type="button" onClick={closeAttachmentPreview}>Close</button>
            </div>
            {previewAttachment.kind === 'photo' ? (
              <img className="job-attachment-preview-image" src={previewUrl} alt={previewAttachment.name} />
            ) : (
              <iframe className="job-attachment-preview-frame" src={previewUrl} title={previewAttachment.name} />
            )}
          </section>
        </div>
      ) : null}

      {invoiceEditorOpen ? (
        <div className="email-message-modal-backdrop" role="dialog" aria-modal="true">
          <section className="email-message-modal invoice-editor-modal">
            <div className="invoice-editor-toolbar">
              <button className="primary-button" type="button" onClick={createInvoice}>
                Save and download PDF
              </button>
              <button className="secondary-button compact" type="button" onClick={() => setInvoiceEditorOpen(false)}>
                Close
              </button>
            </div>

            <div className="invoice-paper">
              <div className="invoice-top">
                <div className="invoice-company-block">
                  {profile.logoUrl ? (
                    <img className="invoice-logo-preview" src={profile.logoUrl} alt={`${profile.displayName || profile.legalName} logo`} />
                  ) : (
                    <div className="invoice-logo-preview invoice-logo-placeholder">{(profile.displayName || profile.legalName || 'S').slice(0, 1)}</div>
                  )}
                  <strong>{profile.displayName || profile.legalName || 'Service company'}</strong>
                  <span>{profile.serviceAddress}</span>
                  <span>{profile.phone}</span>
                  <span>{profile.billingEmail}</span>
                  <span>{profile.website}</span>
                </div>

                <div className="invoice-document-head">
                  <label>
                    Document type:
                    <select value={invoiceDraft.documentType} onChange={(event) => setInvoiceDraft((current) => ({ ...current, documentType: event.target.value as JobDocumentType }))}>
                      <option value="Invoice">Invoice</option>
                      <option value="Proposal">Proposal</option>
                      <option value="Estimate">Estimate</option>
                      <option value="Receipt">Receipt</option>
                    </select>
                  </label>
                  <h2>{invoiceDraft.documentType}</h2>
                  <span># {nextInvoiceNumber}</span>
                  <label>
                    Date:
                    <input type="date" value={invoiceDraft.invoiceDate} onChange={(event) => setInvoiceDraft((current) => ({ ...current, invoiceDate: event.target.value }))} />
                  </label>
                  <div className="invoice-balance">
                    <strong>Balance Due:</strong>
                    <label>
                      $
                      <input type="number" min={0} step={1} value={invoiceDraft.balanceDue} onChange={(event) => setInvoiceDraft((current) => ({ ...current, balanceDue: Number(event.target.value) || 0 }))} />
                    </label>
                  </div>
                  <div className="invoice-bill-to">
                    <strong>Bill To</strong>
                    <span>{draft.organization || draft.clientName || 'Customer'}</span>
                    {draft.clientName ? <span>{draft.clientName}</span> : null}
                    {draft.address ? <span>{draft.address}</span> : null}
                    {draft.phone ? <span>{draft.phone}</span> : null}
                    {draft.email ? <span>{draft.email}</span> : null}
                  </div>
                </div>
              </div>

              <div className="invoice-line-table">
                <div className="invoice-line-row invoice-line-head">
                  <span>Type</span>
                  <span>Name</span>
                  <span>Qty</span>
                  <span>Price</span>
                  <span>Amount</span>
                  <span />
                </div>
                {invoiceDraft.lines.map((line) => (
                  <div className="invoice-line-row" key={line.id}>
                    <select value={line.type} onChange={(event) => updateInvoiceLine(line.id, { type: event.target.value as InvoiceLineType })}>
                      <option value="service">service</option>
                      <option value="material">material</option>
                      <option value="other">other</option>
                    </select>
                    <input value={line.name} onChange={(event) => updateInvoiceLine(line.id, { name: event.target.value })} placeholder="Line item" />
                    <input type="number" min={0} step={1} value={line.quantity} onChange={(event) => updateInvoiceLine(line.id, { quantity: Number(event.target.value) || 0 })} />
                    <input type="number" min={0} step={1} value={line.price} onChange={(event) => updateInvoiceLine(line.id, { price: Number(event.target.value) || 0 })} />
                    <strong>{money(invoiceLineAmount(line))}</strong>
                    <button className="remove-line-button" type="button" onClick={() => removeInvoiceLine(line.id)} aria-label="Remove invoice line">
                      x
                    </button>
                  </div>
                ))}
              </div>

              <div className="invoice-editor-lower">
                <button className="secondary-button compact" type="button" onClick={addInvoiceLine}>
                  + Add row
                </button>
                <div className="invoice-total-card">
                  <div>
                    <span>Subtotal:</span>
                    <strong>{money(invoiceSubtotal)}</strong>
                  </div>
                  <label>
                    Discount $
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={invoiceDraft.discount}
                      onChange={(event) => {
                        const discount = Number(event.target.value) || 0;
                        setInvoiceDraft((current) => ({ ...current, discount, balanceDue: invoiceLinesTotal(current.lines, discount) }));
                      }}
                    />
                  </label>
                  <div>
                    <span>Line total:</span>
                    <strong>{money(invoiceComputedTotal)}</strong>
                  </div>
                  <div>
                    <span>Balance due:</span>
                    <strong>{money(invoiceTotal)}</strong>
                  </div>
                </div>
              </div>

              <div className="invoice-warranty-row">
                <label>
                  <input type="checkbox" checked={invoiceDraft.includeWarranty} onChange={(event) => setInvoiceDraft((current) => ({ ...current, includeWarranty: event.target.checked }))} />
                  Include warranty
                </label>
                <label>
                  Days:
                  <input type="number" min={0} step={1} value={invoiceDraft.warrantyDays} onChange={(event) => setInvoiceDraft((current) => ({ ...current, warrantyDays: Number(event.target.value) || 0 }))} />
                </label>
              </div>

              {profile.paymentNotes ? <p className="invoice-payment-notes">{profile.paymentNotes}</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
