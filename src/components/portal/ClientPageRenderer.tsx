import { mailboxOAuthRedirectUrl } from '../../services/mailboxOAuthSettings';
import { emailProviderLabels, initialEmailTemplates, libraryCategories, libraryFormats } from '../../appSeeds';
import type { Dispatch, SetStateAction } from 'react';
import type {
  ClientPage,
  EmailCompose,
  EmailComposeAttachment,
  EmailConnection,
  EmailFolder,
  EmailMessage,
  FinancePeriod,
  PayrollRules,
} from '../../appTypes';
import type {
  Company,
  CompanyJobType,
  CompanyOnboardingProfile,
  CompanyPaymentMethod,
  MaterialRow,
  MaterialStatus,
  NewSupportTicketForm,
  ServiceJob,
  ServiceJobStatus,
} from '../../types';
import type { JobCardData } from '../JobCard';
import type { ClientNavItem } from '../../features/navigation/clientNavigation';
import type { CalendarDropSlot } from '../../features/calendar/calendarModel';
import type { CalendarView, MonthDropRequest } from '../../features/calendar/useCalendarFeature';
import type { makeCalendarActions } from '../../features/calendar/calendarActions';
import type { makeEmailActions } from '../../features/email/emailActions';
import type { makeEmailModel } from '../../features/email/emailModel';
import type { makeFinanceWorkflow } from '../../features/finance/financeWorkflow';
import type { makeInvoiceActions } from '../../features/finance/invoiceActions';
import type { makeJobActions } from '../../features/jobs/jobActions';
import type { makeMapModel } from '../../features/map/mapModel';
import type { makeMaterialWorkflow } from '../../features/materials/materialWorkflow';
import type { makeOnboardingProfileActions } from '../../features/onboarding/onboardingProfileActions';
import type { makeSupportActions } from '../../features/support/supportActions';
import type { useJobInboxFeature } from '../../features/job-inbox/useJobInboxFeature';
import type { useLibraryFeature } from '../../features/library/useLibraryFeature';
import type { useOnboardingAdminFeature } from '../../features/onboarding/useOnboardingAdminFeature';
import type { useTasksFeature } from '../../features/tasks/useTasksFeature';
import { CalendarPage } from './CalendarPage';
import { ClientPlaceholderPage } from './ClientPlaceholderPage';
import { DebtorsPage } from './DebtorsPage';
import { EmailPage } from './EmailPage';
import { FinancePage } from './FinancePage';
import { ImportPage } from './ImportPage';
import { AllJobsPage, JobsPage } from './JobsPages';
import { KnowledgePage } from './KnowledgePage';
import { MapPage } from './MapPage';
import { MaterialsPage } from './MaterialsPage';
import { OnboardingPage } from './OnboardingPage';
import { PortalAccountPage } from './PortalAccountPage';
import { TasksPage } from './TasksPage';
import { JobInboxPage } from '../../features/job-inbox/JobInboxPage';

type SupportRequestDraft = Pick<NewSupportTicketForm, 'kind' | 'priority' | 'subject' | 'message'>;

type CalendarDay = {
  key: string;
  label: string;
  date: string;
  isoDate: string;
  day: number;
  month: number;
};

type CalendarJob = JobCardData & {
  dayKey?: string;
  time?: string;
  durationMinutes: number;
};

export type ClientPageRendererContext = {
  activeCalendarTech: string;
  activeClientNavItem?: ClientNavItem;
  activeJobsRows: ServiceJob[];
  activePageReadOnly: boolean;
  allCalendarDays: CalendarDay[];
  allJobsGroups: Array<{ technician: string; jobs: ServiceJob[] }>;
  allJobsRows: ServiceJob[];
  allJobsVisibility: 'active' | 'paid' | 'all';
  applyEmailTemplate: (template: Parameters<ReturnType<typeof import('../../features/email/useEmailFeature').useEmailFeature>['applyEmailTemplate']>[0]) => void;
  calendarActions: ReturnType<typeof makeCalendarActions>;
  calendarAnchor: Date;
  calendarDropSlots: CalendarDropSlot[];
  calendarMonthDays: CalendarDay[];
  calendarRangeTitle: string;
  calendarSlots: string[];
  calendarView: CalendarView;
  closeMaterialEditor: ReturnType<typeof import('../../features/materials/useMaterialsFeature').useMaterialsFeature>['closeMaterialEditor'];
  companyEmailSignature: string;
  companyPaymentBlock: string;
  completedSteps: number;
  configuredProfessionNames: Set<string>;
  currentPortalUser: { name: string; role: 'Admin' | 'Manager' | 'Technician' };
  emailActions: ReturnType<typeof makeEmailActions>;
  emailCompose: EmailCompose;
  emailComposeAttachments: EmailComposeAttachment[];
  emailComposeRequestId: number;
  emailConnection: EmailConnection | null;
  emailFolder: EmailFolder;
  emailMessages: EmailMessage[];
  emailModel: ReturnType<typeof makeEmailModel>;
  emailSearch: string;
  financePeriod: FinancePeriod;
  financeTechFilter: string;
  financeWorkflow: ReturnType<typeof makeFinanceWorkflow>;
  inlineJobDrafts: Record<string, Partial<ServiceJob>>;
  invoiceActions: ReturnType<typeof makeInvoiceActions>;
  jobActions: ReturnType<typeof makeJobActions>;
  jobInboxFeature: ReturnType<typeof useJobInboxFeature>;
  jobStatusFilters: ServiceJobStatus[];
  libraryFeature: ReturnType<typeof useLibraryFeature>;
  loadMoreMailboxMessages: (companyId: string) => void;
  mailBoxStatusProps: {
    mailboxConnectStatus: string;
    mailboxOAuthSecretDraft: string;
    mailboxOAuthStatus: string;
    mailboxSyncing: boolean;
    setMailboxOAuthSecretDraft: Dispatch<SetStateAction<string>>;
  };
  mapModel: ReturnType<typeof makeMapModel>;
  mapSearch: string;
  mapStatusFilter: string;
  mapTechFilter: string;
  materialDraftRows: MaterialRow[];
  materialSearch: string;
  materialStatusFilter: MaterialStatus | 'all';
  materialStatuses: MaterialStatus[];
  materialTechFilter: string;
  materialWorkflow: ReturnType<typeof makeMaterialWorkflow>;
  materials: MaterialRow[];
  monthDropRequest: MonthDropRequest | null;
  nextJobNumber: string;
  onboardingAdminFeature: ReturnType<typeof useOnboardingAdminFeature>;
  onboardingProfileActions: ReturnType<typeof makeOnboardingProfileActions>;
  openMaterialEditor: ReturnType<typeof import('../../features/materials/useMaterialsFeature').useMaterialsFeature>['openMaterialEditor'];
  openedJob: JobCardData | null;
  openTickets: unknown[];
  paidJobsRows: ServiceJob[];
  paymentMethodOptions: Array<{ value: CompanyPaymentMethod; label: string }>;
  payrollRules: PayrollRules;
  professionTemplates: CompanyJobType[];
  profile: CompanyOnboardingProfile;
  request: SupportRequestDraft;
  requestTouched: boolean;
  resetMapFilters: () => void;
  resetMaterialFilters: () => void;
  selectedCompany: Company;
  selectedCompanyId: string;
  selectedJobPrefix: string;
  selectedJobType: CompanyJobType | undefined;
  selectedJobTypeId: string;
  setActiveCalendarTech: Dispatch<SetStateAction<string>>;
  setAllJobsVisibility: Dispatch<SetStateAction<'active' | 'paid' | 'all'>>;
  setCalendarView: Dispatch<SetStateAction<CalendarView>>;
  setClientPage: Dispatch<SetStateAction<ClientPage>>;
  setEmailCompose: Dispatch<SetStateAction<EmailCompose>>;
  setEmailFolder: Dispatch<SetStateAction<EmailFolder>>;
  setEmailSearch: Dispatch<SetStateAction<string>>;
  setFinancePeriod: Dispatch<SetStateAction<FinancePeriod>>;
  setFinanceTechFilter: Dispatch<SetStateAction<string>>;
  setMapSearch: Dispatch<SetStateAction<string>>;
  setMapStatusFilter: Dispatch<SetStateAction<string>>;
  setMapTechFilter: Dispatch<SetStateAction<string>>;
  setMaterialSearch: Dispatch<SetStateAction<string>>;
  setMaterialStatusFilter: Dispatch<SetStateAction<MaterialStatus | 'all'>>;
  setMaterialTechFilter: Dispatch<SetStateAction<string>>;
  setMonthDropRequest: Dispatch<SetStateAction<MonthDropRequest | null>>;
  setOpenedJob: Dispatch<SetStateAction<JobCardData | null>>;
  setPayrollRules: Dispatch<SetStateAction<PayrollRules>>;
  setRequest: Dispatch<SetStateAction<SupportRequestDraft>>;
  setSelectedJobTypeId: Dispatch<SetStateAction<string>>;
  supportActions: ReturnType<typeof makeSupportActions>;
  tasksFeature: ReturnType<typeof useTasksFeature>;
  tickets: Parameters<typeof PortalAccountPage>[0]['tickets'];
  unassignedCalendarJobs: CalendarJob[];
  updateInlineJobDraft: (jobId: string, patch: Partial<ServiceJob>) => void;
  updateMaterialDraft: ReturnType<typeof import('../../features/materials/useMaterialsFeature').useMaterialsFeature>['updateMaterialDraft'];
  removeMaterialDraftRow: ReturnType<typeof import('../../features/materials/useMaterialsFeature').useMaterialsFeature>['removeMaterialDraftRow'];
  addMaterialDraftRow: ReturnType<typeof import('../../features/materials/useMaterialsFeature').useMaterialsFeature>['addMaterialDraftRow'];
  billingStatus: string;
  visibleCalendarDays: CalendarDay[];
  visibleCalendarJobs: CalendarJob[];
};

type ClientPageRendererProps = {
  renderedClientPage: ClientPage;
  context: ClientPageRendererContext;
};

export function ClientPageRenderer({ renderedClientPage, context }: ClientPageRendererProps) {
  const {
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
    mailBoxStatusProps,
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
  } = context;

  if (renderedClientPage === 'jobInbox') {
    return (
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
        onConvertToJob={jobActions.handleConvertJobInboxItem}
        onUpdateStatus={jobInboxFeature.updateItemStatus}
      />
    );
  }

  if (renderedClientPage === 'jobs') {
    return (
      <JobsPage
        openedJob={openedJob}
        jobs={allJobsRows}
        profile={profile}
        paymentMethodOptions={paymentMethodOptions}
        materials={materials}
        currentPortalUser={currentPortalUser}
        onCloseJob={() => setOpenedJob(null)}
        onSaveJob={jobActions.handleSaveJob}
        onSaveMaterials={materialWorkflow.saveJobMaterials}
        onCreateInvoice={invoiceActions.handleCreateInvoice}
        onDeleteInvoice={invoiceActions.handleDeleteInvoice}
        onComposeEmail={emailActions.openEmailCompose}
        onCreateJob={jobActions.handleCreateJob}
        selectedJobPrefix={selectedJobPrefix}
        nextJobNumber={nextJobNumber}
        selectedJobType={selectedJobType}
        selectedJobTypeId={selectedJobTypeId}
        onSelectedJobTypeIdChange={setSelectedJobTypeId}
      />
    );
  }

  if (renderedClientPage === 'allJobs') {
    return (
      <AllJobsPage
        openedJob={openedJob}
        profile={profile}
        paymentMethodOptions={paymentMethodOptions}
        materials={materials}
        currentPortalUser={currentPortalUser}
        onCloseJob={() => setOpenedJob(null)}
        onSaveJob={jobActions.handleSaveJob}
        onSaveMaterials={materialWorkflow.saveJobMaterials}
        onCreateInvoice={invoiceActions.handleCreateInvoice}
        onDeleteInvoice={invoiceActions.handleDeleteInvoice}
        onComposeEmail={emailActions.openEmailCompose}
        jobStatusFilters={jobStatusFilters}
        allJobsGroups={allJobsGroups}
        allJobsVisibility={allJobsVisibility}
        onAllJobsVisibilityChange={setAllJobsVisibility}
        activeJobsCount={activeJobsRows.length}
        paidJobsCount={paidJobsRows.length}
        totalJobsCount={allJobsRows.length}
        inlineJobDrafts={inlineJobDrafts}
        onUpdateInlineJobDraft={updateInlineJobDraft}
        onSaveInlineJob={jobActions.handleSaveInlineJob}
        onOpenJob={setOpenedJob}
      />
    );
  }

  if (renderedClientPage === 'debtors') {
    return (
      <DebtorsPage
        openedJob={openedJob}
        profile={profile}
        paymentMethodOptions={paymentMethodOptions}
        materials={materials}
        currentPortalUser={currentPortalUser}
        onCloseJob={() => setOpenedJob(null)}
        onSaveJob={(job) => jobActions.handleSaveJob(job, true, 'debtors')}
        onSaveMaterials={materialWorkflow.saveJobMaterials}
        onCreateInvoice={invoiceActions.handleCreateInvoice}
        onDeleteInvoice={invoiceActions.handleDeleteInvoice}
        onComposeEmail={emailActions.openEmailCompose}
        allJobsRows={allJobsRows}
        onOpenJob={setOpenedJob}
        onSaveDebtorJob={(job) => jobActions.handleSaveJob(job, false, 'debtors')}
        onSaveCustomerBlacklist={jobActions.handleSaveCustomerBlacklist}
        readOnly={activePageReadOnly}
      />
    );
  }

  if (renderedClientPage === 'calendar') {
    return (
      <CalendarPage
        openedJob={openedJob}
        profile={profile}
        paymentMethodOptions={paymentMethodOptions}
        materials={materials}
        currentPortalUser={currentPortalUser}
        onCloseJob={() => setOpenedJob(null)}
        onSaveJob={jobActions.handleSaveJob}
        onSaveMaterials={materialWorkflow.saveJobMaterials}
        onCreateInvoice={invoiceActions.handleCreateInvoice}
        onDeleteInvoice={invoiceActions.handleDeleteInvoice}
        onComposeEmail={emailActions.openEmailCompose}
        calendarRangeTitle={calendarRangeTitle}
        onMoveCalendar={calendarActions.moveCalendar}
        onShowToday={calendarActions.showTodayInCalendar}
        activeCalendarTech={activeCalendarTech}
        onActiveCalendarTechChange={setActiveCalendarTech}
        calendarView={calendarView}
        onCalendarViewChange={setCalendarView}
        unassignedCalendarJobs={unassignedCalendarJobs}
        onCalendarDragStart={calendarActions.handleCalendarDragStart}
        onOpenJob={setOpenedJob}
        calendarMonthDays={calendarMonthDays}
        visibleCalendarJobs={visibleCalendarJobs}
        calendarAnchor={calendarAnchor}
        onCalendarMonthDrop={calendarActions.handleCalendarMonthDrop}
        visibleCalendarDays={visibleCalendarDays}
        calendarSlots={calendarSlots}
        calendarDropSlots={calendarDropSlots}
        onCalendarDrop={calendarActions.handleCalendarDrop}
        onCalendarResizeStart={calendarActions.handleCalendarResizeStart}
        jobStatusFilters={jobStatusFilters}
        monthDropRequest={monthDropRequest}
        allCalendarDays={allCalendarDays}
        onMonthDropRequestChange={setMonthDropRequest}
        onConfirmCalendarMonthDrop={calendarActions.confirmCalendarMonthDrop}
      />
    );
  }

  if (renderedClientPage === 'materials') {
    return (
      <MaterialsPage
        materials={materials}
        jobsWithoutMaterials={materialWorkflow.filteredJobsWithoutMaterials}
        materialsTotal={materialWorkflow.materialsTotal}
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
        filteredMaterialRows={materialWorkflow.filteredMaterialRows}
        selectedMaterialsJob={materialWorkflow.selectedMaterialsJob}
        onCloseMaterialEditor={closeMaterialEditor}
        materialDraftRows={materialDraftRows}
        onUpdateMaterialDraft={updateMaterialDraft}
        onRemoveMaterialDraftRow={removeMaterialDraftRow}
        onAddMaterialDraftRow={addMaterialDraftRow}
        onSaveMaterialDraftRows={materialWorkflow.saveMaterialDraftRows}
      />
    );
  }

  if (renderedClientPage === 'tasks') {
    return (
      <TasksPage
        openedJob={openedJob}
        profile={profile}
        paymentMethodOptions={paymentMethodOptions}
        materials={materials}
        currentPortalUser={currentPortalUser}
        onCloseJob={() => setOpenedJob(null)}
        onSaveJob={jobActions.handleSaveJob}
        onSaveMaterials={materialWorkflow.saveJobMaterials}
        onCreateInvoice={invoiceActions.handleCreateInvoice}
        onDeleteInvoice={invoiceActions.handleDeleteInvoice}
        onComposeEmail={emailActions.openEmailCompose}
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
    );
  }

  if (renderedClientPage === 'email') {
    return (
      <EmailPage
        emailConnection={emailConnection}
        emailMessages={emailMessages}
        emailTemplates={initialEmailTemplates}
        emailProviderLabels={emailProviderLabels}
        onOpenOnboarding={() => setClientPage('onboarding')}
        onStartMailboxConnection={emailActions.startMailboxConnector}
        onLoadMoreMailbox={() => loadMoreMailboxMessages(selectedCompanyId)}
        mailboxSyncing={mailBoxStatusProps.mailboxSyncing}
        mailboxConnectStatus={mailBoxStatusProps.mailboxConnectStatus}
        emailFolder={emailFolder}
        onEmailFolderChange={context.setEmailFolder}
        emailSearch={emailSearch}
        onEmailSearchChange={context.setEmailSearch}
        visibleEmailMessages={emailModel.visibleEmailMessages}
        onApplyEmailTemplate={applyEmailTemplate}
        jobMap={emailModel.jobMap}
        onEmailComposeChange={setEmailCompose}
        emailCompose={emailCompose}
        allJobsRows={allJobsRows}
        companySignature={companyEmailSignature}
        companyPaymentBlock={companyPaymentBlock}
        composeRequestId={emailComposeRequestId}
        composeAttachmentRequest={emailComposeAttachments}
        onSendEmailDraft={emailActions.sendEmailDraft}
      />
    );
  }

  if (renderedClientPage === 'map') {
    return (
      <MapPage
        filteredTechnicianLocations={mapModel.filteredTechnicianLocations}
        mapTechFilter={mapTechFilter}
        onMapTechFilterChange={setMapTechFilter}
        mapStatusFilter={mapStatusFilter}
        onMapStatusFilterChange={setMapStatusFilter}
        mapSearch={mapSearch}
        onMapSearchChange={setMapSearch}
        onResetFilters={resetMapFilters}
        profile={profile}
      />
    );
  }

  if (renderedClientPage === 'import') {
    return (
      <ImportPage
        companyId={selectedCompany.id}
        profile={profile}
        existingJobs={allJobsRows}
        nextJobNumber={nextJobNumber}
        onImportJobs={jobActions.handleImportJobs}
        readOnly={activePageReadOnly}
      />
    );
  }

  if (renderedClientPage === 'finances') {
    return (
      <FinancePage
        openedJob={openedJob}
        profile={profile}
        paymentMethodOptions={paymentMethodOptions}
        materials={materials}
        currentPortalUser={currentPortalUser}
        onCloseJob={() => setOpenedJob(null)}
        onSaveJob={jobActions.handleSaveJob}
        onSaveMaterials={materialWorkflow.saveJobMaterials}
        onCreateInvoice={invoiceActions.handleCreateInvoice}
        onDeleteInvoice={invoiceActions.handleDeleteInvoice}
        onComposeEmail={emailActions.openEmailCompose}
        financeSummary={financeWorkflow.financeSummary}
        financePeriod={financePeriod}
        onFinancePeriodChange={setFinancePeriod}
        financeTechFilter={financeTechFilter}
        onFinanceTechFilterChange={setFinanceTechFilter}
        payrollRules={payrollRules}
        onPayrollRulesChange={setPayrollRules}
        technicianPayroll={financeWorkflow.technicianPayroll}
        financeBaseRows={financeWorkflow.financeBaseRows}
        onOpenJob={setOpenedJob}
        onToggleSalaryPaid={financeWorkflow.toggleSalaryPaid}
        onMarkSalaryJobsPaid={financeWorkflow.markSalaryJobsPaid}
      />
    );
  }

  if (renderedClientPage === 'knowledge') {
    return (
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
    );
  }

  if (renderedClientPage === 'portal') {
    return (
      <PortalAccountPage
        selectedCompany={selectedCompany}
        tickets={tickets}
        openTicketsCount={openTickets.length}
        request={request}
        requestTouched={requestTouched}
        onRequestChange={setRequest}
        onRequestSubmit={supportActions.handleRequestSubmit}
      />
    );
  }

  if (renderedClientPage === 'onboarding') {
    return (
      <OnboardingPage
        completedSteps={context.completedSteps}
        profile={profile}
        emailConnection={emailConnection}
        handleLogoUpload={onboardingAdminFeature.handleLogoUpload}
        updateProfile={onboardingProfileActions.updateProfile}
        connectMailbox={emailActions.connectMailbox}
        emailProviderLabels={emailProviderLabels}
        updateMailbox={emailActions.updateMailbox}
        togglePaymentMethod={onboardingProfileActions.togglePaymentMethod}
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
        mailboxConnectStatus={mailBoxStatusProps.mailboxConnectStatus}
        mailboxOAuthSecretDraft={mailBoxStatusProps.mailboxOAuthSecretDraft}
        mailboxOAuthStatus={mailBoxStatusProps.mailboxOAuthStatus}
        mailboxOAuthRedirectUrl={mailboxOAuthRedirectUrl}
        setMailboxOAuthSecretDraft={mailBoxStatusProps.setMailboxOAuthSecretDraft}
        onCopyMailboxRedirectUrl={emailActions.copyMailboxRedirectUrl}
        onSaveMailboxOAuth={emailActions.saveMailboxOAuth}
        onStartMailboxConnection={emailActions.startMailboxConnector}
        billingStatus={context.billingStatus}
        onConnectSubscriptionBilling={onboardingProfileActions.connectSubscriptionBilling}
      />
    );
  }

  return (
    <ClientPlaceholderPage
      company={selectedCompany}
      icon={activeClientNavItem?.icon}
      label={activeClientNavItem?.label}
    />
  );
}
