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
import { ClientPortalShell } from './components/portal/ClientPortalShell';
import { CompanyLogin } from './components/portal/CompanyLogin';
import { useClientPageRendererContext } from './components/portal/useClientPageRendererContext';
import { makeCompanyPortalAccess } from './features/access/companyPortalAccess';
import { useBillingFeature } from './features/billing/useBillingFeature';
import type { CalendarDropSlot } from './features/calendar/calendarModel';
import { useCalendarFeature } from './features/calendar/useCalendarFeature';
import { useCalendarResizeEffect } from './features/calendar/useCalendarResizeEffect';
import { makeCompanyPortalBusinessModel } from './features/company-portal/companyPortalBusinessModel';
import { makeCompanyPortalModel } from './features/company-portal/companyPortalModel';
import { makeCompanyPortalNavigationModel } from './features/company-portal/companyPortalNavigationModel';
import { makeCompanyPortalOperationsModel } from './features/company-portal/companyPortalOperationsModel';
import { useEmailFeature } from './features/email/useEmailFeature';
import { useMailboxAutoSync } from './features/email/useMailboxAutoSync';
import { useMailboxSettingsLoader } from './features/email/useMailboxSettingsLoader';
import { useFinanceFeature } from './features/finance/useFinanceFeature';
import { useJobInboxFeature } from './features/job-inbox/useJobInboxFeature';
import { useCompanyJobsLoader } from './features/jobs/useCompanyJobsLoader';
import { useJobsFeature } from './features/jobs/useJobsFeature';
import { useLibraryFeature } from './features/library/useLibraryFeature';
import { makeMapModel } from './features/map/mapModel';
import { useMapFeature } from './features/map/useMapFeature';
import { useMaterialsFeature } from './features/materials/useMaterialsFeature';
import { useClientPageFeature } from './features/navigation/useClientPageFeature';
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

  const {
    activeCompany,
    completedSteps,
    companyAccessRules,
    companyCommunication,
    configuredProfessionNames,
    currentPortalUser,
    openTickets,
    professionTemplates,
    profile,
  } = makeCompanyPortalModel({
    selectedCompany,
    onboardingProfile,
    signedInUser,
    tickets,
    emailConnection,
  });
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
  const { companyEmailSignature, companyPaymentBlock, paymentMethodOptions } = companyCommunication;

  const mapModel = makeMapModel({
    profile,
    mapSearch,
    mapTechFilter,
    mapStatusFilter,
  });
  const materialStatuses: MaterialRow['status'][] = ['Needed', 'Ordered', 'Received', 'Installed', 'Returned'];
  const operationsModel = makeCompanyPortalOperationsModel({
    activeCalendarTech,
    activeCompanyId: selectedCompanyId,
    allJobsVisibility,
    calendarAnchorDate,
    calendarAssignments,
    calendarView,
    closeMaterialEditor,
    draggingJobNumber,
    editingMaterialsJobNumber,
    inlineJobDrafts,
    jobInboxFeature,
    jobs,
    materialDraftRows,
    materialSearch,
    materialStatusFilter,
    materialTechFilter,
    materials,
    monthDropRequest,
    openJobs: selectedCompany.openJobs,
    profile,
    selectedJobTypeId,
    setCalendarAnchorDate,
    setCalendarAssignments,
    setClientPage,
    setDraggingJobNumber,
    setInlineJobDrafts,
    setJobs,
    setJobsStatus,
    setMaterials,
    setMonthDropRequest,
    setOpenedJob,
    setResizingJob,
    stopCompanyWrite,
  });
  const {
    activeJobsRows,
    allCalendarDays,
    allJobsGroups,
    allJobsRows,
    calendarActions,
    calendarAnchor,
    calendarDropSlots,
    calendarMonthDays,
    calendarPersistence,
    calendarRangeTitle,
    calendarSlots,
    invoiceActions,
    jobActions,
    jobStatusFilters,
    materialWorkflow,
    nextJobNumber,
    paidJobsRows,
    selectedJobPrefix,
    selectedJobType,
    unassignedCalendarJobs,
    visibleAllJobsRows,
    visibleCalendarDays,
    visibleCalendarJobs,
  } = operationsModel;
  const businessModel = makeCompanyPortalBusinessModel({
    activeCompany,
    allJobsRows,
    companyEmailSignature,
    companyPaymentBlock,
    connectMailboxInFeature,
    copyMailboxRedirectUrlInFeature,
    emailConnection,
    emailFolder,
    emailMessages,
    emailSearch,
    financePeriod,
    financeTechFilter,
    mailboxOAuthRedirectUrl,
    mailboxOAuthSecretDraft,
    materials,
    openEmailComposeDraft,
    payrollItems,
    payrollRules,
    persistOnboardingToBackend: onboardingProfileActions.persistOnboardingToBackend,
    profile,
    salaryPaidJobs,
    selectedCompanyId,
    sendEmailDraftFromFeature,
    setClientPage,
    setEmailConnection,
    setMailboxConnectStatus,
    setMailboxOAuthSecretDraft,
    setMailboxOAuthStatus,
    setSalaryPaidJobs,
    stopCompanyWrite,
    updateMailboxInFeature,
  });
  const { emailActions, emailModel, financeWorkflow } = businessModel;
  calendarDropSlotsRef.current = calendarDropSlots;
  persistCalendarAssignmentRef.current = calendarPersistence.persistCalendarAssignment;
  const {
    visibleClientNavItems,
    renderedClientPage,
    activeClientNavItem,
    activePageAccessLevel,
    activePageReadOnly,
  } = makeCompanyPortalNavigationModel({
    clientPage,
    canViewPage,
    canWritePage,
    accessLevelForPage,
  });
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

  const clientPageRendererContext = useClientPageRendererContext({
    activeCalendarTech,
    activeClientNavItem,
    activeJobsRows,
    activePageReadOnly,
    allCalendarDays,
    allJobsGroups,
    allJobsRows,
    allJobsVisibility,
    applyEmailTemplate,
    billingStatus,
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
  });

  return (
    <ClientPortalShell
      activeClientNavItem={activeClientNavItem}
      activeCompany={activeCompany}
      activePageAccessLevel={activePageAccessLevel}
      activePageReadOnly={activePageReadOnly}
      billingModalOpen={billingModalOpen}
      clientPageRendererContext={clientPageRendererContext}
      jobsStatus={jobsStatus}
      onBillingConnected={(updates, status) => {
        onboardingProfileActions.updateProfile(updates);
        setBillingStatus(status);
      }}
      onCloseBillingSetup={closeBillingSetup}
      onNavigateClientPage={(page) => {
        setOpenedJob(null);
        setClientPage(page);
      }}
      onSignOut={onSignOut}
      profile={profile}
      renderedClientPage={renderedClientPage}
      selectedCompany={selectedCompany}
      unreadEmailCount={unreadEmailCount}
      visibleClientNavItems={visibleClientNavItems}
    />
  );
}

