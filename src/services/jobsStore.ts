import type { NewServiceJobForm, ServiceJob } from '../types';

const STORAGE_KEY = 'servicescope.jobs';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function seedJobs(companyId: string, technicianName: string): ServiceJob[] {
  const tech = technicianName || 'No technician';

  return [
    {
      id: 'job-244',
      companyId,
      jobNumber: '244',
      status: 'Diagnosis',
      system: 'Appliance',
      clientName: 'Ilona',
      organization: 'Milk and roses',
      phone: '(908) 259-7395',
      email: 'ilona@example.com',
      technician: 'No technician',
      assignee: 'No technician',
      serviceCallFee: '120',
      scfPayment: '',
      labor: '0',
      laborPayment: '',
      address: '35 Box St, Brooklyn, NY 11222, USA',
      issue: 'Need to clean the part',
      notes: '',
      attachments: [],
      createdAt: '2026-06-11',
    },
    {
      id: 'job-243',
      companyId,
      jobNumber: '243',
      status: 'Diagnosis',
      system: 'Appliance',
      clientName: 'Brat Carr',
      organization: 'FYC Flash NYC',
      phone: '(615) 390-1779',
      email: 'manager@fycflash.com',
      technician: tech,
      assignee: tech,
      serviceCallFee: '120',
      scfPayment: 'cash',
      labor: '420',
      laborPayment: 'zelle',
      address: '44 west 17th street, NY, 10011',
      issue: 'Need to put on the belts on the hood',
      notes: '',
      attachments: [],
      createdAt: '2026-06-11',
    },
    {
      id: 'job-242',
      companyId,
      jobNumber: '242',
      status: 'Diagnosis',
      system: 'Appliance',
      clientName: 'Ricardo',
      organization: 'Optima care castor heal',
      phone: '9204049203',
      email: 'ricardo@example.com',
      technician: tech,
      assignee: tech,
      serviceCallFee: '120',
      scfPayment: 'credit_card',
      labor: '650',
      laborPayment: '',
      address: '615 23rd St, Union City, NJ 07087, USA',
      issue: 'Vegetable Freezer not blowing cold',
      notes: '',
      attachments: [],
      createdAt: '2026-06-10',
    },
    {
      id: 'job-240',
      companyId,
      jobNumber: '240',
      status: 'Diagnosis',
      system: 'Appliance',
      clientName: 'Agarwal Ashish',
      organization: 'EXXON',
      phone: '(201) 920-6141',
      email: '',
      technician: tech,
      assignee: tech,
      serviceCallFee: '120',
      scfPayment: 'cash',
      labor: '380',
      laborPayment: 'cash',
      address: '6040 South Amboy Route 35.',
      issue: 'Ice machine is not working',
      notes: '',
      attachments: [],
      createdAt: '2026-06-09',
    },
    {
      id: 'job-239',
      companyId,
      jobNumber: '239',
      status: 'Diagnosis',
      system: 'Appliance',
      clientName: 'Browne',
      organization: 'The New 42',
      phone: '3472684268',
      email: '',
      technician: tech,
      assignee: tech,
      serviceCallFee: '120',
      scfPayment: '',
      labor: '280',
      laborPayment: 'check',
      address: '209 W 42nd Street New York, New York 10036',
      issue: 'Refrigerator has an issue',
      notes: '',
      attachments: [],
      createdAt: '2026-06-08',
    },
    {
      id: 'job-238',
      companyId,
      jobNumber: '238',
      status: 'Diagnosis',
      system: 'HVAC',
      clientName: 'Margo',
      organization: 'Nursing home',
      phone: '(201) 3211496',
      email: '',
      technician: tech,
      assignee: tech,
      serviceCallFee: '120',
      scfPayment: 'zelle',
      labor: '520',
      laborPayment: 'zelle',
      address: '615 23rd St, Union City, NJ 07087, USA',
      issue: 'AC is not working',
      notes: '',
      attachments: [],
      createdAt: '2026-06-07',
    },
  ];
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

  const seeded = seedJobs(companyId, defaultTechnicianName);
  saveCompanyJobs(companyId, seeded);
  return seeded;
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
    createdAt: todayIso(),
  };
}
