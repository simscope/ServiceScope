import type { JobInboxForm, JobInboxItem, JobInboxSource, JobInboxStatus } from '../../appTypes';
import { sqlEq, supabaseRequest } from '../../services/supabaseRest';

type JobInboxRow = {
  id: string;
  company_id: string;
  source: JobInboxSource;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  address: string | null;
  message: string | null;
  status: JobInboxStatus;
  job_id: string | null;
  created_at: string;
};

function rowToJobInboxItem(row: JobInboxRow): JobInboxItem {
  return {
    id: row.id,
    companyId: row.company_id,
    source: row.source,
    clientName: row.client_name ?? '',
    clientPhone: row.client_phone ?? '',
    clientEmail: row.client_email ?? '',
    address: row.address ?? '',
    message: row.message ?? '',
    status: row.status,
    jobId: row.job_id ?? '',
    createdAt: row.created_at,
  };
}

function formToRow(companyId: string, form: JobInboxForm) {
  return {
    company_id: companyId,
    source: form.source,
    client_name: form.clientName.trim(),
    client_phone: form.clientPhone.trim(),
    client_email: form.clientEmail.trim().toLowerCase() || null,
    address: form.address.trim(),
    message: form.message.trim(),
    status: 'new' as JobInboxStatus,
  };
}

export async function listJobInboxItems(companyId: string) {
  const rows = await supabaseRequest<JobInboxRow[]>(
    `job_inbox?company_id=${sqlEq(companyId)}&select=*&order=created_at.desc&limit=200`,
  );

  return rows.map(rowToJobInboxItem);
}

export async function createJobInboxItem(companyId: string, form: JobInboxForm) {
  const rows = await supabaseRequest<JobInboxRow[]>('job_inbox?select=*', {
    method: 'POST',
    select: true,
    body: [formToRow(companyId, form)],
  });

  return rowToJobInboxItem(rows[0]);
}

export async function updateJobInboxStatus(companyId: string, itemId: string, status: JobInboxStatus, jobId = '') {
  const rows = await supabaseRequest<JobInboxRow[]>(
    `job_inbox?company_id=${sqlEq(companyId)}&id=${sqlEq(itemId)}&select=*`,
    {
      method: 'PATCH',
      select: true,
      body: {
        status,
        job_id: jobId || null,
      },
    },
  );

  return rowToJobInboxItem(rows[0]);
}
