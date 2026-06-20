import type { EmailConnection } from '../appTypes';
import type { Company, CompanyOnboardingProfile, CompanyPaymentMethod } from '../types';
import { isSupabaseConfigured, sqlEq, supabaseRequest } from './supabaseRest';
import { onboardingStepOrder } from './tenantStore';

const paymentMethods: CompanyPaymentMethod[] = [
  'ach',
  'zelle',
  'venmo',
  'cash_app',
  'paypal',
  'credit_card',
  'debit_card',
  'check',
  'cash',
  'wire_transfer',
  'apple_pay',
  'google_pay',
  'stripe',
  'square',
  'financing',
];

function cents(value: number) {
  return Math.round((Number(value) || 0) * 100);
}

function numberOrNull(value: string) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && value !== '' ? numberValue : null;
}

async function upsert<T extends Record<string, unknown>>(table: string, conflict: string, rows: T[]) {
  if (!rows.length) return;

  await supabaseRequest(`${table}?on_conflict=${conflict}`, {
    method: 'POST',
    body: rows,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

export function canUseOnboardingBackend() {
  return isSupabaseConfigured();
}

export async function saveCompanyCoreToBackend(company: Company) {
  if (!canUseOnboardingBackend()) return;

  await upsert('companies', 'id', [
    {
      id: company.id,
      name: company.name,
      owner_name: company.ownerName,
      owner_email: company.ownerEmail,
      domain: company.domain || null,
      market: company.market,
      status: company.status,
      billing_status: company.billingStatus,
      seats_count: company.seats,
      technicians_count: company.technicians,
      open_jobs_count: company.openJobs,
      revenue_cents: cents(company.revenue),
      health_score: company.health,
      last_sync_label: company.lastSync,
    },
  ]);

  if (company.ownerEmail) {
    await upsert('company_users', 'company_id,email', [
      {
        company_id: company.id,
        name: company.ownerName || company.ownerEmail,
        email: company.ownerEmail,
        role: 'admin',
        status: 'active',
      },
    ]);
  }
}

export async function saveCompanyOnboardingStepsToBackend(company: Company) {
  if (!canUseOnboardingBackend()) return;

  await upsert(
    'company_onboarding_steps',
    'company_id,step_key',
    onboardingStepOrder.map((step) => ({
      company_id: company.id,
      step_key: step,
      status: company.onboarding[step],
      completed_at: company.onboarding[step] === 'done' ? new Date().toISOString() : null,
    })),
  );
}

type SaveOnboardingProfileOptions = {
  saveCompanyCore?: boolean;
  saveOnboardingSteps?: boolean;
  saveSubscriptionPaymentMethod?: boolean;
};

export async function saveOnboardingProfileToBackend(
  company: Company,
  profile: CompanyOnboardingProfile,
  emailConnection: EmailConnection | null,
  options: SaveOnboardingProfileOptions = {},
) {
  if (!canUseOnboardingBackend()) return;

  const { saveCompanyCore = true, saveOnboardingSteps = true, saveSubscriptionPaymentMethod = false } = options;

  if (saveCompanyCore) {
    await saveCompanyCoreToBackend(company);
  }

  if (saveOnboardingSteps) {
    await saveCompanyOnboardingStepsToBackend(company);
  }

  await upsert('company_profiles', 'company_id', [
    {
      company_id: company.id,
      legal_name: profile.legalName,
      display_name: profile.displayName,
      logo_storage_path: profile.logoUrl,
      website: profile.website,
      phone: profile.phone,
      billing_email: profile.billingEmail || null,
      service_address: profile.serviceAddress,
      service_area: profile.serviceArea,
      timezone: profile.timezone,
      emergency_contact: profile.emergencyContact,
    },
  ]);

  await upsert('company_job_workflow_settings', 'company_id', [
    {
      company_id: company.id,
      job_assignment_mode: profile.jobAssignmentMode,
      use_job_number_prefixes: profile.useJobNumberPrefixes,
      default_job_number_prefix: profile.jobNumberPrefix,
      default_service_call_fee_cents: cents(profile.serviceCallFee),
      default_job_priority: profile.defaultJobPriority,
      warranty_days: profile.warrantyDays,
      auto_archive_completed_after_days: profile.autoArchiveCompletedAfterDays,
      auto_archive_cancelled_after_days: profile.autoArchiveCancelledAfterDays,
      require_completion_note: profile.requireCompletionNote,
      require_completion_photo: profile.requireCompletionPhoto,
      allow_warranty_reopen: profile.allowWarrantyReopen,
      payment_notes: profile.paymentNotes,
    },
  ]);

  await upsert(
    'company_job_types',
    'id',
    profile.jobTypes.map((jobType) => ({
      id: jobType.id,
      company_id: company.id,
      name: jobType.name,
      job_number_prefix: jobType.jobNumberPrefix,
      default_duration_minutes: jobType.defaultDurationMinutes,
      default_priority: jobType.defaultPriority,
      requires_parts: jobType.requiresParts,
      active: true,
    })),
  );

  await upsert(
    'company_payment_methods',
    'company_id,method',
    paymentMethods.map((method) => ({
      company_id: company.id,
      method,
      enabled: profile.acceptedPayments.includes(method),
      display_label: null,
      details: {
        achRoutingNumber: method === 'ach' ? profile.achRoutingNumber : undefined,
        achAccountNumber: method === 'ach' ? profile.achAccountNumber : undefined,
        achAccountName: method === 'ach' ? profile.achAccountName : undefined,
        zelleContact: method === 'zelle' ? profile.zelleContact : undefined,
        venmoContact: method === 'venmo' ? profile.venmoContact : undefined,
        cashAppCashtag: method === 'cash_app' ? profile.cashAppCashtag : undefined,
        paypalEmail: method === 'paypal' ? profile.paypalEmail : undefined,
      },
    })),
  );

  await upsert(
    'company_technicians',
    'id',
    profile.technicians.map((technician) => ({
      id: technician.id.startsWith('user-') ? crypto.randomUUID() : technician.id,
      company_id: company.id,
      name: technician.name,
      email: technician.email || null,
      phone: technician.phone,
      role: technician.role,
      status: technician.status,
      assigned_jobs_count: technician.assignedJobs,
      gps_enabled: true,
    })),
  );

  await upsert(
    'company_users',
    'company_id,email',
    profile.technicians
      .filter((technician) => technician.email)
      .map((technician) => ({
        company_id: company.id,
        name: technician.name,
        email: technician.email,
        role: technician.role === 'manager' ? 'manager' : technician.role === 'dispatcher' ? 'dispatcher' : 'technician',
        status: technician.status,
      })),
  );

  if (emailConnection) {
    await upsert('email_connections', 'company_id', [
      {
        company_id: company.id,
        provider: emailConnection.provider,
        address: emailConnection.address,
        status: emailConnection.status,
        last_sync_at: null,
        sync_range_days: Number(emailConnection.syncRange),
        auto_link_job_number: emailConnection.autoLinkJobNumber,
        auto_link_client_email: emailConnection.autoLinkClientEmail,
        create_task_from_unread: emailConnection.createTaskFromUnread,
        sender_name: emailConnection.senderName,
        reply_to: emailConnection.replyTo || null,
        signature: emailConnection.signature,
        imap_host: emailConnection.imapHost,
        imap_port: emailConnection.imapPort,
        smtp_host: emailConnection.smtpHost,
        smtp_port: emailConnection.smtpPort,
        security: emailConnection.security,
        username: emailConnection.username,
      },
    ]);
  }

  if (saveSubscriptionPaymentMethod) {
    await upsert('subscription_payment_methods', 'company_id,is_default', [
      {
        company_id: company.id,
        provider: 'square',
        provider_payment_method_id: null,
        status: profile.subscriptionPaymentStatus,
        brand: profile.subscriptionCardBrand,
        last4: profile.subscriptionCardLast4,
        exp_month: numberOrNull(profile.subscriptionCardExpMonth),
        exp_year: numberOrNull(profile.subscriptionCardExpYear),
        billing_name: profile.subscriptionBillingName,
        billing_zip: profile.subscriptionBillingZip,
        autopay_enabled: profile.autoPayEnabled,
        is_default: true,
      },
    ]);
  }
}

export async function deleteJobTypeFromBackend(jobTypeId: string) {
  if (!canUseOnboardingBackend()) return;
  await supabaseRequest(`company_job_types?id=${sqlEq(jobTypeId)}`, { method: 'DELETE' });
}
