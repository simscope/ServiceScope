import type { AuditEvent, AuditEventCategory } from '../types';

const STORAGE_KEY = 'servicescope.auditEvents';

const auditSeed: AuditEvent[] = [
  {
    id: 'aud-seed-company',
    category: 'tenant',
    action: 'company.created',
    actor: 'ServiceScope Owner',
    resource: 'Northline HVAC',
    details: 'Tenant workspace created from owner console.',
    createdAt: 'Today',
  },
  {
    id: 'aud-seed-support',
    category: 'support',
    action: 'support.ticket_created',
    actor: 'Maria Chen',
    resource: 'Apex Service Co',
    details: 'Urgent bug report opened for CSV import.',
    createdAt: 'Today',
  },
  {
    id: 'aud-seed-access',
    category: 'access',
    action: 'access.user_invited',
    actor: 'ServiceScope Owner',
    resource: 'Operations Admin',
    details: 'Admin invitation sent.',
    createdAt: 'Yesterday',
  },
];

function normalizeEvent(event: Partial<AuditEvent>): AuditEvent {
  return {
    id: event.id ?? crypto.randomUUID(),
    category: event.category ?? 'tenant',
    action: event.action ?? 'event.recorded',
    actor: event.actor ?? 'ServiceScope Owner',
    resource: event.resource ?? 'Platform',
    details: event.details ?? '',
    createdAt: event.createdAt ?? 'Just now',
  };
}

export function listAuditEvents() {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return auditSeed;

  try {
    return (JSON.parse(saved) as Partial<AuditEvent>[]).map(normalizeEvent);
  } catch {
    return auditSeed;
  }
}

export function saveAuditEvents(events: AuditEvent[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

export function createAuditEvent(event: Omit<AuditEvent, 'id' | 'createdAt'>): AuditEvent {
  return {
    id: crypto.randomUUID(),
    ...event,
    createdAt: 'Just now',
  };
}

export function filterAuditEvents(events: AuditEvent[], category: 'all' | AuditEventCategory) {
  return category === 'all' ? events : events.filter((event) => event.category === category);
}
