import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { listCompanyJobMaterials, listCompanyJobs } from '../../services/jobsStore';
import type { Company, MaterialRow, ServiceJob } from '../../types';

type CompanyJobsLoaderInput = {
  selectedCompany?: Company;
  setJobs: Dispatch<SetStateAction<ServiceJob[]>>;
  setMaterials: Dispatch<SetStateAction<MaterialRow[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export function useCompanyJobsLoader({
  selectedCompany,
  setJobs,
  setMaterials,
  setStatus,
}: CompanyJobsLoaderInput) {
  useEffect(() => {
    if (!selectedCompany) {
      setJobs([]);
      setMaterials([]);
      setStatus('');
      return undefined;
    }

    let cancelled = false;
    const company = selectedCompany;
    setStatus('Loading jobs...');

    async function loadJobsAndCustomers() {
      try {
        const [savedJobs, savedMaterials] = await Promise.all([
          listCompanyJobs(company.id),
          listCompanyJobMaterials(company.id),
        ]);
        if (cancelled) return;
        setJobs(savedJobs);
        setMaterials(savedMaterials);
        setStatus('');
      } catch (error) {
        if (cancelled) return;
        setJobs([]);
        setMaterials([]);
        setStatus(error instanceof Error ? error.message : 'Jobs could not be loaded.');
      }
    }

    void loadJobsAndCustomers();

    return () => {
      cancelled = true;
    };
  }, [selectedCompany, setJobs, setMaterials, setStatus]);
}
