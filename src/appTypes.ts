import type { Company, MaterialRow } from './types';

export type AppPage = 'dashboard' | 'companies' | 'monitoring' | 'billing' | 'access' | 'audit' | 'support' | 'companyLogin' | 'portal';
export type ClientPage = 'onboarding' | 'jobs' | 'allJobs' | 'calendar' | 'materials' | 'tasks' | 'map' | 'email' | 'finances' | 'knowledge' | 'portal';

export type TaskPriority = 'Low' | 'Normal' | 'Urgent';
export type TaskStatus = 'To do' | 'In progress' | 'Done';

export type TaskRow = {
  id: string;
  title: string;
  jobNumber: string;
  assignedTo: string;
  dueDate: string;
  priority: TaskPriority;
  status: TaskStatus;
  notes: string;
  source: 'Manual' | 'Auto';
};

export type TaskForm = Pick<TaskRow, 'title' | 'jobNumber' | 'assignedTo' | 'dueDate' | 'priority' | 'notes'>;

export type EmailProvider = 'google' | 'microsoft' | 'smtp';
export type EmailFolder = 'inbox' | 'sent' | 'templates';

export type EmailConnection = {
  provider: EmailProvider;
  address: string;
  status: 'backend_required' | 'connected';
  lastSync: string;
  syncRange: '7' | '30' | '90';
  autoLinkJobNumber: boolean;
  autoLinkClientEmail: boolean;
  createTaskFromUnread: boolean;
  senderName: string;
  replyTo: string;
  signature: string;
  imapHost: string;
  imapPort: string;
  smtpHost: string;
  smtpPort: string;
  security: 'ssl' | 'tls' | 'starttls';
  username: string;
};

export type EmailMessage = {
  id: string;
  folder: 'inbox' | 'sent';
  from: string;
  to: string;
  subject: string;
  preview: string;
  jobNumber: string;
  receivedAt: string;
  unread?: boolean;
};

export type EmailTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
};

export type EmailCompose = {
  to: string;
  subject: string;
  body: string;
  jobNumber: string;
};

export type FinancePeriod = 'this_week' | 'this_month' | 'all';
export type FinanceTab = 'ready' | 'paid' | 'attention';

export type PayrollRules = {
  commissionPercent: number;
  scfOnlyPayout: number;
  deductMaterials: boolean;
  includeScf: boolean;
};

export type LibraryCategory = 'Manual' | 'Wiring diagram' | 'Service bulletin' | 'Install guide' | 'Parts list' | 'Warranty' | 'Training';
export type LibraryFormat = 'PDF' | 'Image' | 'Video' | 'Link';

export type LibraryDocument = {
  id: string;
  title: string;
  category: LibraryCategory;
  system: string;
  manufacturer: string;
  model: string;
  format: LibraryFormat;
  tags: string[];
  uploadedAt: string;
  fileSize: string;
  uploadedBy: string;
  summary: string;
};

export type LibraryDraft = {
  title: string;
  category: LibraryCategory;
  system: string;
  manufacturer: string;
  model: string;
  tags: string;
  fileName: string;
};

export type CompanyOnboardingStepKey = keyof Company['onboarding'];

export function emptyMaterialDraft(jobNumber: string): MaterialRow {
  return {
    id: `mat-${Date.now()}`,
    jobNumber,
    name: '',
    quantity: 1,
    price: 0,
    supplier: '',
    status: 'Needed',
  };
}
