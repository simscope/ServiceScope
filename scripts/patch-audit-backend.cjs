const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appPath = path.join(root, 'src/App.tsx');
let app = fs.readFileSync(appPath, 'utf8');

if (!app.includes('loadAuditEventsFromBackend')) {
  app = app.replace(
    "  filterAuditEvents,\n  listAuditEvents,",
    "  filterAuditEvents,\n  listAuditEvents,\n  loadAuditEventsFromBackend,",
  );
}

if (app.includes('        setAuditEvents([]);')) {
  app = app.replace(
    '        setAuditEvents([]);',
    `        loadAuditEventsFromBackend(authSession.kind === 'company' ? authSession.companyId : undefined)
          .then((events) => {
            if (ignore) return;
            setAuditEvents(events);
          })
          .catch((error) => {
            if (ignore) return;
            setAuditEvents([]);
            console.error('Failed to load audit events from Supabase', error);
          });`,
  );
}

const oldRecordAudit = `  function recordAudit(event: Omit<AuditEvent, 'id' | 'createdAt'>) {
    setAuditEvents((currentEvents) => {
      const nextEvents = [createAuditEvent(event), ...currentEvents];
      saveAuditEvents(nextEvents);
      return nextEvents;
    });
  }`;

const newRecordAudit = `  function recordAudit(event: Omit<AuditEvent, 'id' | 'createdAt'>) {
    const actorRole = authSession?.kind === 'owner' ? 'owner' : authSession?.role;
    const companyId = event.companyId ?? (authSession?.kind === 'company' ? authSession.companyId : selectedCompany?.id);
    const auditEvent = createAuditEvent({
      ...event,
      companyId,
      actorUserId: event.actorUserId ?? authSession?.userId,
      actorRole: event.actorRole ?? actorRole,
    });

    setAuditEvents((currentEvents) => {
      const nextEvents = [auditEvent, ...currentEvents].slice(0, 500);
      saveAuditEvents(nextEvents);
      return nextEvents;
    });
  }`;

if (app.includes(oldRecordAudit)) {
  app = app.replace(oldRecordAudit, newRecordAudit);
}

fs.writeFileSync(appPath, app);
console.log('Audit Supabase backend patch applied.');
