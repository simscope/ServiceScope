import type { ClientPage } from '../../appTypes';
import { CalendarPage } from './CalendarPage';
import { MaterialsPage } from './MaterialsPage';
import { TasksPage } from './TasksPage';
import type { ClientPageRendererContext } from './clientPageRendererTypes';

type ClientOperationsPageRendererProps = {
  renderedClientPage: ClientPage;
  context: ClientPageRendererContext;
};

export function ClientOperationsPageRenderer({ renderedClientPage, context }: ClientOperationsPageRendererProps) {
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
    currentPortalUser,
    emailActions,
    invoiceActions,
    jobActions,
    jobStatusFilters,
    materialDraftRows,
    materialSearch,
    materialStatusFilter,
    materialStatuses,
    materialTechFilter,
    materialWorkflow,
    materials,
    monthDropRequest,
    openMaterialEditor,
    openedJob,
    paymentMethodOptions,
    profile,
    resetMaterialFilters,
    setActiveCalendarTech,
    setCalendarView,
    setMaterialSearch,
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
  } = context;

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

  return null;
}
