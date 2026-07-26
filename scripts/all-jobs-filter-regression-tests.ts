import {
  normalizeAllJobsVisibilityForStatus,
  type AllJobsStatusFilter,
  type AllJobsVisibility,
} from '../src/features/jobs/allJobsFilters.js';

function fail(message: string): never {
  throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    fail(`${message}. Expected ${String(expected)}, received ${String(actual)}`);
  }
}

function applyStatus(
  status: AllJobsStatusFilter,
  currentVisibility: AllJobsVisibility,
): AllJobsVisibility {
  return normalizeAllJobsVisibilityForStatus(status, currentVisibility);
}

assertEqual(applyStatus('Completed', 'active'), 'all', 'Completed + Active switches to All jobs');
assertEqual(applyStatus('Warranty', 'active'), 'all', 'Warranty + Active switches to All jobs');
assertEqual(applyStatus('Cancelled', 'active'), 'all', 'Cancelled + Active switches to All jobs');
assertEqual(applyStatus('Archived', 'active'), 'all', 'Archived + Active switches to All jobs');
assertEqual(applyStatus('Parts ordered', 'active'), 'active', 'Parts ordered + Active stays Active');

let visibility: AllJobsVisibility = 'active';
visibility = applyStatus('Completed', visibility);
assertEqual(visibility, 'all', 'Inactive status auto-switches from Active');
visibility = 'paid';
visibility = applyStatus('Completed', visibility);
assertEqual(visibility, 'paid', 'Manual valid view after auto-switch is preserved');

console.log('all jobs filter regression tests passed');
