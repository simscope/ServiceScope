import type { NewServiceJobForm, ServiceJob } from '../types';

const STORAGE_KEY = 'servicescope.v2.jobs';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeJob(job: Partial<ServiceJob>): ServiceJob {
  return {
    id: job.id ?? crypto.randomUUID(),
    companyId: job.companyId ?? '',
    jobNumber: job.jobNumber ?? '0',
    status: job.status ?? 'New',
    system: job.system ?? 'General',
    clientName: job.clientName ?? '',
    organization: job.organization ?? '',
    phone: job.phone ?? '',
    email: job.email ?? '',
    address: job.address ?? '',
    technician: job.technician ?? 'No technician',
    assignee: job.assignee ?? job.technician ?? 'No technician',
    serviceCallFee: job.serviceCallFee ?? '0',
    scfPayment: job.scfPayment ?? '',
    labor: job.labor ?? '',
    laborPayment: job.laborPayment ?? '',
    issue: job.issue ?? '',
    notes: job.notes ?? '',
    attachments: job.attachments ?? [],
    comments: job.comments ?? [],
    appointment: job.appointment,
    createdAt: job.createdAt ?? todayIso(),
  };
}

function readJobs(): ServiceJob[] {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return [];

  try {
    return (JSON.parse(saved) as Partial<ServiceJob>[]).map(normalizeJob);
  } catch {
    return [];
  }
}

export function listCompanyJobs(companyId: string, defaultTechnicianName: string) {
  const jobs = readJobs();
  const companyJobs = jobs.filter((job) => job.companyId === companyId);

  if (companyJobs.length) return companyJobs;
  void defaultTechnicianName;
  return [];
}

export function saveCompanyJobs(companyId: string, companyJobs: ServiceJob[]) {
  const otherJobs = readJobs().filter((job) => job.companyId !== companyId);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...otherJobs, ...companyJobs]));
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
