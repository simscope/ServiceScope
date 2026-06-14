import { useState } from 'react';
import { JobDetailPanel } from '../JobDetailPanel';
import type { JobCardData } from '../JobCard';
import type { FinancePeriod, FinanceTab, PayrollRules } from '../../appTypes';
import type { CompanyOnboardingProfile, CompanyPaymentMethod, MaterialRow, ServiceJob } from '../../types';
import { money, statusClassName } from '../../utils/format';

export type FinanceJobRow = ServiceJob & {
  materialsCost: number;
  paidScf: number;
  paidLabor: number;
  salaryBase: number;
  salary: number;
  paid: boolean;
  warnings: string[];
  needsAttention: boolean;
};

type TechnicianPayrollRow = {
  technician: CompanyOnboardingProfile['technicians'][number];
  jobs: number;
  revenue: number;
  materials: number;
  salary: number;
  unpaid: number;
  attention: number;
};

export function FinancePage({
  openedJob,
  profile,
  paymentMethodOptions,
  materials,
  currentPortalUser,
  onCloseJob,
  onSaveJob,
  onSaveMaterials,
  financeSummary,
  financePeriod,
  onFinancePeriodChange,
  financeTechFilter,
  onFinanceTechFilterChange,
  payrollRules,
  onPayrollRulesChange,
  financeTabCounts,
  financeTab,
  onFinanceTabChange,
  technicianPayroll,
  financeBaseRows,
  filteredFinanceRows,
  paymentMethodLabels,
  paymentBuckets,
  onOpenJob,
  onToggleSalaryPaid,
}: {
  openedJob: JobCardData | null;
  profile: CompanyOnboardingProfile;
  paymentMethodOptions: { value: CompanyPaymentMethod; label: string }[];
  materials: MaterialRow[];
  currentPortalUser: { name: string; role: 'Manager' | 'Admin' | 'Technician' };
  onCloseJob: () => void;
  onSaveJob: (job: JobCardData) => void;
  onSaveMaterials: (jobNumber: string, rows: MaterialRow[]) => void;
  financeSummary: { paidRevenue: number; materials: number; salary: number; unpaidSalary: number };
  financePeriod: FinancePeriod;
  onFinancePeriodChange: (period: FinancePeriod) => void;
  financeTechFilter: string;
  onFinanceTechFilterChange: (technician: string) => void;
  payrollRules: PayrollRules;
  onPayrollRulesChange: (rules: PayrollRules) => void;
  financeTabCounts: Record<FinanceTab, number>;
  financeTab: FinanceTab;
  onFinanceTabChange: (tab: FinanceTab) => void;
  technicianPayroll: TechnicianPayrollRow[];
  financeBaseRows: FinanceJobRow[];
  filteredFinanceRows: FinanceJobRow[];
  paymentMethodLabels: Record<CompanyPaymentMethod, string>;
  paymentBuckets: Record<string, number>;
  onOpenJob: (job: FinanceJobRow) => void;
  onToggleSalaryPaid: (jobNumber: string) => void;
}) {
  const [selectedTechnicianName, setSelectedTechnicianName] = useState('');
  const selectedTechnicianPayroll = technicianPayroll.find((row) => row.technician.name === selectedTechnicianName);
  const selectedTechnicianJobs = selectedTechnicianName
    ? financeBaseRows.filter((job) => job.assignee === selectedTechnicianName)
    : [];

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

  if (selectedTechnicianPayroll) {
    return (
      <section className="technician-finance-detail-shell">
        <div className="technician-finance-card fullscreen">
          <div className="technician-finance-header">
            <div>
              <p className="eyebrow">Technician financial card</p>
              <h1>{selectedTechnicianPayroll.technician.name}</h1>
              <p>{selectedTechnicianPayroll.jobs} jobs counted - {selectedTechnicianPayroll.attention} need review</p>
            </div>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => {
                setSelectedTechnicianName('');
                onFinanceTechFilterChange('all');
              }}
            >
              Back to finance
            </button>
          </div>

          <div className="technician-finance-metrics">
            <span>
              <strong>{money(selectedTechnicianPayroll.revenue)}</strong>
              Paid revenue
            </span>
            <span>
              <strong>{money(selectedTechnicianPayroll.materials)}</strong>
              Materials
            </span>
            <span>
              <strong>{money(selectedTechnicianPayroll.salary)}</strong>
              Payroll
            </span>
            <span>
              <strong>{money(selectedTechnicianPayroll.unpaid)}</strong>
              Unpaid
            </span>
          </div>

          <div className="technician-finance-rules">
            <span>Commission: {payrollRules.commissionPercent}%</span>
            <span>SCF-only payout: {money(payrollRules.scfOnlyPayout)}</span>
            <span>{payrollRules.includeScf ? 'SCF included' : 'SCF excluded'}</span>
            <span>{payrollRules.deductMaterials ? 'Materials deducted' : 'Materials not deducted'}</span>
          </div>

          <div className="technician-finance-table-wrap">
            <table className="technician-finance-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Collected</th>
                  <th>Materials</th>
                  <th>Salary</th>
                  <th>Review</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {selectedTechnicianJobs.map((job) => (
                  <tr className={job.needsAttention ? 'needs-review' : ''} key={job.jobNumber}>
                    <td>
                      <button className="job-number-link" type="button" onClick={() => onOpenJob(job)}>
                        #{job.jobNumber}
                      </button>
                    </td>
                    <td>
                      <strong>{job.organization}</strong>
                      <span>{job.clientName}</span>
                    </td>
                    <td>{job.status}</td>
                    <td>{money(job.paidScf + job.paidLabor)}</td>
                    <td>{money(job.materialsCost)}</td>
                    <td>{money(job.salary)}</td>
                    <td>{job.warnings.length ? job.warnings.join(' - ') : 'Ready'}</td>
                    <td>
                      <button className={job.paid ? 'payroll-toggle paid' : 'payroll-toggle'} type="button" onClick={() => onToggleSalaryPaid(job.jobNumber)}>
                        {job.paid ? 'Paid' : 'Mark paid'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!selectedTechnicianJobs.length ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="empty-inline">No jobs in this period for this technician.</div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="finance-page">
      <div className="finance-header">
        <div>
          <p className="eyebrow">Payroll and money report</p>
          <h1>Finance</h1>
        </div>
        <div className="finance-summary">
          <span>
            <strong>{money(financeSummary.paidRevenue)}</strong>
            Paid revenue
          </span>
          <span>
            <strong>{money(financeSummary.materials)}</strong>
            Materials
          </span>
          <span>
            <strong>{money(financeSummary.salary)}</strong>
            Technician payroll
          </span>
          <span>
            <strong>{money(financeSummary.unpaidSalary)}</strong>
            Unpaid payroll
          </span>
        </div>
      </div>

      <div className="finance-toolbar">
        <label>
          Period
          <select value={financePeriod} onChange={(event) => onFinancePeriodChange(event.target.value as FinancePeriod)}>
            <option value="this_week">This week</option>
            <option value="this_month">This month</option>
            <option value="all">All time</option>
          </select>
        </label>
        <label>
          Technician
          <select value={financeTechFilter} onChange={(event) => onFinanceTechFilterChange(event.target.value)}>
            <option value="all">All technicians</option>
            {profile.technicians.map((technician) => (
              <option value={technician.name} key={technician.id}>
                {technician.name}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button compact" type="button">
          Export payroll
        </button>
      </div>

      <section className="payroll-rules-panel">
        <div>
          <p className="eyebrow">Company payroll formula</p>
          <h2>Payroll rules</h2>
          <p>
            Payroll = {payrollRules.commissionPercent}% of ({payrollRules.includeScf ? 'paid SCF + ' : ''}paid labor
            {payrollRules.deductMaterials ? ' - materials' : ''}). SCF-only jobs pay {money(payrollRules.scfOnlyPayout)}.
          </p>
        </div>
        <div className="payroll-rule-controls">
          <label>
            Commission %
            <input
              min="0"
              max="100"
              type="number"
              value={payrollRules.commissionPercent}
              onChange={(event) => onPayrollRulesChange({ ...payrollRules, commissionPercent: Math.max(0, Number(event.target.value) || 0) })}
            />
          </label>
          <label>
            SCF-only payout
            <input
              min="0"
              type="number"
              value={payrollRules.scfOnlyPayout}
              onChange={(event) => onPayrollRulesChange({ ...payrollRules, scfOnlyPayout: Math.max(0, Number(event.target.value) || 0) })}
            />
          </label>
          <label className="payroll-checkbox">
            <input
              type="checkbox"
              checked={payrollRules.includeScf}
              onChange={(event) => onPayrollRulesChange({ ...payrollRules, includeScf: event.target.checked })}
            />
            Include SCF in commission base
          </label>
          <label className="payroll-checkbox">
            <input
              type="checkbox"
              checked={payrollRules.deductMaterials}
              onChange={(event) => onPayrollRulesChange({ ...payrollRules, deductMaterials: event.target.checked })}
            />
            Deduct materials before payroll
          </label>
        </div>
      </section>

      <div className="finance-tabs">
        {[
          { id: 'ready', label: 'Ready to pay', count: financeTabCounts.ready },
          { id: 'paid', label: 'Paid', count: financeTabCounts.paid },
          { id: 'attention', label: 'Needs attention', count: financeTabCounts.attention },
        ].map((tab) => (
          <button
            className={financeTab === tab.id ? 'active' : ''}
            key={tab.id}
            type="button"
            onClick={() => onFinanceTabChange(tab.id as FinanceTab)}
          >
            {tab.label}
            <span>{tab.count}</span>
          </button>
        ))}
      </div>

      <section className="technician-payroll-grid">
        {technicianPayroll.map((row) => (
          <button
            className={selectedTechnicianName === row.technician.name ? 'technician-payroll-card selected' : 'technician-payroll-card'}
            key={row.technician.id}
            type="button"
            onClick={() => {
              setSelectedTechnicianName(row.technician.name);
              onFinanceTechFilterChange(row.technician.name);
            }}
          >
            <div>
              <h3>{row.technician.name}</h3>
              <p>{row.jobs} jobs counted - {row.attention} need review</p>
            </div>
            <dl>
              <div>
                <dt>Paid revenue</dt>
                <dd>{money(row.revenue)}</dd>
              </div>
              <div>
                <dt>Materials</dt>
                <dd>{money(row.materials)}</dd>
              </div>
              <div>
                <dt>Payroll</dt>
                <dd>{money(row.salary)}</dd>
              </div>
              <div>
                <dt>Unpaid</dt>
                <dd>{money(row.unpaid)}</dd>
              </div>
            </dl>
          </button>
        ))}
      </section>

      {financeBaseRows.some((job) => job.needsAttention) ? (
        <section className="finance-attention-panel">
          <div>
            <p className="eyebrow">Review before paying</p>
            <h2>Needs attention</h2>
          </div>
          {financeBaseRows
            .filter((job) => job.needsAttention)
            .slice(0, 4)
            .map((job) => (
              <button type="button" key={job.jobNumber} onClick={() => onOpenJob(job)}>
                <strong>#{job.jobNumber} - {job.organization}</strong>
                <span>{job.warnings.join(' - ')}</span>
              </button>
            ))}
        </section>
      ) : null}

      <div className="finance-table-wrap">
        <table className="finance-table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Technician</th>
              <th>Status</th>
              <th>SCF</th>
              <th>SCF payment</th>
              <th>Labor</th>
              <th>Labor payment</th>
              <th>Materials</th>
              <th>Payroll base</th>
              <th>Salary</th>
              <th>Review</th>
              <th>Paid</th>
            </tr>
          </thead>
          <tbody>
            {filteredFinanceRows.map((job) => (
              <tr className={job.paid ? 'salary-paid-row' : job.needsAttention ? 'salary-attention-row' : ''} key={job.jobNumber}>
                <td>
                  <button className="job-number-link" type="button" onClick={() => onOpenJob(job)}>
                    #{job.jobNumber}
                  </button>
                  <span>{job.organization}</span>
                </td>
                <td>{job.assignee}</td>
                <td>
                  <span className={`material-status ${statusClassName(job.status)}`}>{job.status}</span>
                </td>
                <td>{money(job.paidScf)}</td>
                <td>{job.scfPayment ? paymentMethodLabels[job.scfPayment as CompanyPaymentMethod] : '-'}</td>
                <td>{money(job.paidLabor)}</td>
                <td>{job.laborPayment ? paymentMethodLabels[job.laborPayment as CompanyPaymentMethod] : '-'}</td>
                <td>{money(job.materialsCost)}</td>
                <td>
                  {money(job.salaryBase)}
                  <span>{payrollRules.commissionPercent}% rule</span>
                </td>
                <td>
                  <strong>{money(job.salary)}</strong>
                </td>
                <td>
                  {job.warnings.length ? <span className="finance-warning-text">{job.warnings.join(' - ')}</span> : <span className="finance-ok-text">Ready</span>}
                </td>
                <td>
                  <button className={job.paid ? 'payroll-toggle paid' : 'payroll-toggle'} type="button" onClick={() => onToggleSalaryPaid(job.jobNumber)}>
                    {job.paid ? 'Paid' : 'Mark paid'}
                  </button>
                </td>
              </tr>
            ))}
            {!filteredFinanceRows.length ? (
              <tr>
                <td colSpan={12}>
                  <div className="empty-inline">No finance rows match the filters.</div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <section className="payment-report-panel">
        <div>
          <p className="eyebrow">Collected by method</p>
          <h2>Money report</h2>
        </div>
        <div className="payment-bucket-grid">
          {Object.entries(paymentBuckets).map(([label, amount]) => (
            <span key={label}>
              <strong>{money(amount)}</strong>
              {label}
            </span>
          ))}
          {!Object.keys(paymentBuckets).length ? <p>No paid customer payments in this filter.</p> : null}
        </div>
      </section>
    </section>
  );
}
