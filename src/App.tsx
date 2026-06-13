import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import type { DragEvent, PointerEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Box,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  Database,
  FileClock,
  Inbox,
  LayoutDashboard,
  MailPlus,
  Map,
  PackageCheck,
  Plus,
  Rocket,
  Search,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  completeOnboardingStep,
  createCompany,
  listCompanies,
  onboardingStepOrder,
  prepareNextOnboardingStep,
  saveCompanies,
} from './services/tenantStore';
import {
  addOwnerReply,
  createSupportTicket,
  listSupportTickets,
  saveSupportTickets,
  updateSupportTicketStatus,
} from './services/supportStore';
import { applyPlan, plans } from './services/billingCatalog';
import { JobCard, type JobCardData } from './components/JobCard';
import { JobDetailPanel } from './components/JobDetailPanel';
import {
  createPlatformUser,
  listPlatformUsers,
  rolePermissions,
  savePlatformUsers,
  SYSTEM_OWNER_ID,
  updatePlatformUserRole,
  updatePlatformUserStatus,
} from './services/accessStore';
import {
  createAuditEvent,
  filterAuditEvents,
  listAuditEvents,
  saveAuditEvents,
} from './services/auditStore';
import {
  createCompanyJobType,
  createDefaultCompanyOnboardingProfile,
  createCompanyTechnician,
  listCompanyOnboardingProfiles,
  makeJobTypes,
  saveCompanyOnboardingProfiles,
} from './services/companyOnboardingStore';
import { createServiceJob, listCompanyJobs, saveCompanyJobs } from './services/jobsStore';
import type {
  AuditEvent,
  AuditEventCategory,
  BillingStatus,
  Company,
  CompanyPlan,
  CompanyStatus,
  NewPlatformUserForm,
  NewSupportTicketForm,
  NewCompanyForm,
  NewCompanyJobTypeForm,
  NewCompanyTechnicianForm,
  OnboardingStepKey,
  OnboardingStepStatus,
  SupportTicket,
  SupportTicketKind,
  SupportTicketPriority,
  SupportTicketStatus,
  PlatformUser,
  PlatformUserRole,
  PlatformUserStatus,
  CompanyOnboardingProfile,
  CompanyPaymentMethod,
  CompanyTechnicianRole,
  NewServiceJobForm,
  ServiceJob,
} from './types';

const emptyCompany: NewCompanyForm = {
  name: '',
  ownerName: '',
  ownerEmail: '',
  domain: '',
  market: '',
  plan: 'Launch',
  status: 'setup',
};

const emptySupportForm: NewSupportTicketForm = {
  companyId: '',
  authorName: '',
  authorEmail: '',
  kind: 'bug',
  priority: 'normal',
  subject: '',
  message: '',
};

const emptyAccessForm: NewPlatformUserForm = {
  name: '',
  email: '',
  role: 'support',
};

const emptyTechnicianForm: NewCompanyTechnicianForm = {
  name: '',
  email: '',
  phone: '',
  role: 'technician',
};

const emptyJobTypeForm: NewCompanyJobTypeForm = {
  name: '',
  jobNumberPrefix: '',
  defaultDurationMinutes: 60,
  defaultPriority: 'normal',
  requiresParts: false,
};

const paymentMethodLabels: Record<CompanyPaymentMethod, string> = {
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

const statusLabels: Record<CompanyStatus, string> = {
  active: 'Active',
  trial: 'Trial',
  paused: 'Paused',
  setup: 'Setup',
};

const billingLabels: Record<BillingStatus, string> = {
  paid: 'Paid',
  trialing: 'Trialing',
  overdue: 'Overdue',
  not_started: 'Not started',
};

const stepLabels: Record<keyof Company['onboarding'], string> = {
  workspace: 'Workspace',
  users: 'Users',
  data: 'Data import',
  billing: 'Billing',
};

const ticketStatusLabels: Record<SupportTicketStatus, string> = {
  new: 'New',
  reviewing: 'Reviewing',
  planned: 'Planned',
  resolved: 'Resolved',
};

const ticketKindLabels: Record<SupportTicketKind, string> = {
  bug: 'Bug',
  change: 'Change',
  question: 'Question',
};

const ticketPriorityLabels: Record<SupportTicketPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  urgent: 'Urgent',
};

const platformRoleLabels: Record<PlatformUserRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  support: 'Support',
  viewer: 'Viewer',
};

const platformStatusLabels: Record<PlatformUserStatus, string> = {
  active: 'Active',
  invited: 'Invited',
  disabled: 'Disabled',
};

const auditCategoryLabels: Record<AuditEventCategory, string> = {
  tenant: 'Tenant',
  billing: 'Billing',
  access: 'Access',
  support: 'Support',
};

type AppPage = 'dashboard' | 'companies' | 'billing' | 'access' | 'audit' | 'support' | 'companyLogin' | 'portal';
type ClientPage = 'onboarding' | 'jobs' | 'allJobs' | 'calendar' | 'materials' | 'tasks' | 'map' | 'email' | 'finances' | 'knowledge' | 'portal';

type MaterialRow = {
  id: string;
  jobNumber: string;
  name: string;
  quantity: number;
  price: number;
  supplier: string;
  status: 'Needed' | 'Ordered' | 'Received' | 'Installed' | 'Returned';
};

type TaskPriority = 'Low' | 'Normal' | 'Urgent';
type TaskStatus = 'To do' | 'In progress' | 'Done';

type TaskRow = {
  id: string;
  title: string;
  jobNumber: string;
  assignedTo: string;
  dueDate: string;
  priority: TaskPriority;
  status: TaskStatus;
  notes: string;
  source: 'Manual' | 'Auto';
};

type TaskForm = Pick<TaskRow, 'title' | 'jobNumber' | 'assignedTo' | 'dueDate' | 'priority' | 'notes'>;

type EmailProvider = 'google' | 'microsoft' | 'smtp';
type EmailFolder = 'inbox' | 'sent' | 'templates';

type EmailConnection = {
  provider: EmailProvider;
  address: string;
  status: 'backend_required' | 'connected';
  lastSync: string;
  syncRange: '7' | '30' | '90';
  autoLinkJobNumber: boolean;
  autoLinkClientEmail: boolean;
  createTaskFromUnread: boolean;
  senderName: string;
  replyTo: string;
  signature: string;
  imapHost: string;
  imapPort: string;
  smtpHost: string;
  smtpPort: string;
  security: 'ssl' | 'tls' | 'starttls';
  username: string;
};

type EmailMessage = {
  id: string;
  folder: 'inbox' | 'sent';
  from: string;
  to: string;
  subject: string;
  preview: string;
  jobNumber: string;
  receivedAt: string;
  unread?: boolean;
};

type EmailTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
};

type EmailCompose = {
  to: string;
  subject: string;
  body: string;
  jobNumber: string;
};

type FinancePeriod = 'this_week' | 'this_month' | 'all';
type FinanceTab = 'ready' | 'paid' | 'attention';

type PayrollRules = {
  commissionPercent: number;
  scfOnlyPayout: number;
  deductMaterials: boolean;
  includeScf: boolean;
};

type LibraryCategory = 'Manual' | 'Wiring diagram' | 'Service bulletin' | 'Install guide' | 'Parts list' | 'Warranty' | 'Training';
type LibraryFormat = 'PDF' | 'Image' | 'Video' | 'Link';

type LibraryDocument = {
  id: string;
  title: string;
  category: LibraryCategory;
  system: string;
  manufacturer: string;
  model: string;
  format: LibraryFormat;
  tags: string[];
  uploadedAt: string;
  fileSize: string;
  uploadedBy: string;
  summary: string;
};

type LibraryDraft = {
  title: string;
  category: LibraryCategory;
  system: string;
  manufacturer: string;
  model: string;
  tags: string;
  fileName: string;
};

const emptyMaterialDraft = (jobNumber: string): MaterialRow => ({
  id: `mat-${Date.now()}`,
  jobNumber,
  name: '',
  quantity: 1,
  price: 0,
  supplier: '',
  status: 'Needed',
});

const initialMaterialRows: MaterialRow[] = [
  {
    id: 'mat-243-1',
    jobNumber: '243',
    name: 'Hood belt set',
    quantity: 2,
    price: 48,
    supplier: 'Parts Town',
    status: 'Ordered',
  },
  {
    id: 'mat-242-1',
    jobNumber: '242',
    name: 'Evaporator fan motor',
    quantity: 1,
    price: 185,
    supplier: 'Reliable Parts',
    status: 'Needed',
  },
  {
    id: 'mat-238-1',
    jobNumber: '238',
    name: 'Dual run capacitor',
    quantity: 1,
    price: 39,
    supplier: 'Johnstone Supply',
    status: 'Received',
  },
];

const emptyTaskForm: TaskForm = {
  title: '',
  jobNumber: '',
  assignedTo: '',
  dueDate: '',
  priority: 'Normal',
  notes: '',
};

const initialManualTasks: TaskRow[] = [
  {
    id: 'task-manual-1',
    title: 'Call customer before dispatch',
    jobNumber: '244',
    assignedTo: 'Office',
    dueDate: '2026-06-12',
    priority: 'Normal',
    status: 'To do',
    notes: 'Confirm access and best entrance.',
    source: 'Manual',
  },
];

const emailProviderLabels: Record<EmailProvider, string> = {
  google: 'Google Workspace',
  microsoft: 'Microsoft 365',
  smtp: 'SMTP / IMAP',
};

const initialEmailTemplates: EmailTemplate[] = [
  {
    id: 'tpl-schedule',
    name: 'Appointment confirmation',
    subject: 'Your service appointment',
    body: 'Hi, your service appointment is scheduled. Please reply if the access instructions changed.',
  },
  {
    id: 'tpl-estimate',
    name: 'Estimate follow-up',
    subject: 'Estimate for your service request',
    body: 'Hi, we prepared an estimate for the requested work. Please review it and reply with any questions.',
  },
  {
    id: 'tpl-payment',
    name: 'Payment reminder',
    subject: 'Payment reminder',
    body: 'Hi, this is a friendly reminder that payment is still pending for your service call.',
  },
];

const libraryCategories: LibraryCategory[] = ['Manual', 'Wiring diagram', 'Service bulletin', 'Install guide', 'Parts list', 'Warranty', 'Training'];
const libraryFormats: LibraryFormat[] = ['PDF', 'Image', 'Video', 'Link'];

const initialLibraryDocuments: LibraryDocument[] = [
  {
    id: 'lib-1',
    title: 'Carrier rooftop unit service manual',
    category: 'Manual',
    system: 'HVAC',
    manufacturer: 'Carrier',
    model: '48TC',
    format: 'PDF',
    tags: ['rtu', 'diagnostics', 'fault codes'],
    uploadedAt: '2026-06-10',
    fileSize: '8.4 MB',
    uploadedBy: 'Office',
    summary: 'Service procedures, fault codes, wiring reference, and maintenance tables for Carrier 48TC units.',
  },
  {
    id: 'lib-2',
    title: 'True freezer wiring diagram',
    category: 'Wiring diagram',
    system: 'Appliance',
    manufacturer: 'True',
    model: 'T-49F',
    format: 'Image',
    tags: ['freezer', 'compressor', 'wiring'],
    uploadedAt: '2026-06-09',
    fileSize: '1.1 MB',
    uploadedBy: 'Andrei S',
    summary: 'Electrical diagram for compressor, evaporator fan, defrost timer, and control circuit.',
  },
  {
    id: 'lib-3',
    title: 'Rheem water heater install guide',
    category: 'Install guide',
    system: 'Plumbing',
    manufacturer: 'Rheem',
    model: 'Performance Plus',
    format: 'PDF',
    tags: ['water heater', 'installation', 'venting'],
    uploadedAt: '2026-06-07',
    fileSize: '5.7 MB',
    uploadedBy: 'Office',
    summary: 'Installation checklist, clearances, venting requirements, and startup procedure.',
  },
];

function money(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function statusClassName(status: string) {
  return status.toLowerCase().replace(/\s+/g, '-');
}

function googleRouteUrl(addresses: string[]) {
  const cleanAddresses = addresses.map((address) => address.trim()).filter(Boolean);

  if (cleanAddresses.length === 0) return '';
  if (cleanAddresses.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleanAddresses[0])}`;
  }

  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${encodeURIComponent(cleanAddresses[0])}&destination=${encodeURIComponent(cleanAddresses[cleanAddresses.length - 1])}&waypoints=${cleanAddresses.slice(1, -1).map(encodeURIComponent).join('|')}`;
}

export function App() {
  const initialCompanies = useMemo(() => listCompanies(), []);
  const initialSupportTickets = useMemo(() => listSupportTickets(initialCompanies), [initialCompanies]);
  const initialPlatformUsers = useMemo(() => listPlatformUsers(), []);
  const initialAuditEvents = useMemo(() => listAuditEvents(), []);
  const initialOnboardingProfiles = useMemo(() => listCompanyOnboardingProfiles(initialCompanies), [initialCompanies]);
  const initialPage =
    window.location.hash === '#support'
      ? 'support'
      : window.location.hash === '#company-login'
        ? 'companyLogin'
      : window.location.hash === '#portal'
        ? 'portal'
      : window.location.hash === '#companies'
        ? 'companies'
        : window.location.hash === '#billing'
          ? 'billing'
          : window.location.hash === '#access'
            ? 'access'
            : window.location.hash === '#audit'
              ? 'audit'
        : 'dashboard';
  const [companies, setCompanies] = useState<Company[]>(initialCompanies);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>(initialSupportTickets);
  const [platformUsers, setPlatformUsers] = useState<PlatformUser[]>(initialPlatformUsers);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(initialAuditEvents);
  const [onboardingProfiles, setOnboardingProfiles] = useState<CompanyOnboardingProfile[]>(initialOnboardingProfiles);
  const [selectedTicketId, setSelectedTicketId] = useState(() => initialSupportTickets[0]?.id ?? '');
  const [replyText, setReplyText] = useState('');
  const [selectedCompanyId, setSelectedCompanyId] = useState(() => initialCompanies[0]?.id ?? '');
  const [form, setForm] = useState<NewCompanyForm>(emptyCompany);
  const [supportForm, setSupportForm] = useState<NewSupportTicketForm>(() => ({
    ...emptySupportForm,
    companyId: initialCompanies[0]?.id ?? '',
    authorName: initialCompanies[0]?.ownerName ?? '',
    authorEmail: initialCompanies[0]?.ownerEmail ?? '',
  }));
  const [accessForm, setAccessForm] = useState<NewPlatformUserForm>(emptyAccessForm);
  const [page, setPage] = useState<AppPage>(initialPage);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | CompanyStatus>('all');
  const [auditFilter, setAuditFilter] = useState<'all' | AuditEventCategory>('all');
  const [companyLoginEmail, setCompanyLoginEmail] = useState('');

  const selectedCompany = companies.find((company) => company.id === selectedCompanyId) ?? companies[0];
  const selectedOnboardingProfile = onboardingProfiles.find((profile) => profile.companyId === selectedCompany?.id);
  const selectedTicket = supportTickets.find((ticket) => ticket.id === selectedTicketId) ?? supportTickets[0];
  const openSupportCount = supportTickets.filter((ticket) => ticket.status !== 'resolved').length;

  const totals = useMemo(() => {
    return companies.reduce(
      (acc, company) => {
        acc.revenue += company.revenue;
        acc.openJobs += company.openJobs;
        acc.technicians += company.technicians;
        acc.alerts += company.alerts.length;
        if (company.status === 'active') acc.active += 1;
        return acc;
      },
      { active: 0, alerts: 0, openJobs: 0, revenue: 0, technicians: 0 },
    );
  }, [companies]);

  const filteredCompanies = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return companies.filter((company) => {
      const matchesStatus = status === 'all' || company.status === status;
      const matchesQuery =
        !normalized ||
        [company.name, company.ownerName, company.ownerEmail, company.market, company.domain]
          .join(' ')
          .toLowerCase()
          .includes(normalized);

      return matchesStatus && matchesQuery;
    });
  }, [companies, query, status]);

  function persist(nextCompanies: Company[]) {
    setCompanies(nextCompanies);
    saveCompanies(nextCompanies);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim() || !form.ownerEmail.trim()) return;

    const nextCompany = createCompany(form);
    persist([nextCompany, ...companies]);
    const nextProfiles = [
      ...onboardingProfiles,
      createDefaultCompanyOnboardingProfile(nextCompany),
    ];
    setOnboardingProfiles(nextProfiles);
    saveCompanyOnboardingProfiles(nextProfiles);
    recordAudit({
      category: 'tenant',
      action: 'company.created',
      actor: 'ServiceScope Owner',
      resource: nextCompany.name,
      details: `${nextCompany.plan} tenant created for ${nextCompany.ownerEmail}.`,
    });
    setSelectedCompanyId(nextCompany.id);
    setForm(emptyCompany);
  }

  function updateCompany(companyId: string, updater: (company: Company) => Company) {
    persist(companies.map((company) => (company.id === companyId ? updater(company) : company)));
  }

  function prepareNextStep(companyId: string) {
    updateCompany(companyId, prepareNextOnboardingStep);
  }

  function navigate(nextPage: AppPage) {
    setPage(nextPage);
    window.history.replaceState(null, '', `#${nextPage === 'companyLogin' ? 'company-login' : nextPage}`);
  }

  function recordAudit(event: Omit<AuditEvent, 'id' | 'createdAt'>) {
    setAuditEvents((currentEvents) => {
      const nextEvents = [createAuditEvent(event), ...currentEvents];
      saveAuditEvents(nextEvents);
      return nextEvents;
    });
  }

  function createPortalRequest(request: Pick<NewSupportTicketForm, 'kind' | 'priority' | 'subject' | 'message'>) {
    if (!selectedCompany) return;

    const ticket = createSupportTicket(
      {
        companyId: selectedCompany.id,
        authorName: selectedCompany.ownerName,
        authorEmail: selectedCompany.ownerEmail,
        ...request,
      },
      companies,
    );
    const nextTickets = [ticket, ...supportTickets];
    setSupportTickets(nextTickets);
    saveSupportTickets(nextTickets);
    setSelectedTicketId(ticket.id);
    recordAudit({
      category: 'support',
      action: 'support.ticket_created',
      actor: ticket.authorName,
      resource: ticket.companyName,
      details: `${ticketKindLabels[ticket.kind]} ticket opened from portal: ${ticket.subject}.`,
    });
  }

  if (page === 'companyLogin' || page === 'portal') {
    return (
      <main className="company-shell">
        {page === 'companyLogin' ? (
          <CompanyLogin
            companies={companies}
            email={companyLoginEmail}
            onEmailChange={setCompanyLoginEmail}
            onSelectCompany={(companyId) => {
              setSelectedCompanyId(companyId);
              const company = companies.find((candidate) => candidate.id === companyId);
              setCompanyLoginEmail(company?.ownerEmail ?? '');
              navigate('portal');
            }}
          />
        ) : (
          <CompanyPortal
            selectedCompany={selectedCompany}
            onboardingProfile={selectedOnboardingProfile}
            tickets={supportTickets.filter((ticket) => ticket.companyId === selectedCompany?.id)}
            onSignOut={() => navigate('companyLogin')}
            onUpdateOnboardingProfile={(nextProfile) => {
              const nextProfiles = onboardingProfiles.map((profile) =>
                profile.companyId === nextProfile.companyId ? nextProfile : profile,
              );
              setOnboardingProfiles(nextProfiles);
              saveCompanyOnboardingProfiles(nextProfiles);
              recordAudit({
                category: 'tenant',
                action: 'onboarding.profile_updated',
                actor: selectedCompany?.ownerName ?? 'Company owner',
                resource: selectedCompany?.name ?? 'Company',
                details: 'Company onboarding profile was updated.',
              });
            }}
            onCreateRequest={createPortalRequest}
          />
        )}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Owner navigation">
        <div className="brand-lockup">
          <div className="brand-mark">
            <ShieldCheck size={22} aria-hidden="true" />
          </div>
          <div>
            <strong>ServiceScope</strong>
            <span>Owner Console</span>
          </div>
        </div>

        <nav className="nav-list">
          <button className={`nav-item ${page === 'dashboard' ? 'active' : ''}`} type="button" onClick={() => navigate('dashboard')}>
            <LayoutDashboard size={18} aria-hidden="true" />
            Dashboard
          </button>
          <button className={`nav-item ${page === 'companies' ? 'active' : ''}`} type="button" onClick={() => navigate('companies')}>
            <Building2 size={18} aria-hidden="true" />
            Companies
          </button>
          <button className={`nav-item ${page === 'companies' ? 'active' : ''}`} type="button" onClick={() => navigate('companies')}>
            <Activity size={18} aria-hidden="true" />
            Monitoring
          </button>
          <button className={`nav-item ${page === 'billing' ? 'active' : ''}`} type="button" onClick={() => navigate('billing')}>
            <CreditCard size={18} aria-hidden="true" />
            Billing
          </button>
          <button className={`nav-item ${page === 'access' ? 'active' : ''}`} type="button" onClick={() => navigate('access')}>
            <UserPlus size={18} aria-hidden="true" />
            Access
          </button>
          <button className={`nav-item ${page === 'audit' ? 'active' : ''}`} type="button" onClick={() => navigate('audit')}>
            <FileClock size={18} aria-hidden="true" />
            Audit
          </button>
          <button className={`nav-item ${page === 'support' ? 'active' : ''}`} type="button" onClick={() => navigate('support')}>
            <Inbox size={18} aria-hidden="true" />
            Support
          </button>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Platform owner</p>
            <h1>{page === 'support' ? 'Support Inbox' : page === 'companies' ? 'Companies' : page === 'billing' ? 'Plans & Billing' : page === 'access' ? 'Access' : page === 'audit' ? 'Audit Log' : 'ServiceScope'}</h1>
          </div>
          <button className="icon-button" type="button" aria-label="Platform settings" title="Platform settings">
            <SlidersHorizontal size={20} aria-hidden="true" />
          </button>
        </header>

        {page === 'dashboard' ? (
          <>
        <section className="metrics-grid" aria-label="Platform metrics">
          <MetricCard icon={<Building2 size={20} />} label="Companies" value={companies.length.toString()} detail={`${totals.active} active tenants`} />
          <MetricCard icon={<Users size={20} />} label="Technicians" value={totals.technicians.toString()} detail="Across all tenants" />
          <MetricCard icon={<Activity size={20} />} label="Open jobs" value={totals.openJobs.toString()} detail="Live workload" />
          <MetricCard icon={<CircleDollarSign size={20} />} label="Revenue tracked" value={money(totals.revenue)} detail={`${totals.alerts} owner alerts`} />
          <MetricCard icon={<Inbox size={20} />} label="Support" value={openSupportCount.toString()} detail="Open company requests" />
        </section>

        <DashboardOverview
          companies={companies}
          supportTickets={supportTickets}
          onOpenCompanies={() => navigate('companies')}
          onOpenSupport={() => navigate('support')}
        />
          </>
        ) : page === 'companies' ? (
        <div className="content-grid">
          <section className="panel add-panel" id="companies">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Add tenant</p>
                <h2>New company</h2>
              </div>
              <Plus size={20} aria-hidden="true" />
            </div>

            <form className="company-form" onSubmit={handleSubmit}>
              <label>
                Company name
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Bright Air Services" />
              </label>
              <label>
                Owner name
                <input value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} placeholder="Jordan Lee" />
              </label>
              <label>
                Owner email
                <input type="email" value={form.ownerEmail} onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })} placeholder="owner@company.com" />
              </label>
              <label>
                Tenant domain
                <input value={form.domain} onChange={(event) => setForm({ ...form, domain: event.target.value })} placeholder="brightair.servicescope.app" />
              </label>
              <label>
                Market
                <input value={form.market} onChange={(event) => setForm({ ...form, market: event.target.value })} placeholder="Brooklyn, NY" />
              </label>
              <div className="form-row">
                <label>
                  Plan
                  <select value={form.plan} onChange={(event) => setForm({ ...form, plan: event.target.value as NewCompanyForm['plan'] })}>
                    <option>Launch</option>
                    <option>Growth</option>
                    <option>Scale</option>
                  </select>
                </label>
                <label>
                  Status
                  <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as CompanyStatus })}>
                    <option value="setup">Setup</option>
                    <option value="trial">Trial</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                  </select>
                </label>
              </div>
              <button className="primary-button" type="submit">
                <Plus size={18} aria-hidden="true" />
                Add company
              </button>
            </form>
          </section>

          <section className="panel wide-panel" id="monitoring">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Monitor tenants</p>
                <h2>Companies</h2>
              </div>
              <div className="filters">
                <div className="search-box">
                  <Search size={17} aria-hidden="true" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />
                </div>
                <select value={status} onChange={(event) => setStatus(event.target.value as 'all' | CompanyStatus)} aria-label="Filter by status">
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="trial">Trial</option>
                  <option value="setup">Setup</option>
                  <option value="paused">Paused</option>
                </select>
              </div>
            </div>

            <div className="company-list">
              {filteredCompanies.length === 0 ? (
                <div className="empty-state">
                  <Building2 size={28} aria-hidden="true" />
                  <h3>No companies found</h3>
                  <p>Clear the filters or add a new tenant from the owner panel.</p>
                </div>
              ) : (
                filteredCompanies.map((company) => (
                  <CompanyRow
                    key={company.id}
                    company={company}
                    selected={company.id === selectedCompany?.id}
                    onSelect={() => setSelectedCompanyId(company.id)}
                  />
                ))
              )}
            </div>
          </section>

          {selectedCompany ? (
            <CompanyDetail
              company={selectedCompany}
              onPrepareNext={() => prepareNextStep(selectedCompany.id)}
              onCompleteStep={(step) => updateCompany(selectedCompany.id, (company) => completeOnboardingStep(company, step))}
            />
          ) : null}
        </div>
        ) : page === 'billing' ? (
          <BillingPage
            companies={companies}
            onChangePlan={(companyId, plan) => {
              const company = companies.find((candidate) => candidate.id === companyId);
              updateCompany(companyId, (currentCompany) => applyPlan(currentCompany, plan));
              recordAudit({
                category: 'billing',
                action: 'billing.plan_changed',
                actor: 'ServiceScope Owner',
                resource: company?.name ?? 'Unknown tenant',
                details: `Plan changed to ${plan}.`,
              });
            }}
            onChangeBillingStatus={(companyId, billingStatus) => {
              const company = companies.find((candidate) => candidate.id === companyId);
              updateCompany(companyId, (currentCompany) => ({ ...currentCompany, billingStatus, lastSync: 'Billing updated' }));
              recordAudit({
                category: 'billing',
                action: 'billing.status_changed',
                actor: 'ServiceScope Owner',
                resource: company?.name ?? 'Unknown tenant',
                details: `Billing status changed to ${billingLabels[billingStatus]}.`,
              });
            }}
          />
        ) : page === 'access' ? (
          <AccessPage
            users={platformUsers}
            form={accessForm}
            onFormChange={setAccessForm}
            onInvite={(event) => {
              event.preventDefault();
              if (!accessForm.name.trim() || !accessForm.email.trim()) return;

              const nextUsers = [createPlatformUser(accessForm), ...platformUsers];
              setPlatformUsers(nextUsers);
              savePlatformUsers(nextUsers);
              recordAudit({
                category: 'access',
                action: 'access.user_invited',
                actor: 'ServiceScope Owner',
                resource: accessForm.email,
                details: `${platformRoleLabels[accessForm.role]} invitation sent.`,
              });
              setAccessForm(emptyAccessForm);
            }}
            onRoleChange={(userId, role) => {
              const user = platformUsers.find((candidate) => candidate.id === userId);
              const nextUsers = platformUsers.map((user) =>
                user.id === userId ? updatePlatformUserRole(user, role) : user,
              );
              setPlatformUsers(nextUsers);
              savePlatformUsers(nextUsers);
              recordAudit({
                category: 'access',
                action: 'access.role_changed',
                actor: 'ServiceScope Owner',
                resource: user?.email ?? 'Unknown user',
                details: `Role changed to ${platformRoleLabels[role]}.`,
              });
            }}
            onStatusChange={(userId, status) => {
              const user = platformUsers.find((candidate) => candidate.id === userId);
              const nextUsers = platformUsers.map((user) =>
                user.id === userId ? updatePlatformUserStatus(user, status) : user,
              );
              setPlatformUsers(nextUsers);
              savePlatformUsers(nextUsers);
              recordAudit({
                category: 'access',
                action: 'access.status_changed',
                actor: 'ServiceScope Owner',
                resource: user?.email ?? 'Unknown user',
                details: `User status changed to ${platformStatusLabels[status]}.`,
              });
            }}
          />
        ) : page === 'audit' ? (
          <AuditPage
            events={auditEvents}
            filter={auditFilter}
            onFilterChange={setAuditFilter}
          />
        ) : (
          <SupportPanel
            companies={companies}
            tickets={supportTickets}
            form={supportForm}
            onFormChange={setSupportForm}
            onSubmit={(event) => {
              event.preventDefault();
              if (!supportForm.companyId || !supportForm.subject.trim() || !supportForm.message.trim()) return;

              const ticket = createSupportTicket(supportForm, companies);
              const nextTickets = [ticket, ...supportTickets];
              setSupportTickets(nextTickets);
              saveSupportTickets(nextTickets);
              recordAudit({
                category: 'support',
                action: 'support.ticket_created',
                actor: ticket.authorName,
                resource: ticket.companyName,
                details: `${ticketKindLabels[ticket.kind]} ticket opened: ${ticket.subject}.`,
              });
              setSelectedCompanyId(ticket.companyId);
              setSelectedTicketId(ticket.id);
              setSupportForm({
                ...emptySupportForm,
                companyId: ticket.companyId,
                authorName: ticket.authorName,
                authorEmail: ticket.authorEmail,
              });
            }}
            onStatusChange={(ticketId, nextStatus) => {
              const nextTickets = supportTickets.map((ticket) =>
                ticket.id === ticketId ? updateSupportTicketStatus(ticket, nextStatus) : ticket,
              );
              setSupportTickets(nextTickets);
              saveSupportTickets(nextTickets);
              const ticket = supportTickets.find((candidate) => candidate.id === ticketId);
              recordAudit({
                category: 'support',
                action: 'support.status_changed',
                actor: 'ServiceScope Owner',
                resource: ticket?.companyName ?? 'Unknown tenant',
                details: `Ticket status changed to ${ticketStatusLabels[nextStatus]}.`,
              });
            }}
            selectedTicket={selectedTicket}
            onSelectTicket={setSelectedTicketId}
            replyText={replyText}
            onReplyTextChange={setReplyText}
            onSendReply={(ticketId) => {
              const body = replyText.trim();
              if (!body) return;

              const nextTickets = supportTickets.map((ticket) =>
                ticket.id === ticketId ? addOwnerReply(ticket, body) : ticket,
              );
              setSupportTickets(nextTickets);
              saveSupportTickets(nextTickets);
              const ticket = supportTickets.find((candidate) => candidate.id === ticketId);
              recordAudit({
                category: 'support',
                action: 'support.reply_sent',
                actor: 'ServiceScope Owner',
                resource: ticket?.companyName ?? 'Unknown tenant',
                details: `Reply sent for ticket: ${ticket?.subject ?? 'Support request'}.`,
              });
              setReplyText('');
            }}
          />
        )}
      </section>
    </main>
  );
}

function DashboardOverview({
  companies,
  supportTickets,
  onOpenCompanies,
  onOpenSupport,
}: {
  companies: Company[];
  supportTickets: SupportTicket[];
  onOpenCompanies: () => void;
  onOpenSupport: () => void;
}) {
  const newestCompanies = companies.slice(0, 4);
  const openTickets = supportTickets.filter((ticket) => ticket.status !== 'resolved').slice(0, 4);

  return (
    <div className="overview-grid">
      <section className="panel overview-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Tenant overview</p>
            <h2>Companies</h2>
          </div>
          <button className="secondary-button compact" type="button" onClick={onOpenCompanies}>
            Open
          </button>
        </div>
        <div className="overview-list">
          {newestCompanies.map((company) => (
            <div className="overview-row" key={company.id}>
              <div className="company-main">
                <div className="company-avatar">{company.name.slice(0, 2).toUpperCase()}</div>
                <div>
                  <h3>{company.name}</h3>
                  <p>{company.plan} - {company.market}</p>
                </div>
              </div>
              <StatusPill status={company.status} />
            </div>
          ))}
        </div>
      </section>

      <section className="panel overview-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Customer voice</p>
            <h2>Support</h2>
          </div>
          <button className="secondary-button compact" type="button" onClick={onOpenSupport}>
            Open
          </button>
        </div>
        <div className="overview-list">
          {openTickets.length ? (
            openTickets.map((ticket) => (
              <div className="overview-row support-summary" key={ticket.id}>
                <div>
                  <h3>{ticket.subject}</h3>
                  <p>{ticket.companyName} - {ticketStatusLabels[ticket.status]}</p>
                </div>
                <span className={`ticket-priority ${ticket.priority}`}>{ticketPriorityLabels[ticket.priority]}</span>
              </div>
            ))
          ) : (
            <div className="empty-state compact-empty">
              <CheckCircle2 size={24} aria-hidden="true" />
              <h3>No open support</h3>
              <p>Resolved requests stay out of the owner dashboard.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CompanyLogin({
  companies,
  email,
  onEmailChange,
  onSelectCompany,
}: {
  companies: Company[];
  email: string;
  onEmailChange: (email: string) => void;
  onSelectCompany: (companyId: string) => void;
}) {
  const matchingCompanies = companies.filter((company) =>
    !email.trim() || company.ownerEmail.toLowerCase().includes(email.trim().toLowerCase()),
  );

  return (
    <div className="company-login">
      <section className="company-login-card">
        <div className="brand-lockup company-brand">
          <div className="brand-mark">
            <ShieldCheck size={22} aria-hidden="true" />
          </div>
          <div>
            <strong>ServiceScope</strong>
            <span>Company Access</span>
          </div>
        </div>

        <div className="login-heading">
          <p className="eyebrow">Company login</p>
          <h1>Enter your workspace</h1>
          <p>Companies use this separate entrance to send requests, check launch status, and track support replies.</p>
        </div>

        <label>
          Owner email
          <input type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="owner@company.com" />
        </label>

        <div className="login-company-list">
          {matchingCompanies.map((company) => (
            <button className="login-company-row" type="button" key={company.id} onClick={() => onSelectCompany(company.id)}>
              <div className="company-main">
                <div className="company-avatar">{company.name.slice(0, 2).toUpperCase()}</div>
                <div>
                  <h3>{company.name}</h3>
                  <p>{company.ownerEmail}</p>
                </div>
              </div>
              <StatusPill status={company.status} />
            </button>
          ))}
          {!matchingCompanies.length ? (
            <div className="empty-state compact-empty">
              <Building2 size={24} aria-hidden="true" />
              <h3>No company found</h3>
              <p>Check the owner email or ask ServiceScope support to verify access.</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function CompanyPortal({
  selectedCompany,
  onboardingProfile,
  tickets,
  onSignOut,
  onUpdateOnboardingProfile,
  onCreateRequest,
}: {
  selectedCompany?: Company;
  onboardingProfile?: CompanyOnboardingProfile;
  tickets: SupportTicket[];
  onSignOut: () => void;
  onUpdateOnboardingProfile: (profile: CompanyOnboardingProfile) => void;
  onCreateRequest: (request: Pick<NewSupportTicketForm, 'kind' | 'priority' | 'subject' | 'message'>) => void;
}) {
  const [clientPage, setClientPage] = useState<ClientPage>('jobs');
  const [request, setRequest] = useState<Pick<NewSupportTicketForm, 'kind' | 'priority' | 'subject' | 'message'>>({
    kind: 'change',
    priority: 'normal',
    subject: '',
    message: '',
  });
  const [technicianForm, setTechnicianForm] = useState<NewCompanyTechnicianForm>(emptyTechnicianForm);
  const [jobTypeForm, setJobTypeForm] = useState<NewCompanyJobTypeForm>(emptyJobTypeForm);
  const [openedJob, setOpenedJob] = useState<JobCardData | null>(null);
  const [jobs, setJobs] = useState<ServiceJob[]>([]);
  const [selectedJobTypeId, setSelectedJobTypeId] = useState('');
  const [calendarView, setCalendarView] = useState<'month' | 'week' | 'day'>('week');
  const [activeCalendarTech, setActiveCalendarTech] = useState('all');
  const [calendarAssignments, setCalendarAssignments] = useState<Record<string, { assignee: string; dayKey: string; time: string; durationMinutes: number }>>({});
  const [draggingJobNumber, setDraggingJobNumber] = useState('');
  const [resizingJob, setResizingJob] = useState<{ jobNumber: string; startY: number; startDuration: number } | null>(null);
  const [monthDropRequest, setMonthDropRequest] = useState<{ jobNumber: string; assignee: string; dayKey: string; durationMinutes: number; time: string } | null>(null);
  const [materials, setMaterials] = useState<MaterialRow[]>(initialMaterialRows);
  const [materialStatusFilter, setMaterialStatusFilter] = useState<'all' | MaterialRow['status']>('all');
  const [materialTechFilter, setMaterialTechFilter] = useState('all');
  const [materialSearch, setMaterialSearch] = useState('');
  const [editingMaterialsJobNumber, setEditingMaterialsJobNumber] = useState('');
  const [materialDraftRows, setMaterialDraftRows] = useState<MaterialRow[]>([]);
  const [manualTasks, setManualTasks] = useState<TaskRow[]>(initialManualTasks);
  const [completedAutoTaskIds, setCompletedAutoTaskIds] = useState<string[]>([]);
  const [taskForm, setTaskForm] = useState<TaskForm>(emptyTaskForm);
  const [taskStatusFilter, setTaskStatusFilter] = useState<'all' | TaskStatus>('all');
  const [taskOwnerFilter, setTaskOwnerFilter] = useState('all');
  const [taskSearch, setTaskSearch] = useState('');
  const [mapTechFilter, setMapTechFilter] = useState('all');
  const [mapStatusFilter, setMapStatusFilter] = useState('all');
  const [mapSearch, setMapSearch] = useState('');
  const [emailConnection, setEmailConnection] = useState<EmailConnection | null>(null);
  const [emailFolder, setEmailFolder] = useState<EmailFolder>('inbox');
  const [emailSearch, setEmailSearch] = useState('');
  const [emailCompose, setEmailCompose] = useState<EmailCompose>({
    to: '',
    subject: '',
    body: '',
    jobNumber: '',
  });
  const [financePeriod, setFinancePeriod] = useState<FinancePeriod>('this_month');
  const [financeTechFilter, setFinanceTechFilter] = useState('all');
  const [financeTab, setFinanceTab] = useState<FinanceTab>('ready');
  const [payrollRules, setPayrollRules] = useState<PayrollRules>({
    commissionPercent: 50,
    scfOnlyPayout: 50,
    deductMaterials: true,
    includeScf: true,
  });
  const [salaryPaidJobs, setSalaryPaidJobs] = useState<string[]>(['243']);
  const [libraryDocuments, setLibraryDocuments] = useState<LibraryDocument[]>(initialLibraryDocuments);
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryCategoryFilter, setLibraryCategoryFilter] = useState<'all' | LibraryCategory>('all');
  const [librarySystemFilter, setLibrarySystemFilter] = useState('all');
  const [libraryFormatFilter, setLibraryFormatFilter] = useState<'all' | LibraryFormat>('all');
  const [libraryDraft, setLibraryDraft] = useState<LibraryDraft>({
    title: '',
    category: 'Manual',
    system: 'HVAC',
    manufacturer: '',
    model: '',
    tags: '',
    fileName: '',
  });

  const defaultTechnicianName = onboardingProfile?.technicians[0]?.name ?? 'No technician';

  useEffect(() => {
    if (!selectedCompany) return;
    setJobs(listCompanyJobs(selectedCompany.id, defaultTechnicianName));
  }, [defaultTechnicianName, selectedCompany]);

  useEffect(() => {
    if (!resizingJob) return undefined;
    const activeResize = resizingJob;

    function handlePointerMove(event: globalThis.PointerEvent) {
      const deltaMinutes = Math.round((event.clientY - activeResize.startY) / 32) * 30;
      const durationMinutes = Math.min(720, Math.max(30, activeResize.startDuration + deltaMinutes));

      setCalendarAssignments((assignments) => {
        const assignment = assignments[activeResize.jobNumber];
        if (!assignment) return assignments;

        return {
          ...assignments,
          [activeResize.jobNumber]: {
            ...assignment,
            durationMinutes,
          },
        };
      });
    }

    function handlePointerUp() {
      setResizingJob(null);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [resizingJob]);

  if (!selectedCompany) {
    return (
      <div className="empty-state">
        <Building2 size={28} aria-hidden="true" />
        <h3>No tenant selected</h3>
        <p>Add a company first, then open the portal preview.</p>
      </div>
    );
  }

  const completedSteps = Object.values(selectedCompany.onboarding).filter((step) => step === 'done').length;
  const openTickets = tickets.filter((ticket) => ticket.status !== 'resolved');
  const profile = onboardingProfile ?? createDefaultCompanyOnboardingProfile(selectedCompany);
  const professionTemplates = makeJobTypes();
  const configuredProfessionNames = new Set(profile.jobTypes.map((jobType) => jobType.name.toLowerCase()));
  const defaultJobType = profile.jobTypes.find((jobType) => jobType.name === 'HVAC') ?? profile.jobTypes[0];
  const selectedJobType = profile.jobTypes.find((jobType) => jobType.id === selectedJobTypeId) ?? defaultJobType;
  const selectedJobPrefix = profile.useJobNumberPrefixes ? selectedJobType?.jobNumberPrefix || profile.jobNumberPrefix || 'JOB' : '';
  const highestJobNumber = jobs.reduce((highest, job) => {
    const lastPart = job.jobNumber.split('-').pop() ?? job.jobNumber;
    const numericJobNumber = Number(lastPart);
    return Number.isFinite(numericJobNumber) ? Math.max(highest, numericJobNumber) : highest;
  }, selectedCompany.openJobs);
  const nextJobNumber = String(highestJobNumber + 1).padStart(4, '0');
  const sampleJobNumber = selectedJobPrefix ? `${selectedJobPrefix}-${nextJobNumber}` : nextJobNumber;
  const sampleTechnician = profile.technicians[0]?.name ?? 'Unassigned';
  const sampleJob: JobCardData = {
    id: 'sample-job',
    companyId: selectedCompany.id,
    jobNumber: sampleJobNumber,
    status: 'New',
    system: selectedJobType?.name ?? 'HVAC',
    clientName: 'John Smith',
    organization: 'Sharewood Office',
    phone: '(555) 210-4420',
    email: 'client@example.com',
    address: '35 Box St, Brooklyn, NY 11222, USA',
    technician: sampleTechnician,
    assignee: sampleTechnician,
    serviceCallFee: money(profile.serviceCallFee),
    scfPayment: '',
    labor: '',
    laborPayment: '',
    issue: 'AC not cooling in the main office.',
    notes: '',
    createdAt: new Date().toISOString().slice(0, 10),
  };
  const jobStatusFilters = ['ReCall', 'Diagnosis', 'In progress', 'Parts ordered', 'Waiting for parts', 'To finish', 'Completed', 'Warranty'];
  const allJobsRows = jobs;
  const allJobsGroups = Array.from(new Set(['No technician', ...allJobsRows.map((job) => job.assignee)])).map((technician) => ({
    technician,
    jobs: allJobsRows.filter((job) => job.assignee === technician),
  })).filter((group) => group.jobs.length > 0);
  const technicianLocations = profile.technicians.map((technician, index) => {
    const samples = [
      { x: 42, y: 61, lat: '40.72764', lng: '-74.05667', area: 'Hoboken / Jersey City', updatedAt: '11.06.2026, 21:39:58', online: false },
      { x: 55, y: 38, lat: '40.75892', lng: '-73.98513', area: 'Midtown Manhattan', updatedAt: '11.06.2026, 21:36:14', online: false },
      { x: 68, y: 70, lat: '40.67818', lng: '-73.94416', area: 'Brooklyn', updatedAt: '11.06.2026, 21:31:08', online: false },
    ];
    const sample = samples[index % samples.length];

    return {
      ...technician,
      ...sample,
      lastSeen: sample.updatedAt,
    };
  });
  const filteredTechnicianLocations = technicianLocations.filter((technician) => {
    const normalizedSearch = mapSearch.trim().toLowerCase();
    const matchesTech = mapTechFilter === 'all' || technician.name === mapTechFilter;
    const matchesGps = mapStatusFilter === 'all' || (mapStatusFilter === 'online' ? technician.online : !technician.online);
    const haystack = [technician.name, technician.email, technician.phone, technician.area, technician.lat, technician.lng]
      .join(' ')
      .toLowerCase();

    return matchesTech && matchesGps && (!normalizedSearch || haystack.includes(normalizedSearch));
  });
  const materialStatuses: MaterialRow['status'][] = ['Needed', 'Ordered', 'Received', 'Installed', 'Returned'];
  const materialJobMap = new globalThis.Map(allJobsRows.map((job) => [job.jobNumber, job]));
  const emailMessages: EmailMessage[] = [
    {
      id: 'mail-1',
      folder: 'inbox',
      from: 'ilona@example.com',
      to: emailConnection?.address ?? profile.billingEmail,
      subject: 'Re: Service request #244',
      preview: 'Can you confirm what time the technician will arrive?',
      jobNumber: '244',
      receivedAt: 'Today, 9:14 AM',
      unread: true,
    },
    {
      id: 'mail-2',
      folder: 'inbox',
      from: 'manager@fycflash.com',
      to: emailConnection?.address ?? profile.billingEmail,
      subject: 'Parts for hood repair',
      preview: 'Please send the estimate before ordering belts.',
      jobNumber: '243',
      receivedAt: 'Yesterday, 4:42 PM',
    },
    {
      id: 'mail-3',
      folder: 'sent',
      from: emailConnection?.address ?? profile.billingEmail,
      to: 'ricardo@example.com',
      subject: 'Service appointment confirmation',
      preview: 'Your technician is scheduled for the freezer diagnosis.',
      jobNumber: '242',
      receivedAt: 'Yesterday, 1:08 PM',
    },
  ];
  const visibleEmailMessages = emailMessages.filter((message) => {
    const normalizedSearch = emailSearch.trim().toLowerCase();
    const job = materialJobMap.get(message.jobNumber);
    const haystack = [message.from, message.to, message.subject, message.preview, message.jobNumber, job?.organization, job?.clientName]
      .join(' ')
      .toLowerCase();

    return message.folder === emailFolder && (!normalizedSearch || haystack.includes(normalizedSearch));
  });
  const connectMailbox = (provider: EmailProvider) => {
    const domain = selectedCompany.domain?.replace(/^https?:\/\//, '').split('.')[0] || selectedCompany.name.toLowerCase().replace(/\s+/g, '');
    const address = provider === 'smtp' ? `dispatch@${domain}.com` : selectedCompany.ownerEmail;

    setEmailConnection({
      provider,
      address,
      status: 'backend_required',
      lastSync: 'Not synced',
      syncRange: '30',
      autoLinkJobNumber: true,
      autoLinkClientEmail: true,
      createTaskFromUnread: true,
      senderName: profile.displayName || selectedCompany.name,
      replyTo: address,
      signature: `${profile.displayName || selectedCompany.name}\n${profile.phone || selectedCompany.ownerEmail}`,
      imapHost: provider === 'smtp' ? `imap.${domain}.com` : '',
      imapPort: provider === 'smtp' ? '993' : '',
      smtpHost: provider === 'smtp' ? `smtp.${domain}.com` : '',
      smtpPort: provider === 'smtp' ? '587' : '',
      security: provider === 'smtp' ? 'tls' : 'ssl',
      username: provider === 'smtp' ? address : '',
    });
  };
  const updateMailbox = (patch: Partial<EmailConnection>) => {
    setEmailConnection((connection) => (connection ? { ...connection, ...patch } : connection));
  };
  const applyEmailTemplate = (template: EmailTemplate) => {
    setEmailCompose((draft) => ({
      ...draft,
      subject: template.subject,
      body: template.body,
    }));
    setEmailFolder('inbox');
  };
  const sendEmailDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEmailCompose({ to: '', subject: '', body: '', jobNumber: '' });
  };
  const materialRowsWithJobs = materials
    .map((material) => ({ material, job: materialJobMap.get(material.jobNumber) }))
    .filter((row): row is { material: MaterialRow; job: typeof allJobsRows[number] } => Boolean(row.job));
  const filteredMaterialRows = materialRowsWithJobs.filter(({ material, job }) => {
    const normalizedSearch = materialSearch.trim().toLowerCase();
    const matchesStatus = materialStatusFilter === 'all' || material.status === materialStatusFilter;
    const matchesTech = materialTechFilter === 'all' || job.assignee === materialTechFilter;
    const haystack = [job.jobNumber, job.organization, job.clientName, job.phone, job.address, job.system, job.issue, material.name, material.supplier]
      .join(' ')
      .toLowerCase();

    return matchesStatus && matchesTech && (!normalizedSearch || haystack.includes(normalizedSearch));
  });
  const jobsWithoutMaterials = allJobsRows.filter((job) => !materials.some((material) => material.jobNumber === job.jobNumber));
  const selectedMaterialsJob = materialJobMap.get(editingMaterialsJobNumber);
  const materialsTotal = filteredMaterialRows.reduce((sum, { material }) => sum + material.quantity * material.price, 0);
  const openMaterialEditor = (jobNumber: string) => {
    const existingRows = materials.filter((material) => material.jobNumber === jobNumber);
    setEditingMaterialsJobNumber(jobNumber);
    setMaterialDraftRows(existingRows.length ? existingRows.map((material) => ({ ...material })) : [emptyMaterialDraft(jobNumber)]);
  };
  const updateMaterialDraft = (rowId: string, patch: Partial<MaterialRow>) => {
    setMaterialDraftRows((rows) => rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };
  const addMaterialDraftRow = () => {
    if (!editingMaterialsJobNumber) return;
    setMaterialDraftRows((rows) => [...rows, emptyMaterialDraft(editingMaterialsJobNumber)]);
  };
  const removeMaterialDraftRow = (rowId: string) => {
    setMaterialDraftRows((rows) => rows.filter((row) => row.id !== rowId));
  };
  const saveMaterialDraftRows = () => {
    if (!editingMaterialsJobNumber) return;
    const cleanRows = materialDraftRows
      .filter((row) => row.name.trim() || row.supplier.trim())
      .map((row) => ({
        ...row,
        jobNumber: editingMaterialsJobNumber,
        name: row.name.trim(),
        supplier: row.supplier.trim(),
        quantity: Math.max(1, Number(row.quantity) || 1),
        price: Math.max(0, Number(row.price) || 0),
      }));

    setMaterials((rows) => [
      ...rows.filter((row) => row.jobNumber !== editingMaterialsJobNumber),
      ...cleanRows,
    ]);
    setEditingMaterialsJobNumber('');
    setMaterialDraftRows([]);
  };
  const financeRows = allJobsRows.map((job) => {
    const materialsCost = materials
      .filter((material) => material.jobNumber === job.jobNumber)
      .reduce((sum, material) => sum + material.quantity * material.price, 0);
    const scf = Number(job.serviceCallFee || 0);
    const labor = Number(job.labor || 0);
    const paidScf = job.scfPayment ? scf : 0;
    const paidLabor = job.laborPayment ? labor : 0;
    const onlyScf = paidScf > 0 && paidLabor === 0;
    const salaryBase = Math.max(0, (payrollRules.includeScf ? paidScf : 0) + paidLabor - (payrollRules.deductMaterials ? materialsCost : 0));
    const salary = onlyScf ? payrollRules.scfOnlyPayout : salaryBase * (payrollRules.commissionPercent / 100);
    const paid = salaryPaidJobs.includes(job.jobNumber);
    const warnings = [
      job.assignee === 'No technician' ? 'No technician assigned' : '',
      scf > 0 && !job.scfPayment ? 'SCF payment is missing' : '',
      labor > 0 && !job.laborPayment ? 'Labor payment is missing' : '',
      materialsCost > paidScf + paidLabor ? 'Materials exceed collected payments' : '',
      !paid && salary === 0 ? 'No payable payroll yet' : '',
    ].filter(Boolean);
    const needsAttention = warnings.length > 0;

    return {
      ...job,
      materialsCost,
      paidScf,
      paidLabor,
      salaryBase,
      salary,
      paid,
      warnings,
      needsAttention,
    };
  });
  const financeBaseRows = financeRows.filter((job) => {
    const matchesTech = financeTechFilter === 'all' || job.assignee === financeTechFilter;
    const matchesPeriod =
      financePeriod === 'all' ||
      (financePeriod === 'this_week' ? job.createdAt >= '2026-06-07' : job.createdAt >= '2026-06-01');

    return matchesTech && matchesPeriod;
  });
  const financeTabCounts = {
    ready: financeBaseRows.filter((job) => !job.paid && !job.needsAttention && job.salary > 0).length,
    paid: financeBaseRows.filter((job) => job.paid).length,
    attention: financeBaseRows.filter((job) => job.needsAttention).length,
  };
  const filteredFinanceRows = financeBaseRows.filter((job) => {
    if (financeTab === 'paid') return job.paid;
    if (financeTab === 'attention') return job.needsAttention;
    return !job.paid && !job.needsAttention && job.salary > 0;
  });
  const financeSummary = filteredFinanceRows.reduce(
    (summary, job) => {
      summary.paidRevenue += job.paidScf + job.paidLabor;
      summary.materials += job.materialsCost;
      summary.salary += job.salary;
      summary.unpaidSalary += job.paid ? 0 : job.salary;
      return summary;
    },
    { paidRevenue: 0, materials: 0, salary: 0, unpaidSalary: 0 },
  );
  const technicianPayroll = profile.technicians.map((technician) => {
    const rows = financeBaseRows.filter((job) => job.assignee === technician.name);
    return {
      technician,
      jobs: rows.length,
      revenue: rows.reduce((sum, job) => sum + job.paidScf + job.paidLabor, 0),
      materials: rows.reduce((sum, job) => sum + job.materialsCost, 0),
      salary: rows.reduce((sum, job) => sum + job.salary, 0),
      unpaid: rows.reduce((sum, job) => sum + (job.paid ? 0 : job.salary), 0),
      attention: rows.filter((job) => job.needsAttention).length,
    };
  });
  const paymentBuckets = filteredFinanceRows.reduce<Record<string, number>>((buckets, job) => {
    if (job.scfPayment) buckets[paymentMethodLabels[job.scfPayment as CompanyPaymentMethod] ?? job.scfPayment] = (buckets[paymentMethodLabels[job.scfPayment as CompanyPaymentMethod] ?? job.scfPayment] ?? 0) + job.paidScf;
    if (job.laborPayment) buckets[paymentMethodLabels[job.laborPayment as CompanyPaymentMethod] ?? job.laborPayment] = (buckets[paymentMethodLabels[job.laborPayment as CompanyPaymentMethod] ?? job.laborPayment] ?? 0) + job.paidLabor;
    return buckets;
  }, {});
  const toggleSalaryPaid = (jobNumber: string) => {
    setSalaryPaidJobs((jobs) => (jobs.includes(jobNumber) ? jobs.filter((number) => number !== jobNumber) : [...jobs, jobNumber]));
  };
  const handleCreateJob = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rawJobNumber = String(form.get('jobNumber') ?? '').trim();
    const technicianName = String(form.get('technician') ?? '').trim();
    const jobForm: NewServiceJobForm = {
      jobNumber: rawJobNumber && rawJobNumber.toLowerCase() !== 'automatic' ? rawJobNumber : sampleJobNumber,
      system: selectedJobType?.name ?? String(form.get('system') ?? 'General'),
      clientName: String(form.get('clientName') ?? '').trim() || 'Unknown client',
      organization: String(form.get('organization') ?? '').trim() || 'Unknown company',
      phone: String(form.get('phone') ?? '').trim(),
      email: String(form.get('email') ?? '').trim(),
      address: String(form.get('address') ?? '').trim(),
      technician: technicianName,
      serviceCallFee: String(form.get('serviceCallFee') ?? profile.serviceCallFee).trim() || String(profile.serviceCallFee),
      issue: String(form.get('issue') ?? '').trim() || 'Service request',
      notes: String(form.get('notes') ?? '').trim(),
    };
    const createdJob = createServiceJob(selectedCompany.id, jobForm);

    setJobs((currentJobs) => {
      const nextJobs = [createdJob, ...currentJobs];
      saveCompanyJobs(selectedCompany.id, nextJobs);
      return nextJobs;
    });
    setOpenedJob(createdJob);
  };
  const librarySystems = Array.from(new Set([...profile.jobTypes.map((jobType) => jobType.name), ...libraryDocuments.map((document) => document.system)])).filter(Boolean);
  const filteredLibraryDocuments = libraryDocuments.filter((document) => {
    const normalizedSearch = librarySearch.trim().toLowerCase();
    const matchesCategory = libraryCategoryFilter === 'all' || document.category === libraryCategoryFilter;
    const matchesSystem = librarySystemFilter === 'all' || document.system === librarySystemFilter;
    const matchesFormat = libraryFormatFilter === 'all' || document.format === libraryFormatFilter;
    const haystack = [
      document.title,
      document.category,
      document.system,
      document.manufacturer,
      document.model,
      document.format,
      document.summary,
      document.tags.join(' '),
    ]
      .join(' ')
      .toLowerCase();

    return matchesCategory && matchesSystem && matchesFormat && (!normalizedSearch || haystack.includes(normalizedSearch));
  });
  const handleLibraryFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLibraryDraft((draft) => ({
      ...draft,
      fileName: file.name,
      title: draft.title || file.name.replace(/\.[^/.]+$/, ''),
    }));
  };
  const addLibraryDocument = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!libraryDraft.title.trim()) return;

    setLibraryDocuments((documents) => [
      {
        id: `lib-${Date.now()}`,
        title: libraryDraft.title.trim(),
        category: libraryDraft.category,
        system: libraryDraft.system.trim() || 'General',
        manufacturer: libraryDraft.manufacturer.trim() || 'Unknown',
        model: libraryDraft.model.trim() || 'Any model',
        format: libraryDraft.fileName.toLowerCase().match(/\.(png|jpg|jpeg|webp)$/) ? 'Image' : 'PDF',
        tags: libraryDraft.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        uploadedAt: '2026-06-12',
        fileSize: libraryDraft.fileName ? 'Pending storage' : 'Link / reference',
        uploadedBy: 'Company admin',
        summary: libraryDraft.fileName
          ? `Uploaded file: ${libraryDraft.fileName}`
          : 'Reference document added by the company admin.',
      },
      ...documents,
    ]);
    setLibraryDraft({
      title: '',
      category: 'Manual',
      system: profile.jobTypes[0]?.name ?? 'HVAC',
      manufacturer: '',
      model: '',
      tags: '',
      fileName: '',
    });
  };
  const autoTasks: TaskRow[] = allJobsRows.flatMap((job) => {
    const rows: TaskRow[] = [];
    const jobMaterials = materials.filter((material) => material.jobNumber === job.jobNumber);

    if (!job.scfPayment) {
      rows.push({
        id: `auto-${job.jobNumber}-scf`,
        title: 'Collect SCF payment',
        jobNumber: job.jobNumber,
        assignedTo: job.assignee === 'No technician' ? 'Office' : job.assignee,
        dueDate: '2026-06-12',
        priority: 'Urgent',
        status: completedAutoTaskIds.includes(`auto-${job.jobNumber}-scf`) ? 'Done' : 'To do',
        notes: 'Service call fee is still unpaid.',
        source: 'Auto',
      });
    }

    if (job.assignee === 'No technician') {
      rows.push({
        id: `auto-${job.jobNumber}-assign-tech`,
        title: 'Assign technician',
        jobNumber: job.jobNumber,
        assignedTo: 'Dispatcher',
        dueDate: '2026-06-12',
        priority: 'Normal',
        status: completedAutoTaskIds.includes(`auto-${job.jobNumber}-assign-tech`) ? 'Done' : 'To do',
        notes: 'Job is active but has no technician.',
        source: 'Auto',
      });
    }

    if (jobMaterials.some((material) => material.status === 'Needed')) {
      rows.push({
        id: `auto-${job.jobNumber}-order-parts`,
        title: 'Order required parts',
        jobNumber: job.jobNumber,
        assignedTo: 'Office',
        dueDate: '2026-06-12',
        priority: 'Normal',
        status: completedAutoTaskIds.includes(`auto-${job.jobNumber}-order-parts`) ? 'Done' : 'To do',
        notes: 'One or more materials are marked as needed.',
        source: 'Auto',
      });
    }

    if (jobMaterials.some((material) => material.status === 'Received') && job.status !== 'Completed') {
      rows.push({
        id: `auto-${job.jobNumber}-return-visit`,
        title: 'Schedule return visit',
        jobNumber: job.jobNumber,
        assignedTo: job.assignee === 'No technician' ? 'Dispatcher' : job.assignee,
        dueDate: '2026-06-13',
        priority: 'Normal',
        status: completedAutoTaskIds.includes(`auto-${job.jobNumber}-return-visit`) ? 'Done' : 'To do',
        notes: 'Parts are received and the job is not completed yet.',
        source: 'Auto',
      });
    }

    return rows;
  });
  const taskRows = [...autoTasks, ...manualTasks];
  const filteredTaskRows = taskRows.filter((task) => {
    const job = materialJobMap.get(task.jobNumber);
    const normalizedSearch = taskSearch.trim().toLowerCase();
    const haystack = [task.title, task.jobNumber, task.assignedTo, task.notes, job?.organization, job?.clientName, job?.issue]
      .join(' ')
      .toLowerCase();
    const matchesStatus = taskStatusFilter === 'all' || task.status === taskStatusFilter;
    const matchesOwner = taskOwnerFilter === 'all' || task.assignedTo === taskOwnerFilter;

    return matchesStatus && matchesOwner && (!normalizedSearch || haystack.includes(normalizedSearch));
  });
  const taskAssignees = Array.from(new Set(['Office', 'Dispatcher', ...profile.technicians.map((technician) => technician.name), ...taskRows.map((task) => task.assignedTo)])).filter(Boolean);
  const openTaskCount = taskRows.filter((task) => task.status !== 'Done').length;
  const autoTaskCount = autoTasks.filter((task) => task.status !== 'Done').length;
  const urgentTaskCount = taskRows.filter((task) => task.priority === 'Urgent' && task.status !== 'Done').length;
  const createManualTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!taskForm.title.trim()) return;

    setManualTasks((tasks) => [
      {
        id: `task-${Date.now()}`,
        title: taskForm.title.trim(),
        jobNumber: taskForm.jobNumber,
        assignedTo: taskForm.assignedTo || 'Office',
        dueDate: taskForm.dueDate,
        priority: taskForm.priority,
        status: 'To do',
        notes: taskForm.notes.trim(),
        source: 'Manual',
      },
      ...tasks,
    ]);
    setTaskForm(emptyTaskForm);
  };
  const updateTaskStatus = (task: TaskRow, status: TaskStatus) => {
    if (task.source === 'Auto') {
      setCompletedAutoTaskIds((ids) => (status === 'Done' ? Array.from(new Set([...ids, task.id])) : ids.filter((id) => id !== task.id)));
      return;
    }

    setManualTasks((tasks) => tasks.map((row) => (row.id === task.id ? { ...row, status } : row)));
  };
  const calendarDays = [
    { key: '2026-06-08', label: 'Mon', date: 'Jun 8', isoDate: '2026-06-08' },
    { key: '2026-06-09', label: 'Tue', date: 'Jun 9', isoDate: '2026-06-09' },
    { key: '2026-06-10', label: 'Wed', date: 'Jun 10', isoDate: '2026-06-10' },
    { key: '2026-06-11', label: 'Thu', date: 'Jun 11', isoDate: '2026-06-11' },
    { key: '2026-06-12', label: 'Fri', date: 'Jun 12', isoDate: '2026-06-12' },
    { key: '2026-06-13', label: 'Sat', date: 'Jun 13', isoDate: '2026-06-13' },
    { key: '2026-06-14', label: 'Sun', date: 'Jun 14', isoDate: '2026-06-14' },
  ];
  const calendarMonthDays = Array.from({ length: 30 }, (_, index) => {
    const day = index + 1;
    const isoDate = `2026-06-${String(day).padStart(2, '0')}`;

    return {
      key: isoDate,
      label: new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }),
      date: `Jun ${day}`,
      isoDate,
      day,
    };
  });
  const allCalendarDays = [...calendarMonthDays];
  const calendarSlots = ['8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM'];
  const calendarSlotHours: Record<string, number> = {
    '8 AM': 8,
    '9 AM': 9,
    '10 AM': 10,
    '11 AM': 11,
    '12 PM': 12,
    '1 PM': 13,
    '2 PM': 14,
    '3 PM': 15,
    '4 PM': 16,
    '5 PM': 17,
    '6 PM': 18,
    '7 PM': 19,
    '8 PM': 20,
  };
  const calendarDropSlots = calendarSlots.slice(0, -1).flatMap((slot) => [
    { key: `${slot}:00`, label: slot, hour: calendarSlotHours[slot], minute: 0 },
    { key: `${slot}:30`, label: slot.replace(/\s/, ':30 '), hour: calendarSlotHours[slot], minute: 30 },
  ]);
  const calendarDurations = [60, 120, 240, 90, 360, 180];
  const defaultScheduledAssignments = Object.fromEntries(
    allJobsRows.slice(1).map((job, index) => [
      job.jobNumber,
      {
        assignee: job.assignee,
        dayKey: calendarDays[index % calendarDays.length].key,
        time: calendarDropSlots[(index * 3 + 2) % calendarDropSlots.length].key,
        durationMinutes: calendarDurations[index % calendarDurations.length],
      },
    ]),
  );
  const calendarJobs = allJobsRows.map((job) => {
    const assignment = calendarAssignments[job.jobNumber] ?? defaultScheduledAssignments[job.jobNumber];
    const appointmentDay = allCalendarDays.find((day) => day.key === assignment?.dayKey);
    const appointmentSlot = calendarDropSlots.find((slot) => slot.key === assignment?.time);
    const appointment = appointmentDay && appointmentSlot ? `${appointmentDay.isoDate}T${String(appointmentSlot.hour).padStart(2, '0')}:${String(appointmentSlot.minute).padStart(2, '0')}` : undefined;

    return {
      ...job,
      technician: assignment?.assignee ?? job.technician,
      assignee: assignment?.assignee ?? job.assignee,
      dayKey: assignment?.dayKey,
      time: assignment?.time,
      durationMinutes: assignment?.durationMinutes ?? 120,
      appointment,
    };
  });
  const scheduledJobs = calendarJobs.filter((job) => job.dayKey && job.time && job.assignee !== 'No technician');
  const unassignedCalendarJobs = calendarJobs.filter((job) => !job.dayKey || job.assignee === 'No technician');
  const visibleCalendarJobs = scheduledJobs.filter((job) => activeCalendarTech === 'all' || job.assignee === activeCalendarTech);
  const visibleCalendarDays = calendarView === 'day' ? [calendarDays[2]] : calendarDays;
  const onboardingItems = [
    {
      title: 'Workspace and mailbox',
      detail: emailConnection
        ? `${emailProviderLabels[emailConnection.provider]} setup drafted for ${emailConnection.address}. OAuth/backend integration required.`
        : 'Business profile, logo, service area, and company mailbox connection.',
      status: emailConnection?.status === 'connected' ? 'done' : 'current',
    },
    {
      title: 'Team and access',
      detail: 'Invite technicians, assign roles, set permissions, and choose who can manage jobs, finance, and support.',
      status: selectedCompany.technicians > 0 ? 'current' : 'todo',
    },
    {
      title: 'Job workflow',
      detail: 'Configure job types, statuses, priority rules, dispatch fields, and required job notes.',
      status: selectedCompany.onboarding.data,
    },
    {
      title: 'Billing and plan',
      detail: 'Confirm subscription plan, seats, technician limits, billing contact, and payment status.',
      status: selectedCompany.onboarding.billing,
    },
    {
      title: 'Go live',
      detail: 'Final owner review before the company starts using ServiceScope with its team.',
      status: completedSteps === onboardingStepOrder.length ? 'done' : 'todo',
    },
  ];
  const clientNavItems: { page: ClientPage; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { page: 'jobs', label: 'Jobs', icon: <ClipboardList size={16} /> },
    { page: 'allJobs', label: 'All Jobs', icon: <LayoutDashboard size={16} /> },
    { page: 'calendar', label: 'Calendar', icon: <CalendarDays size={16} /> },
    { page: 'materials', label: 'Materials', icon: <Box size={16} /> },
    { page: 'tasks', label: 'Tasks', icon: <CheckCircle2 size={16} /> },
    { page: 'map', label: 'Map', icon: <Map size={16} /> },
    { page: 'email', label: 'Email', icon: <MailPlus size={16} /> },
    { page: 'finances', label: 'Finance', icon: <CreditCard size={16} /> },
    { page: 'knowledge', label: 'Library', icon: <BookOpen size={16} /> },
    { page: 'onboarding', label: 'Onboarding', icon: <Rocket size={16} /> },
    { page: 'portal', label: 'Portal', icon: <Rocket size={16} /> },
  ];

  function handleRequestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!request.subject.trim() || !request.message.trim()) return;

    onCreateRequest(request);
    setRequest({
      kind: 'change',
      priority: 'normal',
      subject: '',
      message: '',
    });
  }

  function updateProfile(updates: Partial<CompanyOnboardingProfile>) {
    onUpdateOnboardingProfile({ ...profile, ...updates });
  }

  function handleLogoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener('load', () => {
      updateProfile({ logoUrl: String(reader.result ?? '') });
    });
    reader.readAsDataURL(file);
  }

  function handleTechnicianSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!technicianForm.name.trim() || !technicianForm.email.trim()) return;

    updateProfile({
      technicians: [createCompanyTechnician(technicianForm), ...profile.technicians],
    });
    setTechnicianForm(emptyTechnicianForm);
  }

  function handleJobTypeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!jobTypeForm.name.trim()) return;

    updateProfile({
      jobTypes: [createCompanyJobType(jobTypeForm), ...profile.jobTypes],
    });
    setJobTypeForm(emptyJobTypeForm);
  }

  function addProfessionTemplate(template: NewCompanyJobTypeForm) {
    if (configuredProfessionNames.has(template.name.toLowerCase())) return;

    updateProfile({
      jobTypes: [...profile.jobTypes, createCompanyJobType(template)],
    });
  }

  function removeJobType(jobTypeId: string) {
    const jobTypes = profile.jobTypes.filter((jobType) => jobType.id !== jobTypeId);
    updateProfile({ jobTypes });

    if (selectedJobTypeId === jobTypeId) {
      setSelectedJobTypeId('');
    }
  }

  function handleCalendarDragStart(event: DragEvent<HTMLElement>, jobNumber: string) {
    setDraggingJobNumber(jobNumber);
    event.dataTransfer.setData('text/plain', jobNumber);
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleCalendarDrop(event: DragEvent<HTMLDivElement>, dayKey: string, slotKey: string) {
    event.preventDefault();
    const jobNumber = event.dataTransfer.getData('text/plain') || draggingJobNumber;
    if (!jobNumber) return;
    const movedJob = calendarJobs.find((job) => job.jobNumber === jobNumber);
    const assignee = activeCalendarTech !== 'all' ? activeCalendarTech : movedJob?.assignee;
    if (!assignee || assignee === 'No technician') return;
    const appointmentDay = allCalendarDays.find((day) => day.key === dayKey);
    const appointmentSlot = calendarDropSlots.find((slot) => slot.key === slotKey);
    const appointment = appointmentDay && appointmentSlot ? `${appointmentDay.isoDate}T${String(appointmentSlot.hour).padStart(2, '0')}:${String(appointmentSlot.minute).padStart(2, '0')}` : undefined;

    setCalendarAssignments((assignments) => ({
      ...assignments,
      [jobNumber]: {
        assignee,
        dayKey,
        time: slotKey,
        durationMinutes: assignments[jobNumber]?.durationMinutes ?? movedJob?.durationMinutes ?? 120,
      },
    }));
    setOpenedJob((job) => job?.jobNumber === jobNumber ? { ...job, technician: assignee, appointment } : job);
    setDraggingJobNumber('');
  }

  function handleCalendarMonthDrop(event: DragEvent<HTMLDivElement>, dayKey: string) {
    event.preventDefault();
    const jobNumber = event.dataTransfer.getData('text/plain') || draggingJobNumber;
    if (!jobNumber) return;
    const movedJob = calendarJobs.find((job) => job.jobNumber === jobNumber);
    const assignee = activeCalendarTech !== 'all' ? activeCalendarTech : movedJob?.assignee;
    if (!assignee || assignee === 'No technician') return;

    setMonthDropRequest({
      jobNumber,
      assignee,
      dayKey,
      time: movedJob?.time ?? '9 AM:00',
      durationMinutes: calendarAssignments[jobNumber]?.durationMinutes ?? movedJob?.durationMinutes ?? 120,
    });
    setDraggingJobNumber('');
  }

  function confirmCalendarMonthDrop() {
    if (!monthDropRequest) return;
    const appointmentDay = allCalendarDays.find((day) => day.key === monthDropRequest.dayKey);
    const appointmentSlot = calendarDropSlots.find((slot) => slot.key === monthDropRequest.time);
    const appointment = appointmentDay && appointmentSlot ? `${appointmentDay.isoDate}T${String(appointmentSlot.hour).padStart(2, '0')}:${String(appointmentSlot.minute).padStart(2, '0')}` : undefined;

    setCalendarAssignments((assignments) => ({
      ...assignments,
      [monthDropRequest.jobNumber]: {
        assignee: monthDropRequest.assignee,
        dayKey: monthDropRequest.dayKey,
        time: monthDropRequest.time,
        durationMinutes: monthDropRequest.durationMinutes,
      },
    }));
    setOpenedJob((job) => job?.jobNumber === monthDropRequest.jobNumber ? { ...job, technician: monthDropRequest.assignee, appointment } : job);
    setMonthDropRequest(null);
  }

  function handleCalendarResizeStart(
    event: PointerEvent<HTMLSpanElement>,
    job: { jobNumber: string; assignee: string; dayKey?: string; time?: string; durationMinutes: number },
  ) {
    event.preventDefault();
    event.stopPropagation();

    if (!job.dayKey || !job.time) return;

    setCalendarAssignments((assignments) => ({
      ...assignments,
      [job.jobNumber]: assignments[job.jobNumber] ?? {
        assignee: job.assignee,
        dayKey: job.dayKey ?? '',
        time: job.time ?? '',
        durationMinutes: job.durationMinutes,
      },
    }));
    setResizingJob({
      jobNumber: job.jobNumber,
      startY: event.clientY,
      startDuration: job.durationMinutes,
    });
  }

  function togglePaymentMethod(method: CompanyPaymentMethod) {
    const acceptedPayments = profile.acceptedPayments.includes(method)
      ? profile.acceptedPayments.filter((paymentMethod) => paymentMethod !== method)
      : [...profile.acceptedPayments, method];

    updateProfile({ acceptedPayments });
  }

  return (
    <div className="client-app">
      <header className="client-topbar">
        <div className="client-brand">
          <div className="client-logo">{selectedCompany.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{selectedCompany.name}</strong>
            <span>ServiceScope</span>
          </div>
        </div>

        <nav className="client-nav" aria-label="Company navigation">
          {clientNavItems.map((item) => (
            <button
              className={`client-nav-item ${clientPage === item.page ? 'active' : ''} ${item.adminOnly ? 'admin' : ''}`}
              type="button"
              key={item.page}
              onClick={() => {
                setOpenedJob(null);
                setClientPage(item.page);
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="client-user">
          <span>ADMIN</span>
          <strong>{selectedCompany.ownerName.slice(0, 1).toUpperCase()}</strong>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="client-workspace">
        {clientPage === 'onboarding' ? (
          <section className="client-onboarding">
            <div className="onboarding-header">
              <div>
                <p className="eyebrow">Company onboarding</p>
                <h1>Workspace setup</h1>
                <p>Set up the company, team access, job workflow, billing, and launch readiness before daily operations begin.</p>
              </div>
              <div className="onboarding-progress">
                <strong>{completedSteps}/4</strong>
                <span>Provisioning steps</span>
              </div>
            </div>

            <div className="onboarding-grid">
              <section className="panel company-profile-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Company data</p>
                    <h2>Profile and logo</h2>
                  </div>
                  <Building2 size={20} aria-hidden="true" />
                </div>
                <div className="company-profile-layout">
                  <div className="logo-uploader">
                    <div className="logo-preview">
                      {profile.logoUrl ? (
                        <img src={profile.logoUrl} alt={`${profile.displayName} logo`} />
                      ) : (
                        <span>{profile.displayName.slice(0, 2).toUpperCase()}</span>
                      )}
                    </div>
                    <label className="secondary-button compact">
                      Upload logo
                      <input type="file" accept="image/*" onChange={handleLogoUpload} />
                    </label>
                  </div>
                  <div className="profile-fields">
                    <label>
                      Legal company name
                      <input value={profile.legalName} onChange={(event) => updateProfile({ legalName: event.target.value })} />
                    </label>
                    <label>
                      Display name
                      <input value={profile.displayName} onChange={(event) => updateProfile({ displayName: event.target.value })} />
                    </label>
                    <label>
                      Website
                      <input value={profile.website} onChange={(event) => updateProfile({ website: event.target.value })} placeholder="https://company.com" />
                    </label>
                    <label>
                      Main phone
                      <input value={profile.phone} onChange={(event) => updateProfile({ phone: event.target.value })} placeholder="(555) 000-0000" />
                    </label>
                    <label>
                      Billing email
                      <input type="email" value={profile.billingEmail} onChange={(event) => updateProfile({ billingEmail: event.target.value })} />
                    </label>
                    <label>
                      Emergency contact
                      <input value={profile.emergencyContact} onChange={(event) => updateProfile({ emergencyContact: event.target.value })} />
                    </label>
                    <label className="profile-wide">
                      Service address
                      <input value={profile.serviceAddress} onChange={(event) => updateProfile({ serviceAddress: event.target.value })} placeholder="Main office or dispatch address" />
                    </label>
                    <label>
                      Service area
                      <input value={profile.serviceArea} onChange={(event) => updateProfile({ serviceArea: event.target.value })} />
                    </label>
                    <label>
                      Timezone
                      <select value={profile.timezone} onChange={(event) => updateProfile({ timezone: event.target.value })}>
                        <option value="America/New_York">Eastern</option>
                        <option value="America/Chicago">Central</option>
                        <option value="America/Denver">Mountain</option>
                        <option value="America/Los_Angeles">Pacific</option>
                      </select>
                    </label>
                  </div>
                </div>
              </section>

              <section className="panel workspace-mailbox-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Mailbox setup</p>
                    <h2>{emailConnection ? emailConnection.address : 'Configure company email'}</h2>
                  </div>
                  <MailPlus size={20} aria-hidden="true" />
                </div>
                <div className="mailbox-setup-content">
                  <div className="mailbox-step provider-step">
                    <div>
                      <strong>1. Provider</strong>
                      <p>Choose a provider. This only prepares the setup; real OAuth/SMTP backend is still required.</p>
                    </div>
                    <div className="email-provider-actions">
                      {(['google', 'microsoft', 'smtp'] as EmailProvider[]).map((provider) => (
                        <button className={emailConnection?.provider === provider ? 'provider-button active' : 'provider-button'} type="button" onClick={() => connectMailbox(provider)} key={provider}>
                          {emailConnection?.provider === provider ? `${emailProviderLabels[provider]} selected` : `Start ${emailProviderLabels[provider]} setup`}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mailbox-step">
                    <div>
                      <strong>2. Mailbox and permissions</strong>
                      <p>{emailConnection ? `${emailProviderLabels[emailConnection.provider]} setup draft created. Last sync: ${emailConnection.lastSync}.` : 'Select a provider to configure address, permissions, sync, and sending identity.'}</p>
                    </div>
                    <div className="mailbox-permissions">
                      <span>Read company mailbox</span>
                      <span>Send as company</span>
                      <span>Attach messages to jobs</span>
                      <span>Tenant isolated tokens</span>
                    </div>
                    <div className="mailbox-settings-grid">
                      <label>
                        Mailbox address
                        <input value={emailConnection?.address ?? ''} onChange={(event) => updateMailbox({ address: event.target.value, replyTo: event.target.value })} placeholder="dispatch@company.com" disabled={!emailConnection} />
                      </label>
                      <label>
                        Connection status
                        <select value={emailConnection?.status ?? 'backend_required'} onChange={(event) => updateMailbox({ status: event.target.value as EmailConnection['status'] })} disabled={!emailConnection}>
                          <option value="backend_required">OAuth/backend required</option>
                          <option value="connected">Connected by backend</option>
                        </select>
                      </label>
                    </div>
                    <div className="mailbox-backend-warning">
                      This screen does not connect Gmail or Microsoft by itself. Production requires OAuth app setup, redirect URL, encrypted token storage, token refresh, Gmail/Graph API calls, webhook/sync jobs, and reconnect handling.
                    </div>
                  </div>

                  <div className="mailbox-step">
                    <div>
                      <strong>3. Sync rules</strong>
                      <p>Choose how messages are imported and linked to operations.</p>
                    </div>
                    <div className="mailbox-settings-grid">
                      <label>
                        Sync inbox from
                        <select value={emailConnection?.syncRange ?? '30'} onChange={(event) => updateMailbox({ syncRange: event.target.value as EmailConnection['syncRange'] })} disabled={!emailConnection}>
                          <option value="7">Last 7 days</option>
                          <option value="30">Last 30 days</option>
                          <option value="90">Last 90 days</option>
                        </select>
                      </label>
                      <label className="mailbox-check">
                        <input type="checkbox" checked={emailConnection?.autoLinkJobNumber ?? false} onChange={(event) => updateMailbox({ autoLinkJobNumber: event.target.checked })} disabled={!emailConnection} />
                        Auto-link by job number
                      </label>
                      <label className="mailbox-check">
                        <input type="checkbox" checked={emailConnection?.autoLinkClientEmail ?? false} onChange={(event) => updateMailbox({ autoLinkClientEmail: event.target.checked })} disabled={!emailConnection} />
                        Auto-link by client email
                      </label>
                      <label className="mailbox-check">
                        <input type="checkbox" checked={emailConnection?.createTaskFromUnread ?? false} onChange={(event) => updateMailbox({ createTaskFromUnread: event.target.checked })} disabled={!emailConnection} />
                        Create task from unread client email
                      </label>
                    </div>
                  </div>

                  <div className="mailbox-step">
                    <div>
                      <strong>4. Sending identity</strong>
                      <p>This is what customers see when the company sends email.</p>
                    </div>
                    <div className="mailbox-settings-grid">
                      <label>
                        Sender name
                        <input value={emailConnection?.senderName ?? ''} onChange={(event) => updateMailbox({ senderName: event.target.value })} placeholder="Northline HVAC" disabled={!emailConnection} />
                      </label>
                      <label>
                        Reply-to email
                        <input type="email" value={emailConnection?.replyTo ?? ''} onChange={(event) => updateMailbox({ replyTo: event.target.value })} placeholder="dispatch@company.com" disabled={!emailConnection} />
                      </label>
                      <label className="profile-wide">
                        Signature
                        <textarea value={emailConnection?.signature ?? ''} onChange={(event) => updateMailbox({ signature: event.target.value })} placeholder="Company signature" disabled={!emailConnection} />
                      </label>
                    </div>
                  </div>

                  {emailConnection?.provider === 'smtp' ? (
                    <div className="mailbox-step">
                      <div>
                        <strong>5. SMTP / IMAP fallback</strong>
                        <p>Use app password credentials from the mailbox provider.</p>
                      </div>
                      <div className="mailbox-settings-grid">
                        <label>
                          IMAP host
                          <input value={emailConnection.imapHost} onChange={(event) => updateMailbox({ imapHost: event.target.value })} />
                        </label>
                        <label>
                          IMAP port
                          <input value={emailConnection.imapPort} onChange={(event) => updateMailbox({ imapPort: event.target.value })} />
                        </label>
                        <label>
                          SMTP host
                          <input value={emailConnection.smtpHost} onChange={(event) => updateMailbox({ smtpHost: event.target.value })} />
                        </label>
                        <label>
                          SMTP port
                          <input value={emailConnection.smtpPort} onChange={(event) => updateMailbox({ smtpPort: event.target.value })} />
                        </label>
                        <label>
                          Security
                          <select value={emailConnection.security} onChange={(event) => updateMailbox({ security: event.target.value as EmailConnection['security'] })}>
                            <option value="ssl">SSL</option>
                            <option value="tls">TLS</option>
                            <option value="starttls">STARTTLS</option>
                          </select>
                        </label>
                        <label>
                          Username
                          <input value={emailConnection.username} onChange={(event) => updateMailbox({ username: event.target.value })} />
                        </label>
                        <label className="profile-wide">
                          App password
                          <input type="password" placeholder="Stored encrypted on backend" />
                        </label>
                      </div>
                    </div>
                  ) : null}

                  <div className="mailbox-test-row">
                    <div>
                      <strong>Test connection</strong>
                      <p>Send a test email and verify inbox sync before launch.</p>
                    </div>
                    <button className="secondary-button compact" type="button" disabled={emailConnection?.status !== 'connected'}>
                      Test disabled until backend is connected
                    </button>
                  </div>
                </div>
              </section>

              <section className="panel onboarding-list-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Setup path</p>
                    <h2>Activation checklist</h2>
                  </div>
                  <Rocket size={20} aria-hidden="true" />
                </div>
                <div className="onboarding-list">
                  {onboardingItems.map((item) => (
                    <article className={`onboarding-item ${item.status}`} key={item.title}>
                      <span className={`step-dot ${item.status}`} />
                      <div>
                        <h3>{item.title}</h3>
                        <p>{item.detail}</p>
                      </div>
                      <strong>{formatStepStatus(item.status as OnboardingStepStatus)}</strong>
                    </article>
                  ))}
                </div>
              </section>

              <section className="panel payment-setup-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Payment setup</p>
                    <h2>Accepted payments</h2>
                  </div>
                  <CreditCard size={20} aria-hidden="true" />
                </div>
                <div className="payment-method-grid">
                  {(Object.keys(paymentMethodLabels) as CompanyPaymentMethod[]).map((method) => (
                    <label className={`payment-method ${profile.acceptedPayments.includes(method) ? 'selected' : ''}`} key={method}>
                      <input
                        type="checkbox"
                        checked={profile.acceptedPayments.includes(method)}
                        onChange={() => togglePaymentMethod(method)}
                      />
                      <span>{paymentMethodLabels[method]}</span>
                    </label>
                  ))}
                </div>
                <div className="payment-fields">
                  <label>
                    ACH routing number
                    <input value={profile.achRoutingNumber} onChange={(event) => updateProfile({ achRoutingNumber: event.target.value })} placeholder="Routing number" />
                  </label>
                  <label>
                    ACH account number
                    <input value={profile.achAccountNumber} onChange={(event) => updateProfile({ achAccountNumber: event.target.value })} placeholder="Full account number" />
                  </label>
                  <label>
                    ACH account name
                    <input value={profile.achAccountName} onChange={(event) => updateProfile({ achAccountName: event.target.value })} placeholder="Business account name" />
                  </label>
                  <label>
                    Zelle contact
                    <input value={profile.zelleContact} onChange={(event) => updateProfile({ zelleContact: event.target.value })} placeholder="Email or phone" />
                  </label>
                  <label>
                    Venmo contact
                    <input value={profile.venmoContact} onChange={(event) => updateProfile({ venmoContact: event.target.value })} placeholder="@business or phone" />
                  </label>
                  <label>
                    Cash App cashtag
                    <input value={profile.cashAppCashtag} onChange={(event) => updateProfile({ cashAppCashtag: event.target.value })} placeholder="$business" />
                  </label>
                  <label>
                    PayPal email
                    <input type="email" value={profile.paypalEmail} onChange={(event) => updateProfile({ paypalEmail: event.target.value })} placeholder="payments@company.com" />
                  </label>
                  <label className="profile-wide">
                    Payment notes
                    <textarea value={profile.paymentNotes} onChange={(event) => updateProfile({ paymentNotes: event.target.value })} placeholder="Deposit rules, preferred payment method, financing notes, or payment instructions." />
                  </label>
                </div>
              </section>

              <section className="panel job-workflow-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Job workflow</p>
                    <h2>Job types and defaults</h2>
                  </div>
                  <ClipboardList size={20} aria-hidden="true" />
                </div>
                <div className="workflow-fields">
                  <label>
                    Default SCF ($)
                    <input type="number" min={0} step={5} value={profile.serviceCallFee} onChange={(event) => updateProfile({ serviceCallFee: Number(event.target.value) })} />
                  </label>
                  <label className="checkbox-field prefix-toggle">
                    <input
                      type="checkbox"
                      checked={profile.useJobNumberPrefixes}
                      onChange={(event) => updateProfile({ useJobNumberPrefixes: event.target.checked })}
                    />
                    Use profession prefixes for job numbers
                  </label>
                </div>
                <div className="profession-picker">
                  <p className="eyebrow">Suggested professions</p>
                  <div className="profession-chip-grid">
                    {professionTemplates.map((template) => {
                      const selected = configuredProfessionNames.has(template.name.toLowerCase());

                      return (
                        <button
                          className={`profession-chip ${selected ? 'selected' : ''}`}
                          type="button"
                          disabled={selected}
                          onClick={() => addProfessionTemplate(template)}
                          key={template.id}
                        >
                          <strong>{template.name}</strong>
                          <span>{template.jobNumberPrefix}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <form className="job-type-form" onSubmit={handleJobTypeSubmit}>
                  <label>
                    Profession
                    <input value={jobTypeForm.name} onChange={(event) => setJobTypeForm({ ...jobTypeForm, name: event.target.value })} placeholder="Garage Door" />
                  </label>
                  <label>
                    Job prefix
                    <input
                      value={jobTypeForm.jobNumberPrefix}
                      onChange={(event) => setJobTypeForm({ ...jobTypeForm, jobNumberPrefix: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                      placeholder="GAR"
                    />
                  </label>
                  <button className="secondary-button" type="submit">
                    <Plus size={17} aria-hidden="true" />
                    Add profession
                  </button>
                </form>
                <div className="job-type-list">
                  {profile.jobTypes.map((jobType) => (
                    <article className="job-type-row" key={jobType.id}>
                      <div>
                        <h3>{jobType.name}</h3>
                        <p>{profile.useJobNumberPrefixes ? `Job numbers start with ${jobType.jobNumberPrefix}` : 'Uses regular automatic numbering'}</p>
                      </div>
                      <div className="job-type-actions">
                        <span>{profile.useJobNumberPrefixes ? jobType.jobNumberPrefix : 'Auto'}</span>
                        <button className="text-button danger" type="button" onClick={() => removeJobType(jobType.id)}>
                          Remove
                        </button>
                      </div>
                    </article>
                  ))}
                  {profile.jobTypes.length === 0 ? (
                    <div className="empty-inline">Select at least one profession or add a custom one.</div>
                  ) : null}
                </div>
              </section>

              <section className="panel team-setup-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Team setup</p>
                    <h2>Technicians and roles</h2>
                  </div>
                  <Users size={20} aria-hidden="true" />
                </div>
                <div className="team-setup-grid">
                  <MiniStat icon={<Users size={17} />} label="Technicians" value={profile.technicians.length.toString()} />
                  <MiniStat icon={<UserPlus size={17} />} label="Seats" value={selectedCompany.seats.toString()} />
                  <MiniStat icon={<ShieldCheck size={17} />} label="Owner" value="1" />
                  <MiniStat icon={<ClipboardList size={17} />} label="Assigned jobs" value={profile.technicians.reduce((total, technician) => total + technician.assignedJobs, 0).toString()} />
                </div>
                <div className="setup-fields">
                  <label>
                    Default technician role
                    <select value={technicianForm.role} onChange={(event) => setTechnicianForm({ ...technicianForm, role: event.target.value as CompanyTechnicianRole })}>
                      <option value="technician">Technician</option>
                      <option value="dispatcher">Dispatcher</option>
                      <option value="manager">Manager</option>
                    </select>
                  </label>
                  <label>
                    Job assignment mode
                    <select value={profile.jobAssignmentMode} onChange={(event) => updateProfile({ jobAssignmentMode: event.target.value as CompanyOnboardingProfile['jobAssignmentMode'] })}>
                      <option value="manual">Manual dispatch</option>
                      <option value="round_robin">Round robin</option>
                      <option value="skill_based">Skill based</option>
                    </select>
                  </label>
                </div>
                <form className="technician-form" onSubmit={handleTechnicianSubmit}>
                  <label>
                    Technician name
                    <input value={technicianForm.name} onChange={(event) => setTechnicianForm({ ...technicianForm, name: event.target.value })} placeholder="Alex Rivera" />
                  </label>
                  <label>
                    Email
                    <input type="email" value={technicianForm.email} onChange={(event) => setTechnicianForm({ ...technicianForm, email: event.target.value })} placeholder="tech@company.com" />
                  </label>
                  <label>
                    Phone
                    <input value={technicianForm.phone} onChange={(event) => setTechnicianForm({ ...technicianForm, phone: event.target.value })} placeholder="(555) 000-0000" />
                  </label>
                  <button className="secondary-button" type="submit">
                    <UserPlus size={17} aria-hidden="true" />
                    Add technician
                  </button>
                </form>
                <div className="technician-list">
                  {profile.technicians.map((technician) => (
                    <article className="technician-row" key={technician.id}>
                      <div>
                        <h3>{technician.name}</h3>
                        <p>{technician.email || 'No email'} - {technician.phone || 'No phone'}</p>
                      </div>
                      <span>{technician.role}</span>
                      <strong>{technician.assignedJobs} jobs</strong>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </section>
        ) : clientPage === 'jobs' ? (
          <section className={openedJob ? 'job-detail-shell' : 'client-form-panel'}>
            {openedJob ? (
              <JobDetailPanel
                job={openedJob}
                technicians={profile.technicians.map((technician) => technician.name)}
                systems={profile.jobTypes.map((jobType) => jobType.name)}
                paymentMethods={profile.acceptedPayments.map((method) => paymentMethodLabels[method])}
                onClose={() => setOpenedJob(null)}
              />
            ) : (
              <>
                <h1>Create Job</h1>
                <form className="job-form" onSubmit={handleCreateJob}>
                  <label>
                    Job number
                    <input name="jobNumber" defaultValue="Automatic" placeholder={selectedJobPrefix ? `${selectedJobPrefix}-${nextJobNumber}` : nextJobNumber} />
                  </label>
                  <label>
                    Company
                    <input name="organization" placeholder="Organization / Company" />
                  </label>
                  <label>
                    Issue description
                    <input name="issue" placeholder="Describe the issue" />
                  </label>
                  <label>
                    Client name
                    <input name="clientName" placeholder="Client name" />
                  </label>
                  <label>
                    System
                    <select name="system" value={selectedJobType?.id ?? ''} onChange={(event) => setSelectedJobTypeId(event.target.value)} disabled={profile.jobTypes.length === 0}>
                      {profile.jobTypes.length === 0 ? <option value="">Configure professions in onboarding</option> : null}
                      {profile.jobTypes.map((jobType) => (
                        <option value={jobType.id} key={jobType.id}>
                          {jobType.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Phone
                    <input name="phone" placeholder="Phone" />
                  </label>
                  <label>
                    SCF ($)
                    <input name="serviceCallFee" type="number" min={0} step={5} defaultValue={profile.serviceCallFee} />
                  </label>
                  <label>
                    Email
                    <input name="email" type="email" placeholder="Email" />
                  </label>
                  <label>
                    Select technician
                    <select name="technician" defaultValue="">
                      <option value="">--</option>
                      {profile.technicians.map((technician) => (
                        <option value={technician.name} key={technician.id}>
                          {technician.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Address
                    <input name="address" placeholder="Address" />
                  </label>
                  <label className="job-form-wide">
                    Notes
                    <textarea name="notes" placeholder="Notes" />
                  </label>
                  <div className="job-form-actions">
                    <button className="primary-button" type="submit">
                      <Plus size={18} aria-hidden="true" />
                      Create job
                    </button>
                  </div>
                </form>
                <section className="sample-job-strip" aria-label="Example created job">
                  <div className="sample-job-strip-heading">
                    <p className="eyebrow">Example created job</p>
                  </div>
                  <JobCard job={sampleJob} onOpen={() => setOpenedJob(sampleJob)} />
                </section>
              </>
            )}
          </section>
        ) : clientPage === 'allJobs' ? (
          <section className="all-jobs-page">
            {openedJob ? (
              <JobDetailPanel
                job={openedJob}
                technicians={profile.technicians.map((technician) => technician.name)}
                systems={profile.jobTypes.map((jobType) => jobType.name)}
                paymentMethods={profile.acceptedPayments.map((method) => paymentMethodLabels[method])}
                onClose={() => setOpenedJob(null)}
              />
            ) : (
              <>
                <div className="all-jobs-heading">
                  <ClipboardList size={30} aria-hidden="true" />
                  <h1>All Jobs</h1>
                </div>

                <div className="all-jobs-toolbar">
                  <select defaultValue="all">
                    <option value="all">All statuses</option>
                    {jobStatusFilters.map((status) => (
                      <option value={status} key={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <select defaultValue="all">
                    <option value="all">All technicians</option>
                    {profile.technicians.map((technician) => (
                      <option value={technician.id} key={technician.id}>
                        {technician.name}
                      </option>
                    ))}
                  </select>
                  <select defaultValue="active">
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                    <option value="all">All jobs</option>
                  </select>
                  <input placeholder="Company, name, phone or address" />
                  <input placeholder="Invoice # or Job #" />
                  <button className="secondary-button compact" type="button">
                    Reset
                  </button>
                  <button className="secondary-button compact" type="button">
                    Export to Excel
                  </button>
                  <select defaultValue="job-desc">
                    <option value="job-desc">Sort by Job #</option>
                    <option value="client">Sort by client</option>
                    <option value="status">Sort by status</option>
                  </select>
                </div>

                <div className="all-jobs-groups">
                  {allJobsGroups.map((group) => (
                    <section className="job-group" key={group.technician}>
                      <div className="job-group-title">
                        <h2>{group.technician}</h2>
                      </div>
                      <div className="job-status-tabs">
                        {jobStatusFilters.map((status) => (
                          <button className={`job-status-tab ${statusClassName(status)}`} type="button" key={status}>
                            {status}
                          </button>
                        ))}
                      </div>
                      <div className="job-status-count">
                        <strong>Diagnosis</strong>
                        <span>{group.jobs.length}</span>
                      </div>
                      <div className="all-jobs-table-wrap">
                        <table className="all-jobs-table">
                          <thead>
                            <tr>
                              <th>Job #</th>
                              <th>Client</th>
                              <th>Phone</th>
                              <th>Address</th>
                              <th>System</th>
                              <th>Issue</th>
                              <th>SCF</th>
                              <th>SCF payment</th>
                              <th>Labor</th>
                              <th>Labor payment</th>
                              <th>Status</th>
                              <th>Save</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.jobs.map((job) => (
                              <tr key={job.jobNumber}>
                                <td>
                                  <button className="job-number-link" type="button" onClick={() => setOpenedJob(job)}>
                                    {job.jobNumber}
                                  </button>
                                </td>
                                <td>
                                  <strong>{job.organization}</strong>
                                  <span>{job.clientName}</span>
                                </td>
                                <td>{job.phone}</td>
                                <td>{job.address}</td>
                                <td>{job.system}</td>
                                <td>{job.issue}</td>
                                <td>
                                  <input defaultValue={job.serviceCallFee} aria-label={`SCF for job ${job.jobNumber}`} />
                                </td>
                                <td>
                                  <select className={!job.scfPayment ? 'needs-payment' : ''} defaultValue={job.scfPayment} aria-label={`SCF payment for job ${job.jobNumber}`}>
                                    <option value="">--</option>
                                    {profile.acceptedPayments.map((method) => (
                                      <option value={method} key={method}>
                                        {paymentMethodLabels[method]}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td>
                                  <input defaultValue={job.labor} aria-label={`Labor for job ${job.jobNumber}`} />
                                </td>
                                <td>
                                  <select defaultValue={job.laborPayment} aria-label={`Labor payment for job ${job.jobNumber}`}>
                                    <option value="">--</option>
                                    {profile.acceptedPayments.map((method) => (
                                      <option value={method} key={method}>
                                        {paymentMethodLabels[method]}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td>
                                  <select defaultValue={job.status} aria-label={`Status for job ${job.jobNumber}`}>
                                    {jobStatusFilters.map((status) => (
                                      <option value={status} key={status}>
                                        {status}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td>
                                  <button className="save-row-button" type="button" aria-label={`Save job ${job.jobNumber}`}>
                                    Save
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ))}
                </div>
              </>
            )}
          </section>
        ) : clientPage === 'calendar' ? (
          <section className="calendar-page">
            {openedJob ? (
              <JobDetailPanel
                job={openedJob}
                technicians={profile.technicians.map((technician) => technician.name)}
                systems={profile.jobTypes.map((jobType) => jobType.name)}
                paymentMethods={profile.acceptedPayments.map((method) => paymentMethodLabels[method])}
                onClose={() => setOpenedJob(null)}
              />
            ) : (
              <>
                <div className="calendar-header">
                  <div>
                    <p className="eyebrow">Dispatch calendar</p>
                    <h1>Calendar</h1>
                  </div>
                  <div className="calendar-controls">
                    <select value={activeCalendarTech} onChange={(event) => setActiveCalendarTech(event.target.value)}>
                      <option value="all">All technicians</option>
                      {profile.technicians.map((technician) => (
                        <option value={technician.name} key={technician.id}>
                          {technician.name}
                        </option>
                      ))}
                    </select>
                    <input placeholder="Search job, client, address" />
                    <div className="calendar-view-toggle" aria-label="Calendar view">
                      {(['month', 'week', 'day'] as const).map((view) => (
                        <button className={calendarView === view ? 'active' : ''} type="button" onClick={() => setCalendarView(view)} key={view}>
                          {view}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <section className="calendar-unassigned">
                  <div>
                    <h2>Unassigned</h2>
                    <p>{activeCalendarTech === 'all' ? 'Select a technician before assigning unassigned jobs. Scheduled jobs can be moved between days and times.' : `Drag jobs onto ${activeCalendarTech}'s calendar.`}</p>
                  </div>
                  <div className="unassigned-job-list">
                    {unassignedCalendarJobs.map((job) => (
                      <button
                        className="unassigned-job-card"
                        type="button"
                        draggable
                        onDragStart={(event) => handleCalendarDragStart(event, job.jobNumber)}
                        onDoubleClick={() => setOpenedJob(job)}
                        key={job.jobNumber}
                      >
                        <strong>#{job.jobNumber} - {job.organization}</strong>
                        <span>{job.issue}</span>
                      </button>
                    ))}
                    {unassignedCalendarJobs.length === 0 ? <span className="empty-inline">No unassigned jobs.</span> : null}
                  </div>
                </section>

                <div className="calendar-tech-tabs">
                  <button className={activeCalendarTech === 'all' ? 'active' : ''} type="button" onClick={() => setActiveCalendarTech('all')}>
                    All techs
                  </button>
                  {profile.technicians.map((technician) => (
                    <button className={activeCalendarTech === technician.name ? 'active' : ''} type="button" onClick={() => setActiveCalendarTech(technician.name)} key={technician.id}>
                      {technician.name}
                    </button>
                  ))}
                </div>

                {calendarView === 'month' ? (
                  <div className="calendar-month-grid">
                    {calendarMonthDays.map((calendarDay) => {
                      const jobs = visibleCalendarJobs.filter((job) => job.dayKey === calendarDay.key);

                      return (
                        <div
                          className="calendar-month-day drop-enabled"
                          onDragOver={(event) => {
                            event.preventDefault();
                          }}
                          onDrop={(event) => {
                            handleCalendarMonthDrop(event, calendarDay.key);
                          }}
                          key={calendarDay.key}
                        >
                          <strong>{calendarDay.day}</strong>
                          {jobs.slice(0, 2).map((job) => (
                            <button
                              className={`calendar-month-job ${statusClassName(job.status)} ${!job.scfPayment ? 'unpaid' : ''}`}
                              type="button"
                              draggable
                              onDragStart={(event) => handleCalendarDragStart(event, job.jobNumber)}
                              onDoubleClick={() => setOpenedJob(job)}
                              key={job.jobNumber}
                            >
                              #{job.jobNumber} {job.organization}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="calendar-board" style={{ gridTemplateColumns: `76px repeat(${visibleCalendarDays.length}, minmax(180px, 1fr))` }}>
                    <div className="calendar-corner">Time</div>
                    {visibleCalendarDays.map((day) => {
                      const dayJobs = visibleCalendarJobs.filter((job) => job.dayKey === day.key);
                      const routeUrl = googleRouteUrl(dayJobs.map((job) => job.address));

                      return (
                        <div className="calendar-day-head" key={day.key}>
                          <strong>{day.label}</strong>
                          <span>{day.date}</span>
                          {routeUrl ? (
                            <a className="calendar-route-link" href={routeUrl} target="_blank" rel="noreferrer">
                              Route
                            </a>
                          ) : null}
                        </div>
                      );
                    })}
                    <div className="calendar-time-column">
                      {calendarSlots.map((slot) => (
                        <div className="calendar-time-cell" key={slot}>{slot}</div>
                      ))}
                    </div>
                    {visibleCalendarDays.map((day) => {
                      const jobs = visibleCalendarJobs.filter((job) => job.dayKey === day.key);

                      return (
                        <div className="calendar-day-column" key={day.key}>
                          <div className="calendar-day-grid-lines">
                            {calendarSlots.map((slot) => (
                              <div className="calendar-slot-line" key={slot} />
                            ))}
                          </div>
                          <div className="calendar-drop-grid">
                            {calendarDropSlots.map((slot) => (
                              <div
                                className="calendar-drop-slot"
                                onDragOver={(event) => {
                                  event.preventDefault();
                                }}
                                onDrop={(event) => handleCalendarDrop(event, day.key, slot.key)}
                                title={slot.label}
                                key={slot.key}
                              />
                            ))}
                          </div>
                          {jobs.map((job) => {
                            const startIndex = Math.max(0, calendarDropSlots.findIndex((slot) => slot.key === job.time));
                            const startTop = startIndex * 32 + 6;

                            return (
                              <button
                                className={`calendar-job-card ${statusClassName(job.status)} ${!job.scfPayment ? 'unpaid' : ''}`}
                                type="button"
                                draggable
                                style={{
                                  top: `${startTop}px`,
                                  height: `${Math.max(54, (job.durationMinutes / 60) * 64 - 10)}px`,
                                }}
                                onDragStart={(event) => handleCalendarDragStart(event, job.jobNumber)}
                                onDoubleClick={() => setOpenedJob(job)}
                                key={job.jobNumber}
                              >
                                <span>{calendarDropSlots.find((slot) => slot.key === job.time)?.label ?? job.time}</span>
                                <strong>#{job.jobNumber} {job.organization}</strong>
                                <small>{job.address}</small>
                                <em>{job.technician}</em>
                                <span
                                  className="calendar-resize-handle"
                                  onPointerDown={(event) => handleCalendarResizeStart(event, job)}
                                  aria-label={`Resize job ${job.jobNumber}`}
                                />
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="calendar-legend">
                  {jobStatusFilters.filter((status) => status !== 'Warranty').map((status) => (
                    <span className={`calendar-legend-item ${statusClassName(status)}`} key={status}>
                      {status}
                    </span>
                  ))}
                  <p>Unpaid jobs use a dashed border.</p>
                </div>
                {monthDropRequest ? (
                  <div className="calendar-modal-backdrop" role="dialog" aria-modal="true" aria-label="Schedule job time">
                    <div className="calendar-time-modal">
                      <h2>Set appointment time</h2>
                      <p>
                        Job #{monthDropRequest.jobNumber} for {allCalendarDays.find((day) => day.key === monthDropRequest.dayKey)?.date}
                      </p>
                      <label>
                        Time
                        <select value={monthDropRequest.time} onChange={(event) => setMonthDropRequest({ ...monthDropRequest, time: event.target.value })}>
                          {calendarDropSlots.map((slot) => (
                            <option value={slot.key} key={slot.key}>
                              {slot.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="calendar-time-modal-actions">
                        <button className="secondary-button compact" type="button" onClick={() => setMonthDropRequest(null)}>
                          Cancel
                        </button>
                        <button className="primary-button" type="button" onClick={confirmCalendarMonthDrop}>
                          Set appointment
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </section>
        ) : clientPage === 'materials' ? (
          <section className="materials-page">
            <div className="materials-header">
              <div>
                <p className="eyebrow">Parts and purchases</p>
                <h1>Materials</h1>
              </div>
              <div className="materials-summary">
                <span>
                  <strong>{materials.length}</strong>
                  Material rows
                </span>
                <span>
                  <strong>{jobsWithoutMaterials.length}</strong>
                  Jobs without materials
                </span>
                <span>
                  <strong>{money(materialsTotal)}</strong>
                  Filtered cost
                </span>
              </div>
            </div>

            <div className="materials-toolbar">
              <label>
                Status
                <select value={materialStatusFilter} onChange={(event) => setMaterialStatusFilter(event.target.value as 'all' | MaterialRow['status'])}>
                  <option value="all">All statuses</option>
                  {materialStatuses.map((status) => (
                    <option value={status} key={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Technician
                <select value={materialTechFilter} onChange={(event) => setMaterialTechFilter(event.target.value)}>
                  <option value="all">All technicians</option>
                  <option value="No technician">No technician</option>
                  {profile.technicians.map((technician) => (
                    <option value={technician.name} key={technician.id}>
                      {technician.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Search
                <input value={materialSearch} onChange={(event) => setMaterialSearch(event.target.value)} placeholder="Job #, client, supplier, material" />
              </label>
              <button
                className="secondary-button compact"
                type="button"
                onClick={() => {
                  setMaterialStatusFilter('all');
                  setMaterialTechFilter('all');
                  setMaterialSearch('');
                }}
              >
                Reset
              </button>
            </div>

            {jobsWithoutMaterials.length ? (
              <section className="materials-missing">
                <div>
                  <PackageCheck size={20} aria-hidden="true" />
                  <strong>Jobs without materials</strong>
                </div>
                <div className="materials-missing-list">
                  {jobsWithoutMaterials.map((job) => (
                    <button className="materials-missing-job" type="button" onClick={() => openMaterialEditor(job.jobNumber)} key={job.jobNumber}>
                      #{job.jobNumber} - {job.organization} - {job.issue}
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="materials-table-wrap">
              <table className="materials-page-table">
                <thead>
                  <tr>
                    <th>Job / Client / Issue</th>
                    <th>Technician</th>
                    <th>Material</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>Total</th>
                    <th>Supplier</th>
                    <th>Status</th>
                    <th>Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMaterialRows.map(({ material, job }) => (
                    <tr key={material.id}>
                      <td>
                        <button className="job-number-link" type="button" onClick={() => openMaterialEditor(job.jobNumber)}>
                          #{job.jobNumber}
                        </button>
                        <strong>{job.organization}</strong>
                        <span>{job.clientName} - {job.system} - {job.issue}</span>
                      </td>
                      <td>{job.assignee}</td>
                      <td>{material.name || '-'}</td>
                      <td>{material.quantity}</td>
                      <td>{money(material.price)}</td>
                      <td>{money(material.quantity * material.price)}</td>
                      <td>{material.supplier || '-'}</td>
                      <td>
                        <span className={`material-status ${statusClassName(material.status)}`}>{material.status}</span>
                      </td>
                      <td>
                        <button className="secondary-button compact" type="button" onClick={() => openMaterialEditor(job.jobNumber)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!filteredMaterialRows.length ? (
                    <tr>
                      <td colSpan={9}>
                        <div className="empty-inline">No material rows match the filters.</div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            {selectedMaterialsJob ? (
              <div className="material-modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit materials">
                <div className="material-modal">
                  <div className="material-modal-header">
                    <div>
                      <p className="eyebrow">Edit materials</p>
                      <h2>#{selectedMaterialsJob.jobNumber} - {selectedMaterialsJob.organization}</h2>
                      <span>{selectedMaterialsJob.clientName} - {selectedMaterialsJob.issue}</span>
                    </div>
                    <button className="secondary-button compact" type="button" onClick={() => setEditingMaterialsJobNumber('')}>
                      Close
                    </button>
                  </div>

                  <div className="material-editor-table">
                    <div className="material-editor-head">
                      <span>Name</span>
                      <span>Qty</span>
                      <span>Price</span>
                      <span>Supplier</span>
                      <span>Status</span>
                      <span />
                    </div>
                    {materialDraftRows.map((row) => (
                      <div className="material-editor-row" key={row.id}>
                        <input value={row.name} onChange={(event) => updateMaterialDraft(row.id, { name: event.target.value })} placeholder="Material name" />
                        <input type="number" min="1" value={row.quantity} onChange={(event) => updateMaterialDraft(row.id, { quantity: Number(event.target.value) })} aria-label="Quantity" />
                        <input type="number" min="0" value={row.price} onChange={(event) => updateMaterialDraft(row.id, { price: Number(event.target.value) })} aria-label="Price" />
                        <input value={row.supplier} onChange={(event) => updateMaterialDraft(row.id, { supplier: event.target.value })} placeholder="Supplier" />
                        <select value={row.status} onChange={(event) => updateMaterialDraft(row.id, { status: event.target.value as MaterialRow['status'] })}>
                          {materialStatuses.map((status) => (
                            <option value={status} key={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                        <button className="secondary-button compact danger-lite" type="button" onClick={() => removeMaterialDraftRow(row.id)}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="material-modal-actions">
                    <button className="secondary-button compact" type="button" onClick={addMaterialDraftRow}>
                      <Plus size={16} aria-hidden="true" />
                      Add row
                    </button>
                    <button className="primary-button" type="button" onClick={saveMaterialDraftRows}>
                      Save materials
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        ) : clientPage === 'tasks' ? (
          <section className="tasks-page">
            {openedJob ? (
              <JobDetailPanel
                job={openedJob}
                technicians={profile.technicians.map((technician) => technician.name)}
                systems={profile.jobTypes.map((jobType) => jobType.name)}
                paymentMethods={profile.acceptedPayments.map((method) => paymentMethodLabels[method])}
                onClose={() => setOpenedJob(null)}
              />
            ) : (
              <>
            <div className="tasks-header">
              <div>
                <p className="eyebrow">Follow-up control</p>
                <h1>Tasks</h1>
              </div>
              <div className="tasks-summary">
                <span>
                  <strong>{openTaskCount}</strong>
                  Open tasks
                </span>
                <span>
                  <strong>{autoTaskCount}</strong>
                  Auto-generated
                </span>
                <span>
                  <strong>{urgentTaskCount}</strong>
                  Urgent
                </span>
              </div>
            </div>

            <form className="task-create-bar" onSubmit={createManualTask}>
              <label>
                Task
                <input value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} placeholder="Call customer, order part, send estimate" />
              </label>
              <label>
                Related job
                <select value={taskForm.jobNumber} onChange={(event) => setTaskForm({ ...taskForm, jobNumber: event.target.value })}>
                  <option value="">No job</option>
                  {allJobsRows.map((job) => (
                    <option value={job.jobNumber} key={job.jobNumber}>
                      #{job.jobNumber} - {job.organization}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Assigned to
                <select value={taskForm.assignedTo} onChange={(event) => setTaskForm({ ...taskForm, assignedTo: event.target.value })}>
                  <option value="">Office</option>
                  {taskAssignees.map((assignee) => (
                    <option value={assignee} key={assignee}>
                      {assignee}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Due
                <input type="date" value={taskForm.dueDate} onChange={(event) => setTaskForm({ ...taskForm, dueDate: event.target.value })} />
              </label>
              <label>
                Priority
                <select value={taskForm.priority} onChange={(event) => setTaskForm({ ...taskForm, priority: event.target.value as TaskPriority })}>
                  <option value="Low">Low</option>
                  <option value="Normal">Normal</option>
                  <option value="Urgent">Urgent</option>
                </select>
              </label>
              <button className="primary-button" type="submit">
                <Plus size={16} aria-hidden="true" />
                Add task
              </button>
            </form>

            <div className="tasks-toolbar">
              <select value={taskStatusFilter} onChange={(event) => setTaskStatusFilter(event.target.value as 'all' | TaskStatus)}>
                <option value="all">All statuses</option>
                <option value="To do">To do</option>
                <option value="In progress">In progress</option>
                <option value="Done">Done</option>
              </select>
              <select value={taskOwnerFilter} onChange={(event) => setTaskOwnerFilter(event.target.value)}>
                <option value="all">All assignees</option>
                {taskAssignees.map((assignee) => (
                  <option value={assignee} key={assignee}>
                    {assignee}
                  </option>
                ))}
              </select>
              <input value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="Search task, job, client, issue" />
              <button
                className="secondary-button compact"
                type="button"
                onClick={() => {
                  setTaskStatusFilter('all');
                  setTaskOwnerFilter('all');
                  setTaskSearch('');
                }}
              >
                Reset
              </button>
            </div>

            <div className="tasks-table-wrap">
              <table className="tasks-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Job</th>
                    <th>Assigned to</th>
                    <th>Due</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Source</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTaskRows.map((task) => {
                    const job = materialJobMap.get(task.jobNumber);

                    return (
                      <tr className={task.status === 'Done' ? 'task-done' : ''} key={task.id}>
                        <td>
                          <strong>{task.title}</strong>
                          <span>{task.notes || job?.issue || 'No notes'}</span>
                        </td>
                        <td>
                          {job ? (
                            <button className="job-number-link" type="button" onClick={() => setOpenedJob(job)}>
                              #{job.jobNumber}
                            </button>
                          ) : (
                            '-'
                          )}
                          {job ? <span>{job.organization}</span> : null}
                        </td>
                        <td>{task.assignedTo}</td>
                        <td>{task.dueDate || '-'}</td>
                        <td>
                          <span className={`task-priority ${statusClassName(task.priority)}`}>{task.priority}</span>
                        </td>
                        <td>
                          <select value={task.status} onChange={(event) => updateTaskStatus(task, event.target.value as TaskStatus)}>
                            <option value="To do">To do</option>
                            <option value="In progress">In progress</option>
                            <option value="Done">Done</option>
                          </select>
                        </td>
                        <td>
                          <span className={`task-source ${task.source.toLowerCase()}`}>{task.source}</span>
                        </td>
                        <td>
                          <div className="task-actions">
                            <button className="secondary-button compact" type="button" onClick={() => updateTaskStatus(task, 'Done')}>
                              Done
                            </button>
                            {job ? (
                              <button className="secondary-button compact" type="button" onClick={() => setOpenedJob(job)}>
                                Open job
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!filteredTaskRows.length ? (
                    <tr>
                      <td colSpan={8}>
                        <div className="empty-inline">No tasks match the filters.</div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
              </>
            )}
          </section>
        ) : clientPage === 'email' ? (
          <section className="email-page">
            <div className="email-header">
              <div>
                <p className="eyebrow">Company mailbox</p>
                <h1>Email</h1>
              </div>
              <div className="email-summary">
                <span>
                  <strong>{emailConnection?.status === 'connected' ? 'On' : emailConnection ? 'Setup' : 'Off'}</strong>
                  Connection
                </span>
                <span>
                  <strong>{emailMessages.filter((message) => message.unread).length}</strong>
                  Unread
                </span>
                <span>
                  <strong>{initialEmailTemplates.length}</strong>
                  Templates
                </span>
              </div>
            </div>

            <section className="email-connect-panel email-status-panel">
              <div>
                <p className="eyebrow">Mailbox status</p>
                <h2>{emailConnection ? emailConnection.address : 'No mailbox connected'}</h2>
                <p>
                  {emailConnection
                    ? emailConnection.status === 'connected'
                      ? `${emailProviderLabels[emailConnection.provider]} connected. Last sync: ${emailConnection.lastSync}.`
                      : `${emailProviderLabels[emailConnection.provider]} setup exists, but OAuth/backend is still required before sync/send.`
                    : 'Connect the company mailbox in Company onboarding before sending emails.'}
                </p>
              </div>
              <button className="secondary-button compact" type="button" onClick={() => setClientPage('onboarding')}>
                Open onboarding
              </button>
            </section>

            <div className="email-layout">
              <aside className="email-sidebar">
                <div className="email-folder-list">
                  {(['inbox', 'sent', 'templates'] as EmailFolder[]).map((folder) => (
                    <button className={emailFolder === folder ? 'active' : ''} type="button" onClick={() => setEmailFolder(folder)} key={folder}>
                      {folder}
                    </button>
                  ))}
                </div>
                <div className="email-connection-card">
                  <strong>Mailbox permissions</strong>
                  <span>Read messages</span>
                  <span>Send messages</span>
                  <span>Attach job context</span>
                  <span>Sync by tenant only</span>
                </div>
              </aside>

              <section className="email-workspace">
                <div className="email-toolbar">
                  <input value={emailSearch} onChange={(event) => setEmailSearch(event.target.value)} placeholder="Search sender, subject, job, client" />
                  <button className="secondary-button compact" type="button" onClick={() => setEmailSearch('')}>
                    Reset
                  </button>
                </div>

                {emailFolder === 'templates' ? (
                  <div className="email-template-grid">
                    {initialEmailTemplates.map((template) => (
                      <article className="email-template-card" key={template.id}>
                        <h3>{template.name}</h3>
                        <strong>{template.subject}</strong>
                        <p>{template.body}</p>
                        <button className="secondary-button compact" type="button" onClick={() => applyEmailTemplate(template)}>
                          Use template
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="email-message-list">
                    {visibleEmailMessages.map((message) => {
                      const job = materialJobMap.get(message.jobNumber);

                      return (
                        <article className={message.unread ? 'email-message-row unread' : 'email-message-row'} key={message.id}>
                          <div>
                            <div className="email-message-meta">
                              <strong>{emailFolder === 'inbox' ? message.from : message.to}</strong>
                              <span>{message.receivedAt}</span>
                            </div>
                            <h3>{message.subject}</h3>
                            <p>{message.preview}</p>
                            {job ? <span className="email-job-chip">#{job.jobNumber} - {job.organization}</span> : null}
                          </div>
                          <button
                            className="secondary-button compact"
                            type="button"
                            onClick={() => {
                              setEmailCompose({
                                to: emailFolder === 'inbox' ? message.from : message.to,
                                subject: message.subject.startsWith('Re:') ? message.subject : `Re: ${message.subject}`,
                                body: '',
                                jobNumber: message.jobNumber,
                              });
                            }}
                          >
                            Reply
                          </button>
                        </article>
                      );
                    })}
                    {!visibleEmailMessages.length ? (
                      <div className="empty-state compact-empty">
                        <MailPlus size={24} aria-hidden="true" />
                        <h3>No messages</h3>
                        <p>Connect a mailbox or change the search filter.</p>
                      </div>
                    ) : null}
                  </div>
                )}
              </section>

              <form className="email-compose-panel" onSubmit={sendEmailDraft}>
                <div>
                  <p className="eyebrow">Compose</p>
                  <h2>New email</h2>
                </div>
                <label>
                  To
                  <input type="email" value={emailCompose.to} onChange={(event) => setEmailCompose({ ...emailCompose, to: event.target.value })} placeholder="client@example.com" />
                </label>
                <label>
                  Related job
                  <select value={emailCompose.jobNumber} onChange={(event) => setEmailCompose({ ...emailCompose, jobNumber: event.target.value })}>
                    <option value="">No job</option>
                    {allJobsRows.map((job) => (
                      <option value={job.jobNumber} key={job.jobNumber}>
                        #{job.jobNumber} - {job.organization}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Subject
                  <input value={emailCompose.subject} onChange={(event) => setEmailCompose({ ...emailCompose, subject: event.target.value })} placeholder="Subject" />
                </label>
                <label>
                  Message
                  <textarea value={emailCompose.body} onChange={(event) => setEmailCompose({ ...emailCompose, body: event.target.value })} placeholder="Write a message to the client." />
                </label>
                <button className="primary-button" type="submit" disabled={emailConnection?.status !== 'connected'}>
                  <MailPlus size={16} aria-hidden="true" />
                  Send email
                </button>
                {emailConnection?.status !== 'connected' ? <p className="email-compose-note">Email sending requires the backend OAuth/SMTP integration to be connected first.</p> : null}
              </form>
            </div>
          </section>
        ) : clientPage === 'map' ? (
          <section className="map-page">
            <div className="map-header">
              <div>
                <p className="eyebrow">Technician GPS</p>
                <h1>Map</h1>
              </div>
              <div className="map-summary">
                <span>
                  <strong>{filteredTechnicianLocations.length}</strong>
                  Visible techs
                </span>
                <span>
                  <strong>{filteredTechnicianLocations.filter((technician) => technician.online).length}</strong>
                  Online
                </span>
                <span>
                  <strong>{filteredTechnicianLocations.filter((technician) => !technician.online).length}</strong>
                  Offline
                </span>
              </div>
            </div>

            <div className="map-toolbar technician-map-toolbar">
              <select value={mapTechFilter} onChange={(event) => setMapTechFilter(event.target.value)}>
                <option value="all">All technicians</option>
                {profile.technicians.map((technician) => (
                  <option value={technician.name} key={technician.id}>
                    {technician.name}
                  </option>
                ))}
              </select>
              <select value={mapStatusFilter} onChange={(event) => setMapStatusFilter(event.target.value)}>
                <option value="all">All GPS statuses</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
              </select>
              <input value={mapSearch} onChange={(event) => setMapSearch(event.target.value)} placeholder="Search technician, area, email, phone" />
              <button
                className="secondary-button compact"
                type="button"
                onClick={() => {
                  setMapTechFilter('all');
                  setMapStatusFilter('all');
                  setMapSearch('');
                }}
              >
                Reset
              </button>
            </div>

            <div className="map-layout technician-map-layout">
              <div className="technician-map-canvas" aria-label="Technician location map">
                <div className="osm-tile tile-a" />
                <div className="osm-tile tile-b" />
                <div className="osm-tile tile-c" />
                <div className="osm-tile tile-d" />
                <div className="map-water east-river">Hudson River</div>
                <div className="map-water hudson-river">East River</div>
                <div className="map-borough manhattan">Manhattan</div>
                <div className="map-borough brooklyn">Brooklyn</div>
                <div className="map-borough new-jersey">New Jersey</div>
                <div className="map-road horizontal road-one" />
                <div className="map-road horizontal road-two" />
                <div className="map-road vertical road-three" />
                <div className="map-road vertical road-four" />
                <div className="map-zoom-control">
                  <button type="button">+</button>
                  <button type="button">-</button>
                </div>

                {filteredTechnicianLocations.map((technician) => (
                  <button
                    className={`technician-location-pin ${technician.online ? 'online' : 'offline'}`}
                    style={{ left: `${technician.x}%`, top: `${technician.y}%` }}
                    type="button"
                    title={`${technician.name} - ${technician.lastSeen}`}
                    key={technician.id}
                  >
                    <span>{technician.name.slice(0, 1).toUpperCase()}</span>
                  </button>
                ))}
              </div>

              <aside className="technician-map-list">
                <div className="map-job-list-header">
                  <strong>Technicians</strong>
                  <span>{filteredTechnicianLocations.length} rows</span>
                </div>
                {filteredTechnicianLocations.map((technician) => (
                  <article className="technician-map-row" key={technician.id}>
                    <div className="technician-map-row-top">
                      <h3>{technician.name}</h3>
                      <span className="tech-role-pill">technician</span>
                    </div>
                    <dl>
                      <div>
                        <dt>GPS</dt>
                        <dd className={technician.online ? 'gps-online' : 'gps-offline'}>{technician.online ? 'online' : 'offline'}</dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{technician.lastSeen}</dd>
                      </div>
                      <div>
                        <dt>Area</dt>
                        <dd>{technician.area}</dd>
                      </div>
                      <div>
                        <dt>Coords</dt>
                        <dd>{technician.lat}, {technician.lng}</dd>
                      </div>
                      <div>
                        <dt>Phone</dt>
                        <dd>{technician.phone || '-'}</dd>
                      </div>
                      <div>
                        <dt>Email</dt>
                        <dd>{technician.email || '-'}</dd>
                      </div>
                    </dl>
                    <button className="secondary-button compact" type="button">
                      Show on map
                    </button>
                  </article>
                ))}
                {!filteredTechnicianLocations.length ? (
                  <div className="empty-state compact-empty">
                    <Map size={24} aria-hidden="true" />
                    <h3>No technicians found</h3>
                    <p>Change filters or search another technician.</p>
                  </div>
                ) : null}
              </aside>
            </div>
          </section>
        ) : clientPage === 'finances' ? (
          <section className={openedJob ? 'job-detail-shell' : 'finance-page'}>
            {openedJob ? (
              <JobDetailPanel
                job={openedJob}
                technicians={profile.technicians.map((technician) => technician.name)}
                systems={profile.jobTypes.map((jobType) => jobType.name)}
                paymentMethods={profile.acceptedPayments.map((method) => paymentMethodLabels[method])}
                onClose={() => setOpenedJob(null)}
              />
            ) : (
              <>
                <div className="finance-header">
                  <div>
                    <p className="eyebrow">Payroll and money report</p>
                    <h1>Finance</h1>
                  </div>
                  <div className="finance-summary">
                    <span>
                      <strong>{money(financeSummary.paidRevenue)}</strong>
                      Paid revenue
                    </span>
                    <span>
                      <strong>{money(financeSummary.materials)}</strong>
                      Materials
                    </span>
                    <span>
                      <strong>{money(financeSummary.salary)}</strong>
                      Technician payroll
                    </span>
                    <span>
                      <strong>{money(financeSummary.unpaidSalary)}</strong>
                      Unpaid payroll
                    </span>
                  </div>
                </div>

                <div className="finance-toolbar">
                  <label>
                    Period
                    <select value={financePeriod} onChange={(event) => setFinancePeriod(event.target.value as FinancePeriod)}>
                      <option value="this_week">This week</option>
                      <option value="this_month">This month</option>
                      <option value="all">All time</option>
                    </select>
                  </label>
                  <label>
                    Technician
                    <select value={financeTechFilter} onChange={(event) => setFinanceTechFilter(event.target.value)}>
                      <option value="all">All technicians</option>
                      {profile.technicians.map((technician) => (
                        <option value={technician.name} key={technician.id}>
                          {technician.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="secondary-button compact" type="button">
                    Export payroll
                  </button>
                </div>

                <section className="payroll-rules-panel">
                  <div>
                    <p className="eyebrow">Company payroll formula</p>
                    <h2>Payroll rules</h2>
                    <p>
                      Payroll = {payrollRules.commissionPercent}% of ({payrollRules.includeScf ? 'paid SCF + ' : ''}paid labor
                      {payrollRules.deductMaterials ? ' - materials' : ''}). SCF-only jobs pay {money(payrollRules.scfOnlyPayout)}.
                    </p>
                  </div>
                  <div className="payroll-rule-controls">
                    <label>
                      Commission %
                      <input
                        min="0"
                        max="100"
                        type="number"
                        value={payrollRules.commissionPercent}
                        onChange={(event) => setPayrollRules((rules) => ({ ...rules, commissionPercent: Math.max(0, Number(event.target.value) || 0) }))}
                      />
                    </label>
                    <label>
                      SCF-only payout
                      <input
                        min="0"
                        type="number"
                        value={payrollRules.scfOnlyPayout}
                        onChange={(event) => setPayrollRules((rules) => ({ ...rules, scfOnlyPayout: Math.max(0, Number(event.target.value) || 0) }))}
                      />
                    </label>
                    <label className="payroll-checkbox">
                      <input
                        type="checkbox"
                        checked={payrollRules.includeScf}
                        onChange={(event) => setPayrollRules((rules) => ({ ...rules, includeScf: event.target.checked }))}
                      />
                      Include SCF in commission base
                    </label>
                    <label className="payroll-checkbox">
                      <input
                        type="checkbox"
                        checked={payrollRules.deductMaterials}
                        onChange={(event) => setPayrollRules((rules) => ({ ...rules, deductMaterials: event.target.checked }))}
                      />
                      Deduct materials before payroll
                    </label>
                  </div>
                </section>

                <div className="finance-tabs">
                  {[
                    { id: 'ready', label: 'Ready to pay', count: financeTabCounts.ready },
                    { id: 'paid', label: 'Paid', count: financeTabCounts.paid },
                    { id: 'attention', label: 'Needs attention', count: financeTabCounts.attention },
                  ].map((tab) => (
                    <button
                      className={financeTab === tab.id ? 'active' : ''}
                      key={tab.id}
                      type="button"
                      onClick={() => setFinanceTab(tab.id as FinanceTab)}
                    >
                      {tab.label}
                      <span>{tab.count}</span>
                    </button>
                  ))}
                </div>

                <section className="technician-payroll-grid">
                  {technicianPayroll.map((row) => (
                    <button
                      className={financeTechFilter === row.technician.name ? 'technician-payroll-card selected' : 'technician-payroll-card'}
                      key={row.technician.id}
                      type="button"
                      onClick={() => setFinanceTechFilter(financeTechFilter === row.technician.name ? 'all' : row.technician.name)}
                    >
                      <div>
                        <h3>{row.technician.name}</h3>
                        <p>{row.jobs} jobs counted · {row.attention} need review</p>
                      </div>
                      <dl>
                        <div>
                          <dt>Paid revenue</dt>
                          <dd>{money(row.revenue)}</dd>
                        </div>
                        <div>
                          <dt>Materials</dt>
                          <dd>{money(row.materials)}</dd>
                        </div>
                        <div>
                          <dt>Payroll</dt>
                          <dd>{money(row.salary)}</dd>
                        </div>
                        <div>
                          <dt>Unpaid</dt>
                          <dd>{money(row.unpaid)}</dd>
                        </div>
                      </dl>
                    </button>
                  ))}
                </section>

                {financeBaseRows.some((job) => job.needsAttention) ? (
                  <section className="finance-attention-panel">
                    <div>
                      <p className="eyebrow">Review before paying</p>
                      <h2>Needs attention</h2>
                    </div>
                    {financeBaseRows
                      .filter((job) => job.needsAttention)
                      .slice(0, 4)
                      .map((job) => (
                        <button type="button" key={job.jobNumber} onClick={() => setOpenedJob(job)}>
                          <strong>#{job.jobNumber} · {job.organization}</strong>
                          <span>{job.warnings.join(' · ')}</span>
                        </button>
                      ))}
                  </section>
                ) : null}

                <div className="finance-table-wrap">
                  <table className="finance-table">
                    <thead>
                      <tr>
                        <th>Job</th>
                        <th>Technician</th>
                        <th>Status</th>
                        <th>SCF</th>
                        <th>SCF payment</th>
                        <th>Labor</th>
                        <th>Labor payment</th>
                        <th>Materials</th>
                        <th>Payroll base</th>
                        <th>Salary</th>
                        <th>Review</th>
                        <th>Paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredFinanceRows.map((job) => (
                        <tr className={job.paid ? 'salary-paid-row' : job.needsAttention ? 'salary-attention-row' : ''} key={job.jobNumber}>
                          <td>
                            <button className="job-number-link" type="button" onClick={() => setOpenedJob(job)}>
                              #{job.jobNumber}
                            </button>
                            <span>{job.organization}</span>
                          </td>
                          <td>{job.assignee}</td>
                          <td>
                            <span className={`material-status ${statusClassName(job.status)}`}>{job.status}</span>
                          </td>
                          <td>{money(job.paidScf)}</td>
                          <td>{job.scfPayment ? paymentMethodLabels[job.scfPayment as CompanyPaymentMethod] : '-'}</td>
                          <td>{money(job.paidLabor)}</td>
                          <td>{job.laborPayment ? paymentMethodLabels[job.laborPayment as CompanyPaymentMethod] : '-'}</td>
                          <td>{money(job.materialsCost)}</td>
                          <td>
                            {money(job.salaryBase)}
                            <span>{payrollRules.commissionPercent}% rule</span>
                          </td>
                          <td>
                            <strong>{money(job.salary)}</strong>
                          </td>
                          <td>
                            {job.warnings.length ? <span className="finance-warning-text">{job.warnings.join(' · ')}</span> : <span className="finance-ok-text">Ready</span>}
                          </td>
                          <td>
                            <button className={job.paid ? 'payroll-toggle paid' : 'payroll-toggle'} type="button" onClick={() => toggleSalaryPaid(job.jobNumber)}>
                              {job.paid ? 'Paid' : 'Mark paid'}
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!filteredFinanceRows.length ? (
                        <tr>
                          <td colSpan={12}>
                            <div className="empty-inline">No finance rows match the filters.</div>
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                <section className="payment-report-panel">
                  <div>
                    <p className="eyebrow">Collected by method</p>
                    <h2>Money report</h2>
                  </div>
                  <div className="payment-bucket-grid">
                    {Object.entries(paymentBuckets).map(([label, amount]) => (
                      <span key={label}>
                        <strong>{money(amount)}</strong>
                        {label}
                      </span>
                    ))}
                    {!Object.keys(paymentBuckets).length ? <p>No paid customer payments in this filter.</p> : null}
                  </div>
                </section>
              </>
            )}
          </section>
        ) : clientPage === 'knowledge' ? (
          <section className="library-page">
            <div className="library-header">
              <div>
                <p className="eyebrow">Technical documents</p>
                <h1>Library</h1>
              </div>
              <div className="library-summary">
                <span>
                  <strong>{libraryDocuments.length}</strong>
                  Documents
                </span>
                <span>
                  <strong>{librarySystems.length}</strong>
                  Systems
                </span>
                <span>
                  <strong>{filteredLibraryDocuments.length}</strong>
                  Search results
                </span>
              </div>
            </div>

            <div className="library-layout">
              <form className="library-upload-panel" onSubmit={addLibraryDocument}>
                <div>
                  <p className="eyebrow">Upload</p>
                  <h2>Add document</h2>
                </div>
                <label>
                  File
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" onChange={handleLibraryFileChange} />
                  {libraryDraft.fileName ? <span>{libraryDraft.fileName}</span> : null}
                </label>
                <label>
                  Title
                  <input value={libraryDraft.title} onChange={(event) => setLibraryDraft((draft) => ({ ...draft, title: event.target.value }))} placeholder="Service manual, wiring diagram..." />
                </label>
                <div className="library-upload-row">
                  <label>
                    Category
                    <select value={libraryDraft.category} onChange={(event) => setLibraryDraft((draft) => ({ ...draft, category: event.target.value as LibraryCategory }))}>
                      {libraryCategories.map((category) => (
                        <option value={category} key={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    System
                    <input value={libraryDraft.system} onChange={(event) => setLibraryDraft((draft) => ({ ...draft, system: event.target.value }))} placeholder="HVAC, Appliance..." />
                  </label>
                </div>
                <div className="library-upload-row">
                  <label>
                    Manufacturer
                    <input value={libraryDraft.manufacturer} onChange={(event) => setLibraryDraft((draft) => ({ ...draft, manufacturer: event.target.value }))} placeholder="Carrier, True..." />
                  </label>
                  <label>
                    Model
                    <input value={libraryDraft.model} onChange={(event) => setLibraryDraft((draft) => ({ ...draft, model: event.target.value }))} placeholder="48TC, T-49F..." />
                  </label>
                </div>
                <label>
                  Tags
                  <input value={libraryDraft.tags} onChange={(event) => setLibraryDraft((draft) => ({ ...draft, tags: event.target.value }))} placeholder="fault codes, compressor, install" />
                </label>
                <button className="primary-button" type="submit">
                  <Plus size={18} aria-hidden="true" />
                  Add to library
                </button>
              </form>

              <section className="library-browser">
                <div className="library-filters">
                  <label className="library-search">
                    <Search size={16} aria-hidden="true" />
                    <input value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="Search title, model, tag, manufacturer..." />
                  </label>
                  <select value={libraryCategoryFilter} onChange={(event) => setLibraryCategoryFilter(event.target.value as 'all' | LibraryCategory)} aria-label="Filter by category">
                    <option value="all">All categories</option>
                    {libraryCategories.map((category) => (
                      <option value={category} key={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                  <select value={librarySystemFilter} onChange={(event) => setLibrarySystemFilter(event.target.value)} aria-label="Filter by system">
                    <option value="all">All systems</option>
                    {librarySystems.map((system) => (
                      <option value={system} key={system}>
                        {system}
                      </option>
                    ))}
                  </select>
                  <select value={libraryFormatFilter} onChange={(event) => setLibraryFormatFilter(event.target.value as 'all' | LibraryFormat)} aria-label="Filter by format">
                    <option value="all">All formats</option>
                    {libraryFormats.map((format) => (
                      <option value={format} key={format}>
                        {format}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="library-document-list">
                  {filteredLibraryDocuments.map((document) => (
                    <article className="library-document-card" key={document.id}>
                      <div className="library-document-icon">
                        <BookOpen size={20} aria-hidden="true" />
                      </div>
                      <div>
                        <div className="library-document-topline">
                          <span>{document.category}</span>
                          <span>{document.format}</span>
                          <span>{document.system}</span>
                        </div>
                        <h3>{document.title}</h3>
                        <p>{document.summary}</p>
                        <div className="library-tags">
                          {document.tags.map((tag) => (
                            <span key={tag}>{tag}</span>
                          ))}
                        </div>
                      </div>
                      <dl>
                        <div>
                          <dt>Brand</dt>
                          <dd>{document.manufacturer}</dd>
                        </div>
                        <div>
                          <dt>Model</dt>
                          <dd>{document.model}</dd>
                        </div>
                        <div>
                          <dt>Uploaded</dt>
                          <dd>{document.uploadedAt}</dd>
                        </div>
                        <div>
                          <dt>Size</dt>
                          <dd>{document.fileSize}</dd>
                        </div>
                      </dl>
                      <button className="secondary-button compact" type="button">
                        Open
                      </button>
                    </article>
                  ))}
                  {!filteredLibraryDocuments.length ? (
                    <div className="empty-state compact-empty">
                      <BookOpen size={24} aria-hidden="true" />
                      <h3>No documents found</h3>
                      <p>Change filters or add a new technical document.</p>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </section>
        ) : clientPage === 'portal' ? (
          <section className="portal-page">
            <div className="portal-hero">
              <div className="portal-identity">
                <div className="company-avatar large">{selectedCompany.name.slice(0, 2).toUpperCase()}</div>
                <div>
                  <p className="eyebrow">Company portal</p>
                  <h2>{selectedCompany.name}</h2>
                  <p>{selectedCompany.ownerName} - {selectedCompany.ownerEmail}</p>
                </div>
              </div>
              <span className={`billing-pill ${selectedCompany.billingStatus}`}>{billingLabels[selectedCompany.billingStatus]}</span>
            </div>

            <section className="portal-metrics">
              <MetricCard icon={<Rocket size={20} />} label="Launch" value={`${completedSteps}/4`} detail="Provisioning steps complete" />
              <MetricCard icon={<CreditCard size={20} />} label="Plan" value={selectedCompany.plan} detail={billingLabels[selectedCompany.billingStatus]} />
              <MetricCard icon={<ClipboardList size={20} />} label="Jobs" value={selectedCompany.usage.jobsThisMonth.toString()} detail="This month" />
              <MetricCard icon={<Inbox size={20} />} label="Support" value={openTickets.length.toString()} detail="Open requests" />
            </section>

            <div className="portal-grid">
              <section className="panel portal-status-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Workspace status</p>
                    <h2>Launch checklist</h2>
                  </div>
                  <ServerCog size={20} aria-hidden="true" />
                </div>
                <div className="steps-list">
                  {Object.entries(selectedCompany.onboarding).map(([step, stepStatus]) => (
                    <div className="step-row" key={step}>
                      <span className={`step-dot ${stepStatus}`} />
                      <span>{stepLabels[step as keyof Company['onboarding']]}</span>
                      <strong>{formatStepStatus(stepStatus)}</strong>
                    </div>
                  ))}
                </div>
                <div className={`launch-readiness ${completedSteps === onboardingStepOrder.length ? 'ready' : ''}`}>
                  <Rocket size={18} aria-hidden="true" />
                  <div>
                    <strong>{completedSteps === onboardingStepOrder.length ? 'Ready for operations' : 'Setup in progress'}</strong>
                    <span>{selectedCompany.lastSync}</span>
                  </div>
                </div>
              </section>

              <section className="panel portal-support-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Direct support</p>
                    <h2>Request a change</h2>
                  </div>
                  <MailPlus size={20} aria-hidden="true" />
                </div>
                <form className="portal-request-form" onSubmit={handleRequestSubmit}>
                  <div className="form-row">
                    <label>
                      Type
                      <select value={request.kind} onChange={(event) => setRequest({ ...request, kind: event.target.value as SupportTicketKind })}>
                        <option value="change">Change</option>
                        <option value="bug">Bug</option>
                        <option value="question">Question</option>
                      </select>
                    </label>
                    <label>
                      Priority
                      <select value={request.priority} onChange={(event) => setRequest({ ...request, priority: event.target.value as SupportTicketPriority })}>
                        <option value="normal">Normal</option>
                        <option value="urgent">Urgent</option>
                        <option value="low">Low</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Subject
                    <input value={request.subject} onChange={(event) => setRequest({ ...request, subject: event.target.value })} placeholder="What should be fixed or changed?" />
                  </label>
                  <label>
                    Message
                    <textarea value={request.message} onChange={(event) => setRequest({ ...request, message: event.target.value })} placeholder="Describe the issue, request, or missing detail." />
                  </label>
                  <button className="primary-button" type="submit">
                    <MailPlus size={18} aria-hidden="true" />
                    Send request
                  </button>
                </form>
              </section>

              <section className="panel portal-ticket-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Recent communication</p>
                    <h2>Support history</h2>
                  </div>
                  <Inbox size={20} aria-hidden="true" />
                </div>
                <div className="portal-ticket-list">
                  {tickets.slice(0, 4).map((ticket) => (
                    <article className="portal-ticket-row" key={ticket.id}>
                      <div>
                        <span className={`ticket-kind ${ticket.kind}`}>{ticketKindLabels[ticket.kind]}</span>
                        <h3>{ticket.subject}</h3>
                        <p>{ticket.lastUpdate}</p>
                      </div>
                      <strong>{ticketStatusLabels[ticket.status]}</strong>
                    </article>
                  ))}
                  {!tickets.length ? (
                    <div className="empty-state compact-empty">
                      <CheckCircle2 size={24} aria-hidden="true" />
                      <h3>No requests yet</h3>
                      <p>New requests from this portal will appear in owner support.</p>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </section>
        ) : (
          <section className="client-placeholder">
            <div className="client-placeholder-icon">
              {clientNavItems.find((item) => item.page === clientPage)?.icon}
            </div>
            <h1>{clientNavItems.find((item) => item.page === clientPage)?.label}</h1>
            <p>This module is ready to be connected to live company data.</p>
            <div className="client-placeholder-grid">
              <MetricCard icon={<Activity size={20} />} label="Company" value={selectedCompany.name} detail={selectedCompany.market} />
              <MetricCard icon={<Users size={20} />} label="Technicians" value={selectedCompany.technicians.toString()} detail="Assigned team" />
              <MetricCard icon={<Database size={20} />} label="Storage" value={`${selectedCompany.usage.storageGb} GB`} detail="Current usage" />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function AuditPage({
  events,
  filter,
  onFilterChange,
}: {
  events: AuditEvent[];
  filter: 'all' | AuditEventCategory;
  onFilterChange: (filter: 'all' | AuditEventCategory) => void;
}) {
  const filteredEvents = filterAuditEvents(events, filter);
  const categoryCounts = events.reduce(
    (counts, event) => ({
      ...counts,
      [event.category]: counts[event.category] + 1,
    }),
    { access: 0, billing: 0, support: 0, tenant: 0 } as Record<AuditEventCategory, number>,
  );

  return (
    <div className="audit-page">
      <section className="audit-summary">
        <MetricCard icon={<FileClock size={20} />} label="Events" value={events.length.toString()} detail="Owner activity history" />
        <MetricCard icon={<Building2 size={20} />} label="Tenants" value={categoryCounts.tenant.toString()} detail="Company changes" />
        <MetricCard icon={<CreditCard size={20} />} label="Billing" value={categoryCounts.billing.toString()} detail="Plan and payment changes" />
        <MetricCard icon={<Inbox size={20} />} label="Support" value={categoryCounts.support.toString()} detail="Tickets and replies" />
      </section>

      <section className="panel audit-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">System record</p>
            <h2>Activity log</h2>
          </div>
          <select value={filter} onChange={(event) => onFilterChange(event.target.value as 'all' | AuditEventCategory)} aria-label="Filter audit events">
            <option value="all">All events</option>
            <option value="tenant">Tenants</option>
            <option value="billing">Billing</option>
            <option value="access">Access</option>
            <option value="support">Support</option>
          </select>
        </div>

        <div className="audit-list">
          {filteredEvents.length ? (
            filteredEvents.map((event) => (
              <article className={`audit-row ${event.category}`} key={event.id}>
                <div className="audit-icon">
                  <FileClock size={18} aria-hidden="true" />
                </div>
                <div className="audit-main">
                  <div className="audit-topline">
                    <span className={`audit-category ${event.category}`}>{auditCategoryLabels[event.category]}</span>
                    <strong>{event.action}</strong>
                    <small>{event.createdAt}</small>
                  </div>
                  <h3>{event.resource}</h3>
                  <p>{event.details}</p>
                </div>
                <div className="audit-actor">
                  <span>Actor</span>
                  <strong>{event.actor}</strong>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state compact-empty">
              <FileClock size={24} aria-hidden="true" />
              <h3>No audit events</h3>
              <p>Choose another filter or make a platform change.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function BillingPage({
  companies,
  onChangePlan,
  onChangeBillingStatus,
}: {
  companies: Company[];
  onChangePlan: (companyId: string, plan: CompanyPlan) => void;
  onChangeBillingStatus: (companyId: string, status: BillingStatus) => void;
}) {
  const monthlyRevenue = companies.reduce((total, company) => {
    const plan = plans.find((candidate) => candidate.name === company.plan);
    return company.billingStatus === 'paid' || company.billingStatus === 'trialing'
      ? total + (plan?.price ?? 0)
      : total;
  }, 0);

  return (
    <div className="billing-page">
      <section className="billing-summary">
        <MetricCard icon={<CircleDollarSign size={20} />} label="Estimated MRR" value={money(monthlyRevenue)} detail="Paid and trialing tenants" />
        <MetricCard icon={<PackageCheck size={20} />} label="Plans" value={plans.length.toString()} detail="Launch, Growth, Scale" />
        <MetricCard icon={<CreditCard size={20} />} label="Paid tenants" value={companies.filter((company) => company.billingStatus === 'paid').length.toString()} detail="Current billing status" />
      </section>

      <section className="plan-grid" aria-label="Plan catalog">
        {plans.map((plan) => (
          <article className="plan-card" key={plan.name}>
            <div>
              <p className="eyebrow">{plan.support} support</p>
              <h2>{plan.name}</h2>
              <strong>{money(plan.price)}<span>/mo</span></strong>
            </div>
            <div className="plan-limits">
              <span>{plan.seats} seats</span>
              <span>{plan.technicians} techs</span>
              <span>{plan.storageGb} GB storage</span>
            </div>
            <ul>
              {plan.entitlements.map((entitlement) => (
                <li key={entitlement}>{entitlement}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="panel subscription-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Tenant billing</p>
            <h2>Subscriptions</h2>
          </div>
          <CreditCard size={20} aria-hidden="true" />
        </div>

        <div className="subscription-list">
          {companies.map((company) => (
            <article className="subscription-row" key={company.id}>
              <div className="company-main">
                <div className="company-avatar">{company.name.slice(0, 2).toUpperCase()}</div>
                <div>
                  <h3>{company.name}</h3>
                  <p>{company.ownerEmail}</p>
                </div>
              </div>
              <div className="billing-cell">
                <span>Plan</span>
                <select value={company.plan} onChange={(event) => onChangePlan(company.id, event.target.value as CompanyPlan)}>
                  {plans.map((plan) => (
                    <option value={plan.name} key={plan.name}>
                      {plan.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="billing-cell">
                <span>Status</span>
                <select value={company.billingStatus} onChange={(event) => onChangeBillingStatus(company.id, event.target.value as BillingStatus)}>
                  <option value="paid">Paid</option>
                  <option value="trialing">Trialing</option>
                  <option value="overdue">Overdue</option>
                  <option value="not_started">Not started</option>
                </select>
              </div>
              <div className="billing-cell">
                <span>Seats</span>
                <strong>{company.seats}</strong>
              </div>
              <span className={`billing-pill ${company.billingStatus}`}>{billingLabels[company.billingStatus]}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function AccessPage({
  users,
  form,
  onFormChange,
  onInvite,
  onRoleChange,
  onStatusChange,
}: {
  users: PlatformUser[];
  form: NewPlatformUserForm;
  onFormChange: (form: NewPlatformUserForm) => void;
  onInvite: (event: FormEvent<HTMLFormElement>) => void;
  onRoleChange: (userId: string, role: PlatformUserRole) => void;
  onStatusChange: (userId: string, status: PlatformUserStatus) => void;
}) {
  return (
    <div className="access-page">
      <section className="panel invite-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Platform team</p>
            <h2>Invite user</h2>
          </div>
          <UserPlus size={20} aria-hidden="true" />
        </div>
        <form className="access-form" onSubmit={onInvite}>
          <label>
            Name
            <input value={form.name} onChange={(event) => onFormChange({ ...form, name: event.target.value })} placeholder="Taylor Smith" />
          </label>
          <label>
            Email
            <input type="email" value={form.email} onChange={(event) => onFormChange({ ...form, email: event.target.value })} placeholder="taylor@servicescope.app" />
          </label>
          <label>
            Role
            <select value={form.role} onChange={(event) => onFormChange({ ...form, role: event.target.value as PlatformUserRole })}>
              <option value="support">Support</option>
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <button className="primary-button" type="submit">
            <UserPlus size={18} aria-hidden="true" />
            Send invite
          </button>
        </form>
      </section>

      <section className="panel users-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">RBAC</p>
            <h2>Users</h2>
          </div>
          <Users size={20} aria-hidden="true" />
        </div>

        <div className="user-list">
          {users.map((user) => {
            const lockedOwner = user.id === SYSTEM_OWNER_ID;

            return (
            <article className={`user-row ${lockedOwner ? 'locked-owner' : ''}`} key={user.id}>
              <div className="company-main">
                <div className="company-avatar">{user.name.slice(0, 2).toUpperCase()}</div>
                <div>
                  <h3>{user.name}</h3>
                  <p>{lockedOwner ? `${user.email} - locked owner` : user.email}</p>
                </div>
              </div>
              <div className="billing-cell">
                <span>Role</span>
                {lockedOwner ? (
                  <strong>Owner</strong>
                ) : (
                <select value={user.role} onChange={(event) => onRoleChange(user.id, event.target.value as PlatformUserRole)}>
                  <option value="admin">Admin</option>
                  <option value="support">Support</option>
                  <option value="viewer">Viewer</option>
                </select>
                )}
              </div>
              <div className="billing-cell">
                <span>Status</span>
                {lockedOwner ? (
                  <strong>Active</strong>
                ) : (
                <select value={user.status} onChange={(event) => onStatusChange(user.id, event.target.value as PlatformUserStatus)}>
                  <option value="active">Active</option>
                  <option value="invited">Invited</option>
                  <option value="disabled">Disabled</option>
                </select>
                )}
              </div>
              <div className="billing-cell">
                <span>Last active</span>
                <strong>{user.lastActive}</strong>
              </div>
              <span className={`user-status ${user.status}`}>{platformStatusLabels[user.status]}</span>
            </article>
            );
          })}
        </div>
      </section>

      <section className="panel permissions-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Permission matrix</p>
            <h2>Roles</h2>
          </div>
          <ShieldCheck size={20} aria-hidden="true" />
        </div>

        <div className="role-grid">
          {(Object.keys(rolePermissions) as PlatformUserRole[]).map((role) => (
            <article className={`role-card ${role === 'owner' ? 'system-role' : ''}`} key={role}>
              <h3>{platformRoleLabels[role]}{role === 'owner' ? <span>System only</span> : null}</h3>
              <ul>
                {rolePermissions[role].map((permission) => (
                  <li key={permission}>{permission}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function SupportPanel({
  companies,
  tickets,
  form,
  onFormChange,
  onSubmit,
  onStatusChange,
  selectedTicket,
  onSelectTicket,
  replyText,
  onReplyTextChange,
  onSendReply,
}: {
  companies: Company[];
  tickets: SupportTicket[];
  form: NewSupportTicketForm;
  onFormChange: (form: NewSupportTicketForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onStatusChange: (ticketId: string, status: SupportTicketStatus) => void;
  selectedTicket?: SupportTicket;
  onSelectTicket: (ticketId: string) => void;
  replyText: string;
  onReplyTextChange: (value: string) => void;
  onSendReply: (ticketId: string) => void;
}) {
  const selectedCompany = companies.find((company) => company.id === form.companyId);

  function selectCompany(companyId: string) {
    const company = companies.find((candidate) => candidate.id === companyId);
    onFormChange({
      ...form,
      companyId,
      authorName: company?.ownerName ?? '',
      authorEmail: company?.ownerEmail ?? '',
    });
  }

  return (
    <section className="panel support-panel" id="support">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Company support</p>
          <h2>Inbox</h2>
        </div>
        <MailPlus size={20} aria-hidden="true" />
      </div>

      <div className="support-layout">
        <form className="support-form" onSubmit={onSubmit}>
          <label>
            Company
            <select value={form.companyId} onChange={(event) => selectCompany(event.target.value)}>
              {companies.map((company) => (
                <option value={company.id} key={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label>
              Type
              <select value={form.kind} onChange={(event) => onFormChange({ ...form, kind: event.target.value as SupportTicketKind })}>
                <option value="bug">Bug</option>
                <option value="change">Change</option>
                <option value="question">Question</option>
              </select>
            </label>
            <label>
              Priority
              <select value={form.priority} onChange={(event) => onFormChange({ ...form, priority: event.target.value as SupportTicketPriority })}>
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
                <option value="low">Low</option>
              </select>
            </label>
          </div>
          <label>
            From
            <input value={form.authorName} onChange={(event) => onFormChange({ ...form, authorName: event.target.value })} placeholder={selectedCompany?.ownerName ?? 'Company owner'} />
          </label>
          <label>
            Reply email
            <input type="email" value={form.authorEmail} onChange={(event) => onFormChange({ ...form, authorEmail: event.target.value })} placeholder={selectedCompany?.ownerEmail ?? 'owner@company.com'} />
          </label>
          <label>
            Subject
            <input value={form.subject} onChange={(event) => onFormChange({ ...form, subject: event.target.value })} placeholder="What should change?" />
          </label>
          <label>
            Message
            <textarea value={form.message} onChange={(event) => onFormChange({ ...form, message: event.target.value })} placeholder="Describe the bug, missing feature, or request." />
          </label>
          <button className="primary-button" type="submit">
            <MailPlus size={18} aria-hidden="true" />
            Send to owner
          </button>
        </form>

        <div className="ticket-workspace">
          <div className="ticket-list">
            {tickets.map((ticket) => (
              <button
                className={`ticket-card ${ticket.priority} ${ticket.id === selectedTicket?.id ? 'selected' : ''}`}
                key={ticket.id}
                type="button"
                onClick={() => onSelectTicket(ticket.id)}
              >
                <div className="ticket-topline">
                  <span className={`ticket-kind ${ticket.kind}`}>{ticketKindLabels[ticket.kind]}</span>
                  <span className={`ticket-priority ${ticket.priority}`}>{ticketPriorityLabels[ticket.priority]}</span>
                </div>
                <h3>{ticket.subject}</h3>
                <p>{ticket.message}</p>
                <div className="ticket-meta">
                  <span>{ticket.companyName}</span>
                  <span>{ticket.lastUpdate}</span>
                </div>
                <div className="ticket-footer">
                  <span>{ticket.authorName}</span>
                  <strong>{ticketStatusLabels[ticket.status]}</strong>
                </div>
              </button>
            ))}
          </div>

          {selectedTicket ? (
            <article className="thread-panel">
              <div className="thread-header">
                <div>
                  <p className="eyebrow">{selectedTicket.companyName}</p>
                  <h3>{selectedTicket.subject}</h3>
                </div>
                <select value={selectedTicket.status} onChange={(event) => onStatusChange(selectedTicket.id, event.target.value as SupportTicketStatus)} aria-label={`Status for ${selectedTicket.subject}`}>
                  <option value="new">New</option>
                  <option value="reviewing">Reviewing</option>
                  <option value="planned">Planned</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>

              <div className="message-list">
                {selectedTicket.messages.map((message) => (
                  <div className={`support-message ${message.author}`} key={message.id}>
                    <div>
                      <strong>{message.authorName}</strong>
                      <span>{message.createdAt}</span>
                    </div>
                    <p>{message.body}</p>
                  </div>
                ))}
              </div>

              <div className="reply-box">
                <label>
                  Owner reply
                  <textarea value={replyText} onChange={(event) => onReplyTextChange(event.target.value)} placeholder="Write an answer or next step for the company." />
                </label>
                <button className="secondary-button" type="button" onClick={() => onSendReply(selectedTicket.id)}>
                  Send reply
                </button>
              </div>
            </article>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function MetricCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function CompanyRow({
  company,
  selected,
  onSelect,
}: {
  company: Company;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button className={`company-row ${selected ? 'selected' : ''}`} type="button" onClick={onSelect}>
      <div className="company-main">
        <div className="company-avatar">{company.name.slice(0, 2).toUpperCase()}</div>
        <div>
          <h3>{company.name}</h3>
          <p>{company.ownerName} - {company.market}</p>
        </div>
      </div>
      <StatusPill status={company.status} />
      <div className="company-stat">
        <span>Plan</span>
        <strong>{company.plan}</strong>
      </div>
      <div className="company-stat">
        <span>Jobs</span>
        <strong>{company.openJobs}</strong>
      </div>
      <div className="health-cell">
        <div className="health-label">
          <span>Health</span>
          <strong>{company.health}%</strong>
        </div>
        <div className="health-track">
          <span style={{ width: `${company.health}%` }} />
        </div>
      </div>
      <div className="sync-cell">
        <CheckCircle2 size={16} aria-hidden="true" />
        {company.lastSync}
      </div>
    </button>
  );
}

function CompanyDetail({
  company,
  onPrepareNext,
  onCompleteStep,
}: {
  company: Company;
  onPrepareNext: () => void;
  onCompleteStep: (step: OnboardingStepKey) => void;
}) {
  const completedSteps = Object.values(company.onboarding).filter((step) => step === 'done').length;
  const readyToLaunch = completedSteps === onboardingStepOrder.length;

  return (
    <aside className="panel detail-panel" aria-label={`${company.name} details`}>
      <div className="detail-header">
        <div className="company-avatar large">{company.name.slice(0, 2).toUpperCase()}</div>
        <div>
          <p className="eyebrow">Selected tenant</p>
          <h2>{company.name}</h2>
          <p>{company.domain}</p>
        </div>
      </div>

      <div className="detail-pills">
        <StatusPill status={company.status} />
        <span className={`billing-pill ${company.billingStatus}`}>{billingLabels[company.billingStatus]}</span>
      </div>

      <div className={`launch-readiness ${readyToLaunch ? 'ready' : ''}`}>
        <Rocket size={18} aria-hidden="true" />
        <div>
          <strong>{readyToLaunch ? 'Ready to launch' : 'Launch readiness'}</strong>
          <span>{readyToLaunch ? 'Tenant can be handed to the company owner.' : `${completedSteps} of ${onboardingStepOrder.length} provisioning steps complete.`}</span>
        </div>
      </div>

      <div className="detail-grid">
        <MiniStat icon={<Users size={17} />} label="Seats" value={company.seats.toString()} />
        <MiniStat icon={<ServerCog size={17} />} label="Techs" value={company.technicians.toString()} />
        <MiniStat icon={<ClipboardList size={17} />} label="Jobs" value={company.usage.jobsThisMonth.toString()} />
        <MiniStat icon={<CreditCard size={17} />} label="Invoices" value={company.usage.invoicesThisMonth.toString()} />
      </div>

      <section className="detail-section">
        <div className="section-title">
          <Database size={18} aria-hidden="true" />
          <h3>Provisioning</h3>
          <span>{completedSteps}/4</span>
        </div>
        <div className="steps-list">
          {Object.entries(company.onboarding).map(([step, stepStatus]) => (
            <div className="step-row" key={step}>
              <span className={`step-dot ${stepStatus}`} />
              <span>{stepLabels[step as keyof Company['onboarding']]}</span>
              {stepStatus === 'done' ? (
                <strong>{formatStepStatus(stepStatus)}</strong>
              ) : (
                <button className="step-action" type="button" onClick={() => onCompleteStep(step as OnboardingStepKey)}>
                  Complete
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <div className="section-title">
          <AlertTriangle size={18} aria-hidden="true" />
          <h3>Owner signals</h3>
          <span>{company.alerts.length}</span>
        </div>
        {company.alerts.length ? (
          <div className="alerts-list">
            {company.alerts.map((alert) => (
              <p key={alert}>{alert}</p>
            ))}
          </div>
        ) : (
          <p className="quiet-line">No active owner actions.</p>
        )}
      </section>

      <button className="secondary-button" type="button" onClick={onPrepareNext} disabled={readyToLaunch}>
        {readyToLaunch ? <Rocket size={17} aria-hidden="true" /> : <ServerCog size={17} aria-hidden="true" />}
        {readyToLaunch ? 'Workspace ready' : 'Prepare next step'}
      </button>
    </aside>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="mini-stat">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusPill({ status }: { status: CompanyStatus }) {
  return <span className={`status-pill ${status}`}>{statusLabels[status]}</span>;
}

function formatStepStatus(status: OnboardingStepStatus) {
  return status.replace('_', ' ');
}
