import type { ServiceJobStatus } from '../../types.js';

export type AllJobsVisibility = 'active' | 'paid' | 'all';
export type AllJobsStatusFilter = 'all' | ServiceJobStatus;

export const inactiveAllJobsStatuses = new Set<ServiceJobStatus>([
  'Completed',
  'Warranty',
  'Cancelled',
  'Archived',
]);

export function isInactiveAllJobsStatus(status: AllJobsStatusFilter) {
  return status !== 'all' && inactiveAllJobsStatuses.has(status);
}

export function normalizeAllJobsVisibilityForStatus(
  status: AllJobsStatusFilter,
  visibility: AllJobsVisibility,
): AllJobsVisibility {
  return isInactiveAllJobsStatus(status) && visibility === 'active' ? 'all' : visibility;
}
