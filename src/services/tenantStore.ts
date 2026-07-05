import type { Company, NewCompanyForm, OnboardingStepKey, OnboardingStepStatus } from '../types';
import { getPlan } from './billingCatalog';
import { isSupabaseConfigured } from './supabaseRest';

export const onboardingStepOrder: OnboardingStepKey[] = ['workspace', 'users', 'data', 'billing'];
const COMPANIES_STORAGE_KEY = 'servicescope.companies';

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

export function listCompanies(): Company[] {
  if (isSupabaseConfigured() || typeof window === 'undefined') return [];

  const saved = window.localStorage.getItem(COMPANIES_STORAGE_KEY);
  if (!saved) return [];

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed as Company[] : [];
  } catch {
    return [];
  }
}

export function saveCompanies(companies: Company[]) {
  if (typeof window === 'undefined') return;

  if (isSupabaseConfigured()) {
    window.localStorage.removeItem(COMPANIES_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(COMPANIES_STORAGE_KEY, JSON.stringify(companies));
}

export function createCompany(form: NewCompanyForm): Company {
  const slug = slugify(form.domain || form.name);
  const plan = getPlan(form.plan);

  return {
    id: crypto.randomUUID(),
    ...form,
    domain: form.domain || `${slug}.servicescope.app`,
    billingStatus: form.status === 'trial' ? 'trialing' : 'not_started',
    seats: plan.seats,
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
