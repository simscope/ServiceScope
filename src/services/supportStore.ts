import type { Company, NewSupportTicketForm, SupportTicket, SupportTicketStatus } from '../types';

const STORAGE_KEY = 'servicescope.supportTickets';

const supportTicketsSeed: SupportTicket[] = [
  {
    id: 'sup-apex-import',
    companyId: 'cmp-apex',
    companyName: 'Apex Service Co',
    authorName: 'Maria Chen',
    authorEmail: 'maria@apex.example',
    kind: 'bug',
    priority: 'urgent',
    status: 'new',
    subject: 'CSV import skips customer phone numbers',
    message: 'When we upload the customer list, several phone numbers disappear from the preview.',
    createdAt: 'Today',
    lastUpdate: '12 min ago',
    messages: [
      {
        id: 'msg-apex-import-1',
        author: 'company',
        authorName: 'Maria Chen',
        body: 'When we upload the customer list, several phone numbers disappear from the preview.',
        createdAt: 'Today',
      },
    ],
  },
  {
    id: 'sup-northline-filter',
    companyId: 'cmp-northline',
    companyName: 'Northline HVAC',
    authorName: 'Alex Morgan',
    authorEmail: 'alex@northline.example',
    kind: 'change',
    priority: 'normal',
    status: 'reviewing',
    subject: 'Add filter by technician team',
    message: 'Managers want to see job lists by service team, not only individual technician.',
    createdAt: 'Yesterday',
    lastUpdate: '1 hr ago',
    messages: [
      {
        id: 'msg-northline-filter-1',
        author: 'company',
        authorName: 'Alex Morgan',
        body: 'Managers want to see job lists by service team, not only individual technician.',
        createdAt: 'Yesterday',
      },
      {
        id: 'msg-northline-filter-2',
        author: 'owner',
        authorName: 'ServiceScope Owner',
        body: 'I am reviewing how this should work across all companies before scheduling it.',
        createdAt: 'Today',
      },
    ],
  },
];

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
  if (!saved) return supportTicketsSeed.map((ticket) => normalizeTicket(ticket, companies));

  try {
    return (JSON.parse(saved) as Partial<SupportTicket>[]).map((ticket) => normalizeTicket(ticket, companies));
  } catch {
    return supportTicketsSeed.map((ticket) => normalizeTicket(ticket, companies));
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
