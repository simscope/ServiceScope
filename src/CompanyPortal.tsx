import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
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
  SlidersHorizontal,
  UploadCloud,
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
import { CalendarPage } from './components/portal/CalendarPage';
import { DebtorsPage } from './components/portal/DebtorsPage';
import { EmailPage } from './components/portal/EmailPage';
import { FinancePage } from './components/portal/FinancePage';
import { ImportPage } from './components/portal/ImportPage';
import { AllJobsPage, JobsPage } from './components/portal/JobsPages';
import { KnowledgePage } from './components/portal/KnowledgePage';
import { MapPage } from './components/portal/MapPage';
import { MaterialsPage } from './components/portal/MaterialsPage';
import { OnboardingPage } from './components/portal/OnboardingPage';
import { CompanyLogin } from './components/portal/CompanyLogin';
import { SquareBillingModal } from './components/portal/SquareBillingModal';
import { TasksPage } from './components/portal/TasksPage';
import { useBillingFeature } from './features/billing/useBillingFeature';
import { useCalendarFeature } from './features/calendar/useCalendarFeature';
import { makeDefaultEmailConnection } from './features/email/emailDefaults';
import { useEmailFeature } from './features/email/useEmailFeature';
import { useFinanceFeature } from './features/finance/useFinanceFeature';
import { JobInboxPage } from './features/job-inbox/JobInboxPage';
import { useJobInboxFeature } from './features/job-inbox/useJobInboxFeature';
import { useJobsFeature } from './features/jobs/useJobsFeature';
import { useLibraryFeature } from './features/library/useLibraryFeature';
import { useMapFeature } from './features/map/useMapFeature';
import { normalizeMaterialRows, useMaterialsFeature } from './features/materials/useMaterialsFeature';
import { useClientPageFeature } from './features/navigation/useClientPageFeature';
import { useOnboardingAdminFeature } from './features/onboarding/useOnboardingAdminFeature';
import { useSupportFeature } from './features/support/useSupportFeature';
import { useTasksFeature } from './features/tasks/useTasksFeature';
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
  createDefaultCompanyOnboardingProfile,
  listCompanyOnboardingProfiles,
  makeJobTypes,
  saveCompanyOnboardingProfiles,
} from './services/companyOnboardingStore';
import { startMailboxConnection } from './services/mailboxConnector';
import {
  loadMailboxEmailConnection,
  loadMailboxOAuthSettings,
  mailboxOAuthRedirectUrl,
  saveMailboxOAuthSettings,
} from './services/mailboxOAuthSettings';
import { saveOnboardingProfileToBackend } from './services/onboardingBackend';
import { dollarsToCents, findTechnicianId, listCompanyPayrollItems, upsertCompanyPayrollItems, type PayrollItemInput } from './services/payrollStore';
import {
  createJobInvoice,
  createServiceJob,
  deleteJobInvoice,
  listCompanyJobMaterials,
  listCompanyJobs,
  saveCustomerBlacklist,
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
  emptySupportForm,
  initialEmailTemplates,
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
  EmailProvider,
  EmailTemplate,
  JobInboxItem,
} from './appTypes';
import { addDays, addMonths, formatCalendarDay, parseLocalDate, startOfWeek, toLocalIsoDate } from './utils/calendar';
import { googleRouteUrl, isCustomerJobPaid, money, statusClassName } from './utils/format';

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
  const { clientPage, setClientPage } = useClientPageFeature();
  const {
    request,
    setRequest,
    requestTouched,
    setRequestTouched,
    supportReplyDrafts,
    setSupportReplyDrafts,
    resetRequest,
  } = useSupportFeature();
  const {
    openedJob,
    setOpenedJob,
    jobs,
    setJobs,
    jobsStatus,
    setJobsStatus,
    inlineJobDrafts,
    setInlineJobDrafts,
    allJobsVisibility,
    setAllJobsVisibility,
    selectedJobTypeId,
    setSelectedJobTypeId,
  } = useJobsFeature();
  const {
    calendarView,
    setCalendarView,
    calendarAnchorDate,
    setCalendarAnchorDate,
    activeCalendarTech,
    setActiveCalendarTech,
    calendarAssignments,
    setCalendarAssignments,
    draggingJobNumber,
    setDraggingJobNumber,
    resizingJob,
    setResizingJob,
    monthDropRequest,
    setMonthDropRequest,
  } = useCalendarFeature();
  const {
    materials,
    setMaterials,
    materialStatusFilter,
    setMaterialStatusFilter,
    materialTechFilter,
    setMaterialTechFilter,
    materialSearch,
    setMaterialSearch,
    editingMaterialsJobNumber,
    materialDraftRows,
    resetMaterialFilters,
    openMaterialEditor,
    closeMaterialEditor,
    updateMaterialDraft,
    addMaterialDraftRow,
    removeMaterialDraftRow,
  } = useMaterialsFeature(initialMaterialRows);
  const {
    mapTechFilter,
    setMapTechFilter,
    mapStatusFilter,
    setMapStatusFilter,
    mapSearch,
    setMapSearch,
    resetMapFilters,
  } = useMapFeature();
  const {
    emailConnection,
    setEmailConnection,
    mailboxConnectStatus,
    setMailboxConnectStatus,
    mailboxOAuthSecretDraft,
    setMailboxOAuthSecretDraft,
    mailboxOAuthStatus,
    setMailboxOAuthStatus,
    emailFolder,
    setEmailFolder,
    emailSearch,
    setEmailSearch,
    emailMessages,
    setEmailMessages,
    unreadEmailCount,
    mailboxSyncing,
    emailCompose,
    setEmailCompose,
    emailComposeRequestId,
    emailComposeAttachments,
    applyEmailTemplate,
    resetEmailCompose,
    openEmailComposeDraft,
    connectMailbox: connectMailboxInFeature,
    updateMailbox: updateMailboxInFeature,
    copyMailboxRedirectUrl: copyMailboxRedirectUrlInFeature,
    syncConnectedMailboxMessages,
    loadMoreMailboxMessages,
    sendEmailDraft: sendEmailDraftFromFeature,
  } = useEmailFeature();
  const {
    billingStatus,
    setBillingStatus,
    billingModalOpen,
    openBillingSetup,
    closeBillingSetup,
  } = useBillingFeature();
  const onboardingSaveQueueRef = useRef(Promise.resolve());
  const {
    financePeriod,
    setFinancePeriod,
    financeTechFilter,
    setFinanceTechFilter,
    payrollRules,
    setPayrollRules,
    salaryPaidJobs,
    setSalaryPaidJobs,
    payrollItems,
    setPayrollItems,
  } = useFinanceFeature();

  const selectedCompanyId = selectedCompany?.id ?? '';
  const libraryProfile = useMemo(
    () => selectedCompany ? onboardingProfile ?? createDefaultCompanyOnboardingProfile(selectedCompany) : undefined,
    [onboardingProfile, selectedCompany],
  );
  const featureAccessRules = selectedCompany ? resolveCompanyAccessRules(selectedCompany) : undefined;
  const onboardingAdminFeature = useOnboardingAdminFeature({
    activeCompany: selectedCompany,
    profile: libraryProfile,
    signedInUser,
    updateProfile,
    selectedJobTypeId,
    setSelectedJobTypeId,
  });
  const jobInboxAccessLevel = featureAccessRules?.jobInbox ?? (selectedCompany ? 'full' : 'off');
  const libraryAccessLevel = featureAccessRules?.knowledge ?? (selectedCompany ? 'full' : 'off');
  const taskAccessLevel = featureAccessRules?.tasks ?? (selectedCompany ? 'full' : 'off');
  const jobInboxFeature = useJobInboxFeature({
    companyId: selectedCompanyId,
    canWrite: jobInboxAccessLevel === 'full',
    readOnlyMessage: `Owner access for job inbox is ${accessLevelLabels[jobInboxAccessLevel].toLowerCase()}. Restore full access before`,
  });
  const libraryFeature = useLibraryFeature({
    companyId: selectedCompanyId,
    profile: libraryProfile,
    currentUserName: signedInUser?.name ?? selectedCompany?.ownerName ?? 'Company admin',
    canWrite: libraryAccessLevel === 'full',
    readOnlyMessage: `Owner access for knowledge is ${accessLevelLabels[libraryAccessLevel].toLowerCase()}. Restore full access before`,
  });
  const tasksFeature = useTasksFeature({
    companyId: selectedCompanyId,
    jobs,
    materials,
    technicianNames: libraryProfile?.technicians.map((technician) => technician.name) ?? [],
    canWrite: taskAccessLevel === 'full',
    readOnlyMessage: `Owner access for tasks is ${accessLevelLabels[taskAccessLevel].toLowerCase()}. Restore full access before`,
    setStatus: setJobsStatus,
  });

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
  const accessLevelForPage = (page: CompanyPortalAccessPage): CompanyPortalAccessLevel => companyAccessRules[page] ?? 'full';
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
  const configuredProfessionNames = new Set(
    profile.jobTypes
      .map((jobType) => String(jobType.name ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
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
  const closedJobStatuses = new Set<ServiceJobStatus>(['Completed', 'Warranty', 'Cancelled']);
  const activeJobsRows = allJobsRows.filter((job) => !closedJobStatuses.has(job.status) && !isCustomerJobPaid(job));
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

    connectMailboxInFeature(nextConnection, (connection) => persistOnboardingToBackend(profile, connection));
  };
  const updateMailbox = (patch: Partial<EmailConnection>) => {
    updateMailboxInFeature(patch, (connection) => persistOnboardingToBackend(profile, connection));
  };
  const copyMailboxRedirectUrl = async () => {
    const redirectUrl = emailConnection?.oauthRedirectUrl || mailboxOAuthRedirectUrl;
    await copyMailboxRedirectUrlInFeature(redirectUrl);
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
  const openEmailCompose = (compose: EmailCompose, attachments: EmailComposeAttachment[] = []) => {
    if (stopCompanyWrite('email', 'opening email composer')) return;

    openEmailComposeDraft(compose, attachments, companyEmailSignature, companyPaymentBlock);
    setClientPage('email');
  };
  const sendEmailDraft = async (attachments: EmailComposeAttachment[]) => {
    if (stopCompanyWrite('email', 'sending email')) return;

    await sendEmailDraftFromFeature({
      companyId: selectedCompanyId,
      signatureText: companyEmailSignature,
      paymentBlockText: companyPaymentBlock,
      attachments,
    });
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
  const saveMaterialDraftRows = () => {
    if (stopCompanyWrite('materials', 'saving materials')) return;
    if (!editingMaterialsJobNumber) return;
    const jobNumber = editingMaterialsJobNumber;
    const cleanRows = normalizeMaterialRows(jobNumber, materialDraftRows);

    setMaterials((rows) => [
      ...rows.filter((row) => row.jobNumber !== jobNumber),
      ...cleanRows,
    ]);
    closeMaterialEditor();

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
  const handleSaveJob = (updatedJob: JobCardData, openJobAfterSave = true, accessPage: CompanyPortalAccessPage = 'jobs') => {
    if (stopCompanyWrite(accessPage, 'saving jobs')) return;

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
  const handleSaveCustomerBlacklist = async (job: ServiceJob, blacklist: string) => {
    if (stopCompanyWrite('debtors', 'updating customer blacklist')) {
      throw new Error('Debtors access is read-only.');
    }
    if (!job.customerId) {
      throw new Error('Customer record was not found for this job.');
    }

    const cleanBlacklist = blacklist.trim();
    setJobs((currentJobs) => currentJobs.map((currentJob) => (
      currentJob.customerId === job.customerId ? { ...currentJob, customerBlacklist: cleanBlacklist } : currentJob
    )));
    await saveCustomerBlacklist(selectedCompany.id, job.customerId, cleanBlacklist);
  };
  const handleImportJobs = async (importedJobs: ServiceJob[]) => {
    if (stopCompanyWrite('import', 'importing jobs')) return;
    setJobsStatus(`Importing ${importedJobs.length} migration jobs...`);

    const savedJobs: ServiceJob[] = [];
    for (const importedJob of importedJobs) {
      const savedJob = await saveServiceJob(selectedCompany.id, importedJob);
      savedJobs.push(savedJob);
      setJobs((currentJobs) => {
        const exists = currentJobs.some((job) => job.id === savedJob.id || job.jobNumber === savedJob.jobNumber);
        return exists
          ? currentJobs.map((job) => (job.id === savedJob.id || job.jobNumber === savedJob.jobNumber ? savedJob : job))
          : [savedJob, ...currentJobs];
      });
      setJobsStatus(`Imported ${savedJobs.length}/${importedJobs.length} migration jobs...`);
    }

    setJobsStatus(`Migration import complete: ${savedJobs.length} jobs saved.`);
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
  const handleConvertJobInboxItem = (item: JobInboxItem) => {
    if (stopCompanyWrite('jobInbox', 'converting job inbox items')) return;
    if (stopCompanyWrite('jobs', 'creating jobs')) return;

    const createdJob = createServiceJob(selectedCompany.id, {
      jobNumber: generatedJobNumber,
      system: selectedJobType?.name ?? 'General',
      clientName: item.clientName.trim() || 'Unknown client',
      organization: item.clientName.trim() || 'Unknown company',
      phone: item.clientPhone,
      email: item.clientEmail,
      address: item.address,
      technician: '',
      serviceCallFee: String(profile.serviceCallFee),
      issue: item.message.trim() || 'Service request',
      notes: `Created from Job Inbox (${item.source}).`,
    });

    jobInboxFeature.setStatus('Converting inbox item to job...');
    saveServiceJob(selectedCompany.id, createdJob)
      .then(async (savedJob) => {
        await jobInboxFeature.markConverted(item, savedJob.id);
        setJobs((currentJobs) => [savedJob, ...currentJobs.filter((job) => job.id !== savedJob.id)]);
        setOpenedJob(savedJob);
        setClientPage('jobs');
        jobInboxFeature.setStatus(`Converted to job ${savedJob.jobNumber}.`);
      })
      .catch((error) => {
        jobInboxFeature.setStatus(error instanceof Error ? error.message : 'Inbox item could not be converted.');
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
  const clientNavItems: { page: ClientPage; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { page: 'jobInbox', label: 'Inbox', icon: <Inbox size={16} /> },
    { page: 'jobs', label: 'Jobs', icon: <ClipboardList size={16} /> },
    { page: 'allJobs', label: 'All Jobs', icon: <LayoutDashboard size={16} /> },
    { page: 'debtors', label: 'Debtors', icon: <CircleDollarSign size={16} /> },
    { page: 'calendar', label: 'Calendar', icon: <CalendarDays size={16} /> },
    { page: 'materials', label: 'Materials', icon: <Box size={16} /> },
    { page: 'tasks', label: 'Tasks', icon: <CheckCircle2 size={16} /> },
    { page: 'map', label: 'Map', icon: <Map size={16} /> },
    { page: 'email', label: 'Email', icon: <MailPlus size={16} /> },
    { page: 'finances', label: 'Finance', icon: <CreditCard size={16} /> },
    { page: 'knowledge', label: 'Library', icon: <BookOpen size={16} /> },
    { page: 'import', label: 'Import', icon: <UploadCloud size={16} /> },
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
    resetRequest();
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
    openBillingSetup();
    updateProfile({ subscriptionPaymentStatus: 'pending' });
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
        {renderedClientPage === 'jobInbox' ? (
          <JobInboxPage
            items={jobInboxFeature.items}
            form={jobInboxFeature.form}
            status={jobInboxFeature.status}
            search={jobInboxFeature.search}
            statusFilter={jobInboxFeature.statusFilter}
            onFormChange={jobInboxFeature.setForm}
            onCreateItem={jobInboxFeature.createItem}
            onSearchChange={jobInboxFeature.setSearch}
            onStatusFilterChange={jobInboxFeature.setStatusFilter}
            onConvertToJob={handleConvertJobInboxItem}
            onUpdateStatus={jobInboxFeature.updateItemStatus}
          />
        ) : renderedClientPage === 'jobs' ? (
          <JobsPage
            openedJob={openedJob}
            jobs={allJobsRows}
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
        ) : renderedClientPage === 'debtors' ? (
          <DebtorsPage
            openedJob={openedJob}
            profile={profile}
            paymentMethodOptions={paymentMethodOptions}
            materials={materials}
            currentPortalUser={currentPortalUser}
            onCloseJob={() => setOpenedJob(null)}
            onSaveJob={(job) => handleSaveJob(job, true, 'debtors')}
            onSaveMaterials={saveJobMaterials}
            onCreateInvoice={handleCreateInvoice}
            onDeleteInvoice={handleDeleteInvoice}
            onComposeEmail={openEmailCompose}
            allJobsRows={allJobsRows}
            onOpenJob={setOpenedJob}
            onSaveDebtorJob={(job) => handleSaveJob(job, false, 'debtors')}
            onSaveCustomerBlacklist={handleSaveCustomerBlacklist}
            readOnly={activePageReadOnly}
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
            onResetFilters={resetMaterialFilters}
            onOpenMaterialEditor={openMaterialEditor}
            onOpenJob={setOpenedJob}
            filteredMaterialRows={filteredMaterialRows}
            selectedMaterialsJob={selectedMaterialsJob}
            onCloseMaterialEditor={closeMaterialEditor}
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
            openTaskCount={tasksFeature.openTaskCount}
            autoTaskCount={tasksFeature.autoTaskCount}
            urgentTaskCount={tasksFeature.urgentTaskCount}
            taskForm={tasksFeature.taskForm}
            onTaskFormChange={tasksFeature.setTaskForm}
            onCreateManualTask={tasksFeature.createManualTask}
            allJobsRows={allJobsRows}
            taskAssignees={tasksFeature.taskAssignees}
            taskStatusFilter={tasksFeature.taskStatusFilter}
            onTaskStatusFilterChange={tasksFeature.setTaskStatusFilter}
            taskOwnerFilter={tasksFeature.taskOwnerFilter}
            onTaskOwnerFilterChange={tasksFeature.setTaskOwnerFilter}
            taskSearch={tasksFeature.taskSearch}
            onTaskSearchChange={tasksFeature.setTaskSearch}
            onResetFilters={tasksFeature.resetTaskFilters}
            filteredTaskRows={tasksFeature.filteredTaskRows}
            jobMap={tasksFeature.jobMap}
            onOpenJob={setOpenedJob}
            onUpdateTaskStatus={tasksFeature.updateTaskStatus}
          />
        ) : renderedClientPage === 'email' ? (
          <EmailPage
            emailConnection={emailConnection}
            emailMessages={emailMessages}
            emailTemplates={initialEmailTemplates}
            emailProviderLabels={emailProviderLabels}
            onOpenOnboarding={() => setClientPage('onboarding')}
            onStartMailboxConnection={startMailboxConnector}
            onLoadMoreMailbox={() => loadMoreMailboxMessages(selectedCompanyId)}
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
            onResetFilters={resetMapFilters}
            profile={profile}
          />
        ) : renderedClientPage === 'import' ? (
          <ImportPage
            companyId={selectedCompany.id}
            profile={profile}
            existingJobs={allJobsRows}
            nextJobNumber={nextJobNumber}
            onImportJobs={handleImportJobs}
            readOnly={activePageReadOnly}
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
            libraryDocuments={libraryFeature.libraryDocuments}
            libraryStatus={libraryFeature.libraryStatus}
            librarySystems={libraryFeature.librarySystems}
            filteredLibraryDocuments={libraryFeature.filteredLibraryDocuments}
            libraryDraft={libraryFeature.libraryDraft}
            onLibraryDraftChange={libraryFeature.setLibraryDraft}
            libraryCategories={libraryCategories}
            libraryFormats={libraryFormats}
            librarySearch={libraryFeature.librarySearch}
            onLibrarySearchChange={libraryFeature.setLibrarySearch}
            libraryCategoryFilter={libraryFeature.libraryCategoryFilter}
            onLibraryCategoryFilterChange={libraryFeature.setLibraryCategoryFilter}
            librarySystemFilter={libraryFeature.librarySystemFilter}
            onLibrarySystemFilterChange={libraryFeature.setLibrarySystemFilter}
            libraryFormatFilter={libraryFeature.libraryFormatFilter}
            onLibraryFormatFilterChange={libraryFeature.setLibraryFormatFilter}
            onLibraryFileChange={libraryFeature.handleLibraryFileChange}
            onAddLibraryDocument={libraryFeature.addLibraryDocument}
            onOpenLibraryDocument={libraryFeature.handleOpenLibraryDocument}
            onDeleteLibraryDocument={libraryFeature.handleDeleteLibraryDocument}
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
            handleLogoUpload={onboardingAdminFeature.handleLogoUpload}
            updateProfile={updateProfile}
            connectMailbox={connectMailbox}
            emailProviderLabels={emailProviderLabels}
            updateMailbox={updateMailbox}
            togglePaymentMethod={togglePaymentMethod}
            professionTemplates={professionTemplates}
            configuredProfessionNames={configuredProfessionNames}
            addProfessionTemplate={onboardingAdminFeature.addProfessionTemplate}
            jobTypeForm={onboardingAdminFeature.jobTypeForm}
            setJobTypeForm={onboardingAdminFeature.setJobTypeForm}
            handleJobTypeSubmit={onboardingAdminFeature.handleJobTypeSubmit}
            removeJobType={onboardingAdminFeature.removeJobType}
            technicianForm={onboardingAdminFeature.technicianForm}
            setTechnicianForm={onboardingAdminFeature.setTechnicianForm}
            selectedCompany={selectedCompany}
            handleTechnicianSubmit={onboardingAdminFeature.handleTechnicianSubmit}
            onSendTechnicianAccess={onboardingAdminFeature.sendTechnicianAccess}
            technicianAccessStatusById={onboardingAdminFeature.technicianAccessStatusById}
            technicianAccessPasswordById={onboardingAdminFeature.technicianAccessPasswordById}
            setTechnicianAccessPasswordById={onboardingAdminFeature.setTechnicianAccessPasswordById}
            ownerAccessPassword={onboardingAdminFeature.ownerAccessPassword}
            ownerAccessPasswordConfirm={onboardingAdminFeature.ownerAccessPasswordConfirm}
            ownerAccessStatus={onboardingAdminFeature.ownerAccessStatus}
            setOwnerAccessPassword={onboardingAdminFeature.setOwnerAccessPassword}
            setOwnerAccessPasswordConfirm={onboardingAdminFeature.setOwnerAccessPasswordConfirm}
            onGenerateOwnerPassword={onboardingAdminFeature.generateOwnerPassword}
            onSaveOwnerPassword={onboardingAdminFeature.saveOwnerPassword}
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
          onClose={closeBillingSetup}
          onConnected={(updates, status) => {
            updateProfile(updates);
            setBillingStatus(status);
          }}
        />
      ) : null}
    </div>
  );
}










