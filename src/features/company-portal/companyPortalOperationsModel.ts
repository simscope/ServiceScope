import type { Dispatch, SetStateAction } from 'react';
import type { ClientPage } from '../../appTypes';
import type { JobCardData } from '../../components/JobCard';
import type { CompanyOnboardingProfile, CompanyPortalAccessPage, MaterialRow, ServiceJob } from '../../types';
import { makeCalendarActions } from '../calendar/calendarActions';
import { makeCalendarModel, type CalendarDropSlot } from '../calendar/calendarModel';
import { makeCalendarPersistence } from '../calendar/calendarPersistence';
import type { CalendarAssignment, CalendarResizeState, CalendarView, MonthDropRequest } from '../calendar/useCalendarFeature';
import type { useJobInboxFeature } from '../job-inbox/useJobInboxFeature';
import { makeJobActions } from '../jobs/jobActions';
import { makeJobModel } from '../jobs/jobModel';
import { makeInvoiceActions } from '../finance/invoiceActions';
import { makeMaterialWorkflow } from '../materials/materialWorkflow';
import type { MaterialJobStatusFilter } from '../materials/useMaterialsFeature';

type CompanyPortalOperationsInput = {
  activeCalendarTech: string;
  activeCompanyId: string;
  allJobsVisibility: 'active' | 'paid' | 'all';
  calendarAnchorDate: string;
  calendarAssignments: Record<string, CalendarAssignment>;
  calendarView: CalendarView;
  closeMaterialEditor: () => void;
  draggingJobNumber: string;
  editingMaterialsJobNumber: string;
  inlineJobDrafts: Record<string, Partial<ServiceJob>>;
  jobInboxFeature: ReturnType<typeof useJobInboxFeature>;
  jobs: ServiceJob[];
  materialDraftRows: MaterialRow[];
  materialSearch: string;
  materialStatusFilter: 'all' | MaterialRow['status'];
  materialJobStatusFilter: MaterialJobStatusFilter;
  materialTechFilter: string;
  materials: MaterialRow[];
  monthDropRequest: MonthDropRequest | null;
  openJobs: number;
  profile: CompanyOnboardingProfile;
  selectedJobTypeId: string;
  setCalendarAnchorDate: Dispatch<SetStateAction<string>>;
  setCalendarAssignments: Dispatch<SetStateAction<Record<string, CalendarAssignment>>>;
  setClientPage: Dispatch<SetStateAction<ClientPage>>;
  setDraggingJobNumber: Dispatch<SetStateAction<string>>;
  setInlineJobDrafts: Dispatch<SetStateAction<Record<string, Partial<ServiceJob>>>>;
  setJobs: Dispatch<SetStateAction<ServiceJob[]>>;
  setJobsStatus: Dispatch<SetStateAction<string>>;
  setMaterials: Dispatch<SetStateAction<MaterialRow[]>>;
  setMaterialDraftRows: Dispatch<SetStateAction<MaterialRow[]>>;
  setMonthDropRequest: Dispatch<SetStateAction<MonthDropRequest | null>>;
  setOpenedJob: Dispatch<SetStateAction<JobCardData | null>>;
  setResizingJob: Dispatch<SetStateAction<CalendarResizeState | null>>;
  stopCompanyWrite: (page: CompanyPortalAccessPage, action: string) => boolean;
};

export function makeCompanyPortalOperationsModel({
  activeCalendarTech,
  activeCompanyId,
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
  materialJobStatusFilter,
  materialTechFilter,
  materials,
  monthDropRequest,
  openJobs,
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
  setMaterialDraftRows,
  setMonthDropRequest,
  setOpenedJob,
  setResizingJob,
  stopCompanyWrite,
}: CompanyPortalOperationsInput) {
  const jobModel = makeJobModel({
    jobs,
    openJobs,
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

  const materialWorkflow = makeMaterialWorkflow({
    companyId: activeCompanyId,
    materials,
    materialStatusFilter,
    materialJobStatusFilter,
    jobTypes: profile.jobTypes,
    materialTechFilter,
    materialSearch,
    editingMaterialsJobNumber,
    materialDraftRows,
    allJobsRows,
    activeJobsRows,
    setMaterials,
    setMaterialDraftRows,
    setJobsStatus,
    closeMaterialEditor,
    stopMaterialsWrite: (action) => stopCompanyWrite('materials', action),
  });

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

  const calendarPersistence = makeCalendarPersistence({
    companyId: activeCompanyId,
    jobs,
    calendarDropSlots,
    setJobs,
    setOpenedJob,
    setCalendarAssignments,
    setStatus: setJobsStatus,
    stopCalendarWrite: (action) => stopCompanyWrite('calendar', action),
  });

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
    setStatus: setJobsStatus,
    setOpenedJob,
    persistCalendarAssignment: calendarPersistence.persistCalendarAssignment,
  });

  const invoiceActions = makeInvoiceActions({
    companyId: activeCompanyId,
    setJobs,
    setOpenedJob,
    stopFinanceWrite: (action) => stopCompanyWrite('finances', action),
  });

  const jobActions = makeJobActions({
    companyId: activeCompanyId,
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

  return {
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
  };
}
