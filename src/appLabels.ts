import type {
  AuditEventCategory,
  BillingStatus,
  Company,
  CompanyPaymentMethod,
  CompanyStatus,
  PlatformUserRole,
  PlatformUserStatus,
  SupportTicketKind,
  SupportTicketPriority,
  SupportTicketStatus,
} from './types';

export const paymentMethodLabels: Record<CompanyPaymentMethod, string> = {
  ach: 'ACH',
  zelle: 'Zelle',
  venmo: 'Venmo',
  cash_app: 'Cash App',
  paypal: 'PayPal',
  credit_card: 'Credit card',
  debit_card: 'Debit card',
  check: 'Check',
  cash: 'Cash',
  wire_transfer: 'Wire transfer',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  stripe: 'Stripe',
  square: 'Square',
  financing: 'Financing',
};

export const statusLabels: Record<CompanyStatus, string> = {
  active: 'Active',
  trial: 'Trial',
  paused: 'Paused',
  setup: 'Setup',
};

export const billingLabels: Record<BillingStatus, string> = {
  paid: 'Paid',
  trialing: 'Trialing',
  overdue: 'Overdue',
  not_started: 'Not started',
};

export const stepLabels: Record<keyof Company['onboarding'], string> = {
  workspace: 'Workspace',
  users: 'Users',
  data: 'Data import',
  billing: 'Billing',
};

export const ticketStatusLabels: Record<SupportTicketStatus, string> = {
  new: 'New',
  reviewing: 'Reviewing',
  planned: 'Planned',
  resolved: 'Resolved',
};

export const ticketKindLabels: Record<SupportTicketKind, string> = {
  bug: 'Bug',
  change: 'Change',
  question: 'Question',
};

export const ticketPriorityLabels: Record<SupportTicketPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  urgent: 'Urgent',
};

export const platformRoleLabels: Record<PlatformUserRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  support: 'Support',
  viewer: 'Viewer',
};

export const platformStatusLabels: Record<PlatformUserStatus, string> = {
  active: 'Active',
  invited: 'Invited',
  disabled: 'Disabled',
};

export const auditCategoryLabels: Record<AuditEventCategory, string> = {
  tenant: 'Tenant',
  billing: 'Billing',
  access: 'Access',
  support: 'Support',
};
