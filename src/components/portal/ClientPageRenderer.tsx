import { mailboxOAuthRedirectUrl } from '../../services/mailboxOAuthSettings';
import { emailProviderLabels, initialEmailTemplates, libraryCategories, libraryFormats } from '../../appSeeds';
import type { ClientPage } from '../../appTypes';
import { ClientPlaceholderPage } from './ClientPlaceholderPage';
import { EmailPage } from './EmailPage';
import { FinancePage } from './FinancePage';
import { KnowledgePage } from './KnowledgePage';
import { MapPage } from './MapPage';
import { OnboardingPage } from './OnboardingPage';
import { PortalAccountPage } from './PortalAccountPage';
import { ClientJobsPageRenderer } from './ClientJobsPageRenderer';
import { ClientOperationsPageRenderer } from './ClientOperationsPageRenderer';
import type { ClientPageRendererContext } from './clientPageRendererTypes';

type ClientPageRendererProps = {
  renderedClientPage: ClientPage;
  context: ClientPageRendererContext;
};

export function ClientPageRenderer({ renderedClientPage, context }: ClientPageRendererProps) {
  const {
    activeClientNavItem,
    allJobsRows,
    applyEmailTemplate,
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
    invoiceActions,
    jobActions,
    libraryFeature,
    loadMoreMailboxMessages,
    mailBoxStatusProps,
    mapModel,
    mapSearch,
    mapStatusFilter,
    mapTechFilter,
    materialWorkflow,
    materials,
    onboardingAdminFeature,
    onboardingProfileActions,
    openedJob,
    openTickets,
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
    setClientPage,
    setEmailCompose,
    setFinancePeriod,
    setFinanceTechFilter,
    setMapSearch,
    setMapStatusFilter,
    setMapTechFilter,
    setOpenedJob,
    setPayrollRules,
    setRequest,
    supportActions,
    tickets,
  } = context;

  const jobsPage = ClientJobsPageRenderer({ renderedClientPage, context });
  if (jobsPage) {
    return jobsPage;
  }

  const operationsPage = ClientOperationsPageRenderer({ renderedClientPage, context });
  if (operationsPage) {
    return operationsPage;
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
