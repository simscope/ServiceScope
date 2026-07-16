import type { ClientPage } from '../../appTypes';
import { CalendarPage } from './CalendarPage';
import { MaterialsPage } from './MaterialsPage';
import { TasksPage } from './TasksPage';
import type {
  ClientPageRendererBusinessContext,
  ClientPageRendererOperationsContext,
  ClientPageRendererShellContext,
} from './clientPageRendererTypes';

type ClientOperationsPageRendererProps = {
  renderedClientPage: ClientPage;
  operations: ClientPageRendererOperationsContext;
  business: ClientPageRendererBusinessContext;
  shell: ClientPageRendererShellContext;
};

export function ClientOperationsPageRenderer({
  renderedClientPage,
  operations,
  business,
  shell,
}: ClientOperationsPageRendererProps) {
  const {
    activeCalendarTech,
    allCalendarDays,
    allJobsRows,
    calendarActions,
    calendarAnchor,
    calendarDropSlots,
    calendarMonthDays,
    calendarRangeTitle,
    calendarSlots,
    calendarView,
    closeMaterialEditor,
    invoiceActions,
    jobActions,
    jobStatusFilters,
    materialDraftRows,
    materialSearch,
    materialJobStatusFilter,
    materialStatusFilter,
    materialStatuses,
    materialTechFilter,
    materialWorkflow,
    materials,
    monthDropRequest,
    openMaterialEditor,
    openedJob,
    resetMaterialFilters,
    setActiveCalendarTech,
    setCalendarView,
    setMaterialSearch,
    setMaterialJobStatusFilter,
    setMaterialStatusFilter,
    setMaterialTechFilter,
    setMonthDropRequest,
    setOpenedJob,
    tasksFeature,
    unassignedCalendarJobs,
    updateMaterialDraft,
    removeMaterialDraftRow,
    addMaterialDraftRow,
    visibleCalendarDays,
    visibleCalendarJobs,
  } = operations;
  const { emailActions, paymentMethodOptions } = business;
  const { currentPortalUser, profile, selectedCompanyId } = shell;

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
        companyId={selectedCompanyId}
        materials={materials}
        jobsWithoutMaterials={materialWorkflow.filteredJobsWithoutMaterials}
        materialsTotal={materialWorkflow.materialsTotal}
        materialStatusFilter={materialStatusFilter}
        materialJobStatusFilter={materialJobStatusFilter}
        onMaterialJobStatusFilterChange={setMaterialJobStatusFilter}
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
        onSaveMaterials={materialWorkflow.saveJobMaterials}
        onWarehouseStockIssued={materialWorkflow.reloadMaterials}
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

  return null;
}
