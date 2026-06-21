import type { AuditEvent, AuditEventCategory } from '../types';

export function listAuditEvents(): AuditEvent[] {
  return [];
}

export function saveAuditEvents(events: AuditEvent[]) {
  void events;
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
