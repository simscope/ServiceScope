import { useState } from 'react';
import type { JobCardData } from '../../components/JobCard';
import type { ServiceJob } from '../../types';

export function useJobsFeature() {
  const [openedJob, setOpenedJob] = useState<JobCardData | null>(null);
  const [jobs, setJobs] = useState<ServiceJob[]>([]);
  const [jobsStatus, setJobsStatus] = useState('');
  const [inlineJobDrafts, setInlineJobDrafts] = useState<Record<string, Partial<ServiceJob>>>({});
  const [allJobsVisibility, setAllJobsVisibility] = useState<'active' | 'paid' | 'all'>('active');
  const [selectedJobTypeId, setSelectedJobTypeId] = useState('');

  return {
    openedJob,
    setOpenedJob,
    jobs,
    setJobs,
    jobsStatus,
    setJobsStatus,
    inlineJobDrafts,
    setInlineJobDrafts,
    allJobsVisibility,
    setAllJobsVisibility,
    selectedJobTypeId,
    setSelectedJobTypeId,
  };
}
