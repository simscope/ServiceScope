import { useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, Search } from 'lucide-react';
import { JobDetailPanel } from '../JobDetailPanel';
import type { JobCardData } from '../JobCard';
import type { EmailCompose, EmailComposeAttachment } from '../../appTypes';
import type { CompanyOnboardingProfile, CompanyPaymentMethod, JobDocumentType, JobInvoice, MaterialRow, ServiceJob } from '../../types';
import { isCustomerJobPaid, money } from '../../utils/format';

function isFinishedJob(job: ServiceJob) {
  return job.status === 'Completed' || job.status === 'Warranty';
}

function paymentMissing(amount: string, method: string) {
  return Number(amount || 0) > 0 && !method;
}

function debtAmount(job: ServiceJob) {
  const scf = paymentMissing(job.serviceCallFee, job.scfPayment) ? Number(job.serviceCallFee || 0) : 0;
  const labor = paymentMissing(job.labor, job.laborPayment) ? Number(job.labor || 0) : 0;
  return scf + labor;
}

function jobSearchText(job: ServiceJob) {
  return [
    job.jobNumber,
    job.organization,
    job.clientName,
    job.phone,
    job.email,
    job.address,
    job.system,
    job.issue,
    job.assignee,
  ].join(' ').toLowerCase();
}

export function DebtorsPage({
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
  allJobsRows,
  onOpenJob,
  onSaveDebtorJob,
  onSaveCustomerBlacklist,
  readOnly,
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
  allJobsRows: ServiceJob[];
  onOpenJob: (job: ServiceJob) => void;
  onSaveDebtorJob: (job: ServiceJob) => void;
  onSaveCustomerBlacklist: (job: ServiceJob, blacklist: string) => Promise<void>;
  readOnly: boolean;
}) {
  const [techFilter, setTechFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Partial<ServiceJob>>>({});
  const [blacklistJob, setBlacklistJob] = useState<ServiceJob | null>(null);
  const [blacklistDraft, setBlacklistDraft] = useState('');
  const [blacklistStatus, setBlacklistStatus] = useState('');

  const paymentOptions = useMemo(() => [{ value: '', label: '--' }, ...paymentMethodOptions], [paymentMethodOptions]);

  const visibleJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allJobsRows
      .filter((job) => isFinishedJob(job))
      .filter((job) => !isCustomerJobPaid(job))
      .filter((job) => techFilter === 'all' || job.assignee === techFilter)
      .filter((job) => !query || jobSearchText(job).includes(query))
      .sort((a, b) => Number(b.jobNumber || 0) - Number(a.jobNumber || 0));
  }, [allJobsRows, search, techFilter]);

  const groupedJobs = useMemo(() => {
    const groups = new Map<string, ServiceJob[]>();
    for (const job of visibleJobs) {
      const key = job.assignee || 'No technician';
      groups.set(key, [...(groups.get(key) ?? []), job]);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === 'No technician') return 1;
      if (b === 'No technician') return -1;
      return a.localeCompare(b);
    });
  }, [visibleJobs]);

  const grandTotal = visibleJobs.reduce((sum, job) => sum + debtAmount({ ...job, ...drafts[job.id] }), 0);

  const updateDraft = (jobId: string, patch: Partial<ServiceJob>) => {
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [jobId]: {
        ...currentDrafts[jobId],
        ...patch,
      },
    }));
  };

  const saveDraft = (job: ServiceJob) => {
    const draft = drafts[job.id] ?? {};
    onSaveDebtorJob({ ...job, ...draft });
    setDrafts((currentDrafts) => {
      const nextDrafts = { ...currentDrafts };
      delete nextDrafts[job.id];
      return nextDrafts;
    });
  };

  const openBlacklist = (job: ServiceJob) => {
    setBlacklistStatus('');
    setBlacklistJob(job);
    setBlacklistDraft(job.customerBlacklist ?? '');
  };

  const closeBlacklist = () => {
    setBlacklistJob(null);
    setBlacklistDraft('');
    setBlacklistStatus('');
  };

  const saveBlacklistForJob = async (job: ServiceJob, value: string) => {
    if (readOnly) return;
    setBlacklistStatus('Saving...');
    try {
      await onSaveCustomerBlacklist(job, value);
      setBlacklistStatus('');
    } catch (error) {
      setBlacklistStatus(error instanceof Error ? error.message : 'Blacklist could not be saved.');
      throw error;
    }
  };

  const saveBlacklist = async (value = blacklistDraft) => {
    if (!blacklistJob) return;
    try {
      await saveBlacklistForJob(blacklistJob, value);
      closeBlacklist();
    } catch {
      // Status is already shown above.
    }
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
    <section className="debtors-page">
      {blacklistJob ? (
        <div className="email-compose-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeBlacklist(); }}>
          <section className="email-compose-modal blacklist-modal" role="dialog" aria-modal="true" aria-label="Blacklist customer" onMouseDown={(event) => event.stopPropagation()}>
            <div className="email-compose-header">
              <div>
                <p className="eyebrow">Customer blacklist</p>
                <h2>{blacklistJob.organization || blacklistJob.clientName || `Job #${blacklistJob.jobNumber}`}</h2>
              </div>
              <button className="secondary-button compact" type="button" onClick={closeBlacklist}>Close</button>
            </div>
            <textarea
              value={blacklistDraft}
              onChange={(event) => setBlacklistDraft(event.target.value)}
              placeholder="Reason, notes, or payment warning..."
              disabled={readOnly}
            />
            {blacklistStatus ? <p className="access-status">{blacklistStatus}</p> : null}
            <div className="email-compose-actions">
              <button className="secondary-button" type="button" onClick={closeBlacklist}>Cancel</button>
              <button className="primary-button" type="button" onClick={() => saveBlacklist()} disabled={readOnly || !blacklistDraft.trim()}>Save</button>
            </div>
          </section>
        </div>
      ) : null}

      <div className="debtors-header">
        <div>
          <p className="eyebrow">Receivables</p>
          <h1>Debtors (Unpaid)</h1>
        </div>
        <div className="debtors-summary">
          <span>{visibleJobs.length} jobs</span>
          <strong>{money(grandTotal)}</strong>
        </div>
      </div>

      <div className="debtors-toolbar">
        <label>
          Technician
          <select value={techFilter} onChange={(event) => setTechFilter(event.target.value)}>
            <option value="all">All technicians</option>
            <option value="No technician">No technician</option>
            {profile.technicians.map((technician) => (
              <option value={technician.name} key={technician.id}>{technician.name}</option>
            ))}
          </select>
        </label>
        <label className="debtors-search">
          Search
          <span>
            <Search size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Company, name, phone, address or Job #" />
          </span>
        </label>
        <button className="secondary-button compact" type="button" onClick={() => { setTechFilter('all'); setSearch(''); }}>
          <RefreshCw size={15} />
          Reset
        </button>
      </div>

      {visibleJobs.length === 0 ? (
        <div className="empty-inline">No unpaid completed jobs found.</div>
      ) : (
        groupedJobs.map(([technician, jobs]) => {
          const technicianTotal = jobs.reduce((sum, job) => sum + debtAmount({ ...job, ...drafts[job.id] }), 0);
          return (
            <section className="debtors-group" key={technician}>
              <div className="debtors-group-heading">
                <h2>{technician}</h2>
                <strong>Total: {money(technicianTotal)}</strong>
              </div>
              <div className="all-jobs-table-wrap debtors-table-wrap">
                <table className="all-jobs-table debtors-table">
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
                      <th>Blacklist</th>
                      <th>Save</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => {
                      const draft = drafts[job.id] ?? {};
                      const row = { ...job, ...draft };
                      const blacklisted = Boolean(job.customerBlacklist?.trim());
                      return (
                        <tr className="debtors-row" key={job.id}>
                          <td>
                            <button className="job-number-link" type="button" onClick={() => onOpenJob(job)}>
                              {job.jobNumber}
                            </button>
                          </td>
                          <td>
                            <strong>{job.organization || job.clientName || 'Unknown client'}</strong>
                            <span>{job.clientName}</span>
                          </td>
                          <td>{job.phone}</td>
                          <td>{job.address}</td>
                          <td>{job.system}</td>
                          <td>{job.issue}</td>
                          <td>
                            <input value={row.serviceCallFee} onChange={(event) => updateDraft(job.id, { serviceCallFee: event.target.value })} disabled={readOnly} aria-label={`SCF for job ${job.jobNumber}`} />
                          </td>
                          <td>
                            <select className={paymentMissing(row.serviceCallFee, row.scfPayment) ? 'needs-payment' : ''} value={row.scfPayment} onChange={(event) => updateDraft(job.id, { scfPayment: event.target.value })} disabled={readOnly} aria-label={`SCF payment for job ${job.jobNumber}`}>
                              {paymentOptions.map((method) => (
                                <option value={method.value} key={method.value || 'empty'}>{method.label}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input value={row.labor} onChange={(event) => updateDraft(job.id, { labor: event.target.value })} disabled={readOnly} aria-label={`Labor for job ${job.jobNumber}`} />
                          </td>
                          <td>
                            <select className={paymentMissing(row.labor, row.laborPayment) ? 'needs-payment' : ''} value={row.laborPayment} onChange={(event) => updateDraft(job.id, { laborPayment: event.target.value })} disabled={readOnly} aria-label={`Labor payment for job ${job.jobNumber}`}>
                              {paymentOptions.map((method) => (
                                <option value={method.value} key={method.value || 'empty'}>{method.label}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <div className="blacklist-cell">
                              <span className={`blacklist-dot ${blacklisted ? 'active' : ''}`} title={job.customerBlacklist || 'Not blacklisted'} />
                              <button className="secondary-button compact" type="button" onClick={() => openBlacklist(job)} disabled={readOnly || !job.customerId}>
                                {blacklisted ? 'Edit' : 'Blacklist'}
                              </button>
                              {blacklisted ? (
                                <button className="secondary-button compact danger-lite" type="button" onClick={() => saveBlacklistForJob(job, '')} disabled={readOnly || !job.customerId}>
                                  Clear
                                </button>
                              ) : null}
                            </div>
                          </td>
                          <td>
                            <button className="primary-button compact" type="button" onClick={() => saveDraft(job)} disabled={readOnly || !drafts[job.id]}>
                              {drafts[job.id] ? 'Save' : 'Saved'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}

      {readOnly ? (
        <p className="debtors-readonly">
          <AlertTriangle size={16} />
          Debtors is read-only for this company.
        </p>
      ) : null}
    </section>
  );
}
