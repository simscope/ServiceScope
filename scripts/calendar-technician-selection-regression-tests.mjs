import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const actions = await readFile('src/features/calendar/calendarActions.ts', 'utf8');
const operations = await readFile('src/features/company-portal/companyPortalOperationsModel.ts', 'utf8');

assert.match(actions, /setStatus: Dispatch<SetStateAction<string>>/);
assert.match(actions, /const isUnscheduled = !movedJob\?\.dayKey \|\| !movedJob\?\.time \|\| movedJob\.assignee === 'No technician'/);
assert.match(actions, /activeCalendarTech === 'all' && isUnscheduled/);
assert.match(actions, /Select a technician before scheduling an unassigned job\./);
assert.match(actions, /setDraggingJobNumber\(''\)/);
assert.equal((actions.match(/const assignee = resolveDropAssignee\(movedJob\);/g) ?? []).length, 2);
assert.match(actions, /if \(!assignee\) return;/);
assert.match(operations, /setStatus: setJobsStatus/);

console.log('calendar technician selection regression checks passed');
