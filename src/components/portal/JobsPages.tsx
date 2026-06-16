import type { FormEvent } from 'react';
import { ClipboardList, Plus } from 'lucide-react';
import type { JobCardData } from '../JobCard';
import { JobDetailPanel } from '../JobDetailPanel';
import type {
  CompanyJobType,
  CompanyOnboardingProfile,
  CompanyPaymentMethod,
  MaterialRow,
  ServiceJob,
  ServiceJobStatus,
} from '../../types';
import { paymentMethodLabels } from '../../appLabels';
import { statusClassName } from '../../utils/format';

export function JobsPage({
  openedJob,
  profile,
  paymentMethodOptions,
  materials,
  currentPortalUser,
  onCloseJob,
  onSaveJob,
  onSaveMaterials,
  onCreateJob,
  selectedJobPrefix,
  nextJobNumber,
  selectedJobType,
  selectedJobTypeId,
  onSelectedJobTypeIdChange,
}: {
  openedJob: JobCardData | null;
  profile: CompanyOnboardingProfile;
  paymentMethodOptions: { value: CompanyPaymentMethod; label: string }[];
  materials: MaterialRow[];
  currentPortalUser: { name: string; role: 'Manager' | 'Admin' | 'Technician' };
  onCloseJob: () => void;
  onSaveJob: (job: JobCardData) => void;
  onSaveMaterials: (jobNumber: string, rows: MaterialRow[]) => void;
  onCreateJob: (event: FormEvent<HTMLFormElement>) => void;
  selectedJobPrefix: string;
  nextJobNumber: string;
  selectedJobType?: CompanyJobType;
  selectedJobTypeId: string;
  onSelectedJobTypeIdChange: (id: string) => void;
}) {
  if (openedJob) {
    return (
      <section className="job-detail-shell">
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
    <section className="client-form-panel">
      <h1>Create Job</h1>
      <form className="job-form" onSubmit={onCreateJob}>
        <label>
          Job number
          <input name="jobNumber" defaultValue="Automatic" placeholder={selectedJobPrefix ? `${selectedJobPrefix}-${nextJobNumber}` : nextJobNumber} />
        </label>
        <label>
          Company
          <input name="organization" placeholder="Organization / Company" />
        </label>
        <label>
          Issue description
          <input name="issue" placeholder="Describe the issue" />
        </label>
        <label>
          Client name
          <input name="clientName" placeholder="Client name" />
        </label>
        <label>
          System
          <select name="system" value={selectedJobType?.id ?? selectedJobTypeId} onChange={(event) => onSelectedJobTypeIdChange(event.target.value)} disabled={profile.jobTypes.length === 0}>
            {profile.jobTypes.length === 0 ? <option value="">Configure professions in onboarding</option> : null}
            {profile.jobTypes.map((jobType) => (
              <option value={jobType.id} key={jobType.id}>
                {jobType.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Phone
          <input name="phone" placeholder="Phone" />
        </label>
        <label>
          SCF ($)
          <input name="serviceCallFee" type="number" min={0} step={5} defaultValue={profile.serviceCallFee} />
        </label>
        <label>
          Email
          <input name="email" type="email" placeholder="Email" />
        </label>
        <label>
          Select technician
          <select name="technician" defaultValue="">
            <option value="">--</option>
            {profile.technicians.map((technician) => (
              <option value={technician.name} key={technician.id}>
                {technician.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Address
          <input name="address" placeholder="Address" />
        </label>
        <label className="job-form-wide">
          Notes
          <textarea name="notes" placeholder="Notes" />
        </label>
        <div className="job-form-actions">
          <button className="primary-button" type="submit">
            <Plus size={18} aria-hidden="true" />
            Create job
          </button>
        </div>
      </form>
    </section>
  );
}

export function AllJobsPage({
  openedJob,
  profile,
  paymentMethodOptions,
  materials,
  currentPortalUser,
  onCloseJob,
  onSaveJob,
  onSaveMaterials,
  jobStatusFilters,
  allJobsGroups,
  allJobsVisibility,
  onAllJobsVisibilityChange,
  activeJobsCount,
  paidJobsCount,
  totalJobsCount,
  inlineJobDrafts,
  onUpdateInlineJobDraft,
  onSaveInlineJob,
  onOpenJob,
}: {
  openedJob: JobCardData | null;
  profile: CompanyOnboardingProfile;
  paymentMethodOptions: { value: CompanyPaymentMethod; label: string }[];
  materials: MaterialRow[];
  currentPortalUser: { name: string; role: 'Manager' | 'Admin' | 'Technician' };
  onCloseJob: () => void;
  onSaveJob: (job: JobCardData) => void;
  onSaveMaterials: (jobNumber: string, rows: MaterialRow[]) => void;
  jobStatusFilters: ServiceJobStatus[];
  allJobsGroups: { technician: string; jobs: ServiceJob[] }[];
  allJobsVisibility: 'active' | 'paid' | 'all';
  onAllJobsVisibilityChange: (value: 'active' | 'paid' | 'all') => void;
  activeJobsCount: number;
  paidJobsCount: number;
  totalJobsCount: number;
  inlineJobDrafts: Record<string, Partial<ServiceJob>>;
  onUpdateInlineJobDraft: (jobId: string, patch: Partial<ServiceJob>) => void;
  onSaveInlineJob: (job: ServiceJob) => void;
  onOpenJob: (job: ServiceJob) => void;
}) {
  if (openedJob) {
    return (
      <section className="all-jobs-page">
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
    <section className="all-jobs-page">
      <div className="all-jobs-heading">
        <ClipboardList size={30} aria-hidden="true" />
        <h1>All Jobs</h1>
      </div>

      <div className="all-jobs-toolbar">
        <select defaultValue="all">
          <option value="all">All statuses</option>
          {jobStatusFilters.map((status) => (
            <option value={status} key={status}>
              {status}
            </option>
          ))}
        </select>
        <select defaultValue="all">
          <option value="all">All technicians</option>
          {profile.technicians.map((technician) => (
            <option value={technician.id} key={technician.id}>
              {technician.name}
            </option>
          ))}
        </select>
        <select value={allJobsVisibility} onChange={(event) => onAllJobsVisibilityChange(event.target.value as 'active' | 'paid' | 'all')} aria-label="Job visibility">
          <option value="active">Active ({activeJobsCount})</option>
          <option value="paid">Paid ({paidJobsCount})</option>
          <option value="all">All jobs ({totalJobsCount})</option>
        </select>
        <input placeholder="Company, name, phone or address" />
        <input placeholder="Invoice # or Job #" />
        <button className="secondary-button compact" type="button">
          Reset
        </button>
        <button className="secondary-button compact" type="button">
          Export to Excel
        </button>
        <select defaultValue="job-desc">
          <option value="job-desc">Sort by Job #</option>
          <option value="client">Sort by client</option>
          <option value="status">Sort by status</option>
        </select>
      </div>

      <p className="all-jobs-visibility-note">
        Paid jobs are hidden from the active board. Open Paid or All jobs here whenever you need them.
      </p>

      <div className="all-jobs-groups">
        {allJobsGroups.map((group) => (
          <section className="job-group" key={group.technician}>
            <div className="job-group-title">
              <h2>{group.technician}</h2>
            </div>
            <div className="job-status-tabs">
              {jobStatusFilters.map((status) => (
                <button className={`job-status-tab ${statusClassName(status)}`} type="button" key={status}>
                  {status}
                </button>
              ))}
            </div>
            <div className="job-status-count">
              <strong>Diagnosis</strong>
              <span>{group.jobs.length}</span>
            </div>
            <div className="all-jobs-table-wrap">
              <table className="all-jobs-table">
                <thead>
                  <tr>
                    <th>Job #</th>
                    <th>Client</th>
                    <th>Phone</th>
                    <th>Address</th>
                    <th>System</th>
                    <th>Issue</th>
                    <th>SCF</th>
                    <th>SCF payment</th>
                    <th>Labor</th>
                    <th>Labor payment</th>
                    <th>Status</th>
                    <th>Save</th>
                  </tr>
                </thead>
                <tbody>
                  {group.jobs.map((job) => (
                    <tr key={job.jobNumber}>
                      <td>
                        <button className="job-number-link" type="button" onClick={() => onOpenJob(job)}>
                          {job.jobNumber}
                        </button>
                      </td>
                      <td>
                        <strong>{job.organization}</strong>
                        <span>{job.clientName}</span>
                      </td>
                      <td>{job.phone}</td>
                      <td>{job.address}</td>
                      <td>{job.system}</td>
                      <td>{job.issue}</td>
                      <td>
                        <input
                          value={inlineJobDrafts[job.id]?.serviceCallFee ?? job.serviceCallFee}
                          onChange={(event) => onUpdateInlineJobDraft(job.id, { serviceCallFee: event.target.value })}
                          aria-label={`SCF for job ${job.jobNumber}`}
                        />
                      </td>
                      <td>
                        <select
                          className={!(inlineJobDrafts[job.id]?.scfPayment ?? job.scfPayment) ? 'needs-payment' : ''}
                          value={inlineJobDrafts[job.id]?.scfPayment ?? job.scfPayment}
                          onChange={(event) => onUpdateInlineJobDraft(job.id, { scfPayment: event.target.value })}
                          aria-label={`SCF payment for job ${job.jobNumber}`}
                        >
                          <option value="">--</option>
                          {profile.acceptedPayments.map((method) => (
                            <option value={method} key={method}>
                              {paymentMethodLabels[method]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          value={inlineJobDrafts[job.id]?.labor ?? job.labor}
                          onChange={(event) => onUpdateInlineJobDraft(job.id, { labor: event.target.value })}
                          aria-label={`Labor for job ${job.jobNumber}`}
                        />
                      </td>
                      <td>
                        <select
                          value={inlineJobDrafts[job.id]?.laborPayment ?? job.laborPayment}
                          onChange={(event) => onUpdateInlineJobDraft(job.id, { laborPayment: event.target.value })}
                          aria-label={`Labor payment for job ${job.jobNumber}`}
                        >
                          <option value="">--</option>
                          {profile.acceptedPayments.map((method) => (
                            <option value={method} key={method}>
                              {paymentMethodLabels[method]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          value={inlineJobDrafts[job.id]?.status ?? job.status}
                          onChange={(event) => onUpdateInlineJobDraft(job.id, { status: event.target.value as ServiceJobStatus })}
                          aria-label={`Status for job ${job.jobNumber}`}
                        >
                          {jobStatusFilters.map((status) => (
                            <option value={status} key={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button className="save-row-button" type="button" onClick={() => onSaveInlineJob(job)} aria-label={`Save job ${job.jobNumber}`}>
                          {inlineJobDrafts[job.id] ? 'Save' : 'Saved'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
