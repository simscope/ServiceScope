import type { Company, CompanyPlan, PlanDefinition } from '../types';

export const plans: PlanDefinition[] = [
  {
    name: 'Launch',
    price: 149,
    seats: 5,
    technicians: 8,
    storageGb: 10,
    support: 'Email',
    entitlements: ['Jobs', 'Invoices', 'Customer records', 'Basic support'],
  },
  {
    name: 'Growth',
    price: 299,
    seats: 10,
    technicians: 15,
    storageGb: 30,
    support: 'Priority',
    entitlements: ['Everything in Launch', 'Technician map', 'Finance view', 'Priority support'],
  },
  {
    name: 'Scale',
    price: 549,
    seats: 20,
    technicians: 50,
    storageGb: 100,
    support: 'Dedicated',
    entitlements: ['Everything in Growth', 'Advanced monitoring', 'Custom onboarding', 'Dedicated support'],
  },
];

export function getPlan(planName: CompanyPlan) {
  return plans.find((plan) => plan.name === planName) ?? plans[0];
}

export function applyPlan(company: Company, planName: CompanyPlan): Company {
  const plan = getPlan(planName);

  return {
    ...company,
    plan: plan.name,
    seats: plan.seats,
    health: Math.min(Math.max(company.health, 70), 95),
    lastSync: 'Plan updated',
  };
}
