import type { Dispatch, FormEvent, SetStateAction } from 'react';
import type { JobCardData } from '../../components/JobCard';
import { createServiceJob, saveCustomerBlacklist, saveServiceJob } from '../../services/jobsStore';
import type { JobInboxItem } from '../../appTypes';
import type {
  CompanyJobType,
  CompanyOnboardingProfile,
  CompanyPortalAccessPage,
  NewServiceJobForm,
  ServiceJob,
} from '../../types';

type JobInboxActions = {
  markConverted: (item: JobInboxItem, jobId: string) => Promise<unknown>;
  setStatus: (status: string) => void;
};

type JobActionsInput = {
  companyId: string;
  profile: CompanyOnboardingProfile;
  generatedJobNumber: string;
  selectedJobType?: CompanyJobType;
  inlineJobDrafts: Record<string, Partial<ServiceJob>>;
  setInlineJobDrafts: Dispatch<SetStateAction<Record<string, Partial<ServiceJob>>>>;
  setJobs: Dispatch<SetStateAction<ServiceJob[]>>;
  setOpenedJob: Dispatch<SetStateAction<JobCardData | null>>;
  setJobsStatus: Dispatch<SetStateAction<string>>;
  setClientPage: (page: 'jobs') => void;
  jobInboxFeature: JobInboxActions;
  stopCompanyWrite: (page: CompanyPortalAccessPage, action: string) => boolean;
};

export function makeJobActions({
  companyId,
  profile,
  generatedJobNumber,
  selectedJobType,
  inlineJobDrafts,
  setInlineJobDrafts,
  setJobs,
  setOpenedJob,
  setJobsStatus,
  setClientPage,
  jobInboxFeature,
  stopCompanyWrite,
}: JobActionsInput) {
  function handleSaveJob(updatedJob: JobCardData, openJobAfterSave = true, accessPage: CompanyPortalAccessPage = 'jobs') {
    if (stopCompanyWrite(accessPage, 'saving jobs')) return;

    setJobs((currentJobs) => currentJobs.map((job) => (job.id === updatedJob.id ? updatedJob : job)));
    if (openJobAfterSave) {
      setOpenedJob(updatedJob);
    } else {
      setOpenedJob((currentJob) => (currentJob?.id === updatedJob.id ? updatedJob : currentJob));
    }
    setJobsStatus('Saving job...');

    saveServiceJob(companyId, updatedJob)
      .then((savedJob) => {
        setJobs((currentJobs) => currentJobs.map((job) => (job.id === updatedJob.id || job.jobNumber === savedJob.jobNumber ? savedJob : job)));
        if (openJobAfterSave) {
          setOpenedJob(savedJob);
        } else {
          setOpenedJob((currentJob) => (currentJob?.id === savedJob.id ? savedJob : currentJob));
        }
        setJobsStatus('Job saved.');
      })
      .catch((error) => {
        setJobsStatus(error instanceof Error ? error.message : 'Job could not be saved.');
      });
  }

  async function handleSaveCustomerBlacklist(job: ServiceJob, blacklist: string) {
    if (stopCompanyWrite('debtors', 'updating customer blacklist')) {
      throw new Error('Debtors access is read-only.');
    }
    if (!job.customerId) {
      throw new Error('Customer record was not found for this job.');
    }

    const cleanBlacklist = blacklist.trim();
    setJobs((currentJobs) => currentJobs.map((currentJob) => (
      currentJob.customerId === job.customerId ? { ...currentJob, customerBlacklist: cleanBlacklist } : currentJob
    )));
    await saveCustomerBlacklist(companyId, job.customerId, cleanBlacklist);
  }

  async function handleImportJobs(importedJobs: ServiceJob[]) {
    if (stopCompanyWrite('import', 'importing jobs')) return;
    setJobsStatus(`Importing ${importedJobs.length} migration jobs...`);

    const savedJobs: ServiceJob[] = [];
    for (const importedJob of importedJobs) {
      const savedJob = await saveServiceJob(companyId, importedJob);
      savedJobs.push(savedJob);
      setJobs((currentJobs) => {
        const exists = currentJobs.some((job) => job.id === savedJob.id || job.jobNumber === savedJob.jobNumber);
        return exists
          ? currentJobs.map((job) => (job.id === savedJob.id || job.jobNumber === savedJob.jobNumber ? savedJob : job))
          : [savedJob, ...currentJobs];
      });
      setJobsStatus(`Imported ${savedJobs.length}/${importedJobs.length} migration jobs...`);
    }

    setJobsStatus(`Migration import complete: ${savedJobs.length} jobs saved.`);
  }

  function handleSaveInlineJob(job: ServiceJob) {
    const draft = inlineJobDrafts[job.id] ?? {};
    const updatedJob = {
      ...job,
      ...draft,
      assignee: draft.technician ?? job.technician,
    };

    handleSaveJob(updatedJob, false);
    setInlineJobDrafts((drafts) => {
      const nextDrafts = { ...drafts };
      delete nextDrafts[job.id];
      return nextDrafts;
    });
  }

  function handleCreateJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stopCompanyWrite('jobs', 'creating jobs')) return;

    const form = new FormData(event.currentTarget);
    const rawJobNumber = String(form.get('jobNumber') ?? '').trim();
    const technicianName = String(form.get('technician') ?? '').trim();
    const jobForm: NewServiceJobForm = {
      jobNumber: rawJobNumber && rawJobNumber.toLowerCase() !== 'automatic' ? rawJobNumber : generatedJobNumber,
      system: selectedJobType?.name ?? String(form.get('system') ?? 'General'),
      clientName: String(form.get('clientName') ?? '').trim() || 'Unknown client',
      organization: String(form.get('organization') ?? '').trim() || 'Unknown company',
      phone: String(form.get('phone') ?? '').trim(),
      email: String(form.get('email') ?? '').trim(),
      address: String(form.get('address') ?? '').trim(),
      technician: technicianName,
      serviceCallFee: String(form.get('serviceCallFee') ?? profile.serviceCallFee).trim() || String(profile.serviceCallFee),
      issue: String(form.get('issue') ?? '').trim() || 'Service request',
      notes: String(form.get('notes') ?? '').trim(),
    };
    const createdJob = createServiceJob(companyId, jobForm);

    setJobs((currentJobs) => [createdJob, ...currentJobs]);
    setOpenedJob(createdJob);
    setJobsStatus('Creating job...');

    saveServiceJob(companyId, createdJob)
      .then((savedJob) => {
        setJobs((currentJobs) => currentJobs.map((job) => (job.id === createdJob.id ? savedJob : job)));
        setOpenedJob(savedJob);
        setJobsStatus('Job created.');
      })
      .catch((error) => {
        setJobs((currentJobs) => currentJobs.filter((job) => job.id !== createdJob.id));
        setOpenedJob(null);
        setJobsStatus(error instanceof Error ? error.message : 'Job could not be created.');
      });
  }

  function handleConvertJobInboxItem(item: JobInboxItem) {
    if (stopCompanyWrite('jobInbox', 'converting job inbox items')) return;
    if (stopCompanyWrite('jobs', 'creating jobs')) return;

    const createdJob = createServiceJob(companyId, {
      jobNumber: generatedJobNumber,
      system: selectedJobType?.name ?? 'General',
      clientName: item.clientName.trim() || 'Unknown client',
      organization: item.clientName.trim() || 'Unknown company',
      phone: item.clientPhone,
      email: item.clientEmail,
      address: item.address,
      technician: '',
      serviceCallFee: String(profile.serviceCallFee),
      issue: item.message.trim() || 'Service request',
      notes: `Created from Job Inbox (${item.source}).`,
    });

    jobInboxFeature.setStatus('Converting inbox item to job...');
    saveServiceJob(companyId, createdJob)
      .then(async (savedJob) => {
        await jobInboxFeature.markConverted(item, savedJob.id);
        setJobs((currentJobs) => [savedJob, ...currentJobs.filter((job) => job.id !== savedJob.id)]);
        setOpenedJob(savedJob);
        setClientPage('jobs');
        jobInboxFeature.setStatus(`Converted to job ${savedJob.jobNumber}.`);
      })
      .catch((error) => {
        jobInboxFeature.setStatus(error instanceof Error ? error.message : 'Inbox item could not be converted.');
      });
  }

  return {
    handleSaveJob,
    handleSaveCustomerBlacklist,
    handleImportJobs,
    handleSaveInlineJob,
    handleCreateJob,
    handleConvertJobInboxItem,
  };
}
