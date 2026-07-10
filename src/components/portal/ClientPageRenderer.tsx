import { mailboxOAuthRedirectUrl } from '../../services/mailboxOAuthSettings';
import { emailProviderLabels, initialEmailTemplates, libraryCategories, libraryFormats } from '../../appSeeds';
import type { ClientPage } from '../../appTypes';
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

type ClientPageRendererProps = {
  renderedClientPage: ClientPage;
  context: Record<string, any>;
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
    filteredMaterialRows,
    initialMaterialRows,
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
    unreadEmailCount,
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
        onOpenMaterialEditor={materialWorkflow.openMaterialEditor ?? context.openMaterialEditor}
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
