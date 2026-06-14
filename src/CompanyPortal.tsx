import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import type { DragEvent, PointerEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Box,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  Database,
  FileClock,
  Inbox,
  LayoutDashboard,
  MailPlus,
  Map,
  PackageCheck,
  Plus,
  Rocket,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  completeOnboardingStep,
  createCompany,
  listCompanies,
  onboardingStepOrder,
  prepareNextOnboardingStep,
  saveCompanies,
} from './services/tenantStore';
import {
  addOwnerReply,
  createSupportTicket,
  listSupportTickets,
  saveSupportTickets,
  updateSupportTicketStatus,
} from './services/supportStore';
import { applyPlan, plans } from './services/billingCatalog';
import { JobCard, type JobCardData } from './components/JobCard';
import { JobDetailPanel } from './components/JobDetailPanel';
import { CalendarPage } from './components/portal/CalendarPage';
import { EmailPage } from './components/portal/EmailPage';
import { FinancePage } from './components/portal/FinancePage';
import { AllJobsPage, JobsPage } from './components/portal/JobsPages';
import { KnowledgePage } from './components/portal/KnowledgePage';
import { MapPage } from './components/portal/MapPage';
import { MaterialsPage } from './components/portal/MaterialsPage';
import { OnboardingPage } from './components/portal/OnboardingPage';
import { TasksPage } from './components/portal/TasksPage';
import {
  AccessPage,
  AuditPage,
  BillingPage,
  CompanyDetail,
  CompanyRow,
  DashboardOverview,
  MetricCard,
  MiniStat,
  StatusPill,
  SupportPanel,
} from './components/OwnerPages';
import {
  createPlatformUser,
  listPlatformUsers,
  rolePermissions,
  savePlatformUsers,
  SYSTEM_OWNER_ID,
  updatePlatformUserRole,
  updatePlatformUserStatus,
} from './services/accessStore';
import {
  createAuditEvent,
  filterAuditEvents,
  listAuditEvents,
  saveAuditEvents,
} from './services/auditStore';
import {
  createCompanyJobType,
  createDefaultCompanyOnboardingProfile,
  createCompanyTechnician,
  listCompanyOnboardingProfiles,
  makeJobTypes,
  saveCompanyOnboardingProfiles,
} from './services/companyOnboardingStore';
import { createServiceJob, listCompanyJobs, saveCompanyJobs } from './services/jobsStore';
import type {
  AuditEvent,
  AuditEventCategory,
  BillingStatus,
  Company,
  CompanyPlan,
  CompanyStatus,
  NewPlatformUserForm,
  NewSupportTicketForm,
  NewCompanyForm,
  NewCompanyJobTypeForm,
  NewCompanyTechnicianForm,
  OnboardingStepKey,
  SupportTicket,
  SupportTicketKind,
  SupportTicketPriority,
  SupportTicketStatus,
  PlatformUser,
  PlatformUserRole,
  PlatformUserStatus,
  CompanyOnboardingProfile,
  CompanyPaymentMethod,
  CompanyTechnicianRole,
  MaterialRow,
  NewServiceJobForm,
  ServiceJob,
  ServiceJobStatus,
} from './types';
import {
  auditCategoryLabels,
  billingLabels,
  paymentMethodLabels,
  platformRoleLabels,
  platformStatusLabels,
  statusLabels,
  ticketKindLabels,
  ticketPriorityLabels,
  ticketStatusLabels,
} from './appLabels';
import {
  emailProviderLabels,
  emptyAccessForm,
  emptyCompany,
  emptyJobTypeForm,
  emptySupportForm,
  emptyTaskForm,
  emptyTechnicianForm,
  initialEmailTemplates,
  initialLibraryDocuments,
  initialManualTasks,
  initialMaterialRows,
  libraryCategories,
  libraryFormats,
} from './appSeeds';
import type {
  AppPage,
  ClientPage,
  CompanyOnboardingStepKey,
  EmailCompose,
  EmailConnection,
  EmailFolder,
  EmailMessage,
  EmailProvider,
  EmailTemplate,
  FinancePeriod,
  LibraryCategory,
  LibraryDocument,
  LibraryDraft,
  LibraryFormat,
  PayrollRules,
  TaskForm,
  TaskPriority,
  TaskRow,
  TaskStatus,
} from './appTypes';
import { emptyMaterialDraft } from './appTypes';
import { addDays, addMonths, formatCalendarDay, parseLocalDate, startOfWeek, toLocalIsoDate } from './utils/calendar';
import { googleRouteUrl, isCustomerJobPaid, money, statusClassName } from './utils/format';


export function CompanyLogin({
  companies,
  email,
  onEmailChange,
  onSelectCompany,
}: {
  companies: Company[];
  email: string;
  onEmailChange: (email: string) => void;
  onSelectCompany: (companyId: string) => void;
}) {
  const matchingCompanies = companies.filter((company) =>
    !email.trim() || company.ownerEmail.toLowerCase().includes(email.trim().toLowerCase()),
  );

  return (
    <div className="company-login">
      <section className="company-login-card">
        <div className="brand-lockup company-brand">
          <div className="brand-mark">
            <ShieldCheck size={22} aria-hidden="true" />
          </div>
          <div>
            <strong>ServiceScope</strong>
            <span>Company Access</span>
          </div>
        </div>

        <div className="login-heading">
          <p className="eyebrow">Company login</p>
          <h1>Enter your workspace</h1>
          <p>Companies use this separate entrance to send requests, check launch status, and track support replies.</p>
        </div>

        <label>
          Owner email
          <input type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="owner@company.com" />
        </label>

        <div className="login-company-list">
          {matchingCompanies.map((company) => (
            <button className="login-company-row" type="button" key={company.id} onClick={() => onSelectCompany(company.id)}>
              <div className="company-main">
                <div className="company-avatar">{company.name.slice(0, 2).toUpperCase()}</div>
                <div>
                  <h3>{company.name}</h3>
                  <p>{company.ownerEmail}</p>
                </div>
              </div>
              <StatusPill status={company.status} />
            </button>
          ))}
          {!matchingCompanies.length ? (
            <div className="empty-state compact-empty">
              <Building2 size={24} aria-hidden="true" />
              <h3>No company found</h3>
              <p>Check the owner email or ask ServiceScope support to verify access.</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function CompanyPortal({
  selectedCompany,
  onboardingProfile,
  signedInUser,
  tickets,
  onSignOut,
  onUpdateOnboardingProfile,
  onCreateRequest,
}: {
  selectedCompany?: Company;
  onboardingProfile?: CompanyOnboardingProfile;
  signedInUser?: { name: string; role: 'Manager' | 'Admin' | 'Technician' };
  tickets: SupportTicket[];
  onSignOut: () => void;
  onUpdateOnboardingProfile: (profile: CompanyOnboardingProfile) => void;
  onCreateRequest: (request: Pick<NewSupportTicketForm, 'kind' | 'priority' | 'subject' | 'message'>) => void;
}) {
  const [clientPage, setClientPage] = useState<ClientPage>('jobs');
  const [request, setRequest] = useState<Pick<NewSupportTicketForm, 'kind' | 'priority' | 'subject' | 'message'>>({
    kind: 'change',
    priority: 'normal',
    subject: '',
    message: '',
  });
  const [technicianForm, setTechnicianForm] = useState<NewCompanyTechnicianForm>(emptyTechnicianForm);
  const [jobTypeForm, setJobTypeForm] = useState<NewCompanyJobTypeForm>(emptyJobTypeForm);
  const [openedJob, setOpenedJob] = useState<JobCardData | null>(null);
  const [jobs, setJobs] = useState<ServiceJob[]>([]);
  const [inlineJobDrafts, setInlineJobDrafts] = useState<Record<string, Partial<ServiceJob>>>({});
  const [allJobsVisibility, setAllJobsVisibility] = useState<'active' | 'paid' | 'all'>('active');
  const [selectedJobTypeId, setSelectedJobTypeId] = useState('');
  const [calendarView, setCalendarView] = useState<'month' | 'week' | 'day'>('week');
  const [calendarAnchorDate, setCalendarAnchorDate] = useState(() => toLocalIsoDate(new Date()));
  const [activeCalendarTech, setActiveCalendarTech] = useState('all');
  const [calendarAssignments, setCalendarAssignments] = useState<Record<string, { assignee: string; dayKey: string; time: string; durationMinutes: number }>>({});
  const [draggingJobNumber, setDraggingJobNumber] = useState('');
  const [resizingJob, setResizingJob] = useState<{ jobNumber: string; startY: number; startDuration: number } | null>(null);
  const [monthDropRequest, setMonthDropRequest] = useState<{ jobNumber: string; assignee: string; dayKey: string; durationMinutes: number; time: string } | null>(null);
  const [materials, setMaterials] = useState<MaterialRow[]>(initialMaterialRows);
  const [materialStatusFilter, setMaterialStatusFilter] = useState<'all' | MaterialRow['status']>('all');
  const [materialTechFilter, setMaterialTechFilter] = useState('all');
  const [materialSearch, setMaterialSearch] = useState('');
  const [editingMaterialsJobNumber, setEditingMaterialsJobNumber] = useState('');
  const [materialDraftRows, setMaterialDraftRows] = useState<MaterialRow[]>([]);
  const [manualTasks, setManualTasks] = useState<TaskRow[]>(initialManualTasks);
  const [completedAutoTaskIds, setCompletedAutoTaskIds] = useState<string[]>([]);
  const [taskForm, setTaskForm] = useState<TaskForm>(emptyTaskForm);
  const [taskStatusFilter, setTaskStatusFilter] = useState<'all' | TaskStatus>('all');
  const [taskOwnerFilter, setTaskOwnerFilter] = useState('all');
  const [taskSearch, setTaskSearch] = useState('');
  const [mapTechFilter, setMapTechFilter] = useState('all');
  const [mapStatusFilter, setMapStatusFilter] = useState('all');
  const [mapSearch, setMapSearch] = useState('');
  const [emailConnection, setEmailConnection] = useState<EmailConnection | null>(null);
  const [emailFolder, setEmailFolder] = useState<EmailFolder>('inbox');
  const [emailSearch, setEmailSearch] = useState('');
  const [emailCompose, setEmailCompose] = useState<EmailCompose>({
    to: '',
    subject: '',
    body: '',
    jobNumber: '',
  });
  const [financePeriod, setFinancePeriod] = useState<FinancePeriod>('this_month');
  const [financeTechFilter, setFinanceTechFilter] = useState('all');
  const [payrollRules, setPayrollRules] = useState<PayrollRules>({
    commissionPercent: 50,
    scfOnlyPayout: 50,
    deductMaterials: true,
    includeScf: true,
  });
  const [salaryPaidJobs, setSalaryPaidJobs] = useState<Record<string, string>>({ '243': '2026-06-01' });
  const [libraryDocuments, setLibraryDocuments] = useState<LibraryDocument[]>(initialLibraryDocuments);
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryCategoryFilter, setLibraryCategoryFilter] = useState<'all' | LibraryCategory>('all');
  const [librarySystemFilter, setLibrarySystemFilter] = useState('all');
  const [libraryFormatFilter, setLibraryFormatFilter] = useState<'all' | LibraryFormat>('all');
  const [libraryDraft, setLibraryDraft] = useState<LibraryDraft>({
    title: '',
    category: 'Manual',
    system: 'HVAC',
    manufacturer: '',
    model: '',
    tags: '',
    fileName: '',
  });

  const defaultTechnicianName = onboardingProfile?.technicians[0]?.name ?? 'No technician';

  useEffect(() => {
    if (!selectedCompany) return;
    setJobs(listCompanyJobs(selectedCompany.id, defaultTechnicianName));
  }, [defaultTechnicianName, selectedCompany]);

  useEffect(() => {
    if (!resizingJob) return undefined;
    const activeResize = resizingJob;

    function handlePointerMove(event: globalThis.PointerEvent) {
      const deltaMinutes = Math.round((event.clientY - activeResize.startY) / 32) * 30;
      const durationMinutes = Math.min(720, Math.max(30, activeResize.startDuration + deltaMinutes));

      setCalendarAssignments((assignments) => {
        const assignment = assignments[activeResize.jobNumber];
        if (!assignment) return assignments;

        return {
          ...assignments,
          [activeResize.jobNumber]: {
            ...assignment,
            durationMinutes,
          },
        };
      });
    }

    function handlePointerUp() {
      setResizingJob(null);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [resizingJob]);

  if (!selectedCompany) {
    return (
      <div className="empty-state">
        <Building2 size={28} aria-hidden="true" />
        <h3>No tenant selected</h3>
        <p>Add a company first, then open the portal preview.</p>
      </div>
    );
  }

  const completedSteps = Object.values(selectedCompany.onboarding).filter((step) => step === 'done').length;
  const openTickets = tickets.filter((ticket) => ticket.status !== 'resolved');
  const profile = onboardingProfile ?? createDefaultCompanyOnboardingProfile(selectedCompany);
  const professionTemplates = makeJobTypes();
  const configuredProfessionNames = new Set(profile.jobTypes.map((jobType) => jobType.name.toLowerCase()));
  const defaultJobType = profile.jobTypes.find((jobType) => jobType.name === 'HVAC') ?? profile.jobTypes[0];
  const selectedJobType = profile.jobTypes.find((jobType) => jobType.id === selectedJobTypeId) ?? defaultJobType;
  const selectedJobPrefix = profile.useJobNumberPrefixes ? selectedJobType?.jobNumberPrefix || profile.jobNumberPrefix || 'JOB' : '';
  const highestJobNumber = jobs.reduce((highest, job) => {
    const lastPart = job.jobNumber.split('-').pop() ?? job.jobNumber;
    const numericJobNumber = Number(lastPart);
    return Number.isFinite(numericJobNumber) ? Math.max(highest, numericJobNumber) : highest;
  }, selectedCompany.openJobs);
  const nextJobNumber = String(highestJobNumber + 1).padStart(4, '0');
  const sampleJobNumber = selectedJobPrefix ? `${selectedJobPrefix}-${nextJobNumber}` : nextJobNumber;
  const sampleTechnician = profile.technicians[0]?.name ?? 'Unassigned';
  const sampleJob: JobCardData = {
    id: 'sample-job',
    companyId: selectedCompany.id,
    jobNumber: sampleJobNumber,
    status: 'New',
    system: selectedJobType?.name ?? 'HVAC',
    clientName: 'John Smith',
    organization: 'Sharewood Office',
    phone: '(555) 210-4420',
    email: 'client@example.com',
    address: '35 Box St, Brooklyn, NY 11222, USA',
    technician: sampleTechnician,
    assignee: sampleTechnician,
    serviceCallFee: money(profile.serviceCallFee),
    scfPayment: '',
    labor: '',
    laborPayment: '',
    issue: 'AC not cooling in the main office.',
    notes: '',
    attachments: [],
    comments: [],
    createdAt: new Date().toISOString().slice(0, 10),
  };
  const jobStatusFilters: ServiceJobStatus[] = ['New', 'ReCall', 'Diagnosis', 'In progress', 'Parts ordered', 'Waiting for parts', 'To finish', 'Completed', 'Warranty', 'Cancelled'];
  const allJobsRows = jobs;
  const activeJobsRows = allJobsRows.filter((job) => !isCustomerJobPaid(job));
  const paidJobsRows = allJobsRows.filter(isCustomerJobPaid);
  const visibleAllJobsRows = allJobsVisibility === 'paid' ? paidJobsRows : allJobsVisibility === 'all' ? allJobsRows : activeJobsRows;
  const allJobsGroups = Array.from(new Set(['No technician', ...allJobsRows.map((job) => job.assignee)])).map((technician) => ({
    technician,
    jobs: visibleAllJobsRows.filter((job) => job.assignee === technician),
  })).filter((group) => group.jobs.length > 0);
  const technicianLocations = profile.technicians.map((technician, index) => {
    const samples = [
      { x: 42, y: 61, lat: '40.72764', lng: '-74.05667', area: 'Hoboken / Jersey City', updatedAt: '11.06.2026, 21:39:58', online: false },
      { x: 55, y: 38, lat: '40.75892', lng: '-73.98513', area: 'Midtown Manhattan', updatedAt: '11.06.2026, 21:36:14', online: false },
      { x: 68, y: 70, lat: '40.67818', lng: '-73.94416', area: 'Brooklyn', updatedAt: '11.06.2026, 21:31:08', online: false },
    ];
    const sample = samples[index % samples.length];

    return {
      ...technician,
      ...sample,
      lastSeen: sample.updatedAt,
    };
  });
  const filteredTechnicianLocations = technicianLocations.filter((technician) => {
    const normalizedSearch = mapSearch.trim().toLowerCase();
    const matchesTech = mapTechFilter === 'all' || technician.name === mapTechFilter;
    const matchesGps = mapStatusFilter === 'all' || (mapStatusFilter === 'online' ? technician.online : !technician.online);
    const haystack = [technician.name, technician.email, technician.phone, technician.area, technician.lat, technician.lng]
      .join(' ')
      .toLowerCase();

    return matchesTech && matchesGps && (!normalizedSearch || haystack.includes(normalizedSearch));
  });
  const materialStatuses: MaterialRow['status'][] = ['Needed', 'Ordered', 'Received', 'Installed', 'Returned'];
  const materialJobMap = new globalThis.Map(allJobsRows.map((job) => [job.jobNumber, job]));
  const emailMessages: EmailMessage[] = [
    {
      id: 'mail-1',
      folder: 'inbox',
      from: 'ilona@example.com',
      to: emailConnection?.address ?? profile.billingEmail,
      subject: 'Re: Service request #244',
      preview: 'Can you confirm what time the technician will arrive?',
      jobNumber: '244',
      receivedAt: 'Today, 9:14 AM',
      unread: true,
    },
    {
      id: 'mail-2',
      folder: 'inbox',
      from: 'manager@fycflash.com',
      to: emailConnection?.address ?? profile.billingEmail,
      subject: 'Parts for hood repair',
      preview: 'Please send the estimate before ordering belts.',
      jobNumber: '243',
      receivedAt: 'Yesterday, 4:42 PM',
    },
    {
      id: 'mail-3',
      folder: 'sent',
      from: emailConnection?.address ?? profile.billingEmail,
      to: 'ricardo@example.com',
      subject: 'Service appointment confirmation',
      preview: 'Your technician is scheduled for the freezer diagnosis.',
      jobNumber: '242',
      receivedAt: 'Yesterday, 1:08 PM',
    },
  ];
  const visibleEmailMessages = emailMessages.filter((message) => {
    const normalizedSearch = emailSearch.trim().toLowerCase();
    const job = materialJobMap.get(message.jobNumber);
    const haystack = [message.from, message.to, message.subject, message.preview, message.jobNumber, job?.organization, job?.clientName]
      .join(' ')
      .toLowerCase();

    return message.folder === emailFolder && (!normalizedSearch || haystack.includes(normalizedSearch));
  });
  const connectMailbox = (provider: EmailProvider) => {
    const domain = selectedCompany.domain?.replace(/^https?:\/\//, '').split('.')[0] || selectedCompany.name.toLowerCase().replace(/\s+/g, '');
    const address = provider === 'smtp' ? `dispatch@${domain}.com` : selectedCompany.ownerEmail;

    setEmailConnection({
      provider,
      address,
      status: 'backend_required',
      lastSync: 'Not synced',
      syncRange: '30',
      autoLinkJobNumber: true,
      autoLinkClientEmail: true,
      createTaskFromUnread: true,
      senderName: profile.displayName || selectedCompany.name,
      replyTo: address,
      signature: `${profile.displayName || selectedCompany.name}\n${profile.phone || selectedCompany.ownerEmail}`,
      imapHost: provider === 'smtp' ? `imap.${domain}.com` : '',
      imapPort: provider === 'smtp' ? '993' : '',
      smtpHost: provider === 'smtp' ? `smtp.${domain}.com` : '',
      smtpPort: provider === 'smtp' ? '587' : '',
      security: provider === 'smtp' ? 'tls' : 'ssl',
      username: provider === 'smtp' ? address : '',
    });
  };
  const updateMailbox = (patch: Partial<EmailConnection>) => {
    setEmailConnection((connection) => (connection ? { ...connection, ...patch } : connection));
  };
  const applyEmailTemplate = (template: EmailTemplate) => {
    setEmailCompose((draft) => ({
      ...draft,
      subject: template.subject,
      body: template.body,
    }));
    setEmailFolder('inbox');
  };
  const sendEmailDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEmailCompose({ to: '', subject: '', body: '', jobNumber: '' });
  };
  const materialRowsWithJobs = materials
    .map((material) => ({ material, job: materialJobMap.get(material.jobNumber) }))
    .filter((row): row is { material: MaterialRow; job: typeof allJobsRows[number] } => Boolean(row.job));
  const filteredMaterialRows = materialRowsWithJobs.filter(({ material, job }) => {
    const normalizedSearch = materialSearch.trim().toLowerCase();
    const matchesStatus = materialStatusFilter === 'all' || material.status === materialStatusFilter;
    const matchesTech = materialTechFilter === 'all' || job.assignee === materialTechFilter;
    const haystack = [job.jobNumber, job.organization, job.clientName, job.phone, job.address, job.system, job.issue, material.name, material.supplier]
      .join(' ')
      .toLowerCase();

    return matchesStatus && matchesTech && (!normalizedSearch || haystack.includes(normalizedSearch));
  });
  const jobsWithoutMaterials = activeJobsRows.filter((job) => !materials.some((material) => material.jobNumber === job.jobNumber));
  const selectedMaterialsJob = materialJobMap.get(editingMaterialsJobNumber);
  const materialsTotal = filteredMaterialRows.reduce((sum, { material }) => sum + material.quantity * material.price, 0);
  const openMaterialEditor = (jobNumber: string) => {
    const existingRows = materials.filter((material) => material.jobNumber === jobNumber);
    setEditingMaterialsJobNumber(jobNumber);
    setMaterialDraftRows(existingRows.length ? existingRows.map((material) => ({ ...material })) : [emptyMaterialDraft(jobNumber)]);
  };
  const updateMaterialDraft = (rowId: string, patch: Partial<MaterialRow>) => {
    setMaterialDraftRows((rows) => rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  };
  const addMaterialDraftRow = () => {
    if (!editingMaterialsJobNumber) return;
    setMaterialDraftRows((rows) => [...rows, emptyMaterialDraft(editingMaterialsJobNumber)]);
  };
  const removeMaterialDraftRow = (rowId: string) => {
    setMaterialDraftRows((rows) => rows.filter((row) => row.id !== rowId));
  };
  const saveMaterialDraftRows = () => {
    if (!editingMaterialsJobNumber) return;
    const cleanRows = materialDraftRows
      .filter((row) => row.name.trim() || row.supplier.trim())
      .map((row) => ({
        ...row,
        jobNumber: editingMaterialsJobNumber,
        name: row.name.trim(),
        supplier: row.supplier.trim(),
        quantity: Math.max(1, Number(row.quantity) || 1),
        price: Math.max(0, Number(row.price) || 0),
      }));

    setMaterials((rows) => [
      ...rows.filter((row) => row.jobNumber !== editingMaterialsJobNumber),
      ...cleanRows,
    ]);
    setEditingMaterialsJobNumber('');
    setMaterialDraftRows([]);
  };
  const saveJobMaterials = (jobNumber: string, rows: MaterialRow[]) => {
    const cleanRows = rows
      .filter((row) => row.name.trim() || row.supplier.trim())
      .map((row) => ({
        ...row,
        jobNumber,
        name: row.name.trim(),
        supplier: row.supplier.trim(),
        quantity: Math.max(1, Number(row.quantity) || 1),
        price: Math.max(0, Number(row.price) || 0),
      }));

    setMaterials((currentRows) => [
      ...currentRows.filter((row) => row.jobNumber !== jobNumber),
      ...cleanRows,
    ]);
  };
  const financeRows = allJobsRows.map((job) => {
    const materialsCost = materials
      .filter((material) => material.jobNumber === job.jobNumber)
      .reduce((sum, material) => sum + material.quantity * material.price, 0);
    const scf = Number(job.serviceCallFee || 0);
    const labor = Number(job.labor || 0);
    const paidScf = job.scfPayment ? scf : 0;
    const paidLabor = job.laborPayment ? labor : 0;
    const onlyScf = paidScf > 0 && paidLabor === 0;
    const salaryBase = Math.max(0, (payrollRules.includeScf ? paidScf : 0) + paidLabor - (payrollRules.deductMaterials ? materialsCost : 0));
    const salary = onlyScf ? payrollRules.scfOnlyPayout : salaryBase * (payrollRules.commissionPercent / 100);
    const paidAt = salaryPaidJobs[job.jobNumber] ?? '';
    const paid = Boolean(paidAt);
    const warrantyEndTime = new Date(job.createdAt).getTime() + profile.warrantyDays * 24 * 60 * 60 * 1000;
    const warrantyPassed = warrantyEndTime <= Date.now();
    const payrollArchived = paid && warrantyPassed;
    const warnings = [
      job.assignee === 'No technician' ? 'No technician assigned' : '',
      scf > 0 && !job.scfPayment ? 'SCF payment is missing' : '',
      labor > 0 && !job.laborPayment ? 'Labor payment is missing' : '',
      materialsCost > paidScf + paidLabor ? 'Materials exceed collected payments' : '',
      !paid && salary === 0 ? 'No payable payroll yet' : '',
    ].filter(Boolean);
    const needsAttention = warnings.length > 0;

    return {
      ...job,
      materialsCost,
      paidScf,
      paidLabor,
      salaryBase,
      salary,
      paid,
      paidAt,
      warrantyPassed,
      payrollArchived,
      warnings,
      needsAttention,
    };
  });
  const financeBaseRows = financeRows.filter((job) => {
    const matchesTech = financeTechFilter === 'all' || job.assignee === financeTechFilter;
    const matchesPeriod =
      financePeriod === 'all' ||
      (financePeriod === 'this_week' ? job.createdAt >= '2026-06-07' : job.createdAt >= '2026-06-01');

    return matchesTech && matchesPeriod;
  });
  const financeSummary = financeBaseRows.reduce(
    (summary, job) => {
      summary.paidRevenue += job.paidScf + job.paidLabor;
      summary.materials += job.materialsCost;
      summary.salary += job.salary;
      summary.unpaidSalary += job.paid ? 0 : job.salary;
      return summary;
    },
    { paidRevenue: 0, materials: 0, salary: 0, unpaidSalary: 0 },
  );
  const technicianPayroll = profile.technicians.map((technician) => {
    const rows = financeBaseRows.filter((job) => job.assignee === technician.name);
    return {
      technician,
      jobs: rows.length,
      revenue: rows.reduce((sum, job) => sum + job.paidScf + job.paidLabor, 0),
      materials: rows.reduce((sum, job) => sum + job.materialsCost, 0),
      salary: rows.reduce((sum, job) => sum + job.salary, 0),
      unpaid: rows.reduce((sum, job) => sum + (job.paid ? 0 : job.salary), 0),
      attention: rows.filter((job) => job.needsAttention).length,
    };
  });
  const toggleSalaryPaid = (jobNumber: string) => {
    setSalaryPaidJobs((jobs) => {
      if (jobs[jobNumber]) {
        const nextJobs = { ...jobs };
        delete nextJobs[jobNumber];
        return nextJobs;
      }

      return { ...jobs, [jobNumber]: new Date().toISOString().slice(0, 10) };
    });
  };
  const markSalaryJobsPaid = (jobNumbers: string[]) => {
    if (!jobNumbers.length) return;
    const paidAt = new Date().toISOString().slice(0, 10);
    setSalaryPaidJobs((jobs) => ({
      ...jobs,
      ...Object.fromEntries(jobNumbers.map((jobNumber) => [jobNumber, paidAt])),
    }));
  };
  const paymentMethodOptions = profile.acceptedPayments.map((method) => ({
    value: method,
    label: paymentMethodLabels[method],
  }));
  const currentPortalUser = {
    name: signedInUser?.name ?? selectedCompany.ownerName,
    role: signedInUser?.role ?? 'Admin' as const,
  };
  const updateInlineJobDraft = (jobId: string, patch: Partial<ServiceJob>) => {
    setInlineJobDrafts((drafts) => ({
      ...drafts,
      [jobId]: {
        ...drafts[jobId],
        ...patch,
      },
    }));
  };
  const handleSaveJob = (updatedJob: JobCardData) => {
    setJobs((currentJobs) => {
      const nextJobs = currentJobs.map((job) => (job.id === updatedJob.id ? updatedJob : job));
      saveCompanyJobs(selectedCompany.id, nextJobs);
      return nextJobs;
    });
    setOpenedJob(updatedJob);
  };
  const handleSaveInlineJob = (job: ServiceJob) => {
    const draft = inlineJobDrafts[job.id] ?? {};
    const updatedJob = {
      ...job,
      ...draft,
      assignee: draft.technician ?? job.technician,
    };

    handleSaveJob(updatedJob);
    setInlineJobDrafts((drafts) => {
      const nextDrafts = { ...drafts };
      delete nextDrafts[job.id];
      return nextDrafts;
    });
  };
  const handleCreateJob = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rawJobNumber = String(form.get('jobNumber') ?? '').trim();
    const technicianName = String(form.get('technician') ?? '').trim();
    const jobForm: NewServiceJobForm = {
      jobNumber: rawJobNumber && rawJobNumber.toLowerCase() !== 'automatic' ? rawJobNumber : sampleJobNumber,
      system: selectedJobType?.name ?? String(form.get('system') ?? 'General'),
      clientName: String(form.get('clientName') ?? '').trim() || 'Unknown client',
      organization: String(form.get('organization') ?? '').trim() || 'Unknown company',
      phone: String(form.get('phone') ?? '').trim(),
      email: String(form.get('email') ?? '').trim(),
      address: String(form.get('address') ?? '').trim(),
      technician: technicianName,
      serviceCallFee: String(form.get('serviceCallFee') ?? profile.serviceCallFee).trim() || String(profile.serviceCallFee),
      issue: String(form.get('issue') ?? '').trim() || 'Service request',
      notes: String(form.get('notes') ?? '').trim(),
    };
    const createdJob = createServiceJob(selectedCompany.id, jobForm);

    setJobs((currentJobs) => {
      const nextJobs = [createdJob, ...currentJobs];
      saveCompanyJobs(selectedCompany.id, nextJobs);
      return nextJobs;
    });
    setOpenedJob(createdJob);
  };
  const librarySystems = Array.from(new Set([...profile.jobTypes.map((jobType) => jobType.name), ...libraryDocuments.map((document) => document.system)])).filter(Boolean);
  const filteredLibraryDocuments = libraryDocuments.filter((document) => {
    const normalizedSearch = librarySearch.trim().toLowerCase();
    const matchesCategory = libraryCategoryFilter === 'all' || document.category === libraryCategoryFilter;
    const matchesSystem = librarySystemFilter === 'all' || document.system === librarySystemFilter;
    const matchesFormat = libraryFormatFilter === 'all' || document.format === libraryFormatFilter;
    const haystack = [
      document.title,
      document.category,
      document.system,
      document.manufacturer,
      document.model,
      document.format,
      document.summary,
      document.tags.join(' '),
    ]
      .join(' ')
      .toLowerCase();

    return matchesCategory && matchesSystem && matchesFormat && (!normalizedSearch || haystack.includes(normalizedSearch));
  });
  const handleLibraryFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLibraryDraft((draft) => ({
      ...draft,
      fileName: file.name,
      title: draft.title || file.name.replace(/\.[^/.]+$/, ''),
    }));
  };
  const addLibraryDocument = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!libraryDraft.title.trim()) return;

    setLibraryDocuments((documents) => [
      {
        id: `lib-${Date.now()}`,
        title: libraryDraft.title.trim(),
        category: libraryDraft.category,
        system: libraryDraft.system.trim() || 'General',
        manufacturer: libraryDraft.manufacturer.trim() || 'Unknown',
        model: libraryDraft.model.trim() || 'Any model',
        format: libraryDraft.fileName.toLowerCase().match(/\.(png|jpg|jpeg|webp)$/) ? 'Image' : 'PDF',
        tags: libraryDraft.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        uploadedAt: '2026-06-12',
        fileSize: libraryDraft.fileName ? 'Pending storage' : 'Link / reference',
        uploadedBy: 'Company admin',
        summary: libraryDraft.fileName
          ? `Uploaded file: ${libraryDraft.fileName}`
          : 'Reference document added by the company admin.',
      },
      ...documents,
    ]);
    setLibraryDraft({
      title: '',
      category: 'Manual',
      system: profile.jobTypes[0]?.name ?? 'HVAC',
      manufacturer: '',
      model: '',
      tags: '',
      fileName: '',
    });
  };
  const autoTasks: TaskRow[] = allJobsRows.flatMap((job) => {
    const rows: TaskRow[] = [];
    const jobMaterials = materials.filter((material) => material.jobNumber === job.jobNumber);

    if (!job.scfPayment) {
      rows.push({
        id: `auto-${job.jobNumber}-scf`,
        title: 'Collect SCF payment',
        jobNumber: job.jobNumber,
        assignedTo: job.assignee === 'No technician' ? 'Office' : job.assignee,
        dueDate: '2026-06-12',
        priority: 'Urgent',
        status: completedAutoTaskIds.includes(`auto-${job.jobNumber}-scf`) ? 'Done' : 'To do',
        notes: 'Service call fee is still unpaid.',
        source: 'Auto',
      });
    }

    if (job.assignee === 'No technician') {
      rows.push({
        id: `auto-${job.jobNumber}-assign-tech`,
        title: 'Assign technician',
        jobNumber: job.jobNumber,
        assignedTo: 'Dispatcher',
        dueDate: '2026-06-12',
        priority: 'Normal',
        status: completedAutoTaskIds.includes(`auto-${job.jobNumber}-assign-tech`) ? 'Done' : 'To do',
        notes: 'Job is active but has no technician.',
        source: 'Auto',
      });
    }

    if (jobMaterials.some((material) => material.status === 'Needed')) {
      rows.push({
        id: `auto-${job.jobNumber}-order-parts`,
        title: 'Order required parts',
        jobNumber: job.jobNumber,
        assignedTo: 'Office',
        dueDate: '2026-06-12',
        priority: 'Normal',
        status: completedAutoTaskIds.includes(`auto-${job.jobNumber}-order-parts`) ? 'Done' : 'To do',
        notes: 'One or more materials are marked as needed.',
        source: 'Auto',
      });
    }

    if (jobMaterials.some((material) => material.status === 'Received') && job.status !== 'Completed') {
      rows.push({
        id: `auto-${job.jobNumber}-return-visit`,
        title: 'Schedule return visit',
        jobNumber: job.jobNumber,
        assignedTo: job.assignee === 'No technician' ? 'Dispatcher' : job.assignee,
        dueDate: '2026-06-13',
        priority: 'Normal',
        status: completedAutoTaskIds.includes(`auto-${job.jobNumber}-return-visit`) ? 'Done' : 'To do',
        notes: 'Parts are received and the job is not completed yet.',
        source: 'Auto',
      });
    }

    return rows;
  });
  const taskRows = [...autoTasks, ...manualTasks];
  const filteredTaskRows = taskRows.filter((task) => {
    const job = materialJobMap.get(task.jobNumber);
    const normalizedSearch = taskSearch.trim().toLowerCase();
    const haystack = [task.title, task.jobNumber, task.assignedTo, task.notes, job?.organization, job?.clientName, job?.issue]
      .join(' ')
      .toLowerCase();
    const matchesStatus = taskStatusFilter === 'all' || task.status === taskStatusFilter;
    const matchesOwner = taskOwnerFilter === 'all' || task.assignedTo === taskOwnerFilter;

    return matchesStatus && matchesOwner && (!normalizedSearch || haystack.includes(normalizedSearch));
  });
  const taskAssignees = Array.from(new Set(['Office', 'Dispatcher', ...profile.technicians.map((technician) => technician.name), ...taskRows.map((task) => task.assignedTo)])).filter(Boolean);
  const openTaskCount = taskRows.filter((task) => task.status !== 'Done').length;
  const autoTaskCount = autoTasks.filter((task) => task.status !== 'Done').length;
  const urgentTaskCount = taskRows.filter((task) => task.priority === 'Urgent' && task.status !== 'Done').length;
  const createManualTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!taskForm.title.trim()) return;

    setManualTasks((tasks) => [
      {
        id: `task-${Date.now()}`,
        title: taskForm.title.trim(),
        jobNumber: taskForm.jobNumber,
        assignedTo: taskForm.assignedTo || 'Office',
        dueDate: taskForm.dueDate,
        priority: taskForm.priority,
        status: 'To do',
        notes: taskForm.notes.trim(),
        source: 'Manual',
      },
      ...tasks,
    ]);
    setTaskForm(emptyTaskForm);
  };
  const updateTaskStatus = (task: TaskRow, status: TaskStatus) => {
    if (task.source === 'Auto') {
      setCompletedAutoTaskIds((ids) => (status === 'Done' ? Array.from(new Set([...ids, task.id])) : ids.filter((id) => id !== task.id)));
      return;
    }

    setManualTasks((tasks) => tasks.map((row) => (row.id === task.id ? { ...row, status } : row)));
  };
  const calendarAnchor = parseLocalDate(calendarAnchorDate);
  const calendarWeekStart = startOfWeek(calendarAnchor);
  const calendarDays = Array.from({ length: 7 }, (_, index) => formatCalendarDay(addDays(calendarWeekStart, index)));
  const calendarMonthStart = new Date(calendarAnchor.getFullYear(), calendarAnchor.getMonth(), 1, 12);
  const calendarMonthGridStart = startOfWeek(calendarMonthStart);
  const calendarMonthDays = Array.from({ length: 42 }, (_, index) => formatCalendarDay(addDays(calendarMonthGridStart, index)));
  const allCalendarDays = Array.from(new globalThis.Map([...calendarMonthDays, ...calendarDays, formatCalendarDay(calendarAnchor)].map((day) => [day.key, day])).values());
  const calendarRangeTitle =
    calendarView === 'month'
      ? calendarAnchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : calendarView === 'day'
        ? calendarAnchor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : `${calendarDays[0].date} - ${calendarDays[6].date}, ${calendarDays[6].isoDate.slice(0, 4)}`;
  const calendarSlots = ['8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM'];
  const calendarSlotHours: Record<string, number> = {
    '8 AM': 8,
    '9 AM': 9,
    '10 AM': 10,
    '11 AM': 11,
    '12 PM': 12,
    '1 PM': 13,
    '2 PM': 14,
    '3 PM': 15,
    '4 PM': 16,
    '5 PM': 17,
    '6 PM': 18,
    '7 PM': 19,
    '8 PM': 20,
  };
  const calendarDropSlots = calendarSlots.slice(0, -1).flatMap((slot) => [
    { key: `${slot}:00`, label: slot, hour: calendarSlotHours[slot], minute: 0 },
    { key: `${slot}:30`, label: slot.replace(/\s/, ':30 '), hour: calendarSlotHours[slot], minute: 30 },
  ]);
  const calendarDurations = [60, 120, 240, 90, 360, 180];
  const defaultScheduledAssignments = Object.fromEntries(
    activeJobsRows.slice(1).map((job, index) => [
      job.jobNumber,
      {
        assignee: job.assignee,
        dayKey: calendarDays[index % calendarDays.length].key,
        time: calendarDropSlots[(index * 3 + 2) % calendarDropSlots.length].key,
        durationMinutes: calendarDurations[index % calendarDurations.length],
      },
    ]),
  );
  const calendarJobs = activeJobsRows.map((job) => {
    const assignment = calendarAssignments[job.jobNumber] ?? defaultScheduledAssignments[job.jobNumber];
    const appointmentDay = allCalendarDays.find((day) => day.key === assignment?.dayKey);
    const appointmentSlot = calendarDropSlots.find((slot) => slot.key === assignment?.time);
    const appointment = appointmentDay && appointmentSlot ? `${appointmentDay.isoDate}T${String(appointmentSlot.hour).padStart(2, '0')}:${String(appointmentSlot.minute).padStart(2, '0')}` : undefined;

    return {
      ...job,
      technician: assignment?.assignee ?? job.technician,
      assignee: assignment?.assignee ?? job.assignee,
      dayKey: assignment?.dayKey,
      time: assignment?.time,
      durationMinutes: assignment?.durationMinutes ?? 120,
      appointment,
    };
  });
  const scheduledJobs = calendarJobs.filter((job) => job.dayKey && job.time && job.assignee !== 'No technician');
  const unassignedCalendarJobs = calendarJobs.filter((job) => !job.dayKey || job.assignee === 'No technician');
  const visibleCalendarJobs = scheduledJobs.filter((job) => activeCalendarTech === 'all' || job.assignee === activeCalendarTech);
  const visibleCalendarDays = calendarView === 'day' ? [formatCalendarDay(calendarAnchor)] : calendarDays;
  const clientNavItems: { page: ClientPage; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { page: 'jobs', label: 'Jobs', icon: <ClipboardList size={16} /> },
    { page: 'allJobs', label: 'All Jobs', icon: <LayoutDashboard size={16} /> },
    { page: 'calendar', label: 'Calendar', icon: <CalendarDays size={16} /> },
    { page: 'materials', label: 'Materials', icon: <Box size={16} /> },
    { page: 'tasks', label: 'Tasks', icon: <CheckCircle2 size={16} /> },
    { page: 'map', label: 'Map', icon: <Map size={16} /> },
    { page: 'email', label: 'Email', icon: <MailPlus size={16} /> },
    { page: 'finances', label: 'Finance', icon: <CreditCard size={16} /> },
    { page: 'knowledge', label: 'Library', icon: <BookOpen size={16} /> },
    { page: 'onboarding', label: 'Onboarding', icon: <Rocket size={16} /> },
    { page: 'portal', label: 'Portal', icon: <Rocket size={16} /> },
  ];

  function handleRequestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!request.subject.trim() || !request.message.trim()) return;

    onCreateRequest(request);
    setRequest({
      kind: 'change',
      priority: 'normal',
      subject: '',
      message: '',
    });
  }

  function updateProfile(updates: Partial<CompanyOnboardingProfile>) {
    onUpdateOnboardingProfile({ ...profile, ...updates });
  }

  function handleLogoUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener('load', () => {
      updateProfile({ logoUrl: String(reader.result ?? '') });
    });
    reader.readAsDataURL(file);
  }

  function handleTechnicianSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!technicianForm.name.trim() || !technicianForm.email.trim()) return;

    updateProfile({
      technicians: [createCompanyTechnician(technicianForm), ...profile.technicians],
    });
    setTechnicianForm(emptyTechnicianForm);
  }

  function handleJobTypeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!jobTypeForm.name.trim()) return;

    updateProfile({
      jobTypes: [createCompanyJobType(jobTypeForm), ...profile.jobTypes],
    });
    setJobTypeForm(emptyJobTypeForm);
  }

  function addProfessionTemplate(template: NewCompanyJobTypeForm) {
    if (configuredProfessionNames.has(template.name.toLowerCase())) return;

    updateProfile({
      jobTypes: [...profile.jobTypes, createCompanyJobType(template)],
    });
  }

  function removeJobType(jobTypeId: string) {
    const jobTypes = profile.jobTypes.filter((jobType) => jobType.id !== jobTypeId);
    updateProfile({ jobTypes });

    if (selectedJobTypeId === jobTypeId) {
      setSelectedJobTypeId('');
    }
  }

  function handleCalendarDragStart(event: DragEvent<HTMLElement>, jobNumber: string) {
    setDraggingJobNumber(jobNumber);
    event.dataTransfer.setData('text/plain', jobNumber);
    event.dataTransfer.effectAllowed = 'move';
  }

  function moveCalendar(direction: -1 | 1) {
    const anchor = parseLocalDate(calendarAnchorDate);
    const nextDate =
      calendarView === 'month'
        ? addMonths(anchor, direction)
        : addDays(anchor, direction * (calendarView === 'week' ? 7 : 1));

    setCalendarAnchorDate(toLocalIsoDate(nextDate));
  }

  function showTodayInCalendar() {
    setCalendarAnchorDate(toLocalIsoDate(new Date()));
  }

  function handleCalendarDrop(event: DragEvent<HTMLDivElement>, dayKey: string, slotKey: string) {
    event.preventDefault();
    const jobNumber = event.dataTransfer.getData('text/plain') || draggingJobNumber;
    if (!jobNumber) return;
    const movedJob = calendarJobs.find((job) => job.jobNumber === jobNumber);
    const assignee = activeCalendarTech !== 'all' ? activeCalendarTech : movedJob?.assignee;
    if (!assignee || assignee === 'No technician') return;
    const appointmentDay = allCalendarDays.find((day) => day.key === dayKey);
    const appointmentSlot = calendarDropSlots.find((slot) => slot.key === slotKey);
    const appointment = appointmentDay && appointmentSlot ? `${appointmentDay.isoDate}T${String(appointmentSlot.hour).padStart(2, '0')}:${String(appointmentSlot.minute).padStart(2, '0')}` : undefined;

    setCalendarAssignments((assignments) => ({
      ...assignments,
      [jobNumber]: {
        assignee,
        dayKey,
        time: slotKey,
        durationMinutes: assignments[jobNumber]?.durationMinutes ?? movedJob?.durationMinutes ?? 120,
      },
    }));
    setOpenedJob((job) => job?.jobNumber === jobNumber ? { ...job, technician: assignee, appointment } : job);
    setDraggingJobNumber('');
  }

  function handleCalendarMonthDrop(event: DragEvent<HTMLDivElement>, dayKey: string) {
    event.preventDefault();
    const jobNumber = event.dataTransfer.getData('text/plain') || draggingJobNumber;
    if (!jobNumber) return;
    const movedJob = calendarJobs.find((job) => job.jobNumber === jobNumber);
    const assignee = activeCalendarTech !== 'all' ? activeCalendarTech : movedJob?.assignee;
    if (!assignee || assignee === 'No technician') return;

    setMonthDropRequest({
      jobNumber,
      assignee,
      dayKey,
      time: movedJob?.time ?? '9 AM:00',
      durationMinutes: calendarAssignments[jobNumber]?.durationMinutes ?? movedJob?.durationMinutes ?? 120,
    });
    setDraggingJobNumber('');
  }

  function confirmCalendarMonthDrop() {
    if (!monthDropRequest) return;
    const appointmentDay = allCalendarDays.find((day) => day.key === monthDropRequest.dayKey);
    const appointmentSlot = calendarDropSlots.find((slot) => slot.key === monthDropRequest.time);
    const appointment = appointmentDay && appointmentSlot ? `${appointmentDay.isoDate}T${String(appointmentSlot.hour).padStart(2, '0')}:${String(appointmentSlot.minute).padStart(2, '0')}` : undefined;

    setCalendarAssignments((assignments) => ({
      ...assignments,
      [monthDropRequest.jobNumber]: {
        assignee: monthDropRequest.assignee,
        dayKey: monthDropRequest.dayKey,
        time: monthDropRequest.time,
        durationMinutes: monthDropRequest.durationMinutes,
      },
    }));
    setOpenedJob((job) => job?.jobNumber === monthDropRequest.jobNumber ? { ...job, technician: monthDropRequest.assignee, appointment } : job);
    setMonthDropRequest(null);
  }

  function handleCalendarResizeStart(
    event: PointerEvent<HTMLSpanElement>,
    job: { jobNumber: string; assignee: string; dayKey?: string; time?: string; durationMinutes: number },
  ) {
    event.preventDefault();
    event.stopPropagation();

    if (!job.dayKey || !job.time) return;

    setCalendarAssignments((assignments) => ({
      ...assignments,
      [job.jobNumber]: assignments[job.jobNumber] ?? {
        assignee: job.assignee,
        dayKey: job.dayKey ?? '',
        time: job.time ?? '',
        durationMinutes: job.durationMinutes,
      },
    }));
    setResizingJob({
      jobNumber: job.jobNumber,
      startY: event.clientY,
      startDuration: job.durationMinutes,
    });
  }

  function togglePaymentMethod(method: CompanyPaymentMethod) {
    const acceptedPayments = profile.acceptedPayments.includes(method)
      ? profile.acceptedPayments.filter((paymentMethod) => paymentMethod !== method)
      : [...profile.acceptedPayments, method];

    updateProfile({ acceptedPayments });
  }

  return (
    <div className="client-app">
      <header className="client-topbar">
        <div className="client-brand">
          <div className="client-logo">{selectedCompany.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{selectedCompany.name}</strong>
            <span>ServiceScope</span>
          </div>
        </div>

        <nav className="client-nav" aria-label="Company navigation">
          {clientNavItems.map((item) => (
            <button
              className={`client-nav-item ${clientPage === item.page ? 'active' : ''} ${item.adminOnly ? 'admin' : ''}`}
              type="button"
              key={item.page}
              onClick={() => {
                setOpenedJob(null);
                setClientPage(item.page);
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="client-user">
          <span>ADMIN</span>
          <strong>{selectedCompany.ownerName.slice(0, 1).toUpperCase()}</strong>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="client-workspace">
        {clientPage === 'onboarding' ? (
          <OnboardingPage
            completedSteps={completedSteps}
            profile={profile}
            emailConnection={emailConnection}
            handleLogoUpload={handleLogoUpload}
            updateProfile={updateProfile}
            connectMailbox={connectMailbox}
            emailProviderLabels={emailProviderLabels}
            updateMailbox={updateMailbox}
            togglePaymentMethod={togglePaymentMethod}
            professionTemplates={professionTemplates}
            configuredProfessionNames={configuredProfessionNames}
            addProfessionTemplate={addProfessionTemplate}
            jobTypeForm={jobTypeForm}
            setJobTypeForm={setJobTypeForm}
            handleJobTypeSubmit={handleJobTypeSubmit}
            removeJobType={removeJobType}
            technicianForm={technicianForm}
            setTechnicianForm={setTechnicianForm}
            selectedCompany={selectedCompany}
            handleTechnicianSubmit={handleTechnicianSubmit}
          />
        ) : clientPage === 'jobs' ? (
          <JobsPage
            openedJob={openedJob}
            profile={profile}
            paymentMethodOptions={paymentMethodOptions}
            materials={materials}
            currentPortalUser={currentPortalUser}
            onCloseJob={() => setOpenedJob(null)}
            onSaveJob={handleSaveJob}
            onSaveMaterials={saveJobMaterials}
            onCreateJob={handleCreateJob}
            selectedJobPrefix={selectedJobPrefix}
            nextJobNumber={nextJobNumber}
            selectedJobType={selectedJobType}
            selectedJobTypeId={selectedJobTypeId}
            onSelectedJobTypeIdChange={setSelectedJobTypeId}
            sampleJob={sampleJob}
            onOpenJob={setOpenedJob}
          />
        ) : clientPage === 'allJobs' ? (
          <AllJobsPage
            openedJob={openedJob}
            profile={profile}
            paymentMethodOptions={paymentMethodOptions}
            materials={materials}
            currentPortalUser={currentPortalUser}
            onCloseJob={() => setOpenedJob(null)}
            onSaveJob={handleSaveJob}
            onSaveMaterials={saveJobMaterials}
            jobStatusFilters={jobStatusFilters}
            allJobsGroups={allJobsGroups}
            allJobsVisibility={allJobsVisibility}
            onAllJobsVisibilityChange={setAllJobsVisibility}
            activeJobsCount={activeJobsRows.length}
            paidJobsCount={paidJobsRows.length}
            totalJobsCount={allJobsRows.length}
            inlineJobDrafts={inlineJobDrafts}
            onUpdateInlineJobDraft={updateInlineJobDraft}
            onSaveInlineJob={handleSaveInlineJob}
            onOpenJob={setOpenedJob}
          />
        ) : clientPage === 'calendar' ? (
          <CalendarPage
            openedJob={openedJob}
            profile={profile}
            paymentMethodOptions={paymentMethodOptions}
            materials={materials}
            currentPortalUser={currentPortalUser}
            onCloseJob={() => setOpenedJob(null)}
            onSaveJob={handleSaveJob}
            onSaveMaterials={saveJobMaterials}
            calendarRangeTitle={calendarRangeTitle}
            onMoveCalendar={moveCalendar}
            onShowToday={showTodayInCalendar}
            activeCalendarTech={activeCalendarTech}
            onActiveCalendarTechChange={setActiveCalendarTech}
            calendarView={calendarView}
            onCalendarViewChange={setCalendarView}
            unassignedCalendarJobs={unassignedCalendarJobs}
            onCalendarDragStart={handleCalendarDragStart}
            onOpenJob={setOpenedJob}
            calendarMonthDays={calendarMonthDays}
            visibleCalendarJobs={visibleCalendarJobs}
            calendarAnchor={calendarAnchor}
            onCalendarMonthDrop={handleCalendarMonthDrop}
            visibleCalendarDays={visibleCalendarDays}
            calendarSlots={calendarSlots}
            calendarDropSlots={calendarDropSlots}
            onCalendarDrop={handleCalendarDrop}
            onCalendarResizeStart={handleCalendarResizeStart}
            jobStatusFilters={jobStatusFilters}
            monthDropRequest={monthDropRequest}
            allCalendarDays={allCalendarDays}
            onMonthDropRequestChange={setMonthDropRequest}
            onConfirmCalendarMonthDrop={confirmCalendarMonthDrop}
          />
        ) : clientPage === 'materials' ? (
          <MaterialsPage
            materials={materials}
            jobsWithoutMaterials={jobsWithoutMaterials}
            materialsTotal={materialsTotal}
            materialStatusFilter={materialStatusFilter}
            onMaterialStatusFilterChange={setMaterialStatusFilter}
            materialStatuses={materialStatuses}
            materialTechFilter={materialTechFilter}
            onMaterialTechFilterChange={setMaterialTechFilter}
            profile={profile}
            materialSearch={materialSearch}
            onMaterialSearchChange={setMaterialSearch}
            onResetFilters={() => {
              setMaterialStatusFilter('all');
              setMaterialTechFilter('all');
              setMaterialSearch('');
            }}
            onOpenMaterialEditor={openMaterialEditor}
            onOpenJob={setOpenedJob}
            filteredMaterialRows={filteredMaterialRows}
            selectedMaterialsJob={selectedMaterialsJob}
            onCloseMaterialEditor={() => setEditingMaterialsJobNumber('')}
            materialDraftRows={materialDraftRows}
            onUpdateMaterialDraft={updateMaterialDraft}
            onRemoveMaterialDraftRow={removeMaterialDraftRow}
            onAddMaterialDraftRow={addMaterialDraftRow}
            onSaveMaterialDraftRows={saveMaterialDraftRows}
          />
        ) : clientPage === 'tasks' ? (
          <TasksPage
            openedJob={openedJob}
            profile={profile}
            paymentMethodOptions={paymentMethodOptions}
            materials={materials}
            currentPortalUser={currentPortalUser}
            onCloseJob={() => setOpenedJob(null)}
            onSaveJob={handleSaveJob}
            onSaveMaterials={saveJobMaterials}
            openTaskCount={openTaskCount}
            autoTaskCount={autoTaskCount}
            urgentTaskCount={urgentTaskCount}
            taskForm={taskForm}
            onTaskFormChange={setTaskForm}
            onCreateManualTask={createManualTask}
            allJobsRows={allJobsRows}
            taskAssignees={taskAssignees}
            taskStatusFilter={taskStatusFilter}
            onTaskStatusFilterChange={setTaskStatusFilter}
            taskOwnerFilter={taskOwnerFilter}
            onTaskOwnerFilterChange={setTaskOwnerFilter}
            taskSearch={taskSearch}
            onTaskSearchChange={setTaskSearch}
            onResetFilters={() => {
              setTaskStatusFilter('all');
              setTaskOwnerFilter('all');
              setTaskSearch('');
            }}
            filteredTaskRows={filteredTaskRows}
            jobMap={materialJobMap}
            onOpenJob={setOpenedJob}
            onUpdateTaskStatus={updateTaskStatus}
          />
        ) : clientPage === 'email' ? (
          <EmailPage
            emailConnection={emailConnection}
            emailMessages={emailMessages}
            emailTemplates={initialEmailTemplates}
            emailProviderLabels={emailProviderLabels}
            onOpenOnboarding={() => setClientPage('onboarding')}
            emailFolder={emailFolder}
            onEmailFolderChange={setEmailFolder}
            emailSearch={emailSearch}
            onEmailSearchChange={setEmailSearch}
            visibleEmailMessages={visibleEmailMessages}
            onApplyEmailTemplate={applyEmailTemplate}
            jobMap={materialJobMap}
            onEmailComposeChange={setEmailCompose}
            emailCompose={emailCompose}
            allJobsRows={allJobsRows}
            onSendEmailDraft={sendEmailDraft}
          />
        ) : clientPage === 'map' ? (
          <MapPage
            filteredTechnicianLocations={filteredTechnicianLocations}
            mapTechFilter={mapTechFilter}
            onMapTechFilterChange={setMapTechFilter}
            mapStatusFilter={mapStatusFilter}
            onMapStatusFilterChange={setMapStatusFilter}
            mapSearch={mapSearch}
            onMapSearchChange={setMapSearch}
            onResetFilters={() => {
              setMapTechFilter('all');
              setMapStatusFilter('all');
              setMapSearch('');
            }}
            profile={profile}
          />
        ) : clientPage === 'finances' ? (
          <FinancePage
            openedJob={openedJob}
            profile={profile}
            paymentMethodOptions={paymentMethodOptions}
            materials={materials}
            currentPortalUser={currentPortalUser}
            onCloseJob={() => setOpenedJob(null)}
            onSaveJob={handleSaveJob}
            onSaveMaterials={saveJobMaterials}
            financeSummary={financeSummary}
            financePeriod={financePeriod}
            onFinancePeriodChange={setFinancePeriod}
            financeTechFilter={financeTechFilter}
            onFinanceTechFilterChange={setFinanceTechFilter}
            payrollRules={payrollRules}
            onPayrollRulesChange={setPayrollRules}
            technicianPayroll={technicianPayroll}
            financeBaseRows={financeBaseRows}
            onOpenJob={setOpenedJob}
            onToggleSalaryPaid={toggleSalaryPaid}
            onMarkSalaryJobsPaid={markSalaryJobsPaid}
          />
        ) : clientPage === 'knowledge' ? (
          <KnowledgePage
            libraryDocuments={libraryDocuments}
            librarySystems={librarySystems}
            filteredLibraryDocuments={filteredLibraryDocuments}
            libraryDraft={libraryDraft}
            onLibraryDraftChange={setLibraryDraft}
            libraryCategories={libraryCategories}
            libraryFormats={libraryFormats}
            librarySearch={librarySearch}
            onLibrarySearchChange={setLibrarySearch}
            libraryCategoryFilter={libraryCategoryFilter}
            onLibraryCategoryFilterChange={setLibraryCategoryFilter}
            librarySystemFilter={librarySystemFilter}
            onLibrarySystemFilterChange={setLibrarySystemFilter}
            libraryFormatFilter={libraryFormatFilter}
            onLibraryFormatFilterChange={setLibraryFormatFilter}
            onLibraryFileChange={handleLibraryFileChange}
            onAddLibraryDocument={addLibraryDocument}
          />
        ) : clientPage === 'portal' ? (
          <section className="portal-page">
            <div className="portal-hero">
              <div className="portal-identity">
                <div className="company-avatar large">{selectedCompany.name.slice(0, 2).toUpperCase()}</div>
                <div>
                  <p className="eyebrow">Company portal</p>
                  <h2>{selectedCompany.name}</h2>
                  <p>{selectedCompany.ownerName} - {selectedCompany.ownerEmail}</p>
                </div>
              </div>
              <span className={`billing-pill ${selectedCompany.billingStatus}`}>{billingLabels[selectedCompany.billingStatus]}</span>
            </div>

            <section className="portal-metrics">
              <MetricCard icon={<Rocket size={20} />} label="Launch" value={`${completedSteps}/4`} detail="Provisioning steps complete" />
              <MetricCard icon={<CreditCard size={20} />} label="Plan" value={selectedCompany.plan} detail={billingLabels[selectedCompany.billingStatus]} />
              <MetricCard icon={<ClipboardList size={20} />} label="Jobs" value={selectedCompany.usage.jobsThisMonth.toString()} detail="This month" />
              <MetricCard icon={<Inbox size={20} />} label="Support" value={openTickets.length.toString()} detail="Open requests" />
            </section>

            <div className="portal-grid">
              <section className="panel portal-support-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Direct support</p>
                    <h2>Request a change</h2>
                  </div>
                  <MailPlus size={20} aria-hidden="true" />
                </div>
                <form className="portal-request-form" onSubmit={handleRequestSubmit}>
                  <div className="form-row">
                    <label>
                      Type
                      <select value={request.kind} onChange={(event) => setRequest({ ...request, kind: event.target.value as SupportTicketKind })}>
                        <option value="change">Change</option>
                        <option value="bug">Bug</option>
                        <option value="question">Question</option>
                      </select>
                    </label>
                    <label>
                      Priority
                      <select value={request.priority} onChange={(event) => setRequest({ ...request, priority: event.target.value as SupportTicketPriority })}>
                        <option value="normal">Normal</option>
                        <option value="urgent">Urgent</option>
                        <option value="low">Low</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Subject
                    <input value={request.subject} onChange={(event) => setRequest({ ...request, subject: event.target.value })} placeholder="What should be fixed or changed?" />
                  </label>
                  <label>
                    Message
                    <textarea value={request.message} onChange={(event) => setRequest({ ...request, message: event.target.value })} placeholder="Describe the issue, request, or missing detail." />
                  </label>
                  <button className="primary-button" type="submit">
                    <MailPlus size={18} aria-hidden="true" />
                    Send request
                  </button>
                </form>
              </section>

              <section className="panel portal-ticket-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Recent communication</p>
                    <h2>Support history</h2>
                  </div>
                  <Inbox size={20} aria-hidden="true" />
                </div>
                <div className="portal-ticket-list">
                  {tickets.slice(0, 4).map((ticket) => (
                    <article className="portal-ticket-row" key={ticket.id}>
                      <div>
                        <span className={`ticket-kind ${ticket.kind}`}>{ticketKindLabels[ticket.kind]}</span>
                        <h3>{ticket.subject}</h3>
                        <p>{ticket.lastUpdate}</p>
                      </div>
                      <strong>{ticketStatusLabels[ticket.status]}</strong>
                    </article>
                  ))}
                  {!tickets.length ? (
                    <div className="empty-state compact-empty">
                      <CheckCircle2 size={24} aria-hidden="true" />
                      <h3>No requests yet</h3>
                      <p>New requests from this portal will appear in owner support.</p>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </section>
        ) : (
          <section className="client-placeholder">
            <div className="client-placeholder-icon">
              {clientNavItems.find((item) => item.page === clientPage)?.icon}
            </div>
            <h1>{clientNavItems.find((item) => item.page === clientPage)?.label}</h1>
            <p>This module is ready to be connected to live company data.</p>
            <div className="client-placeholder-grid">
              <MetricCard icon={<Activity size={20} />} label="Company" value={selectedCompany.name} detail={selectedCompany.market} />
              <MetricCard icon={<Users size={20} />} label="Technicians" value={selectedCompany.technicians.toString()} detail="Assigned team" />
              <MetricCard icon={<Database size={20} />} label="Storage" value={`${selectedCompany.usage.storageGb} GB`} detail="Current usage" />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}










