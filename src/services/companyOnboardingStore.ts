import type {
  Company,
  CompanyJobType,
  CompanyOnboardingProfile,
  CompanyPaymentMethod,
  CompanyTechnician,
  NewCompanyJobTypeForm,
  NewCompanyTechnicianForm,
} from '../types';

const validPaymentMethods: CompanyPaymentMethod[] = [
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

function makeTechnicians(company: Company): CompanyTechnician[] {
  const count = company.technicians;

  return Array.from({ length: count }, (_, index) => ({
    id: `${company.id}-tech-${index + 1}`,
    name: `Technician ${index + 1}`,
    email: `tech${index + 1}@${company.domain || 'company.local'}`,
    phone: '',
    photoUrl: '',
    accessPassword: '',
    role: 'technician',
    status: 'active',
    assignedJobs: index === 0 ? Math.min(company.openJobs, 4) : 0,
  }));
}

export function makeJobTypes(): CompanyJobType[] {
  return [
    {
      id: 'job-type-appliance',
      name: 'Appliance',
      jobNumberPrefix: 'APP',
      defaultDurationMinutes: 60,
      defaultPriority: 'normal',
      requiresParts: false,
    },
    {
      id: 'job-type-hvac',
      name: 'HVAC',
      jobNumberPrefix: 'HVAC',
      defaultDurationMinutes: 90,
      defaultPriority: 'normal',
      requiresParts: true,
    },
    {
      id: 'job-type-plumbing',
      name: 'Plumbing',
      jobNumberPrefix: 'PLB',
      defaultDurationMinutes: 90,
      defaultPriority: 'normal',
      requiresParts: true,
    },
    {
      id: 'job-type-handyman',
      name: 'Handyman',
      jobNumberPrefix: 'HDM',
      defaultDurationMinutes: 60,
      defaultPriority: 'normal',
      requiresParts: false,
    },
    {
      id: 'job-type-electrical',
      name: 'Electrical',
      jobNumberPrefix: 'ELC',
      defaultDurationMinutes: 90,
      defaultPriority: 'normal',
      requiresParts: true,
    },
    {
      id: 'job-type-locksmith',
      name: 'Locksmith',
      jobNumberPrefix: 'LCK',
      defaultDurationMinutes: 60,
      defaultPriority: 'normal',
      requiresParts: false,
    },
    {
      id: 'job-type-garage-door',
      name: 'Garage Door',
      jobNumberPrefix: 'GAR',
      defaultDurationMinutes: 90,
      defaultPriority: 'normal',
      requiresParts: true,
    },
    {
      id: 'job-type-roofing',
      name: 'Roofing',
      jobNumberPrefix: 'ROF',
      defaultDurationMinutes: 120,
      defaultPriority: 'normal',
      requiresParts: true,
    },
    {
      id: 'job-type-pest-control',
      name: 'Pest Control',
      jobNumberPrefix: 'PST',
      defaultDurationMinutes: 60,
      defaultPriority: 'normal',
      requiresParts: false,
    },
  ];
}

function makeJobTypePrefix(name: string) {
  const compact = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const knownPrefixes: Record<string, string> = {
    APPLIANCE: 'APP',
    HVAC: 'HVAC',
    PLUMBING: 'PLB',
    HANDYMAN: 'HDM',
    ELECTRICAL: 'ELC',
    LOCKSMITH: 'LCK',
    GARAGEDOOR: 'GAR',
    ROOFING: 'ROF',
    PESTCONTROL: 'PST',
  };

  return knownPrefixes[compact] ?? (compact.slice(0, 4) || 'JOB');
}

function makeWebsite(value: string) {
  const normalized = value.trim();
  if (!normalized) return '';
  const protocol = normalized.match(/^https?:\/\//i)?.[0] ?? 'https://';
  const address = normalized.replace(/^(https?:\/\/)+/i, '');

  return `${protocol}${address}`;
}

function savedWebsiteOrCompanyWebsite(savedWebsite: string | undefined, company: Company) {
  const normalizedSavedWebsite = makeWebsite(savedWebsite ?? '');
  const normalizedCompanyWebsite = makeWebsite(company.domain);
  const legacyPlaceholder = !normalizedSavedWebsite || normalizedSavedWebsite === 'https://company.com';

  return legacyPlaceholder ? normalizedCompanyWebsite : normalizedSavedWebsite;
}

export function createDefaultCompanyOnboardingProfile(company: Company): CompanyOnboardingProfile {
  return {
    companyId: company.id,
    legalName: company.name,
    displayName: company.name,
    logoUrl: '',
    website: makeWebsite(company.domain),
    phone: '',
    billingEmail: company.ownerEmail,
    serviceAddress: '',
    serviceArea: company.market,
    timezone: 'America/New_York',
    emergencyContact: company.ownerEmail,
    websiteIntakeEnabled: false,
    websiteIntakeToken: '',
    websiteIntakeAllowedOrigins: makeWebsite(company.domain),
    jobAssignmentMode: 'manual',
    acceptedPayments: ['ach', 'zelle', 'credit_card', 'check', 'cash'],
    achRoutingNumber: '',
    achAccountNumber: '',
    achAccountName: company.name,
    zelleContact: company.ownerEmail,
    venmoContact: '',
    cashAppCashtag: '',
    paypalEmail: company.ownerEmail,
    paymentNotes: '',
    subscriptionPaymentStatus: company.billingStatus === 'paid' || company.billingStatus === 'trialing' ? 'active' : 'not_connected',
    subscriptionCardBrand: 'Visa',
    subscriptionCardLast4: company.billingStatus === 'paid' ? '4242' : '',
    subscriptionCardExpMonth: '',
    subscriptionCardExpYear: '',
    subscriptionBillingName: company.ownerName,
    subscriptionBillingZip: '',
    autoPayEnabled: company.billingStatus === 'paid',
    jobNumberPrefix: company.name.slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'JOB',
    useJobNumberPrefixes: true,
    serviceCallFee: 120,
    defaultJobPriority: 'normal',
    warrantyDays: 30,
    autoArchiveCompletedAfterDays: 14,
    autoArchiveCancelledAfterDays: 7,
    requireCompletionNote: true,
    requireCompletionPhoto: false,
    allowWarrantyReopen: true,
    jobTypes: makeJobTypes().filter((jobType) => jobType.name === 'HVAC'),
    technicians: makeTechnicians(company),
  };
}

function normalizeProfile(profile: Partial<CompanyOnboardingProfile>, company: Company): CompanyOnboardingProfile {
  const legacyProfile = profile as Partial<CompanyOnboardingProfile> & { achAccountLast4?: string };
  const normalizedJobTypeName = (jobType: Partial<CompanyJobType>) => String(jobType.name ?? '').trim().toLowerCase();
  const acceptedPayments = (profile.acceptedPayments ?? ['ach', 'zelle', 'credit_card', 'check', 'cash']).filter((method): method is CompanyPaymentMethod =>
    validPaymentMethods.includes(method as CompanyPaymentMethod),
  );
  const defaultJobTypes = makeJobTypes();
  const legacyWorkflowTypes = new Set(['diagnostics', 'repair', 'installation', 'maintenance']);
  const savedJobTypes = profile.jobTypes?.length
    ? profile.jobTypes.filter((jobType) => normalizedJobTypeName(jobType) && !legacyWorkflowTypes.has(normalizedJobTypeName(jobType)))
    : defaultJobTypes.filter((jobType) => jobType.name === 'HVAC');
  const defaultJobTypeNames = new Set(defaultJobTypes.map((jobType) => jobType.name.toLowerCase()));
  const savedLooksLikeOldAutoList =
    profile.useJobNumberPrefixes === undefined &&
    savedJobTypes.length === defaultJobTypes.length &&
    savedJobTypes.every((jobType) => defaultJobTypeNames.has(normalizedJobTypeName(jobType)));
  const jobTypes = savedLooksLikeOldAutoList
    ? defaultJobTypes.filter((jobType) => jobType.name === 'HVAC')
    : savedJobTypes.length
      ? savedJobTypes
      : defaultJobTypes.filter((jobType) => jobType.name === 'HVAC');
  const normalizedJobTypes = jobTypes.map((jobType) => ({
    ...jobType,
    name: jobType.name || 'Service',
    jobNumberPrefix: jobType.jobNumberPrefix || makeJobTypePrefix(jobType.name || 'Service'),
  }));
  const technicians = profile.technicians?.length ? profile.technicians : makeTechnicians(company);
  const normalizedTechnicians = technicians.filter((technician) => {
    const legacyAutoLead =
      technician.name === 'Lead Technician' &&
      technician.email.startsWith('tech1@') &&
      !technician.phone &&
      !technician.accessPassword &&
      !(technician as CompanyTechnician & { temporaryPassword?: string }).temporaryPassword;

    return !legacyAutoLead;
  }).map((technician) => {
    const legacyTechnician = technician as CompanyTechnician & { temporaryPassword?: string };

    return {
      ...technician,
      photoUrl: technician.photoUrl ?? '',
      accessPassword: technician.accessPassword ?? legacyTechnician.temporaryPassword ?? '',
    };
  });

  return {
    ...createDefaultCompanyOnboardingProfile(company),
    ...profile,
    companyId: company.id,
    website: savedWebsiteOrCompanyWebsite(profile.website, company),
    acceptedPayments: acceptedPayments.length ? acceptedPayments : ['ach', 'zelle', 'credit_card', 'check', 'cash'],
    achAccountNumber: profile.achAccountNumber ?? legacyProfile.achAccountLast4 ?? '',
    subscriptionPaymentStatus: profile.subscriptionPaymentStatus ?? (company.billingStatus === 'paid' ? 'active' : 'not_connected'),
    subscriptionCardBrand: profile.subscriptionCardBrand ?? 'Visa',
    subscriptionCardLast4: profile.subscriptionCardLast4 ?? '',
    subscriptionCardExpMonth: profile.subscriptionCardExpMonth ?? '',
    subscriptionCardExpYear: profile.subscriptionCardExpYear ?? '',
    subscriptionBillingName: profile.subscriptionBillingName ?? company.ownerName,
    subscriptionBillingZip: profile.subscriptionBillingZip ?? '',
    autoPayEnabled: profile.autoPayEnabled ?? (company.billingStatus === 'paid'),
    websiteIntakeEnabled: profile.websiteIntakeEnabled ?? false,
    websiteIntakeToken: profile.websiteIntakeToken ?? '',
    websiteIntakeAllowedOrigins: profile.websiteIntakeAllowedOrigins ?? savedWebsiteOrCompanyWebsite(profile.website, company),
    useJobNumberPrefixes: profile.useJobNumberPrefixes ?? true,
    warrantyDays: profile.warrantyDays ?? 30,
    autoArchiveCompletedAfterDays: profile.autoArchiveCompletedAfterDays ?? 14,
    autoArchiveCancelledAfterDays: profile.autoArchiveCancelledAfterDays ?? 7,
    requireCompletionNote: profile.requireCompletionNote ?? true,
    requireCompletionPhoto: profile.requireCompletionPhoto ?? false,
    allowWarrantyReopen: profile.allowWarrantyReopen ?? true,
    jobTypes: normalizedJobTypes,
    technicians: normalizedTechnicians,
  };
}

export function listCompanyOnboardingProfiles(companies: Company[]) {
  return companies.map(createDefaultCompanyOnboardingProfile);
}

export function saveCompanyOnboardingProfiles(profiles: CompanyOnboardingProfile[]) {
  void profiles;
}

export function createCompanyTechnician(form: NewCompanyTechnicianForm): CompanyTechnician {
  return {
    id: crypto.randomUUID(),
    ...form,
    photoUrl: form.photoUrl ?? '',
    status: 'invited',
    assignedJobs: 0,
  };
}

export function createCompanyJobType(form: NewCompanyJobTypeForm): CompanyJobType {
  return {
    id: crypto.randomUUID(),
    ...form,
    jobNumberPrefix: form.jobNumberPrefix.toUpperCase().replace(/[^A-Z0-9]/g, '') || makeJobTypePrefix(form.name),
  };
}
