import type { Customer, JobAttachment, JobComment, JobDocumentType, JobInvoice, JobInvoiceStatus, MaterialRow, NewCustomerForm, NewServiceJobForm, ServiceJob, ServiceJobStatus } from '../types';
import { deleteSupabaseStorageFiles, getSupabasePublicStorageUrl, sqlEq, sqlIn, supabaseRequest, uploadSupabaseStorageFile } from './supabaseRest';

type CustomerRow = { id: string; company_id: string; organization: string | null; primary_name: string | null; primary_email: string | null; primary_phone: string | null; notes: string | null; created_at: string };
type CustomerLocationRow = { id: string; company_id: string; customer_id: string; address: string | null; created_at: string };
type TechnicianRow = { id: string; name: string };
type JobRow = { id: string; company_id: string; customer_id: string | null; customer_location_id: string | null; technician_id: string | null; job_type_id: string | null; job_number: string; status: ServiceJobStatus; system: string | null; issue: string | null; notes: string | null; service_call_fee_cents: number | null; labor_cents: number | null; created_at: string };
type JobPaymentRow = { id: string; company_id: string; job_id: string; scope: 'scf' | 'labor' | 'invoice' | 'subscription'; method: string | null; amount_cents: number };
type JobInvoiceRow = { id: string; company_id: string; job_id: string; invoice_number: string; document_type?: JobDocumentType | null; status: JobInvoiceStatus; amount_cents: number; sent_at: string | null; paid_at: string | null; created_at: string };
type AppointmentRow = { id: string; company_id: string; job_id: string; technician_id: string | null; starts_at: string; ends_at: string; timezone: string };
type JobMaterialRow = { id: string; company_id: string; job_id: string; name: string; quantity: number; unit_price_cents: number; supplier: string; status: MaterialRow['status']; created_at: string };
type JobCommentRow = { id: string; company_id: string; job_id: string; author_user_id: string | null; author_name: string; author_role: string; message: string; created_at: string };
type JobAttachmentRow = { id: string; company_id: string; job_id: string; uploaded_by_user_id: string | null; name: string; mime_type: string; size_bytes: number; kind: JobAttachment['kind']; storage_bucket: string; storage_path: string; created_at: string };

const DEFAULT_LIMIT = 200;
const JOB_FILES_BUCKET = 'job-files';

function todayIso() { return new Date().toISOString().slice(0, 10); }
function centsToDollars(cents: number | null | undefined) { const dollars = (Number(cents) || 0) / 100; return dollars ? String(dollars).replace(/\.00$/, '') : ''; }
function dollarsToCents(value: string) { return Math.round((Number(value) || 0) * 100); }
function toMoneyNumber(cents: number | null | undefined) { return (Number(cents) || 0) / 100; }

function toLocalAppointment(value: string | null | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function appointmentDurationMinutes(appointment?: AppointmentRow) {
  if (!appointment) return undefined;
  const start = new Date(appointment.starts_at).getTime();
  const end = new Date(appointment.ends_at).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.round((end - start) / 60000) : undefined;
}

function commentRole(role: string): JobComment['authorRole'] { return role === 'Manager' || role === 'Technician' ? role : 'Admin'; }
function mapComment(row: JobCommentRow): JobComment { return { id: row.id, authorName: row.author_name, authorRole: commentRole(row.author_role), message: row.message, createdAt: row.created_at }; }
function mapAttachment(row: JobAttachmentRow): JobAttachment { return { id: row.id, name: row.name, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes) || 0, kind: row.kind, uploadedAt: row.created_at, storageBucket: row.storage_bucket, storagePath: row.storage_path, dataUrl: getSupabasePublicStorageUrl(row.storage_bucket, row.storage_path) }; }
function mapInvoice(row: JobInvoiceRow): JobInvoice { return { id: row.id, companyId: row.company_id, jobId: row.job_id, invoiceNumber: row.invoice_number, documentType: row.document_type ?? 'Invoice', status: row.status, amount: toMoneyNumber(row.amount_cents), createdAt: row.created_at?.slice(0, 10) ?? todayIso(), sentAt: row.sent_at?.slice(0, 10) ?? '', paidAt: row.paid_at?.slice(0, 10) ?? '' }; }
function mapMaterial(row: JobMaterialRow, jobNumber: string): MaterialRow { return { id: row.id, jobNumber, name: row.name ?? '', quantity: Number(row.quantity) || 1, price: toMoneyNumber(row.unit_price_cents), supplier: row.supplier ?? '', status: row.status ?? 'Needed' }; }

function mapCustomer(row: CustomerRow, locations: CustomerLocationRow[], jobs: JobRow[]): Customer {
  const customerJobs = jobs.filter((job) => job.customer_id === row.id);
  const latestJob = customerJobs[0];
  const location = locations.find((item) => item.customer_id === row.id);
  return { id: row.id, companyId: row.company_id, organization: row.organization ?? '', primaryName: row.primary_name ?? '', primaryEmail: row.primary_email ?? '', primaryPhone: row.primary_phone ?? '', address: location?.address ?? '', notes: row.notes ?? '', jobsCount: customerJobs.length, lastJobAt: latestJob?.created_at?.slice(0, 10) ?? '', createdAt: row.created_at?.slice(0, 10) ?? todayIso() };
}

function mapJob(row: JobRow, customers: CustomerRow[], locations: CustomerLocationRow[], technicians: TechnicianRow[], payments: JobPaymentRow[], invoices: JobInvoiceRow[], appointments: AppointmentRow[] = [], comments: JobCommentRow[] = [], attachments: JobAttachmentRow[] = []): ServiceJob {
  const customer = customers.find((item) => item.id === row.customer_id);
  const location = locations.find((item) => item.id === row.customer_location_id);
  const technician = technicians.find((item) => item.id === row.technician_id);
  const appointment = appointments.find((item) => item.job_id === row.id);
  const appointmentTechnician = technicians.find((item) => item.id === appointment?.technician_id);
  const assignee = appointmentTechnician?.name || technician?.name || 'No technician';
  return {
    id: row.id,
    companyId: row.company_id,
    jobNumber: row.job_number,
    status: row.status,
    system: row.system ?? '',
    clientName: customer?.primary_name ?? '',
    organization: customer?.organization ?? '',
    phone: customer?.primary_phone ?? '',
    email: customer?.primary_email ?? '',
    address: location?.address ?? '',
    technician: assignee,
    assignee,
    serviceCallFee: centsToDollars(row.service_call_fee_cents),
    scfPayment: payments.find((payment) => payment.job_id === row.id && payment.scope === 'scf')?.method ?? '',
    labor: centsToDollars(row.labor_cents),
    laborPayment: payments.find((payment) => payment.job_id === row.id && payment.scope === 'labor')?.method ?? '',
    issue: row.issue ?? '',
    notes: row.notes ?? '',
    attachments: attachments.filter((item) => item.job_id === row.id).map(mapAttachment),
    comments: comments.filter((item) => item.job_id === row.id).map(mapComment),
    invoices: invoices.filter((item) => item.job_id === row.id).map(mapInvoice),
    appointment: toLocalAppointment(appointment?.starts_at),
    calendarDurationMinutes: appointmentDurationMinutes(appointment),
    createdAt: row.created_at?.slice(0, 10) ?? todayIso(),
  };
}

async function loadSingleJob(companyId: string, jobId: string) {
  const [jobs, customers, locations, technicians, payments, invoices, appointments, comments, attachments] = await Promise.all([
    supabaseRequest<JobRow[]>(`jobs?company_id=${sqlEq(companyId)}&id=${sqlEq(jobId)}&limit=1`),
    supabaseRequest<CustomerRow[]>(`customers?company_id=${sqlEq(companyId)}&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<CustomerLocationRow[]>(`customer_locations?company_id=${sqlEq(companyId)}&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<TechnicianRow[]>(`company_technicians?company_id=${sqlEq(companyId)}&select=id,name&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<JobPaymentRow[]>(`job_payments?company_id=${sqlEq(companyId)}&job_id=${sqlEq(jobId)}&limit=10`),
    supabaseRequest<JobInvoiceRow[]>(`job_invoices?company_id=${sqlEq(companyId)}&job_id=${sqlEq(jobId)}&order=created_at.desc&limit=20`),
    supabaseRequest<AppointmentRow[]>(`appointments?company_id=${sqlEq(companyId)}&job_id=${sqlEq(jobId)}&order=starts_at.asc&limit=1`),
    supabaseRequest<JobCommentRow[]>(`job_comments?company_id=${sqlEq(companyId)}&job_id=${sqlEq(jobId)}&order=created_at.asc&limit=200`),
    supabaseRequest<JobAttachmentRow[]>(`job_attachments?company_id=${sqlEq(companyId)}&job_id=${sqlEq(jobId)}&order=created_at.asc&limit=200`),
  ]);
  return jobs[0] ? mapJob(jobs[0], customers, locations, technicians, payments, invoices, appointments, comments, attachments) : null;
}

export async function listCompanyCustomers(companyId: string): Promise<Customer[]> {
  const [customers, locations, jobs] = await Promise.all([
    supabaseRequest<CustomerRow[]>(`customers?company_id=${sqlEq(companyId)}&order=created_at.desc&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<CustomerLocationRow[]>(`customer_locations?company_id=${sqlEq(companyId)}&order=created_at.desc&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<JobRow[]>(`jobs?company_id=${sqlEq(companyId)}&order=created_at.desc&select=id,company_id,customer_id,customer_location_id,technician_id,job_type_id,job_number,status,system,issue,notes,service_call_fee_cents,labor_cents,created_at&limit=${DEFAULT_LIMIT}`),
  ]);
  return customers.map((customer) => mapCustomer(customer, locations, jobs));
}

export async function listCompanyJobs(companyId: string): Promise<ServiceJob[]> {
  const [customers, locations, technicians, jobs, payments, invoices, appointments, comments, attachments] = await Promise.all([
    supabaseRequest<CustomerRow[]>(`customers?company_id=${sqlEq(companyId)}&order=created_at.desc&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<CustomerLocationRow[]>(`customer_locations?company_id=${sqlEq(companyId)}&order=created_at.desc&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<TechnicianRow[]>(`company_technicians?company_id=${sqlEq(companyId)}&select=id,name&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<JobRow[]>(`jobs?company_id=${sqlEq(companyId)}&order=created_at.desc&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<JobPaymentRow[]>(`job_payments?company_id=${sqlEq(companyId)}&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<JobInvoiceRow[]>(`job_invoices?company_id=${sqlEq(companyId)}&order=created_at.desc&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<AppointmentRow[]>(`appointments?company_id=${sqlEq(companyId)}&order=starts_at.asc&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<JobCommentRow[]>(`job_comments?company_id=${sqlEq(companyId)}&order=created_at.asc&limit=1000`),
    supabaseRequest<JobAttachmentRow[]>(`job_attachments?company_id=${sqlEq(companyId)}&order=created_at.asc&limit=1000`),
  ]);
  return jobs.map((job) => mapJob(job, customers, locations, technicians, payments, invoices, appointments, comments, attachments));
}

export async function listCompanyJobMaterials(companyId: string): Promise<MaterialRow[]> {
  const [jobs, materials] = await Promise.all([
    supabaseRequest<Pick<JobRow, 'id' | 'job_number'>[]>(`jobs?company_id=${sqlEq(companyId)}&select=id,job_number&limit=${DEFAULT_LIMIT}`),
    supabaseRequest<JobMaterialRow[]>(`job_materials?company_id=${sqlEq(companyId)}&order=created_at.asc&limit=${DEFAULT_LIMIT}`),
  ]);
  const jobNumberById = new Map(jobs.map((job) => [job.id, job.job_number]));
  return materials.map((material) => {
    const jobNumber = jobNumberById.get(material.job_id);
    return jobNumber ? mapMaterial(material, jobNumber) : null;
  }).filter((row): row is MaterialRow => Boolean(row));
}

export async function createCompanyCustomer(companyId: string, form: NewCustomerForm): Promise<Customer> {
  const [customer] = await supabaseRequest<CustomerRow[]>('customers?select=*', { method: 'POST', select: true, body: [{ company_id: companyId, organization: form.organization.trim(), primary_name: form.primaryName.trim(), primary_email: form.primaryEmail.trim() || null, primary_phone: form.primaryPhone.trim(), notes: form.notes.trim() }] });
  let location: CustomerLocationRow | undefined;
  if (form.address.trim()) {
    [location] = await supabaseRequest<CustomerLocationRow[]>('customer_locations?select=*', { method: 'POST', select: true, body: [{ company_id: companyId, customer_id: customer.id, address: form.address.trim() }] });
  }
  return mapCustomer(customer, location ? [location] : [], []);
}

async function findExistingJob(companyId: string, job: ServiceJob) {
  if (job.id) {
    const byId = await supabaseRequest<Pick<JobRow, 'id' | 'customer_id'>[]>(`jobs?company_id=${sqlEq(companyId)}&id=${sqlEq(job.id)}&select=id,customer_id&limit=1`);
    if (byId[0]) return byId[0];
  }
  const byNumber = await supabaseRequest<Pick<JobRow, 'id' | 'customer_id'>[]>(`jobs?company_id=${sqlEq(companyId)}&job_number=${sqlEq(job.jobNumber)}&select=id,customer_id&limit=1`);
  return byNumber[0];
}

async function findOrCreateCustomer(companyId: string, job: ServiceJob, preferredCustomerId?: string | null) {
  const customers = await supabaseRequest<CustomerRow[]>(`customers?company_id=${sqlEq(companyId)}&order=created_at.desc&limit=${DEFAULT_LIMIT}`);
  const email = job.email.trim().toLowerCase();
  const phone = job.phone.trim();
  const name = job.clientName.trim();
  const organization = job.organization.trim();
  const existing = (preferredCustomerId ? customers.find((customer) => customer.id === preferredCustomerId) : undefined) ?? customers.find((customer) => (email && customer.primary_email?.toLowerCase() === email) || (phone && customer.primary_phone === phone) || (name && customer.primary_name?.toLowerCase() === name.toLowerCase() && customer.organization?.toLowerCase() === organization.toLowerCase()));
  const body = { company_id: companyId, organization, primary_name: name, primary_email: email || null, primary_phone: phone, notes: existing?.notes ?? '' };
  const customer = existing
    ? (await supabaseRequest<CustomerRow[]>(`customers?id=${sqlEq(existing.id)}&select=*`, { method: 'PATCH', select: true, body }))[0]
    : (await supabaseRequest<CustomerRow[]>('customers?select=*', { method: 'POST', select: true, body: [body] }))[0];
  let location: CustomerLocationRow | undefined;
  if (job.address.trim()) {
    const locations = await supabaseRequest<CustomerLocationRow[]>(`customer_locations?customer_id=${sqlEq(customer.id)}&order=created_at.desc&limit=50`);
    location = locations.find((item) => item.address?.trim().toLowerCase() === job.address.trim().toLowerCase());
    if (!location) [location] = await supabaseRequest<CustomerLocationRow[]>('customer_locations?select=*', { method: 'POST', select: true, body: [{ company_id: companyId, customer_id: customer.id, address: job.address.trim() }] });
  }
  return { customer, location };
}

async function findTechnicianId(companyId: string, technicianName: string) {
  const name = technicianName.trim();
  if (!name || name === 'No technician') return null;
  const rows = await supabaseRequest<TechnicianRow[]>(`company_technicians?company_id=${sqlEq(companyId)}&name=${sqlEq(name)}&select=id,name&limit=1`);
  return rows[0]?.id ?? null;
}

async function savePayment(companyId: string, jobId: string, scope: 'scf' | 'labor', method: string, amount: string) {
  const existing = await supabaseRequest<JobPaymentRow[]>(`job_payments?company_id=${sqlEq(companyId)}&job_id=${sqlEq(jobId)}&scope=${sqlEq(scope)}&limit=1`);
  if (!method) {
    if (existing[0]) await supabaseRequest(`job_payments?id=${sqlEq(existing[0].id)}`, { method: 'DELETE' });
    return;
  }
  const body = { company_id: companyId, job_id: jobId, scope, method, amount_cents: dollarsToCents(amount), paid_at: new Date().toISOString() };
  if (existing[0]) await supabaseRequest(`job_payments?id=${sqlEq(existing[0].id)}`, { method: 'PATCH', body });
  else await supabaseRequest('job_payments', { method: 'POST', body: [body] });
}

async function syncAppointment(companyId: string, job: ServiceJob, technicianId: string | null) {
  const existing = await supabaseRequest<AppointmentRow[]>(`appointments?company_id=${sqlEq(companyId)}&job_id=${sqlEq(job.id)}&select=id&limit=1`);
  if (!job.appointment) {
    if (existing[0]) await supabaseRequest(`appointments?id=${sqlEq(existing[0].id)}`, { method: 'DELETE' });
    return;
  }
  const startsAt = new Date(job.appointment);
  if (Number.isNaN(startsAt.getTime())) throw new Error('Appointment time is invalid.');
  const duration = Math.max(30, Math.min(720, Number(job.calendarDurationMinutes) || 120));
  const body = { company_id: companyId, job_id: job.id, technician_id: technicianId, starts_at: startsAt.toISOString(), ends_at: new Date(startsAt.getTime() + duration * 60000).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York' };
  if (existing[0]) await supabaseRequest(`appointments?id=${sqlEq(existing[0].id)}`, { method: 'PATCH', body });
  else await supabaseRequest('appointments', { method: 'POST', body: [body] });
}

async function syncComments(companyId: string, job: ServiceJob) {
  await supabaseRequest(`job_comments?company_id=${sqlEq(companyId)}&job_id=${sqlEq(job.id)}`, { method: 'DELETE' });
  const rows = (job.comments ?? []).filter((comment) => comment.message.trim()).map((comment) => ({ id: comment.id, company_id: companyId, job_id: job.id, author_name: comment.authorName || 'User', author_role: comment.authorRole || 'Admin', message: comment.message.trim(), created_at: comment.createdAt || new Date().toISOString() }));
  if (rows.length) await supabaseRequest<JobCommentRow[]>('job_comments?select=*', { method: 'POST', select: true, body: rows });
}

function safeFileName(name: string) { return name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'file'; }
function dataUrlToBlob(dataUrl: string) { const [header, base64] = dataUrl.split(','); const mime = header.match(/data:([^;]+)/)?.[1] ?? 'application/octet-stream'; const bytes = Uint8Array.from(atob(base64 ?? ''), (char) => char.charCodeAt(0)); return new Blob([bytes], { type: mime }); }

async function syncAttachments(companyId: string, job: ServiceJob) {
  const existingAttachments = await supabaseRequest<Pick<JobAttachmentRow, 'storage_bucket' | 'storage_path'>[]>(
    `job_attachments?company_id=${sqlEq(companyId)}&job_id=${sqlEq(job.id)}&select=storage_bucket,storage_path&limit=1000`,
  );
  const retainedStorageKeys = new Set(
    (job.attachments ?? [])
      .filter((attachment) => attachment.storageBucket && attachment.storagePath)
      .map((attachment) => `${attachment.storageBucket}/${attachment.storagePath}`),
  );
  const removedStorageByBucket = existingAttachments.reduce((acc, attachment) => {
    if (!attachment.storage_bucket || !attachment.storage_path) return acc;
    if (retainedStorageKeys.has(`${attachment.storage_bucket}/${attachment.storage_path}`)) return acc;

    const paths = acc.get(attachment.storage_bucket) ?? [];
    paths.push(attachment.storage_path);
    acc.set(attachment.storage_bucket, paths);
    return acc;
  }, new Map<string, string[]>());

  for (const [bucket, paths] of removedStorageByBucket) {
    await deleteSupabaseStorageFiles(bucket, paths);
  }

  await supabaseRequest(`job_attachments?company_id=${sqlEq(companyId)}&job_id=${sqlEq(job.id)}`, { method: 'DELETE' });
  const rows: Omit<JobAttachmentRow, 'created_at' | 'uploaded_by_user_id'>[] = [];
  for (const attachment of job.attachments ?? []) {
    let storagePath = attachment.storagePath ?? '';
    const bucket = attachment.storageBucket || JOB_FILES_BUCKET;
    if (!storagePath && (attachment.file || attachment.dataUrl)) {
      const blob = attachment.file ?? dataUrlToBlob(attachment.dataUrl ?? '');
      storagePath = `${companyId}/${job.id}/${attachment.id}-${safeFileName(attachment.name)}`;
      await uploadSupabaseStorageFile(bucket, storagePath, blob, attachment.mimeType || blob.type || 'application/octet-stream');
    }
    if (storagePath) rows.push({ id: attachment.id, company_id: companyId, job_id: job.id, name: attachment.name || 'File', mime_type: attachment.mimeType || 'application/octet-stream', size_bytes: Number(attachment.sizeBytes) || 0, kind: attachment.kind || 'file', storage_bucket: bucket, storage_path: storagePath });
  }
  if (rows.length) await supabaseRequest<JobAttachmentRow[]>('job_attachments?select=*', { method: 'POST', select: true, body: rows });
}

export async function saveServiceJob(companyId: string, job: ServiceJob): Promise<ServiceJob> {
  const existing = await findExistingJob(companyId, job);
  const { customer, location } = await findOrCreateCustomer(companyId, job, existing?.customer_id);
  const technicianId = await findTechnicianId(companyId, job.technician || job.assignee);
  const body = { company_id: companyId, customer_id: customer.id, customer_location_id: location?.id ?? null, technician_id: technicianId, job_number: job.jobNumber, status: job.status, system: job.system, issue: job.issue, notes: job.notes, service_call_fee_cents: dollarsToCents(job.serviceCallFee), labor_cents: dollarsToCents(job.labor) };
  const [savedJob] = existing
    ? await supabaseRequest<JobRow[]>(`jobs?id=${sqlEq(existing.id)}&select=*`, { method: 'PATCH', select: true, body })
    : await supabaseRequest<JobRow[]>('jobs?select=*', { method: 'POST', select: true, body: [body] });
  const persistedJob = { ...job, id: savedJob.id, companyId: savedJob.company_id, technician: job.technician || job.assignee || 'No technician', assignee: job.assignee || job.technician || 'No technician' };
  await Promise.all([
    savePayment(companyId, savedJob.id, 'scf', job.scfPayment, job.serviceCallFee),
    savePayment(companyId, savedJob.id, 'labor', job.laborPayment, job.labor),
    syncAppointment(companyId, persistedJob, technicianId),
    syncComments(companyId, persistedJob),
    syncAttachments(companyId, persistedJob),
  ]);
  return (await loadSingleJob(companyId, savedJob.id)) ?? mapJob(savedJob, [customer], location ? [location] : [], [], [], []);
}

export async function saveJobAppointment(companyId: string, job: ServiceJob, appointment: string, durationMinutes: number): Promise<ServiceJob> {
  const technicianId = await findTechnicianId(companyId, job.technician || job.assignee);
  await syncAppointment(companyId, { ...job, appointment, calendarDurationMinutes: durationMinutes }, technicianId);
  return (await loadSingleJob(companyId, job.id)) ?? { ...job, appointment, calendarDurationMinutes: Math.max(30, Math.min(720, Number(durationMinutes) || 120)) };
}

async function resolveMaterialJob(companyId: string, jobOrJobNumber: ServiceJob | string, rows: MaterialRow[]) {
  if (typeof jobOrJobNumber !== 'string') {
    const byId = await supabaseRequest<Pick<JobRow, 'id' | 'job_number'>[]>(`jobs?company_id=${sqlEq(companyId)}&id=${sqlEq(jobOrJobNumber.id)}&select=id,job_number&limit=1`);
    if (byId[0]) return byId[0];
  }
  const numbers = Array.from(new Set([typeof jobOrJobNumber === 'string' ? jobOrJobNumber : jobOrJobNumber.jobNumber, ...rows.map((row) => row.jobNumber)].map((item) => item.trim()).filter(Boolean)));
  for (const jobNumber of numbers) {
    const byNumber = await supabaseRequest<Pick<JobRow, 'id' | 'job_number'>[]>(`jobs?company_id=${sqlEq(companyId)}&job_number=${sqlEq(jobNumber)}&select=id,job_number&limit=1`);
    if (byNumber[0]) return byNumber[0];
  }
  const materialIds = rows.map((row) => row.id).filter(Boolean);
  if (materialIds.length) {
    const materialRows = await supabaseRequest<Pick<JobMaterialRow, 'job_id'>[]>(`job_materials?company_id=${sqlEq(companyId)}&id=${sqlIn(materialIds)}&select=job_id&limit=1`);
    if (materialRows[0]?.job_id) {
      const byMaterial = await supabaseRequest<Pick<JobRow, 'id' | 'job_number'>[]>(`jobs?company_id=${sqlEq(companyId)}&id=${sqlEq(materialRows[0].job_id)}&select=id,job_number&limit=1`);
      if (byMaterial[0]) return byMaterial[0];
    }
  }
  return null;
}

export async function saveJobMaterials(companyId: string, jobOrJobNumber: ServiceJob | string, rows: MaterialRow[]): Promise<MaterialRow[]> {
  const job = await resolveMaterialJob(companyId, jobOrJobNumber, rows);
  if (!job) throw new Error('Job was not found. Save the job first, then save materials again.');
  await supabaseRequest(`job_materials?company_id=${sqlEq(companyId)}&job_id=${sqlEq(job.id)}`, { method: 'DELETE' });
  const cleanRows = rows.filter((row) => row.name.trim() || row.supplier.trim()).map((row) => ({ id: row.id, company_id: companyId, job_id: job.id, name: row.name.trim(), quantity: Math.max(1, Number(row.quantity) || 1), unit_price_cents: dollarsToCents(String(Math.max(0, Number(row.price) || 0))), supplier: row.supplier.trim(), status: row.status }));
  if (cleanRows.length) await supabaseRequest<JobMaterialRow[]>('job_materials?select=*', { method: 'POST', select: true, body: cleanRows });
  return listCompanyJobMaterials(companyId);
}

export async function saveCompanyJobs(companyId: string, companyJobs: ServiceJob[]): Promise<ServiceJob[]> {
  const savedJobs: ServiceJob[] = [];
  for (const job of companyJobs) savedJobs.push(await saveServiceJob(companyId, job));
  return savedJobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function nextInvoiceNumber(jobNumber: string, existingInvoiceNumbers: string[]) {
  const prefix = `INV-${jobNumber}-`;
  const nextIndex = existingInvoiceNumbers.reduce((maxIndex, invoiceNumber) => {
    if (!invoiceNumber.startsWith(prefix)) return maxIndex;
    const suffix = Number.parseInt(invoiceNumber.slice(prefix.length), 10);
    return Number.isFinite(suffix) ? Math.max(maxIndex, suffix) : maxIndex;
  }, 0) + 1;
  return `INV-${jobNumber}-${String(nextIndex).padStart(2, '0')}`;
}

async function loadExistingInvoiceNumbers(companyId: string, job: ServiceJob) {
  const rows = await supabaseRequest<Pick<JobInvoiceRow, 'invoice_number'>[]>(`job_invoices?company_id=${sqlEq(companyId)}&select=invoice_number&limit=1000`);
  return [...new Set([...(job.invoices ?? []).map((invoice) => invoice.invoiceNumber), ...rows.map((invoice) => invoice.invoice_number)])];
}

function invoiceTotal(job: ServiceJob, materials: MaterialRow[]) {
  const materialTotal = materials.reduce((sum, material) => sum + (Number(material.price) || 0) * (Number(material.quantity) || 0), 0);
  return Math.max(0, Number(job.serviceCallFee || 0) + Number(job.labor || 0) + materialTotal);
}

export async function createJobInvoice(companyId: string, job: ServiceJob, materials: MaterialRow[], amountOverride?: number, documentType: JobDocumentType = 'Invoice'): Promise<JobInvoice> {
  const amount = Math.max(0, Number(amountOverride ?? invoiceTotal(job, materials)) || 0);
  const skipped: string[] = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const invoiceNumber = nextInvoiceNumber(job.jobNumber, [...(await loadExistingInvoiceNumbers(companyId, job)), ...skipped]);
    try {
      const [invoice] = await supabaseRequest<JobInvoiceRow[]>('job_invoices?select=*', { method: 'POST', select: true, body: [{ company_id: companyId, job_id: job.id, invoice_number: invoiceNumber, document_type: documentType, status: 'open', amount_cents: dollarsToCents(String(amount)) }] });
      return mapInvoice(invoice);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('23505') && !message.includes('duplicate key')) throw error;
      skipped.push(invoiceNumber);
    }
  }
  throw new Error('Invoice number is already used. Reload jobs and try again.');
}

export async function deleteJobInvoice(companyId: string, jobId: string, invoiceId: string): Promise<void> {
  await supabaseRequest<void>(`job_invoices?company_id=${sqlEq(companyId)}&job_id=${sqlEq(jobId)}&id=${sqlEq(invoiceId)}`, { method: 'DELETE' });
}

export function createServiceJob(companyId: string, form: NewServiceJobForm): ServiceJob {
  const assignee = form.technician || 'No technician';
  return { id: crypto.randomUUID(), companyId, ...form, status: 'New', technician: assignee, assignee, scfPayment: '', labor: '', laborPayment: '', attachments: [], comments: [], invoices: [], createdAt: todayIso() };
}
