import { sqlEq, supabaseRequest } from './supabaseRest';

export type EmployeePayType = 'commission' | 'hourly' | 'salary' | 'none';
export type EmployeeSalaryFrequency = 'weekly' | 'biweekly' | 'monthly';

export type EmployeePayrollSetting = {
  id: string;
  companyId: string;
  technicianId: string;
  payType: EmployeePayType;
  hourlyRate: number;
  overtimeMultiplier: number;
  salaryAmount: number;
  salaryFrequency: EmployeeSalaryFrequency;
  commissionPercent: number;
  scfOnlyPayout: number;
  includeScf: boolean;
  deductMaterials: boolean;
  createdAt: string;
  updatedAt: string;
};

export type EmployeePayrollSettingInput = Omit<EmployeePayrollSetting, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>;

export type StaffPayrollPeriod = {
  id: string;
  companyId: string;
  technicianId: string;
  periodStart: string;
  periodEnd: string;
  regularHours: number;
  overtimeHours: number;
  grossAmount: number;
  notes: string;
  paidAt: string;
  createdAt: string;
  updatedAt: string;
};

export type StaffPayrollPeriodInput = Omit<StaffPayrollPeriod, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>;

type DbEmployeePayrollSetting = {
  id: string;
  company_id: string;
  technician_id: string;
  pay_type: EmployeePayType;
  hourly_rate_cents: number;
  overtime_multiplier: number;
  salary_amount_cents: number;
  salary_frequency: EmployeeSalaryFrequency;
  commission_percent: number;
  scf_only_payout_cents: number;
  include_scf: boolean;
  deduct_materials: boolean;
  created_at: string;
  updated_at: string;
};

type DbStaffPayrollPeriod = {
  id: string;
  company_id: string;
  technician_id: string;
  period_start: string;
  period_end: string;
  regular_hours: number;
  overtime_hours: number;
  gross_cents: number;
  notes: string;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

const moneyFromCents = (value: number | null | undefined) => Math.round(Number(value ?? 0)) / 100;
const moneyToCents = (value: number) => Math.max(0, Math.round((Number.isFinite(value) ? value : 0) * 100));

const settingFromDb = (row: DbEmployeePayrollSetting): EmployeePayrollSetting => ({
  id: row.id,
  companyId: row.company_id,
  technicianId: row.technician_id,
  payType: row.pay_type,
  hourlyRate: moneyFromCents(row.hourly_rate_cents),
  overtimeMultiplier: Number(row.overtime_multiplier) || 1.5,
  salaryAmount: moneyFromCents(row.salary_amount_cents),
  salaryFrequency: row.salary_frequency,
  commissionPercent: Number(row.commission_percent) || 0,
  scfOnlyPayout: moneyFromCents(row.scf_only_payout_cents),
  includeScf: row.include_scf,
  deductMaterials: row.deduct_materials,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const settingToDb = (companyId: string, row: EmployeePayrollSettingInput) => ({
  company_id: companyId,
  technician_id: row.technicianId,
  pay_type: row.payType,
  hourly_rate_cents: moneyToCents(row.hourlyRate),
  overtime_multiplier: Math.max(1, Math.min(5, Number(row.overtimeMultiplier) || 1.5)),
  salary_amount_cents: moneyToCents(row.salaryAmount),
  salary_frequency: row.salaryFrequency,
  commission_percent: Math.max(0, Math.min(100, Number(row.commissionPercent) || 0)),
  scf_only_payout_cents: moneyToCents(row.scfOnlyPayout),
  include_scf: Boolean(row.includeScf),
  deduct_materials: Boolean(row.deductMaterials),
});

const periodFromDb = (row: DbStaffPayrollPeriod): StaffPayrollPeriod => ({
  id: row.id,
  companyId: row.company_id,
  technicianId: row.technician_id,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  regularHours: Number(row.regular_hours) || 0,
  overtimeHours: Number(row.overtime_hours) || 0,
  grossAmount: moneyFromCents(row.gross_cents),
  notes: row.notes ?? '',
  paidAt: row.paid_at ?? '',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const periodToDb = (companyId: string, row: StaffPayrollPeriodInput) => ({
  company_id: companyId,
  technician_id: row.technicianId,
  period_start: row.periodStart,
  period_end: row.periodEnd,
  regular_hours: Math.max(0, Number(row.regularHours) || 0),
  overtime_hours: Math.max(0, Number(row.overtimeHours) || 0),
  gross_cents: moneyToCents(row.grossAmount),
  notes: row.notes.trim(),
  paid_at: row.paidAt || null,
});

export async function listEmployeePayrollSettings(companyId: string): Promise<EmployeePayrollSetting[]> {
  const rows = await supabaseRequest<DbEmployeePayrollSetting[]>(
    `employee_payroll_settings?company_id=${sqlEq(companyId)}&select=*&order=created_at.asc`,
  );
  return rows.map(settingFromDb);
}

export async function upsertEmployeePayrollSetting(
  companyId: string,
  row: EmployeePayrollSettingInput,
): Promise<EmployeePayrollSetting> {
  const [saved] = await supabaseRequest<DbEmployeePayrollSetting[]>(
    'employee_payroll_settings?on_conflict=company_id,technician_id&select=*',
    {
      method: 'POST',
      body: [settingToDb(companyId, row)],
      prefer: 'resolution=merge-duplicates,return=representation',
      select: true,
    },
  );
  if (!saved) throw new Error('Employee payroll settings could not be saved.');
  return settingFromDb(saved);
}

export async function listStaffPayrollPeriods(companyId: string): Promise<StaffPayrollPeriod[]> {
  const rows = await supabaseRequest<DbStaffPayrollPeriod[]>(
    `staff_payroll_periods?company_id=${sqlEq(companyId)}&select=*&order=period_start.desc`,
  );
  return rows.map(periodFromDb);
}

export async function upsertStaffPayrollPeriod(
  companyId: string,
  row: StaffPayrollPeriodInput,
): Promise<StaffPayrollPeriod> {
  const [saved] = await supabaseRequest<DbStaffPayrollPeriod[]>(
    'staff_payroll_periods?on_conflict=company_id,technician_id,period_start,period_end&select=*',
    {
      method: 'POST',
      body: [periodToDb(companyId, row)],
      prefer: 'resolution=merge-duplicates,return=representation',
      select: true,
    },
  );
  if (!saved) throw new Error('Payroll period could not be saved.');
  return periodFromDb(saved);
}
