import type { Dispatch, SetStateAction } from 'react';
import { saveJobMaterials as saveJobMaterialsToBackend } from '../../services/jobsStore';
import type { CompanyJobType, MaterialRow, ServiceJob } from '../../types';
import type { MaterialJobStatusFilter } from './useMaterialsFeature';
import { normalizeMaterialRows } from './useMaterialsFeature';

type MaterialWorkflowInput = {
  companyId: string;
  materials: MaterialRow[];
  materialStatusFilter: 'all' | MaterialRow['status'];
  materialJobStatusFilter: MaterialJobStatusFilter;
  jobTypes: CompanyJobType[];
  materialTechFilter: string;
  materialSearch: string;
  editingMaterialsJobNumber: string;
  materialDraftRows: MaterialRow[];
  allJobsRows: ServiceJob[];
  activeJobsRows: ServiceJob[];
  setMaterials: Dispatch<SetStateAction<MaterialRow[]>>;
  setJobsStatus: Dispatch<SetStateAction<string>>;
  closeMaterialEditor: () => void;
  stopMaterialsWrite: (action: string) => boolean;
};

export function makeMaterialWorkflow({
  companyId,
  materials,
  materialStatusFilter,
  materialJobStatusFilter,
  jobTypes,
  materialTechFilter,
  materialSearch,
  editingMaterialsJobNumber,
  materialDraftRows,
  allJobsRows,
  activeJobsRows,
  setMaterials,
  setJobsStatus,
  closeMaterialEditor,
  stopMaterialsWrite,
}: MaterialWorkflowInput) {
  const materialJobMap = new globalThis.Map(allJobsRows.map((job) => [job.jobNumber, job]));
  const materialRowsWithJobs = materials
    .map((material) => ({ material, job: materialJobMap.get(material.jobNumber) }))
    .filter((row): row is { material: MaterialRow; job: ServiceJob } => Boolean(row.job));
  const normalizedMaterialSearch = materialSearch.trim().toLowerCase();
  const materialJobMatchesSearch = (job: ServiceJob, extras: string[] = []) => {
    if (!normalizedMaterialSearch) return true;
    return [job.jobNumber, job.organization, job.clientName, job.phone, job.email, job.address, job.system, job.issue, job.notes, ...extras]
      .join(' ')
      .toLowerCase()
      .includes(normalizedMaterialSearch);
  };
  const materialJobMatchesTechnician = (job: ServiceJob) => materialTechFilter === 'all' || job.assignee === materialTechFilter;
  const materialJobMatchesStatus = (job: ServiceJob) => materialJobStatusFilter === 'all'
    ? true
    : materialJobStatusFilter === 'active'
      ? activeJobsRows.some((activeJob) => activeJob.jobNumber === job.jobNumber)
      : job.status === materialJobStatusFilter;
  const materialJobIsAllowed = (job: ServiceJob) => !job.customerBlacklist?.trim();
  const materialJobRequiresParts = (job: ServiceJob) => (
    jobTypes.some((jobType) => jobType.id === job.jobTypeId && jobType.requiresParts)
    || job.status === 'Parts ordered'
    || job.status === 'Waiting for parts'
  );
  const filteredMaterialRows = materialRowsWithJobs.filter(({ material, job }) => {
    const matchesStatus = materialStatusFilter === 'all' || material.status === materialStatusFilter;

    return matchesStatus && materialJobMatchesStatus(job) && materialJobIsAllowed(job) && materialJobMatchesTechnician(job) && materialJobMatchesSearch(job, [material.name, material.supplier, material.status]);
  });
  const materialJobs = materialJobStatusFilter === 'active' ? activeJobsRows : allJobsRows;
  const jobsWithoutMaterials = materialJobs.filter((job) => materialJobMatchesStatus(job) && materialJobIsAllowed(job) && materialJobRequiresParts(job) && !materials.some((material) => material.jobNumber === job.jobNumber));
  const filteredJobsWithoutMaterials = jobsWithoutMaterials.filter((job) => (
    materialStatusFilter === 'all' && materialJobMatchesTechnician(job) && materialJobMatchesSearch(job)
  ));
  const selectedMaterialsJob = materialJobMap.get(editingMaterialsJobNumber);
  const materialsTotal = filteredMaterialRows.reduce((sum, { material }) => sum + material.quantity * material.price, 0);

  function saveMaterialDraftRows() {
    if (stopMaterialsWrite('saving materials')) return;
    if (!editingMaterialsJobNumber) return;
    const jobNumber = editingMaterialsJobNumber;
    const cleanRows = normalizeMaterialRows(jobNumber, materialDraftRows);

    setMaterials((rows) => [
      ...rows.filter((row) => row.jobNumber !== jobNumber),
      ...cleanRows,
    ]);
    closeMaterialEditor();

    if (!companyId) return;
    setJobsStatus('Saving materials...');
    saveJobMaterialsToBackend(companyId, jobNumber, cleanRows)
      .then((savedMaterials) => {
        setMaterials(savedMaterials);
        setJobsStatus('Materials saved.');
      })
      .catch((error) => {
        setJobsStatus(error instanceof Error ? error.message : 'Materials could not be saved.');
      });
  }

  function saveJobMaterials(jobNumber: string, rows: MaterialRow[]) {
    if (stopMaterialsWrite('saving materials')) return Promise.resolve();

    const cleanRows = normalizeMaterialRows(jobNumber, rows);

    setMaterials((currentRows) => [
      ...currentRows.filter((row) => row.jobNumber !== jobNumber),
      ...cleanRows,
    ]);

    if (!companyId) return Promise.resolve();
    setJobsStatus('Saving materials...');
    return saveJobMaterialsToBackend(companyId, jobNumber, cleanRows)
      .then((savedMaterials) => {
        setMaterials(savedMaterials);
        setJobsStatus('Materials saved.');
      })
      .catch((error) => {
        setJobsStatus(error instanceof Error ? error.message : 'Materials could not be saved.');
        throw error;
      });
  }

  return {
    materialJobMap,
    filteredMaterialRows,
    filteredJobsWithoutMaterials,
    selectedMaterialsJob,
    materialsTotal,
    saveMaterialDraftRows,
    saveJobMaterials,
  };
}
