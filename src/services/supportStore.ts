import type { Company, NewSupportTicketForm, SupportTicket, SupportTicketStatus } from '../types';

const SUPPORT_STORAGE_KEY = 'servicescope.supportTickets';

function nowStamp() {
  return new Date().toLocaleString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
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

function normalizeTicket(ticket: Partial<SupportTicket>, companies: Company[]): SupportTicket {
  const company = companies.find((candidate) => candidate.id === ticket.companyId) ?? companies[0];

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
    createdAt: ticket.createdAt ?? nowStamp(),
    lastUpdate: ticket.lastUpdate ?? nowStamp(),
    messages: ticket.messages?.length ? ticket.messages : [
      {
        id: crypto.randomUUID(),
        author: 'company',
        authorName: ticket.authorName ?? company?.ownerName ?? 'Customer',
        body: ticket.message ?? '',
        createdAt: ticket.createdAt ?? nowStamp(),
      },
    ],
  };
}

export function listSupportTickets(companies: Company[]): SupportTicket[] {
  return readStoredTickets().map((ticket) => normalizeTicket(ticket, companies));
}

export function saveSupportTickets(tickets: SupportTicket[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SUPPORT_STORAGE_KEY, JSON.stringify(tickets));
}

export function createSupportTicket(form: NewSupportTicketForm, companies: Company[]): SupportTicket {
  const company = companies.find((candidate) => candidate.id === form.companyId);
  const createdAt = nowStamp();

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
  return {
    ...ticket,
    status,
    lastUpdate: nowStamp(),
  };
}

export function addOwnerReply(ticket: SupportTicket, body: string): SupportTicket {
  const stamp = nowStamp();

  return {
    ...ticket,
    status: ticket.status === 'new' ? 'reviewing' : ticket.status,
    lastUpdate: stamp,
    messages: [
      ...ticket.messages,
      {
        id: crypto.randomUUID(),
        author: 'owner',
        authorName: 'ServiceScope Owner',
        body,
        createdAt: stamp,
      },
    ],
  };
}