import type { CompanyOnboardingProfile } from '../types';
import { sqlEq, supabaseRequest } from './supabaseRest';

export type PayrollItemRow = {
  id: string;
  companyId: string;
  payrollBatchId: string;
  jobId: string;
  technicianId: string;
  collectedCents: number;
  materialsCents: number;
  payrollBaseCents: number;
  salaryCents: number;
  reviewNote: string;
  selectedForPayment: boolean;
  paidAt: string;
  archivedAt: string;
  createdAt: string;
  updatedAt: string;
};

type DbPayrollItem = {
  id: string;
  company_id: string;
  payroll_batch_id: string | null;
  job_id: string;
  technician_id: string;
  collected_cents: number;
  materials_cents: number;
  payroll_base_cents: number;
  salary_cents: number;
  review_note: string;
  selected_for_payment: boolean;
  paid_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PayrollItemInput = {
  jobId: string;
  technicianId: string;
  collectedCents: number;
  materialsCents: number;
  payrollBaseCents: number;
  salaryCents: number;
  reviewNote: string;
  selectedForPayment?: boolean;
  paidAt?: string | null;
  archivedAt?: string | null;
};

const payrollItemFromDb = (row: DbPayrollItem): PayrollItemRow => ({
  id: row.id,
  companyId: row.company_id,
  payrollBatchId: row.payroll_batch_id ?? '',
  jobId: row.job_id,
  technicianId: row.technician_id,
  collectedCents: row.collected_cents,
  materialsCents: row.materials_cents,
  payrollBaseCents: row.payroll_base_cents,
  salaryCents: row.salary_cents,
  reviewNote: row.review_note,
  selectedForPayment: row.selected_for_payment,
  paidAt: row.paid_at ?? '',
  archivedAt: row.archived_at ?? '',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const payrollItemToDb = (companyId: string, row: PayrollItemInput) => ({
  company_id: companyId,
  job_id: row.jobId,
  technician_id: row.technicianId,
  collected_cents: Math.max(0, Math.round(row.collectedCents || 0)),
  materials_cents: Math.max(0, Math.round(row.materialsCents || 0)),
  payroll_base_cents: Math.max(0, Math.round(row.payrollBaseCents || 0)),
  salary_cents: Math.max(0, Math.round(row.salaryCents || 0)),
  review_note: row.reviewNote ?? '',
  selected_for_payment: Boolean(row.selectedForPayment),
  paid_at: row.paidAt || null,
  archived_at: row.archivedAt || null,
});

export function dollarsToCents(value: number) {
  return Math.max(0, Math.round((Number.isFinite(value) ? value : 0) * 100));
}

export function findTechnicianId(profile: CompanyOnboardingProfile, technicianName: string) {
  return profile.technicians.find((technician) => technician.name === technicianName)?.id ?? '';
}

export async function listCompanyPayrollItems(companyId: string) {
  const rows = await supabaseRequest<DbPayrollItem[]>(`payroll_items?company_id=${sqlEq(companyId)}&select=*`);
  return rows.map(payrollItemFromDb);
}

export async function upsertCompanyPayrollItems(companyId: string, rows: PayrollItemInput[]) {
  const cleanRows = rows.filter((row) => row.jobId && row.technicianId);
  if (!cleanRows.length) return [] as PayrollItemRow[];

  const savedRows = await supabaseRequest<DbPayrollItem[]>('payroll_items?on_conflict=company_id,job_id,technician_id', {
    method: 'POST',
    body: cleanRows.map((row) => payrollItemToDb(companyId, row)),
    prefer: 'resolution=merge-duplicates,return=representation',
    select: true,
  });

  return savedRows.map(payrollItemFromDb);
}
