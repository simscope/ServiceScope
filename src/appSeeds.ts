import type {
  EmailProvider,
  EmailTemplate,
  LibraryCategory,
  LibraryDocument,
  LibraryFormat,
  TaskForm,
  TaskRow,
} from './appTypes';
import type {
  MaterialRow,
  NewCompanyForm,
  NewCompanyJobTypeForm,
  NewCompanyTechnicianForm,
  NewPlatformUserForm,
  NewSupportTicketForm,
} from './types';

export const emptyCompany: NewCompanyForm = {
  name: '',
  ownerName: '',
  ownerEmail: '',
  temporaryPassword: '',
  domain: '',
  market: '',
  plan: 'Launch',
  status: 'setup',
};

export const emptySupportForm: NewSupportTicketForm = {
  companyId: '',
  authorName: '',
  authorEmail: '',
  kind: 'bug',
  priority: 'normal',
  subject: '',
  message: '',
};

export const emptyAccessForm: NewPlatformUserForm = {
  name: '',
  email: '',
  role: 'support',
};

export const emptyTechnicianForm: NewCompanyTechnicianForm = {
  name: '',
  email: '',
  phone: '',
  photoUrl: '',
  accessPassword: '',
  role: 'technician',
};

export const emptyJobTypeForm: NewCompanyJobTypeForm = {
  name: '',
  jobNumberPrefix: '',
  defaultDurationMinutes: 60,
  defaultPriority: 'normal',
  requiresParts: false,
};

export const initialMaterialRows: MaterialRow[] = [];

export const emptyTaskForm: TaskForm = {
  title: '',
  jobNumber: '',
  assignedTo: '',
  dueDate: '',
  priority: 'Normal',
  notes: '',
};

export const initialManualTasks: TaskRow[] = [];

export const emailProviderLabels: Record<EmailProvider, string> = {
  google: 'Google Workspace',
  microsoft: 'Microsoft 365',
  smtp: 'SMTP / IMAP',
};

export const initialEmailTemplates: EmailTemplate[] = [];

export const libraryCategories: LibraryCategory[] = [
  'Manual',
  'Wiring diagram',
  'Service bulletin',
  'Install guide',
  'Parts list',
  'Warranty',
  'Training',
];

export const libraryFormats: LibraryFormat[] = ['PDF', 'Image', 'Video', 'Link'];

export const initialLibraryDocuments: LibraryDocument[] = [];
