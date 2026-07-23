import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const store = await readFile('src/services/calendarAppointmentStore.ts', 'utf8');
const loader = await readFile('src/features/jobs/useCompanyJobsLoader.ts', 'utf8');
const persistence = await readFile('src/features/calendar/calendarPersistence.ts', 'utf8');

assert.match(store, /hydrateCalendarAppointments/);
assert.match(store, /job_id=\$\{sqlIn\(ids\)\}/);
assert.match(store, /order=starts_at\.desc/);
assert.match(store, /APPOINTMENT_BATCH_SIZE = 50/);
assert.match(store, /savePersistedCalendarAppointment/);
assert.match(store, /jobs\?company_id=.*technician_id/);
assert.match(store, /Calendar appointment could not be verified after saving/);

assert.match(loader, /hydrateCalendarAppointments\(company\.id, baseJobs\)/);
assert.match(persistence, /savePersistedCalendarAppointment\(companyId, baseJob, assignee, appointment, durationMinutes\)/);
assert.match(persistence, /delete nextAssignments\[jobNumber\]/);
assert.match(persistence, /currentJobs\.map\(\(job\) => \(job\.id === baseJob\.id \? baseJob : job\)\)/);

console.log('calendar persistence regression checks passed');
