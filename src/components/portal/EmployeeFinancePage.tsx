import { useEffect, useMemo, useState } from 'react';
import { JobDetailPanel } from '../JobDetailPanel';
import type { JobCardData } from '../JobCard';
import type { EmailCompose, EmailComposeAttachment, FinancePeriod, PayrollRules } from '../../appTypes';
import type {
  CompanyOnboardingProfile,
  CompanyPaymentMethod,
  CompanyTechnician,
  JobDocumentType,
  JobInvoice,
  MaterialRow,
  ServiceJob,
} from '../../types';
import {
  listEmployeePayrollSettings,
  listStaffPayrollPeriods,
  upsertEmployeePayrollSetting,
  upsertStaffPayrollPeriod,
  type EmployeePayrollSetting,
  type EmployeePayrollSettingInput,
  type EmployeePayType,
  type StaffPayrollPeriod,
  type StaffPayrollPeriodInput,
} from '../../services/employeePayrollStore';
import {
  dollarsToCents,
  listCompanyPayrollItems,
  upsertCompanyPayrollItems,
  type PayrollItemInput,
  type PayrollItemRow,
} from '../../services/payrollStore';
import { money } from '../../utils/format';

const payTypeLabels: Record<EmployeePayType, string> = {
  commission: 'Commission',
  hourly: 'Hourly',
  salary: 'Salary',
  none: 'No payroll',
};

const roleLabels: Record<CompanyTechnician['role'], string> = {
  technician: 'Technician',
  dispatcher: 'Dispatcher',
  manager: 'Manager',
};

type PeriodRange = { start: string; end: string; label: string } | null;

type CommissionJobRow = ServiceJob & {
  materialsCost: number;
  paidScf: number;
  paidLabor: number;
  payrollBase: number;
  payrollAmount: number;
  paid: boolean;
  paidAt: string;
  warnings: string[];
};

type EmployeeSummary = {
  employee: CompanyTechnician;
  setting: EmployeePayrollSettingInput;
  jobs: CommissionJobRow[];
  revenue: number;
  materials: number;
  payroll: number;
  unpaid: number;
  attention: number;
  periodRows: StaffPayrollPeriod[];
};

const isoLocal = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function rangeForPeriod(period: FinancePeriod): PeriodRange {
  if (period === 'all') return null;
  const now = new Date();
  now.setHours(12, 0, 0, 0);

  if (period === 'this_month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 12);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 12);
    return {
      start: isoLocal(start),
      end: isoLocal(end),
      label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    };
  }

  const start = new Date(now);
  const day = start.getDay();
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    start: isoLocal(start),
    end: isoLocal(end),
    label: `${start.toLocaleDateString('en-US')} - ${end.toLocaleDateString('en-US')}`,
  };
}

function dateInRange(value: string, range: PeriodRange) {
  if (!range) return true;
  const date = value.slice(0, 10);
  return date >= range.start && date <= range.end;
}

function defaultSetting(employee: CompanyTechnician, rules: PayrollRules): EmployeePayrollSettingInput {
  return {
    technicianId: employee.id,
    payType: employee.role === 'technician' ? 'commission' : 'hourly',
    hourlyRate: 0,
    overtimeMultiplier: 1.5,
    salaryAmount: 0,
    salaryFrequency: 'weekly',
    commissionPercent: rules.commissionPercent,
    scfOnlyPayout: rules.scfOnlyPayout,
    includeScf: rules.includeScf,
    deductMaterials: rules.deductMaterials,
  };
}

function settingInput(row: EmployeePayrollSetting): EmployeePayrollSettingInput {
  return {
    technicianId: row.technicianId,
    payType: row.payType,
    hourlyRate: row.hourlyRate,
    overtimeMultiplier: row.overtimeMultiplier,
    salaryAmount: row.salaryAmount,
    salaryFrequency: row.salaryFrequency,
    commissionPercent: row.commissionPercent,
    scfOnlyPayout: row.scfOnlyPayout,
    includeScf: row.includeScf,
    deductMaterials: row.deductMaterials,
  };
}

function salaryAccrual(setting: EmployeePayrollSettingInput, period: FinancePeriod) {
  if (period === 'all') return 0;
  const amount = Math.max(0, Number(setting.salaryAmount) || 0);
  if (period === 'this_week') {
    if (setting.salaryFrequency === 'weekly') return amount;
    if (setting.salaryFrequency === 'biweekly') return amount / 2;
    return (amount * 12) / 52;
  }
  if (setting.salaryFrequency === 'monthly') return amount;
  if (setting.salaryFrequency === 'biweekly') return (amount * 26) / 12;
  return (amount * 52) / 12;
}

function periodKey(technicianId: string, range: PeriodRange) {
  return range ? `${technicianId}:${range.start}:${range.end}` : `${technicianId}:all`;
}

function commissionJob(
  job: ServiceJob,
  employee: CompanyTechnician,
  setting: EmployeePayrollSettingInput,
  materials: MaterialRow[],
  payrollItems: PayrollItemRow[],
): CommissionJobRow {
  const materialsCost = materials
    .filter((material) => material.jobNumber === job.jobNumber)
    .reduce((sum, material) => sum + (Number(material.quantity) || 0) * (Number(material.price) || 0), 0);
  const scf = Number(job.serviceCallFee || 0);
  const labor = Number(job.labor || 0);
  const paidScf = job.scfPayment ? scf : 0;
  const paidLabor = job.laborPayment ? labor : 0;
  const onlyScf = paidScf > 0 && paidLabor === 0;
  const payrollBase = Math.max(
    0,
    (setting.includeScf ? paidScf : 0) + paidLabor - (setting.deductMaterials ? materialsCost : 0),
  );
  const payrollAmount = onlyScf ? setting.scfOnlyPayout : payrollBase * (setting.commissionPercent / 100);
  const payrollItem = payrollItems.find((item) => item.jobId === job.id && item.technicianId === employee.id);
  const warnings = [
    scf > 0 && !job.scfPayment ? 'SCF payment is missing' : '',
    labor > 0 && !job.laborPayment ? 'Labor payment is missing' : '',
    materialsCost > paidScf + paidLabor ? 'Materials exceed collected payments' : '',
    payrollAmount === 0 ? 'No payable payroll yet' : '',
  ].filter(Boolean);

  return {
    ...job,
    materialsCost,
    paidScf,
    paidLabor,
    payrollBase,
    payrollAmount,
    paid: Boolean(payrollItem?.paidAt),
    paidAt: payrollItem?.paidAt?.slice(0, 10) ?? '',
    warnings,
  };
}

export function EmployeeFinancePage({
  companyId,
  openedJob,
  profile,
  paymentMethodOptions,
  materials,
  jobs,
  currentPortalUser,
  onCloseJob,
  onSaveJob,
  onSaveMaterials,
  onCreateInvoice,
  onDeleteInvoice,
  onComposeEmail,
  financePeriod,
  onFinancePeriodChange,
  financeTechFilter,
  onFinanceTechFilterChange,
  payrollRules,
  onPayrollRulesChange,
  onOpenJob,
}: {
  companyId: string;
  openedJob: JobCardData | null;
  profile: CompanyOnboardingProfile;
  paymentMethodOptions: { value: CompanyPaymentMethod; label: string }[];
  materials: MaterialRow[];
  jobs: ServiceJob[];
  currentPortalUser: { name: string; role: 'Manager' | 'Admin' | 'Technician' };
  onCloseJob: () => void;
  onSaveJob: (job: JobCardData) => void;
  onSaveMaterials: (jobNumber: string, rows: MaterialRow[]) => void;
  onCreateInvoice: (job: JobCardData, materials: MaterialRow[], amount: number, documentType: JobDocumentType) => Promise<JobInvoice>;
  onDeleteInvoice: (job: JobCardData, invoiceId: string) => Promise<void>;
  onComposeEmail: (compose: EmailCompose, attachments?: EmailComposeAttachment[]) => void;
  financePeriod: FinancePeriod;
  onFinancePeriodChange: (period: FinancePeriod) => void;
  financeTechFilter: string;
  onFinanceTechFilterChange: (technician: string) => void;
  payrollRules: PayrollRules;
  onPayrollRulesChange: (rules: PayrollRules) => void;
  onOpenJob: (job: ServiceJob) => void;
}) {
  const [settings, setSettings] = useState<EmployeePayrollSetting[]>([]);
  const [payrollItems, setPayrollItems] = useState<PayrollItemRow[]>([]);
  const [periodRows, setPeriodRows] = useState<StaffPayrollPeriod[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [settingDraft, setSettingDraft] = useState<EmployeePayrollSettingInput | null>(null);
  const [periodDraft, setPeriodDraft] = useState<StaffPayrollPeriodInput | null>(null);
  const [selectedCommissionJobs, setSelectedCommissionJobs] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const range = useMemo(() => rangeForPeriod(financePeriod), [financePeriod]);
  const activeEmployees = useMemo(
    () => profile.technicians.filter((employee) => employee.status !== 'disabled'),
    [profile.technicians],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listEmployeePayrollSettings(companyId),
      listStaffPayrollPeriods(companyId),
      listCompanyPayrollItems(companyId),
    ])
      .then(([savedSettings, savedPeriods, savedItems]) => {
        if (cancelled) return;
        setSettings(savedSettings);
        setPeriodRows(savedPeriods);
        setPayrollItems(savedItems);
        setStatus('');
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus(error instanceof Error ? error.message : 'Payroll data could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const settingFor = (employee: CompanyTechnician) => {
    const saved = settings.find((setting) => setting.technicianId === employee.id);
    return saved ? settingInput(saved) : defaultSetting(employee, payrollRules);
  };

  const employeeSummaries = useMemo<EmployeeSummary[]>(() => {
    return activeEmployees.map((employee) => {
      const setting = settingFor(employee);
      const employeeJobs = jobs
        .filter((job) => job.assignee === employee.name && dateInRange(job.createdAt, range))
        .map((job) => commissionJob(job, employee, setting, materials, payrollItems));
      const employeePeriods = periodRows.filter(
        (row) => row.technicianId === employee.id && (!range || (row.periodStart >= range.start && row.periodEnd <= range.end)),
      );
      const periodPayroll = employeePeriods.reduce((sum, row) => sum + row.grossAmount, 0);
      const periodUnpaid = employeePeriods.reduce((sum, row) => sum + (row.paidAt ? 0 : row.grossAmount), 0);
      const virtualSalary = setting.payType === 'salary' && range && !employeePeriods.some((row) => row.periodStart === range.start && row.periodEnd === range.end)
        ? salaryAccrual(setting, financePeriod)
        : 0;
      const commissionPayroll = setting.payType === 'commission'
        ? employeeJobs.reduce((sum, job) => sum + job.payrollAmount, 0)
        : 0;
      const commissionUnpaid = setting.payType === 'commission'
        ? employeeJobs.reduce((sum, job) => sum + (job.paid ? 0 : job.payrollAmount), 0)
        : 0;

      return {
        employee,
        setting,
        jobs: employeeJobs,
        revenue: employeeJobs.reduce((sum, job) => sum + job.paidScf + job.paidLabor, 0),
        materials: employeeJobs.reduce((sum, job) => sum + job.materialsCost, 0),
        payroll: setting.payType === 'commission' ? commissionPayroll : periodPayroll + virtualSalary,
        unpaid: setting.payType === 'commission' ? commissionUnpaid : periodUnpaid + virtualSalary,
        attention: setting.payType === 'commission'
          ? employeeJobs.filter((job) => job.warnings.length > 0).length
          : setting.payType !== 'none' && ((setting.payType === 'hourly' && setting.hourlyRate <= 0) || (setting.payType === 'salary' && setting.salaryAmount <= 0)) ? 1 : 0,
        periodRows: employeePeriods,
      };
    });
  // payrollRules is intentionally included because unsaved employees inherit the company commission defaults.
  }, [activeEmployees, financePeriod, jobs, materials, payrollItems, payrollRules, periodRows, range, settings]);

  const visibleSummaries = employeeSummaries.filter(
    (row) => financeTechFilter === 'all' || row.employee.name === financeTechFilter,
  );
  const selectedSummary = employeeSummaries.find((row) => row.employee.id === selectedEmployeeId);

  useEffect(() => {
    if (!selectedSummary) {
      setSettingDraft(null);
      setPeriodDraft(null);
      return;
    }
    setSettingDraft({ ...selectedSummary.setting });
    if (!range || selectedSummary.setting.payType === 'commission' || selectedSummary.setting.payType === 'none') {
      setPeriodDraft(null);
      return;
    }
    const saved = periodRows.find(
      (row) => row.technicianId === selectedSummary.employee.id && row.periodStart === range.start && row.periodEnd === range.end,
    );
    setPeriodDraft(saved ? {
      technicianId: saved.technicianId,
      periodStart: saved.periodStart,
      periodEnd: saved.periodEnd,
      regularHours: saved.regularHours,
      overtimeHours: saved.overtimeHours,
      grossAmount: saved.grossAmount,
      notes: saved.notes,
      paidAt: saved.paidAt,
    } : {
      technicianId: selectedSummary.employee.id,
      periodStart: range.start,
      periodEnd: range.end,
      regularHours: 0,
      overtimeHours: 0,
      grossAmount: selectedSummary.setting.payType === 'salary' ? salaryAccrual(selectedSummary.setting, financePeriod) : 0,
      notes: '',
      paidAt: '',
    });
  }, [financePeriod, periodRows, range?.end, range?.start, selectedEmployeeId, selectedSummary?.employee.id]);

  const summary = visibleSummaries.reduce(
    (total, row) => ({
      paidRevenue: total.paidRevenue + row.revenue,
      materials: total.materials + row.materials,
      payroll: total.payroll + row.payroll,
      unpaid: total.unpaid + row.unpaid,
    }),
    { paidRevenue: 0, materials: 0, payroll: 0, unpaid: 0 },
  );

  const saveSetting = async () => {
    if (!settingDraft) return;
    setStatus('Saving employee payroll plan...');
    try {
      const saved = await upsertEmployeePayrollSetting(companyId, settingDraft);
      setSettings((current) => [...current.filter((row) => row.technicianId !== saved.technicianId), saved]);
      setStatus('Employee payroll plan saved.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Employee payroll plan could not be saved.');
    }
  };

  const computedPeriodGross = periodDraft && settingDraft
    ? settingDraft.payType === 'hourly'
      ? periodDraft.regularHours * settingDraft.hourlyRate
        + periodDraft.overtimeHours * settingDraft.hourlyRate * settingDraft.overtimeMultiplier
      : periodDraft.grossAmount
    : 0;

  const savePeriod = async (paidAt = periodDraft?.paidAt ?? '') => {
    if (!periodDraft || !settingDraft) return;
    const nextPeriod = { ...periodDraft, grossAmount: computedPeriodGross, paidAt };
    setStatus('Saving payroll period...');
    try {
      const saved = await upsertStaffPayrollPeriod(companyId, nextPeriod);
      setPeriodRows((current) => [...current.filter((row) => row.id !== saved.id && !(
        row.technicianId === saved.technicianId && row.periodStart === saved.periodStart && row.periodEnd === saved.periodEnd
      )), saved]);
      setPeriodDraft({
        technicianId: saved.technicianId,
        periodStart: saved.periodStart,
        periodEnd: saved.periodEnd,
        regularHours: saved.regularHours,
        overtimeHours: saved.overtimeHours,
        grossAmount: saved.grossAmount,
        notes: saved.notes,
        paidAt: saved.paidAt,
      });
      setStatus(saved.paidAt ? 'Payroll period marked paid.' : 'Payroll period saved.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Payroll period could not be saved.');
    }
  };

  const payrollInputForJob = (job: CommissionJobRow, employee: CompanyTechnician, paidAt: string | null): PayrollItemInput => ({
    jobId: job.id,
    technicianId: employee.id,
    collectedCents: dollarsToCents(job.paidScf + job.paidLabor),
    materialsCents: dollarsToCents(job.materialsCost),
    payrollBaseCents: dollarsToCents(job.payrollBase),
    salaryCents: dollarsToCents(job.payrollAmount),
    reviewNote: job.warnings.join(' - '),
    selectedForPayment: false,
    paidAt,
    archivedAt: null,
  });

  const setCommissionJobsPaid = async (summaryRow: EmployeeSummary, jobNumbers: string[], paid: boolean) => {
    const selected = summaryRow.jobs.filter((job) => jobNumbers.includes(job.jobNumber));
    if (!selected.length) return;
    const paidAt = paid ? new Date().toISOString() : null;
    setStatus('Saving commission payroll...');
    try {
      const saved = await upsertCompanyPayrollItems(
        companyId,
        selected.map((job) => payrollInputForJob(job, summaryRow.employee, paidAt)),
      );
      setPayrollItems((current) => {
        const next = new Map(current.map((row) => [`${row.jobId}:${row.technicianId}`, row]));
        saved.forEach((row) => next.set(`${row.jobId}:${row.technicianId}`, row));
        return Array.from(next.values());
      });
      setSelectedCommissionJobs([]);
      setStatus(paid ? 'Commission payroll marked paid.' : 'Commission payroll returned to unpaid.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Commission payroll could not be saved.');
    }
  };

  const exportPayroll = () => {
    const rows = [
      ['Employee', 'Role', 'Pay type', 'Paid revenue', 'Materials', 'Payroll', 'Unpaid'],
      ...visibleSummaries.map((row) => [
        row.employee.name,
        roleLabels[row.employee.role],
        payTypeLabels[row.setting.payType],
        row.revenue.toFixed(2),
        row.materials.toFixed(2),
        row.payroll.toFixed(2),
        row.unpaid.toFixed(2),
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `payroll-${financePeriod}-${isoLocal(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
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

  if (selectedSummary && settingDraft) {
    const unpaidJobs = selectedSummary.jobs.filter((job) => !job.paid);
    const paidJobs = selectedSummary.jobs.filter((job) => job.paid);
    const allUnpaidSelected = unpaidJobs.length > 0 && unpaidJobs.every((job) => selectedCommissionJobs.includes(job.jobNumber));
    return (
      <section className="employee-finance-detail-shell">
        <div className="employee-finance-card fullscreen">
          <div className="employee-finance-detail-header">
            <div>
              <p className="eyebrow">Employee payroll card</p>
              <h1>{selectedSummary.employee.name}</h1>
              <p>{roleLabels[selectedSummary.employee.role]} · {payTypeLabels[settingDraft.payType]}</p>
            </div>
            <button className="secondary-button compact" type="button" onClick={() => setSelectedEmployeeId('')}>Back to finance</button>
          </div>

          <section className="employee-pay-plan-panel">
            <div>
              <p className="eyebrow">Individual conditions</p>
              <h2>Pay plan</h2>
              <p>The plan is assigned to this person only. Company commission rules are used only as defaults.</p>
            </div>
            <div className="employee-pay-plan-controls">
              <label>
                Pay type
                <select value={settingDraft.payType} onChange={(event) => setSettingDraft({ ...settingDraft, payType: event.target.value as EmployeePayType })}>
                  <option value="commission">Commission</option>
                  <option value="hourly">Hourly</option>
                  <option value="salary">Salary</option>
                  <option value="none">No payroll</option>
                </select>
              </label>
              {settingDraft.payType === 'commission' ? (
                <>
                  <label>Commission %<input type="number" min="0" max="100" value={settingDraft.commissionPercent} onChange={(event) => setSettingDraft({ ...settingDraft, commissionPercent: Math.max(0, Number(event.target.value) || 0) })} /></label>
                  <label>SCF-only payout<input type="number" min="0" value={settingDraft.scfOnlyPayout} onChange={(event) => setSettingDraft({ ...settingDraft, scfOnlyPayout: Math.max(0, Number(event.target.value) || 0) })} /></label>
                  <label className="payroll-checkbox"><input type="checkbox" checked={settingDraft.includeScf} onChange={(event) => setSettingDraft({ ...settingDraft, includeScf: event.target.checked })} />Include SCF</label>
                  <label className="payroll-checkbox"><input type="checkbox" checked={settingDraft.deductMaterials} onChange={(event) => setSettingDraft({ ...settingDraft, deductMaterials: event.target.checked })} />Deduct materials</label>
                </>
              ) : null}
              {settingDraft.payType === 'hourly' ? (
                <>
                  <label>Hourly rate<input type="number" min="0" step="0.01" value={settingDraft.hourlyRate} onChange={(event) => setSettingDraft({ ...settingDraft, hourlyRate: Math.max(0, Number(event.target.value) || 0) })} /></label>
                  <label>Overtime multiplier<input type="number" min="1" max="5" step="0.1" value={settingDraft.overtimeMultiplier} onChange={(event) => setSettingDraft({ ...settingDraft, overtimeMultiplier: Math.max(1, Number(event.target.value) || 1.5) })} /></label>
                </>
              ) : null}
              {settingDraft.payType === 'salary' ? (
                <>
                  <label>Salary amount<input type="number" min="0" step="0.01" value={settingDraft.salaryAmount} onChange={(event) => setSettingDraft({ ...settingDraft, salaryAmount: Math.max(0, Number(event.target.value) || 0) })} /></label>
                  <label>Salary frequency<select value={settingDraft.salaryFrequency} onChange={(event) => setSettingDraft({ ...settingDraft, salaryFrequency: event.target.value as EmployeePayrollSettingInput['salaryFrequency'] })}><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Monthly</option></select></label>
                </>
              ) : null}
              <button className="primary-button compact" type="button" onClick={saveSetting}>Save pay plan</button>
            </div>
          </section>

          {settingDraft.payType === 'commission' ? (
            <>
              <div className="employee-finance-metrics">
                <span><strong>{money(selectedSummary.revenue)}</strong>Paid revenue</span>
                <span><strong>{money(selectedSummary.materials)}</strong>Materials</span>
                <span><strong>{money(selectedSummary.payroll)}</strong>Payroll</span>
                <span><strong>{money(selectedSummary.unpaid)}</strong>Unpaid</span>
              </div>
              <div className="payroll-batch-actions">
                <span><strong>{selectedCommissionJobs.length}</strong> selected</span>
                <button className="primary-button compact" type="button" disabled={!selectedCommissionJobs.length} onClick={() => setCommissionJobsPaid(selectedSummary, selectedCommissionJobs, true)}>Confirm selected paid</button>
              </div>
              <section className="employee-finance-section">
                <div className="employee-finance-section-heading"><h2>Unpaid commission</h2><span>{unpaidJobs.length} jobs</span></div>
                <div className="employee-finance-table-wrap">
                  <table className="employee-finance-table">
                    <thead><tr><th><input type="checkbox" checked={allUnpaidSelected} onChange={() => setSelectedCommissionJobs(allUnpaidSelected ? [] : unpaidJobs.map((job) => job.jobNumber))} /></th><th>Job</th><th>Client</th><th>Collected</th><th>Materials</th><th>Payroll</th><th>Review</th></tr></thead>
                    <tbody>
                      {unpaidJobs.map((job) => <tr key={job.id}><td><input type="checkbox" checked={selectedCommissionJobs.includes(job.jobNumber)} onChange={() => setSelectedCommissionJobs((current) => current.includes(job.jobNumber) ? current.filter((number) => number !== job.jobNumber) : [...current, job.jobNumber])} /></td><td><button className="job-number-link" type="button" onClick={() => onOpenJob(job)}>#{job.jobNumber}</button></td><td><strong>{job.organization}</strong><span>{job.clientName}</span></td><td>{money(job.paidScf + job.paidLabor)}</td><td>{money(job.materialsCost)}</td><td>{money(job.payrollAmount)}</td><td>{job.warnings.join(' · ') || 'Ready'}</td></tr>)}
                      {!unpaidJobs.length ? <tr><td colSpan={7}><div className="empty-inline">No unpaid commission jobs.</div></td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </section>
              <details className="employee-finance-section collapsed-payroll"><summary><span>Paid commission</span><strong>{paidJobs.length} jobs</strong></summary><div className="employee-finance-table-wrap"><table className="employee-finance-table"><thead><tr><th>Job</th><th>Client</th><th>Payroll</th><th>Paid</th><th>Action</th></tr></thead><tbody>{paidJobs.map((job) => <tr key={job.id}><td><button className="job-number-link" type="button" onClick={() => onOpenJob(job)}>#{job.jobNumber}</button></td><td>{job.organization}</td><td>{money(job.payrollAmount)}</td><td>{job.paidAt}</td><td><button className="secondary-button compact" type="button" onClick={() => setCommissionJobsPaid(selectedSummary, [job.jobNumber], false)}>Return unpaid</button></td></tr>)}</tbody></table></div></details>
            </>
          ) : null}

          {settingDraft.payType === 'hourly' || settingDraft.payType === 'salary' ? (
            <>
              {range && periodDraft ? (
                <section className="employee-period-panel">
                  <div>
                    <p className="eyebrow">Current payroll period</p>
                    <h2>{range.label}</h2>
                    <p>{periodDraft.paidAt ? `Paid ${periodDraft.paidAt.slice(0, 10)}` : 'Not paid'}</p>
                  </div>
                  <div className="employee-period-controls">
                    {settingDraft.payType === 'hourly' ? (
                      <>
                        <label>Regular hours<input type="number" min="0" step="0.25" value={periodDraft.regularHours} onChange={(event) => setPeriodDraft({ ...periodDraft, regularHours: Math.max(0, Number(event.target.value) || 0) })} /></label>
                        <label>Overtime hours<input type="number" min="0" step="0.25" value={periodDraft.overtimeHours} onChange={(event) => setPeriodDraft({ ...periodDraft, overtimeHours: Math.max(0, Number(event.target.value) || 0) })} /></label>
                        <label>Calculated gross<input value={money(computedPeriodGross)} readOnly /></label>
                      </>
                    ) : (
                      <label>Gross for this period<input type="number" min="0" step="0.01" value={periodDraft.grossAmount} onChange={(event) => setPeriodDraft({ ...periodDraft, grossAmount: Math.max(0, Number(event.target.value) || 0) })} /></label>
                    )}
                    <label>Notes<input value={periodDraft.notes} onChange={(event) => setPeriodDraft({ ...periodDraft, notes: event.target.value })} /></label>
                    <button className="secondary-button compact" type="button" onClick={() => savePeriod(periodDraft.paidAt)}>Save period</button>
                    <button className={periodDraft.paidAt ? 'secondary-button compact' : 'primary-button compact'} type="button" onClick={() => savePeriod(periodDraft.paidAt ? '' : new Date().toISOString())}>{periodDraft.paidAt ? 'Return unpaid' : 'Mark paid'}</button>
                  </div>
                </section>
              ) : <div className="finance-notice">Choose This week or This month to enter hours or salary for a payroll period.</div>}
              <section className="employee-finance-section">
                <div className="employee-finance-section-heading"><h2>Payroll period history</h2><span>{periodRows.filter((row) => row.technicianId === selectedSummary.employee.id).length} periods</span></div>
                <div className="employee-finance-table-wrap"><table className="employee-finance-table"><thead><tr><th>Period</th><th>Regular</th><th>Overtime</th><th>Gross</th><th>Status</th><th>Notes</th></tr></thead><tbody>{periodRows.filter((row) => row.technicianId === selectedSummary.employee.id).map((row) => <tr key={row.id}><td>{row.periodStart} - {row.periodEnd}</td><td>{row.regularHours}</td><td>{row.overtimeHours}</td><td>{money(row.grossAmount)}</td><td>{row.paidAt ? `Paid ${row.paidAt.slice(0, 10)}` : 'Unpaid'}</td><td>{row.notes}</td></tr>)}</tbody></table></div>
              </section>
            </>
          ) : null}

          {settingDraft.payType === 'none' ? <div className="finance-notice">This employee is excluded from payroll calculations.</div> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="finance-page employee-finance-page">
      {status ? <div className="finance-status">{status}</div> : null}
      <div className="finance-header">
        <div><p className="eyebrow">Payroll and money report</p><h1>Finance</h1></div>
        <div className="finance-summary">
          <span><strong>{money(summary.paidRevenue)}</strong>Paid revenue</span>
          <span><strong>{money(summary.materials)}</strong>Materials</span>
          <span><strong>{money(summary.payroll)}</strong>Total payroll</span>
          <span><strong>{money(summary.unpaid)}</strong>Unpaid payroll</span>
        </div>
      </div>
      <div className="finance-toolbar">
        <label>Period<select value={financePeriod} onChange={(event) => onFinancePeriodChange(event.target.value as FinancePeriod)}><option value="this_week">This week</option><option value="this_month">This month</option><option value="all">All time</option></select></label>
        <label>Employee<select value={financeTechFilter} onChange={(event) => onFinanceTechFilterChange(event.target.value)}><option value="all">All employees</option>{activeEmployees.map((employee) => <option value={employee.name} key={employee.id}>{employee.name} · {roleLabels[employee.role]}</option>)}</select></label>
        <button className="secondary-button compact" type="button" onClick={exportPayroll}>Export payroll</button>
      </div>
      <section className="payroll-rules-panel">
        <div><p className="eyebrow">Default technician formula</p><h2>Default commission rules</h2><p>These defaults apply only until an individual commission plan is saved for a technician.</p></div>
        <div className="payroll-rule-controls">
          <label>Commission %<input type="number" min="0" max="100" value={payrollRules.commissionPercent} onChange={(event) => onPayrollRulesChange({ ...payrollRules, commissionPercent: Math.max(0, Number(event.target.value) || 0) })} /></label>
          <label>SCF-only payout<input type="number" min="0" value={payrollRules.scfOnlyPayout} onChange={(event) => onPayrollRulesChange({ ...payrollRules, scfOnlyPayout: Math.max(0, Number(event.target.value) || 0) })} /></label>
          <label className="payroll-checkbox"><input type="checkbox" checked={payrollRules.includeScf} onChange={(event) => onPayrollRulesChange({ ...payrollRules, includeScf: event.target.checked })} />Include SCF</label>
          <label className="payroll-checkbox"><input type="checkbox" checked={payrollRules.deductMaterials} onChange={(event) => onPayrollRulesChange({ ...payrollRules, deductMaterials: event.target.checked })} />Deduct materials</label>
        </div>
      </section>
      {loading ? <div className="finance-notice">Loading payroll plans...</div> : null}
      <section className="employee-payroll-grid">
        {visibleSummaries.map((row) => <button className="employee-payroll-card" key={row.employee.id} type="button" onClick={() => { setSelectedEmployeeId(row.employee.id); onFinanceTechFilterChange(row.employee.name); }}><div className="employee-payroll-card-title"><div><h3>{row.employee.name}</h3><p>{roleLabels[row.employee.role]} · {payTypeLabels[row.setting.payType]}</p></div>{row.attention ? <span className="payroll-attention">Needs setup</span> : null}</div><dl><div><dt>Paid revenue</dt><dd>{money(row.revenue)}</dd></div><div><dt>Materials</dt><dd>{money(row.materials)}</dd></div><div><dt>Payroll</dt><dd>{money(row.payroll)}</dd></div><div><dt>Unpaid</dt><dd>{money(row.unpaid)}</dd></div></dl></button>)}
      </section>
    </section>
  );
}
