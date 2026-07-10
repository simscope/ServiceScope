import type { ClientPage } from '../../appTypes';
import { JobInboxPage } from '../../features/job-inbox/JobInboxPage';
import { DebtorsPage } from './DebtorsPage';
import { ImportPage } from './ImportPage';
import { AllJobsPage, JobsPage } from './JobsPages';
import type { ClientPageRendererContext } from './clientPageRendererTypes';

type ClientJobsPageRendererProps = {
  renderedClientPage: ClientPage;
  context: ClientPageRendererContext;
};

export function ClientJobsPageRenderer({ renderedClientPage, context }: ClientJobsPageRendererProps) {
  const {
    activeJobsRows,
    activePageReadOnly,
    allJobsGroups,
    allJobsRows,
    allJobsVisibility,
    currentPortalUser,
    emailActions,
    inlineJobDrafts,
    invoiceActions,
    jobActions,
    jobInboxFeature,
    jobStatusFilters,
    materialWorkflow,
    materials,
    nextJobNumber,
    openedJob,
    paidJobsRows,
    paymentMethodOptions,
    profile,
    selectedCompany,
    selectedJobPrefix,
    selectedJobType,
    selectedJobTypeId,
    setAllJobsVisibility,
    setOpenedJob,
    setSelectedJobTypeId,
    updateInlineJobDraft,
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

  return null;
}
