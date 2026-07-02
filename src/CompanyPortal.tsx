import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
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
import { confirmSubscriptionBillingSetup, startSubscriptionBillingSetup } from './services/billingConnector';
import { JobCard, type JobCardData } from './components/JobCard';
import { JobDetailPanel } from './components/JobDetailPanel';
import { CalendarPage } from './components/portal/CalendarPage';
import { EmailPage } from './components/portal/EmailPage';
import { FinancePage } from './components/portal/FinancePage';
import { AllJobsPage, JobsPage } from './components/portal/JobsPages';
import { KnowledgePage } from './components/portal/KnowledgePage';
import { MapPage } from './components/portal/MapPage';
import { MaterialsPage } from './components/portal/MaterialsPage';
import { OnboardingPage } from './components/portal/OnboardingPage';
import { TasksPage } from './components/portal/TasksPage';
import { accessLevelLabels, resolveCompanyAccessRules } from './components/CompanyAccessPage';
import {
  AccessPage,
  AuditPage,
  BillingPage,
  CompanyDetail,
  CompanyRow,
  DashboardOverview,
  MetricCard,
  MiniStat,
  StatusPill,
  SupportPanel,
} from './components/OwnerPages';
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
import { saveUserAccess, type AccessActionMode } from './services/accessInvite';
import { uploadCompanyLogo } from './services/companyAssets';
import { startMailboxConnection } from './services/mailboxConnector';
import {
  loadMailboxEmailConnection,
  loadMailboxOAuthSettings,
  mailboxOAuthRedirectUrl,
  saveMailboxOAuthSettings,
} from './services/mailboxOAuthSettings';
import { loadMailboxMessages, syncMailboxMessages } from './services/mailboxMessages';
import { sendMailboxEmail } from './services/mailboxSend';
import { deleteJobTypeFromBackend, saveOnboardingProfileToBackend } from './services/onboardingBackend';
import { dollarsToCents, findTechnicianId, listCompanyPayrollItems, upsertCompanyPayrollItems, type PayrollItemInput, type PayrollItemRow } from './services/payrollStore';
import {
  createJobInvoice,
  createServiceJob,
  deleteJobInvoice,
  listCompanyJobMaterials,
  listCompanyJobs,
  saveJobAppointment,
  saveJobMaterials as saveJobMaterialsToBackend,
  saveServiceJob,
} from './services/jobsStore';
import type {
  AuditEvent,
  AuditEventCategory,
  BillingStatus,
  Company,
  CompanyPlan,
  CompanyPortalAccessLevel,
  CompanyPortalAccessPage,
  CompanyStatus,
  NewPlatformUserForm,
  NewSupportTicketForm,
  NewCompanyForm,
  NewCompanyJobTypeForm,
  NewCompanyTechnicianForm,
  OnboardingStepKey,
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
  JobDocumentType,
  JobInvoice,
  MaterialRow,
  NewServiceJobForm,
  ServiceJob,
  ServiceJobStatus,
} from './types';
import {
  auditCategoryLabels,
  billingLabels,
  paymentMethodLabels,
  platformRoleLabels,
  platformStatusLabels,
  statusLabels,
  ticketKindLabels,
  ticketPriorityLabels,
  ticketStatusLabels,
} from './appLabels';
import {
  emailProviderLabels,
  emptyAccessForm,
  emptyCompany,
  emptyJobTypeForm,
  emptySupportForm,
  emptyTaskForm,
  emptyTechnicianForm,
  initialEmailTemplates,
  initialLibraryDocuments,
  initialManualTasks,
  initialMaterialRows,
  libraryCategories,
  libraryFormats,
} from './appSeeds';
import type {
  AppPage,
  ClientPage,
  CompanyOnboardingStepKey,
  EmailCompose,
  EmailComposeAttachment,
  EmailConnection,
  EmailFolder,
  EmailMessage,
  EmailProvider,
  EmailTemplate,
  FinancePeriod,
  LibraryCategory,
  LibraryDocument,
  LibraryDraft,
  LibraryFormat,
  PayrollRules,
  TaskForm,
  TaskPriority,
  TaskRow,
  TaskStatus,
} from './appTypes';
import { emptyMaterialDraft } from './appTypes';
import { addDays, addMonths, formatCalendarDay, parseLocalDate, startOfWeek, toLocalIsoDate } from './utils/calendar';
import { googleRouteUrl, isCustomerJobPaid, money, statusClassName } from './utils/format';

const CLIENT_PAGE_STORAGE_KEY = 'servicescope.portal.clientPage';
const SALARY_PAID_STORAGE_KEY = 'servicescope.finance.salaryPaidJobs';
const clientPageValues: ClientPage[] = ['jobs', 'allJobs', 'calendar', 'materials', 'tasks', 'map', 'email', 'finances', 'knowledge', 'portal', 'onboarding'];

type SquareCard = {
  attach: (selector: string) => Promise<void>;
  tokenize: (details: Record<string, unknown>) => Promise<{
    status: string;
    token?: string;
    errors?: Array<{ message?: string; detail?: string }>;
  }>;
  destroy?: () => Promise<void>;
};

type SquarePayments = {
  card: () => Promise<SquareCard>;
};

declare global {
  interface Window {
    Square?: {
      payments: (applicationId: string, locationId: string) => SquarePayments;
    };
  }
}

function readSavedClientPage(): ClientPage {
  const saved = window.localStorage.getItem(CLIENT_PAGE_STORAGE_KEY);
  return clientPageValues.includes(saved as ClientPage) ? saved as ClientPage : 'jobs';
}

function readSalaryPaidJobs(): Record<string, string> {
  const saved = window.localStorage.getItem(SALARY_PAID_STORAGE_KEY);
  if (!saved) return {};

  try {
    const parsed = JSON.parse(saved);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

function loadSquareScript(environment: 'sandbox' | 'production') {
  const scriptUrl = environment === 'production'
    ? 'https://web.squarecdn.com/v1/square.js'
    : 'https://sandbox.web.squarecdn.com/v1/square.js';

  const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${scriptUrl}"]`);
  if (existingScript) {
    return new Promise<void>((resolve, reject) => {
      if (window.Square) {
        resolve();
        return;
      }
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Square.js failed to load.')), { once: true });
    });
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Square.js failed to load.')), { once: true });
    document.head.appendChild(script);
  });
}

function SquareBillingModal({
  activeCompany,
  profile,
  onClose,
  onConnected,
}: {
  activeCompany: Company;
  profile: CompanyOnboardingProfile;
  onClose: () => void;
  onConnected: (updates: Partial<CompanyOnboardingProfile>, status: string) => void;
}) {
  const cardRef = useRef<SquareCard | null>(null);
  const [status, setStatus] = useState('Loading Square card form...');
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function setupSquareCard() {
      try {
        const config = await startSubscriptionBillingSetup({
          companyId: activeCompany.id,
          billingName: profile.subscriptionBillingName || activeCompany.ownerName || activeCompany.name,
          billingZip: profile.subscriptionBillingZip,
          email: profile.billingEmail || activeCompany.ownerEmail,
        });

        await loadSquareScript(config.environment);
        if (!window.Square) {
          throw new Error('Square.js is not available.');
        }

        const payments = window.Square.payments(config.applicationId, config.locationId);
        const card = await payments.card();
        if (cancelled) {
          await card.destroy?.();
          return;
        }

        await card.attach('#square-card-container');
        cardRef.current = card;
        setReady(true);
        setStatus('Enter a card to connect automatic billing.');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Square card form failed to load.');
      }
    }

    setupSquareCard();

    return () => {
      cancelled = true;
      void cardRef.current?.destroy?.();
      cardRef.current = null;
    };
  }, [activeCompany.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cardRef.current || submitting) return;

    setSubmitting(true);
    setStatus('Saving card in Square...');

    try {
      const tokenResult = await cardRef.current.tokenize({
        intent: 'STORE',
        customerInitiated: true,
        sellerKeyedIn: false,
        currencyCode: 'USD',
        billingContact: {
          givenName: profile.subscriptionBillingName || activeCompany.ownerName || activeCompany.name,
          email: profile.billingEmail || activeCompany.ownerEmail,
          addressLines: profile.serviceAddress ? [profile.serviceAddress] : [],
          postalCode: profile.subscriptionBillingZip || undefined,
          countryCode: 'US',
        },
      });

      if (tokenResult.status !== 'OK' || !tokenResult.token) {
        const detail = tokenResult.errors?.map((error) => error.message || error.detail).filter(Boolean).join(' ');
        throw new Error(detail || 'Square could not tokenize this card.');
      }

      const result = await confirmSubscriptionBillingSetup({
        companyId: activeCompany.id,
        sourceId: tokenResult.token,
        billingName: profile.subscriptionBillingName || activeCompany.ownerName || activeCompany.name,
        billingZip: profile.subscriptionBillingZip,
        email: profile.billingEmail || activeCompany.ownerEmail,
      });

      onConnected({
        subscriptionPaymentStatus: 'active',
        subscriptionCardBrand: result.brand,
        subscriptionCardLast4: result.last4,
        subscriptionCardExpMonth: result.expMonth,
        subscriptionCardExpYear: result.expYear,
        subscriptionBillingName: result.billingName || profile.subscriptionBillingName,
        subscriptionBillingZip: result.billingZip || profile.subscriptionBillingZip,
        autoPayEnabled: true,
      }, 'Square payment method connected.');
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Square billing setup failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="email-message-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="email-message-modal square-billing-modal" role="dialog" aria-modal="true" aria-label="Connect Square billing" onClick={(event) => event.stopPropagation()}>
        <div className="email-message-detail-header">
          <div>
            <p className="eyebrow">ServiceScope subscription</p>
            <h2>Connect Square card</h2>
          </div>
          <button className="secondary-button compact" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <form className="square-billing-form" onSubmit={handleSubmit}>
          <div className="square-billing-summary">
            <strong>{activeCompany.plan} plan</strong>
            <span>ServiceScope will use this card for automatic monthly charges.</span>
          </div>

          <div id="square-card-container" className="square-card-container" />

          <p className="subscription-safe-note">
            Card entry is handled by Square. ServiceScope stores only the Square card id and card summary.
          </p>
          {status ? <p className="access-status">{status}</p> : null}

          <div className="email-message-modal-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={!ready || submitting}>
              {submitting ? 'Saving card...' : 'Save Square card'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function CompanyLogin({
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
          <input type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="Owner email" />
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

function makeCompanyEmailDomain(company: Company) {
  const rawDomain = company.domain?.trim();
  if (rawDomain) {
    try {
      const url = new URL(rawDomain.startsWith('http') ? rawDomain : `https://${rawDomain}`);
      return url.hostname.replace(/^www\./, '');
    } catch {
      return rawDomain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    }
  }

  return `${company.name.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/^$/, 'company')}.com`;
}

function makeDefaultEmailConnection(
  company: Company,
  profile: CompanyOnboardingProfile,
  provider: EmailProvider,
): EmailConnection {
  const domain = makeCompanyEmailDomain(company);
  const address = provider === 'smtp' ? `dispatch@${domain}` : '';

  return {
    provider,
    address,
    status: 'backend_required',
    oauthClientId: '',
    oauthClientSecretSaved: false,
    oauthRedirectUrl: mailboxOAuthRedirectUrl,
    lastSync: 'Not synced',
    syncRange: '30',
    autoLinkJobNumber: true,
    autoLinkClientEmail: true,
    createTaskFromUnread: true,
    senderName: profile.displayName || company.name,
    replyTo: address,
    signature: `${profile.displayName || company.name}\n${profile.phone || profile.billingEmail || company.ownerEmail}`,
    imapHost: provider === 'smtp' ? `imap.${domain}` : '',
    imapPort: provider === 'smtp' ? '993' : '',
    smtpHost: provider === 'smtp' ? `smtp.${domain}` : '',
    smtpPort: provider === 'smtp' ? '587' : '',
    security: provider === 'smtp' ? 'tls' : 'ssl',
    username: provider === 'smtp' ? address : '',
  };
}

export function CompanyPortal({
  selectedCompany,
  onboardingProfile,
  signedInUser,
  tickets,
  onSignOut,
  onUpdateOnboardingProfile,
  onCreateRequest,
  onReplyToTicket,
}: {
  selectedCompany?: Company;
  onboardingProfile?: CompanyOnboardingProfile;
  signedInUser?: { name: string; email: string; role: 'Manager' | 'Admin' | 'Technician' };
  tickets: SupportTicket[];
  onSignOut: () => void;
  onUpdateOnboardingProfile: (profile: CompanyOnboardingProfile) => void;
  onCreateRequest: (request: Pick<NewSupportTicketForm, 'kind' | 'priority' | 'subject' | 'message'>) => void;
  onReplyToTicket?: (ticketId: string, body: string) => void;
}) {
  const [clientPage, setClientPage] = useState<ClientPage>(() => readSavedClientPage());
  const [request, setRequest] = useState<Pick<NewSupportTicketForm, 'kind' | 'priority' | 'subject' | 'message'>>({
    kind: 'change',
    priority: 'normal',
    subject: '',
    message: '',
  });
  const [requestTouched, setRequestTouched] = useState(false);
  const [supportReplyDrafts, setSupportReplyDrafts] = useState<Record<string, string>>({});
  const [technicianForm, setTechnicianForm] = useState<NewCompanyTechnicianForm>(emptyTechnicianForm);
  const [technicianAccessStatusById, setTechnicianAccessStatusById] = useState<Record<string, string>>({});
  const [technicianAccessPasswordById, setTechnicianAccessPasswordById] = useState<Record<string, string>>({});
  const [ownerAccessPassword, setOwnerAccessPassword] = useState('');
  const [ownerAccessPasswordConfirm, setOwnerAccessPasswordConfirm] = useState('');
  const [ownerAccessStatus, setOwnerAccessStatus] = useState('');
  const [jobTypeForm, setJobTypeForm] = useState<NewCompanyJobTypeForm>(emptyJobTypeForm);
  const [openedJob, setOpenedJob] = useState<JobCardData | null>(null);
  const [jobs, setJobs] = useState<ServiceJob[]>([]);
  const [jobsStatus, setJobsStatus] = useState('');
  const [inlineJobDrafts, setInlineJobDrafts] = useState<Record<string, Partial<ServiceJob>>>({});
  const [allJobsVisibility, setAllJobsVisibility] = useState<'active' | 'paid' | 'all'>('active');
  const [selectedJobTypeId, setSelectedJobTypeId] = useState('');
  const [calendarView, setCalendarView] = useState<'month' | 'week' | 'day'>('week');
  const [calendarAnchorDate, setCalendarAnchorDate] = useState(() => toLocalIsoDate(new Date()));
  const [activeCalendarTech, setActiveCalendarTech] = useState('all');
  const [calendarAssignments, setCalendarAssignments] = useState<Record<string, { assignee: string; dayKey: string; time: string; durationMinutes: number }>>({});
  const [draggingJobNumber, setDraggingJobNumber] = useState('');
  const [resizingJob, setResizingJob] = useState<{
    jobNumber: string;
    assignee: string;
    dayKey: string;
    time: string;
    edge: 'start' | 'end';
    startY: number;
    startDuration: number;
    startSlotIndex: number;
  } | null>(null);
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
  const [mailboxConnectStatus, setMailboxConnectStatus] = useState('');
  const [mailboxOAuthSecretDraft, setMailboxOAuthSecretDraft] = useState('');
  const [mailboxOAuthStatus, setMailboxOAuthStatus] = useState('');
  const [emailFolder, setEmailFolder] = useState<EmailFolder>('inbox');
  const [emailSearch, setEmailSearch] = useState('');
  const [emailMessages, setEmailMessages] = useState<EmailMessage[]>([]);
  const [mailboxSyncLimit, setMailboxSyncLimit] = useState(25);
  const [mailboxSyncing, setMailboxSyncing] = useState(false);
  const [billingStatus, setBillingStatus] = useState('');
  const [billingModalOpen, setBillingModalOpen] = useState(false);
  const mailboxSyncingRef = useRef(false);
  const onboardingSaveQueueRef = useRef(Promise.resolve());
  const [emailCompose, setEmailCompose] = useState<EmailCompose>({
    to: '',
    subject: '',
    body: '',
    jobNumber: '',
    includeSignature: true,
    includePaymentBlock: false,
    signatureText: '',
    paymentBlockText: '',
  });
  const [emailComposeRequestId, setEmailComposeRequestId] = useState(0);
  const [emailComposeAttachments, setEmailComposeAttachments] = useState<EmailComposeAttachment[]>([]);
  const [financePeriod, setFinancePeriod] = useState<FinancePeriod>('this_month');
  const [financeTechFilter, setFinanceTechFilter] = useState('all');
  const [payrollRules, setPayrollRules] = useState<PayrollRules>({
    commissionPercent: 50,
    scfOnlyPayout: 50,
    deductMaterials: true,
    includeScf: true,
  });
  const [salaryPaidJobs, setSalaryPaidJobs] = useState<Record<string, string>>(() => readSalaryPaidJobs());
  const [payrollItems, setPayrollItems] = useState<PayrollItemRow[]>([]);
  const [libraryDocuments, setLibraryDocuments] = useState<LibraryDocument[]>([]);
  const [libraryStatus, setLibraryStatus] = useState('');
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

  const selectedCompanyId = selectedCompany?.id ?? '';

  useEffect(() => {
    if (!selectedCompany) {
      setJobs([]);
      setMaterials([]);
      setJobsStatus('');
      return undefined;
    }

    let cancelled = false;
    const company = selectedCompany;
    setJobsStatus('Loading jobs...');

    async function loadJobsAndCustomers() {
      try {
        const [savedJobs, savedMaterials] = await Promise.all([
          listCompanyJobs(company.id),
          listCompanyJobMaterials(company.id),
        ]);

        if (cancelled) return;
        setJobs(savedJobs);
        setMaterials(savedMaterials);
        setJobsStatus('');
      } catch (error) {
        if (cancelled) return;
        setJobs([]);
        setMaterials([]);
        setJobsStatus(error instanceof Error ? error.message : 'Jobs could not be loaded.');
      }
    }

    void loadJobsAndCustomers();

    return () => {
      cancelled = true;
    };
  }, [selectedCompany]);

  useEffect(() => {
    window.localStorage.setItem(CLIENT_PAGE_STORAGE_KEY, clientPage);
  }, [clientPage]);

  useEffect(() => {
    if (!selectedCompany) {
      setEmailConnection(null);
      setMailboxOAuthSecretDraft('');
      setMailboxOAuthStatus('');
      return undefined;
    }

    let cancelled = false;
    const company = selectedCompany;
    const currentProfile = onboardingProfile ?? createDefaultCompanyOnboardingProfile(company);

    async function loadMailboxSettings() {
      try {
        const [savedConnection, oauthSettings] = await Promise.all([
          loadMailboxEmailConnection(company.id),
          loadMailboxOAuthSettings(company.id),
        ]);

        if (cancelled) return;

        const savedOAuth = savedConnection
          ? savedConnection.provider !== 'smtp'
            ? oauthSettings.find((settings) => settings.provider === savedConnection.provider)
            : undefined
          : oauthSettings[0];

        if (!savedConnection && !savedOAuth) {
          setEmailConnection(null);
          setMailboxOAuthSecretDraft('');
          setMailboxOAuthStatus('');
          setMailboxConnectStatus('');
          return;
        }

        const baseConnection =
          savedConnection ??
          makeDefaultEmailConnection(company, currentProfile, savedOAuth?.provider ?? 'google');
        const nextConnection: EmailConnection = {
          ...baseConnection,
          oauthClientId: savedOAuth?.clientId ?? baseConnection.oauthClientId,
          oauthClientSecretSaved: savedOAuth?.clientSecretSaved ?? baseConnection.oauthClientSecretSaved,
          oauthRedirectUrl: savedOAuth?.redirectUrl ?? baseConnection.oauthRedirectUrl,
        };

        setEmailConnection(nextConnection);
        setMailboxOAuthSecretDraft('');
        setMailboxOAuthStatus(savedOAuth ? 'OAuth settings loaded.' : '');
        setMailboxConnectStatus(nextConnection.status === 'connected' ? '' : '');
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load mailbox settings', error);
        setMailboxOAuthStatus(error instanceof Error ? error.message : 'Mailbox settings could not be loaded.');
      }
    }

    void loadMailboxSettings();

    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!resizingJob) return undefined;
    const activeResize = resizingJob;

    function getResizedAssignment(clientY: number) {
      const deltaSlots = Math.round((clientY - activeResize.startY) / 32);
      const startDurationSlots = Math.max(1, Math.round(activeResize.startDuration / 30));
      const lastStartSlot = Math.max(0, activeResize.startSlotIndex + startDurationSlots - 1);
      const maxDurationSlots = Math.max(1, calendarDropSlots.length - activeResize.startSlotIndex);
      let nextSlotIndex = activeResize.startSlotIndex;
      let durationSlots = startDurationSlots;

      if (activeResize.edge === 'start') {
        nextSlotIndex = Math.min(lastStartSlot, Math.max(0, activeResize.startSlotIndex + deltaSlots));
        durationSlots = startDurationSlots + (activeResize.startSlotIndex - nextSlotIndex);
      } else {
        durationSlots = Math.min(maxDurationSlots, Math.max(1, startDurationSlots + deltaSlots));
      }

      const nextSlot = calendarDropSlots[nextSlotIndex];

      return {
        durationMinutes: durationSlots * 30,
        time: nextSlot?.key ?? activeResize.time,
      };
    }

    function handlePointerMove(event: globalThis.PointerEvent) {
      const resized = getResizedAssignment(event.clientY);

      setCalendarAssignments((assignments) => {
        const assignment = assignments[activeResize.jobNumber] ?? {
          assignee: activeResize.assignee,
          dayKey: activeResize.dayKey,
          time: activeResize.time,
          durationMinutes: activeResize.startDuration,
        };

        return {
          ...assignments,
          [activeResize.jobNumber]: {
            ...assignment,
            time: resized.time,
            durationMinutes: resized.durationMinutes,
          },
        };
      });
    }

    function handlePointerUp(event: globalThis.PointerEvent) {
      const resized = getResizedAssignment(event.clientY);
      persistCalendarAssignment(activeResize.jobNumber, activeResize.assignee, activeResize.dayKey, resized.time, resized.durationMinutes);
      setResizingJob(null);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [resizingJob]);

  async function syncConnectedMailboxMessages(companyId: string, limit = mailboxSyncLimit) {
    if (mailboxSyncingRef.current) {
      setMailboxConnectStatus('Mailbox sync is already running. Wait a moment.');
      return;
    }

    mailboxSyncingRef.current = true;
    setMailboxSyncing(true);

    try {
      const savedMessages = await loadMailboxMessages(companyId);
      setEmailMessages(savedMessages);
      setMailboxConnectStatus('Syncing mailbox...');

      const result = await syncMailboxMessages(companyId, limit);
      const syncedMessages = await loadMailboxMessages(companyId);
      setEmailMessages(syncedMessages);

      if (result.count) {
        setMailboxConnectStatus(`Synced ${result.count} messages (${result.inbox} inbox, ${result.sent} sent).`);
      } else {
        setMailboxConnectStatus('Mailbox synced. No messages found.');
      }
    } finally {
      mailboxSyncingRef.current = false;
      setMailboxSyncing(false);
    }
  }

  const loadMoreMailboxMessages = () => {
    if (!selectedCompanyId || mailboxSyncingRef.current) return;
    const nextLimit = Math.min(100, mailboxSyncLimit + 25);
    setMailboxSyncLimit(nextLimit);
    syncConnectedMailboxMessages(selectedCompanyId, nextLimit).catch((error) => {
      setMailboxConnectStatus(error instanceof Error ? error.message : 'Mailbox sync failed.');
    });
  };

  useEffect(() => {
    if (!selectedCompanyId || emailConnection?.status !== 'connected') {
      setEmailMessages([]);
      return undefined;
    }

    let cancelled = false;

    async function loadAndSyncMessages() {
      try {
        await syncConnectedMailboxMessages(selectedCompanyId);
        if (cancelled) return;
      } catch (error) {
        if (cancelled) return;
        setMailboxConnectStatus(error instanceof Error ? error.message : 'Mailbox sync failed.');
      }
    }

    void loadAndSyncMessages();

    return () => {
      cancelled = true;
    };
  }, [emailConnection?.status, selectedCompanyId]);

  if (!selectedCompany) {
    return (
      <div className="empty-state">
        <Building2 size={28} aria-hidden="true" />
        <h3>No tenant selected</h3>
        <p>Add a company first, then open the portal preview.</p>
      </div>
    );
  }

  const activeCompany = selectedCompany;
  const completedSteps = Object.values(activeCompany.onboarding).filter((step) => step === 'done').length;
  const openTickets = tickets.filter((ticket) => ticket.status !== 'resolved');
  const profile = onboardingProfile ?? createDefaultCompanyOnboardingProfile(activeCompany);
  const companyAccessRules = resolveCompanyAccessRules(activeCompany);
  const accessLevelForPage = (page: CompanyPortalAccessPage): CompanyPortalAccessLevel => companyAccessRules[page];
  const canViewPage = (page: CompanyPortalAccessPage) => accessLevelForPage(page) !== 'off';
  const canWritePage = (page: CompanyPortalAccessPage) => accessLevelForPage(page) === 'full';
  const stopCompanyWrite = (page: CompanyPortalAccessPage, action: string) => {
    const level = accessLevelForPage(page);
    if (level === 'full') return false;

    setJobsStatus(`Owner access for ${page} is ${accessLevelLabels[level].toLowerCase()}. Restore full access before ${action}.`);
    return true;
  };
  const generatedCompanyEmailSignature = [
    '--',
    profile.displayName || activeCompany.name,
    profile.serviceAddress,
    profile.phone ? `Phone: ${profile.phone}` : '',
    profile.website ? `Website: ${profile.website}` : '',
    'HVAC and Appliance Repair',
    profile.serviceArea ? `Services Licensed & Insured | Serving ${profile.serviceArea}` : 'Services Licensed & Insured',
  ].filter(Boolean).join('\n');
  const companyEmailSignature = emailConnection?.signature.trim() || generatedCompanyEmailSignature;
  const paymentLines = profile.acceptedPayments.flatMap((method) => {
    if (method === 'zelle') return [`Zelle: ${profile.zelleContact || profile.billingEmail || emailConnection?.address || activeCompany.ownerEmail}`];
    if (method === 'ach') {
      return [
        'ACH Transfer',
        profile.achAccountNumber ? `Account number: ${profile.achAccountNumber}` : '',
        profile.achRoutingNumber ? `Routing number: ${profile.achRoutingNumber}` : '',
      ].filter(Boolean);
    }
    if (method === 'credit_card') return ['Credit Card'];
    if (method === 'debit_card') return ['Debit Card'];
    if (method === 'check') return [`Check payable to: ${profile.achAccountName || profile.legalName || activeCompany.name}`];
    if (method === 'cash') return ['Cash'];
    if (method === 'paypal') return [`PayPal: ${profile.paypalEmail || profile.billingEmail || emailConnection?.address || activeCompany.ownerEmail}`];
    if (method === 'venmo') return [`Venmo: ${profile.venmoContact || 'available on request'}`];
    if (method === 'cash_app') return [`Cash App: ${profile.cashAppCashtag || 'available on request'}`];
    if (method === 'stripe') return ['Stripe payment link available on request'];
    if (method === 'square') return ['Square invoice/payment link available on request'];
    if (method === 'wire_transfer') return ['Wire transfer details available on request'];
    if (method === 'apple_pay') return ['Apple Pay available'];
    if (method === 'google_pay') return ['Google Pay available'];
    if (method === 'financing') return ['Financing options available on request'];
    return [paymentMethodLabels[method]];
  });
  const companyPaymentBlock = [
    'Payment Options:',
    ...paymentLines,
    profile.serviceAddress ? `Mailing address: ${profile.serviceAddress}` : '',
    profile.paymentNotes,
  ].filter(Boolean).join('\n');
  function persistOnboardingToBackend(nextProfile: CompanyOnboardingProfile, nextEmailConnection = emailConnection) {
    onboardingSaveQueueRef.current = onboardingSaveQueueRef.current
      .catch(() => undefined)
      .then(() =>
        saveOnboardingProfileToBackend(activeCompany, nextProfile, nextEmailConnection, {
          saveCompanyCore: false,
          saveOnboardingSteps: false,
          saveSubscriptionPaymentMethod: false,
        }),
      )
      .catch((error) => {
        console.error('Failed to save onboarding to backend', error);
      });
  }

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
  const generatedJobNumber = selectedJobPrefix ? `${selectedJobPrefix}-${nextJobNumber}` : nextJobNumber;
  const jobStatusFilters: ServiceJobStatus[] = ['New', 'ReCall', 'Diagnosis', 'In progress', 'Parts ordered', 'Waiting for parts', 'To finish', 'Completed', 'Warranty', 'Cancelled'];
  const allJobsRows = jobs;
  const activeJobsRows = allJobsRows.filter((job) => !isCustomerJobPaid(job));
  const paidJobsRows = allJobsRows.filter(isCustomerJobPaid);
  const visibleAllJobsRows = allJobsVisibility === 'paid' ? paidJobsRows : allJobsVisibility === 'all' ? allJobsRows : activeJobsRows;
  const allJobsGroups = Array.from(new Set(['No technician', ...allJobsRows.map((job) => job.assignee)])).map((technician) => ({
    technician,
    jobs: visibleAllJobsRows.filter((job) => job.assignee === technician),
  })).filter((group) => group.jobs.length > 0);
  const technicianLocations = profile.technicians.map((technician) => ({
    ...technician,
    online: false,
    lastSeen: 'No GPS data',
    area: 'Not reported',
    lat: '',
    lng: '',
    x: null,
    y: null,
  }));
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
  const visibleEmailMessages = emailMessages.filter((message) => {
    const normalizedSearch = emailSearch.trim().toLowerCase();
    const job = materialJobMap.get(message.jobNumber);
    const haystack = [message.from, message.to, message.subject, message.preview, message.jobNumber, job?.organization, job?.clientName]
      .join(' ')
      .toLowerCase();

    return message.folder === emailFolder && (!normalizedSearch || haystack.includes(normalizedSearch));
  });
  const connectMailbox = (provider: EmailProvider) => {
    const nextConnection = makeDefaultEmailConnection(activeCompany, profile, provider);

    setEmailConnection(nextConnection);
    setMailboxOAuthSecretDraft('');
    setMailboxOAuthStatus('');
    persistOnboardingToBackend(profile, nextConnection);
  };
  const updateMailbox = (patch: Partial<EmailConnection>) => {
    setEmailConnection((connection) => {
      if (!connection) return connection;
      const nextConnection = { ...connection, ...patch };
      persistOnboardingToBackend(profile, nextConnection);
      return nextConnection;
    });
  };
  const copyMailboxRedirectUrl = async () => {
    const redirectUrl = emailConnection?.oauthRedirectUrl || mailboxOAuthRedirectUrl;
    try {
      await navigator.clipboard.writeText(redirectUrl);
      setMailboxOAuthStatus('Redirect URL copied.');
    } catch {
      setMailboxOAuthStatus(redirectUrl);
    }
  };
  const saveMailboxOAuth = async () => {
    if (!emailConnection || emailConnection.provider === 'smtp') {
      setMailboxOAuthStatus('Choose Google Workspace or Microsoft 365 first.');
      return;
    }

    if (!emailConnection.oauthClientId.trim()) {
      setMailboxOAuthStatus('Client ID is required.');
      return;
    }

    if (!mailboxOAuthSecretDraft.trim() && !emailConnection.oauthClientSecretSaved) {
      setMailboxOAuthStatus('Client secret is required.');
      return;
    }

    setMailboxOAuthStatus('Saving OAuth settings...');

    try {
      const result = await saveMailboxOAuthSettings({
        companyId: activeCompany.id,
        provider: emailConnection.provider,
        clientId: emailConnection.oauthClientId.trim(),
        clientSecret: mailboxOAuthSecretDraft.trim(),
        redirectUrl: emailConnection.oauthRedirectUrl || mailboxOAuthRedirectUrl,
      });
      const nextConnection = {
        ...emailConnection,
        oauthRedirectUrl: result.redirectUrl,
        oauthClientSecretSaved: true,
      };
      setEmailConnection(nextConnection);
      persistOnboardingToBackend(profile, nextConnection);
      setMailboxOAuthSecretDraft('');
      setMailboxOAuthStatus('OAuth settings saved. You can connect the mailbox now.');
    } catch (error) {
      setMailboxOAuthStatus(error instanceof Error ? error.message : 'OAuth settings could not be saved.');
    }
  };
  const startMailboxConnector = async () => {
    if (!emailConnection) {
      setMailboxConnectStatus('Choose a mailbox provider first.');
      return;
    }

    if (!emailConnection.address.trim()) {
      setMailboxConnectStatus('Mailbox address is required.');
      return;
    }

    if (emailConnection.status === 'connected') {
      setMailboxConnectStatus('');
      return;
    }

    setMailboxConnectStatus('Checking mailbox connector...');

    try {
      const result = await startMailboxConnection({
        companyId: activeCompany.id,
        provider: emailConnection.provider,
        mailboxAddress: emailConnection.address,
      });
      setMailboxConnectStatus(result.message);

      if (result.authUrl) {
        window.location.href = result.authUrl;
      }
    } catch (error) {
      setMailboxConnectStatus(error instanceof Error ? error.message : 'Mailbox connector failed.');
    }
  };
  const applyEmailTemplate = (template: EmailTemplate) => {
    setEmailCompose((draft) => ({
      ...draft,
      subject: template.subject,
      body: template.body,
    }));
    setEmailFolder('inbox');
  };
  const resetEmailCompose = () => {
    setEmailCompose({
      to: '',
      subject: '',
      body: '',
      jobNumber: '',
      includeSignature: true,
      includePaymentBlock: false,
      signatureText: companyEmailSignature,
      paymentBlockText: companyPaymentBlock,
    });
  };
  const openEmailCompose = (compose: EmailCompose, attachments: EmailComposeAttachment[] = []) => {
    if (stopCompanyWrite('email', 'opening email composer')) return;

    setEmailCompose({
      ...compose,
      signatureText: compose.signatureText || companyEmailSignature,
      paymentBlockText: compose.paymentBlockText || companyPaymentBlock,
    });
    setEmailComposeAttachments(attachments);
    setEmailComposeRequestId((requestId) => requestId + 1);
    setClientPage('email');
  };
  const sendEmailDraft = async (attachments: EmailComposeAttachment[]) => {
    if (stopCompanyWrite('email', 'sending email')) return;

    if (!selectedCompanyId) {
      setMailboxConnectStatus('Choose a company before sending email.');
      return;
    }

    if (emailConnection?.status !== 'connected') {
      setMailboxConnectStatus('Connect the mailbox before sending email.');
      return;
    }

    const recipients = emailCompose.to.split(',').map((value) => value.trim()).filter(Boolean);
    if (!recipients.length) {
      setMailboxConnectStatus('Recipient email is required.');
      return;
    }

    const messageBody = [
      emailCompose.body.trimEnd(),
      emailCompose.includeSignature ? emailCompose.signatureText || companyEmailSignature : '',
      emailCompose.includePaymentBlock ? emailCompose.paymentBlockText || companyPaymentBlock : '',
    ].filter(Boolean).join('\n\n');

    setMailboxConnectStatus('Sending email...');

    try {
      await sendMailboxEmail({
        companyId: selectedCompanyId,
        to: recipients,
        subject: emailCompose.subject,
        body: messageBody,
        jobNumber: emailCompose.jobNumber,
        attachments,
      });
      resetEmailCompose();
      setMailboxConnectStatus('Email sent.');
      const savedMessages = await loadMailboxMessages(selectedCompanyId);
      setEmailMessages(savedMessages);
    } catch (error) {
      setMailboxConnectStatus(error instanceof Error ? error.message : 'Email send failed.');
      throw error;
    }
  };
  const materialRowsWithJobs = materials
    .map((material) => ({ material, job: materialJobMap.get(material.jobNumber) }))
    .filter((row): row is { material: MaterialRow; job: typeof allJobsRows[number] } => Boolean(row.job));
  const normalizedMaterialSearch = materialSearch.trim().toLowerCase();
  const materialJobMatchesSearch = (job: ServiceJob, extras: string[] = []) => {
    if (!normalizedMaterialSearch) return true;
    return [job.jobNumber, job.organization, job.clientName, job.phone, job.email, job.address, job.system, job.issue, job.notes, ...extras]
      .join(' ')
      .toLowerCase()
      .includes(normalizedMaterialSearch);
  };
  const materialJobMatchesTechnician = (job: ServiceJob) => materialTechFilter === 'all' || job.assignee === materialTechFilter;
  const filteredMaterialRows = materialRowsWithJobs.filter(({ material, job }) => {
    const matchesStatus = materialStatusFilter === 'all' || material.status === materialStatusFilter;

    return matchesStatus && materialJobMatchesTechnician(job) && materialJobMatchesSearch(job, [material.name, material.supplier, material.status]);
  });
  const jobsWithoutMaterials = activeJobsRows.filter((job) => !materials.some((material) => material.jobNumber === job.jobNumber));
  const filteredJobsWithoutMaterials = jobsWithoutMaterials.filter((job) => (
    materialStatusFilter === 'all' && materialJobMatchesTechnician(job) && materialJobMatchesSearch(job)
  ));
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
  const normalizeMaterialRows = (jobNumber: string, rows: MaterialRow[]) => rows
      .filter((row) => row.name.trim() || row.supplier.trim())
      .map((row) => ({
        ...row,
        jobNumber,
        name: row.name.trim(),
        supplier: row.supplier.trim(),
        quantity: Math.max(1, Number(row.quantity) || 1),
        price: Math.max(0, Number(row.price) || 0),
      }));

  const saveMaterialDraftRows = () => {
    if (stopCompanyWrite('materials', 'saving materials')) return;
    if (!editingMaterialsJobNumber) return;
    const jobNumber = editingMaterialsJobNumber;
    const cleanRows = normalizeMaterialRows(jobNumber, materialDraftRows);

    setMaterials((rows) => [
      ...rows.filter((row) => row.jobNumber !== jobNumber),
      ...cleanRows,
    ]);
    setEditingMaterialsJobNumber('');
    setMaterialDraftRows([]);

    if (!selectedCompanyId) return;
    setJobsStatus('Saving materials...');
    saveJobMaterialsToBackend(selectedCompanyId, jobNumber, cleanRows)
      .then((savedMaterials) => {
        setMaterials(savedMaterials);
        setJobsStatus('Materials saved.');
      })
      .catch((error) => {
        setJobsStatus(error instanceof Error ? error.message : 'Materials could not be saved.');
      });
  };
  const saveJobMaterials = (jobNumber: string, rows: MaterialRow[]) => {
    if (stopCompanyWrite('materials', 'saving materials')) return Promise.resolve();

    const cleanRows = normalizeMaterialRows(jobNumber, rows);

    setMaterials((currentRows) => [
      ...currentRows.filter((row) => row.jobNumber !== jobNumber),
      ...cleanRows,
    ]);

    if (!selectedCompanyId) return Promise.resolve();
    setJobsStatus('Saving materials...');
    return saveJobMaterialsToBackend(selectedCompanyId, jobNumber, cleanRows)
      .then((savedMaterials) => {
        setMaterials(savedMaterials);
        setJobsStatus('Materials saved.');
      })
      .catch((error) => {
        setJobsStatus(error instanceof Error ? error.message : 'Materials could not be saved.');
        throw error;
      });
  };
  const payrollItemByJobId = new globalThis.Map(payrollItems.map((item) => [item.jobId, item]));
  const makePayrollItemInput = (job: ServiceJob & { paidScf: number; paidLabor: number; materialsCost: number; salaryBase: number; salary: number; warnings: string[]; payrollArchived?: boolean }, paidAt?: string | null): PayrollItemInput | null => {
    const technicianId = findTechnicianId(profile, job.assignee);
    if (!job.id || !technicianId) return null;

    return {
      jobId: job.id,
      technicianId,
      collectedCents: dollarsToCents(job.paidScf + job.paidLabor),
      materialsCents: dollarsToCents(job.materialsCost),
      payrollBaseCents: dollarsToCents(job.salaryBase),
      salaryCents: dollarsToCents(job.salary),
      reviewNote: job.warnings.join(' - '),
      selectedForPayment: false,
      paidAt: paidAt ?? payrollItemByJobId.get(job.id)?.paidAt ?? null,
      archivedAt: job.payrollArchived ? new Date().toISOString() : null,
    };
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
    const paidAt = payrollItemByJobId.get(job.id)?.paidAt?.slice(0, 10) ?? salaryPaidJobs[job.jobNumber] ?? '';
    const paid = Boolean(paidAt);
    const warrantyEndTime = new Date(job.createdAt).getTime() + profile.warrantyDays * 24 * 60 * 60 * 1000;
    const warrantyPassed = warrantyEndTime <= Date.now();
    const payrollArchived = paid && warrantyPassed;
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
      paidAt,
      warrantyPassed,
      payrollArchived,
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
  const financeSummary = financeBaseRows.reduce(
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
  const toggleSalaryPaid = (jobNumber: string) => {
    if (stopCompanyWrite('finances', 'updating payroll')) return;

    setSalaryPaidJobs((jobs) => {
      if (jobs[jobNumber]) {
        const nextJobs = { ...jobs };
        delete nextJobs[jobNumber];
        return nextJobs;
      }

      return { ...jobs, [jobNumber]: new Date().toISOString().slice(0, 10) };
    });
  };
  const markSalaryJobsPaid = (jobNumbers: string[]) => {
    if (stopCompanyWrite('finances', 'updating payroll')) return;
    if (!jobNumbers.length) return;
    const paidAt = new Date().toISOString().slice(0, 10);
    setSalaryPaidJobs((jobs) => ({
      ...jobs,
      ...Object.fromEntries(jobNumbers.map((jobNumber) => [jobNumber, paidAt])),
    }));
  };
  const paymentMethodOptions = profile.acceptedPayments.map((method) => ({
    value: method,
    label: paymentMethodLabels[method],
  }));
  const currentPortalUser = {
    name: signedInUser?.name ?? selectedCompany.ownerName,
    role: signedInUser?.role ?? 'Admin' as const,
  };
  const updateInlineJobDraft = (jobId: string, patch: Partial<ServiceJob>) => {
    setInlineJobDrafts((drafts) => ({
      ...drafts,
      [jobId]: {
        ...drafts[jobId],
        ...patch,
      },
    }));
  };
  const handleSaveJob = (updatedJob: JobCardData, openJobAfterSave = true) => {
    if (stopCompanyWrite('jobs', 'saving jobs')) return;

    setJobs((currentJobs) => {
      const nextJobs = currentJobs.map((job) => (job.id === updatedJob.id ? updatedJob : job));
      return nextJobs;
    });
    if (openJobAfterSave) {
      setOpenedJob(updatedJob);
    } else {
      setOpenedJob((currentJob) => (currentJob?.id === updatedJob.id ? updatedJob : currentJob));
    }
    setJobsStatus('Saving job...');

    saveServiceJob(selectedCompany.id, updatedJob)
      .then((savedJob) => {
        setJobs((currentJobs) => currentJobs.map((job) => (job.id === updatedJob.id || job.jobNumber === savedJob.jobNumber ? savedJob : job)));
        if (openJobAfterSave) {
          setOpenedJob(savedJob);
        } else {
          setOpenedJob((currentJob) => (currentJob?.id === savedJob.id ? savedJob : currentJob));
        }
        setJobsStatus('Job saved.');
      })
      .catch((error) => {
        setJobsStatus(error instanceof Error ? error.message : 'Job could not be saved.');
      });
  };
  const handleSaveInlineJob = (job: ServiceJob) => {
    const draft = inlineJobDrafts[job.id] ?? {};
    const updatedJob = {
      ...job,
      ...draft,
      assignee: draft.technician ?? job.technician,
    };

    handleSaveJob(updatedJob, false);
    setInlineJobDrafts((drafts) => {
      const nextDrafts = { ...drafts };
      delete nextDrafts[job.id];
      return nextDrafts;
    });
  };
  const handleCreateJob = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (stopCompanyWrite('jobs', 'creating jobs')) return;

    const form = new FormData(event.currentTarget);
    const rawJobNumber = String(form.get('jobNumber') ?? '').trim();
    const technicianName = String(form.get('technician') ?? '').trim();
    const jobForm: NewServiceJobForm = {
      jobNumber: rawJobNumber && rawJobNumber.toLowerCase() !== 'automatic' ? rawJobNumber : generatedJobNumber,
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
      return nextJobs;
    });
    setOpenedJob(createdJob);
    setJobsStatus('Creating job...');

    saveServiceJob(selectedCompany.id, createdJob)
      .then((savedJob) => {
        setJobs((currentJobs) => currentJobs.map((job) => (job.id === createdJob.id ? savedJob : job)));
        setOpenedJob(savedJob);
        setJobsStatus('Job created.');
      })
      .catch((error) => {
        setJobs((currentJobs) => currentJobs.filter((job) => job.id !== createdJob.id));
        setOpenedJob(null);
        setJobsStatus(error instanceof Error ? error.message : 'Job could not be created.');
      });
  };
  const handleCreateInvoice = async (job: JobCardData, invoiceMaterials: MaterialRow[], amount: number, documentType: JobDocumentType) => {
    if (stopCompanyWrite('finances', 'creating invoices')) {
      throw new Error('Finance access is read-only.');
    }

    const invoice = await createJobInvoice(selectedCompany.id, job, invoiceMaterials, amount, documentType);
    setJobs((currentJobs) => currentJobs.map((currentJob) => (
      currentJob.id === job.id
        ? { ...currentJob, invoices: [invoice, ...(currentJob.invoices ?? [])] }
        : currentJob
    )));
    setOpenedJob((currentJob) => currentJob?.id === job.id ? { ...currentJob, invoices: [invoice, ...(currentJob.invoices ?? [])] } : currentJob);
    return invoice;
  };
  const handleDeleteInvoice = async (job: JobCardData, invoiceId: string) => {
    if (stopCompanyWrite('finances', 'deleting invoices')) {
      throw new Error('Finance access is read-only.');
    }

    await deleteJobInvoice(selectedCompany.id, job.id, invoiceId);
    const removeInvoice = (currentJob: ServiceJob) => (
      currentJob.id === job.id
        ? { ...currentJob, invoices: (currentJob.invoices ?? []).filter((invoice) => invoice.id !== invoiceId) }
        : currentJob
    );

    setJobs((currentJobs) => currentJobs.map(removeInvoice));
    setOpenedJob((currentJob) => (currentJob?.id === job.id ? removeInvoice(currentJob) : currentJob));
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
    if (stopCompanyWrite('knowledge', 'adding library documents')) return;
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
  const handleOpenLibraryDocument = (document: LibraryDocument) => {
    if (document.storageBucket && document.storagePath) {
      setLibraryStatus(`${document.title} is stored in ${document.storageBucket}/${document.storagePath}.`);
      return;
    }

    setLibraryStatus(document.fileName ? `Open ${document.fileName} from connected storage.` : 'No file is attached to this document yet.');
  };
  const handleDeleteLibraryDocument = (document: LibraryDocument) => {
    if (stopCompanyWrite('knowledge', 'deleting library documents')) return;

    setLibraryDocuments((documents) => documents.filter((item) => item.id !== document.id));
    setLibraryStatus(`${document.title} removed from the library.`);
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
    if (stopCompanyWrite('tasks', 'creating tasks')) return;
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
    if (stopCompanyWrite('tasks', 'updating tasks')) return;

    if (task.source === 'Auto') {
      setCompletedAutoTaskIds((ids) => (status === 'Done' ? Array.from(new Set([...ids, task.id])) : ids.filter((id) => id !== task.id)));
      return;
    }

    setManualTasks((tasks) => tasks.map((row) => (row.id === task.id ? { ...row, status } : row)));
  };
  const calendarAnchor = parseLocalDate(calendarAnchorDate);
  const calendarWeekStart = startOfWeek(calendarAnchor);
  const calendarDays = Array.from({ length: 7 }, (_, index) => formatCalendarDay(addDays(calendarWeekStart, index)));
  const calendarMonthStart = new Date(calendarAnchor.getFullYear(), calendarAnchor.getMonth(), 1, 12);
  const calendarMonthGridStart = startOfWeek(calendarMonthStart);
  const calendarMonthDays = Array.from({ length: 42 }, (_, index) => formatCalendarDay(addDays(calendarMonthGridStart, index)));
  const allCalendarDays = Array.from(new globalThis.Map([...calendarMonthDays, ...calendarDays, formatCalendarDay(calendarAnchor)].map((day) => [day.key, day])).values());
  const calendarRangeTitle =
    calendarView === 'month'
      ? calendarAnchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : calendarView === 'day'
        ? calendarAnchor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : `${calendarDays[0].date} - ${calendarDays[6].date}, ${calendarDays[6].isoDate.slice(0, 4)}`;
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
  const calendarAssignmentFromJob = (job: ServiceJob) => {
    if (!job.appointment) return undefined;
    const appointmentDate = new Date(job.appointment);
    if (Number.isNaN(appointmentDate.getTime())) return undefined;
    const slot = calendarDropSlots.find((dropSlot) => dropSlot.hour === appointmentDate.getHours() && dropSlot.minute === appointmentDate.getMinutes());

    return {
      assignee: job.assignee,
      dayKey: toLocalIsoDate(appointmentDate),
      time: slot?.key ?? `${appointmentDate.getHours()}:00`,
      durationMinutes: job.calendarDurationMinutes ?? 120,
    };
  };
  const calendarJobs = activeJobsRows.map((job) => {
    const assignment = calendarAssignments[job.jobNumber] ?? calendarAssignmentFromJob(job);
    const appointmentDay = allCalendarDays.find((day) => day.key === assignment?.dayKey);
    const appointmentSlot = calendarDropSlots.find((slot) => slot.key === assignment?.time);
    const appointment = appointmentDay && appointmentSlot ? `${appointmentDay.isoDate}T${String(appointmentSlot.hour).padStart(2, '0')}:${String(appointmentSlot.minute).padStart(2, '0')}` : job.appointment;

    return {
      ...job,
      technician: assignment?.assignee ?? job.technician,
      assignee: assignment?.assignee ?? job.assignee,
      dayKey: assignment?.dayKey,
      time: assignment?.time,
      durationMinutes: assignment?.durationMinutes ?? job.calendarDurationMinutes ?? 120,
      appointment,
    };
  });
  const scheduledJobs = calendarJobs.filter((job) => job.dayKey && job.time && job.assignee !== 'No technician');
  const unassignedCalendarJobs = calendarJobs.filter((job) => !job.dayKey || job.assignee === 'No technician');
  const visibleCalendarJobs = scheduledJobs.filter((job) => activeCalendarTech === 'all' || job.assignee === activeCalendarTech);
  const visibleCalendarDays = calendarView === 'day' ? [formatCalendarDay(calendarAnchor)] : calendarDays;
  const unreadEmailCount = emailMessages.filter((message) => message.unread).length;
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
    { page: 'portal', label: 'Portal', icon: <Rocket size={16} /> },
    { page: 'onboarding', label: 'Onboarding', icon: <Rocket size={16} /> },
  ];
  const visibleClientNavItems = clientNavItems.filter((item) => canViewPage(item.page as CompanyPortalAccessPage));
  const renderedClientPage = canViewPage(clientPage as CompanyPortalAccessPage) ? clientPage : visibleClientNavItems[0]?.page ?? 'portal';
  const activePageAccessLevel = accessLevelForPage(renderedClientPage as CompanyPortalAccessPage);
  const activePageReadOnly = !canWritePage(renderedClientPage as CompanyPortalAccessPage);

  function handleRequestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stopCompanyWrite('portal', 'sending support requests')) return;

    setRequestTouched(true);
    if (!request.subject.trim() || !request.message.trim()) return;

    onCreateRequest(request);
    setRequestTouched(false);
    setRequest({
      kind: 'change',
      priority: 'normal',
      subject: '',
      message: '',
    });
  }

  function handleSupportReply(event: FormEvent<HTMLFormElement>, ticketId: string) {
    event.preventDefault();
    const body = supportReplyDrafts[ticketId]?.trim() ?? '';
    if (!body || !onReplyToTicket) return;

    onReplyToTicket(ticketId, body);
    setSupportReplyDrafts((drafts) => ({ ...drafts, [ticketId]: '' }));
  }

  function updateProfile(updates: Partial<CompanyOnboardingProfile>) {
    const nextProfile = { ...profile, ...updates };
    onUpdateOnboardingProfile(nextProfile);
    persistOnboardingToBackend(nextProfile);
  }

  function connectSubscriptionBilling() {
    setBillingStatus('Opening Square card form...');
    updateProfile({ subscriptionPaymentStatus: 'pending' });
    setBillingModalOpen(true);
  }

  function handleLogoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener('load', () => {
      updateProfile({ logoUrl: String(reader.result ?? '') });
    });
    reader.readAsDataURL(file);

    uploadCompanyLogo(activeCompany.id, file)
      .then((logoUrl) => {
        updateProfile({ logoUrl });
      })
      .catch((error) => {
        console.error('Failed to upload company logo', error);
      });
  }

  function makeAccessPassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%';
    const values = new Uint32Array(12);
    crypto.getRandomValues(values);

    return Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
  }

  function generateOwnerPassword() {
    const password = makeAccessPassword();
    setOwnerAccessPassword(password);
    setOwnerAccessPasswordConfirm(password);
    setOwnerAccessStatus('Generated. Save it to apply the new owner password.');
  }

  async function saveOwnerPassword() {
    const ownerEmail = signedInUser?.email || activeCompany.ownerEmail;
    const password = ownerAccessPassword.trim();

    if (!ownerEmail.trim()) {
      setOwnerAccessStatus('Owner email is required.');
      return;
    }

    if (password.length < 6) {
      setOwnerAccessStatus('Password must be at least 6 characters.');
      return;
    }

    if (password !== ownerAccessPasswordConfirm.trim()) {
      setOwnerAccessStatus('Passwords do not match.');
      return;
    }

    setOwnerAccessStatus('Saving owner password...');

    try {
      await saveUserAccess({
        email: ownerEmail,
        password,
        name: signedInUser?.name || activeCompany.ownerName,
        companyId: activeCompany.id,
        role: 'admin',
        mode: 'reset',
      });
      setOwnerAccessPassword('');
      setOwnerAccessPasswordConfirm('');
      setOwnerAccessStatus('Owner password updated. Use the new password at the next sign in.');
    } catch (error) {
      setOwnerAccessStatus(error instanceof Error ? error.message : 'Failed to update owner password.');
    }
  }

  function handleTechnicianSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!technicianForm.name.trim() || !technicianForm.email.trim()) return;

    updateProfile({
      technicians: [createCompanyTechnician(technicianForm), ...profile.technicians],
    });
    setTechnicianForm(emptyTechnicianForm);
  }

  async function sendTechnicianAccess(technicianId: string, mode: AccessActionMode, password: string) {
    const technician = profile.technicians.find((item) => item.id === technicianId);
    if (!technician) return;

    if (!technician.email.trim()) {
      setTechnicianAccessStatusById((statuses) => ({ ...statuses, [technicianId]: 'Technician email is required.' }));
      return;
    }

    if (password.trim().length < 6) {
      setTechnicianAccessStatusById((statuses) => ({ ...statuses, [technicianId]: 'Password must be at least 6 characters.' }));
      return;
    }

    setTechnicianAccessStatusById((statuses) => ({ ...statuses, [technicianId]: 'Saving access...' }));

    try {
      const result = await saveUserAccess({
        email: technician.email,
        password,
        name: technician.name,
        companyId: activeCompany.id,
        role: technician.role,
        mode,
      });
      const message =
        result.action === 'access_created'
          ? 'Access created. Share this email and password with the technician.'
          : result.action === 'access_updated'
            ? 'Access already existed. Password was updated.'
            : 'Password was reset.';
      setTechnicianAccessStatusById((statuses) => ({ ...statuses, [technicianId]: message }));

      if (mode === 'create' && technician.status !== 'disabled') {
        updateProfile({
          technicians: profile.technicians.map((item) =>
            item.id === technicianId ? { ...item, status: 'active' } : item,
          ),
        });
      }
    } catch (error) {
      setTechnicianAccessStatusById((statuses) => ({
        ...statuses,
        [technicianId]: error instanceof Error ? error.message : 'Access email failed.',
      }));
    }
  }

  function handleJobTypeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = jobTypeForm.name.trim();
    if (!name) return;
    const jobNumberPrefix =
      jobTypeForm.jobNumberPrefix.trim() ||
      name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) ||
      'JOB';

    updateProfile({
      jobTypes: [createCompanyJobType({ ...jobTypeForm, name, jobNumberPrefix }), ...profile.jobTypes],
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
    const removedJobType = profile.jobTypes.find((jobType) => jobType.id === jobTypeId);
    const jobTypes = profile.jobTypes.filter((jobType) => jobType.id !== jobTypeId);
    updateProfile({ jobTypes });
    deleteJobTypeFromBackend(jobTypeId, activeCompany.id, removedJobType?.name).catch((error) => {
      console.error('Failed to delete job type from backend', error);
    });

    if (selectedJobTypeId === jobTypeId) {
      setSelectedJobTypeId('');
    }
  }

  function handleCalendarDragStart(event: DragEvent<HTMLElement>, jobNumber: string) {
    setDraggingJobNumber(jobNumber);
    event.dataTransfer.setData('text/plain', jobNumber);
    event.dataTransfer.effectAllowed = 'move';
  }

  function moveCalendar(direction: -1 | 1) {
    const anchor = parseLocalDate(calendarAnchorDate);
    const nextDate =
      calendarView === 'month'
        ? addMonths(anchor, direction)
        : addDays(anchor, direction * (calendarView === 'week' ? 7 : 1));

    setCalendarAnchorDate(toLocalIsoDate(nextDate));
  }

  function showTodayInCalendar() {
    setCalendarAnchorDate(toLocalIsoDate(new Date()));
  }

  function calendarAppointmentFromParts(dayKey: string, slotKey: string) {
    const appointmentSlot = calendarDropSlots.find((slot) => slot.key === slotKey);
    if (!appointmentSlot) return '';
    return `${dayKey}T${String(appointmentSlot.hour).padStart(2, '0')}:${String(appointmentSlot.minute).padStart(2, '0')}`;
  }

  function persistCalendarAssignment(jobNumber: string, assignee: string, dayKey: string, slotKey: string, durationMinutes: number) {
    if (stopCompanyWrite('calendar', 'saving calendar appointments')) return;

    const baseJob = jobs.find((job) => job.jobNumber === jobNumber);
    const appointment = calendarAppointmentFromParts(dayKey, slotKey);
    if (!baseJob || !appointment) return;

    const nextJob = {
      ...baseJob,
      technician: assignee,
      assignee,
      appointment,
      calendarDurationMinutes: durationMinutes,
    };

    setJobs((currentJobs) => currentJobs.map((job) => (job.id === nextJob.id ? nextJob : job)));
    setOpenedJob((job) => job?.id === nextJob.id ? { ...job, ...nextJob } : job);
    setJobsStatus('Saving calendar appointment...');

    saveJobAppointment(activeCompany.id, nextJob, appointment, durationMinutes)
      .then((savedJob) => {
        setJobs((currentJobs) => currentJobs.map((job) => (job.id === savedJob.id ? savedJob : job)));
        setOpenedJob((job) => job?.id === savedJob.id ? { ...job, ...savedJob } : job);
        setCalendarAssignments((assignments) => ({
          ...assignments,
          [savedJob.jobNumber]: {
            assignee: savedJob.assignee,
            dayKey,
            time: slotKey,
            durationMinutes: savedJob.calendarDurationMinutes ?? durationMinutes,
          },
        }));
        setJobsStatus('Calendar appointment saved.');
      })
      .catch((error) => {
        setJobsStatus(error instanceof Error ? error.message : 'Calendar appointment could not be saved.');
      });
  }

  function handleCalendarDrop(event: DragEvent<HTMLDivElement>, dayKey: string, slotKey: string) {
    event.preventDefault();
    if (stopCompanyWrite('calendar', 'moving calendar appointments')) return;

    const jobNumber = event.dataTransfer.getData('text/plain') || draggingJobNumber;
    if (!jobNumber) return;
    const movedJob = calendarJobs.find((job) => job.jobNumber === jobNumber);
    const assignee = activeCalendarTech !== 'all' ? activeCalendarTech : movedJob?.assignee;
    if (!assignee || assignee === 'No technician') return;
    const appointment = calendarAppointmentFromParts(dayKey, slotKey);
    const durationMinutes = calendarAssignments[jobNumber]?.durationMinutes ?? movedJob?.durationMinutes ?? 120;

    setCalendarAssignments((assignments) => ({
      ...assignments,
      [jobNumber]: {
        assignee,
        dayKey,
        time: slotKey,
        durationMinutes,
      },
    }));
    setOpenedJob((job) => job?.jobNumber === jobNumber ? { ...job, technician: assignee, appointment } : job);
    persistCalendarAssignment(jobNumber, assignee, dayKey, slotKey, durationMinutes);
    setDraggingJobNumber('');
  }

  function handleCalendarMonthDrop(event: DragEvent<HTMLDivElement>, dayKey: string) {
    event.preventDefault();
    if (stopCompanyWrite('calendar', 'moving calendar appointments')) return;

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
    if (stopCompanyWrite('calendar', 'saving calendar appointments')) return;
    if (!monthDropRequest) return;
    const appointment = calendarAppointmentFromParts(monthDropRequest.dayKey, monthDropRequest.time);

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
    persistCalendarAssignment(monthDropRequest.jobNumber, monthDropRequest.assignee, monthDropRequest.dayKey, monthDropRequest.time, monthDropRequest.durationMinutes);
    setMonthDropRequest(null);
  }

  function handleCalendarResizeStart(
    event: PointerEvent<HTMLSpanElement>,
    job: { jobNumber: string; assignee: string; dayKey?: string; time?: string; durationMinutes: number },
    edge: 'start' | 'end',
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (stopCompanyWrite('calendar', 'resizing calendar appointments')) return;

    if (!job.dayKey || !job.time) return;
    const startSlotIndex = calendarDropSlots.findIndex((slot) => slot.key === job.time);
    if (startSlotIndex < 0) return;

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
      assignee: job.assignee,
      dayKey: job.dayKey,
      time: job.time,
      edge,
      startY: event.clientY,
      startDuration: job.durationMinutes,
      startSlotIndex,
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
          {visibleClientNavItems.map((item) => (
            <button
              className={`client-nav-item ${renderedClientPage === item.page ? 'active' : ''} ${item.adminOnly ? 'admin' : ''}`}
              type="button"
              key={item.page}
              onClick={() => {
                setOpenedJob(null);
                setClientPage(item.page);
              }}
            >
              {item.icon}
              {item.label}
              {item.page === 'email' && unreadEmailCount > 0 ? (
                <span className="client-nav-badge" aria-label={`${unreadEmailCount} unread emails`}>
                  {unreadEmailCount > 99 ? '99+' : unreadEmailCount}
                </span>
              ) : null}
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
        {jobsStatus ? <p className="access-status portal-status">{jobsStatus}</p> : null}
        {activePageReadOnly ? (
          <div className={'company-access-banner ' + activePageAccessLevel}>
            <strong>{visibleClientNavItems.find((item) => item.page === renderedClientPage)?.label ?? 'This page'} is {accessLevelLabels[activePageAccessLevel].toLowerCase()}</strong>
            <span>Owner access controls are active for this company.</span>
          </div>
        ) : null}
        {renderedClientPage === 'jobs' ? (
          <JobsPage
            openedJob={openedJob}
            profile={profile}
            paymentMethodOptions={paymentMethodOptions}
            materials={materials}
            currentPortalUser={currentPortalUser}
            onCloseJob={() => setOpenedJob(null)}
            onSaveJob={handleSaveJob}
            onSaveMaterials={saveJobMaterials}
            onCreateInvoice={handleCreateInvoice}
            onDeleteInvoice={handleDeleteInvoice}
            onComposeEmail={openEmailCompose}
            onCreateJob={handleCreateJob}
            selectedJobPrefix={selectedJobPrefix}
            nextJobNumber={nextJobNumber}
            selectedJobType={selectedJobType}
            selectedJobTypeId={selectedJobTypeId}
            onSelectedJobTypeIdChange={setSelectedJobTypeId}
          />
        ) : renderedClientPage === 'allJobs' ? (
          <AllJobsPage
            openedJob={openedJob}
            profile={profile}
            paymentMethodOptions={paymentMethodOptions}
            materials={materials}
            currentPortalUser={currentPortalUser}
            onCloseJob={() => setOpenedJob(null)}
            onSaveJob={handleSaveJob}
            onSaveMaterials={saveJobMaterials}
            onCreateInvoice={handleCreateInvoice}
            onDeleteInvoice={handleDeleteInvoice}
            onComposeEmail={openEmailCompose}
            jobStatusFilters={jobStatusFilters}
            allJobsGroups={allJobsGroups}
            allJobsVisibility={allJobsVisibility}
            onAllJobsVisibilityChange={setAllJobsVisibility}
            activeJobsCount={activeJobsRows.length}
            paidJobsCount={paidJobsRows.length}
            totalJobsCount={allJobsRows.length}
            inlineJobDrafts={inlineJobDrafts}
            onUpdateInlineJobDraft={updateInlineJobDraft}
            onSaveInlineJob={handleSaveInlineJob}
            onOpenJob={setOpenedJob}
          />
        ) : renderedClientPage === 'calendar' ? (
          <CalendarPage
            openedJob={openedJob}
            profile={profile}
            paymentMethodOptions={paymentMethodOptions}
            materials={materials}
            currentPortalUser={currentPortalUser}
            onCloseJob={() => setOpenedJob(null)}
            onSaveJob={handleSaveJob}
            onSaveMaterials={saveJobMaterials}
            onCreateInvoice={handleCreateInvoice}
            onDeleteInvoice={handleDeleteInvoice}
            onComposeEmail={openEmailCompose}
            calendarRangeTitle={calendarRangeTitle}
            onMoveCalendar={moveCalendar}
            onShowToday={showTodayInCalendar}
            activeCalendarTech={activeCalendarTech}
            onActiveCalendarTechChange={setActiveCalendarTech}
            calendarView={calendarView}
            onCalendarViewChange={setCalendarView}
            unassignedCalendarJobs={unassignedCalendarJobs}
            onCalendarDragStart={handleCalendarDragStart}
            onOpenJob={setOpenedJob}
            calendarMonthDays={calendarMonthDays}
            visibleCalendarJobs={visibleCalendarJobs}
            calendarAnchor={calendarAnchor}
            onCalendarMonthDrop={handleCalendarMonthDrop}
            visibleCalendarDays={visibleCalendarDays}
            calendarSlots={calendarSlots}
            calendarDropSlots={calendarDropSlots}
            onCalendarDrop={handleCalendarDrop}
            onCalendarResizeStart={handleCalendarResizeStart}
            jobStatusFilters={jobStatusFilters}
            monthDropRequest={monthDropRequest}
            allCalendarDays={allCalendarDays}
            onMonthDropRequestChange={setMonthDropRequest}
            onConfirmCalendarMonthDrop={confirmCalendarMonthDrop}
          />
        ) : renderedClientPage === 'materials' ? (
          <MaterialsPage
            materials={materials}
            jobsWithoutMaterials={filteredJobsWithoutMaterials}
            materialsTotal={materialsTotal}
            materialStatusFilter={materialStatusFilter}
            onMaterialStatusFilterChange={setMaterialStatusFilter}
            materialStatuses={materialStatuses}
            materialTechFilter={materialTechFilter}
            onMaterialTechFilterChange={setMaterialTechFilter}
            profile={profile}
            materialSearch={materialSearch}
            onMaterialSearchChange={setMaterialSearch}
            onResetFilters={() => {
              setMaterialStatusFilter('all');
              setMaterialTechFilter('all');
              setMaterialSearch('');
            }}
            onOpenMaterialEditor={openMaterialEditor}
            onOpenJob={setOpenedJob}
            filteredMaterialRows={filteredMaterialRows}
            selectedMaterialsJob={selectedMaterialsJob}
            onCloseMaterialEditor={() => setEditingMaterialsJobNumber('')}
            materialDraftRows={materialDraftRows}
            onUpdateMaterialDraft={updateMaterialDraft}
            onRemoveMaterialDraftRow={removeMaterialDraftRow}
            onAddMaterialDraftRow={addMaterialDraftRow}
            onSaveMaterialDraftRows={saveMaterialDraftRows}
          />
        ) : renderedClientPage === 'tasks' ? (
          <TasksPage
            openedJob={openedJob}
            profile={profile}
            paymentMethodOptions={paymentMethodOptions}
            materials={materials}
            currentPortalUser={currentPortalUser}
            onCloseJob={() => setOpenedJob(null)}
            onSaveJob={handleSaveJob}
            onSaveMaterials={saveJobMaterials}
            onCreateInvoice={handleCreateInvoice}
            onDeleteInvoice={handleDeleteInvoice}
            onComposeEmail={openEmailCompose}
            openTaskCount={openTaskCount}
            autoTaskCount={autoTaskCount}
            urgentTaskCount={urgentTaskCount}
            taskForm={taskForm}
            onTaskFormChange={setTaskForm}
            onCreateManualTask={createManualTask}
            allJobsRows={allJobsRows}
            taskAssignees={taskAssignees}
            taskStatusFilter={taskStatusFilter}
            onTaskStatusFilterChange={setTaskStatusFilter}
            taskOwnerFilter={taskOwnerFilter}
            onTaskOwnerFilterChange={setTaskOwnerFilter}
            taskSearch={taskSearch}
            onTaskSearchChange={setTaskSearch}
            onResetFilters={() => {
              setTaskStatusFilter('all');
              setTaskOwnerFilter('all');
              setTaskSearch('');
            }}
            filteredTaskRows={filteredTaskRows}
            jobMap={materialJobMap}
            onOpenJob={setOpenedJob}
            onUpdateTaskStatus={updateTaskStatus}
          />
        ) : renderedClientPage === 'email' ? (
          <EmailPage
            emailConnection={emailConnection}
            emailMessages={emailMessages}
            emailTemplates={initialEmailTemplates}
            emailProviderLabels={emailProviderLabels}
            onOpenOnboarding={() => setClientPage('onboarding')}
            onStartMailboxConnection={startMailboxConnector}
            onLoadMoreMailbox={loadMoreMailboxMessages}
            mailboxSyncing={mailboxSyncing}
            mailboxConnectStatus={mailboxConnectStatus}
            emailFolder={emailFolder}
            onEmailFolderChange={setEmailFolder}
            emailSearch={emailSearch}
            onEmailSearchChange={setEmailSearch}
            visibleEmailMessages={visibleEmailMessages}
            onApplyEmailTemplate={applyEmailTemplate}
            jobMap={materialJobMap}
            onEmailComposeChange={setEmailCompose}
            emailCompose={emailCompose}
            allJobsRows={allJobsRows}
            companySignature={companyEmailSignature}
            companyPaymentBlock={companyPaymentBlock}
            composeRequestId={emailComposeRequestId}
            composeAttachmentRequest={emailComposeAttachments}
            onSendEmailDraft={sendEmailDraft}
          />
        ) : renderedClientPage === 'map' ? (
          <MapPage
            filteredTechnicianLocations={filteredTechnicianLocations}
            mapTechFilter={mapTechFilter}
            onMapTechFilterChange={setMapTechFilter}
            mapStatusFilter={mapStatusFilter}
            onMapStatusFilterChange={setMapStatusFilter}
            mapSearch={mapSearch}
            onMapSearchChange={setMapSearch}
            onResetFilters={() => {
              setMapTechFilter('all');
              setMapStatusFilter('all');
              setMapSearch('');
            }}
            profile={profile}
          />
        ) : renderedClientPage === 'finances' ? (
          <FinancePage
            openedJob={openedJob}
            profile={profile}
            paymentMethodOptions={paymentMethodOptions}
            materials={materials}
            currentPortalUser={currentPortalUser}
            onCloseJob={() => setOpenedJob(null)}
            onSaveJob={handleSaveJob}
            onSaveMaterials={saveJobMaterials}
            onCreateInvoice={handleCreateInvoice}
            onDeleteInvoice={handleDeleteInvoice}
            onComposeEmail={openEmailCompose}
            financeSummary={financeSummary}
            financePeriod={financePeriod}
            onFinancePeriodChange={setFinancePeriod}
            financeTechFilter={financeTechFilter}
            onFinanceTechFilterChange={setFinanceTechFilter}
            payrollRules={payrollRules}
            onPayrollRulesChange={setPayrollRules}
            technicianPayroll={technicianPayroll}
            financeBaseRows={financeBaseRows}
            onOpenJob={setOpenedJob}
            onToggleSalaryPaid={toggleSalaryPaid}
            onMarkSalaryJobsPaid={markSalaryJobsPaid}
          />
        ) : renderedClientPage === 'knowledge' ? (
          <KnowledgePage
            libraryDocuments={libraryDocuments}
            librarySystems={librarySystems}
            filteredLibraryDocuments={filteredLibraryDocuments}
            libraryDraft={libraryDraft}
            onLibraryDraftChange={setLibraryDraft}
            libraryCategories={libraryCategories}
            libraryFormats={libraryFormats}
            librarySearch={librarySearch}
            onLibrarySearchChange={setLibrarySearch}
            libraryCategoryFilter={libraryCategoryFilter}
            onLibraryCategoryFilterChange={setLibraryCategoryFilter}
            librarySystemFilter={librarySystemFilter}
            onLibrarySystemFilterChange={setLibrarySystemFilter}
            libraryFormatFilter={libraryFormatFilter}
            onLibraryFormatFilterChange={setLibraryFormatFilter}
            onLibraryFileChange={handleLibraryFileChange}
            onAddLibraryDocument={addLibraryDocument}
            onOpenLibraryDocument={handleOpenLibraryDocument}
            onDeleteLibraryDocument={handleDeleteLibraryDocument}
          />
        ) : renderedClientPage === 'portal' ? (
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
              <MetricCard icon={<Building2 size={20} />} label="Account" value={selectedCompany.status} detail="Company portal" />
              <MetricCard icon={<CreditCard size={20} />} label="Plan" value={selectedCompany.plan} detail={billingLabels[selectedCompany.billingStatus]} />
              <MetricCard icon={<ClipboardList size={20} />} label="Jobs" value={selectedCompany.usage.jobsThisMonth.toString()} detail="This month" />
              <MetricCard icon={<Inbox size={20} />} label="Support" value={openTickets.length.toString()} detail="Open requests" />
            </section>

            <div className="portal-grid">
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
                    <input className={requestTouched && !request.subject.trim() ? 'field-error' : undefined} value={request.subject} onChange={(event) => setRequest({ ...request, subject: event.target.value })} placeholder="What should be fixed or changed?" />
                  </label>
                  <label>
                    Message
                    <textarea className={requestTouched && !request.message.trim() ? 'field-error' : undefined} value={request.message} onChange={(event) => setRequest({ ...request, message: event.target.value })} placeholder="Describe the issue, request, or missing detail." />
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
        ) : renderedClientPage === 'onboarding' ? (
          <OnboardingPage
            completedSteps={completedSteps}
            profile={profile}
            emailConnection={emailConnection}
            handleLogoUpload={handleLogoUpload}
            updateProfile={updateProfile}
            connectMailbox={connectMailbox}
            emailProviderLabels={emailProviderLabels}
            updateMailbox={updateMailbox}
            togglePaymentMethod={togglePaymentMethod}
            professionTemplates={professionTemplates}
            configuredProfessionNames={configuredProfessionNames}
            addProfessionTemplate={addProfessionTemplate}
            jobTypeForm={jobTypeForm}
            setJobTypeForm={setJobTypeForm}
            handleJobTypeSubmit={handleJobTypeSubmit}
            removeJobType={removeJobType}
            technicianForm={technicianForm}
            setTechnicianForm={setTechnicianForm}
            selectedCompany={selectedCompany}
            handleTechnicianSubmit={handleTechnicianSubmit}
            onSendTechnicianAccess={sendTechnicianAccess}
            technicianAccessStatusById={technicianAccessStatusById}
            technicianAccessPasswordById={technicianAccessPasswordById}
            setTechnicianAccessPasswordById={setTechnicianAccessPasswordById}
            ownerAccessPassword={ownerAccessPassword}
            ownerAccessPasswordConfirm={ownerAccessPasswordConfirm}
            ownerAccessStatus={ownerAccessStatus}
            setOwnerAccessPassword={setOwnerAccessPassword}
            setOwnerAccessPasswordConfirm={setOwnerAccessPasswordConfirm}
            onGenerateOwnerPassword={generateOwnerPassword}
            onSaveOwnerPassword={saveOwnerPassword}
            mailboxConnectStatus={mailboxConnectStatus}
            mailboxOAuthSecretDraft={mailboxOAuthSecretDraft}
            mailboxOAuthStatus={mailboxOAuthStatus}
            mailboxOAuthRedirectUrl={mailboxOAuthRedirectUrl}
            setMailboxOAuthSecretDraft={setMailboxOAuthSecretDraft}
            onCopyMailboxRedirectUrl={copyMailboxRedirectUrl}
            onSaveMailboxOAuth={saveMailboxOAuth}
            onStartMailboxConnection={startMailboxConnector}
            billingStatus={billingStatus}
            onConnectSubscriptionBilling={connectSubscriptionBilling}
          />
        ) : (
          <section className="client-placeholder">
            <div className="client-placeholder-icon">
              {visibleClientNavItems.find((item) => item.page === renderedClientPage)?.icon}
            </div>
            <h1>{visibleClientNavItems.find((item) => item.page === renderedClientPage)?.label}</h1>
            <p>This module is ready to be connected to live company data.</p>
            <div className="client-placeholder-grid">
              <MetricCard icon={<Activity size={20} />} label="Company" value={selectedCompany.name} detail={selectedCompany.market} />
              <MetricCard icon={<Users size={20} />} label="Technicians" value={selectedCompany.technicians.toString()} detail="Assigned team" />
              <MetricCard icon={<Database size={20} />} label="Storage" value={`${selectedCompany.usage.storageGb} GB`} detail="Current usage" />
            </div>
          </section>
        )}
      </main>
      {billingModalOpen ? (
        <SquareBillingModal
          activeCompany={activeCompany}
          profile={profile}
          onClose={() => setBillingModalOpen(false)}
          onConnected={(updates, status) => {
            updateProfile(updates);
            setBillingStatus(status);
          }}
        />
      ) : null}
    </div>
  );
}










