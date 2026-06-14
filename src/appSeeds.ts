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
  role: 'technician',
};

export const emptyJobTypeForm: NewCompanyJobTypeForm = {
  name: '',
  jobNumberPrefix: '',
  defaultDurationMinutes: 60,
  defaultPriority: 'normal',
  requiresParts: false,
};

export const initialMaterialRows: MaterialRow[] = [
  {
    id: 'mat-243-1',
    jobNumber: '243',
    name: 'Hood belt set',
    quantity: 2,
    price: 48,
    supplier: 'Parts Town',
    status: 'Ordered',
  },
  {
    id: 'mat-242-1',
    jobNumber: '242',
    name: 'Evaporator fan motor',
    quantity: 1,
    price: 185,
    supplier: 'Reliable Parts',
    status: 'Needed',
  },
  {
    id: 'mat-238-1',
    jobNumber: '238',
    name: 'Dual run capacitor',
    quantity: 1,
    price: 39,
    supplier: 'Johnstone Supply',
    status: 'Received',
  },
];

export const emptyTaskForm: TaskForm = {
  title: '',
  jobNumber: '',
  assignedTo: '',
  dueDate: '',
  priority: 'Normal',
  notes: '',
};

export const initialManualTasks: TaskRow[] = [
  {
    id: 'task-manual-1',
    title: 'Call customer before dispatch',
    jobNumber: '244',
    assignedTo: 'Office',
    dueDate: '2026-06-12',
    priority: 'Normal',
    status: 'To do',
    notes: 'Confirm access and best entrance.',
    source: 'Manual',
  },
];

export const emailProviderLabels: Record<EmailProvider, string> = {
  google: 'Google Workspace',
  microsoft: 'Microsoft 365',
  smtp: 'SMTP / IMAP',
};

export const initialEmailTemplates: EmailTemplate[] = [
  {
    id: 'tpl-schedule',
    name: 'Appointment confirmation',
    subject: 'Your service appointment',
    body: 'Hi, your service appointment is scheduled. Please reply if the access instructions changed.',
  },
  {
    id: 'tpl-estimate',
    name: 'Estimate follow-up',
    subject: 'Estimate for your service request',
    body: 'Hi, we prepared an estimate for the requested work. Please review it and reply with any questions.',
  },
  {
    id: 'tpl-payment',
    name: 'Payment reminder',
    subject: 'Payment reminder',
    body: 'Hi, this is a friendly reminder that payment is still pending for your service call.',
  },
];

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

export const initialLibraryDocuments: LibraryDocument[] = [
  {
    id: 'lib-1',
    title: 'Carrier rooftop unit service manual',
    category: 'Manual',
    system: 'HVAC',
    manufacturer: 'Carrier',
    model: '48TC',
    format: 'PDF',
    tags: ['rtu', 'diagnostics', 'fault codes'],
    uploadedAt: '2026-06-10',
    fileSize: '8.4 MB',
    uploadedBy: 'Office',
    summary: 'Service procedures, fault codes, wiring reference, and maintenance tables for Carrier 48TC units.',
  },
  {
    id: 'lib-2',
    title: 'True freezer wiring diagram',
    category: 'Wiring diagram',
    system: 'Appliance',
    manufacturer: 'True',
    model: 'T-49F',
    format: 'Image',
    tags: ['freezer', 'compressor', 'wiring'],
    uploadedAt: '2026-06-09',
    fileSize: '1.1 MB',
    uploadedBy: 'Andrei S',
    summary: 'Electrical diagram for compressor, evaporator fan, defrost timer, and control circuit.',
  },
  {
    id: 'lib-3',
    title: 'Rheem water heater install guide',
    category: 'Install guide',
    system: 'Plumbing',
    manufacturer: 'Rheem',
    model: 'Performance Plus',
    format: 'PDF',
    tags: ['water heater', 'installation', 'venting'],
    uploadedAt: '2026-06-07',
    fileSize: '5.7 MB',
    uploadedBy: 'Office',
    summary: 'Installation checklist, clearances, venting requirements, and startup procedure.',
  },
];
