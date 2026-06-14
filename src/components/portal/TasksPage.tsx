import type { FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { JobDetailPanel } from '../JobDetailPanel';
import type { JobCardData } from '../JobCard';
import type { TaskForm, TaskPriority, TaskRow, TaskStatus } from '../../appTypes';
import type { CompanyOnboardingProfile, CompanyPaymentMethod, MaterialRow, ServiceJob } from '../../types';
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
  onSaveMaterials: (jobNumber: string, rows: MaterialRow[]) => void;
  openTaskCount: number;
  autoTaskCount: number;
  urgentTaskCount: number;
  taskForm: TaskForm;
  onTaskFormChange: (form: TaskForm) => void;
  onCreateManualTask: (event: FormEvent<HTMLFormElement>) => void;
  allJobsRows: ServiceJob[];
  taskAssignees: string[];
  taskStatusFilter: 'all' | TaskStatus;
  onTaskStatusFilterChange: (status: 'all' | TaskStatus) => void;
  taskOwnerFilter: string;
  onTaskOwnerFilterChange: (owner: string) => void;
  taskSearch: string;
  onTaskSearchChange: (value: string) => void;
  onResetFilters: () => void;
  filteredTaskRows: TaskRow[];
  jobMap: Map<string, ServiceJob>;
  onOpenJob: (job: ServiceJob) => void;
  onUpdateTaskStatus: (task: TaskRow, status: TaskStatus) => void;
}) {
  if (openedJob) {
    return (
      <section className="tasks-page">
        <JobDetailPanel
          job={openedJob}
          technicians={profile.technicians.map((technician) => technician.name)}
          systems={profile.jobTypes.map((jobType) => jobType.name)}
          paymentMethods={paymentMethodOptions}
          materials={materials.filter((material) => material.jobNumber === openedJob.jobNumber)}
          currentUser={currentPortalUser}
          onClose={onCloseJob}
          onSave={onSaveJob}
          onSaveMaterials={onSaveMaterials}
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
          <option value="all">All statuses</option>
          <option value="To do">To do</option>
          <option value="In progress">In progress</option>
          <option value="Done">Done</option>
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
                    <select value={task.status} onChange={(event) => onUpdateTaskStatus(task, event.target.value as TaskStatus)}>
                      <option value="To do">To do</option>
                      <option value="In progress">In progress</option>
                      <option value="Done">Done</option>
                    </select>
                  </td>
                  <td>
                    <span className={`task-source ${task.source.toLowerCase()}`}>{task.source}</span>
                  </td>
                  <td>
                    <div className="task-actions">
                      <button className="secondary-button compact" type="button" onClick={() => onUpdateTaskStatus(task, 'Done')}>
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
    </section>
  );
}
