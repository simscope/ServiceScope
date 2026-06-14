import type {
  Company,
  CompanyJobType,
  CompanyOnboardingProfile,
  CompanyPaymentMethod,
  CompanyTechnician,
  NewCompanyJobTypeForm,
  NewCompanyTechnicianForm,
} from '../types';

const STORAGE_KEY = 'servicescope.companyOnboardingProfiles';
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
  const count = Math.max(company.technicians, 1);

  return Array.from({ length: count }, (_, index) => ({
    id: `${company.id}-tech-${index + 1}`,
    name: index === 0 ? 'Lead Technician' : `Technician ${index + 1}`,
    email: `tech${index + 1}@${company.domain || 'company.local'}`,
    phone: '',
    role: index === 0 ? 'manager' : 'technician',
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

export function createDefaultCompanyOnboardingProfile(company: Company): CompanyOnboardingProfile {
  return {
    companyId: company.id,
    legalName: company.name,
    displayName: company.name,
    logoUrl: '',
    website: company.domain ? `https://${company.domain}` : '',
    phone: '',
    billingEmail: company.ownerEmail,
    serviceAddress: '',
    serviceArea: company.market,
    timezone: 'America/New_York',
    emergencyContact: company.ownerEmail,
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
  const acceptedPayments = (profile.acceptedPayments ?? ['ach', 'zelle', 'credit_card', 'check', 'cash']).filter((method): method is CompanyPaymentMethod =>
    validPaymentMethods.includes(method as CompanyPaymentMethod),
  );
  const defaultJobTypes = makeJobTypes();
  const legacyWorkflowTypes = new Set(['diagnostics', 'repair', 'installation', 'maintenance']);
  const savedJobTypes = profile.jobTypes?.length
    ? profile.jobTypes.filter((jobType) => !legacyWorkflowTypes.has(jobType.name.toLowerCase()))
    : defaultJobTypes.filter((jobType) => jobType.name === 'HVAC');
  const defaultJobTypeNames = new Set(defaultJobTypes.map((jobType) => jobType.name.toLowerCase()));
  const savedLooksLikeOldAutoList =
    profile.useJobNumberPrefixes === undefined &&
    savedJobTypes.length === defaultJobTypes.length &&
    savedJobTypes.every((jobType) => defaultJobTypeNames.has(jobType.name.toLowerCase()));
  const jobTypes = savedLooksLikeOldAutoList
    ? defaultJobTypes.filter((jobType) => jobType.name === 'HVAC')
    : savedJobTypes.length
      ? savedJobTypes
      : defaultJobTypes.filter((jobType) => jobType.name === 'HVAC');
  const normalizedJobTypes = jobTypes.map((jobType) => ({
    ...jobType,
    jobNumberPrefix: jobType.jobNumberPrefix || makeJobTypePrefix(jobType.name),
  }));

  return {
    ...createDefaultCompanyOnboardingProfile(company),
    ...profile,
    companyId: company.id,
    acceptedPayments: acceptedPayments.length ? acceptedPayments : ['ach', 'zelle', 'credit_card', 'check', 'cash'],
    achAccountNumber: profile.achAccountNumber ?? legacyProfile.achAccountLast4 ?? '',
    useJobNumberPrefixes: profile.useJobNumberPrefixes ?? true,
    warrantyDays: profile.warrantyDays ?? 30,
    autoArchiveCompletedAfterDays: profile.autoArchiveCompletedAfterDays ?? 14,
    autoArchiveCancelledAfterDays: profile.autoArchiveCancelledAfterDays ?? 7,
    requireCompletionNote: profile.requireCompletionNote ?? true,
    requireCompletionPhoto: profile.requireCompletionPhoto ?? false,
    allowWarrantyReopen: profile.allowWarrantyReopen ?? true,
    jobTypes: normalizedJobTypes,
    technicians: profile.technicians?.length ? profile.technicians : makeTechnicians(company),
  };
}

export function listCompanyOnboardingProfiles(companies: Company[]) {
  const saved = window.localStorage.getItem(STORAGE_KEY);

  try {
    const profiles = saved ? (JSON.parse(saved) as Partial<CompanyOnboardingProfile>[]) : [];
    const normalizedProfiles = companies
      .filter((company) => profiles.some((profile) => profile.companyId === company.id))
      .map((company) => normalizeProfile(profiles.find((profile) => profile.companyId === company.id) ?? {}, company));
    const missingProfiles = companies
      .filter((company) => !normalizedProfiles.some((profile) => profile.companyId === company.id))
      .map(createDefaultCompanyOnboardingProfile);

    return [...normalizedProfiles, ...missingProfiles];
  } catch {
    return companies.map(createDefaultCompanyOnboardingProfile);
  }
}

export function saveCompanyOnboardingProfiles(profiles: CompanyOnboardingProfile[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

export function createCompanyTechnician(form: NewCompanyTechnicianForm): CompanyTechnician {
  return {
    id: crypto.randomUUID(),
    ...form,
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
