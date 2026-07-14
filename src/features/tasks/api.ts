import type { TaskForm, TaskPriority, TaskRow, TaskStatus } from '../../appTypes';
import type { ServiceJob } from '../../types';
import { sqlEq, supabaseRequest } from '../../services/supabaseRest';

type TaskSource = 'Manual' | 'Auto';

type TaskDbPriority = 'low' | 'normal' | 'urgent';

type TaskRowDb = {
  id: string;
  company_id: string;
  job_id: string | null;
  job_number: string | null;
  assigned_to: string | null;
  title: string;
  notes: string;
  due_at: string | null;
  priority: TaskDbPriority;
  status: TaskStatus;
  source: TaskSource;
  auto_key?: string | null;
  completed_by?: string | null;
  completed_at?: string | null;
  completion_note?: string | null;
  created_at: string;
};

const uiPriorityToDb: Record<TaskPriority, TaskDbPriority> = {
  Low: 'low',
  Normal: 'normal',
  Urgent: 'urgent',
};

const dbPriorityToUi: Record<TaskDbPriority, TaskPriority> = {
  low: 'Low',
  normal: 'Normal',
  urgent: 'Urgent',
};

function rowToTask(row: TaskRowDb, jobsById: Map<string, ServiceJob>): TaskRow {
  const job = row.job_id ? jobsById.get(row.job_id) : undefined;

  return {
    id: row.id,
    title: row.title,
    jobNumber: row.job_number || job?.jobNumber || '',
    assignedTo: row.assigned_to || 'Office',
    dueDate: row.due_at?.slice(0, 10) ?? '',
    priority: dbPriorityToUi[row.priority] ?? 'Normal',
    status: row.status,
    notes: row.notes,
    source: row.source,
    completedBy: row.completed_by ?? undefined,
    completedAt: row.completed_at ?? undefined,
    completionNote: row.completion_note ?? undefined,
  };
}

function findJobId(jobs: ServiceJob[], jobNumber: string) {
  const normalized = jobNumber.trim().toLowerCase();
  if (!normalized) return null;
  return jobs.find((job) => job.jobNumber.trim().toLowerCase() === normalized)?.id ?? null;
}

export async function listManualTasks(companyId: string, jobs: ServiceJob[]) {
  const rows = await supabaseRequest<TaskRowDb[]>(
    `tasks?company_id=${sqlEq(companyId)}&source=${sqlEq('Manual')}&select=*&order=created_at.desc&limit=300`,
  );
  const jobsById = new Map(jobs.map((job) => [job.id, job]));

  return rows.map((row) => rowToTask(row, jobsById));
}

export async function listCompletedAutoTaskKeys(companyId: string) {
  const rows = await supabaseRequest<Array<Pick<TaskRowDb, 'auto_key' | 'status' | 'completed_by' | 'completed_at' | 'completion_note'>>>(
    `tasks?company_id=${sqlEq(companyId)}&source=${sqlEq('Auto')}&status=${sqlEq('Done')}&select=auto_key,completed_by,completed_at,completion_note&limit=500`,
  );
  return rows.flatMap((row) => row.auto_key ? [{
    key: row.auto_key,
    completedBy: row.completed_by ?? undefined,
    completedAt: row.completed_at ?? undefined,
    completionNote: row.completion_note ?? undefined,
  }] : []);
}

export async function createManualTask(companyId: string, form: TaskForm, jobs: ServiceJob[]) {
  const jobNumber = form.jobNumber.trim();
  const rows = await supabaseRequest<TaskRowDb[]>('tasks?select=*', {
    method: 'POST',
    select: true,
    body: [{
      company_id: companyId,
      job_id: findJobId(jobs, jobNumber),
      job_number: jobNumber,
      assigned_to: form.assignedTo.trim() || 'Office',
      title: form.title.trim(),
      notes: form.notes.trim(),
      due_at: form.dueDate ? `${form.dueDate}T12:00:00.000Z` : null,
      priority: uiPriorityToDb[form.priority] ?? 'normal',
      status: 'To do' as TaskStatus,
      source: 'Manual' as TaskSource,
    }],
  });
  const jobsById = new Map(jobs.map((job) => [job.id, job]));

  return rowToTask(rows[0], jobsById);
}

export async function updateManualTaskStatus(companyId: string, taskId: string, status: TaskStatus, jobs: ServiceJob[], completionNote: string, completedBy: string) {
  const rows = await supabaseRequest<TaskRowDb[]>(
    `tasks?company_id=${sqlEq(companyId)}&id=${sqlEq(taskId)}&source=${sqlEq('Manual')}&select=*`,
    {
      method: 'PATCH',
      select: true,
      body: {
        status,
        completed_by: status === 'Done' ? completedBy : null,
        completed_at: status === 'Done' ? new Date().toISOString() : null,
        completion_note: status === 'Done' ? completionNote.trim() : '',
      },
    },
  );
  const jobsById = new Map(jobs.map((job) => [job.id, job]));

  return rowToTask(rows[0], jobsById);
}

export async function saveAutoTaskStatus(companyId: string, task: TaskRow, status: TaskStatus, jobs: ServiceJob[], completionNote: string, completedBy: string) {
  const rows = await supabaseRequest<TaskRowDb[]>(
    'tasks?on_conflict=company_id,auto_key&select=*',
    {
      method: 'POST',
      select: true,
      prefer: 'resolution=merge-duplicates,return=representation',
      body: [{
        company_id: companyId,
        auto_key: task.id,
        job_id: findJobId(jobs, task.jobNumber),
        job_number: task.jobNumber,
        assigned_to: task.assignedTo || 'Office',
        title: task.title,
        notes: task.notes,
        due_at: task.dueDate ? `${task.dueDate}T12:00:00.000Z` : null,
        priority: uiPriorityToDb[task.priority] ?? 'normal',
        status,
        source: 'Auto' as TaskSource,
        completed_by: status === 'Done' ? completedBy : null,
        completed_at: status === 'Done' ? new Date().toISOString() : null,
        completion_note: status === 'Done' ? completionNote.trim() : '',
      }],
    },
  );
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  return rowToTask(rows[0], jobsById);
}
