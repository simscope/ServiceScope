import { useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { CheckCircle2, Database, FileSpreadsheet, UploadCloud } from 'lucide-react';
import type { CompanyOnboardingProfile, ServiceJob, ServiceJobStatus } from '../../types';

type CsvRow = Record<string, string>;
type MigrationSourceId = 'housecall_pro' | 'jobber' | 'workiz' | 'servicetitan' | 'fieldedge' | 'service_fusion' | 'quickbooks' | 'generic';

type MigrationSource = {
  id: MigrationSourceId;
  name: string;
  audience: string;
  jobsDetail: string;
  customersDetail: string;
  importedFromLabel: string;
  note: string;
  jobNumberColumns: string[];
  companyColumns: string[];
  contactColumns: string[];
  phoneColumns: string[];
  emailColumns: string[];
  addressColumns: string[];
  systemColumns: string[];
  issueColumns: string[];
  technicianColumns: string[];
  statusColumns: string[];
  appointmentColumns: string[];
  createdColumns: string[];
  scfColumns: string[];
  laborColumns: string[];
  paymentColumns: string[];
};

type ImportDraft = {
  job: ServiceJob;
  action: 'create' | 'update';
  warnings: string[];
};

type CsvFilePickerProps = {
  icon: ReactNode;
  title: string;
  detail: string;
  fileName: string;
  disabled?: boolean;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
};

const statusOptions: ServiceJobStatus[] = [
  'New',
  'ReCall',
  'Diagnosis',
  'In progress',
  'Parts ordered',
  'Waiting for parts',
  'To finish',
  'Completed',
  'Warranty',
  'Cancelled',
];

const paidLabels = new Set(['paid', 'complete', 'completed', 'collected', 'yes', 'true', 'cash', 'check', 'card', 'credit card', 'zelle', 'venmo']);

const baseSourceColumns = {
  jobNumberColumns: ['Job #', 'Job Number', 'Job ID', 'Invoice #', 'Invoice Number', 'Number', 'Work Order #', 'Work Order Number'],
  companyColumns: ['Customer', 'Company', 'Customer Name', 'Client', 'Client Company', 'Billing Name', 'Display Name'],
  contactColumns: ['Contact', 'Contact Name', 'Client Name', 'First Name', 'Name', 'Customer Contact', 'Primary Contact'],
  phoneColumns: ['Phone', 'Customer Phone', 'Mobile Phone', 'Home Phone', 'Primary Phone', 'Phone Number'],
  emailColumns: ['Email', 'Customer Email', 'Primary Email', 'Email Address'],
  addressColumns: ['Address', 'Service Address', 'Job Address', 'Street', 'Street 1', 'Address 1'],
  systemColumns: ['System', 'Business Unit', 'Job Type', 'Service Type', 'Category', 'Trade'],
  issueColumns: ['Issue', 'Job Description', 'Description', 'Summary', 'Task', 'Call Reason'],
  technicianColumns: ['Technician', 'Assigned To', 'Employee', 'Pro', 'Tech', 'Primary Technician'],
  statusColumns: ['Status', 'Job Status', 'Invoice Status', 'Work Order Status'],
  appointmentColumns: ['Scheduled', 'Scheduled Date', 'Appointment', 'Start Time', 'Date', 'Job Date', 'Arrival Window Start'],
  createdColumns: ['Created', 'Created At', 'Date Created', 'Created Date'],
  scfColumns: ['Service Call Fee', 'Service Fee', 'SCF', 'Trip Charge', 'Dispatch Fee', 'Diagnostic Fee'],
  laborColumns: ['Labor', 'Labor Amount', 'Labor Total', 'Total', 'Balance', 'Invoice Total', 'Amount', 'Grand Total'],
  paymentColumns: ['SCF Payment', 'Service Fee Payment', 'Payment Method', 'Labor Payment', 'Paid By', 'Payment Status'],
};

const migrationSources: MigrationSource[] = [
  {
    id: 'housecall_pro',
    name: 'Housecall Pro',
    audience: 'Small service companies moving jobs, customers, invoices, and unpaid work.',
    jobsDetail: 'Upload the Housecall Pro Jobs export.',
    customersDetail: 'Optional Customers export improves matching.',
    importedFromLabel: 'Housecall Pro',
    note: 'Best first step for HCP companies: customers + jobs now, invoices/payments as CSV columns when present.',
    ...baseSourceColumns,
  },
  {
    id: 'jobber',
    name: 'Jobber',
    audience: 'Strong target for HVAC, plumbing, appliance, cleaning, and home service teams.',
    jobsDetail: 'Upload Jobber Requests, Jobs, or Invoices CSV.',
    customersDetail: 'Upload Jobber Clients CSV for cleaner customer data.',
    importedFromLabel: 'Jobber',
    note: 'Use this to pitch a same-day move from Jobber: clients, scheduled jobs, totals, balances, and tech assignment.',
    ...baseSourceColumns,
    jobNumberColumns: ['Job #', 'Job Number', 'Request #', 'Invoice #', 'Quote #', 'Number'],
    companyColumns: ['Client', 'Client Name', 'Company Name', 'Customer', 'Customer Name'],
    issueColumns: ['Title', 'Description', 'Job Description', 'Request Title', 'Internal Notes'],
    appointmentColumns: ['Start At', 'Scheduled Start', 'Visit Start', 'Date', 'Created At'],
  },
  {
    id: 'workiz',
    name: 'Workiz',
    audience: 'Phone-heavy dispatch teams and lead-driven service companies.',
    jobsDetail: 'Upload Workiz Jobs, Calls, or Invoices CSV.',
    customersDetail: 'Upload Workiz Clients CSV if available.',
    importedFromLabel: 'Workiz',
    note: 'Good for companies that care about calls, dispatch, and fast job history transfer.',
    ...baseSourceColumns,
    jobNumberColumns: ['Job ID', 'Job #', 'Ticket ID', 'Lead ID', 'Invoice #'],
    companyColumns: ['Client Name', 'Customer Name', 'Company', 'Name'],
    technicianColumns: ['Tech', 'Technician', 'Assigned Technician', 'Dispatcher'],
    issueColumns: ['Job Type', 'Description', 'Issue', 'Lead Source'],
  },
  {
    id: 'servicetitan',
    name: 'ServiceTitan',
    audience: 'Larger trades companies where migration is higher value but more structured.',
    jobsDetail: 'Upload exported Jobs or Invoices CSV from reports.',
    customersDetail: 'Upload Customers or Locations export.',
    importedFromLabel: 'ServiceTitan',
    note: 'Use as white-glove migration: jobs first, then customers, locations, equipment, memberships, and pricebook later.',
    ...baseSourceColumns,
    jobNumberColumns: ['Job Number', 'Project Number', 'Invoice Number', 'Work Order Number'],
    companyColumns: ['Customer Name', 'Location Name', 'Bill To Name', 'Company'],
    addressColumns: ['Location Address', 'Service Location', 'Address', 'Street'],
    technicianColumns: ['Primary Technician', 'Technician', 'Assigned Technician'],
    systemColumns: ['Business Unit', 'Job Type', 'Trade'],
  },
  {
    id: 'fieldedge',
    name: 'FieldEdge',
    audience: 'HVAC and trades companies tied to dispatch and QuickBooks workflows.',
    jobsDetail: 'Upload FieldEdge Work Orders, Jobs, or Invoices CSV.',
    customersDetail: 'Upload Customers CSV if available.',
    importedFromLabel: 'FieldEdge',
    note: 'Good for companies that want dispatch + finance without keeping an older QuickBooks-heavy workflow.',
    ...baseSourceColumns,
    jobNumberColumns: ['Work Order #', 'WO #', 'Invoice #', 'Job #'],
    companyColumns: ['Customer', 'Customer Name', 'Bill To', 'Company'],
    issueColumns: ['Problem', 'Description', 'Work Requested', 'Notes'],
  },
  {
    id: 'service_fusion',
    name: 'Service Fusion',
    audience: 'Small and mid-size field service teams with jobs, estimates, and invoices.',
    jobsDetail: 'Upload Service Fusion Jobs, Estimates, or Invoices CSV.',
    customersDetail: 'Upload Customer list CSV if available.',
    importedFromLabel: 'Service Fusion',
    note: 'Useful second-wave target: import open/completed jobs and unpaid balances first.',
    ...baseSourceColumns,
    jobNumberColumns: ['Job Number', 'Estimate Number', 'Invoice Number', 'Customer PO', 'Number'],
    issueColumns: ['Description', 'Services', 'Job Notes', 'Memo'],
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks / spreadsheets',
    audience: 'Companies running service work from invoices, Excel, and Google Sheets.',
    jobsDetail: 'Upload invoice/job spreadsheet exported from QuickBooks or Excel.',
    customersDetail: 'Upload customer list CSV if separate.',
    importedFromLabel: 'QuickBooks or spreadsheet',
    note: 'This is the easiest landing path for companies without real field-service software.',
    ...baseSourceColumns,
    jobNumberColumns: ['Invoice No.', 'Invoice #', 'Transaction No.', 'Doc Number', 'Job #', 'Number'],
    companyColumns: ['Customer', 'Customer Name', 'Name', 'Company'],
    laborColumns: ['Amount', 'Open Balance', 'Balance', 'Total', 'Invoice Total'],
    statusColumns: ['Status', 'Paid Status'],
  },
  {
    id: 'generic',
    name: 'Generic CSV',
    audience: 'Fallback for any CRM/FSM export.',
    jobsDetail: 'Upload any jobs/invoices/work-orders CSV.',
    customersDetail: 'Optional customer CSV.',
    importedFromLabel: 'Generic CSV',
    note: 'Use when a competitor export has different names. The parser accepts many common column labels.',
    ...baseSourceColumns,
  },
];

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cell(row: CsvRow | undefined, names: string[]) {
  if (!row) return '';
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeKey(key), value]));
  for (const name of names) {
    const value = normalized[normalizeKey(name)];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);

  const headers = rows.shift()?.map((header) => header.trim()) ?? [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ''])));
}

function moneyValue(value: string) {
  const cleaned = value.replace(/[$,\s]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : '';
}

function paymentValue(value: string, amount: string) {
  if (!amount) return '';
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === '-' || normalized === 'unpaid' || normalized === 'open') return '';
  return paidLabels.has(normalized) ? value.trim() : value.trim();
}

function statusValue(value: string): ServiceJobStatus {
  const normalized = value.trim().toLowerCase();
  if (['complete', 'completed', 'done', 'closed'].includes(normalized)) return 'Completed';
  if (['canceled', 'cancelled', 'archived'].includes(normalized)) return 'Cancelled';
  if (normalized.includes('part')) return normalized.includes('wait') ? 'Waiting for parts' : 'Parts ordered';
  if (normalized.includes('progress')) return 'In progress';
  if (normalized.includes('diagnos')) return 'Diagnosis';
  if (normalized.includes('recall')) return 'ReCall';
  if (normalized.includes('warranty')) return 'Warranty';
  if (statusOptions.includes(value as ServiceJobStatus)) return value as ServiceJobStatus;
  return 'New';
}

function parseDate(value: string) {
  if (!value) return '';
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  const match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
  if (!match) return '';
  const month = Number(match[1]) - 1;
  const day = Number(match[2]);
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  let hour = Number(match[4] ?? 9);
  const minute = Number(match[5] ?? 0);
  const meridiem = match[6]?.toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return new Date(year, month, day, hour, minute).toISOString();
}

function rowText(row: CsvRow) {
  return Object.values(row).join(' ').trim().toLowerCase();
}

function matchCustomer(customers: CsvRow[], jobRow: CsvRow, source: MigrationSource) {
  const company = cell(jobRow, source.companyColumns);
  const phone = cell(jobRow, source.phoneColumns);
  const email = cell(jobRow, source.emailColumns);
  const key = [company, phone, email].filter(Boolean).map((value) => value.toLowerCase());
  if (!key.length) return undefined;
  return customers.find((customer) => {
    const text = rowText(customer);
    return key.some((value) => value && text.includes(value));
  });
}

function buildJob(companyId: string, row: CsvRow, customerRow: CsvRow | undefined, existing: ServiceJob | undefined, fallbackNumber: string, source: MigrationSource): ImportDraft {
  const jobNumber = cell(row, source.jobNumberColumns) || fallbackNumber;
  const organization = cell(row, source.companyColumns)
    || cell(customerRow, source.companyColumns)
    || cell(row, ['Name']);
  const clientName = cell(row, source.contactColumns)
    || cell(customerRow, source.contactColumns)
    || organization;
  const phone = cell(row, source.phoneColumns)
    || cell(customerRow, source.phoneColumns);
  const email = cell(row, source.emailColumns)
    || cell(customerRow, source.emailColumns);
  const address = [
    cell(row, source.addressColumns),
    cell(row, ['City']),
    cell(row, ['State']),
    cell(row, ['Zip', 'Zip Code', 'Postal Code']),
  ].filter(Boolean).join(', ') || cell(customerRow, source.addressColumns);
  const scf = moneyValue(cell(row, source.scfColumns));
  const labor = moneyValue(cell(row, source.laborColumns));
  const technician = cell(row, source.technicianColumns) || existing?.technician || 'No technician';
  const status = statusValue(cell(row, source.statusColumns));
  const appointment = parseDate(cell(row, source.appointmentColumns));
  const notes = [
    cell(row, ['Notes', 'Private Notes', 'Description']),
    cell(row, ['Tags']) ? `${source.name} tags: ${cell(row, ['Tags'])}` : '',
    cell(row, ['Invoice #', 'Invoice Number']) ? `${source.name} invoice: ${cell(row, ['Invoice #', 'Invoice Number'])}` : '',
  ].filter(Boolean).join('\n');
  const warnings = [
    !organization ? 'missing customer/company' : '',
    !phone && !email ? 'missing phone/email' : '',
    !address ? 'missing address' : '',
  ].filter(Boolean);

  return {
    action: existing ? 'update' : 'create',
    warnings,
    job: {
      id: existing?.id ?? crypto.randomUUID(),
      companyId,
      customerId: existing?.customerId,
      jobNumber,
      status,
      system: cell(row, source.systemColumns) || existing?.system || 'Appliance',
      clientName,
      organization,
      phone,
      email,
      address,
      technician,
      assignee: technician,
      serviceCallFee: scf,
      scfPayment: paymentValue(cell(row, source.paymentColumns), scf),
      labor,
      laborPayment: paymentValue(cell(row, source.paymentColumns), labor),
      issue: cell(row, source.issueColumns) || `Imported from ${source.importedFromLabel}`,
      notes,
      customerBlacklist: existing?.customerBlacklist,
      attachments: existing?.attachments ?? [],
      comments: existing?.comments ?? [],
      invoices: existing?.invoices ?? [],
      appointment: appointment || existing?.appointment,
      calendarDurationMinutes: existing?.calendarDurationMinutes ?? 120,
      createdAt: parseDate(cell(row, source.createdColumns)) || existing?.createdAt || new Date().toISOString(),
    },
  };
}

function CsvFilePicker({ icon, title, detail, fileName, disabled, onFile }: CsvFilePickerProps) {
  return (
    <label className={`import-upload-card${disabled ? ' disabled' : ''}`}>
      {icon}
      <strong>{title}</strong>
      <span>{detail}</span>
      <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={disabled} />
      <div className="import-file-control">
        <b>Choose CSV</b>
        <small>{fileName || 'No file selected'}</small>
      </div>
    </label>
  );
}

export function ImportPage({
  companyId,
  profile,
  existingJobs,
  nextJobNumber,
  onImportJobs,
  readOnly,
}: {
  companyId: string;
  profile: CompanyOnboardingProfile;
  existingJobs: ServiceJob[];
  nextJobNumber: string;
  onImportJobs: (jobs: ServiceJob[]) => Promise<void>;
  readOnly?: boolean;
}) {
  const [customersRows, setCustomersRows] = useState<CsvRow[]>([]);
  const [jobsRows, setJobsRows] = useState<CsvRow[]>([]);
  const [status, setStatus] = useState('');
  const [importing, setImporting] = useState(false);
  const [jobsFileName, setJobsFileName] = useState('');
  const [customersFileName, setCustomersFileName] = useState('');
  const [sourceId, setSourceId] = useState<MigrationSourceId>('housecall_pro');

  const activeSource = migrationSources.find((source) => source.id === sourceId) ?? migrationSources[0];
  const existingByNumber = useMemo(() => new Map(existingJobs.map((job) => [job.jobNumber.toLowerCase(), job])), [existingJobs]);
  const drafts = useMemo(() => jobsRows.map((row, index) => {
    const jobNumber = cell(row, activeSource.jobNumberColumns);
    const fallback = `${profile.jobNumberPrefix || 'HVAC'}-${String(Number(nextJobNumber.replace(/\D/g, '')) + index || index + 1).padStart(4, '0')}`;
    return buildJob(companyId, row, matchCustomer(customersRows, row, activeSource), jobNumber ? existingByNumber.get(jobNumber.toLowerCase()) : undefined, fallback, activeSource);
  }), [activeSource, companyId, customersRows, existingByNumber, jobsRows, nextJobNumber, profile.jobNumberPrefix]);
  const validDrafts = drafts.filter(({ job }) => job.jobNumber.trim() && (job.organization.trim() || job.clientName.trim()));
  const createCount = validDrafts.filter((draft) => draft.action === 'create').length;
  const updateCount = validDrafts.filter((draft) => draft.action === 'update').length;
  const warningCount = validDrafts.reduce((sum, draft) => sum + draft.warnings.length, 0);

  async function readFile(event: ChangeEvent<HTMLInputElement>, setter: (rows: CsvRow[]) => void, setFileName: (value: string) => void) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    setFileName(file.name);
    setter(rows);
    setStatus(`${file.name}: ${rows.length} rows loaded for ${activeSource.name}.`);
  }

  async function importJobs() {
    if (!validDrafts.length || readOnly) return;
    setImporting(true);
    setStatus(`Importing ${validDrafts.length} jobs...`);
    try {
      await onImportJobs(validDrafts.map((draft) => draft.job));
      setStatus(`Imported ${validDrafts.length} jobs from ${activeSource.name}. ${createCount} new, ${updateCount} updated.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="portal-section import-page">
      <div className="section-title-row">
        <div>
          <span className="eyebrow">Migration</span>
          <h1>Migration Center</h1>
          <p className="import-source-note">{activeSource.note}</p>
        </div>
        <button className="primary-button import-action-button" type="button" onClick={importJobs} disabled={readOnly || importing || validDrafts.length === 0}>
          <UploadCloud size={16} /> {importing ? 'Importing...' : 'Import jobs'}
        </button>
      </div>

      <div className="migration-source-grid" role="list" aria-label="Migration source">
        {migrationSources.map((source) => (
          <button
            className={`migration-source-card${source.id === activeSource.id ? ' active' : ''}`}
            type="button"
            key={source.id}
            onClick={() => setSourceId(source.id)}
            disabled={importing}
          >
            <span>
              <strong>{source.name}</strong>
              {source.id === activeSource.id ? <CheckCircle2 size={16} aria-hidden="true" /> : null}
            </span>
            <small>{source.audience}</small>
          </button>
        ))}
      </div>

      <div className="import-upload-grid">
        <CsvFilePicker
          icon={<FileSpreadsheet size={20} />}
          title="Jobs CSV"
          detail={activeSource.jobsDetail}
          fileName={jobsFileName}
          disabled={readOnly || importing}
          onFile={(event) => void readFile(event, setJobsRows, setJobsFileName)}
        />
        <CsvFilePicker
          icon={<Database size={20} />}
          title="Customers CSV"
          detail={activeSource.customersDetail}
          fileName={customersFileName}
          disabled={readOnly || importing}
          onFile={(event) => void readFile(event, setCustomersRows, setCustomersFileName)}
        />
      </div>

      <div className="import-summary-grid">
        <div className="metric-card"><span>Jobs rows</span><strong>{jobsRows.length}</strong><p>From {activeSource.name}</p></div>
        <div className="metric-card"><span>Customers rows</span><strong>{customersRows.length}</strong><p>Optional lookup</p></div>
        <div className="metric-card"><span>New</span><strong>{createCount}</strong><p>Will be created</p></div>
        <div className="metric-card"><span>Updates</span><strong>{updateCount}</strong><p>Matched by Job #</p></div>
      </div>

      {status ? <p className="access-status portal-status">{status}</p> : null}
      {warningCount ? <p className="access-status warning">{warningCount} fields need review. Rows still import so you can clean them after migration.</p> : null}

      <div className="all-jobs-table-wrap import-preview">
        <table className="all-jobs-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Job #</th>
              <th>Customer</th>
              <th>Phone</th>
              <th>Address</th>
              <th>System</th>
              <th>Status</th>
              <th>SCF</th>
              <th>Labor</th>
              <th>Warnings</th>
            </tr>
          </thead>
          <tbody>
            {validDrafts.slice(0, 80).map(({ job, action, warnings }) => (
              <tr key={`${action}-${job.jobNumber}`}>
                <td><span className={`import-pill ${action}`}>{action}</span></td>
                <td>{job.jobNumber}</td>
                <td><strong>{job.organization || job.clientName}</strong><br /><small>{job.clientName}</small></td>
                <td>{job.phone}</td>
                <td>{job.address}</td>
                <td>{job.system}</td>
                <td>{job.status}</td>
                <td>{job.serviceCallFee || '-'}</td>
                <td>{job.labor || '-'}</td>
                <td>{warnings.length ? warnings.join(', ') : 'OK'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!validDrafts.length ? <span className="empty-inline">Choose a source and upload a jobs CSV to preview import rows.</span> : null}
      </div>
    </section>
  );
}
