import type { Dispatch, SetStateAction } from 'react';
import type { FinancePeriod, PayrollRules } from '../../appTypes';
import { dollarsToCents, findTechnicianId, type PayrollItemInput, type PayrollItemRow } from '../../services/payrollStore';
import type { CompanyOnboardingProfile, MaterialRow, ServiceJob } from '../../types';

type FinanceWorkflowInput = {
  profile: CompanyOnboardingProfile;
  jobs: ServiceJob[];
  materials: MaterialRow[];
  payrollRules: PayrollRules;
  payrollItems: PayrollItemRow[];
  salaryPaidJobs: Record<string, string>;
  financeTechFilter: string;
  financePeriod: FinancePeriod;
  setSalaryPaidJobs: Dispatch<SetStateAction<Record<string, string>>>;
  stopFinanceWrite: (action: string) => boolean;
};

export type FinanceJobRow = ServiceJob & {
  materialsCost: number;
  paidScf: number;
  paidLabor: number;
  salaryBase: number;
  salary: number;
  paid: boolean;
  paidAt: string;
  warrantyPassed: boolean;
  payrollArchived: boolean;
  warnings: string[];
  needsAttention: boolean;
};

export function makeFinanceWorkflow({
  profile,
  jobs,
  materials,
  payrollRules,
  payrollItems,
  salaryPaidJobs,
  financeTechFilter,
  financePeriod,
  setSalaryPaidJobs,
  stopFinanceWrite,
}: FinanceWorkflowInput) {
  const payrollItemByJobId = new globalThis.Map(payrollItems.map((item) => [item.jobId, item]));
  const makePayrollItemInput = (job: FinanceJobRow, paidAt?: string | null): PayrollItemInput | null => {
    const technicianId = findTechnicianId(profile, job.assignee);
    if (!job.id || !technicianId) return null;

    return {
      jobId: job.id,
      technicianId,
      collectedCents: dollarsToCents(job.paidScf + job.paidLabor),
      materialsCents: dollarsToCents(job.materialsCost),
      payrollBaseCents: dollarsToCents(job.salaryBase),
      salaryCents: dollarsToCents(job.salary),
      reviewNote: job.warnings.join(' - '),
      selectedForPayment: false,
      paidAt: paidAt ?? payrollItemByJobId.get(job.id)?.paidAt ?? null,
      archivedAt: job.payrollArchived ? new Date().toISOString() : null,
    };
  };
  const financeRows = jobs.map((job) => {
    const materialsCost = materials
      .filter((material) => material.jobNumber === job.jobNumber)
      .reduce((sum, material) => sum + material.quantity * material.price, 0);
    const scf = Number(job.serviceCallFee || 0);
    const labor = Number(job.labor || 0);
    const paidScf = job.scfPayment ? scf : 0;
    const paidLabor = job.laborPayment ? labor : 0;
    const onlyScf = paidScf > 0 && paidLabor === 0;
    const salaryBase = Math.max(0, (payrollRules.includeScf ? paidScf : 0) + paidLabor - (payrollRules.deductMaterials ? materialsCost : 0));
    const salary = onlyScf ? payrollRules.scfOnlyPayout : salaryBase * (payrollRules.commissionPercent / 100);
    const paidAt = payrollItemByJobId.get(job.id)?.paidAt?.slice(0, 10) ?? salaryPaidJobs[job.jobNumber] ?? '';
    const paid = Boolean(paidAt);
    const warrantyEndTime = new Date(job.createdAt).getTime() + profile.warrantyDays * 24 * 60 * 60 * 1000;
    const warrantyPassed = warrantyEndTime <= Date.now();
    const payrollArchived = paid && warrantyPassed;
    const warnings = [
      job.assignee === 'No technician' ? 'No technician assigned' : '',
      scf > 0 && !job.scfPayment ? 'SCF payment is missing' : '',
      labor > 0 && !job.laborPayment ? 'Labor payment is missing' : '',
      materialsCost > paidScf + paidLabor ? 'Materials exceed collected payments' : '',
      !paid && salary === 0 ? 'No payable payroll yet' : '',
    ].filter(Boolean);
    const needsAttention = warnings.length > 0;

    return {
      ...job,
      materialsCost,
      paidScf,
      paidLabor,
      salaryBase,
      salary,
      paid,
      paidAt,
      warrantyPassed,
      payrollArchived,
      warnings,
      needsAttention,
    };
  });
  const financeBaseRows = financeRows.filter((job) => {
    const matchesTech = financeTechFilter === 'all' || job.assignee === financeTechFilter;
    const matchesPeriod =
      financePeriod === 'all' ||
      (financePeriod === 'this_week' ? job.createdAt >= '2026-06-07' : job.createdAt >= '2026-06-01');

    return matchesTech && matchesPeriod;
  });
  const financeSummary = financeBaseRows.reduce(
    (summary, job) => {
      summary.paidRevenue += job.paidScf + job.paidLabor;
      summary.materials += job.materialsCost;
      summary.salary += job.salary;
      summary.unpaidSalary += job.paid ? 0 : job.salary;
      return summary;
    },
    { paidRevenue: 0, materials: 0, salary: 0, unpaidSalary: 0 },
  );
  const technicianPayroll = profile.technicians.map((technician) => {
    const rows = financeBaseRows.filter((job) => job.assignee === technician.name);
    return {
      technician,
      jobs: rows.length,
      revenue: rows.reduce((sum, job) => sum + job.paidScf + job.paidLabor, 0),
      materials: rows.reduce((sum, job) => sum + job.materialsCost, 0),
      salary: rows.reduce((sum, job) => sum + job.salary, 0),
      unpaid: rows.reduce((sum, job) => sum + (job.paid ? 0 : job.salary), 0),
      attention: rows.filter((job) => job.needsAttention).length,
    };
  });

  function toggleSalaryPaid(jobNumber: string) {
    if (stopFinanceWrite('updating payroll')) return;

    setSalaryPaidJobs((paidJobs) => {
      if (paidJobs[jobNumber]) {
        const nextJobs = { ...paidJobs };
        delete nextJobs[jobNumber];
        return nextJobs;
      }

      return { ...paidJobs, [jobNumber]: new Date().toISOString().slice(0, 10) };
    });
  }

  function markSalaryJobsPaid(jobNumbers: string[]) {
    if (stopFinanceWrite('updating payroll')) return;
    if (!jobNumbers.length) return;
    const paidAt = new Date().toISOString().slice(0, 10);
    setSalaryPaidJobs((paidJobs) => ({
      ...paidJobs,
      ...Object.fromEntries(jobNumbers.map((jobNumber) => [jobNumber, paidAt])),
    }));
  }

  return {
    financeRows,
    financeBaseRows,
    financeSummary,
    technicianPayroll,
    makePayrollItemInput,
    toggleSalaryPaid,
    markSalaryJobsPaid,
  };
}
