import type { AuditEvent, AuditEventCategory } from '../types';
import { isSupabaseConfigured, sqlEq, supabaseRequest } from './supabaseRest';

const AUDIT_STORAGE_KEY = 'servicescope.auditEvents';

type AuditEventRow = {
  id: string;
  company_id: string | null;
  actor_user_id: string | null;
  actor_name: string;
  actor_role: string | null;
  category: AuditEventCategory;
  action: string;
  resource: string;
  resource_id: string | null;
  details: string;
  user_agent: string | null;
  created_at: string;
};

function auditTimestamp(date = new Date()) {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toIsoTimestamp(value?: string) {
  if (!value || value === 'Just now') return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function formatAuditTime(value?: string | null) {
  if (!value) return auditTimestamp();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : auditTimestamp(parsed);
}

function readStoredAuditEvents() {
  if (typeof window === 'undefined') return [] as AuditEvent[];
  const saved = window.localStorage.getItem(AUDIT_STORAGE_KEY);
  if (!saved) return [] as AuditEvent[];

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed as AuditEvent[] : [];
  } catch {
    return [] as AuditEvent[];
  }
}

function clearStoredAuditEvents() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(AUDIT_STORAGE_KEY);
}

function rowToAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    companyId: row.company_id ?? undefined,
    actorUserId: row.actor_user_id ?? undefined,
    actorRole: row.actor_role ?? undefined,
    category: row.category,
    action: row.action,
    actor: row.actor_name,
    resource: row.resource,
    resourceId: row.resource_id ?? undefined,
    details: row.details,
    createdAt: formatAuditTime(row.created_at),
  };
}

function eventToRow(event: AuditEvent): AuditEventRow {
  return {
    id: event.id,
    company_id: event.companyId ?? null,
    actor_user_id: event.actorUserId ?? null,
    actor_name: event.actor || 'Unknown user',
    actor_role: event.actorRole ?? null,
    category: event.category,
    action: event.action,
    resource: event.resource,
    resource_id: event.resourceId ?? null,
    details: event.details,
    user_agent: typeof navigator === 'undefined' ? null : navigator.userAgent,
    created_at: toIsoTimestamp(event.createdAt),
  };
}

export function listAuditEvents(): AuditEvent[] {
  if (isSupabaseConfigured()) {
    clearStoredAuditEvents();
    return [];
  }

  return readStoredAuditEvents();
}

export async function loadAuditEventsFromBackend(companyId?: string) {
  const companyFilter = companyId ? `&company_id=${sqlEq(companyId)}` : '';
  const rows = await supabaseRequest<AuditEventRow[]>(
    `audit_events?select=*&order=created_at.desc&limit=500${companyFilter}`,
  );

  clearStoredAuditEvents();
  return rows.map(rowToAuditEvent);
}

async function persistAuditEventsToBackend(events: AuditEvent[]) {
  if (!events.length || !isSupabaseConfigured()) return;

  await supabaseRequest('audit_events?on_conflict=id', {
    method: 'POST',
    prefer: 'resolution=ignore-duplicates,return=minimal',
    body: events.map(eventToRow),
  });
}

export function saveAuditEvents(events: AuditEvent[]) {
  if (isSupabaseConfigured()) {
    clearStoredAuditEvents();
  } else if (typeof window !== 'undefined') {
    window.localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(events));
  }

  void persistAuditEventsToBackend(events).catch((error) => {
    console.error('Failed to save audit events to Supabase', error);
  });
}

export function createAuditEvent(event: Omit<AuditEvent, 'id' | 'createdAt'>): AuditEvent {
  return {
    id: crypto.randomUUID(),
    ...event,
    createdAt: auditTimestamp(),
  };
}

export function filterAuditEvents(events: AuditEvent[], category: 'all' | AuditEventCategory) {
  return category === 'all' ? events : events.filter((event) => event.category === category);
}
