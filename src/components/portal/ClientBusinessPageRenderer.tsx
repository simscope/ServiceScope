import { mailboxOAuthRedirectUrl } from '../../services/mailboxOAuthSettings';
import { emailProviderLabels, initialEmailTemplates, libraryCategories, libraryFormats } from '../../appSeeds';
import type { ClientPage } from '../../appTypes';
import { EmailPage } from './EmailPage';
import { EmployeeFinancePage } from './EmployeeFinancePage';
import { BusinessAnalyticsPage } from './BusinessAnalyticsPage';
import { KnowledgePage } from './KnowledgePage';
import { OnboardingPage } from './OnboardingPage';
import { PortalAccountPage } from './PortalAccountPage';
import type {
  ClientPageRendererBusinessContext,
  ClientPageRendererOperationsContext,
  ClientPageRendererShellContext,
} from './clientPageRendererTypes';

type ClientBusinessPageRendererProps = {
  renderedClientPage: ClientPage;
  business: ClientPageRendererBusinessContext;
  operations: ClientPageRendererOperationsContext;
  shell: ClientPageRendererShellContext;
};

export function ClientBusinessPageRenderer({
  renderedClientPage,
  business,
  operations,
  shell,
}: ClientBusinessPageRendererProps) {
  const {
    applyEmailTemplate,
    companyEmailSignature,
    companyPaymentBlock,
    configuredProfessionNames,
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
    libraryFeature,
    loadMoreMailboxMessages,
    mailBoxStatusProps,
    onboardingAdminFeature,
    onboardingProfileActions,
    paymentMethodOptions,
    payrollRules,
    professionTemplates,
    setClientPage,
    setEmailCompose,
    setEmailFolder,
    setEmailSearch,
    setFinancePeriod,
    setFinanceTechFilter,
    setPayrollRules,
  } = business;
  const {
    allJobsRows,
    invoiceActions,
    jobActions,
    materialWorkflow,
    materials,
    openedJob,
    setOpenedJob,
  } = operations;
  const {
    billingStatus,
    completedSteps,
    currentPortalUser,
    openTickets,
    profile,
    request,
    requestTouched,
    setRequest,
    selectedCompany,
    selectedCompanyId,
    supportActions,
    tickets,
  } = shell;

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
        onEmailFolderChange={setEmailFolder}
        emailSearch={emailSearch}
        onEmailSearchChange={setEmailSearch}
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

  if (renderedClientPage === 'finances') {
    return (
      <EmployeeFinancePage
        companyId={selectedCompanyId}
        openedJob={openedJob}
        profile={profile}
        paymentMethodOptions={paymentMethodOptions}
        materials={materials}
        jobs={allJobsRows}
        currentPortalUser={currentPortalUser}
        onCloseJob={() => setOpenedJob(null)}
        onSaveJob={jobActions.handleSaveJob}
        onSaveMaterials={materialWorkflow.saveJobMaterials}
        onCreateInvoice={invoiceActions.handleCreateInvoice}
        onDeleteInvoice={invoiceActions.handleDeleteInvoice}
        onComposeEmail={emailActions.openEmailCompose}
        financePeriod={financePeriod}
        onFinancePeriodChange={setFinancePeriod}
        financeTechFilter={financeTechFilter}
        onFinanceTechFilterChange={setFinanceTechFilter}
        payrollRules={payrollRules}
        onPayrollRulesChange={setPayrollRules}
        onOpenJob={setOpenedJob}
      />
    );
  }

  if (renderedClientPage === 'aiBusiness') {
    return (
      <BusinessAnalyticsPage
        selectedCompanyId={selectedCompanyId}
        accessLevel={shell.activePageAccessLevel}
        onNavigateClientPage={setClientPage}
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
        completedSteps={completedSteps}
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
        billingStatus={billingStatus}
        onConnectSubscriptionBilling={onboardingProfileActions.connectSubscriptionBilling}
      />
    );
  }

  return null;
}
