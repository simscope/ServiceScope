import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const page = read('src/components/portal/EmployeeFinancePage.tsx');
const store = read('src/services/employeePayrollStore.ts');
const renderer = read('src/components/portal/ClientBusinessPageRenderer.tsx');
const migration = read('supabase/migrations/20260723023000_employee_payroll_plans.sql');

const checks = [
  [page.includes("payType: employee.role === 'technician' ? 'commission' : 'hourly'"), 'role defaults keep technicians on commission and office staff hourly'],
  [page.includes('<option value="commission">Commission</option>') && page.includes('<option value="hourly">Hourly</option>') && page.includes('<option value="salary">Salary</option>'), 'employee pay type selector is present'],
  [page.includes('Regular hours') && page.includes('Overtime hours') && page.includes('Overtime multiplier'), 'hourly payroll supports regular and overtime hours'],
  [page.includes('Salary amount') && page.includes('Salary frequency') && page.includes('Gross for this period'), 'salary payroll supports frequency and period gross'],
  [page.includes('upsertCompanyPayrollItems') && page.includes('upsertStaffPayrollPeriod'), 'commission and period payroll persist to Supabase'],
  [store.includes('employee_payroll_settings?on_conflict=company_id,technician_id') && store.includes('staff_payroll_periods?on_conflict=company_id,technician_id,period_start,period_end'), 'pay plans and periods use idempotent upserts'],
  [renderer.includes('EmployeeFinancePage') && renderer.includes('jobs={allJobsRows}'), 'finance renderer uses the employee payroll page'],
  [migration.includes('CREATE TABLE IF NOT EXISTS public.employee_payroll_settings') && migration.includes('CREATE TABLE IF NOT EXISTS public.staff_payroll_periods'), 'migration creates both payroll tables'],
  [migration.includes('public.can_manage_company(company_id)') && migration.includes('public.can_access_company(company_id)'), 'payroll tables are protected by company RLS'],
];

const failures = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) {
  console.error('Employee payroll regression checks failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Employee payroll regression checks passed (${checks.length}/${checks.length}).`);
