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
import type { PortalAccountPage } from './PortalAccountPage';

type SupportRequestDraft = Pick<NewSupportTicketForm, 'kind' | 'priority' | 'subject' | 'message'>;

export type CalendarDay = {
  key: string;
  label: string;
  date: string;
  isoDate: string;
  day: number;
  month: number;
};

export type CalendarJob = JobCardData & {
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

export type ClientPageRendererBusinessContext = Pick<ClientPageRendererContext,
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

export type ClientPageRendererMapContext = Pick<ClientPageRendererContext,
  | 'mapModel'
  | 'mapSearch'
  | 'mapStatusFilter'
  | 'mapTechFilter'
  | 'resetMapFilters'
  | 'setMapSearch'
  | 'setMapStatusFilter'
  | 'setMapTechFilter'
>;

export type ClientPageRendererOperationsContext = Pick<ClientPageRendererContext,
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

export type ClientPageRendererShellContext = Pick<ClientPageRendererContext,
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

export type ClientPageRendererContextGroups = {
  business: ClientPageRendererBusinessContext;
  map: ClientPageRendererMapContext;
  operations: ClientPageRendererOperationsContext;
  shell: ClientPageRendererShellContext;
};
