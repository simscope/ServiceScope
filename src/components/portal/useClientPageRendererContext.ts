import { useMemo } from 'react';
import type { ClientPageRendererContext } from './clientPageRendererTypes';

type ClientPageRendererContextGroups = {
  business: Pick<ClientPageRendererContext,
    | 'applyEmailTemplate'
    | 'companyEmailSignature'
    | 'companyPaymentBlock'
    | 'configuredProfessionNames'
    | 'emailActions'
    | 'emailCompose'
    | 'emailComposeAttachments'
    | 'emailComposeRequestId'
    | 'emailConnection'
    | 'emailFolder'
    | 'emailMessages'
    | 'emailModel'
    | 'emailSearch'
    | 'financePeriod'
    | 'financeTechFilter'
    | 'financeWorkflow'
    | 'libraryFeature'
    | 'loadMoreMailboxMessages'
    | 'mailBoxStatusProps'
    | 'onboardingAdminFeature'
    | 'onboardingProfileActions'
    | 'paymentMethodOptions'
    | 'payrollRules'
    | 'professionTemplates'
    | 'setClientPage'
    | 'setEmailCompose'
    | 'setEmailFolder'
    | 'setEmailSearch'
    | 'setFinancePeriod'
    | 'setFinanceTechFilter'
    | 'setPayrollRules'
  >;
  map: Pick<ClientPageRendererContext,
    | 'mapModel'
    | 'mapSearch'
    | 'mapStatusFilter'
    | 'mapTechFilter'
    | 'resetMapFilters'
    | 'setMapSearch'
    | 'setMapStatusFilter'
    | 'setMapTechFilter'
  >;
  operations: Pick<ClientPageRendererContext,
    | 'activeCalendarTech'
    | 'activeJobsRows'
    | 'allCalendarDays'
    | 'allJobsGroups'
    | 'allJobsRows'
    | 'allJobsVisibility'
    | 'calendarActions'
    | 'calendarAnchor'
    | 'calendarDropSlots'
    | 'calendarMonthDays'
    | 'calendarRangeTitle'
    | 'calendarSlots'
    | 'calendarView'
    | 'closeMaterialEditor'
    | 'inlineJobDrafts'
    | 'invoiceActions'
    | 'jobActions'
    | 'jobInboxFeature'
    | 'jobStatusFilters'
    | 'materialDraftRows'
    | 'materialSearch'
    | 'materialStatusFilter'
    | 'materialStatuses'
    | 'materialTechFilter'
    | 'materialWorkflow'
    | 'materials'
    | 'monthDropRequest'
    | 'nextJobNumber'
    | 'openMaterialEditor'
    | 'openedJob'
    | 'paidJobsRows'
    | 'resetMaterialFilters'
    | 'selectedJobPrefix'
    | 'selectedJobType'
    | 'selectedJobTypeId'
    | 'setActiveCalendarTech'
    | 'setAllJobsVisibility'
    | 'setCalendarView'
    | 'setMaterialSearch'
    | 'setMaterialStatusFilter'
    | 'setMaterialTechFilter'
    | 'setMonthDropRequest'
    | 'setOpenedJob'
    | 'setSelectedJobTypeId'
    | 'tasksFeature'
    | 'unassignedCalendarJobs'
    | 'updateInlineJobDraft'
    | 'updateMaterialDraft'
    | 'removeMaterialDraftRow'
    | 'addMaterialDraftRow'
    | 'visibleCalendarDays'
    | 'visibleCalendarJobs'
  >;
  shell: Pick<ClientPageRendererContext,
    | 'activeClientNavItem'
    | 'activePageReadOnly'
    | 'billingStatus'
    | 'completedSteps'
    | 'currentPortalUser'
    | 'openTickets'
    | 'profile'
    | 'request'
    | 'requestTouched'
    | 'selectedCompany'
    | 'selectedCompanyId'
    | 'setRequest'
    | 'supportActions'
    | 'tickets'
  >;
};

export function useClientPageRendererContext(groups: ClientPageRendererContextGroups): ClientPageRendererContext {
  const context: ClientPageRendererContext = {
    ...groups.shell,
    ...groups.operations,
    ...groups.business,
    ...groups.map,
  };

  return useMemo(() => context, [
    context.activeCalendarTech,
    context.activeClientNavItem,
    context.activeJobsRows,
    context.activePageReadOnly,
    context.allCalendarDays,
    context.allJobsGroups,
    context.allJobsRows,
    context.allJobsVisibility,
    context.applyEmailTemplate,
    context.billingStatus,
    context.calendarActions,
    context.calendarAnchor,
    context.calendarDropSlots,
    context.calendarMonthDays,
    context.calendarRangeTitle,
    context.calendarSlots,
    context.calendarView,
    context.closeMaterialEditor,
    context.companyEmailSignature,
    context.companyPaymentBlock,
    context.completedSteps,
    context.configuredProfessionNames,
    context.currentPortalUser,
    context.emailActions,
    context.emailCompose,
    context.emailComposeAttachments,
    context.emailComposeRequestId,
    context.emailConnection,
    context.emailFolder,
    context.emailMessages,
    context.emailModel,
    context.emailSearch,
    context.financePeriod,
    context.financeTechFilter,
    context.financeWorkflow,
    context.inlineJobDrafts,
    context.invoiceActions,
    context.jobActions,
    context.jobInboxFeature,
    context.jobStatusFilters,
    context.libraryFeature,
    context.loadMoreMailboxMessages,
    context.mailBoxStatusProps.mailboxConnectStatus,
    context.mailBoxStatusProps.mailboxOAuthSecretDraft,
    context.mailBoxStatusProps.mailboxOAuthStatus,
    context.mailBoxStatusProps.mailboxSyncing,
    context.mailBoxStatusProps.setMailboxOAuthSecretDraft,
    context.mapModel,
    context.mapSearch,
    context.mapStatusFilter,
    context.mapTechFilter,
    context.materialDraftRows,
    context.materialSearch,
    context.materialStatusFilter,
    context.materialStatuses,
    context.materialTechFilter,
    context.materialWorkflow,
    context.materials,
    context.monthDropRequest,
    context.nextJobNumber,
    context.onboardingAdminFeature,
    context.onboardingProfileActions,
    context.openMaterialEditor,
    context.openedJob,
    context.openTickets,
    context.paidJobsRows,
    context.paymentMethodOptions,
    context.payrollRules,
    context.professionTemplates,
    context.profile,
    context.request,
    context.requestTouched,
    context.resetMapFilters,
    context.resetMaterialFilters,
    context.selectedCompany,
    context.selectedCompanyId,
    context.selectedJobPrefix,
    context.selectedJobType,
    context.selectedJobTypeId,
    context.setActiveCalendarTech,
    context.setAllJobsVisibility,
    context.setCalendarView,
    context.setClientPage,
    context.setEmailCompose,
    context.setEmailFolder,
    context.setEmailSearch,
    context.setFinancePeriod,
    context.setFinanceTechFilter,
    context.setMapSearch,
    context.setMapStatusFilter,
    context.setMapTechFilter,
    context.setMaterialSearch,
    context.setMaterialStatusFilter,
    context.setMaterialTechFilter,
    context.setMonthDropRequest,
    context.setOpenedJob,
    context.setPayrollRules,
    context.setRequest,
    context.setSelectedJobTypeId,
    context.supportActions,
    context.tasksFeature,
    context.tickets,
    context.unassignedCalendarJobs,
    context.updateInlineJobDraft,
    context.updateMaterialDraft,
    context.removeMaterialDraftRow,
    context.addMaterialDraftRow,
    context.visibleCalendarDays,
    context.visibleCalendarJobs,
  ]);
}
