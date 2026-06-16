import type { AuditEvent, AuditEventCategory } from '../types';

const STORAGE_KEY = 'servicescope.v2.auditEvents';

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
  if (!saved) return [];

  try {
    return (JSON.parse(saved) as Partial<AuditEvent>[]).map(normalizeEvent);
  } catch {
    return [];
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
