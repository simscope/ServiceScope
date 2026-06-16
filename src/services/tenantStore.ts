import type { Company, NewCompanyForm, OnboardingStepKey, OnboardingStepStatus } from '../types';

const STORAGE_KEY = 'servicescope.v2.companies';

export const onboardingStepOrder: OnboardingStepKey[] = ['workspace', 'users', 'data', 'billing'];

const stepNames: Record<OnboardingStepKey, string> = {
  workspace: 'workspace',
  users: 'users',
  data: 'data',
  billing: 'billing',
};

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function normalizeCompany(company: Partial<Company>): Company {
  return {
    id: company.id ?? crypto.randomUUID(),
    name: company.name ?? 'New company',
    ownerName: company.ownerName ?? 'Owner',
    ownerEmail: company.ownerEmail ?? '',
    temporaryPassword: company.temporaryPassword ?? '',
    domain: company.domain ?? '',
    market: company.market ?? 'Unassigned market',
    plan: company.plan ?? 'Launch',
    status: company.status ?? 'setup',
    billingStatus: company.billingStatus ?? 'not_started',
    seats: company.seats ?? 5,
    technicians: company.technicians ?? 0,
    openJobs: company.openJobs ?? 0,
    revenue: company.revenue ?? 0,
    health: company.health ?? 58,
    lastSync: company.lastSync ?? 'Not synced',
    onboarding: company.onboarding ?? {
      workspace: 'current',
      users: 'todo',
      data: 'todo',
      billing: 'blocked',
    },
    alerts: company.alerts ?? [],
    usage: company.usage ?? {
      jobsThisMonth: 0,
      invoicesThisMonth: 0,
      storageGb: 0,
    },
  };
}

export function listCompanies() {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return [];

  try {
    return (JSON.parse(saved) as Partial<Company>[]).map(normalizeCompany);
  } catch {
    return [];
  }
}

export function saveCompanies(companies: Company[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(companies));
}

export function createCompany(form: NewCompanyForm): Company {
  const slug = slugify(form.domain || form.name);

  return {
    id: crypto.randomUUID(),
    ...form,
    domain: form.domain || `${slug}.servicescope.app`,
    billingStatus: form.status === 'trial' ? 'trialing' : 'not_started',
    seats: form.plan === 'Scale' ? 30 : form.plan === 'Growth' ? 15 : 5,
    technicians: 0,
    openJobs: 0,
    revenue: 0,
    health: form.status === 'active' ? 82 : 58,
    lastSync: 'Just added',
    onboarding: {
      workspace: 'done',
      users: 'current',
      data: 'todo',
      billing: form.status === 'trial' ? 'todo' : 'blocked',
    },
    alerts: ['Finish owner onboarding'],
    usage: {
      jobsThisMonth: 0,
      invoicesThisMonth: 0,
      storageGb: 0,
    },
  };
}

export function completeOnboardingStep(company: Company, step: OnboardingStepKey): Company {
  const nextOnboarding = { ...company.onboarding, [step]: 'done' as OnboardingStepStatus };
  const nextStep = onboardingStepOrder.find((candidate) => nextOnboarding[candidate] !== 'done');

  if (nextStep) {
    nextOnboarding[nextStep] = 'current';
  }

  const complete = onboardingStepOrder.every((candidate) => nextOnboarding[candidate] === 'done');

  return {
    ...company,
    onboarding: nextOnboarding,
    status: complete ? 'active' : company.status,
    billingStatus: complete ? 'paid' : step === 'billing' ? 'paid' : company.billingStatus,
    health: complete ? Math.max(company.health, 88) : Math.min(company.health + 6, 86),
    lastSync: complete ? 'Ready now' : 'Provisioning updated',
    alerts: complete
      ? []
      : company.alerts.filter((alert) => !alert.toLowerCase().includes(stepNames[step])),
  };
}

export function prepareNextOnboardingStep(company: Company) {
  const nextStep = onboardingStepOrder.find((step) => company.onboarding[step] !== 'done');
  return nextStep ? completeOnboardingStep(company, nextStep) : company;
}
