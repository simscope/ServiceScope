import type { CompanyOnboardingProfile, ServiceJob, ServiceJobStatus } from '../../types';
import { isCustomerJobPaid } from '../../utils/format';

type JobModelInput = {
  jobs: ServiceJob[];
  openJobs: number;
  profile: CompanyOnboardingProfile;
  selectedJobTypeId: string;
  allJobsVisibility: 'active' | 'paid' | 'all';
};

export function makeJobModel({
  jobs,
  openJobs,
  profile,
  selectedJobTypeId,
  allJobsVisibility,
}: JobModelInput) {
  const defaultJobType = profile.jobTypes.find((jobType) => jobType.name === 'HVAC') ?? profile.jobTypes[0];
  const selectedJobType = profile.jobTypes.find((jobType) => jobType.id === selectedJobTypeId) ?? defaultJobType;
  const selectedJobPrefix = profile.useJobNumberPrefixes ? selectedJobType?.jobNumberPrefix || profile.jobNumberPrefix || 'JOB' : '';
  const highestJobNumber = jobs.reduce((highest, job) => {
    const lastPart = job.jobNumber.split('-').pop() ?? job.jobNumber;
    const numericJobNumber = Number(lastPart);
    return Number.isFinite(numericJobNumber) ? Math.max(highest, numericJobNumber) : highest;
  }, openJobs);
  const nextJobNumber = String(highestJobNumber + 1).padStart(4, '0');
  const generatedJobNumber = selectedJobPrefix ? `${selectedJobPrefix}-${nextJobNumber}` : nextJobNumber;
  const jobStatusFilters: ServiceJobStatus[] = ['New', 'ReCall', 'Diagnosis', 'In progress', 'Parts ordered', 'Waiting for parts', 'To finish', 'Completed', 'Warranty', 'Cancelled', 'Archived'];
  const allJobsRows = jobs;
  const closedJobStatuses = new Set<ServiceJobStatus>(['Completed', 'Warranty', 'Cancelled', 'Archived']);
  const activeJobsRows = allJobsRows.filter((job) => !closedJobStatuses.has(job.status) && !isCustomerJobPaid(job));
  const paidJobsRows = allJobsRows.filter(isCustomerJobPaid);
  const visibleAllJobsRows = allJobsVisibility === 'paid' ? paidJobsRows : allJobsVisibility === 'all' ? allJobsRows : activeJobsRows;
  const allJobsGroups = Array.from(new Set(['No technician', ...allJobsRows.map((job) => job.assignee)])).map((technician) => ({
    technician,
    jobs: visibleAllJobsRows.filter((job) => job.assignee === technician),
  })).filter((group) => group.jobs.length > 0);

  return {
    defaultJobType,
    selectedJobType,
    selectedJobPrefix,
    nextJobNumber,
    generatedJobNumber,
    jobStatusFilters,
    allJobsRows,
    closedJobStatuses,
    activeJobsRows,
    paidJobsRows,
    visibleAllJobsRows,
    allJobsGroups,
  };
}
