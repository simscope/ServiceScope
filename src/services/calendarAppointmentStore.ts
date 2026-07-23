import type { ServiceJob } from '../types';
import { sqlEq, sqlIn, supabaseRequest } from './supabaseRest';

type AppointmentRow = {
  id: string;
  company_id: string;
  job_id: string;
  technician_id: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
};

type TechnicianRow = {
  id: string;
  name: string;
};

type JobTechnicianRow = {
  id: string;
  job_number: string;
  technician_id: string | null;
};

const APPOINTMENT_BATCH_SIZE = 50;

function chunk<T>(rows: T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < rows.length; index += size) groups.push(rows.slice(index, index + size));
  return groups;
}

function toLocalAppointment(value: string | null | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function durationMinutes(appointment: AppointmentRow) {
  const startsAt = new Date(appointment.starts_at).getTime();
  const endsAt = new Date(appointment.ends_at).getTime();
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) return 120;
  return Math.max(30, Math.min(720, Math.round((endsAt - startsAt) / 60000)));
}

async function listAppointmentsForJobIds(companyId: string, jobIds: string[]) {
  if (!jobIds.length) return [] as AppointmentRow[];
  const batches = await Promise.all(
    chunk(jobIds, APPOINTMENT_BATCH_SIZE).map((ids) =>
      supabaseRequest<AppointmentRow[]>(
        `appointments?company_id=${sqlEq(companyId)}&job_id=${sqlIn(ids)}&select=id,company_id,job_id,technician_id,starts_at,ends_at,timezone&order=starts_at.desc&limit=500`,
      ),
    ),
  );
  return batches.flat();
}

export async function hydrateCalendarAppointments(companyId: string, jobs: ServiceJob[]): Promise<ServiceJob[]> {
  if (!jobs.length) return jobs;

  const jobIds = Array.from(new Set(jobs.map((job) => job.id).filter(Boolean)));
  const [appointments, technicians] = await Promise.all([
    listAppointmentsForJobIds(companyId, jobIds),
    supabaseRequest<TechnicianRow[]>(
      `company_technicians?company_id=${sqlEq(companyId)}&select=id,name&limit=1000`,
    ),
  ]);

  const technicianNameById = new Map(technicians.map((technician) => [technician.id, technician.name]));
  const latestAppointmentByJobId = new Map<string, AppointmentRow>();
  appointments.forEach((appointment) => {
    if (!latestAppointmentByJobId.has(appointment.job_id)) latestAppointmentByJobId.set(appointment.job_id, appointment);
  });

  return jobs.map((job) => {
    const appointment = latestAppointmentByJobId.get(job.id);
    if (!appointment) return job;
    const assignee = appointment.technician_id
      ? technicianNameById.get(appointment.technician_id) || job.assignee || job.technician || 'No technician'
      : job.assignee || job.technician || 'No technician';
    return {
      ...job,
      technician: assignee,
      assignee,
      appointment: toLocalAppointment(appointment.starts_at),
      calendarDurationMinutes: durationMinutes(appointment),
    };
  });
}

async function findTechnician(companyId: string, assignee: string) {
  const cleanName = assignee.trim();
  if (!cleanName || cleanName === 'No technician') return null;
  const rows = await supabaseRequest<TechnicianRow[]>(
    `company_technicians?company_id=${sqlEq(companyId)}&name=${sqlEq(cleanName)}&select=id,name&limit=1`,
  );
  if (!rows[0]) throw new Error(`Technician "${cleanName}" was not found. Refresh technicians and try again.`);
  return rows[0];
}

async function resolvePersistedJob(companyId: string, job: ServiceJob) {
  const byId = job.id
    ? await supabaseRequest<JobTechnicianRow[]>(
        `jobs?company_id=${sqlEq(companyId)}&id=${sqlEq(job.id)}&select=id,job_number,technician_id&limit=1`,
      )
    : [];
  if (byId[0]) return byId[0];
  const byNumber = await supabaseRequest<JobTechnicianRow[]>(
    `jobs?company_id=${sqlEq(companyId)}&job_number=${sqlEq(job.jobNumber)}&select=id,job_number,technician_id&limit=1`,
  );
  if (!byNumber[0]) throw new Error('Job was not found. Refresh the calendar and try again.');
  return byNumber[0];
}

export async function savePersistedCalendarAppointment(
  companyId: string,
  job: ServiceJob,
  assignee: string,
  appointment: string,
  requestedDurationMinutes: number,
): Promise<ServiceJob> {
  const technician = await findTechnician(companyId, assignee);
  const persistedJob = await resolvePersistedJob(companyId, job);
  const startsAt = new Date(appointment);
  if (Number.isNaN(startsAt.getTime())) throw new Error('Appointment time is invalid.');

  const safeDuration = Math.max(30, Math.min(720, Number(requestedDurationMinutes) || 120));
  const body = {
    company_id: companyId,
    job_id: persistedJob.id,
    technician_id: technician?.id ?? null,
    starts_at: startsAt.toISOString(),
    ends_at: new Date(startsAt.getTime() + safeDuration * 60000).toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
  };

  const existing = await supabaseRequest<AppointmentRow[]>(
    `appointments?company_id=${sqlEq(companyId)}&job_id=${sqlEq(persistedJob.id)}&select=id,company_id,job_id,technician_id,starts_at,ends_at,timezone&order=starts_at.desc&limit=1`,
  );
  const savedRows = existing[0]
    ? await supabaseRequest<AppointmentRow[]>(
        `appointments?company_id=${sqlEq(companyId)}&id=${sqlEq(existing[0].id)}&select=*`,
        { method: 'PATCH', select: true, body },
      )
    : await supabaseRequest<AppointmentRow[]>('appointments?select=*', {
        method: 'POST',
        select: true,
        body: [body],
      });

  await supabaseRequest<JobTechnicianRow[]>(
    `jobs?company_id=${sqlEq(companyId)}&id=${sqlEq(persistedJob.id)}&select=id,job_number,technician_id`,
    { method: 'PATCH', select: true, body: { technician_id: technician?.id ?? null } },
  );

  const savedAppointment = savedRows[0];
  if (!savedAppointment) throw new Error('Calendar appointment was not returned after saving.');
  const savedStart = new Date(savedAppointment.starts_at).getTime();
  if (!Number.isFinite(savedStart) || Math.abs(savedStart - startsAt.getTime()) > 60000) {
    throw new Error('Calendar appointment could not be verified after saving.');
  }

  return {
    ...job,
    id: persistedJob.id,
    jobNumber: persistedJob.job_number,
    technician: technician?.name ?? 'No technician',
    assignee: technician?.name ?? 'No technician',
    appointment: toLocalAppointment(savedAppointment.starts_at),
    calendarDurationMinutes: durationMinutes(savedAppointment),
  };
}
