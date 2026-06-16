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
import { CompanyPortal } from './CompanyPortal';
import {
  AccessPage,
  AuditPage,
  BillingPage,
  CompanyDetail,
  CompanyRow,
  DashboardOverview,
  MetricCard,
  MiniStat,
  MonitoringPage,
  StatusPill,
  SupportPanel,
  formatStepStatus,
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
import { saveCompanyCoreToBackend, saveOnboardingProfileToBackend } from './services/onboardingBackend';
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
  stepLabels,
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
  EmailConnection,
  EmailFolder,
  EmailMessage,
  EmailProvider,
  EmailTemplate,
  FinancePeriod,
  FinanceTab,
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
import { googleRouteUrl, money, statusClassName } from './utils/format';

type AuthSession =
  | { kind: 'owner'; userId: string; name: string; email: string }
  | { kind: 'company'; companyId: string; name: string; email: string; role: 'Manager' | 'Admin' | 'Technician' };

const AUTH_STORAGE_KEY = 'servicescope.authSession';
const DEMO_PASSWORD = 'demo123';

function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%';
  const values = new Uint32Array(12);
  crypto.getRandomValues(values);

  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
}

function readAuthSession(): AuthSession | null {
  const saved = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!saved) return null;

  try {
    return JSON.parse(saved) as AuthSession;
  } catch {
    return null;
  }
}

function AuthLogin({
  companies,
  onboardingProfiles,
  platformUsers,
  onLogin,
}: {
  companies: Company[];
  onboardingProfiles: CompanyOnboardingProfile[];
  platformUsers: PlatformUser[];
  onLogin: (session: AuthSession) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password.trim()) {
      setError('Enter your email and password.');
      return;
    }

    const user = platformUsers.find((candidate) => candidate.email.toLowerCase() === normalizedEmail && candidate.status === 'active');
    if (user) {
      if (password !== DEMO_PASSWORD) {
        setError('Invalid owner password.');
        return;
      }
      onLogin({ kind: 'owner', userId: user.id, name: user.name, email: user.email });
      return;
    }

    for (const company of companies) {
      if (company.ownerEmail.toLowerCase() === normalizedEmail) {
        if (password !== company.temporaryPassword) {
          setError('Invalid company temporary password.');
          return;
        }
        onLogin({ kind: 'company', companyId: company.id, name: company.ownerName, email: company.ownerEmail, role: 'Admin' });
        return;
      }

      const profile = onboardingProfiles.find((candidate) => candidate.companyId === company.id);
      const technician = profile?.technicians.find((candidate) => candidate.email.toLowerCase() === normalizedEmail);
      if (technician) {
        if (technician.status === 'disabled') {
          setError('Technician access is disabled.');
          return;
        }
        if (password !== technician.accessPassword) {
          setError('Invalid technician password.');
          return;
        }
        onLogin({
          kind: 'company',
          companyId: company.id,
          name: technician.name,
          email: technician.email,
          role: technician.role === 'manager' ? 'Manager' : 'Technician',
        });
        return;
      }
    }

    setError('User not found. Check owner, company, manager, or technician email.');
  }

  return (
    <main className="company-shell">
      <div className="company-login">
        <form className="company-login-card auth-login-card" onSubmit={submitLogin}>
          <div className="brand-lockup company-brand">
            <div className="brand-mark">
              <ShieldCheck size={22} aria-hidden="true" />
            </div>
            <div>
              <strong>ServiceScope</strong>
              <span>Secure access</span>
            </div>
          </div>

          <div className="login-heading">
            <p className="eyebrow">Login</p>
            <h1>Sign in to ServiceScope</h1>
            <p>Enter your email and ServiceScope opens the right workspace automatically.</p>
          </div>

          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="owner@servicescope.app"
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="demo123"
              autoComplete="current-password"
            />
          </label>

          {error ? <p className="login-error">{error}</p> : null}

          <button className="primary-button" type="submit">
            Sign in
          </button>

          <div className="login-demo-hints">
            <span>Platform owner: owner@servicescope.app / <strong>demo123</strong></span>
            <span>Company owner: use the temporary password created by ServiceScope owner</span>
          </div>
        </form>
      </div>
    </main>
  );
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
        : window.location.hash === '#monitoring'
          ? 'monitoring'
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
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => readAuthSession());
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | CompanyStatus>('all');
  const [auditFilter, setAuditFilter] = useState<'all' | AuditEventCategory>('all');

  const selectedCompany = companies.find((company) => company.id === selectedCompanyId) ?? companies[0];
  const selectedOnboardingProfile = onboardingProfiles.find((profile) => profile.companyId === selectedCompany?.id);
  const selectedTicket = supportTickets.find((ticket) => ticket.id === selectedTicketId) ?? supportTickets[0];
  const openSupportCount = supportTickets.filter((ticket) => ticket.status !== 'resolved').length;

  useEffect(() => {
    if (!authSession) return;

    if (authSession.kind === 'company') {
      const companyExists = companies.some((company) => company.id === authSession.companyId);
      if (!companyExists) {
        setAuthSession(null);
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
        setPage('dashboard');
        window.history.replaceState(null, '', '#login');
        return;
      }

      setSelectedCompanyId(authSession.companyId);
      if (page !== 'portal') {
        setPage('portal');
        window.history.replaceState(null, '', '#portal');
      }
      return;
    }

    if (page === 'portal' || page === 'companyLogin') {
      setPage('dashboard');
      window.history.replaceState(null, '', '#dashboard');
    }
  }, [authSession, companies, page]);

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
    if (!form.name.trim() || !form.ownerEmail.trim() || !form.temporaryPassword.trim()) return;

    const nextCompany = createCompany(form);
    const nextProfile = createDefaultCompanyOnboardingProfile(nextCompany);
    persist([nextCompany, ...companies]);
    const nextProfiles = [
      ...onboardingProfiles,
      nextProfile,
    ];
    setOnboardingProfiles(nextProfiles);
    saveCompanyOnboardingProfiles(nextProfiles);
    saveOnboardingProfileToBackend(nextCompany, nextProfile, null).catch((error) => {
      console.error('Failed to save company onboarding to backend', error);
    });
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
    const nextCompanies = companies.map((company) => (company.id === companyId ? updater(company) : company));
    persist(nextCompanies);
    const nextCompany = nextCompanies.find((company) => company.id === companyId);
    if (nextCompany) {
      saveCompanyCoreToBackend(nextCompany).catch((error) => {
        console.error('Failed to save company to backend', error);
      });
    }
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

  function handleLogin(session: AuthSession) {
    setAuthSession(session);
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    if (session.kind === 'company') {
      setSelectedCompanyId(session.companyId);
      navigate('portal');
      return;
    }

    navigate('dashboard');
  }

  function handleSignOut() {
    setAuthSession(null);
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    window.history.replaceState(null, '', '#login');
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

  if (!authSession) {
    return (
      <AuthLogin
        companies={companies}
        onboardingProfiles={onboardingProfiles}
        platformUsers={platformUsers}
        onLogin={handleLogin}
      />
    );
  }

  if (authSession.kind === 'company') {
    return (
      <main className="company-shell">
        <CompanyPortal
          selectedCompany={selectedCompany}
          onboardingProfile={selectedOnboardingProfile}
          signedInUser={{ name: authSession.name, role: authSession.role }}
          tickets={supportTickets.filter((ticket) => ticket.companyId === selectedCompany?.id)}
          onSignOut={handleSignOut}
          onUpdateOnboardingProfile={(nextProfile) => {
            const nextProfiles = onboardingProfiles.map((profile) =>
              profile.companyId === nextProfile.companyId ? nextProfile : profile,
            );
            setOnboardingProfiles(nextProfiles);
            saveCompanyOnboardingProfiles(nextProfiles);
            recordAudit({
              category: 'tenant',
              action: 'onboarding.profile_updated',
              actor: authSession.name,
              resource: selectedCompany?.name ?? 'Company',
              details: 'Company onboarding profile was updated.',
            });
          }}
          onCreateRequest={createPortalRequest}
        />
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
          <button className={`nav-item ${page === 'monitoring' ? 'active' : ''}`} type="button" onClick={() => navigate('monitoring')}>
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
            <h1>{page === 'support' ? 'Support Inbox' : page === 'companies' ? 'Companies' : page === 'monitoring' ? 'Monitoring' : page === 'billing' ? 'Plans & Billing' : page === 'access' ? 'Access' : page === 'audit' ? 'Audit Log' : 'ServiceScope'}</h1>
          </div>
          <button className="icon-button" type="button" aria-label="Platform settings" title="Platform settings">
            <SlidersHorizontal size={20} aria-hidden="true" />
          </button>
          <button className="secondary-button compact" type="button" onClick={handleSignOut}>
            Sign out
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
                Temporary password
                <div className="password-field-row">
                  <input
                    type="text"
                    value={form.temporaryPassword}
                    onChange={(event) => setForm({ ...form, temporaryPassword: event.target.value })}
                    placeholder="Set temporary password"
                  />
                  <button
                    className="secondary-button compact"
                    type="button"
                    onClick={() => setForm({ ...form, temporaryPassword: generateTemporaryPassword() })}
                  >
                    Generate
                  </button>
                </div>
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

          <section className="panel wide-panel" id="companies-list">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Tenant directory</p>
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
              onSetTemporaryPassword={(temporaryPassword) => {
                updateCompany(selectedCompany.id, (company) => ({ ...company, temporaryPassword, lastSync: 'Access updated' }));
                recordAudit({
                  category: 'access',
                  action: 'company.password_reset',
                  actor: 'ServiceScope Owner',
                  resource: selectedCompany.name,
                  details: `Temporary password updated for ${selectedCompany.ownerEmail}.`,
                });
              }}
            />
          ) : null}
        </div>
        ) : page === 'monitoring' ? (
          <MonitoringPage
            companies={companies}
            onboardingProfiles={onboardingProfiles}
            supportTickets={supportTickets}
            onOpenCompany={(companyId) => {
              setSelectedCompanyId(companyId);
              navigate('companies');
            }}
            onOpenBilling={() => navigate('billing')}
            onOpenSupport={() => navigate('support')}
          />
        ) : page === 'billing' ? (
          <BillingPage
            companies={companies}
            onboardingProfiles={onboardingProfiles}
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
