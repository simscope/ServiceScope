import type {
  BillingStatus,
  Company,
  CompanyAccessRules,
  CompanyJobPriority,
  CompanyJobType,
  CompanyOnboardingProfile,
  CompanyPaymentMethod,
  CompanyPlan,
  CompanyStatus,
  CompanyTechnician,
  OnboardingStepStatus,
} from '../types';
import { createDefaultCompanyOnboardingProfile } from './companyOnboardingStore';
import { isSupabaseConfigured, supabaseRequest } from './supabaseRest';
import { onboardingStepOrder } from './tenantStore';

type DbCompany = {
  id: string;
  name: string;
  owner_name: string;
  owner_email: string;
  temporary_password?: string;
  domain: string | null;
  market: string;
  status: string;
  billing_status: string;
  seats_count: number;
  technicians_count: number;
  open_jobs_count: number;
  revenue_cents: number;
  health_score: number;
  last_sync_label: string;
  plans?: { name?: string | null } | null;
};

type DbOnboardingStep = {
  company_id: string;
  step_key: string;
  status: string;
};

type DbAlert = {
  company_id: string;
  title: string;
};

type DbCompanyProfile = {
  company_id: string;
  legal_name: string;
  display_name: string;
  logo_storage_path: string | null;
  website: string | null;
  phone: string | null;
  billing_email: string | null;
  service_address: string | null;
  service_area: string | null;
  timezone: string;
  emergency_contact: string | null;
  website_intake_enabled: boolean | null;
  website_intake_token: string | null;
  website_intake_allowed_origins: string | null;
  access_rules: CompanyAccessRules | null;
};

type DbWorkflow = {
  company_id: string;
  job_assignment_mode: CompanyOnboardingProfile['jobAssignmentMode'];
  use_job_number_prefixes: boolean;
  default_job_number_prefix: string;
  default_service_call_fee_cents: number;
  default_job_priority: CompanyJobPriority;
  warranty_days: number;
  auto_archive_completed_after_days: number;
  auto_archive_cancelled_after_days: number;
  require_completion_note: boolean;
  require_completion_photo: boolean;
  allow_warranty_reopen: boolean;
  payment_notes: string;
};

type DbJobType = {
  id: string;
  company_id: string;
  name: string;
  job_number_prefix: string;
  default_duration_minutes: number;
  default_priority: CompanyJobPriority;
  requires_parts: boolean;
};

type DbPaymentMethod = {
  company_id: string;
  method: CompanyPaymentMethod;
  details: Record<string, string | undefined> | null;
};

type DbTechnician = {
  id: string;
  company_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  access_password?: string;
  role: CompanyTechnician['role'];
  status: CompanyTechnician['status'];
  assigned_jobs_count: number;
};

type DbCompanyUser = {
  id: string;
  company_id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'dispatcher' | 'technician';
  status: CompanyTechnician['status'];
};

type DbSubscriptionPayment = {
  company_id: string;
  status: CompanyOnboardingProfile['subscriptionPaymentStatus'];
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  billing_name: string | null;
  billing_zip: string | null;
  autopay_enabled: boolean;
};

const WORKSPACE_COMPANY_LIMIT = 100;
const WORKSPACE_CHILD_LIMIT = 500;

function dollars(cents: number | null | undefined) {
  return Math.round(Number(cents ?? 0)) / 100;
}

function makeWebsite(value: string) {
  const normalized = value.trim();
  if (!normalized) return '';
  const protocol = normalized.match(/^https?:\/\//i)?.[0] ?? 'https://';
  const address = normalized.replace(/^(https?:\/\/)+/i, '');

  return `${protocol}${address}`;
}

function profileWebsiteFromDb(savedWebsite: string | null | undefined, company: Company, fallbackWebsite: string) {
  const normalizedSavedWebsite = makeWebsite(savedWebsite ?? '');
  const legacyPlaceholder = !normalizedSavedWebsite || normalizedSavedWebsite === 'https://company.com';

  return legacyPlaceholder ? makeWebsite(company.domain || fallbackWebsite) : normalizedSavedWebsite;
}

function mapStatus(status: string): CompanyStatus {
  return status === 'active' || status === 'trial' || status === 'paused' || status === 'setup' ? status : 'paused';
}

function mapBillingStatus(status: string): BillingStatus {
  return status === 'paid' || status === 'trialing' || status === 'overdue' || status === 'not_started' ? status : 'overdue';
}

function mapPlan(plan: string | null | undefined): CompanyPlan {
  return plan === 'Growth' || plan === 'Scale' ? plan : 'Launch';
}

function mapOnboardingStatus(status: string): OnboardingStepStatus {
  return status === 'done' || status === 'current' || status === 'blocked' || status === 'todo' ? status : 'todo';
}

function companyFilter(companyIds: string[]) {
  if (!companyIds.length) return '';
  return `&company_id=in.(${companyIds.map((id) => encodeURIComponent(id)).join(',')})`;
}

function companyFromDb(row: DbCompany, steps: DbOnboardingStep[], alerts: DbAlert[]): Company {
  const onboarding = onboardingStepOrder.reduce((acc, step) => {
    const savedStep = steps.find((candidate) => candidate.company_id === row.id && candidate.step_key === step);
    acc[step] = savedStep ? mapOnboardingStatus(savedStep.status) : step === 'workspace' ? 'current' : 'todo';
    return acc;
  }, {} as Company['onboarding']);

  return {
    id: row.id,
    name: row.name,
    ownerName: row.owner_name,
    phone: '',
    ownerEmail: row.owner_email,
    temporaryPassword: row.temporary_password ?? '',
    domain: row.domain ?? '',
    market: row.market,
    plan: mapPlan(row.plans?.name),
    status: mapStatus(row.status),
    billingStatus: mapBillingStatus(row.billing_status),
    seats: row.seats_count,
    technicians: row.technicians_count,
    openJobs: row.open_jobs_count,
    revenue: dollars(row.revenue_cents),
    health: row.health_score,
    lastSync: row.last_sync_label,
    onboarding,
    alerts: alerts.filter((alert) => alert.company_id === row.id).map((alert) => alert.title),
    usage: {
      jobsThisMonth: row.open_jobs_count,
      invoicesThisMonth: 0,
      storageGb: 0,
    },
  };
}

function profileFromDb(
  company: Company,
  profileRow: DbCompanyProfile | undefined,
  workflow: DbWorkflow | undefined,
  jobTypes: DbJobType[],
  paymentMethods: DbPaymentMethod[],
  technicians: DbTechnician[],
  companyUsers: DbCompanyUser[],
  subscriptionPayment: DbSubscriptionPayment | undefined,
): CompanyOnboardingProfile {
  const defaults = createDefaultCompanyOnboardingProfile(company);
  const enabledPayments = paymentMethods.map((method) => method.method);
  const paymentDetails = paymentMethods.reduce((acc, method) => ({ ...acc, [method.method]: method.details ?? {} }), {} as Record<string, Record<string, string | undefined>>);
  const achDetails = paymentDetails.ach ?? {};

  return {
    ...defaults,
    legalName: profileRow?.legal_name ?? defaults.legalName,
    displayName: profileRow?.display_name ?? defaults.displayName,
    logoUrl: profileRow?.logo_storage_path ?? '',
    website: profileWebsiteFromDb(profileRow?.website, company, defaults.website),
    phone: profileRow?.phone ?? '',
    billingEmail: profileRow?.billing_email ?? company.ownerEmail,
    serviceAddress: profileRow?.service_address ?? '',
    serviceArea: profileRow?.service_area ?? company.market,
    timezone: profileRow?.timezone ?? defaults.timezone,
    emergencyContact: profileRow?.emergency_contact ?? company.ownerEmail,
    websiteIntakeEnabled: profileRow?.website_intake_enabled ?? defaults.websiteIntakeEnabled,
    websiteIntakeToken: profileRow?.website_intake_token ?? defaults.websiteIntakeToken,
    websiteIntakeAllowedOrigins: profileRow?.website_intake_allowed_origins ?? defaults.websiteIntakeAllowedOrigins,
    jobAssignmentMode: workflow?.job_assignment_mode ?? defaults.jobAssignmentMode,
    useJobNumberPrefixes: workflow?.use_job_number_prefixes ?? defaults.useJobNumberPrefixes,
    jobNumberPrefix: workflow?.default_job_number_prefix ?? defaults.jobNumberPrefix,
    serviceCallFee: dollars(workflow?.default_service_call_fee_cents ?? defaults.serviceCallFee * 100),
    defaultJobPriority: workflow?.default_job_priority ?? defaults.defaultJobPriority,
    warrantyDays: workflow?.warranty_days ?? defaults.warrantyDays,
    autoArchiveCompletedAfterDays: workflow?.auto_archive_completed_after_days ?? defaults.autoArchiveCompletedAfterDays,
    autoArchiveCancelledAfterDays: workflow?.auto_archive_cancelled_after_days ?? defaults.autoArchiveCancelledAfterDays,
    requireCompletionNote: workflow?.require_completion_note ?? defaults.requireCompletionNote,
    requireCompletionPhoto: workflow?.require_completion_photo ?? defaults.requireCompletionPhoto,
    allowWarrantyReopen: workflow?.allow_warranty_reopen ?? defaults.allowWarrantyReopen,
    paymentNotes: workflow?.payment_notes ?? defaults.paymentNotes,
    acceptedPayments: enabledPayments.length ? enabledPayments : [],
    achRoutingNumber: achDetails.achRoutingNumber ?? '',
    achAccountNumber: achDetails.achAccountNumber ?? '',
    achAccountName: achDetails.achAccountName ?? '',
    zelleContact: paymentDetails.zelle?.zelleContact ?? '',
    venmoContact: paymentDetails.venmo?.venmoContact ?? '',
    cashAppCashtag: paymentDetails.cash_app?.cashAppCashtag ?? '',
    paypalEmail: paymentDetails.paypal?.paypalEmail ?? '',
    subscriptionPaymentStatus: subscriptionPayment?.status ?? 'not_connected',
    subscriptionCardBrand: subscriptionPayment?.brand ?? '',
    subscriptionCardLast4: subscriptionPayment?.last4 ?? '',
    subscriptionCardExpMonth: subscriptionPayment?.exp_month ? String(subscriptionPayment.exp_month) : '',
    subscriptionCardExpYear: subscriptionPayment?.exp_year ? String(subscriptionPayment.exp_year) : '',
    subscriptionBillingName: subscriptionPayment?.billing_name ?? company.ownerName,
    subscriptionBillingZip: subscriptionPayment?.billing_zip ?? '',
    autoPayEnabled: subscriptionPayment?.autopay_enabled ?? false,
    jobTypes: jobTypes.map((jobType): CompanyJobType => ({
      id: jobType.id,
      name: jobType.name || 'Service',
      jobNumberPrefix: jobType.job_number_prefix || '',
      defaultDurationMinutes: jobType.default_duration_minutes,
      defaultPriority: jobType.default_priority,
      requiresParts: jobType.requires_parts,
    })),
    technicians: (() => {
      const technicianRows = technicians.map((technician): CompanyTechnician => ({
        id: technician.id,
        name: technician.name,
        email: technician.email ?? '',
        phone: technician.phone ?? '',
        photoUrl: '',
        accessPassword: technician.access_password ?? '',
        role: technician.role,
        status: technician.status,
        assignedJobs: technician.assigned_jobs_count,
      }));
      const knownEmails = new Set(technicianRows.map((technician) => String(technician.email ?? '').toLowerCase()).filter(Boolean));
      const userTechnicians = companyUsers
        .filter((user) => user.role === 'technician' || user.role === 'dispatcher' || user.role === 'manager')
        .filter((user) => !knownEmails.has(String(user.email ?? '').toLowerCase()))
        .map((user): CompanyTechnician => ({
          id: `user-${user.id}`,
          name: user.name || 'Team member',
          email: user.email || '',
          phone: '',
          photoUrl: '',
          accessPassword: '',
          role: user.role === 'manager' ? 'manager' : user.role === 'dispatcher' ? 'dispatcher' : 'technician',
          status: user.status,
          assignedJobs: 0,
        }));

      return [...technicianRows, ...userTechnicians];
    })(),
  };
}

export async function loadOwnerWorkspaceFromBackend() {
  if (!isSupabaseConfigured()) {
    return { companies: [], onboardingProfiles: [] };
  }

  const companyRows = await supabaseRequest<DbCompany[]>(`companies?select=*,plans(name)&order=created_at.desc&limit=${WORKSPACE_COMPANY_LIMIT}`);
  const companyIds = companyRows.map((company) => company.id);
  if (!companyIds.length) {
    return { companies: [], onboardingProfiles: [] };
  }

  const filter = companyFilter(companyIds);
  const [
    onboardingSteps,
    alerts,
    profileRows,
    workflows,
    jobTypes,
    paymentMethods,
    technicians,
    companyUsers,
    subscriptionPayments,
  ] = await Promise.all([
    supabaseRequest<DbOnboardingStep[]>(`company_onboarding_steps?select=company_id,step_key,status${filter}&limit=${WORKSPACE_CHILD_LIMIT}`),
    supabaseRequest<DbAlert[]>(`company_alerts?select=company_id,title&resolved_at=is.null${filter}&limit=${WORKSPACE_CHILD_LIMIT}`),
    supabaseRequest<DbCompanyProfile[]>(`company_profiles?select=*${filter}&limit=${WORKSPACE_CHILD_LIMIT}`),
    supabaseRequest<DbWorkflow[]>(`company_job_workflow_settings?select=*${filter}&limit=${WORKSPACE_CHILD_LIMIT}`),
    supabaseRequest<DbJobType[]>(`company_job_types?select=*&active=eq.true${filter}&limit=${WORKSPACE_CHILD_LIMIT}`),
    supabaseRequest<DbPaymentMethod[]>(`company_payment_methods?select=company_id,method,details&enabled=eq.true${filter}&limit=${WORKSPACE_CHILD_LIMIT}`),
    supabaseRequest<DbTechnician[]>(`company_technicians?select=*${filter}&limit=${WORKSPACE_CHILD_LIMIT}`),
    supabaseRequest<DbCompanyUser[]>(`company_users?select=id,company_id,name,email,role,status${filter}&limit=${WORKSPACE_CHILD_LIMIT}`),
    supabaseRequest<DbSubscriptionPayment[]>(`subscription_payment_methods?select=*&is_default=eq.true${filter}&limit=${WORKSPACE_CHILD_LIMIT}`),
  ]);

  const companies = companyRows.map((companyRow) => {
    const company = companyFromDb(companyRow, onboardingSteps, alerts);
    const profileRow = profileRows.find((profile) => profile.company_id === company.id);

    return {
      ...company,
      phone: profileRow?.phone ?? company.phone ?? '',
      accessRules: profileRow?.access_rules ?? {},
    };
  });
  const onboardingProfiles = companies.map((company) => profileFromDb(
    company,
    profileRows.find((profile) => profile.company_id === company.id),
    workflows.find((workflow) => workflow.company_id === company.id),
    jobTypes.filter((jobType) => jobType.company_id === company.id),
    paymentMethods.filter((method) => method.company_id === company.id),
    technicians.filter((technician) => technician.company_id === company.id),
    companyUsers.filter((user) => user.company_id === company.id),
    subscriptionPayments.find((payment) => payment.company_id === company.id),
  ));

  return { companies, onboardingProfiles };
}

export function clearLegacyLocalBusinessData() {
  [
    'servicescope.v2.companies',
    'servicescope.v2.companyOnboardingProfiles',
    'servicescope.v2.jobs',
    'servicescope.v2.supportTickets',
    'servicescope.v2.auditEvents',
    'servicescope.v2.platformUsers',
  ].forEach((key) => window.localStorage.removeItem(key));
}
