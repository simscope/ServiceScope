const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const supportStorePath = path.join(root, 'src/services/supportStore.ts');
const appPath = path.join(root, 'src/App.tsx');

function read(filePath) { return fs.readFileSync(filePath, 'utf8'); }
function write(filePath, content) { fs.writeFileSync(filePath, content); }

const supportStoreSource = `import type { Company, NewSupportTicketForm, SupportTicket, SupportTicketStatus } from '../types';
import { isSupabaseConfigured, sqlEq, sqlIn, supabaseRequest } from './supabaseRest';

const SUPPORT_STORAGE_KEY = 'servicescope.supportTickets';

type OwnerSupportTicketRow = {
  id: string;
  company_id: string | null;
  author_user_id: string | null;
  author_name: string;
  author_email: string | null;
  kind: SupportTicket['kind'];
  priority: SupportTicket['priority'];
  status: SupportTicket['status'];
  subject: string;
  message: string;
  last_update_at: string;
  created_at: string;
  updated_at: string;
};

type OwnerSupportMessageRow = {
  id: string;
  ticket_id: string;
  company_id: string | null;
  author_user_id: string | null;
  author: SupportTicket['messages'][number]['author'];
  author_name: string;
  body: string;
  created_at: string;
};

function supportTimestamp(date = new Date()) {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeTimestamp(value?: string) {
  if (!value || value === 'Just now') return supportTimestamp();
  return value;
}

function toIsoTimestamp(value?: string) {
  if (!value || value === 'Just now') return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function formatSupportTime(value?: string | null) {
  if (!value) return supportTimestamp();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : supportTimestamp(parsed);
}

function readStoredTickets() {
  if (typeof window === 'undefined') return [] as SupportTicket[];

  const saved = window.localStorage.getItem(SUPPORT_STORAGE_KEY);
  if (!saved) return [] as SupportTicket[];

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed as SupportTicket[] : [];
  } catch {
    return [] as SupportTicket[];
  }
}

function companyForTicket(companies: Company[], companyId?: string | null) {
  return companies.find((candidate) => candidate.id === companyId) ?? companies[0];
}

function normalizeTicket(ticket: Partial<SupportTicket>, companies: Company[]): SupportTicket {
  const company = companyForTicket(companies, ticket.companyId);
  const timestamp = normalizeTimestamp(ticket.createdAt);

  return {
    id: ticket.id ?? crypto.randomUUID(),
    companyId: ticket.companyId ?? company?.id ?? '',
    companyName: ticket.companyName ?? company?.name ?? 'Unknown company',
    authorName: ticket.authorName ?? company?.ownerName ?? 'Customer',
    authorEmail: ticket.authorEmail ?? company?.ownerEmail ?? '',
    kind: ticket.kind ?? 'question',
    priority: ticket.priority ?? 'normal',
    status: ticket.status ?? 'new',
    subject: ticket.subject ?? 'Support request',
    message: ticket.message ?? '',
    createdAt: timestamp,
    lastUpdate: normalizeTimestamp(ticket.lastUpdate ?? timestamp),
    messages: ticket.messages?.length ? ticket.messages.map((message) => ({
      ...message,
      createdAt: normalizeTimestamp(message.createdAt),
    })) : [
      {
        id: crypto.randomUUID(),
        author: 'company',
        authorName: ticket.authorName ?? company?.ownerName ?? 'Customer',
        body: ticket.message ?? '',
        createdAt: timestamp,
      },
    ],
  };
}

function rowToTicket(row: OwnerSupportTicketRow, messages: OwnerSupportMessageRow[], companies: Company[]): SupportTicket {
  const company = companyForTicket(companies, row.company_id);
  const createdAt = formatSupportTime(row.created_at);
  const messageRows = messages.filter((message) => message.ticket_id === row.id);

  return {
    id: row.id,
    companyId: row.company_id ?? company?.id ?? '',
    companyName: company?.name ?? 'Unknown company',
    authorName: row.author_name,
    authorEmail: row.author_email ?? '',
    kind: row.kind,
    priority: row.priority,
    status: row.status,
    subject: row.subject,
    message: row.message,
    createdAt,
    lastUpdate: formatSupportTime(row.last_update_at),
    messages: messageRows.length ? messageRows.map((message) => ({
      id: message.id,
      author: message.author,
      authorName: message.author_name,
      body: message.body,
      createdAt: formatSupportTime(message.created_at),
    })) : [
      {
        id: crypto.randomUUID(),
        author: 'company',
        authorName: row.author_name,
        body: row.message,
        createdAt,
      },
    ],
  };
}

function ticketToRow(ticket: SupportTicket): OwnerSupportTicketRow {
  return {
    id: ticket.id,
    company_id: ticket.companyId || null,
    author_user_id: null,
    author_name: ticket.authorName || 'Customer',
    author_email: ticket.authorEmail || null,
    kind: ticket.kind,
    priority: ticket.priority,
    status: ticket.status,
    subject: ticket.subject,
    message: ticket.message,
    last_update_at: toIsoTimestamp(ticket.lastUpdate),
    created_at: toIsoTimestamp(ticket.createdAt),
    updated_at: new Date().toISOString(),
  };
}

function ticketMessagesToRows(ticket: SupportTicket): OwnerSupportMessageRow[] {
  return ticket.messages.map((message) => ({
    id: message.id,
    ticket_id: ticket.id,
    company_id: ticket.companyId || null,
    author_user_id: null,
    author: message.author,
    author_name: message.authorName,
    body: message.body,
    created_at: toIsoTimestamp(message.createdAt),
  }));
}

export function listSupportTickets(companies: Company[]): SupportTicket[] {
  return readStoredTickets().map((ticket) => normalizeTicket(ticket, companies));
}

export async function loadSupportTicketsFromBackend(companies: Company[], companyId?: string) {
  const companyFilter = companyId ? \`&company_id=\${sqlEq(companyId)}\` : '';
  const tickets = await supabaseRequest<OwnerSupportTicketRow[]>(
    \`owner_support_tickets?select=*&order=last_update_at.desc\${companyFilter}\`,
  );
  const ticketIds = tickets.map((ticket) => ticket.id);
  const messages = ticketIds.length
    ? await supabaseRequest<OwnerSupportMessageRow[]>(
      \`owner_support_messages?ticket_id=\${sqlIn(ticketIds)}&select=*&order=created_at.asc\`,
    )
    : [];

  const mapped = tickets.map((ticket) => rowToTicket(ticket, messages, companies));
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SUPPORT_STORAGE_KEY, JSON.stringify(mapped));
  }
  return mapped;
}

async function persistSupportTicketsToBackend(tickets: SupportTicket[]) {
  if (!tickets.length || !isSupabaseConfigured()) return;

  await supabaseRequest('owner_support_tickets?on_conflict=id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: tickets.map(ticketToRow),
  });

  const messageRows = tickets.flatMap(ticketMessagesToRows);
  if (messageRows.length) {
    await supabaseRequest('owner_support_messages?on_conflict=id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: messageRows,
    });
  }
}

export function saveSupportTickets(tickets: SupportTicket[]) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SUPPORT_STORAGE_KEY, JSON.stringify(tickets));
  }

  void persistSupportTicketsToBackend(tickets).catch((error) => {
    console.error('Failed to save support tickets to Supabase', error);
  });
}

export function createSupportTicket(form: NewSupportTicketForm, companies: Company[]): SupportTicket {
  const company = companies.find((candidate) => candidate.id === form.companyId);
  const createdAt = supportTimestamp();

  return {
    id: crypto.randomUUID(),
    ...form,
    companyName: company?.name ?? 'Unknown company',
    status: 'new',
    createdAt,
    lastUpdate: createdAt,
    messages: [
      {
        id: crypto.randomUUID(),
        author: 'company',
        authorName: form.authorName,
        body: form.message,
        createdAt,
      },
    ],
  };
}

export function updateSupportTicketStatus(ticket: SupportTicket, status: SupportTicketStatus): SupportTicket {
  const updatedAt = supportTimestamp();

  return {
    ...ticket,
    status,
    lastUpdate: updatedAt,
  };
}

export function addOwnerReply(ticket: SupportTicket, body: string): SupportTicket {
  const createdAt = supportTimestamp();

  return {
    ...ticket,
    status: ticket.status === 'new' ? 'reviewing' : ticket.status,
    lastUpdate: createdAt,
    messages: [
      ...ticket.messages,
      {
        id: crypto.randomUUID(),
        author: 'owner',
        authorName: 'ServiceScope Support',
        body,
        createdAt,
      },
    ],
  };
}

export function addCompanyReply(ticket: SupportTicket, body: string, authorName: string): SupportTicket {
  const createdAt = supportTimestamp();

  return {
    ...ticket,
    status: ticket.status === 'resolved' ? 'reviewing' : ticket.status,
    lastUpdate: createdAt,
    messages: [
      ...ticket.messages,
      {
        id: crypto.randomUUID(),
        author: 'company',
        authorName: authorName || ticket.authorName || 'Customer',
        body,
        createdAt,
      },
    ],
  };
}
`;
write(supportStorePath, supportStoreSource);

let app = read(appPath);
if (!app.includes('addCompanyReply')) {
  app = app.replace(
    "  addOwnerReply,\n  createSupportTicket,",
    "  addOwnerReply,\n  addCompanyReply,\n  createSupportTicket,",
  );
}
if (!app.includes('loadSupportTicketsFromBackend')) {
  app = app.replace(
    "  listSupportTickets,\n  saveSupportTickets,",
    "  listSupportTickets,\n  loadSupportTicketsFromBackend,\n  saveSupportTickets,",
  );
}
if (app.includes('        setSupportTickets([]);')) {
  app = app.replace(
    '        setSupportTickets([]);',
    `        loadSupportTicketsFromBackend(
          backendCompanies,
          authSession.kind === 'company' ? authSession.companyId : undefined,
        )
          .then((tickets) => {
            if (ignore) return;
            setSupportTickets(tickets);
            setSelectedTicketId((currentId) => tickets.some((ticket) => ticket.id === currentId) ? currentId : tickets[0]?.id ?? '');
          })
          .catch((error) => {
            if (ignore) return;
            setSupportTickets([]);
            console.error('Failed to load support tickets from Supabase', error);
          });`,
  );
}
if (!app.includes('function createPortalReply')) {
  app = app.replace(
    "  if (!authSession) {",
    `  function createPortalReply(ticketId: string, body: string) {
    const text = body.trim();
    if (!text || !selectedCompany) return;

    const nextTickets = supportTickets.map((ticket) =>
      ticket.id === ticketId && ticket.companyId === selectedCompany.id
        ? addCompanyReply(ticket, text, authSession?.name || selectedCompany.ownerName)
        : ticket,
    );
    setSupportTickets(nextTickets);
    saveSupportTickets(nextTickets);
    setSelectedTicketId(ticketId);
    recordAudit({
      category: 'support',
      action: 'support.customer_reply_sent',
      actor: authSession?.name || selectedCompany.ownerName,
      resource: selectedCompany.name,
      details: 'Customer reply sent from company portal.',
    });
  }

  if (!authSession) {`,
  );
}
if (!app.includes('onReplyToTicket={createPortalReply}')) {
  app = app.replace(
    "          onCreateRequest={createPortalRequest}\n        />",
    "          onCreateRequest={createPortalRequest}\n          onReplyToTicket={createPortalReply}\n        />",
  );
}
write(appPath, app);

console.log('Support Supabase backend store patch applied.');
