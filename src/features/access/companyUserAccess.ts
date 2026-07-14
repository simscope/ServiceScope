import type {
  CompanyAccessRules,
  CompanyPortalAccessLevel,
  CompanyPortalAccessPage,
  CompanyTechnicianRole,
} from '../../types';

export const companyUserPageAccessDefinitions: Array<{
  page: CompanyPortalAccessPage;
  label: string;
  detail: string;
}> = [
  { page: 'jobInbox', label: 'Job Inbox', detail: 'Incoming leads and requests' },
  { page: 'jobs', label: 'Jobs', detail: 'Create and manage jobs' },
  { page: 'allJobs', label: 'All Jobs', detail: 'Search the full job board' },
  { page: 'debtors', label: 'Debtors', detail: 'Unpaid work and blacklist' },
  { page: 'calendar', label: 'Calendar', detail: 'Schedule and appointments' },
  { page: 'materials', label: 'Materials', detail: 'Parts and stock' },
  { page: 'tasks', label: 'Tasks', detail: 'Team task list' },
  { page: 'map', label: 'Map', detail: 'Technician locations' },
  { page: 'email', label: 'Email', detail: 'Company mailbox' },
  { page: 'finances', label: 'Finance', detail: 'Payments and payroll' },
  { page: 'knowledge', label: 'Library', detail: 'Service documents' },
  { page: 'import', label: 'Import', detail: 'Data migration tools' },
  { page: 'portal', label: 'Support', detail: 'Support requests' },
  { page: 'onboarding', label: 'Onboarding', detail: 'Owner only' },
];

const staffPages = companyUserPageAccessDefinitions.filter(({ page }) => page !== 'onboarding');

export function defaultCompanyUserPageAccess(role: CompanyTechnicianRole): CompanyAccessRules {
  if (role === 'technician') return { onboarding: 'off' };

  return Object.fromEntries([
    ...staffPages.map(({ page }) => [page, 'full' as const]),
    ['onboarding', 'off' as const],
  ]) as CompanyAccessRules;
}

export function normalizeCompanyUserPageAccess(
  pageAccess: CompanyAccessRules | null | undefined,
  role: CompanyTechnicianRole,
): CompanyAccessRules {
  return { ...defaultCompanyUserPageAccess(role), ...(pageAccess ?? {}), onboarding: 'off' };
}

export function combineAccessLevels(
  companyLevel: CompanyPortalAccessLevel,
  userLevel: CompanyPortalAccessLevel,
): CompanyPortalAccessLevel {
  if (companyLevel === 'off' || userLevel === 'off') return 'off';
  if (companyLevel === 'readonly' || userLevel === 'readonly') return 'readonly';
  return 'full';
}
