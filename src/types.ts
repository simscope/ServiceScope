export type CompanyStatus = 'active' | 'trial' | 'paused' | 'setup';
export type BillingStatus = 'paid' | 'trialing' | 'overdue' | 'not_started';
export type OnboardingStepStatus = 'done' | 'current' | 'blocked' | 'todo';
export type SupportTicketStatus = 'new' | 'reviewing' | 'planned' | 'resolved';
export type SupportTicketKind = 'bug' | 'change' | 'question';
export type SupportTicketPriority = 'low' | 'normal' | 'urgent';
export type SupportMessageAuthor = 'company' | 'owner';
export type CompanyPlan = 'Launch' | 'Growth' | 'Scale';
export type PlatformUserRole = 'owner' | 'admin' | 'support' | 'viewer';
export type PlatformUserStatus = 'active' | 'invited' | 'disabled';
export type AuditEventCategory = 'tenant' | 'billing' | 'access' | 'support';
export type CompanyTechnicianRole = 'technician' | 'dispatcher' | 'manager';
export type CompanyTechnicianStatus = 'active' | 'invited' | 'disabled';
export type CompanyPaymentMethod =
  | 'ach'
  | 'zelle'
  | 'venmo'
  | 'cash_app'
  | 'paypal'
  | 'credit_card'
  | 'debit_card'
  | 'check'
  | 'cash'
  | 'wire_transfer'
  | 'apple_pay'
  | 'google_pay'
  | 'stripe'
  | 'square'
  | 'financing';
export type CompanyJobPriority = 'low' | 'normal' | 'urgent';

export type Company = {
  id: string;
  name: string;
  ownerName: string;
  ownerEmail: string;
  domain: string;
  market: string;
  plan: CompanyPlan;
  status: CompanyStatus;
  billingStatus: BillingStatus;
  seats: number;
  technicians: number;
  openJobs: number;
  revenue: number;
  health: number;
  lastSync: string;
  onboarding: {
    workspace: OnboardingStepStatus;
    users: OnboardingStepStatus;
    data: OnboardingStepStatus;
    billing: OnboardingStepStatus;
  };
  alerts: string[];
  usage: {
    jobsThisMonth: number;
    invoicesThisMonth: number;
    storageGb: number;
  };
};

export type OnboardingStepKey = keyof Company['onboarding'];

export type PlanDefinition = {
  name: CompanyPlan;
  price: number;
  seats: number;
  technicians: number;
  storageGb: number;
  support: 'Email' | 'Priority' | 'Dedicated';
  entitlements: string[];
};

export type NewCompanyForm = Pick<
  Company,
  'name' | 'ownerName' | 'ownerEmail' | 'domain' | 'market' | 'plan' | 'status'
>;

export type SupportTicket = {
  id: string;
  companyId: string;
  companyName: string;
  authorName: string;
  authorEmail: string;
  kind: SupportTicketKind;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  subject: string;
  message: string;
  createdAt: string;
  lastUpdate: string;
  messages: SupportMessage[];
};

export type SupportMessage = {
  id: string;
  author: SupportMessageAuthor;
  authorName: string;
  body: string;
  createdAt: string;
};

export type NewSupportTicketForm = Pick<
  SupportTicket,
  'companyId' | 'authorName' | 'authorEmail' | 'kind' | 'priority' | 'subject' | 'message'
>;

export type PlatformUser = {
  id: string;
  name: string;
  email: string;
  role: PlatformUserRole;
  status: PlatformUserStatus;
  lastActive: string;
};

export type NewPlatformUserForm = Pick<PlatformUser, 'name' | 'email' | 'role'>;

export type AuditEvent = {
  id: string;
  category: AuditEventCategory;
  action: string;
  actor: string;
  resource: string;
  details: string;
  createdAt: string;
};

export type CompanyTechnician = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: CompanyTechnicianRole;
  status: CompanyTechnicianStatus;
  assignedJobs: number;
};

export type NewCompanyTechnicianForm = Pick<CompanyTechnician, 'name' | 'email' | 'phone' | 'role'>;

export type CompanyJobType = {
  id: string;
  name: string;
  jobNumberPrefix: string;
  defaultDurationMinutes: number;
  defaultPriority: CompanyJobPriority;
  requiresParts: boolean;
};

export type NewCompanyJobTypeForm = Pick<CompanyJobType, 'name' | 'jobNumberPrefix' | 'defaultDurationMinutes' | 'defaultPriority' | 'requiresParts'>;

export type MaterialStatus = 'Needed' | 'Ordered' | 'Received' | 'Installed' | 'Returned';

export type MaterialRow = {
  id: string;
  jobNumber: string;
  name: string;
  quantity: number;
  price: number;
  supplier: string;
  status: MaterialStatus;
};

export type ServiceJobStatus =
  | 'New'
  | 'ReCall'
  | 'Diagnosis'
  | 'In progress'
  | 'Parts ordered'
  | 'Waiting for parts'
  | 'To finish'
  | 'Completed'
  | 'Warranty'
  | 'Cancelled';

export type JobAttachment = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: 'photo' | 'file';
  uploadedAt: string;
  dataUrl?: string;
};

export type JobComment = {
  id: string;
  authorName: string;
  authorRole: 'Manager' | 'Admin' | 'Technician';
  message: string;
  createdAt: string;
};

export type ServiceJob = {
  id: string;
  companyId: string;
  jobNumber: string;
  status: ServiceJobStatus;
  system: string;
  clientName: string;
  organization: string;
  phone: string;
  email: string;
  address: string;
  technician: string;
  assignee: string;
  serviceCallFee: string;
  scfPayment: string;
  labor: string;
  laborPayment: string;
  issue: string;
  notes: string;
  attachments: JobAttachment[];
  comments: JobComment[];
  appointment?: string;
  createdAt: string;
};

export type NewServiceJobForm = Pick<
  ServiceJob,
  'jobNumber' | 'system' | 'clientName' | 'organization' | 'phone' | 'email' | 'address' | 'technician' | 'serviceCallFee' | 'issue' | 'notes'
>;

export type CompanyOnboardingProfile = {
  companyId: string;
  legalName: string;
  displayName: string;
  logoUrl: string;
  website: string;
  phone: string;
  billingEmail: string;
  serviceAddress: string;
  serviceArea: string;
  timezone: string;
  emergencyContact: string;
  jobAssignmentMode: 'manual' | 'round_robin' | 'skill_based';
  acceptedPayments: CompanyPaymentMethod[];
  achRoutingNumber: string;
  achAccountNumber: string;
  achAccountName: string;
  zelleContact: string;
  venmoContact: string;
  cashAppCashtag: string;
  paypalEmail: string;
  paymentNotes: string;
  jobNumberPrefix: string;
  useJobNumberPrefixes: boolean;
  serviceCallFee: number;
  defaultJobPriority: CompanyJobPriority;
  warrantyDays: number;
  autoArchiveCompletedAfterDays: number;
  autoArchiveCancelledAfterDays: number;
  requireCompletionNote: boolean;
  requireCompletionPhoto: boolean;
  allowWarrantyReopen: boolean;
  jobTypes: CompanyJobType[];
  technicians: CompanyTechnician[];
};
