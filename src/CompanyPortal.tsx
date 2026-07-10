import { useMemo, useRef, useState } from 'react';
import {
  Building2,
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
import { JobDetailPanel } from './components/JobDetailPanel';
import { ClientPageRenderer } from './components/portal/ClientPageRenderer';
import { CompanyLogin } from './components/portal/CompanyLogin';
import { SquareBillingModal } from './components/portal/SquareBillingModal';
import { makeCompanyPortalAccess } from './features/access/companyPortalAccess';
import { useBillingFeature } from './features/billing/useBillingFeature';
import { makeCalendarActions } from './features/calendar/calendarActions';
import { makeCalendarModel, type CalendarDropSlot } from './features/calendar/calendarModel';
import { makeCalendarPersistence } from './features/calendar/calendarPersistence';
import { useCalendarFeature } from './features/calendar/useCalendarFeature';
import { useCalendarResizeEffect } from './features/calendar/useCalendarResizeEffect';
import { makeEmailActions } from './features/email/emailActions';
import { makeEmailModel } from './features/email/emailModel';
import { useEmailFeature } from './features/email/useEmailFeature';
import { useMailboxAutoSync } from './features/email/useMailboxAutoSync';
import { useMailboxSettingsLoader } from './features/email/useMailboxSettingsLoader';
import { makeFinanceWorkflow } from './features/finance/financeWorkflow';
import { makeInvoiceActions } from './features/finance/invoiceActions';
import { useFinanceFeature } from './features/finance/useFinanceFeature';
import { useJobInboxFeature } from './features/job-inbox/useJobInboxFeature';
import { makeJobActions } from './features/jobs/jobActions';
import { makeJobModel } from './features/jobs/jobModel';
import { useCompanyJobsLoader } from './features/jobs/useCompanyJobsLoader';
import { useJobsFeature } from './features/jobs/useJobsFeature';
import { useLibraryFeature } from './features/library/useLibraryFeature';
import { makeMapModel } from './features/map/mapModel';
import { useMapFeature } from './features/map/useMapFeature';
import { makeMaterialWorkflow } from './features/materials/materialWorkflow';
import { useMaterialsFeature } from './features/materials/useMaterialsFeature';
import { resolveClientNavigation } from './features/navigation/clientNavigation';
import { useClientPageFeature } from './features/navigation/useClientPageFeature';
import { makeCompanyCommunicationModel } from './features/onboarding/companyCommunicationModel';
import { makeOnboardingProfileActions } from './features/onboarding/onboardingProfileActions';
import { useOnboardingAdminFeature } from './features/onboarding/useOnboardingAdminFeature';
import { makeSupportActions } from './features/support/supportActions';
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
import { mailboxOAuthRedirectUrl } from './services/mailboxOAuthSettings';
import {
  saveServiceJob,
} from './services/jobsStore';
import type {
  AuditEvent,
  AuditEventCategory,
  BillingStatus,
  Company,
  CompanyPlan,
  CompanyPortalAccessPage,
  CompanyStatus,
  NewPlatformUserForm,
  NewSupportTicketForm,
  NewCompanyForm,
  OnboardingStepKey,
  SupportTicket,
  SupportTicketStatus,
  PlatformUser,
  PlatformUserRole,
  PlatformUserStatus,
  CompanyOnboardingProfile,
  CompanyTechnicianRole,
  JobInvoice,
  MaterialRow,
  ServiceJob,
} from './types';
import {
  auditCategoryLabels,
  billingLabels,
  platformRoleLabels,
  platformStatusLabels,
  statusLabels,
  ticketPriorityLabels,
} from './appLabels';
import {
  emptyAccessForm,
  emptyCompany,
  emptySupportForm,
  initialMaterialRows,
} from './appSeeds';
import type {
  AppPage,
  CompanyOnboardingStepKey,
  EmailCompose,
  EmailComposeAttachment,
  EmailConnection,
  EmailProvider,
  EmailTemplate,
} from './appTypes';
import { googleRouteUrl, money, statusClassName } from './utils/format';

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
    updateInlineJobDraft,
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
  const calendarDropSlotsRef = useRef<CalendarDropSlot[]>([]);
  const persistCalendarAssignmentRef = useRef((
    _jobNumber: string,
    _assignee: string,
    _dayKey: string,
    _slotKey: string,
    _durationMinutes: number,
  ) => undefined);
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
  const onboardingProfileActions = makeOnboardingProfileActions({
    activeCompany: selectedCompany,
    profile: libraryProfile,
    emailConnection,
    onboardingSaveQueueRef,
    openBillingSetup,
    onUpdateOnboardingProfile,
  });
  const featureAccessRules = selectedCompany ? resolveCompanyAccessRules(selectedCompany) : undefined;
  const onboardingAdminFeature = useOnboardingAdminFeature({
    activeCompany: selectedCompany,
    profile: libraryProfile,
    signedInUser,
    updateProfile: onboardingProfileActions.updateProfile,
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
  useCompanyJobsLoader({
    selectedCompany,
    setJobs,
    setMaterials,
    setStatus: setJobsStatus,
  });

  useMailboxSettingsLoader({
    selectedCompany,
    selectedCompanyId,
    onboardingProfile,
    setEmailConnection,
    setMailboxOAuthSecretDraft,
    setMailboxOAuthStatus,
    setMailboxConnectStatus,
  });
  useCalendarResizeEffect({
    resizingJob,
    calendarDropSlotsRef,
    setCalendarAssignments,
    setResizingJob,
    persistCalendarAssignmentRef,
  });

  useMailboxAutoSync({
    emailConnection,
    selectedCompanyId,
    setEmailMessages,
    syncConnectedMailboxMessages,
    setMailboxConnectStatus,
  });

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
  const {
    accessLevelForPage,
    canViewPage,
    canWritePage,
    stopCompanyWrite,
  } = makeCompanyPortalAccess({
    rules: companyAccessRules,
    accessLevelLabels,
    setStatus: setJobsStatus,
  });
  const companyCommunication = makeCompanyCommunicationModel({
    company: activeCompany,
    profile,
    emailConnection,
  });
  const { companyEmailSignature, companyPaymentBlock, paymentMethodOptions } = companyCommunication;

  const professionTemplates = makeJobTypes();
  const configuredProfessionNames = new Set(
    profile.jobTypes
      .map((jobType) => String(jobType.name ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
  const jobModel = makeJobModel({
    jobs,
    openJobs: selectedCompany.openJobs,
    profile,
    selectedJobTypeId,
    allJobsVisibility,
  });
  const {
    selectedJobType,
    selectedJobPrefix,
    nextJobNumber,
    generatedJobNumber,
    jobStatusFilters,
    allJobsRows,
    activeJobsRows,
    paidJobsRows,
    visibleAllJobsRows,
    allJobsGroups,
  } = jobModel;
  const mapModel = makeMapModel({
    profile,
    mapSearch,
    mapTechFilter,
    mapStatusFilter,
  });
  const materialStatuses: MaterialRow['status'][] = ['Needed', 'Ordered', 'Received', 'Installed', 'Returned'];
  const emailModel = makeEmailModel({
    emailMessages,
    emailFolder,
    emailSearch,
    jobs: allJobsRows,
  });
  const emailActions = makeEmailActions({
    activeCompany,
    profile,
    emailConnection,
    mailboxOAuthSecretDraft,
    companyEmailSignature,
    companyPaymentBlock,
    mailboxOAuthRedirectUrl,
    selectedCompanyId,
    setClientPage,
    setEmailConnection,
    setMailboxOAuthSecretDraft,
    setMailboxOAuthStatus,
    setMailboxConnectStatus,
    connectMailboxInFeature,
    updateMailboxInFeature,
    copyMailboxRedirectUrlInFeature,
    openEmailComposeDraft,
    sendEmailDraftFromFeature,
    persistOnboardingToBackend: onboardingProfileActions.persistOnboardingToBackend,
    stopEmailWrite: (action) => stopCompanyWrite('email', action),
  });
  const materialWorkflow = makeMaterialWorkflow({
    companyId: selectedCompanyId,
    materials,
    materialStatusFilter,
    materialTechFilter,
    materialSearch,
    editingMaterialsJobNumber,
    materialDraftRows,
    allJobsRows,
    activeJobsRows,
    setMaterials,
    setJobsStatus,
    closeMaterialEditor,
    stopMaterialsWrite: (action) => stopCompanyWrite('materials', action),
  });
  const financeWorkflow = makeFinanceWorkflow({
    profile,
    jobs: allJobsRows,
    materials,
    payrollRules,
    payrollItems,
    salaryPaidJobs,
    financeTechFilter,
    financePeriod,
    setSalaryPaidJobs,
    stopFinanceWrite: (action) => stopCompanyWrite('finances', action),
  });
  const currentPortalUser = {
    name: signedInUser?.name ?? selectedCompany.ownerName,
    role: signedInUser?.role ?? 'Admin' as const,
  };
  const calendarModel = makeCalendarModel({
    calendarAnchorDate,
    calendarView,
    activeCalendarTech,
    calendarAssignments,
    activeJobsRows,
  });
  const {
    calendarAnchor,
    calendarMonthDays,
    allCalendarDays,
    calendarRangeTitle,
    calendarSlots,
    calendarDropSlots,
    calendarJobs,
    unassignedCalendarJobs,
    visibleCalendarJobs,
    visibleCalendarDays,
  } = calendarModel;
  calendarDropSlotsRef.current = calendarDropSlots;
  const calendarPersistence = makeCalendarPersistence({
    companyId: activeCompany.id,
    jobs,
    calendarDropSlots,
    setJobs,
    setOpenedJob,
    setCalendarAssignments,
    setStatus: setJobsStatus,
    stopCalendarWrite: (action) => stopCompanyWrite('calendar', action),
  });
  persistCalendarAssignmentRef.current = calendarPersistence.persistCalendarAssignment;
  const calendarActions = makeCalendarActions({
    calendarView,
    calendarAnchorDate,
    setCalendarAnchorDate,
    activeCalendarTech,
    calendarAssignments,
    setCalendarAssignments,
    draggingJobNumber,
    setDraggingJobNumber,
    monthDropRequest,
    setMonthDropRequest,
    setResizingJob,
    calendarDropSlots,
    calendarJobs,
    stopCalendarWrite: (action) => stopCompanyWrite('calendar', action),
    setOpenedJob,
    persistCalendarAssignment: calendarPersistence.persistCalendarAssignment,
  });
  const invoiceActions = makeInvoiceActions({
    companyId: selectedCompany.id,
    setJobs,
    setOpenedJob,
    stopFinanceWrite: (action) => stopCompanyWrite('finances', action),
  });
  const jobActions = makeJobActions({
    companyId: selectedCompany.id,
    profile,
    generatedJobNumber,
    selectedJobType,
    inlineJobDrafts,
    setInlineJobDrafts,
    setJobs,
    setOpenedJob,
    setJobsStatus,
    setClientPage,
    jobInboxFeature,
    stopCompanyWrite,
  });
  const {
    visibleClientNavItems,
    renderedClientPage,
    activeClientNavItem,
  } = resolveClientNavigation({
    clientPage,
    canViewPage,
  });
  const activePageAccessLevel = accessLevelForPage(renderedClientPage as CompanyPortalAccessPage);
  const activePageReadOnly = !canWritePage(renderedClientPage as CompanyPortalAccessPage);
  const supportActions = makeSupportActions({
    request,
    setRequestTouched,
    resetRequest,
    supportReplyDrafts,
    setSupportReplyDrafts,
    onCreateRequest,
    onReplyToTicket,
    stopPortalWrite: (action) => stopCompanyWrite('portal', action),
  });

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
            <strong>{activeClientNavItem?.label ?? 'This page'} is {accessLevelLabels[activePageAccessLevel].toLowerCase()}</strong>
            <span>Owner access controls are active for this company.</span>
          </div>
        ) : null}
        <ClientPageRenderer
          renderedClientPage={renderedClientPage}
          context={{
            activeCalendarTech,
            activeClientNavItem,
            activeJobsRows,
            activePageReadOnly,
            allCalendarDays,
            allJobsGroups,
            allJobsRows,
            allJobsVisibility,
            applyEmailTemplate,
            calendarActions,
            calendarAnchor,
            calendarDropSlots,
            calendarMonthDays,
            calendarRangeTitle,
            calendarSlots,
            calendarView,
            closeMaterialEditor,
            companyEmailSignature,
            companyPaymentBlock,
            completedSteps,
            configuredProfessionNames,
            currentPortalUser,
            emailActions,
            emailCompose,
            emailComposeAttachments,
            emailComposeRequestId,
            emailConnection,
            emailFolder,
            emailMessages,
            emailModel,
            emailSearch,
            financePeriod,
            financeTechFilter,
            financeWorkflow,
            inlineJobDrafts,
            invoiceActions,
            jobActions,
            jobInboxFeature,
            jobStatusFilters,
            libraryFeature,
            loadMoreMailboxMessages,
            mailBoxStatusProps: {
              mailboxConnectStatus,
              mailboxOAuthSecretDraft,
              mailboxOAuthStatus,
              mailboxSyncing,
              setMailboxOAuthSecretDraft,
            },
            mapModel,
            mapSearch,
            mapStatusFilter,
            mapTechFilter,
            materialDraftRows,
            materialSearch,
            materialStatusFilter,
            materialStatuses,
            materialTechFilter,
            materialWorkflow,
            materials,
            monthDropRequest,
            nextJobNumber,
            onboardingAdminFeature,
            onboardingProfileActions,
            openMaterialEditor,
            openedJob,
            openTickets,
            paidJobsRows,
            paymentMethodOptions,
            payrollRules,
            professionTemplates,
            profile,
            request,
            requestTouched,
            resetMapFilters,
            resetMaterialFilters,
            selectedCompany,
            selectedCompanyId,
            selectedJobPrefix,
            selectedJobType,
            selectedJobTypeId,
            setActiveCalendarTech,
            setAllJobsVisibility,
            setCalendarView,
            setClientPage,
            setEmailCompose,
            setEmailFolder,
            setEmailSearch,
            setFinancePeriod,
            setFinanceTechFilter,
            setMapSearch,
            setMapStatusFilter,
            setMapTechFilter,
            setMaterialSearch,
            setMaterialStatusFilter,
            setMaterialTechFilter,
            setMonthDropRequest,
            setOpenedJob,
            setPayrollRules,
            setRequest,
            setSelectedJobTypeId,
            supportActions,
            tasksFeature,
            tickets,
            unassignedCalendarJobs,
            updateInlineJobDraft,
            updateMaterialDraft,
            removeMaterialDraftRow,
            addMaterialDraftRow,
            visibleCalendarDays,
            visibleCalendarJobs,
          }}
        />
      </main>
      {billingModalOpen ? (
        <SquareBillingModal
          activeCompany={activeCompany}
          profile={profile}
          onClose={closeBillingSetup}
          onConnected={(updates, status) => {
            onboardingProfileActions.updateProfile(updates);
            setBillingStatus(status);
          }}
        />
      ) : null}
    </div>
  );
}

