import type { Customer, NewCustomerForm, NewServiceJobForm, ServiceJob, ServiceJobStatus } from '../types';
import { sqlEq, supabaseRequest } from './supabaseRest';

type CustomerRow = {
  id: string;
  company_id: string;
  organization: string | null;
  primary_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  notes: string | null;
  created_at: string;
};

type CustomerLocationRow = {
  id: string;
  company_id: string;
  customer_id: string;
  address: string | null;
  created_at: string;
};

type TechnicianRow = {
  id: string;
  name: string;
};

type JobRow = {
  id: string;
  company_id: string;
  customer_id: string | null;
  customer_location_id: string | null;
  technician_id: string | null;
  job_type_id: string | null;
  job_number: string;
  status: ServiceJobStatus;
  system: string | null;
  issue: string | null;
  notes: string | null;
  service_call_fee_cents: number | null;
  labor_cents: number | null;
  created_at: string;
};

type JobPaymentRow = {
  id: string;
  company_id: string;
  job_id: string;
  scope: 'scf' | 'labor' | 'invoice' | 'subscription';
  method: string | null;
  amount_cents: number;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function centsToDollars(cents: number | null | undefined) {
  const dollars = (Number(cents) || 0) / 100;
  return dollars ? String(dollars).replace(/\.00$/, '') : '';
}

function dollarsToCents(value: string) {
  return Math.round((Number(value) || 0) * 100);
}

function mapCustomer(row: CustomerRow, locations: CustomerLocationRow[], jobs: JobRow[]): Customer {
  const customerJobs = jobs.filter((job) => job.customer_id === row.id);
  const latestJob = customerJobs[0];
  const location = locations.find((item) => item.customer_id === row.id);

  return {
    id: row.id,
    companyId: row.company_id,
    organization: row.organization ?? '',
    primaryName: row.primary_name ?? '',
    primaryEmail: row.primary_email ?? '',
    primaryPhone: row.primary_phone ?? '',
    address: location?.address ?? '',
    notes: row.notes ?? '',
    jobsCount: customerJobs.length,
    lastJobAt: latestJob?.created_at?.slice(0, 10) ?? '',
    createdAt: row.created_at?.slice(0, 10) ?? todayIso(),
  };
}

function mapJob(
  row: JobRow,
  customers: CustomerRow[],
  locations: CustomerLocationRow[],
  technicians: TechnicianRow[],
  payments: JobPaymentRow[],
): ServiceJob {
  const customer = customers.find((item) => item.id === row.customer_id);
  const location = locations.find((item) => item.id === row.customer_location_id);
  const technician = technicians.find((item) => item.id === row.technician_id);
  const scfPayment = payments.find((payment) => payment.job_id === row.id && payment.scope === 'scf');
  const laborPayment = payments.find((payment) => payment.job_id === row.id && payment.scope === 'labor');
  const assignee = technician?.name || 'No technician';

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
    scfPayment: scfPayment?.method ?? '',
    labor: centsToDollars(row.labor_cents),
    laborPayment: laborPayment?.method ?? '',
    issue: row.issue ?? '',
    notes: row.notes ?? '',
    attachments: [],
    comments: [],
    createdAt: row.created_at?.slice(0, 10) ?? todayIso(),
  };
}

async function loadCompanyJobTables(companyId: string) {
  const [customers, locations, technicians, jobs, payments] = await Promise.all([
    supabaseRequest<CustomerRow[]>(`customers?company_id=${sqlEq(companyId)}&order=created_at.desc`),
    supabaseRequest<CustomerLocationRow[]>(`customer_locations?company_id=${sqlEq(companyId)}&order=created_at.desc`),
    supabaseRequest<TechnicianRow[]>(`company_technicians?company_id=${sqlEq(companyId)}&select=id,name`),
    supabaseRequest<JobRow[]>(`jobs?company_id=${sqlEq(companyId)}&order=created_at.desc`),
    supabaseRequest<JobPaymentRow[]>(`job_payments?company_id=${sqlEq(companyId)}`),
  ]);

  return { customers, locations, technicians, jobs, payments };
}

export async function listCompanyCustomers(companyId: string): Promise<Customer[]> {
  const tables = await loadCompanyJobTables(companyId);
  return tables.customers.map((customer) => mapCustomer(customer, tables.locations, tables.jobs));
}

export async function listCompanyJobs(companyId: string): Promise<ServiceJob[]> {
  const tables = await loadCompanyJobTables(companyId);
  return tables.jobs.map((job) => mapJob(job, tables.customers, tables.locations, tables.technicians, tables.payments));
}

export async function createCompanyCustomer(companyId: string, form: NewCustomerForm): Promise<Customer> {
  const [customer] = await supabaseRequest<CustomerRow[]>('customers?select=*', {
    method: 'POST',
    select: true,
    body: [{
      company_id: companyId,
      organization: form.organization.trim(),
      primary_name: form.primaryName.trim(),
      primary_email: form.primaryEmail.trim() || null,
      primary_phone: form.primaryPhone.trim(),
      notes: form.notes.trim(),
    }],
  });

  if (form.address.trim()) {
    await supabaseRequest('customer_locations', {
      method: 'POST',
      body: [{
        company_id: companyId,
        customer_id: customer.id,
        address: form.address.trim(),
      }],
    });
  }

  const customers = await listCompanyCustomers(companyId);
  return customers.find((item) => item.id === customer.id) ?? mapCustomer(customer, [], []);
}

async function findOrCreateCustomer(companyId: string, job: ServiceJob) {
  const email = job.email.trim().toLowerCase();
  const phone = job.phone.trim();
  const customerName = job.clientName.trim();
  const organization = job.organization.trim();
  const customers = await supabaseRequest<CustomerRow[]>(`customers?company_id=${sqlEq(companyId)}&order=created_at.desc`);
  const existingCustomer = customers.find((customer) => (
    (email && customer.primary_email?.toLowerCase() === email) ||
    (phone && customer.primary_phone === phone) ||
    (customerName && customer.primary_name?.toLowerCase() === customerName.toLowerCase() && customer.organization?.toLowerCase() === organization.toLowerCase())
  ));

  const customer = existingCustomer ?? (await supabaseRequest<CustomerRow[]>('customers?select=*', {
    method: 'POST',
    select: true,
    body: [{
      company_id: companyId,
      organization,
      primary_name: customerName,
      primary_email: email || null,
      primary_phone: phone,
      notes: '',
    }],
  }))[0];

  let location: CustomerLocationRow | undefined;
  if (job.address.trim()) {
    const locations = await supabaseRequest<CustomerLocationRow[]>(`customer_locations?customer_id=${sqlEq(customer.id)}&order=created_at.desc`);
    location = locations.find((item) => item.address?.trim().toLowerCase() === job.address.trim().toLowerCase());
    if (!location) {
      [location] = await supabaseRequest<CustomerLocationRow[]>('customer_locations?select=*', {
        method: 'POST',
        select: true,
        body: [{
          company_id: companyId,
          customer_id: customer.id,
          address: job.address.trim(),
        }],
      });
    }
  }

  return { customer, location };
}

async function findTechnicianId(companyId: string, technicianName: string) {
  const name = technicianName.trim();
  if (!name || name === 'No technician') return null;

  const rows = await supabaseRequest<TechnicianRow[]>(`company_technicians?company_id=${sqlEq(companyId)}&name=${sqlEq(name)}&select=id,name`);
  return rows[0]?.id ?? null;
}

async function savePayment(companyId: string, jobId: string, scope: 'scf' | 'labor', method: string, amount: string) {
  const existing = await supabaseRequest<JobPaymentRow[]>(`job_payments?company_id=${sqlEq(companyId)}&job_id=${sqlEq(jobId)}&scope=${sqlEq(scope)}`);
  if (!method) {
    if (existing[0]) {
      await supabaseRequest(`job_payments?id=${sqlEq(existing[0].id)}`, { method: 'DELETE' });
    }
    return;
  }

  const body = {
    company_id: companyId,
    job_id: jobId,
    scope,
    method,
    amount_cents: dollarsToCents(amount),
    paid_at: new Date().toISOString(),
  };

  if (existing[0]) {
    await supabaseRequest(`job_payments?id=${sqlEq(existing[0].id)}`, { method: 'PATCH', body });
    return;
  }

  await supabaseRequest('job_payments', { method: 'POST', body: [body] });
}

export async function saveServiceJob(companyId: string, job: ServiceJob): Promise<ServiceJob> {
  const { customer, location } = await findOrCreateCustomer(companyId, job);
  const technicianId = await findTechnicianId(companyId, job.technician || job.assignee);
  const existing = await supabaseRequest<JobRow[]>(`jobs?company_id=${sqlEq(companyId)}&job_number=${sqlEq(job.jobNumber)}&select=id`);
  const body = {
    company_id: companyId,
    customer_id: customer.id,
    customer_location_id: location?.id ?? null,
    technician_id: technicianId,
    job_number: job.jobNumber,
    status: job.status,
    system: job.system,
    issue: job.issue,
    notes: job.notes,
    service_call_fee_cents: dollarsToCents(job.serviceCallFee),
    labor_cents: dollarsToCents(job.labor),
  };

  const [savedJob] = existing[0]
    ? await supabaseRequest<JobRow[]>(`jobs?id=${sqlEq(existing[0].id)}&select=*`, { method: 'PATCH', select: true, body })
    : await supabaseRequest<JobRow[]>('jobs?select=*', { method: 'POST', select: true, body: [body] });

  await Promise.all([
    savePayment(companyId, savedJob.id, 'scf', job.scfPayment, job.serviceCallFee),
    savePayment(companyId, savedJob.id, 'labor', job.laborPayment, job.labor),
  ]);

  const jobs = await listCompanyJobs(companyId);
  return jobs.find((item) => item.id === savedJob.id) ?? job;
}

export async function saveCompanyJobs(companyId: string, companyJobs: ServiceJob[]): Promise<ServiceJob[]> {
  const savedJobs = await Promise.all(companyJobs.map((job) => saveServiceJob(companyId, job)));
  return savedJobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createServiceJob(companyId: string, form: NewServiceJobForm): ServiceJob {
  const assignee = form.technician || 'No technician';

  return {
    id: crypto.randomUUID(),
    companyId,
    ...form,
    status: 'New',
    technician: assignee,
    assignee,
    scfPayment: '',
    labor: '',
    laborPayment: '',
    attachments: [],
    comments: [],
    createdAt: todayIso(),
  };
}
