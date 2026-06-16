import type { Company, NewSupportTicketForm, SupportTicket, SupportTicketStatus } from '../types';

const STORAGE_KEY = 'servicescope.v2.supportTickets';

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
    createdAt: ticket.createdAt ?? 'Today',
    lastUpdate: ticket.lastUpdate ?? 'Just now',
    messages: ticket.messages ?? [
      {
        id: crypto.randomUUID(),
        author: 'company',
        authorName: ticket.authorName ?? company?.ownerName ?? 'Customer',
        body: ticket.message ?? '',
        createdAt: ticket.createdAt ?? 'Today',
      },
    ],
  };
}

export function listSupportTickets(companies: Company[]) {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return [];

  try {
    return (JSON.parse(saved) as Partial<SupportTicket>[]).map((ticket) => normalizeTicket(ticket, companies));
  } catch {
    return [];
  }
}

export function saveSupportTickets(tickets: SupportTicket[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets));
}

export function createSupportTicket(form: NewSupportTicketForm, companies: Company[]): SupportTicket {
  const company = companies.find((candidate) => candidate.id === form.companyId);

  return {
    id: crypto.randomUUID(),
    ...form,
    companyName: company?.name ?? 'Unknown company',
    status: 'new',
    createdAt: 'Today',
    lastUpdate: 'Just now',
    messages: [
      {
        id: crypto.randomUUID(),
        author: 'company',
        authorName: form.authorName,
        body: form.message,
        createdAt: 'Just now',
      },
    ],
  };
}

export function updateSupportTicketStatus(ticket: SupportTicket, status: SupportTicketStatus): SupportTicket {
  return {
    ...ticket,
    status,
    lastUpdate: 'Just now',
  };
}

export function addOwnerReply(ticket: SupportTicket, body: string): SupportTicket {
  return {
    ...ticket,
    status: ticket.status === 'new' ? 'reviewing' : ticket.status,
    lastUpdate: 'Just now',
    messages: [
      ...ticket.messages,
      {
        id: crypto.randomUUID(),
        author: 'owner',
        authorName: 'ServiceScope Owner',
        body,
        createdAt: 'Just now',
      },
    ],
  };
}
