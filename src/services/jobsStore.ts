import type { NewServiceJobForm, ServiceJob } from '../types';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function listCompanyJobs(companyId: string, defaultTechnicianName: string): ServiceJob[] {
  void companyId;
  void defaultTechnicianName;
  return [];
}

export function saveCompanyJobs(companyId: string, companyJobs: ServiceJob[]) {
  void companyId;
  void companyJobs;
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
