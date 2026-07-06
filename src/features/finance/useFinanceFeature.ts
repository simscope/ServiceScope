import { useState } from 'react';
import type { FinancePeriod, PayrollRules } from '../../appTypes';
import type { PayrollItemRow } from '../../services/payrollStore';

const SALARY_PAID_STORAGE_KEY = 'servicescope.finance.salaryPaidJobs';

function readSalaryPaidJobs(): Record<string, string> {
  const saved = window.localStorage.getItem(SALARY_PAID_STORAGE_KEY);
  if (!saved) return {};

  try {
    const parsed = JSON.parse(saved);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

export function useFinanceFeature() {
  const [financePeriod, setFinancePeriod] = useState<FinancePeriod>('this_month');
  const [financeTechFilter, setFinanceTechFilter] = useState('all');
  const [payrollRules, setPayrollRules] = useState<PayrollRules>({
    commissionPercent: 50,
    scfOnlyPayout: 50,
    deductMaterials: true,
    includeScf: true,
  });
  const [salaryPaidJobs, setSalaryPaidJobs] = useState<Record<string, string>>(() => readSalaryPaidJobs());
  const [payrollItems, setPayrollItems] = useState<PayrollItemRow[]>([]);

  return {
    financePeriod,
    setFinancePeriod,
    financeTechFilter,
    setFinanceTechFilter,
    payrollRules,
    setPayrollRules,
    salaryPaidJobs,
    setSalaryPaidJobs,
    payrollItems,
    setPayrollItems,
  };
}
