import { useMemo, useState, type ChangeEvent } from 'react';
import { Database, FileSpreadsheet, UploadCloud } from 'lucide-react';
import type { CompanyOnboardingProfile, ServiceJob, ServiceJobStatus } from '../../types';

type CsvRow = Record<string, string>;

type ImportDraft = {
  job: ServiceJob;
  action: 'create' | 'update';
  warnings: string[];
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

function matchCustomer(customers: CsvRow[], jobRow: CsvRow) {
  const company = cell(jobRow, ['Customer', 'Company', 'Customer Name', 'Client', 'Client Name']);
  const phone = cell(jobRow, ['Phone', 'Customer Phone', 'Mobile Phone']);
  const email = cell(jobRow, ['Email', 'Customer Email']);
  const key = [company, phone, email].filter(Boolean).map((value) => value.toLowerCase());
  if (!key.length) return undefined;
  return customers.find((customer) => {
    const text = rowText(customer);
    return key.some((value) => value && text.includes(value));
  });
}

function buildJob(companyId: string, row: CsvRow, customerRow: CsvRow | undefined, existing: ServiceJob | undefined, fallbackNumber: string): ImportDraft {
  const jobNumber = cell(row, ['Job #', 'Job Number', 'Job ID', 'Invoice #', 'Invoice Number', 'Number']) || fallbackNumber;
  const organization = cell(row, ['Customer', 'Company', 'Customer Name', 'Client', 'Client Company'])
    || cell(customerRow, ['Company', 'Customer', 'Customer Name'])
    || cell(row, ['Name']);
  const clientName = cell(row, ['Contact', 'Contact Name', 'Client Name', 'First Name', 'Name'])
    || cell(customerRow, ['Contact', 'Contact Name', 'First Name', 'Name'])
    || organization;
  const phone = cell(row, ['Phone', 'Customer Phone', 'Mobile Phone', 'Home Phone'])
    || cell(customerRow, ['Phone', 'Customer Phone', 'Mobile Phone', 'Home Phone']);
  const email = cell(row, ['Email', 'Customer Email'])
    || cell(customerRow, ['Email', 'Customer Email']);
  const address = [
    cell(row, ['Address', 'Service Address', 'Job Address', 'Street']),
    cell(row, ['City']),
    cell(row, ['State']),
    cell(row, ['Zip', 'Zip Code', 'Postal Code']),
  ].filter(Boolean).join(', ') || cell(customerRow, ['Address', 'Service Address', 'Street']);
  const scf = moneyValue(cell(row, ['Service Call Fee', 'Service Fee', 'SCF', 'Trip Charge']));
  const labor = moneyValue(cell(row, ['Labor', 'Labor Amount', 'Labor Total', 'Total', 'Balance', 'Invoice Total']));
  const technician = cell(row, ['Technician', 'Assigned To', 'Employee', 'Pro']) || existing?.technician || 'No technician';
  const status = statusValue(cell(row, ['Status', 'Job Status', 'Invoice Status']));
  const appointment = parseDate(cell(row, ['Scheduled', 'Scheduled Date', 'Appointment', 'Start Time', 'Date']));
  const notes = [
    cell(row, ['Notes', 'Private Notes', 'Description']),
    cell(row, ['Tags']) ? `HCP tags: ${cell(row, ['Tags'])}` : '',
    cell(row, ['Invoice #', 'Invoice Number']) ? `HCP invoice: ${cell(row, ['Invoice #', 'Invoice Number'])}` : '',
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
      system: cell(row, ['System', 'Business Unit', 'Job Type', 'Service Type']) || existing?.system || 'Appliance',
      clientName,
      organization,
      phone,
      email,
      address,
      technician,
      assignee: technician,
      serviceCallFee: scf,
      scfPayment: paymentValue(cell(row, ['SCF Payment', 'Service Fee Payment', 'Payment Method']), scf),
      labor,
      laborPayment: paymentValue(cell(row, ['Labor Payment', 'Payment Method', 'Paid By']), labor),
      issue: cell(row, ['Issue', 'Job Description', 'Description', 'Summary']) || 'Imported from Housecall Pro',
      notes,
      customerBlacklist: existing?.customerBlacklist,
      attachments: existing?.attachments ?? [],
      comments: existing?.comments ?? [],
      invoices: existing?.invoices ?? [],
      appointment: appointment || existing?.appointment,
      calendarDurationMinutes: existing?.calendarDurationMinutes ?? 120,
      createdAt: parseDate(cell(row, ['Created', 'Created At', 'Date Created'])) || existing?.createdAt || new Date().toISOString(),
    },
  };
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

  const existingByNumber = useMemo(() => new Map(existingJobs.map((job) => [job.jobNumber.toLowerCase(), job])), [existingJobs]);
  const drafts = useMemo(() => jobsRows.map((row, index) => {
    const jobNumber = cell(row, ['Job #', 'Job Number', 'Job ID', 'Invoice #', 'Invoice Number', 'Number']);
    const fallback = `${profile.jobNumberPrefix || 'HVAC'}-${String(Number(nextJobNumber.replace(/\D/g, '')) + index || index + 1).padStart(4, '0')}`;
    return buildJob(companyId, row, matchCustomer(customersRows, row), jobNumber ? existingByNumber.get(jobNumber.toLowerCase()) : undefined, fallback);
  }), [companyId, customersRows, existingByNumber, jobsRows, nextJobNumber, profile.jobNumberPrefix]);
  const validDrafts = drafts.filter(({ job }) => job.jobNumber.trim() && (job.organization.trim() || job.clientName.trim()));
  const createCount = validDrafts.filter((draft) => draft.action === 'create').length;
  const updateCount = validDrafts.filter((draft) => draft.action === 'update').length;
  const warningCount = validDrafts.reduce((sum, draft) => sum + draft.warnings.length, 0);

  async function readFile(event: ChangeEvent<HTMLInputElement>, setter: (rows: CsvRow[]) => void) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    setter(rows);
    setStatus(`${file.name}: ${rows.length} rows loaded.`);
  }

  async function importJobs() {
    if (!validDrafts.length || readOnly) return;
    setImporting(true);
    setStatus(`Importing ${validDrafts.length} jobs...`);
    try {
      await onImportJobs(validDrafts.map((draft) => draft.job));
      setStatus(`Imported ${validDrafts.length} jobs. ${createCount} new, ${updateCount} updated.`);
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
          <h1>Housecall Pro import</h1>
        </div>
        <button className="primary-action" type="button" onClick={importJobs} disabled={readOnly || importing || validDrafts.length === 0}>
          <UploadCloud size={16} /> {importing ? 'Importing...' : 'Import jobs'}
        </button>
      </div>

      <div className="import-upload-grid">
        <label className="import-upload-card">
          <FileSpreadsheet size={20} />
          <strong>Jobs CSV</strong>
          <span>Export Jobs from Housecall Pro and upload it here.</span>
          <input type="file" accept=".csv,text/csv" onChange={(event) => void readFile(event, setJobsRows)} disabled={readOnly || importing} />
        </label>
        <label className="import-upload-card">
          <Database size={20} />
          <strong>Customers CSV</strong>
          <span>Optional, but improves customer name, phone, email, and address matching.</span>
          <input type="file" accept=".csv,text/csv" onChange={(event) => void readFile(event, setCustomersRows)} disabled={readOnly || importing} />
        </label>
      </div>

      <div className="metric-grid import-metrics">
        <div className="metric-card"><span>Jobs rows</span><strong>{jobsRows.length}</strong><p>From HCP export</p></div>
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
        {!validDrafts.length ? <span className="empty-inline">Upload a Housecall Pro jobs CSV to preview import rows.</span> : null}
      </div>
    </section>
  );
}
