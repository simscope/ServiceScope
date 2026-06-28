import { useMemo, useState, type FormEvent } from 'react';
import { ClipboardList, Plus } from 'lucide-react';
import type { JobCardData } from '../JobCard';
import { JobDetailPanel } from '../JobDetailPanel';
import type { EmailCompose, EmailComposeAttachment } from '../../appTypes';
import type {
  CompanyJobType,
  JobDocumentType,
  CompanyOnboardingProfile,
  CompanyPaymentMethod,
  JobInvoice,
  MaterialRow,
  ServiceJob,
  ServiceJobStatus,
} from '../../types';
import { paymentMethodLabels } from '../../appLabels';
import { statusClassName } from '../../utils/format';

const allJobsExportColumns = [
  'Job #',
  'Technician',
  'Status',
  'Company',
  'Client name',
  'Phone',
  'Email',
  'Address',
  'System',
  'Issue',
  'SCF',
  'SCF payment',
  'Labor',
  'Labor payment',
  'Invoices',
  'Invoice total',
  'Notes',
  'Created',
];

function normalizeSearch(value: string | number | null | undefined) {
  return String(value ?? '').trim().toLowerCase();
}

function paymentLabel(value: string) {
  return paymentMethodLabels[value as CompanyPaymentMethod] ?? value;
}

function jobSearchText(job: ServiceJob) {
  return [
    job.jobNumber,
    job.status,
    job.organization,
    job.clientName,
    job.phone,
    job.email,
    job.address,
    job.system,
    job.issue,
    job.serviceCallFee,
    paymentLabel(job.scfPayment),
    job.labor,
    paymentLabel(job.laborPayment),
    job.technician,
    job.assignee,
    job.notes,
    job.createdAt,
    ...(job.invoices ?? []).flatMap((invoice) => [
      invoice.invoiceNumber,
      invoice.documentType,
      invoice.status,
      invoice.amount,
      invoice.createdAt,
      invoice.sentAt,
      invoice.paidAt,
    ]),
  ]
    .join(' ')
    .toLowerCase();
}

function jobNumberText(job: ServiceJob) {
  return [
    job.jobNumber,
    ...(job.invoices ?? []).map((invoice) => invoice.invoiceNumber),
  ]
    .join(' ')
    .toLowerCase();
}

function escapeExcelCell(value: string | number | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function downloadExcelFile(rows: ServiceJob[]) {
  const tableRows = rows.map((job) => {
    const invoiceTotal = (job.invoices ?? []).reduce((sum, invoice) => sum + (Number(invoice.amount) || 0), 0);
    const invoices = (job.invoices ?? [])
      .map((invoice) => `${invoice.invoiceNumber} ${invoice.documentType} ${invoice.status} $${invoice.amount}`)
      .join('; ');
    const values = [
      job.jobNumber,
      job.assignee || 'No technician',
      job.status,
      job.organization,
      job.clientName,
      job.phone,
      job.email,
      job.address,
      job.system,
      job.issue,
      job.serviceCallFee,
      paymentLabel(job.scfPayment),
      job.labor,
      paymentLabel(job.laborPayment),
      invoices,
      invoiceTotal,
      job.notes,
      job.createdAt,
    ];

    return `<tr>${values.map((value) => `<td>${escapeExcelCell(value)}</td>`).join('')}</tr>`;
  });
  const html = `
    <html>
      <head><meta charset="utf-8" /></head>
      <body>
        <table>
          <thead><tr>${allJobsExportColumns.map((column) => `<th>${escapeExcelCell(column)}</th>`).join('')}</tr></thead>
          <tbody>${tableRows.join('')}</tbody>
        </table>
      </body>
    </html>
  `;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `all-jobs-${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function JobsPage({
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
  onSaveMaterials: (jobOrJobNumber: JobCardData | string, rows: MaterialRow[]) => void | Promise<void>;
  onCreateInvoice: (job: JobCardData, materials: MaterialRow[], amount: number, documentType: JobDocumentType) => Promise<JobInvoice>;
  onDeleteInvoice: (job: JobCardData, invoiceId: string) => Promise<void>;
  onComposeEmail: (compose: EmailCompose, attachments?: EmailComposeAttachment[]) => void;
  onCreateJob: (event: FormEvent<HTMLFormElement>) => void;
  selectedJobPrefix: string;
  nextJobNumber: string;
  selectedJobType?: CompanyJobType;
  selectedJobTypeId: string;
  onSelectedJobTypeIdChange: (id: string) => void;
}) {
  const createAttentionFields = ['organization', 'issue', 'clientName', 'phone', 'address'];
  const [createTouchedFields, setCreateTouchedFields] = useState<Record<string, boolean>>({});
  const [createFieldValues, setCreateFieldValues] = useState<Record<string, string>>({});
  const createCustomerMatches: Array<{ id: string; primaryName: string; organization: string; primaryPhone: string; address: string }> = [];
  const applyCustomerToCreateForm = (_customer: { id: string; primaryName: string; organization: string; primaryPhone: string; address: string }) => undefined;
  const updateCreateField = (field: string, value: string) => {
    setCreateFieldValues((values) => ({ ...values, [field]: value }));
  };
  const touchCreateField = (field: string, value: string) => {
    updateCreateField(field, value);
    setCreateTouchedFields((fields) => ({ ...fields, [field]: true }));
  };
  const createFieldNeedsAttention = (field: string) => Boolean(createTouchedFields[field]) && !String(createFieldValues[field] ?? '').trim();
  const createFieldClass = (field: string) => (createFieldNeedsAttention(field) ? 'create-field-missing' : undefined);
  const createFieldHint = (field: string, label: string) => (
    createFieldNeedsAttention(field) ? <span className="create-field-warning">{label} is empty. The job can still be created.</span> : null
  );
  const handleCreateSubmit = (event: FormEvent<HTMLFormElement>) => {
    const form = new FormData(event.currentTarget);
    const nextValues = Object.fromEntries([...createAttentionFields, 'email', 'technician'].map((field) => [field, String(form.get(field) ?? '')]));

    setCreateFieldValues((values) => ({ ...values, ...nextValues }));
    setCreateTouchedFields((fields) => ({
      ...fields,
      ...Object.fromEntries(createAttentionFields.map((field) => [field, true])),
    }));
    onCreateJob(event);
  };

  if (openedJob) {
    return (
      <section className="job-detail-shell">
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
    <section className="client-form-panel">
      <h1>Create Job</h1>
      {createCustomerMatches.length ? (
        <div className="create-customer-matches">
          <strong>Existing client found</strong>
          <span>Click a client to fill company, name, phone, email and address.</span>
          <div>
            {createCustomerMatches.map((customer) => (
              <button type="button" key={customer.id} onClick={() => applyCustomerToCreateForm(customer)}>
                <b>{customer.primaryName || customer.organization || 'Unnamed client'}</b>
                <small>{[customer.organization, customer.primaryPhone, customer.address].filter(Boolean).join(' • ')}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <form className="job-form" onSubmit={handleCreateSubmit}>
        <label>
          Job number
          <input name="jobNumber" defaultValue="Automatic" placeholder={selectedJobPrefix ? `${selectedJobPrefix}-${nextJobNumber}` : nextJobNumber} />
        </label>
        <label>
          Company
          <div className="create-field-control">
            <input name="organization" placeholder="Organization / Company" value={createFieldValues.organization ?? ''} className={createFieldClass('organization')} onChange={(event) => updateCreateField('organization', event.target.value)} onBlur={(event) => touchCreateField('organization', event.target.value)} />
            {createFieldHint('organization', 'Company')}
          </div>
        </label>
        <label>
          Issue description
          <div className="create-field-control">
            <input name="issue" placeholder="Describe the issue" value={createFieldValues.issue ?? ''} className={createFieldClass('issue')} onChange={(event) => updateCreateField('issue', event.target.value)} onBlur={(event) => touchCreateField('issue', event.target.value)} />
            {createFieldHint('issue', 'Issue description')}
          </div>
        </label>
        <label>
          Client name
          <div className="create-field-control">
            <input name="clientName" placeholder="Client name" value={createFieldValues.clientName ?? ''} className={createFieldClass('clientName')} onChange={(event) => updateCreateField('clientName', event.target.value)} onBlur={(event) => touchCreateField('clientName', event.target.value)} />
            {createFieldHint('clientName', 'Client name')}
          </div>
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
          <div className="create-field-control">
            <input name="phone" placeholder="Phone" value={createFieldValues.phone ?? ''} className={createFieldClass('phone')} onChange={(event) => updateCreateField('phone', event.target.value)} onBlur={(event) => touchCreateField('phone', event.target.value)} />
            {createFieldHint('phone', 'Phone')}
          </div>
        </label>
        <label>
          SCF ($)
          <input name="serviceCallFee" type="number" min={0} step={5} defaultValue={profile.serviceCallFee} />
        </label>
        <label>
          Email
          <input name="email" type="email" placeholder="Email" value={createFieldValues.email ?? ''} onChange={(event) => updateCreateField('email', event.target.value)} onBlur={(event) => touchCreateField('email', event.target.value)} />
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
          <div className="create-field-control">
            <input name="address" placeholder="Address" value={createFieldValues.address ?? ''} className={createFieldClass('address')} onChange={(event) => updateCreateField('address', event.target.value)} onBlur={(event) => touchCreateField('address', event.target.value)} />
            {createFieldHint('address', 'Address')}
          </div>
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
  onCreateInvoice,
  onDeleteInvoice,
  onComposeEmail,
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
  onSaveMaterials: (jobOrJobNumber: JobCardData | string, rows: MaterialRow[]) => void | Promise<void>;
  onCreateInvoice: (job: JobCardData, materials: MaterialRow[], amount: number, documentType: JobDocumentType) => Promise<JobInvoice>;
  onDeleteInvoice: (job: JobCardData, invoiceId: string) => Promise<void>;
  onComposeEmail: (compose: EmailCompose, attachments?: EmailComposeAttachment[]) => void;
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
  const [statusFilter, setStatusFilter] = useState<'all' | ServiceJobStatus>('all');
  const [technicianFilter, setTechnicianFilter] = useState('all');
  const [generalSearch, setGeneralSearch] = useState('');
  const [numberSearch, setNumberSearch] = useState('');
  const [sortMode, setSortMode] = useState<'job-desc' | 'client' | 'status'>('job-desc');
  const allVisibleJobs = useMemo(() => allJobsGroups.flatMap((group) => group.jobs), [allJobsGroups]);
  const technicianOptions = useMemo(() => {
    const names = Array.from(new Set(allVisibleJobs.map((job) => job.assignee || 'No technician')));
    return ['all', ...names.sort((first, second) => first.localeCompare(second))];
  }, [allVisibleJobs]);
  const filteredAllJobs = useMemo(() => {
    const normalizedGeneralSearch = normalizeSearch(generalSearch);
    const normalizedNumberSearch = normalizeSearch(numberSearch);
    const statusOrder = new Map(jobStatusFilters.map((status, index) => [status, index]));

    return allVisibleJobs
      .filter((job) => {
        const assignee = job.assignee || 'No technician';
        const matchesStatus = statusFilter === 'all' || job.status === statusFilter;
        const matchesTechnician = technicianFilter === 'all' || assignee === technicianFilter;
        const matchesGeneralSearch = !normalizedGeneralSearch || jobSearchText(job).includes(normalizedGeneralSearch);
        const matchesNumberSearch = !normalizedNumberSearch || jobNumberText(job).includes(normalizedNumberSearch);
        return matchesStatus && matchesTechnician && matchesGeneralSearch && matchesNumberSearch;
      })
      .sort((first, second) => {
        if (sortMode === 'client') {
          return `${first.organization} ${first.clientName}`.localeCompare(`${second.organization} ${second.clientName}`, undefined, { numeric: true });
        }
        if (sortMode === 'status') {
          return (statusOrder.get(first.status) ?? 999) - (statusOrder.get(second.status) ?? 999)
            || first.jobNumber.localeCompare(second.jobNumber, undefined, { numeric: true });
        }
        return second.jobNumber.localeCompare(first.jobNumber, undefined, { numeric: true });
      });
  }, [allVisibleJobs, generalSearch, jobStatusFilters, numberSearch, sortMode, statusFilter, technicianFilter]);
  const filteredAllJobsGroups = useMemo(() => {
    const groupNames = Array.from(new Set(filteredAllJobs.map((job) => job.assignee || 'No technician')));
    return groupNames.map((technician) => ({
      technician,
      jobs: filteredAllJobs.filter((job) => (job.assignee || 'No technician') === technician),
    }));
  }, [filteredAllJobs]);
  const resetAllJobsFilters = () => {
    setStatusFilter('all');
    setTechnicianFilter('all');
    setGeneralSearch('');
    setNumberSearch('');
    setSortMode('job-desc');
  };

  if (openedJob) {
    return (
      <section className="all-jobs-page">
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
    <section className="all-jobs-page">
      <div className="all-jobs-heading">
        <ClipboardList size={30} aria-hidden="true" />
        <h1>All Jobs</h1>
      </div>

      <div className="all-jobs-toolbar">
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | ServiceJobStatus)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          {jobStatusFilters.map((status) => (
            <option value={status} key={status}>
              {status}
            </option>
          ))}
        </select>
        <select value={technicianFilter} onChange={(event) => setTechnicianFilter(event.target.value)} aria-label="Filter by technician">
          <option value="all">All technicians</option>
          {technicianOptions.filter((technician) => technician !== 'all').map((technician) => (
            <option value={technician} key={technician}>
              {technician}
            </option>
          ))}
        </select>
        <select value={allJobsVisibility} onChange={(event) => onAllJobsVisibilityChange(event.target.value as 'active' | 'paid' | 'all')} aria-label="Job visibility">
          <option value="active">Active ({activeJobsCount})</option>
          <option value="paid">Paid ({paidJobsCount})</option>
          <option value="all">All jobs ({totalJobsCount})</option>
        </select>
        <input value={generalSearch} onChange={(event) => setGeneralSearch(event.target.value)} placeholder="Search all job fields" />
        <input value={numberSearch} onChange={(event) => setNumberSearch(event.target.value)} placeholder="Invoice # or Job #" />
        <button className="secondary-button compact" type="button" onClick={resetAllJobsFilters}>
          Reset
        </button>
        <button className="secondary-button compact" type="button" onClick={() => downloadExcelFile(filteredAllJobs)} disabled={filteredAllJobs.length === 0}>
          Export to Excel
        </button>
        <select value={sortMode} onChange={(event) => setSortMode(event.target.value as 'job-desc' | 'client' | 'status')} aria-label="Sort jobs">
          <option value="job-desc">Sort by Job #</option>
          <option value="client">Sort by client</option>
          <option value="status">Sort by status</option>
        </select>
      </div>

      <p className="all-jobs-visibility-note">
        Paid jobs are hidden from the active board. Open Paid or All jobs here whenever you need them.
      </p>

      <div className="all-jobs-groups">
        {!filteredAllJobsGroups.length ? <p className="empty-inline">No jobs match the current filters.</p> : null}
        {filteredAllJobsGroups.map((group) => (
          <section className="job-group" key={group.technician}>
            <div className="job-group-title">
              <h2>{group.technician}</h2>
            </div>
            <div className="job-status-tabs">
              {jobStatusFilters.map((status) => (
                <button
                  className={`job-status-tab ${statusClassName(status)} ${statusFilter === status ? 'active' : ''}`}
                  type="button"
                  key={status}
                  onClick={() => setStatusFilter((current) => current === status ? 'all' : status)}
                  aria-pressed={statusFilter === status}
                >
                  {status}
                </button>
              ))}
            </div>
            <div className="job-status-count">
              <strong>{statusFilter === 'all' ? 'Shown' : statusFilter}</strong>
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
                  {group.jobs.map((job) => {
                    const visibleStatus = inlineJobDrafts[job.id]?.status ?? job.status;

                    return (
                    <tr className={`all-jobs-row ${statusClassName(visibleStatus)}`} key={job.jobNumber}>
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
                        <button
                          className="save-row-button"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSaveInlineJob(job);
                          }}
                          aria-label={`Save job ${job.jobNumber}`}
                        >
                          {inlineJobDrafts[job.id] ? 'Save' : 'Saved'}
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
