import type { FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { JobDetailPanel } from '../JobDetailPanel';
import type { JobCardData } from '../JobCard';
import type { EmailCompose, EmailComposeAttachment, TaskForm, TaskPriority, TaskRow, TaskStatus, TaskStatusFilter } from '../../appTypes';
import type { CompanyOnboardingProfile, CompanyPaymentMethod, JobDocumentType, JobInvoice, MaterialRow, ServiceJob } from '../../types';
import { statusClassName } from '../../utils/format';

export function TasksPage({
  openedJob,
  profile,
  paymentMethodOptions,
  materials,
  currentPortalUser,
  onCloseJob,
  onSaveJob,
  onSaveMaterials,
  onCreateInvoice,
  onDeleteInvoice,
  onComposeEmail,
  openTaskCount,
  autoTaskCount,
  urgentTaskCount,
  taskForm,
  onTaskFormChange,
  onCreateManualTask,
  allJobsRows,
  taskAssignees,
  taskStatusFilter,
  onTaskStatusFilterChange,
  taskOwnerFilter,
  onTaskOwnerFilterChange,
  taskSearch,
  onTaskSearchChange,
  onResetFilters,
  filteredTaskRows,
  jobMap,
  onOpenJob,
  onUpdateTaskStatus,
}: {
  openedJob: JobCardData | null;
  profile: CompanyOnboardingProfile;
  paymentMethodOptions: { value: CompanyPaymentMethod; label: string }[];
  materials: MaterialRow[];
  currentPortalUser: { name: string; role: 'Manager' | 'Admin' | 'Technician' };
  onCloseJob: () => void;
  onSaveJob: (job: JobCardData) => void;
  onSaveMaterials: (jobOrJobNumber: JobCardData | string, rows: MaterialRow[]) => void | Promise<void>;
  onCreateInvoice: (job: JobCardData, materials: MaterialRow[], amount: number, documentType: JobDocumentType) => Promise<JobInvoice>;
  onDeleteInvoice: (job: JobCardData, invoiceId: string) => Promise<void>;
  onComposeEmail: (compose: EmailCompose, attachments?: EmailComposeAttachment[]) => void;
  openTaskCount: number;
  autoTaskCount: number;
  urgentTaskCount: number;
  taskForm: TaskForm;
  onTaskFormChange: (form: TaskForm) => void;
  onCreateManualTask: (event: FormEvent<HTMLFormElement>) => void;
  allJobsRows: ServiceJob[];
  taskAssignees: string[];
  taskStatusFilter: TaskStatusFilter;
  onTaskStatusFilterChange: (status: TaskStatusFilter) => void;
  taskOwnerFilter: string;
  onTaskOwnerFilterChange: (owner: string) => void;
  taskSearch: string;
  onTaskSearchChange: (value: string) => void;
  onResetFilters: () => void;
  filteredTaskRows: TaskRow[];
  jobMap: Map<string, ServiceJob>;
  onOpenJob: (job: ServiceJob) => void;
  onUpdateTaskStatus: (task: TaskRow, status: TaskStatus, completionNote?: string) => void;
}) {
  const [completionTask, setCompletionTask] = useState<TaskRow | null>(null);
  const [completionNote, setCompletionNote] = useState('');

  const requestCompletion = (task: TaskRow) => {
    setCompletionTask(task);
    setCompletionNote('');
  };

  const saveCompletion = () => {
    if (!completionTask) return;
    onUpdateTaskStatus(completionTask, 'Done', completionNote);
    setCompletionTask(null);
    setCompletionNote('');
  };

  if (openedJob) {
    return (
      <section className="tasks-page">
        <JobDetailPanel
          job={openedJob}
          technicians={profile.technicians.map((technician) => technician.name)}
          systems={profile.jobTypes.map((jobType) => jobType.name)}
          paymentMethods={paymentMethodOptions}
          materials={materials.filter((material) => material.jobNumber === openedJob.jobNumber)}
          profile={profile}
          currentUser={currentPortalUser}
          onClose={onCloseJob}
          onSave={onSaveJob}
          onSaveMaterials={onSaveMaterials}
          onCreateInvoice={onCreateInvoice}
          onDeleteInvoice={onDeleteInvoice}
          onComposeEmail={onComposeEmail}
        />
      </section>
    );
  }

  return (
    <section className="tasks-page">
      <div className="tasks-header">
        <div>
          <p className="eyebrow">Follow-up control</p>
          <h1>Tasks</h1>
        </div>
        <div className="tasks-summary">
          <span>
            <strong>{openTaskCount}</strong>
            Open tasks
          </span>
          <span>
            <strong>{autoTaskCount}</strong>
            Auto-generated
          </span>
          <span>
            <strong>{urgentTaskCount}</strong>
            Urgent
          </span>
        </div>
      </div>

      <form className="task-create-bar" onSubmit={onCreateManualTask}>
        <label>
          Task
          <input value={taskForm.title} onChange={(event) => onTaskFormChange({ ...taskForm, title: event.target.value })} placeholder="Call customer, order part, send estimate" />
        </label>
        <label>
          Related job
          <select value={taskForm.jobNumber} onChange={(event) => onTaskFormChange({ ...taskForm, jobNumber: event.target.value })}>
            <option value="">No job</option>
            {allJobsRows.map((job) => (
              <option value={job.jobNumber} key={job.jobNumber}>
                #{job.jobNumber} - {job.organization}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assigned to
          <select value={taskForm.assignedTo} onChange={(event) => onTaskFormChange({ ...taskForm, assignedTo: event.target.value })}>
            <option value="">Office</option>
            {taskAssignees.map((assignee) => (
              <option value={assignee} key={assignee}>
                {assignee}
              </option>
            ))}
          </select>
        </label>
        <label>
          Due
          <input type="date" value={taskForm.dueDate} onChange={(event) => onTaskFormChange({ ...taskForm, dueDate: event.target.value })} />
        </label>
        <label>
          Priority
          <select value={taskForm.priority} onChange={(event) => onTaskFormChange({ ...taskForm, priority: event.target.value as TaskPriority })}>
            <option value="Low">Low</option>
            <option value="Normal">Normal</option>
            <option value="Urgent">Urgent</option>
          </select>
        </label>
        <button className="primary-button" type="submit">
          <Plus size={16} aria-hidden="true" />
          Add task
        </button>
      </form>

      <div className="tasks-toolbar">
        <select value={taskStatusFilter} onChange={(event) => onTaskStatusFilterChange(event.target.value as 'all' | TaskStatus)}>
          <option value="active">Active</option>
          <option value="all">All statuses</option>
          <option value="To do">To do</option>
          <option value="In progress">In progress</option>
          <option value="Done">Completed</option>
        </select>
        <select value={taskOwnerFilter} onChange={(event) => onTaskOwnerFilterChange(event.target.value)}>
          <option value="all">All assignees</option>
          {taskAssignees.map((assignee) => (
            <option value={assignee} key={assignee}>
              {assignee}
            </option>
          ))}
        </select>
        <input value={taskSearch} onChange={(event) => onTaskSearchChange(event.target.value)} placeholder="Search task, job, client, issue" />
        <button className="secondary-button compact" type="button" onClick={onResetFilters}>
          Reset
        </button>
      </div>

      <div className="tasks-table-wrap">
        <table className="tasks-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Job</th>
              <th>Assigned to</th>
              <th>Due</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Source</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredTaskRows.map((task) => {
              const job = jobMap.get(task.jobNumber);

              return (
                <tr className={task.status === 'Done' ? 'task-done' : ''} key={task.id}>
                  <td>
                    <strong>{task.title}</strong>
                    <span>{task.notes || job?.issue || 'No notes'}</span>
                    {task.status === 'Done' && (task.completedBy || task.completedAt || task.completionNote) ? (
                      <small className="task-completion-audit">
                        Completed{task.completedBy ? ` by ${task.completedBy}` : ''}{task.completedAt ? ` on ${new Date(task.completedAt).toLocaleString()}` : ''}{task.completionNote ? ` - ${task.completionNote}` : ''}
                      </small>
                    ) : null}
                    {task.status !== 'Done' && task.statusChangedBy && task.statusChangedAt ? (
                      <small className="task-completion-audit">
                        Status changed to {task.status} by {task.statusChangedBy} on {new Date(task.statusChangedAt).toLocaleString()}
                      </small>
                    ) : null}
                  </td>
                  <td>
                    {job ? (
                      <button className="job-number-link" type="button" onClick={() => onOpenJob(job)}>
                        #{job.jobNumber}
                      </button>
                    ) : (
                      '-'
                    )}
                    {job ? <span>{job.organization}</span> : null}
                  </td>
                  <td>{task.assignedTo}</td>
                  <td>{task.dueDate || '-'}</td>
                  <td>
                    <span className={`task-priority ${statusClassName(task.priority)}`}>{task.priority}</span>
                  </td>
                  <td>
                      <select value={task.status} onChange={(event) => {
                        const nextStatus = event.target.value as TaskStatus;
                        if (nextStatus === 'Done') requestCompletion(task);
                        else onUpdateTaskStatus(task, nextStatus);
                      }}>
                      <option value="To do">To do</option>
                      <option value="In progress">In progress</option>
                      <option value="Done">Completed</option>
                    </select>
                  </td>
                  <td>
                    <span className={`task-source ${task.source.toLowerCase()}`}>{task.source}</span>
                  </td>
                  <td>
                    <div className="task-actions">
                      <button className="secondary-button compact" type="button" onClick={() => requestCompletion(task)}>
                        Done
                      </button>
                      {job ? (
                        <button className="secondary-button compact" type="button" onClick={() => onOpenJob(job)}>
                          Open job
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!filteredTaskRows.length ? (
              <tr>
                <td colSpan={8}>
                  <div className="empty-inline">No tasks match the filters.</div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {completionTask ? (
        <div className="email-message-modal-backdrop" role="presentation" onClick={() => setCompletionTask(null)}>
          <section className="task-completion-modal" role="dialog" aria-modal="true" aria-labelledby="task-completion-title" onClick={(event) => event.stopPropagation()}>
            <div className="email-message-detail-header">
              <div>
                <p className="eyebrow">Complete task</p>
                <h2 id="task-completion-title">{completionTask.title}</h2>
              </div>
              <button className="secondary-button compact" type="button" onClick={() => setCompletionTask(null)}>Close</button>
            </div>
            <div className="task-completion-body">
              <p>Add a note about what was done. This is optional.</p>
              <textarea value={completionNote} onChange={(event) => setCompletionNote(event.target.value)} placeholder="Optional completion note" rows={5} autoFocus />
            </div>
            <div className="email-message-modal-actions task-completion-actions">
              <button className="secondary-button" type="button" onClick={() => setCompletionTask(null)}>Cancel</button>
              <button className="primary-button" type="button" onClick={saveCompletion}>Mark as done</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
